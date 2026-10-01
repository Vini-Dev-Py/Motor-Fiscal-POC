import { createContext, memo, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, MinusCircle, ShieldAlert, X } from 'lucide-react';
import { PORT_TYPE_LABELS, type BlockMeta } from '@motor-fiscal/shared';
import { CATEGORY_COLORS, PORT_COLORS, cn } from '@/lib/utils';
import { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT, portsOf, type RFNode } from './graph-utils';

export type RunStatus = 'running' | 'ok' | 'skipped' | 'error';

export interface EditorCtx {
  metaOf: (key: string) => BlockMeta | undefined;
  runStatus: Record<string, RunStatus>;
  /** Blocos com override ativo para a empresa atual. */
  overrideKeys: Set<string>;
  /** Nós com problema na última validação. */
  issueNodes: Set<string>;
}

export const EditorContext = createContext<EditorCtx>({ metaOf: () => undefined, runStatus: {}, overrideKeys: new Set(), issueNodes: new Set() });

function BlockNodeImpl({ id, data, selected }: NodeProps<RFNode>) {
  const { metaOf, runStatus, overrideKeys, issueNodes } = useContext(EditorContext);
  const meta = metaOf(data.blockKey);
  const { inputs, outputs } = portsOf(data, meta);
  const rows = Math.max(inputs.length, outputs.length, 1);
  const color = CATEGORY_COLORS[meta?.category ?? 'logica'] ?? '#64748b';
  const status = runStatus[id];
  const hasIssue = issueNodes.has(id);
  const hasOverride = !!meta?.overridable && overrideKeys.has(data.blockKey);

  const ring =
    status === 'error' || hasIssue ? 'var(--danger)'
    : status === 'ok' ? 'var(--ok)'
    : status === 'running' ? 'var(--accent)'
    : selected ? 'var(--accent)' : 'var(--border-strong)';

  return (
    <motion.div
      style={{ width: NODE_WIDTH }}
      className="relative rounded-xl bg-surface shadow-sm"
      animate={{
        boxShadow:
          status === 'running' ? `0 0 0 3px color-mix(in srgb, ${ring} 35%, transparent)`
          : selected || status ? `0 0 0 2px ${ring}` : `0 0 0 1px ${ring}`,
        opacity: status === 'skipped' ? 0.5 : 1,
        scale: status === 'running' ? 1.03 : 1,
      }}
      transition={{ duration: 0.18 }}
    >
      <div className="flex items-center gap-2 rounded-t-xl px-3 text-[13px] font-semibold text-white" style={{ background: color, height: HEADER_HEIGHT }}>
        <span className="min-w-0 flex-1 truncate">{data.label ?? meta?.label ?? data.blockKey}</span>
        {hasOverride && (
          <span title="Esta empresa tem override ativo para este bloco" className="flex items-center gap-1 rounded bg-black/25 px-1.5 py-0.5 text-[10px]">
            <ShieldAlert className="size-3" /> override
          </span>
        )}
        {status === 'ok' && <Check className="size-4" />}
        {status === 'skipped' && <MinusCircle className="size-4" />}
        {status === 'error' && <X className="size-4" />}
        {hasIssue && !status && <AlertTriangle className="size-4" />}
      </div>

      <div className="py-1.5">
        {Array.from({ length: rows }).map((_, i) => {
          const inp = inputs[i];
          const out = outputs[i];
          return (
            <div key={i} className="relative flex items-center justify-between gap-3 px-3 text-[12px]" style={{ height: ROW_HEIGHT }}>
              {inp ? (
                <>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={inp.id}
                    title={`${inp.label} · ${PORT_TYPE_LABELS[inp.type]}${inp.required === false ? ' · opcional' : ''}`}
                    style={{ background: PORT_COLORS[inp.type], borderStyle: inp.required === false ? 'dashed' : 'solid' }}
                  />
                  <span className="min-w-0 truncate text-muted">
                    {inp.label}
                    {inp.required !== false && <span className="text-danger">*</span>}
                  </span>
                </>
              ) : <span />}
              {out ? (
                <>
                  <span className="min-w-0 truncate text-right text-muted">{out.label}</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={out.id}
                    title={`${out.label} · ${PORT_TYPE_LABELS[out.type]}`}
                    style={{ background: PORT_COLORS[out.type] }}
                  />
                </>
              ) : <span />}
            </div>
          );
        })}
      </div>
      <div className={cn('truncate rounded-b-xl border-t border-border px-3 py-1 font-mono text-[10.5px] text-faint')}>{id}</div>
    </motion.div>
  );
}

export const BlockNode = memo(BlockNodeImpl);
