import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, Put,
  Query, UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type FlowKind } from '@prisma/client';
import { validateGraph, validateSubflowGraph } from '@motor-fiscal/engine';
import {
  EMPTY_GRAPH, flowInputSchema, runFlowInputSchema, type FlowGraph, type PortDef,
} from '@motor-fiscal/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId, ZodPipe } from '../common/common';
import { EngineService } from '../engine/engine.service';

type FlowBody = z.output<typeof flowInputSchema>;
type RunBody = z.output<typeof runFlowInputSchema>;

@Injectable()
export class FlowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  async list(tenantId: string, kind?: FlowKind) {
    const flows = await this.prisma.flow.findMany({
      where: { tenantId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { versions: { select: { version: true, publishedAt: true }, orderBy: { version: 'desc' }, take: 1 } },
    });
    return flows.map(({ versions, draftGraph, ...f }) => ({
      ...f,
      nodeCount: ((draftGraph as unknown as FlowGraph).nodes ?? []).length,
      latestVersion: versions[0]?.version ?? null,
      publishedAt: versions[0]?.publishedAt ?? null,
    }));
  }

  async get(tenantId: string, id: string) {
    const f = await this.prisma.flow.findFirst({ where: { id, tenantId } });
    if (!f) throw new NotFoundException('Fluxo não encontrado');
    return f;
  }

  create(tenantId: string, b: FlowBody) {
    return this.prisma.flow.create({
      data: {
        tenantId, name: b.name, kind: b.kind, description: b.description ?? null,
        draftGraph: (b.draftGraph ?? EMPTY_GRAPH) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, b: FlowBody) {
    await this.get(tenantId, id);
    return this.prisma.flow.update({
      where: { id },
      data: {
        name: b.name, description: b.description ?? null,
        ...(b.draftGraph ? { draftGraph: b.draftGraph as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const used = await this.prisma.webhookEndpoint.count({ where: { flowId: id } });
    if (used > 0) throw new ConflictException('O fluxo está em uso por um webhook');
    const asSub = await this.prisma.flow.findMany({ where: { tenantId, kind: 'PEDIDO' }, select: { name: true, draftGraph: true } });
    const ref = asSub.find((f) => JSON.stringify(f.draftGraph).includes(`"flowId":"${id}"`));
    if (ref) throw new ConflictException(`O subfluxo é usado pelo fluxo "${ref.name}"`);
    await this.prisma.flow.delete({ where: { id } });
  }

  /** Portas de um subfluxo (derivadas de "Entrada" e "Saída") — usadas para montar o bloco na paleta. */
  async ports(tenantId: string, id: string): Promise<{ inputs: PortDef[]; outputs: PortDef[] }> {
    const f = await this.get(tenantId, id);
    const g = f.draftGraph as unknown as FlowGraph;
    const entrada = g.nodes.find((n) => n.data.blockKey === 'sub.entrada');
    const saida = g.nodes.find((n) => n.data.blockKey === 'sub.saida');
    return { inputs: entrada?.data.outputs ?? [], outputs: saida?.data.inputs ?? [] };
  }

  private async graphFor(tenantId: string, flowId: string, override?: FlowGraph) {
    const f = await this.get(tenantId, flowId);
    const base = override ?? (f.draftGraph as unknown as FlowGraph);
    return { flow: f, graph: await this.engine.embedSubflows(base, tenantId) };
  }

  async validate(tenantId: string, id: string, override?: FlowGraph) {
    const { flow, graph } = await this.graphFor(tenantId, id, override);
    // subfluxos têm regras próprias (entrada/saída em vez de gatilho)
    const issues = flow.kind === 'SUBFLUXO' ? validateSubflowGraph(graph) : validateGraph(graph);
    return { valid: !issues.some((i) => i.level === 'error'), issues };
  }

  async publish(tenantId: string, id: string) {
    const { flow, graph } = await this.graphFor(tenantId, id);
    if (flow.kind === 'SUBFLUXO') {
      throw new UnprocessableEntityException('Subfluxos não são publicados: eles são embutidos nos fluxos que os usam');
    }
    const issues = validateGraph(graph);
    if (issues.some((i) => i.level === 'error')) {
      throw new UnprocessableEntityException({ message: 'O fluxo tem erros e não pode ser publicado', issues });
    }
    const last = await this.prisma.flowVersion.findFirst({ where: { flowId: id }, orderBy: { version: 'desc' } });
    const v = await this.prisma.flowVersion.create({
      data: { flowId: id, version: (last?.version ?? 0) + 1, graph: graph as unknown as Prisma.InputJsonValue },
    });
    return { id: v.id, version: v.version, publishedAt: v.publishedAt, issues };
  }

  async versions(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.flowVersion.findMany({
      where: { flowId: id }, orderBy: { version: 'desc' }, select: { id: true, version: true, publishedAt: true },
    });
  }

  /** Teste a seco (rascunho): não grava execução e não consome a numeração real da NF-e. */
  async dryRun(tenantId: string, id: string, body: RunBody) {
    const { flow, graph } = await this.graphFor(tenantId, id, body.graph);
    if (flow.kind === 'SUBFLUXO') throw new UnprocessableEntityException('Teste o subfluxo dentro de um fluxo de pedido');
    const issues = validateGraph(graph).filter((i) => i.level === 'error');
    if (issues.length) throw new UnprocessableEntityException({ message: 'O fluxo tem erros de validação', issues });
    const referenceDate = this.engine.referenceDateOf(body.payload);
    const ctx = await this.engine.buildContext(tenantId, referenceDate, { dryRun: true });
    return this.engine.run(graph, body.payload, ctx);
  }
}

@Controller('flows')
export class FlowsController {
  constructor(private readonly service: FlowsService) {}

  @Get() list(@TenantId() t: string, @Query('kind') kind?: string) {
    return this.service.list(t, kind === 'PEDIDO' || kind === 'SUBFLUXO' ? kind : undefined);
  }

  @Get(':id') get(@TenantId() t: string, @Param('id') id: string) {
    return this.service.get(t, id);
  }

  @Post() create(@TenantId() t: string, @Body(new ZodPipe(flowInputSchema)) b: FlowBody) {
    return this.service.create(t, b);
  }

  @Put(':id') update(@TenantId() t: string, @Param('id') id: string, @Body(new ZodPipe(flowInputSchema)) b: FlowBody) {
    return this.service.update(t, id, b);
  }

  @Delete(':id') @HttpCode(204) remove(@TenantId() t: string, @Param('id') id: string) {
    return this.service.remove(t, id);
  }

  @Get(':id/ports') ports(@TenantId() t: string, @Param('id') id: string) {
    return this.service.ports(t, id);
  }

  @Get(':id/versions') versions(@TenantId() t: string, @Param('id') id: string) {
    return this.service.versions(t, id);
  }

  @Post(':id/validate') @HttpCode(200) validate(@TenantId() t: string, @Param('id') id: string, @Body() b: { graph?: FlowGraph }) {
    return this.service.validate(t, id, b?.graph);
  }

  @Post(':id/publish') @HttpCode(201) publish(@TenantId() t: string, @Param('id') id: string) {
    return this.service.publish(t, id);
  }

  @Post(':id/run') @HttpCode(200) run(@TenantId() t: string, @Param('id') id: string, @Body(new ZodPipe(runFlowInputSchema)) b: RunBody) {
    return this.service.dryRun(t, id, b);
  }
}

@Module({ controllers: [FlowsController], providers: [FlowsService], exports: [FlowsService] })
export class FlowsModule {}
