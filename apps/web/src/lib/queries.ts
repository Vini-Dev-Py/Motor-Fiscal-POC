import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  api, type ExecutionSummary, type Flow, type FlowSummary, type Override, type RefTableInfo, type Webhook, type BlockMeta,
} from './api';
import { useTenant } from './tenant';

/** Query da empresa atual: a chave inclui o id da empresa, então trocar de empresa refaz a busca. */
export function useTenantQuery<T>(key: QueryKey, fn: () => Promise<T>, enabled = true) {
  const { current } = useTenant();
  return useQuery({ queryKey: [current?.id, ...key], queryFn: fn, enabled: enabled && !!current });
}

export function useInvalidate() {
  const qc = useQueryClient();
  const { current } = useTenant();
  return (...key: QueryKey) => qc.invalidateQueries({ queryKey: [current?.id, ...key] });
}

export const useBlocks = () =>
  useQuery({ queryKey: ['blocks'], queryFn: () => api.get<BlockMeta[]>('/api/blocks'), staleTime: Infinity });

export const useFlows = (kind?: 'PEDIDO' | 'SUBFLUXO') =>
  useTenantQuery(['flows', kind ?? 'all'], () => api.get<FlowSummary[]>(`/api/flows${kind ? `?kind=${kind}` : ''}`));

export const useFlow = (id: string | undefined) =>
  useTenantQuery(['flow', id], () => api.get<Flow>(`/api/flows/${id}`), !!id);

export const useOverrides = () => useTenantQuery(['overrides'], () => api.get<Override[]>('/api/overrides'));
export const useWebhooks = () => useTenantQuery(['webhooks'], () => api.get<Webhook[]>('/api/webhooks'));
export const useRefTables = () => useTenantQuery(['ref-tables'], () => api.get<RefTableInfo[]>('/api/reference-tables'));

export const useExecutions = (params: { webhookId?: string; status?: string }) => {
  const qs = new URLSearchParams({ limit: '100' });
  if (params.webhookId) qs.set('webhookId', params.webhookId);
  if (params.status) qs.set('status', params.status);
  return useTenantQuery(['executions', params.webhookId ?? '', params.status ?? ''], () => api.get<ExecutionSummary[]>(`/api/executions?${qs}`));
};

export const useMeta = () =>
  useQuery({ queryKey: ['meta'], queryFn: () => api.get<{ publicBaseUrl: string | null }>('/api/meta'), staleTime: Infinity });

export const webhookUrl = (slug: string, base?: string | null) => `${(base ?? window.location.origin).replace(/\/$/, '')}/webhook/${slug}`;
