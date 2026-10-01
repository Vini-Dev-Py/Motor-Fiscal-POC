import { Controller, Get, Module, NotFoundException, Param, Query } from '@nestjs/common';
import type { ExecStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/common';

const STATUSES = ['EXECUTANDO', 'OK', 'ERRO', 'REJEITADA'];

@Controller('executions')
export class ExecutionsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista resumida (sem trace nem payloads grandes). */
  @Get()
  async list(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
    @Query('webhookId') webhookId?: string,
    @Query('status') status?: string,
  ) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.prisma.execution.findMany({
      where: {
        tenantId,
        ...(webhookId ? { webhookId } : {}),
        ...(status && STATUSES.includes(status) ? { status: status as ExecStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, status: true, httpStatus: true, durationMs: true, createdAt: true, idempotencyKey: true,
        webhook: { select: { id: true, name: true, slug: true } },
        flowVersion: { select: { version: true } },
        error: true,
      },
    });
    return rows.map(({ flowVersion, ...r }) => ({ ...r, flowVersion: flowVersion?.version ?? null }));
  }

  @Get(':id')
  async get(@TenantId() tenantId: string, @Param('id') id: string) {
    const e = await this.prisma.execution.findFirst({
      where: { id, tenantId },
      include: { webhook: { select: { id: true, name: true, slug: true } }, flowVersion: { select: { version: true } } },
    });
    if (!e) throw new NotFoundException('Execução não encontrada');
    return e;
  }
}

@Module({ controllers: [ExecutionsController] })
export class ExecutionsModule {}
