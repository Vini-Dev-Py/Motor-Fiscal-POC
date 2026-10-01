import type { z } from 'zod';
import type {
  BlockCategory, FlowGraph, PortDef, TenantInfo, TraceEntry, UF,
} from '@motor-fiscal/shared';
import type { Dec } from './money';
import type { TableProvider } from './tables';

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export class BlockError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'BLOCK_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BlockError';
  }
}

/** Rejeição fiscal (ex.: SEFAZ rejeitou a NF-e). Gera execução com status REJEITADA. */
export class FiscalRejection extends BlockError {
  constructor(
    public readonly cStat: string,
    public readonly xMotivo: string,
  ) {
    super(`Rejeição ${cStat}: ${xMotivo}`, 'SEFAZ_REJEICAO', { cStat, xMotivo });
    this.name = 'FiscalRejection';
  }
}

// ---------------------------------------------------------------------------
// Serviços externos (adapters — na POC são mocks)
// ---------------------------------------------------------------------------

export interface Autorizacao {
  autorizada: boolean;
  cStat: string;
  xMotivo: string;
  nProt?: string;
  dhRecbto: string;
  chave: string;
  ambiente: 'homologacao' | 'producao';
  mock: boolean;
}

export interface SefazRequest {
  xml: string;
  chave: string;
  tenant: TenantInfo;
  destinatarioDocumento: string;
  vNF: string;
  somaBcIcmsItens: string;
  totalBcIcms: string;
}

export interface SefazGateway {
  autorizar(req: SefazRequest): Promise<Autorizacao>;
}

export interface BoletoRequest {
  tenant: TenantInfo;
  pagador: { nome: string; documento: string; uf?: string };
  numeroDocumento: string;
  parcela: number;
  vencimento: string;
  valor: string;
  config: { banco: string; agencia: string; conta: string; carteira: string; beneficiario: string };
}

export interface Boleto {
  numeroDocumento: string;
  parcela: number;
  nossoNumero: string;
  codigoBarras: string;
  linhaDigitavel: string;
  vencimento: string;
  valor: string;
  banco: string;
  pagador: { nome: string; documento: string };
  beneficiario: string;
  mock: boolean;
}

export interface BoletoGateway {
  emitir(req: BoletoRequest): Promise<Boleto>;
}

export interface Numeracao {
  /** Próximo número de NF-e da série (deve ser atômico). */
  next(serie: number): Promise<number>;
}

export interface Services {
  sefaz: SefazGateway;
  boleto: BoletoGateway;
  numeracao: Numeracao;
}

// ---------------------------------------------------------------------------
// Sandbox de código (override e blocos de código)
// ---------------------------------------------------------------------------

export interface CodeRunRequest {
  code: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  /** Consulta às tabelas de referência, exposta ao código como `tabela(nome, chaves)`. */
  tabela: (nome: string, chaves: Record<string, string>) => unknown;
  limits?: { timeoutMs?: number; memoryMb?: number };
}

/**
 * Executa código do usuário de forma isolada. Na POC existe o runner JavaScript (isolated-vm,
 * na API); um runner Python entra depois implementando a mesma interface.
 */
export interface CodeRunner {
  readonly language: 'javascript' | 'python';
  run(req: CodeRunRequest): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export interface OverrideEntry {
  id: string;
  blockKey: string;
  name: string;
  /** Sem código = override só de parâmetros. */
  code?: string | null;
  params?: Record<string, unknown>;
  validFrom: string;
  validTo?: string | null;
  legalBasis?: string | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Bloco
// ---------------------------------------------------------------------------

export interface BlockRunCtx {
  tenant: TenantInfo;
  tables: TableProvider;
  services: Services;
  /** Data que define a vigência de tabelas e overrides (normalmente a data de emissão). */
  referenceDate: string;
  D: (v: unknown) => Dec;
  log: (msg: string) => void;
  /** Payload do webhook (só existe no fluxo raiz). */
  payload: unknown;
  /** Executa código do usuário no sandbox (runner configurado no contexto da engine). */
  runCode: (code: string, inputs: Record<string, unknown>, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Executa um subfluxo embutido no grafo e devolve as saídas (portas da sub.saida). */
  runSubflow: (flowId: string, inputs: Record<string, unknown>, label?: string) => Promise<Record<string, unknown>>;
}

export interface BlockDef<P = any> {
  key: string;
  version: number;
  label: string;
  category: BlockCategory;
  description: string;
  /** Fórmula documentada em texto. */
  formula?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Esquema dos parâmetros; `parse({})` deve funcionar (valores padrão). */
  params: z.ZodType<P>;
  /** Bloco de ramificação: devolve `__ativo` com o id da porta de saída ativa. */
  branching?: boolean;
  overridable?: boolean;
  dynamicPorts?: 'codigo' | 'entrada' | 'saida' | 'subfluxo';
  run(args: {
    inputs: Record<string, any>;
    params: P;
    ctx: BlockRunCtx;
  }): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function defineBlock<P>(def: BlockDef<P>): BlockDef<P> {
  return def;
}

// ---------------------------------------------------------------------------
// Execução do fluxo
// ---------------------------------------------------------------------------

export interface EngineContext {
  tenant: TenantInfo;
  tables: TableProvider;
  services: Services;
  runner?: CodeRunner;
  overrides?: OverrideEntry[];
  /** AAAA-MM-DD — vigência de tabelas e overrides. */
  referenceDate: string;
  /** Limite de segurança de nós executados por chamada (inclui subfluxos). */
  maxNodeRuns?: number;
}

export interface FlowRunResult {
  status: 'OK' | 'ERRO' | 'REJEITADA';
  /** Saídas de cada nó do fluxo raiz: nodeId -> { porta: valor }. */
  nodes: Record<string, Record<string, unknown>>;
  trace: TraceEntry[];
  error?: { message: string; code?: string; nodeId?: string; details?: unknown };
  durationMs: number;
}

export interface RunFlowOptions {
  graph: FlowGraph;
  payload: unknown;
  ctx: EngineContext;
}

// Domínio usado pelos blocos -------------------------------------------------

export interface Operacao {
  ufOrigem: UF;
  ufDestino: UF;
  /** 1 interna · 2 interestadual · 3 exterior */
  idDest: 1 | 2 | 3;
  interestadual: boolean;
  consumidorFinal: boolean;
  contribuinte: boolean;
  indIEDest: number;
  dataEmissao: string;
  ano: number;
  cfop: string;
}

export interface Contexto {
  tenant: TenantInfo;
  operacao: Operacao;
  destinatario: {
    nome: string;
    documento: string;
    uf: UF;
    ie?: string;
    codMunicipio?: string;
  };
}

export interface ItemNormalizado {
  nItem: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop?: string;
  origem: number;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  vProd: string;
  vDesc: string;
  vFrete: string;
  vSeg: string;
  vOutro: string;
}
