import { z } from 'zod';
import { flowGraphSchema } from './graph';
import { VALIDATION_LIMITS } from './domain';
import { requestSchemaDslSchema } from './webhook-schema';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');

export const overrideInputSchema = z
  .object({
    blockKey: z.string().min(1, 'Escolha o bloco'),
    name: z.string().min(2, 'Dê um nome ao override'),
    /** Sem código = override só de parâmetros (o bloco padrão roda com os parâmetros trocados). */
    code: z
      .string()
      .max(VALIDATION_LIMITS.codeMaxBytes, 'Código muito grande (máx. 50 KB)')
      .optional()
      .nullable(),
    params: z.record(z.string(), z.unknown()).default({}),
    validFrom: isoDate,
    validTo: isoDate.optional().nullable(),
    legalBasis: z.string().optional().nullable(),
    active: z.boolean().default(true),
  })
  .refine((o) => !o.validTo || o.validTo >= o.validFrom, {
    path: ['validTo'],
    message: 'A vigência final deve ser igual ou posterior à inicial',
  })
  .refine((o) => !!(o.code && o.code.trim()) || Object.keys(o.params).length > 0, {
    path: ['code'],
    message: 'Informe o código ou ao menos um parâmetro para sobrescrever',
  });
export type OverrideInput = z.input<typeof overrideInputSchema>;

export const flowInputSchema = z.object({
  name: z.string().min(2, 'Informe o nome do fluxo'),
  kind: z.enum(['PEDIDO', 'SUBFLUXO']).default('PEDIDO'),
  description: z.string().optional().nullable(),
  draftGraph: flowGraphSchema.optional(),
});
export type FlowInput = z.input<typeof flowInputSchema>;

export const webhookSlugSchema = z
  .string()
  .min(3, 'Mínimo de 3 caracteres')
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use minúsculas, números e hífens (ex.: calcular-nota-vinicius)');

export const webhookInputSchema = z.object({
  name: z.string().min(2, 'Informe o nome'),
  slug: webhookSlugSchema,
  description: z.string().optional().nullable(),
  flowId: z.string().min(1, 'Escolha o fluxo'),
  requestSchema: requestSchemaDslSchema,
  responseTemplate: z.unknown().refine((v) => v !== undefined && v !== null, 'Informe o template de resposta'),
  token: z.string().min(8, 'O token deve ter ao menos 8 caracteres').optional().nullable(),
  active: z.boolean().default(true),
  config: z
    .object({
      /** Campo do payload com a data que define vigência de tabelas/overrides. */
      dateField: z.string().default('dataEmissao'),
      /** Campo do payload usado como chave de idempotência (além do header Idempotency-Key). */
      idempotencyField: z.string().optional(),
    })
    .default({ dateField: 'dataEmissao' }),
});
export type WebhookInput = z.input<typeof webhookInputSchema>;

export const referenceRowInputSchema = z.object({
  table: z.string().min(1),
  keys: z.record(z.string(), z.string()).default({}),
  value: z.record(z.string(), z.unknown()),
  validFrom: isoDate,
  validTo: isoDate.optional().nullable(),
  /** true = vale só para a empresa atual; false = linha global. */
  tenantSpecific: z.boolean().default(true),
  note: z.string().optional().nullable(),
});
export type ReferenceRowInput = z.input<typeof referenceRowInputSchema>;

export const runFlowInputSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  /** Executa um grafo ainda não salvo (rascunho do editor). */
  graph: flowGraphSchema.optional(),
});

export const testOverrideInputSchema = z.object({
  inputs: z.record(z.string(), z.unknown()),
  /** Parâmetros do nó (como configurados no fluxo); omitido = padrões do bloco. */
  params: z.record(z.string(), z.unknown()).optional(),
  referenceDate: isoDate.optional(),
});
export type TestOverrideInput = z.input<typeof testOverrideInputSchema>;
