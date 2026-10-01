import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Logger, Module, NotFoundException,
  Param, Post, Put, Res,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  getPath, renderTemplate, validatePayload, webhookInputSchema, type FlowGraph, type RequestSchemaDsl, type TraceEntry,
} from '@motor-fiscal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId, ZodPipe } from '../common/common';
import { EngineService } from '../engine/engine.service';

type WebhookBody = z.output<typeof webhookInputSchema>;

// ---------------------------------------------------------------------------
// Cadastro (admin)
// ---------------------------------------------------------------------------

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: { flow: { select: { name: true } }, _count: { select: { executions: true } } },
    });
    return rows.map(({ flow, _count, ...w }) => ({ ...w, flowName: flow.name, executionCount: _count.executions }));
  }

  async get(tenantId: string, id: string) {
    const w = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!w) throw new NotFoundException('Webhook não encontrado');
    return w;
  }

  private async assertFlow(tenantId: string, flowId: string) {
    const f = await this.prisma.flow.findFirst({ where: { id: flowId, tenantId } });
    if (!f) throw new BadRequestException('Fluxo não encontrado nesta empresa');
    if (f.kind !== 'PEDIDO') throw new BadRequestException('Escolha um fluxo de pedido (subfluxos não podem ser webhook)');
  }

  async create(tenantId: string, b: WebhookBody) {
    await this.assertFlow(tenantId, b.flowId);
    return this.prisma.webhookEndpoint.create({
      data: {
        tenantId, name: b.name, slug: b.slug, description: b.description ?? null, flowId: b.flowId,
        requestSchema: b.requestSchema as unknown as Prisma.InputJsonValue,
        responseTemplate: b.responseTemplate as Prisma.InputJsonValue,
        token: b.token ?? null, active: b.active, config: b.config as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, b: WebhookBody) {
    await this.get(tenantId, id);
    await this.assertFlow(tenantId, b.flowId);
    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        name: b.name, slug: b.slug, description: b.description ?? null, flowId: b.flowId,
        requestSchema: b.requestSchema as unknown as Prisma.InputJsonValue,
        responseTemplate: b.responseTemplate as Prisma.InputJsonValue,
        token: b.token ?? null, active: b.active, config: b.config as Prisma.InputJsonValue,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
  }
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Get() list(@TenantId() t: string) {
    return this.service.list(t);
  }

  @Get(':id') get(@TenantId() t: string, @Param('id') id: string) {
    return this.service.get(t, id);
  }

  @Post() create(@TenantId() t: string, @Body(new ZodPipe(webhookInputSchema)) b: WebhookBody) {
    return this.service.create(t, b);
  }

  @Put(':id') update(@TenantId() t: string, @Param('id') id: string, @Body(new ZodPipe(webhookInputSchema)) b: WebhookBody) {
    return this.service.update(t, id, b);
  }

  @Delete(':id') @HttpCode(204) remove(@TenantId() t: string, @Param('id') id: string) {
    return this.service.remove(t, id);
  }
}

// ---------------------------------------------------------------------------
// Receptor público: POST /webhook/:slug
// ---------------------------------------------------------------------------

/** Erros de negócio (dados do pedido/empresa) respondem 422; o resto é falha nossa (500). */
const BUSINESS_ERROR_CODES = new Set([
  'PEDIDO_INVALIDO', 'SEM_RBT12', 'RBT12_EXCEDIDA', 'ENTRADA_INVALIDA', 'ENTRADA_AUSENTE', 'CONDICAO_INVALIDA',
]);

interface HandleResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

const erro = (codigo: string, mensagem: string, detalhes?: unknown) => ({
  erro: { codigo, mensagem, ...(detalhes !== undefined ? { detalhes } : {}) },
});

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

@Injectable()
export class WebhookReceiverService {
  private readonly log = new Logger('Webhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  async handle(slug: string, body: unknown, headers: Record<string, string | string[] | undefined>): Promise<HandleResult> {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { slug } });
    if (!endpoint) return { status: 404, body: erro('WEBHOOK_NAO_ENCONTRADO', `Não existe webhook "${slug}"`), headers: {} };
    if (!endpoint.active) return { status: 404, body: erro('WEBHOOK_INATIVO', 'Este webhook está desativado'), headers: {} };

    if (endpoint.token) {
      const given = headers['x-webhook-token'];
      if (typeof given !== 'string' || !safeEqual(given, endpoint.token)) {
        return { status: 401, body: erro('TOKEN_INVALIDO', 'Token inválido ou ausente (header X-Webhook-Token)'), headers: {} };
      }
    }

    const config = (endpoint.config ?? {}) as { dateField?: string; idempotencyField?: string };
    const parsed = validatePayload(endpoint.requestSchema as unknown as RequestSchemaDsl, body);
    if (!parsed.success) {
      const out = erro('PAYLOAD_INVALIDO', 'O payload não atende ao schema do webhook', parsed.issues);
      const ex = await this.prisma.execution.create({
        data: {
          tenantId: endpoint.tenantId, webhookId: endpoint.id, flowId: endpoint.flowId, status: 'ERRO',
          input: (body ?? null) as Prisma.InputJsonValue, output: out as Prisma.InputJsonValue,
          error: { codigo: 'PAYLOAD_INVALIDO', issues: parsed.issues } as unknown as Prisma.InputJsonValue, httpStatus: 422,
        },
      });
      return { status: 422, body: { ...out, executionId: ex.id }, headers: { 'x-execution-id': ex.id } };
    }
    const payload = parsed.data;

    // idempotência: header tem prioridade sobre o campo configurado
    const headerKey = headers['idempotency-key'];
    const fieldKey = config.idempotencyField ? getPath(payload, config.idempotencyField) : undefined;
    const idemKey = (typeof headerKey === 'string' && headerKey) || (fieldKey !== undefined && fieldKey !== null ? String(fieldKey) : null);

    let execId: string;
    try {
      const ex = await this.prisma.execution.create({
        data: {
          tenantId: endpoint.tenantId, webhookId: endpoint.id, flowId: endpoint.flowId, idempotencyKey: idemKey,
          status: 'EXECUTANDO', input: payload as Prisma.InputJsonValue,
        },
      });
      execId = ex.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && idemKey) {
        const existing = await this.prisma.execution.findFirst({ where: { webhookId: endpoint.id, idempotencyKey: idemKey } });
        if (existing && existing.status !== 'EXECUTANDO') {
          return {
            status: existing.httpStatus ?? 200,
            body: existing.output ?? {},
            headers: { 'x-execution-id': existing.id, 'idempotent-replay': 'true' },
          };
        }
        return {
          status: 409,
          body: erro('EXECUCAO_EM_ANDAMENTO', 'Já existe uma execução em andamento com esta chave de idempotência'),
          headers: existing ? { 'x-execution-id': existing.id } : {},
        };
      }
      throw e;
    }

    const finish = async (
      status: 'OK' | 'ERRO' | 'REJEITADA', httpStatus: number, out: unknown,
      extra: { trace?: TraceEntry[]; error?: unknown; durationMs?: number; flowVersionId?: string } = {},
    ): Promise<HandleResult> => {
      await this.prisma.execution.update({
        where: { id: execId },
        data: {
          status, httpStatus, output: out as Prisma.InputJsonValue,
          trace: (extra.trace ?? []) as unknown as Prisma.InputJsonValue,
          ...(extra.error !== undefined ? { error: extra.error as Prisma.InputJsonValue } : {}),
          durationMs: extra.durationMs ?? 0,
          ...(extra.flowVersionId ? { flowVersionId: extra.flowVersionId } : {}),
        },
      });
      return { status: httpStatus, body: out, headers: { 'x-execution-id': execId } };
    };

    try {
      const version = await this.prisma.flowVersion.findFirst({ where: { flowId: endpoint.flowId }, orderBy: { version: 'desc' } });
      if (!version) {
        return finish('ERRO', 409, { ...erro('FLUXO_NAO_PUBLICADO', 'O fluxo deste webhook ainda não tem versão publicada'), executionId: execId });
      }
      const referenceDate = this.engine.referenceDateOf(payload, config.dateField);
      const ctx = await this.engine.buildContext(endpoint.tenantId, referenceDate);
      const result = await this.engine.run(version.graph as unknown as FlowGraph, payload, ctx);
      const common = { trace: result.trace, durationMs: result.durationMs, flowVersionId: version.id };

      if (result.status === 'OK') {
        const scope = { input: payload, nodes: result.nodes, execution: { id: execId, status: 'OK' } };
        const out = renderTemplate(endpoint.responseTemplate, scope);
        return finish('OK', 200, out, common);
      }
      if (result.status === 'REJEITADA') {
        const d = result.error?.details as { cStat?: string; xMotivo?: string } | undefined;
        return finish('REJEITADA', 422, { ...erro('NFE_REJEITADA', result.error!.message, d), executionId: execId }, { ...common, error: result.error });
      }
      const business = BUSINESS_ERROR_CODES.has(result.error?.code ?? '');
      return finish(
        'ERRO', business ? 422 : 500,
        { ...erro(result.error?.code ?? 'ERRO_FLUXO', result.error?.message ?? 'Falha na execução do fluxo', result.error?.details), executionId: execId },
        { ...common, error: result.error },
      );
    } catch (e) {
      this.log.error(`Falha inesperada no webhook ${slug}`, e instanceof Error ? e.stack : String(e));
      return finish('ERRO', 500, { ...erro('ERRO_INTERNO', 'Erro interno ao processar o webhook'), executionId: execId }, { error: { message: String((e as Error)?.message ?? e) } });
    }
  }
}

@Controller('webhook')
export class WebhookReceiverController {
  constructor(private readonly receiver: WebhookReceiverService) {}

  @Post(':slug')
  @HttpCode(200)
  async receive(
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.receiver.handle(slug, body, headers);
    res.status(r.status);
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    return r.body;
  }
}

@Module({
  controllers: [WebhooksController, WebhookReceiverController],
  providers: [WebhooksService, WebhookReceiverService],
})
export class WebhooksModule {}
