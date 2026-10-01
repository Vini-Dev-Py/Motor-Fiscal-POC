import { z } from 'zod';
import { UFS } from './br-validators';

/** Tipos de dados que trafegam entre os blocos. */
export const PORT_TYPES = [
  'decimal', 'percent', 'integer', 'string', 'boolean', 'uf', 'date',
  'pedido', 'item', 'contexto', 'tributo', 'totais', 'autorizacao',
  'parcelas', 'boletos', 'xml', 'lista', 'object', 'any',
] as const;
export type PortType = (typeof PORT_TYPES)[number];

export const PORT_TYPE_LABELS: Record<PortType, string> = {
  decimal: 'Decimal', percent: 'Percentual', integer: 'Inteiro', string: 'Texto', boolean: 'Booleano',
  uf: 'UF', date: 'Data', pedido: 'Pedido', item: 'Item', contexto: 'Contexto', tributo: 'Tributo',
  totais: 'Totais', autorizacao: 'Autorização', parcelas: 'Parcelas', boletos: 'Boletos', xml: 'XML',
  lista: 'Lista', object: 'Objeto', any: 'Qualquer',
};

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  required?: boolean;
  default?: unknown;
  description?: string;
}

export const portDefSchema: z.ZodType<PortDef> = z.object({
  id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Use letras, números e _ (sem espaços)'),
  label: z.string().min(1),
  type: z.enum(PORT_TYPES),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const NUMERIC: PortType[] = ['decimal', 'percent', 'integer'];
const TEXTUAL: PortType[] = ['string', 'uf', 'date', 'xml'];
const OBJECTS: PortType[] = ['pedido', 'item', 'contexto', 'tributo', 'totais', 'autorizacao', 'object'];
const LISTS: PortType[] = ['parcelas', 'boletos', 'lista'];

/** Uma saída do tipo `from` pode ser ligada a uma entrada do tipo `to`? */
export function isPortCompatible(from: PortType, to: PortType): boolean {
  if (from === to || from === 'any' || to === 'any') return true;
  if (NUMERIC.includes(from) && (to === 'decimal' || to === 'percent')) return true;
  if (TEXTUAL.includes(from) && to === 'string') return true;
  if (OBJECTS.includes(from) && to === 'object') return true;
  if (LISTS.includes(from) && to === 'lista') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Esquemas Zod dos valores de cada tipo de porta (entradas e saídas dos blocos
// são validadas com eles, então um override não consegue quebrar o contrato).
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Decimais trafegam como string (precisão exata). Aceita number e normaliza. */
export const decimalSchema = z
  .unknown()
  .superRefine((v, ctx) => {
    const ok = (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && DECIMAL_RE.test(v));
    if (!ok) ctx.addIssue({ code: 'custom', message: 'Número decimal inválido' });
  })
  .transform((v) => (typeof v === 'number' ? String(v) : (v as string)));

export const integerSchema = z
  .unknown()
  .superRefine((v, ctx) => {
    const ok = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^-?\d+$/.test(v));
    if (!ok) ctx.addIssue({ code: 'custom', message: 'Número inteiro inválido' });
  })
  .transform((v) => Number(v));

export const tributoSchema = z
  .object({
    base: decimalSchema,
    aliquota: decimalSchema,
    valor: decimalSchema,
    aplicavel: z.boolean().optional(),
    cst: z.string().optional(),
    csosn: z.string().optional(),
  })
  .passthrough();

export type Tributo = {
  base: string;
  aliquota: string;
  valor: string;
  aplicavel?: boolean;
  cst?: string;
  csosn?: string;
  [extra: string]: unknown;
};

const looseObject = z.object({}).passthrough();

export const PORT_VALUE_SCHEMAS: Record<PortType, z.ZodType> = {
  decimal: decimalSchema,
  percent: decimalSchema,
  integer: integerSchema,
  string: z.string(),
  boolean: z.boolean(),
  uf: z.enum(UFS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Data inválida (use AAAA-MM-DD)'),
  pedido: looseObject,
  item: z.object({ vProd: decimalSchema }).passthrough(),
  contexto: z.object({ tenant: looseObject, operacao: looseObject }).passthrough(),
  tributo: tributoSchema,
  totais: looseObject,
  autorizacao: looseObject,
  parcelas: z.array(looseObject),
  boletos: z.array(looseObject),
  xml: z.string(),
  lista: z.array(z.unknown()),
  object: looseObject,
  any: z.unknown(),
};

export function validatePortValue(type: PortType, value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const r = PORT_VALUE_SCHEMAS[type].safeParse(value);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  const path = first && first.path.length ? ` (${first.path.join('.')})` : '';
  return { ok: false, message: `${first?.message ?? 'valor inválido'}${path}` };
}
