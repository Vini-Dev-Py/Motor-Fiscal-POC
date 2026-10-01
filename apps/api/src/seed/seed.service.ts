import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NOME_SUBFLUXO_IMPOSTOS, buildImpostosItemGraph, buildPedidoGraph, buildReferenceRows, validateGraph,
} from '@motor-fiscal/engine';
import {
  EXEMPLO_REQUEST_SCHEMA, EXEMPLO_RESPONSE_TEMPLATE, cnpjWithDv, type FlowGraph, type Regime,
} from '@motor-fiscal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';

interface DemoTenant {
  cnpj: string;
  razaoSocial: string;
  ie: string;
  uf: string;
  codMunicipio: string;
  regime: Regime;
  crt: number;
  rbt12?: string;
  config: Record<string, unknown>;
  slug: string;
  webhookName: string;
}

const DEMO_TENANTS: DemoTenant[] = [
  {
    cnpj: '11222333000181', razaoSocial: 'Vinícius Distribuidora Ltda', ie: '110042490114', uf: 'SP', codMunicipio: '3550308',
    regime: 'PRESUMIDO', crt: 3, config: { boleto: { banco: '341', agencia: '1234', conta: '123456', carteira: '109', beneficiario: 'Vinícius Distribuidora Ltda' } },
    slug: 'calcular-nota-vinicius', webhookName: 'Calcular nota — Vinícius',
  },
  {
    cnpj: cnpjWithDv('456789120001'), razaoSocial: 'Loja Simples ME', ie: '0620000000001', uf: 'MG', codMunicipio: '3106200',
    regime: 'SIMPLES', crt: 1, rbt12: '300000.00', config: { anexoSimples: 'I', boleto: { banco: '001', agencia: '4321', conta: '654321', carteira: '17', beneficiario: 'Loja Simples ME' } },
    slug: 'calcular-nota-loja-simples', webhookName: 'Calcular nota — Loja Simples',
  },
  {
    cnpj: cnpjWithDv('987654320001'), razaoSocial: 'Indústria Liminar S/A', ie: '9000000000', uf: 'PR', codMunicipio: '4106902',
    regime: 'REAL', crt: 3, config: { boleto: { banco: '033', agencia: '0101', conta: '998877', carteira: '101', beneficiario: 'Indústria Liminar S/A' } },
    slug: 'calcular-nota-industria', webhookName: 'Calcular nota — Indústria (liminar)',
  },
];

/** Dados de demonstração: 3 empresas, fluxos publicados, webhooks e um override judicial. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger('Seed');

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.SEED_ON_START === 'true') {
      const r = await this.run();
      this.log.log(r.seeded ? 'Dados de demonstração criados' : 'Banco já tem dados: seed ignorado');
    }
  }

  /** Só semeia quando o banco está vazio (idempotente). */
  async run(): Promise<{ seeded: boolean }> {
    if ((await this.prisma.tenant.count()) > 0) return { seeded: false };

    const rows = buildReferenceRows();
    await this.prisma.referenceRow.createMany({
      data: rows.map((r) => ({
        tenantId: null, table: r.table, keys: r.keys, value: r.value as Prisma.InputJsonValue, validFrom: r.validFrom, validTo: r.validTo ?? null,
      })),
    });
    this.log.log(`${rows.length} linhas de referência`);

    for (const d of DEMO_TENANTS) await this.seedTenant(d);
    return { seeded: true };
  }

  private async seedTenant(d: DemoTenant) {
    const tenant = await this.prisma.tenant.create({
      data: {
        cnpj: d.cnpj, razaoSocial: d.razaoSocial, ie: d.ie, uf: d.uf, codMunicipio: d.codMunicipio, regime: d.regime, crt: d.crt,
        rbt12: d.rbt12 ?? null, config: d.config as Prisma.InputJsonValue,
      },
    });

    const sub = await this.prisma.flow.create({
      data: {
        tenantId: tenant.id, name: NOME_SUBFLUXO_IMPOSTOS, kind: 'SUBFLUXO',
        description: 'Calcula todos os impostos de um item (ramifica por regime tributário).',
        draftGraph: buildImpostosItemGraph() as unknown as Prisma.InputJsonValue,
      },
    });
    const draft = buildPedidoGraph(sub.id);
    const flow = await this.prisma.flow.create({
      data: {
        tenantId: tenant.id, name: 'Pedido padrão', kind: 'PEDIDO',
        description: 'Webhook → impostos por item → totais → NF-e → SEFAZ → boletos.',
        draftGraph: draft as unknown as Prisma.InputJsonValue,
      },
    });

    const embedded: FlowGraph = await this.engine.embedSubflows(draft, tenant.id);
    const errors = validateGraph(embedded).filter((i) => i.level === 'error');
    if (errors.length) throw new Error(`Fluxo padrão inválido: ${errors.map((e) => e.message).join('; ')}`);
    await this.prisma.flowVersion.create({ data: { flowId: flow.id, version: 1, graph: embedded as unknown as Prisma.InputJsonValue } });

    await this.prisma.webhookEndpoint.create({
      data: {
        tenantId: tenant.id, name: d.webhookName, slug: d.slug,
        description: 'Recebe o pedido do sistema X, calcula impostos, emite a NF-e e gera os boletos.',
        flowId: flow.id,
        requestSchema: EXEMPLO_REQUEST_SCHEMA as unknown as Prisma.InputJsonValue,
        responseTemplate: EXEMPLO_RESPONSE_TEMPLATE as Prisma.InputJsonValue,
        config: { dateField: 'dataEmissao', idempotencyField: 'id' },
      },
    });

    if (d.regime === 'REAL') {
      await this.prisma.blockOverride.create({
        data: {
          tenantId: tenant.id, blockKey: 'tax.icms', name: 'Liminar — redução de 50% na base do ICMS',
          params: { pRedBC: 50 }, validFrom: '2025-01-01', active: true,
          legalBasis: 'Mandado de Segurança nº 5001234-56.2025.4.04.7000 (liminar deferida) — redução de 50% da base de cálculo do ICMS',
        },
      });
    }
    this.log.log(`Empresa "${d.razaoSocial}" criada · webhook /webhook/${d.slug}`);
  }
}

@Module({ providers: [SeedService], exports: [SeedService] })
export class SeedModule {}
