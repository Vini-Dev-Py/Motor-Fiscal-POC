import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { PortType } from '@motor-fiscal/shared';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

export const formatCnpj = (v: string) => (/^\d{14}$/.test(v) ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\w{2})$/, '$1.$2.$3/$4-$5'));

export const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

export const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Cor de cada tipo de porta (handles do editor e legenda). */
export const PORT_COLORS: Record<PortType, string> = {
  decimal: '#0ea5e9', percent: '#0284c7', integer: '#06b6d4', string: '#64748b', boolean: '#84cc16',
  uf: '#94a3b8', date: '#a1a1aa', pedido: '#f97316', item: '#f59e0b', contexto: '#8b5cf6', tributo: '#ef4444',
  totais: '#ec4899', autorizacao: '#10b981', parcelas: '#14b8a6', boletos: '#22c55e', xml: '#d946ef',
  lista: '#6366f1', object: '#78716c', any: '#a3a3a3',
};

export const CATEGORY_COLORS: Record<string, string> = {
  gatilho: '#22c55e', contexto: '#8b5cf6', lookup: '#64748b', imposto: '#ef4444', simples: '#f97316', reforma: '#0ea5e9',
  logica: '#eab308', fluxo: '#6366f1', nfe: '#ec4899', sefaz: '#10b981', financeiro: '#14b8a6',
};

export function safeJsonParse<T = unknown>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
