import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, Put,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { defaultRegistry, runBlockOnce, type OverrideEntry } from '@motor-fiscal/engine';
import { overrideInputSchema, testOverrideInputSchema } from '@motor-fiscal/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId, ZodPipe, today } from '../common/common';
import { EngineService } from '../engine/engine.service';

type OverrideBody = z.output<typeof overrideInputSchema>;
type TestBody = z.output<typeof testOverrideInputSchema>;

/** Lista as diferenças entre dois JSONs como `caminho: antes → depois`. */
function diffJson(a: unknown, b: unknown, path = ''): Array<{ path: string; padrao: unknown; override: unknown }> {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diffJson(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return [{ path: path || '(valor)', padrao: a, override: b }];
}

@Injectable()
export class OverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  list(tenantId: string) {
    return this.prisma.blockOverride.findMany({ where: { tenantId }, orderBy: [{ blockKey: 'asc' }, { validFrom: 'desc' }] });
  }

  private async find(tenantId: string, id: string) {
    const o = await this.prisma.blockOverride.findFirst({ where: { id, tenantId } });
    if (!o) throw new NotFoundException('Override não encontrado');
    return o;
  }

  get(tenantId: string, id: string) {
    return this.find(tenantId, id);
  }

  private assertBlock(b: OverrideBody) {
    const def = defaultRegistry.get(b.blockKey);
    if (!def) throw new BadRequestException(`Bloco "${b.blockKey}" não existe`);
    if (def.overridable === false || def.dynamicPorts) throw new BadRequestException(`O bloco "${def.label}" não aceita override`);
    const p = def.params.safeParse(b.params);
    if (!p.success) {
      throw new BadRequestException(`Parâmetros inválidos para ${def.label}: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
  }

  async create(tenantId: string, b: OverrideBody) {
    this.assertBlock(b);
    return this.prisma.blockOverride.create({
      data: { tenantId, blockKey: b.blockKey, name: b.name, code: b.code?.trim() ? b.code : null, params: b.params as Prisma.InputJsonValue, validFrom: b.validFrom, validTo: b.validTo ?? null, legalBasis: b.legalBasis ?? null, active: b.active },
    });
  }

  async update(tenantId: string, id: string, b: OverrideBody) {
    await this.find(tenantId, id);
    this.assertBlock(b);
    return this.prisma.blockOverride.update({
      where: { id },
      data: { blockKey: b.blockKey, name: b.name, code: b.code?.trim() ? b.code : null, params: b.params as Prisma.InputJsonValue, validFrom: b.validFrom, validTo: b.validTo ?? null, legalBasis: b.legalBasis ?? null, active: b.active },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.find(tenantId, id);
    await this.prisma.blockOverride.delete({ where: { id } });
  }

  /** Roda o bloco padrão e o override com as mesmas entradas e mostra as diferenças. */
  async test(tenantId: string, id: string, body: TestBody) {
    const o = await this.find(tenantId, id);
    const referenceDate = body.referenceDate ?? today();
    const ctx = await this.engine.buildContext(tenantId, referenceDate, { dryRun: true });
    // força o override (ignora ativo/vigência: o teste serve justamente para validar antes de ativar)
    const forced: OverrideEntry = {
      id: o.id, blockKey: o.blockKey, name: o.name, code: o.code, params: o.params as Record<string, unknown>,
      validFrom: '0000-01-01', validTo: null, legalBasis: o.legalBasis, active: true,
    };
    const run = async (override: OverrideEntry | null) => {
      try {
        const r = await runBlockOnce({ blockKey: o.blockKey, inputs: body.inputs, params: body.params, ctx, override });
        return { ok: true as const, outputs: r.outputs, durationMs: r.durationMs, override: r.override };
      } catch (e) {
        const err = e as Error & { code?: string };
        return { ok: false as const, error: { message: err.message, code: err.code ?? 'ERRO' } };
      }
    };
    const padrao = await run(null);
    const custom = await run(forced);
    return {
      padrao,
      override: custom,
      diferencas: padrao.ok && custom.ok ? diffJson(padrao.outputs, custom.outputs) : [],
    };
  }
}

@Controller('overrides')
export class OverridesController {
  constructor(private readonly service: OverridesService) {}

  @Get() list(@TenantId() t: string) {
    return this.service.list(t);
  }

  @Get(':id') get(@TenantId() t: string, @Param('id') id: string) {
    return this.service.get(t, id);
  }

  @Post() create(@TenantId() t: string, @Body(new ZodPipe(overrideInputSchema)) b: OverrideBody) {
    return this.service.create(t, b);
  }

  @Put(':id') update(@TenantId() t: string, @Param('id') id: string, @Body(new ZodPipe(overrideInputSchema)) b: OverrideBody) {
    return this.service.update(t, id, b);
  }

  @Delete(':id') @HttpCode(204) remove(@TenantId() t: string, @Param('id') id: string) {
    return this.service.remove(t, id);
  }

  @Post(':id/test') @HttpCode(200) test(@TenantId() t: string, @Param('id') id: string, @Body(new ZodPipe(testOverrideInputSchema)) b: TestBody) {
    return this.service.test(t, id, b);
  }
}

@Module({ controllers: [OverridesController], providers: [OverridesService] })
export class OverridesModule {}
