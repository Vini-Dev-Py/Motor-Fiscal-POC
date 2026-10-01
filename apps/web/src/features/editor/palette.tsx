import { useMemo, useState } from 'react';
import { GitBranch, Plus, Search } from 'lucide-react';
import { BLOCK_CATEGORIES, BLOCK_CATEGORY_LABELS, type BlockMeta, type PortDef } from '@motor-fiscal/shared';
import type { FlowSummary } from '@/lib/api';
import { CATEGORY_COLORS, cn } from '@/lib/utils';
import { Input } from '@/components/ui';

export interface PaletteItem {
  /** Chave do bloco (ou flow.subfluxo para subfluxos). */
  blockKey: string;
  label: string;
  description: string;
  category: string;
  flowId?: string;
  inputs?: PortDef[];
  outputs?: PortDef[];
}

export const DND_TYPE = 'application/x-motor-block';

/** Paleta de blocos (arraste para o canvas ou clique em +). */
export function Palette({
  blocks, subflows, kind, onAdd,
}: { blocks: BlockMeta[]; subflows: FlowSummary[]; kind: 'PEDIDO' | 'SUBFLUXO'; onAdd: (item: PaletteItem) => void }) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const allowed = blocks.filter((b) => {
      if (b.key === 'trigger.webhook') return kind === 'PEDIDO';
      if (b.key === 'sub.entrada' || b.key === 'sub.saida') return kind === 'SUBFLUXO';
      if (b.key === 'flow.subfluxo') return false; // entra pela lista de subfluxos
      return true;
    });
    const items: PaletteItem[] = allowed.map((b) => ({ blockKey: b.key, label: b.label, description: b.description, category: b.category }));
    for (const s of subflows) {
      items.push({ blockKey: 'flow.subfluxo', label: s.name, description: s.description ?? 'Subfluxo reutilizável', category: 'fluxo', flowId: s.id });
    }
    const filtered = items.filter((i) => !term || `${i.label} ${i.blockKey} ${i.description}`.toLowerCase().includes(term));
    return BLOCK_CATEGORIES.map((c) => ({ category: c, items: filtered.filter((i) => i.category === c) })).filter((g) => g.items.length);
  }, [blocks, subflows, kind, q]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-faint" />
          <Input className="h-9 pl-8" placeholder="Buscar bloco…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-faint">Arraste para o canvas ou clique em “+”.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map(({ category, items }) => (
          <div key={category} className="mb-2">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase"
              onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}
            >
              <span className="size-2 rounded-sm" style={{ background: CATEGORY_COLORS[category] }} />
              {BLOCK_CATEGORY_LABELS[category]}
              <span className="ml-auto font-normal text-faint">{items.length}</span>
            </button>
            {!(collapsed[category] && !q) &&
              items.map((it) => (
                <div
                  key={`${it.blockKey}:${it.flowId ?? ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, JSON.stringify(it));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  title={it.description}
                  className={cn('group flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2 active:cursor-grabbing')}
                >
                  <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[category] }} />
                  <span className="min-w-0 flex-1 truncate">
                    {it.flowId && <GitBranch className="mr-1 inline size-3 text-faint" />}
                    {it.label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Adicionar ${it.label}`}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-md text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent-soft hover:text-accent"
                    onClick={() => onAdd(it)}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              ))}
          </div>
        ))}
        {!groups.length && <div className="p-4 text-center text-[12.5px] text-muted">Nenhum bloco encontrado.</div>}
      </div>
    </aside>
  );
}
