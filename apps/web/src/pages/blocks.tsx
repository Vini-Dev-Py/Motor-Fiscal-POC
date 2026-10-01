import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { BLOCK_CATEGORIES, BLOCK_CATEGORY_LABELS, PORT_TYPE_LABELS, type BlockMeta, type PortDef } from '@motor-fiscal/shared';
import { useBlocks } from '@/lib/queries';
import { CATEGORY_COLORS, PORT_COLORS, pretty } from '@/lib/utils';
import { Badge, Card, Dialog, ErrorBox, Input, JsonBlock, Loading, PageHeader } from '@/components/ui';

export function PortChip({ port }: { port: PortDef }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[12px]">
      <span className="size-2 rounded-full" style={{ background: PORT_COLORS[port.type] }} />
      <span className="font-medium">{port.label}</span>
      <span className="text-faint">{PORT_TYPE_LABELS[port.type]}</span>
      {port.required === false && <span className="text-faint">· opcional</span>}
    </span>
  );
}

export function BlocksPage() {
  const { data: blocks, isLoading, error } = useBlocks();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<BlockMeta | null>(null);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (blocks ?? []).filter((b) => !term || `${b.label} ${b.key} ${b.description}`.toLowerCase().includes(term));
    return BLOCK_CATEGORIES.map((c) => ({ category: c, items: list.filter((b) => b.category === c) })).filter((g) => g.items.length);
  }, [blocks, q]);

  return (
    <>
      <PageHeader
        title="Catálogo de blocos"
        description="Blocos padrão da plataforma. Cada bloco tem entradas e saídas tipadas (a saída é validada pelo contrato, inclusive quando a empresa faz override)."
      />
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute top-2.5 left-3 size-4 text-faint" />
        <Input className="pl-9" placeholder="Buscar bloco (ex.: ICMS, boleto)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : (
        <div className="space-y-7">
          {groups.map(({ category, items }) => (
            <section key={category}>
              <h2 className="mb-2.5 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
                <span className="size-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[category] }} />
                {BLOCK_CATEGORY_LABELS[category]}
              </h2>
              <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                {items.map((b) => (
                  <button key={b.key} type="button" onClick={() => setSelected(b)} className="cursor-pointer text-left">
                    <Card className="h-full p-3.5 transition-colors hover:border-accent">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">{b.label}</div>
                        {b.overridable && <Badge tone="accent">override</Badge>}
                      </div>
                      <div className="mt-0.5 font-mono text-[11.5px] text-faint">{b.key}</div>
                      <p className="mt-2 line-clamp-3 text-[12.5px] text-muted">{b.description}</p>
                    </Card>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.label ?? ''}
        description={<span className="font-mono">{selected?.key} · v{selected?.version}</span>}
        size="lg"
      >
        {selected && (
          <div className="space-y-5">
            <p>{selected.description}</p>
            {selected.formula && (
              <div>
                <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Fórmula</div>
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed">{selected.formula}</div>
              </div>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Entradas</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.inputs.length ? selected.inputs.map((p) => <PortChip key={p.id} port={p} />) : <span className="text-muted">{selected.dynamicPorts ? 'Declaradas no bloco' : 'Nenhuma'}</span>}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Saídas</div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.outputs.length ? selected.outputs.map((p) => <PortChip key={p.id} port={p} />) : <span className="text-muted">{selected.dynamicPorts ? 'Declaradas no bloco' : 'Nenhuma'}</span>}
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Parâmetros (JSON Schema)</div>
              <JsonBlock value={pretty(selected.paramsSchema)} maxHeight={240} />
            </div>
            <div className="flex gap-2 text-[12.5px] text-muted">
              {selected.branching && <Badge tone="warn">ramifica o fluxo</Badge>}
              {selected.overridable ? <Badge tone="accent">aceita override por empresa</Badge> : <Badge>sem override</Badge>}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
