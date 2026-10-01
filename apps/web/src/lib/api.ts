import type {
  BlockMeta, FlowGraph, GraphIssue, PortDef, RequestSchemaDsl, TenantConfig, TraceEntry,
} from '@motor-fiscal/shared';

// ---------------------------------------------------------------------------
// Tipos das respostas da API
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string; cnpj: string; razaoSocial: string; ie: string | null; uf: string; codMunicipio: string;
  regime: 'SIMPLES' | 'PRESUMIDO' | 'REAL'; crt: number; rbt12: string | null; config: TenantConfig;
  nfeProximoNumero: number;
}

export interface FlowSummary {
  id: string; name: string; kind: 'PEDIDO' | 'SUBFLUXO'; description: string | null;
  nodeCount: number; latestVersion: number | null; publishedAt: string | null; updatedAt: string;
}

export interface Flow {
  id: string; name: string; kind: 'PEDIDO' | 'SUBFLUXO'; description: string | null; draftGraph: FlowGraph; updatedAt: string;
}

export interface Override {
  id: string; blockKey: string; name: string; code: string | null; params: Record<string, unknown>;
  validFrom: string; validTo: string | null; legalBasis: string | null; active: boolean;
}

export interface Webhook {
  id: string; name: string; slug: string; description: string | null; flowId: string; flowName?: string;
  requestSchema: RequestSchemaDsl; responseTemplate: unknown; token: string | null; active: boolean;
  config: { dateField?: string; idempotencyField?: string }; executionCount?: number;
}

export interface ExecutionSummary {
  id: string; status: 'EXECUTANDO' | 'OK' | 'ERRO' | 'REJEITADA'; httpStatus: number | null; durationMs: number;
  createdAt: string; idempotencyKey: string | null; flowVersion: number | null;
  webhook: { id: string; name: string; slug: string } | null; error: { message?: string; codigo?: string } | null;
}

export interface Execution extends Omit<ExecutionSummary, 'flowVersion'> {
  flowVersion: { version: number } | null;
  input: unknown; output: unknown; trace: TraceEntry[];
}

export interface RefTableInfo {
  key: string; name: string; description: string; keyFields: string[]; valueFields: string[]; rowCount: number;
}

export interface RefRow {
  id: string; table: string; keys: Record<string, string>; value: Record<string, unknown>;
  validFrom: string; validTo: string | null; note: string | null; tenantSpecific: boolean;
}

export interface RunResult {
  status: 'OK' | 'ERRO' | 'REJEITADA';
  nodes: Record<string, Record<string, unknown>>;
  trace: TraceEntry[];
  error?: { message: string; code?: string; nodeId?: string; details?: unknown };
  durationMs: number;
}

export interface OverrideTestResult {
  padrao: { ok: boolean; outputs?: Record<string, unknown>; error?: { message: string; code: string }; durationMs?: number };
  override: { ok: boolean; outputs?: Record<string, unknown>; error?: { message: string; code: string }; durationMs?: number };
  diferencas: Array<{ path: string; padrao: unknown; override: unknown }>;
}

export type { BlockMeta, GraphIssue, PortDef };

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues?: Array<{ path?: string; message: string; level?: string }>,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

let currentTenantId: string | null = null;
export const setApiTenant = (id: string | null) => {
  currentTenantId = id;
};

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(currentTenantId ? { 'X-Tenant-Id': currentTenantId } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string | string[]; issues?: ApiError['issues'] };
    const msg = Array.isArray(d.message) ? d.message.join('; ') : d.message;
    throw new ApiError(msg ?? `Erro ${res.status}`, res.status, d.issues, data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: (url: string) => request<void>('DELETE', url),
};

export const errorMessage = (e: unknown): string =>
  e instanceof ApiError
    ? e.issues?.length
      ? `${e.message}: ${e.issues.map((i) => (i.path ? `${i.path} — ${i.message}` : i.message)).join('; ')}`
      : e.message
    : e instanceof Error
      ? e.message
      : String(e);
