import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, MinusCircle, ShieldAlert, X } from 'lucide-react';
import type { TraceEntry } from '@motor-fiscal/shared';
import { cn, formatMs } from '@/lib/utils';
import { Badge, JsonBlock } from './ui';

export function ExecStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'ok' | 'danger' | 'warn' | 'info'; label: string }> = {
    OK: { tone: 'ok', label: 'Sucesso' },
    ERRO: { tone: 'danger', label: 'Erro' },
    REJEITADA: { tone: 'warn', label: 'Rejeitada' },
    EXECUTANDO: { tone: 'info', label: 'Executando' },
  };
  const m = map[status] ?? { tone: 'info' as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

const icon = (s: TraceEntry['status']) =>
  s === 'ok' ? <Check className="size-3.5 text-ok" /> : s === 'skipped' ? <MinusCircle className="size-3.5 text-faint" /> : <X className="size-3.5 text-danger" />;

function Entry({ e, depth, onSelect, selectedId }: { e: TraceEntry; depth: number; onSelect?: (nodeId: string) => void; selectedId?: string | null }) {
  const [open, setOpen] = useState(e.status === 'error');
  const expandable = e.status !== 'skipped';
  const selected = selectedId === e.nodeId && depth === 0;

  return (
    <li>
      <div
        className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]', selected && 'bg-accent-soft', expandable && 'cursor-pointer hover:bg-surface-2')}
        onClick={() => {
          if (expandable) setOpen((o) => !o);
          if (depth === 0) onSelect?.(e.nodeId);
        }}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90', !expandable && 'opacity-0')} />
        {icon(e.status)}
        <span className={cn('min-w-0 flex-1 truncate', e.status === 'skipped' && 'text-faint')}>{e.label}</span>
        {e.override && (
          <Badge tone="warn">
            <ShieldAlert className="size-3" /> override
          </Badge>
        )}
        <span className="font-mono text-[11px] text-faint">{e.blockKey}</span>
        {e.status !== 'skipped' && <span className="w-14 text-right font-mono text-[11px] text-faint">{formatMs(e.durationMs)}</span>}
      </div>

      {open && expandable && (
        <div className="mt-1 mb-2 ml-6 space-y-2 border-l border-border pl-3">
          {e.override && (
            <div className="flex items-start gap-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Override “{e.override.name}” ({e.override.kind === 'codigo' ? 'código' : 'parâmetros'})
                {e.override.legalBasis ? ` — base legal: ${e.override.legalBasis}` : ''}
              </span>
            </div>
          )}
          {e.error && (
            <div className="rounded-md bg-danger-soft px-2.5 py-1.5 text-[12.5px] text-danger">
              <div className="font-medium">{e.error.message}</div>
              {e.error.code && <div className="font-mono text-[11px] opacity-80">{e.error.code}</div>}
              {e.error.details !== undefined && <JsonBlock value={e.error.details} maxHeight={140} className="mt-1.5 bg-surface" />}
            </div>
          )}
          {e.logs?.length ? <JsonBlock value={e.logs.join('\n')} maxHeight={100} /> : null}
          {e.inputs && Object.keys(e.inputs).length > 0 && (
            <details>
              <summary className="cursor-pointer text-[12px] font-medium text-muted">Entradas</summary>
              <JsonBlock value={e.inputs} maxHeight={220} className="mt-1" />
            </details>
          )}
          {e.outputs && Object.keys(e.outputs).length > 0 && (
            <details open={!e.children?.length}>
              <summary className="cursor-pointer text-[12px] font-medium text-muted">Saídas</summary>
              <JsonBlock value={e.outputs} maxHeight={260} className="mt-1" />
            </details>
          )}
          {e.children?.map((c, i) => (
            <div key={i}>
              <div className="mb-1 text-[12px] font-semibold text-muted">↳ {c.label}</div>
              <TraceList trace={c.trace} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function TraceList({ trace, depth, onSelect, selectedId }: { trace: TraceEntry[]; depth: number; onSelect?: (nodeId: string) => void; selectedId?: string | null }) {
  return (
    <ul className="space-y-0.5">
      {trace.map((e, i) => (
        <Entry key={`${e.nodeId}-${i}`} e={e} depth={depth} onSelect={onSelect} selectedId={selectedId} />
      ))}
    </ul>
  );
}

/** Árvore de execução: cada bloco com entradas, saídas, override aplicado e subfluxos por item. */
export function TraceTree({ trace, onSelect, selectedId }: { trace: TraceEntry[]; onSelect?: (nodeId: string) => void; selectedId?: string | null }) {
  if (!trace.length) return <div className="py-6 text-center text-muted">Sem trace registrado.</div>;
  return <TraceList trace={trace} depth={0} onSelect={onSelect} selectedId={selectedId} />;
}
