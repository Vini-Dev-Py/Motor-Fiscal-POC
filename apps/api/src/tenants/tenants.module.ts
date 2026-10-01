import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, Put,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { crtFromRegime, tenantInputSchema, onlyDocChars } from '@motor-fiscal/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ZodPipe } from '../common/common';

type TenantBody = z.output<typeof tenantInputSchema>;

const present = (t: Prisma.TenantGetPayload<object>) => ({ ...t, rbt12: t.rbt12 ? t.rbt12.toFixed(2) : null });

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(present);
  }

  async get(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Empresa não encontrada');
    return present(t);
  }

  async create(b: TenantBody) {
    const cnpj = onlyDocChars(b.cnpj);
    if (await this.prisma.tenant.findUnique({ where: { cnpj } })) throw new ConflictException('Já existe uma empresa com este CNPJ');
    const t = await this.prisma.tenant.create({
      data: {
        cnpj, razaoSocial: b.razaoSocial, ie: b.ie ?? null, uf: b.uf, codMunicipio: b.codMunicipio, regime: b.regime,
        crt: crtFromRegime(b.regime), rbt12: b.rbt12 ?? null, config: b.config as Prisma.InputJsonValue,
      },
    });
    return present(t);
  }

  async update(id: string, b: TenantBody) {
    await this.get(id);
    const cnpj = onlyDocChars(b.cnpj);
    const other = await this.prisma.tenant.findUnique({ where: { cnpj } });
    if (other && other.id !== id) throw new ConflictException('Já existe uma empresa com este CNPJ');
    const t = await this.prisma.tenant.update({
      where: { id },
      data: {
        cnpj, razaoSocial: b.razaoSocial, ie: b.ie ?? null, uf: b.uf, codMunicipio: b.codMunicipio, regime: b.regime,
        crt: crtFromRegime(b.regime), rbt12: b.rbt12 ?? null, config: b.config as Prisma.InputJsonValue,
      },
    });
    return present(t);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.tenant.delete({ where: { id } });
  }
}

@Controller('tenants')
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @Get() list() {
    return this.service.list();
  }

  @Get(':id') get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post() create(@Body(new ZodPipe(tenantInputSchema)) body: TenantBody) {
    return this.service.create(body);
  }

  @Put(':id') update(@Param('id') id: string, @Body(new ZodPipe(tenantInputSchema)) body: TenantBody) {
    return this.service.update(id, body);
  }

  @Delete(':id') @HttpCode(204) remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({ controllers: [TenantsController], providers: [TenantsService], exports: [TenantsService] })
export class TenantsModule {}
