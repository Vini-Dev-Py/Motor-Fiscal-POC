import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InMemoryTables, MockBoletoGateway, MockSefazGateway, InMemoryNumeracao, runFlow,
  type EngineContext, type FlowRunResult, type Numeracao, type OverrideEntry, type RefRow,
} from '@motor-fiscal/engine';
import {
  getPath, type FlowGraph, type FlowNode, type Regime, type TenantInfo, type UF,
} from '@motor-fiscal/shared';
import { PrismaService } from '../prisma/prisma.service';
import { today } from '../common/common';
import { IsolatedVmRunner } from './sandbox';

/** Numeração da NF-e no banco: incremento atômico por empresa (a POC usa uma sequência só). */
class DbNumeracao implements Numeracao {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: string,
  ) {}

  async next(): Promise<number> {
    const t = await this.prisma.tenant.update({
      where: { id: this.tenantId },
      data: { nfeProximoNumero: { increment: 1 } },
      select: { nfeProximoNumero: true },
    });
    return t.nfeProximoNumero - 1;
  }
}

@Injectable()
export class EngineService {
  readonly runner = new IsolatedVmRunner();
  private readonly sefaz = new MockSefazGateway();
  private readonly boleto = new MockBoletoGateway();

  constructor(private readonly prisma: PrismaService) {}

  async loadTenantInfo(tenantId: string): Promise<TenantInfo> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException(`Empresa ${tenantId} não encontrada`);
    return {
      id: t.id,
      cnpj: t.cnpj,
      razaoSocial: t.razaoSocial,
      ie: t.ie,
      uf: t.uf as UF,
      codMunicipio: t.codMunicipio,
      regime: t.regime as Regime,
      crt: t.crt as 1 | 2 | 3,
      rbt12: t.rbt12 ? t.rbt12.toFixed(2) : null,
      config: (t.config ?? {}) as TenantInfo['config'],
    };
  }

  async loadTables(tenantId: string): Promise<InMemoryTables> {
    const rows = await this.prisma.referenceRow.findMany({ where: { OR: [{ tenantId: null }, { tenantId }] } });
    const refRows: RefRow[] = rows.map((r) => ({
      table: r.table,
      keys: r.keys as Record<string, string>,
      value: r.value as Record<string, unknown>,
      validFrom: r.validFrom,
      validTo: r.validTo,
      tenantSpecific: r.tenantId !== null,
    }));
    return new InMemoryTables(refRows);
  }

  async loadOverrides(tenantId: string): Promise<OverrideEntry[]> {
    const rows = await this.prisma.blockOverride.findMany({ where: { tenantId, active: true } });
    return rows.map((o) => ({
      id: o.id,
      blockKey: o.blockKey,
      name: o.name,
      code: o.code,
      params: o.params as Record<string, unknown>,
      validFrom: o.validFrom,
      validTo: o.validTo,
      legalBasis: o.legalBasis,
      active: o.active,
    }));
  }

  /** Contexto de execução do motor para a empresa. `dryRun` não consome a numeração real da NF-e. */
  async buildContext(tenantId: string, referenceDate: string, opts: { dryRun?: boolean } = {}): Promise<EngineContext> {
    const [tenant, tables, overrides] = await Promise.all([
      this.loadTenantInfo(tenantId),
      this.loadTables(tenantId),
      this.loadOverrides(tenantId),
    ]);
    return {
      tenant,
      tables,
      overrides,
      referenceDate,
      runner: this.runner,
      services: {
        sefaz: this.sefaz,
        boleto: this.boleto,
        numeracao: opts.dryRun ? new InMemoryNumeracao(1) : new DbNumeracao(this.prisma, tenantId),
      },
    };
  }

  /** Data de vigência: campo configurado do payload (padrão dataEmissao) ou hoje. */
  referenceDateOf(payload: unknown, dateField = 'dataEmissao'): string {
    const v = getPath(payload, dateField);
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : today();
  }

  /**
   * Embute no grafo os subfluxos referenciados (recursivamente). A versão publicada fica autocontida:
   * mudar um subfluxo depois não altera fluxos já publicados.
   */
  async embedSubflows(graph: FlowGraph, tenantId: string): Promise<FlowGraph> {
    const subflows: NonNullable<FlowGraph['subflows']> = {};
    const pending: FlowNode[][] = [graph.nodes];
    let guard = 0;
    while (pending.length && guard++ < 50) {
      const nodes = pending.pop()!;
      for (const id of new Set(nodes.map((n) => n.data.flowId).filter((x): x is string => !!x))) {
        if (subflows[id]) continue;
        const f = await this.prisma.flow.findFirst({ where: { id, tenantId, kind: 'SUBFLUXO' } });
        if (!f) continue; // validateGraph reporta o subfluxo ausente
        const g = f.draftGraph as unknown as FlowGraph;
        subflows[id] = { nodes: g.nodes ?? [], edges: g.edges ?? [], name: f.name };
        pending.push(g.nodes ?? []);
      }
    }
    return { nodes: graph.nodes, edges: graph.edges, subflows };
  }

  run(graph: FlowGraph, payload: unknown, ctx: EngineContext): Promise<FlowRunResult> {
    return runFlow({ graph, payload, ctx });
  }
}
