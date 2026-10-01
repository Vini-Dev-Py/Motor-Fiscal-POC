import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, Post, Put, Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { REFERENCE_TABLES } from '@motor-fiscal/engine';
import { referenceRowInputSchema } from '@motor-fiscal/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId, ZodPipe } from '../common/common';

type RowBody = z.output<typeof referenceRowInputSchema>;

@Controller()
export class ReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('reference-tables')
  async tables(@TenantId() tenantId: string) {
    const counts = await this.prisma.referenceRow.groupBy({
      by: ['table'], where: { OR: [{ tenantId: null }, { tenantId }] }, _count: { _all: true },
    });
    const byTable = new Map(counts.map((c) => [c.table, c._count._all]));
    return REFERENCE_TABLES.map((t) => ({ ...t, rowCount: byTable.get(t.key) ?? 0 }));
  }

  @Get('reference-rows')
  async rows(@TenantId() tenantId: string, @Query('table') table?: string) {
    if (!table) throw new BadRequestException('Informe a tabela (?table=)');
    const rows = await this.prisma.referenceRow.findMany({
      where: { table, OR: [{ tenantId: null }, { tenantId }] },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(({ tenantId: tid, ...r }) => ({ ...r, tenantSpecific: tid !== null }));
  }

  @Post('reference-rows')
  async create(@TenantId() tenantId: string, @Body(new ZodPipe(referenceRowInputSchema)) b: RowBody) {
    this.assertTable(b.table);
    const r = await this.prisma.referenceRow.create({
      data: {
        tenantId: b.tenantSpecific ? tenantId : null, table: b.table, keys: b.keys, value: b.value as Prisma.InputJsonValue,
        validFrom: b.validFrom, validTo: b.validTo ?? null, note: b.note ?? null,
      },
    });
    return r;
  }

  @Put('reference-rows/:id')
  async update(@TenantId() tenantId: string, @Param('id') id: string, @Body(new ZodPipe(referenceRowInputSchema)) b: RowBody) {
    await this.find(tenantId, id);
    this.assertTable(b.table);
    return this.prisma.referenceRow.update({
      where: { id },
      data: {
        tenantId: b.tenantSpecific ? tenantId : null, table: b.table, keys: b.keys, value: b.value as Prisma.InputJsonValue,
        validFrom: b.validFrom, validTo: b.validTo ?? null, note: b.note ?? null,
      },
    });
  }

  @Delete('reference-rows/:id') @HttpCode(204)
  async remove(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.find(tenantId, id);
    await this.prisma.referenceRow.delete({ where: { id } });
  }

  private assertTable(table: string) {
    if (!REFERENCE_TABLES.some((t) => t.key === table)) throw new BadRequestException(`Tabela desconhecida: ${table}`);
  }

  private async find(tenantId: string, id: string) {
    const r = await this.prisma.referenceRow.findFirst({ where: { id, OR: [{ tenantId: null }, { tenantId }] } });
    if (!r) throw new NotFoundException('Linha não encontrada');
    return r;
  }
}

@Module({ controllers: [ReferenceController] })
export class ReferenceModule {}
