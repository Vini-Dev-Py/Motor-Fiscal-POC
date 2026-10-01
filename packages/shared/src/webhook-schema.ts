import { z } from 'zod';
import {
  FIELD_FORMATS, FORMAT_VALIDATORS, isValidIsoDate, isValidIsoDateTime, type FieldFormat,
} from './br-validators';

/**
 * DSL JSON (guardada no banco) que descreve o payload esperado de um webhook.
 * `buildZodSchema` a converte em um schema Zod em tempo de execução.
 */
export const FIELD_TYPES = [
  'string', 'number', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'enum', 'object', 'array',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  name: string;
  type: FieldType;
  required: boolean;
  description?: string;
  format?: FieldFormat;
  min?: number;
  max?: number;
  regex?: string;
  enum?: string[];
  /** Campos filhos (type = object). */
  fields?: FieldDef[];
  /** Definição do item (type = array). O `name` do item é ignorado. */
  items?: FieldDef;
  minItems?: number;
  maxItems?: number;
}

export interface RequestSchemaDsl {
  fields: FieldDef[];
}

export const fieldDefSchema: z.ZodType<FieldDef> = z.lazy(() =>
  z
    .object({
      name: z
        .string()
        .min(1, 'Informe o nome do campo')
        .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Nome inválido: use letras, números e _ (sem espaços)'),
      type: z.enum(FIELD_TYPES),
      required: z.boolean(),
      description: z.string().optional(),
      format: z.enum(FIELD_FORMATS as [FieldFormat, ...FieldFormat[]]).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      regex: z
        .string()
        .optional()
        .refine((r) => {
          if (!r) return true;
          try {
            new RegExp(r);
            return true;
          } catch {
            return false;
          }
        }, 'Expressão regular inválida'),
      enum: z.array(z.string()).optional(),
      fields: z.array(fieldDefSchema).optional(),
      items: fieldDefSchema.optional(),
      minItems: z.number().int().min(0).optional(),
      maxItems: z.number().int().min(0).optional(),
    })
    .superRefine((f, ctx) => {
      if (f.type === 'enum' && (!f.enum || f.enum.length === 0)) {
        ctx.addIssue({ code: 'custom', path: ['enum'], message: 'Informe ao menos um valor para o enum' });
      }
      if (f.type === 'object' && (!f.fields || f.fields.length === 0)) {
        ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Objeto precisa de ao menos um campo' });
      }
      if (f.type === 'array' && !f.items) {
        ctx.addIssue({ code: 'custom', path: ['items'], message: 'Informe a definição dos itens da lista' });
      }
      if (f.fields) {
        const names = f.fields.map((x) => x.name);
        const dup = names.find((n, i) => names.indexOf(n) !== i);
        if (dup) ctx.addIssue({ code: 'custom', path: ['fields'], message: `Campo duplicado: ${dup}` });
      }
    }),
);

export const requestSchemaDslSchema: z.ZodType<RequestSchemaDsl> = z
  .object({ fields: z.array(fieldDefSchema) })
  .superRefine((s, ctx) => {
    const names = s.fields.map((x) => x.name);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) ctx.addIssue({ code: 'custom', path: ['fields'], message: `Campo duplicado: ${dup}` });
  });

// ---------------------------------------------------------------------------

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

const typeMessage = (expected: string) => (iss: { input?: unknown }) =>
  iss.input === undefined ? 'Campo obrigatório' : `Tipo inválido: esperado ${expected}`;

function buildField(f: FieldDef): z.ZodType {
  let schema: z.ZodType;

  switch (f.type) {
    case 'string': {
      let s = z.string({ error: typeMessage('texto') });
      if (f.min !== undefined) s = s.min(f.min, `Mínimo de ${f.min} caracteres`);
      if (f.max !== undefined) s = s.max(f.max, `Máximo de ${f.max} caracteres`);
      if (f.regex) s = s.regex(new RegExp(f.regex), 'Formato inválido');
      const fmt = f.format && FORMAT_VALIDATORS[f.format];
      schema = fmt ? s.refine((v) => fmt.check(v), { message: fmt.message }) : s;
      break;
    }
    case 'number': {
      let s = z.number({ error: typeMessage('número') }).finite('Número inválido');
      if (f.min !== undefined) s = s.min(f.min, `Valor mínimo: ${f.min}`);
      if (f.max !== undefined) s = s.max(f.max, `Valor máximo: ${f.max}`);
      schema = s;
      break;
    }
    case 'integer': {
      let s = z.number({ error: typeMessage('inteiro') }).int('Deve ser um número inteiro');
      if (f.min !== undefined) s = s.min(f.min, `Valor mínimo: ${f.min}`);
      if (f.max !== undefined) s = s.max(f.max, `Valor máximo: ${f.max}`);
      schema = s;
      break;
    }
    case 'decimal': {
      // valor monetário/quantidade: aceita number ou string numérica ("10.50")
      schema = z
        .unknown()
        .superRefine((v, ctx) => {
          if (v === undefined) return void ctx.addIssue({ code: 'custom', message: 'Campo obrigatório' });
          const ok = (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && DECIMAL_RE.test(v));
          if (!ok) return void ctx.addIssue({ code: 'custom', message: 'Tipo inválido: esperado número decimal' });
          const n = Number(v);
          if (f.min !== undefined && n < f.min) ctx.addIssue({ code: 'custom', message: `Valor mínimo: ${f.min}` });
          if (f.max !== undefined && n > f.max) ctx.addIssue({ code: 'custom', message: `Valor máximo: ${f.max}` });
        })
        .transform((v) => (typeof v === 'number' ? String(v) : (v as string)));
      break;
    }
    case 'boolean':
      schema = z.boolean({ error: typeMessage('booleano') });
      break;
    case 'date':
      schema = z
        .string({ error: typeMessage('data AAAA-MM-DD') })
        .refine(isValidIsoDate, { message: 'Data inválida (use AAAA-MM-DD)' });
      break;
    case 'datetime':
      schema = z
        .string({ error: typeMessage('data/hora ISO 8601') })
        .refine(isValidIsoDateTime, { message: 'Data/hora inválida (use ISO 8601 com fuso)' });
      break;
    case 'enum':
      schema = z.enum((f.enum ?? []) as [string, ...string[]], {
        error: (iss) =>
          iss.input === undefined ? 'Campo obrigatório' : `Valor inválido: use um de ${(f.enum ?? []).join(', ')}`,
      });
      break;
    case 'object': {
      const shape: Record<string, z.ZodType> = {};
      for (const child of f.fields ?? []) shape[child.name] = buildField(child);
      schema = z.object(shape, { error: typeMessage('objeto') });
      break;
    }
    case 'array': {
      let s = z.array(f.items ? buildField({ ...f.items, required: true }) : z.unknown(), {
        error: typeMessage('lista'),
      });
      if (f.minItems !== undefined) s = s.min(f.minItems, `Mínimo de ${f.minItems} item(ns)`);
      if (f.maxItems !== undefined) s = s.max(f.maxItems, `Máximo de ${f.maxItems} item(ns)`);
      schema = s;
      break;
    }
  }

  if (!f.required) {
    // null e ausente são equivalentes para campos opcionais
    return z.preprocess((v) => (v === null ? undefined : v), schema.optional());
  }
  return schema;
}

/** Converte a DSL em um schema Zod (objeto raiz). Campos não declarados são descartados. */
export function buildZodSchema(dsl: RequestSchemaDsl): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of dsl.fields) shape[f.name] = buildField(f);
  return z.object(shape, { error: 'O corpo da requisição deve ser um objeto JSON' }) as unknown as z.ZodType<
    Record<string, unknown>
  >;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validatePayload(
  dsl: RequestSchemaDsl,
  payload: unknown,
): { success: true; data: Record<string, unknown> } | { success: false; issues: ValidationIssue[] } {
  const r = buildZodSchema(dsl).safeParse(payload);
  if (r.success) return { success: true, data: r.data };
  return {
    success: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join('.') || '(raiz)', message: i.message })),
  };
}

// ---------------------------------------------------------------------------
// Inferência de DSL a partir de um JSON de exemplo
// ---------------------------------------------------------------------------

function guessFormat(name: string, v: string): FieldFormat | undefined {
  const n = name.toLowerCase();
  if (n === 'ncm' && /^\d{8}$/.test(v)) return 'ncm';
  if (n === 'cfop' && /^\d{4}$/.test(v)) return 'cfop';
  if (n === 'uf' && /^[A-Z]{2}$/.test(v)) return 'uf';
  if (n === 'cep' && /^\d{5}-?\d{3}$/.test(v)) return 'cep';
  if ((n === 'cnpj' || n === 'documento') && FORMAT_VALIDATORS.cnpjOuCpf.check(v)) return 'cnpjOuCpf';
  if (n === 'cpf' && FORMAT_VALIDATORS.cpf.check(v)) return 'cpf';
  if (n === 'email' && FORMAT_VALIDATORS.email.check(v)) return 'email';
  return undefined;
}

function inferField(name: string, v: unknown): FieldDef {
  if (Array.isArray(v)) {
    const sample = v.find((x) => x !== null && x !== undefined);
    return {
      name, type: 'array', required: true,
      items: sample === undefined ? { name: 'item', type: 'string', required: true } : inferField('item', sample),
    };
  }
  if (v !== null && typeof v === 'object') {
    return {
      name, type: 'object', required: true,
      fields: Object.entries(v as Record<string, unknown>).map(([k, x]) => inferField(k, x)),
    };
  }
  if (typeof v === 'boolean') return { name, type: 'boolean', required: true };
  if (typeof v === 'number') return { name, type: Number.isInteger(v) ? 'integer' : 'number', required: true };
  if (typeof v === 'string') {
    if (isValidIsoDate(v)) return { name, type: 'date', required: true };
    if (isValidIsoDateTime(v)) return { name, type: 'datetime', required: true };
    const format = guessFormat(name, v);
    return { name, type: 'string', required: true, ...(format ? { format } : {}) };
  }
  return { name, type: 'string', required: false };
}

/** Gera uma DSL a partir de um payload de exemplo (todos os campos saem obrigatórios). */
export function inferSchemaFromJson(sample: unknown): RequestSchemaDsl {
  if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new Error('O exemplo deve ser um objeto JSON');
  }
  return {
    fields: Object.entries(sample as Record<string, unknown>).map(([k, v]) => inferField(k, v)),
  };
}
