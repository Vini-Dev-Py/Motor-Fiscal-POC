import { z } from 'zod';
import { UFS, isValidCnpj, isValidCnpjOrCpf, isValidNcm, type UF } from './br-validators';
import { decimalSchema, type PortDef } from './ports';

// ---------------------------------------------------------------------------
// Empresa (tenant)
// ---------------------------------------------------------------------------

export const REGIMES = ['SIMPLES', 'PRESUMIDO', 'REAL'] as const;
export type Regime = (typeof REGIMES)[number];

export const REGIME_LABELS: Record<Regime, string> = {
  SIMPLES: 'Simples Nacional',
  PRESUMIDO: 'Lucro Presumido',
  REAL: 'Lucro Real',
};

/** Dados fiscais da empresa usados pelos blocos. */
export interface TenantInfo {
  id: string;
  cnpj: string;
  razaoSocial: string;
  ie?: string | null;
  uf: UF;
  codMunicipio: string;
  regime: Regime;
  /** Código de Regime Tributário da NF-e: 1 Simples, 2 Simples (excesso), 3 Regime normal. */
  crt: 1 | 2 | 3;
  /** Receita bruta dos últimos 12 meses (Simples Nacional). */
  rbt12?: string | null;
  config?: TenantConfig;
}

export interface TenantConfig {
  anexoSimples?: 'I' | 'II';
  boleto?: {
    banco?: string;
    agencia?: string;
    conta?: string;
    carteira?: string;
    beneficiario?: string;
  };
  [extra: string]: unknown;
}

export const tenantInputSchema = z.object({
  cnpj: z.string().refine(isValidCnpj, 'CNPJ inválido'),
  razaoSocial: z.string().min(2, 'Informe a razão social'),
  ie: z.string().optional().nullable(),
  uf: z.enum(UFS),
  codMunicipio: z.string().regex(/^\d{7}$/, 'Código IBGE do município: 7 dígitos'),
  regime: z.enum(REGIMES),
  rbt12: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === null || v === '' ? null : String(v))),
  config: z
    .object({
      anexoSimples: z.enum(['I', 'II']).optional(),
      boleto: z
        .object({
          banco: z.string().regex(/^\d{3}$/, 'Banco: 3 dígitos').optional(),
          agencia: z.string().optional(),
          conta: z.string().optional(),
          carteira: z.string().optional(),
          beneficiario: z.string().optional(),
        })
        .optional(),
    })
    .passthrough()
    .default({}),
});
export type TenantInput = z.input<typeof tenantInputSchema>;

export const crtFromRegime = (r: Regime): 1 | 2 | 3 => (r === 'SIMPLES' ? 1 : 3);

// ---------------------------------------------------------------------------
// Pedido canônico (o que os blocos fiscais entendem)
// ---------------------------------------------------------------------------

const money = decimalSchema.default('0');

export const pedidoItemSchema = z.object({
  codigo: z.string().min(1),
  descricao: z.string().min(1),
  ncm: z.string().refine(isValidNcm, 'NCM inválido (8 dígitos)'),
  cfop: z.string().regex(/^[1-7]\d{3}$/).optional(),
  origem: z.number().int().min(0).max(8).default(0),
  unidade: z.string().default('UN'),
  quantidade: decimalSchema,
  valorUnitario: decimalSchema,
  desconto: money,
  frete: money,
  seguro: money,
  outrasDespesas: money,
});

export const pedidoSchema = z.object({
  id: z.string().min(1),
  dataEmissao: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Data inválida (AAAA-MM-DD)'),
  naturezaOperacao: z.string().default('Venda de mercadoria'),
  destinatario: z.object({
    nome: z.string().min(1),
    documento: z.string().refine(isValidCnpjOrCpf, 'CNPJ/CPF inválido'),
    uf: z.enum(UFS),
    codMunicipio: z.string().regex(/^\d{7}$/).optional(),
    ie: z.string().optional(),
    /** 1 contribuinte ICMS · 2 isento · 9 não contribuinte */
    indIEDest: z.number().int().refine((n) => [1, 2, 9].includes(n), 'Use 1, 2 ou 9').default(9),
    consumidorFinal: z.boolean().default(true),
  }),
  itens: z.array(pedidoItemSchema).min(1, 'O pedido precisa de ao menos um item'),
  pagamento: z
    .object({
      /** "0" = à vista · "30/60/90" = parcelas com prazos em dias. */
      condicao: z.string().regex(/^\d+(\/\d+)*$/, 'Use o formato 30/60/90').default('0'),
      primeiroVencimento: z.string().optional(),
      meio: z.string().default('15'),
    })
    .default({ condicao: '0', meio: '15' }),
});

export type PedidoCanonico = z.output<typeof pedidoSchema>;

// ---------------------------------------------------------------------------
// Catálogo de blocos (contrato exposto pela API para a UI)
// ---------------------------------------------------------------------------

export const BLOCK_CATEGORIES = [
  'gatilho', 'contexto', 'lookup', 'imposto', 'simples', 'reforma', 'logica', 'fluxo', 'nfe', 'sefaz', 'financeiro',
] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  gatilho: 'Gatilho',
  contexto: 'Contexto',
  lookup: 'Consultas',
  imposto: 'Impostos',
  simples: 'Simples Nacional',
  reforma: 'Reforma tributária',
  logica: 'Lógica',
  fluxo: 'Fluxo',
  nfe: 'Nota fiscal',
  sefaz: 'SEFAZ',
  financeiro: 'Financeiro',
};

export interface BlockMeta {
  key: string;
  version: number;
  label: string;
  category: BlockCategory;
  description: string;
  /** Fórmula documentada (texto). */
  formula?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** JSON Schema dos parâmetros (para montar o formulário na UI). */
  paramsSchema: Record<string, unknown>;
  branching?: boolean;
  /** Bloco com portas declaradas pelo usuário. */
  dynamicPorts?: 'codigo' | 'entrada' | 'saida' | 'subfluxo';
  /** Pode receber override por empresa. */
  overridable: boolean;
}

// ---------------------------------------------------------------------------
// Execução / trace
// ---------------------------------------------------------------------------

export type NodeStatus = 'ok' | 'skipped' | 'error';

export interface TraceEntry {
  nodeId: string;
  blockKey: string;
  label: string;
  status: NodeStatus;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  durationMs: number;
  /** Override aplicado neste nó. */
  override?: { id: string; name: string; legalBasis?: string | null; kind: 'codigo' | 'parametros' };
  error?: { message: string; code?: string; details?: unknown };
  /** Execuções internas (subfluxo / para cada item). */
  children?: Array<{ label: string; trace: TraceEntry[] }>;
  logs?: string[];
}

export type FlowRunStatus = 'OK' | 'ERRO' | 'REJEITADA';

export interface GraphIssue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export const VALIDATION_LIMITS = { codeMaxBytes: 50_000 } as const;
