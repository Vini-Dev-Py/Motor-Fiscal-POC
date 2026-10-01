import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Copy, GitBranch, Plus, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import type { FlowGraph } from '@motor-fiscal/shared';
import { api, errorMessage, type Flow, type FlowSummary } from '@/lib/api';
import { useFlows, useInvalidate } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card, Dialog, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea } from '@/components/ui';

const blankGraph = (kind: 'PEDIDO' | 'SUBFLUXO'): FlowGraph =>
  kind === 'PEDIDO'
    ? { nodes: [{ id: 'gatilho', type: 'block', position: { x: 40, y: 120 }, data: { blockKey: 'trigger.webhook', label: 'Webhook recebido' } }], edges: [] }
    : {
        nodes: [
          {
            id: 'entrada', type: 'block', position: { x: 40, y: 120 },
            data: {
              blockKey: 'sub.entrada', label: 'Entrada',
              outputs: [
                { id: 'item', label: 'Item', type: 'item', required: true },
                { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
              ],
            },
          },
          { id: 'saida', type: 'block', position: { x: 620, y: 120 }, data: { blockKey: 'sub.saida', label: 'Saída', inputs: [{ id: 'resultado', label: 'Resultado', type: 'object', required: false }] } },
        ],
        edges: [],
      };

export function FlowsPage() {
  const { data: flows, isLoading, error } = useFlows();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'PEDIDO' | 'SUBFLUXO'>('PEDIDO');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () => api.post<Flow>('/api/flows', { name: name.trim(), kind, description: description.trim() || null, draftGraph: blankGraph(kind) }),
    onSuccess: (f) => {
      void invalidate('flows');
      setCreating(false);
      navigate(`/fluxos/${f.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const duplicate = useMutation({
    mutationFn: async (f: FlowSummary) => {
      const full = await api.get<Flow>(`/api/flows/${f.id}`);
      return api.post<Flow>('/api/flows', { name: `${f.name} (cópia)`, kind: f.kind, description: f.description, draftGraph: full.draftGraph });
    },
    onSuccess: () => {
      toast.success('Fluxo duplicado');
      void invalidate('flows');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/flows/${id}`),
    onSuccess: () => {
      toast.success('Fluxo excluído');
      void invalidate('flows');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const pedidos = (flows ?? []).filter((f) => f.kind === 'PEDIDO');
  const subs = (flows ?? []).filter((f) => f.kind === 'SUBFLUXO');

  const list = (items: FlowSummary[]) => (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((f) => (
        <Card key={f.id} className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/fluxos/${f.id}`} className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold hover:text-accent">{f.name}</div>
              {f.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{f.description}</div>}
            </Link>
            {f.kind === 'PEDIDO' ? (
              f.latestVersion ? <Badge tone="ok">v{f.latestVersion} publicada</Badge> : <Badge tone="warn">não publicada</Badge>
            ) : (
              <Badge tone="info">subfluxo</Badge>
            )}
          </div>
          <div className="flex items-center justify-between text-[12px] text-faint">
            <span>
              {f.nodeCount} blocos · editado {formatDateTime(f.updatedAt)}
            </span>
            <div className="flex items-center">
              <Button variant="ghost" size="icon" aria-label="Duplicar" onClick={() => duplicate.mutate(f)}>
                <Copy className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => window.confirm(`Excluir o fluxo "${f.name}"?`) && remove.mutate(f.id)}>
                <Trash2 className="size-3.5 text-danger" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Fluxos"
        description="Cada fluxo é um grafo de blocos (impostos, nota fiscal, SEFAZ, boleto). Publique uma versão e aponte um webhook para ela."
        actions={
          <Button variant="primary" onClick={() => { setName(''); setDescription(''); setKind('PEDIDO'); setCreating(true); }}>
            <Plus className="size-4" /> Novo fluxo
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted uppercase">
              <Workflow className="size-4" /> Fluxos de pedido
            </h2>
            {pedidos.length ? list(pedidos) : <EmptyState title="Nenhum fluxo de pedido" />}
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-muted uppercase">
              <GitBranch className="size-4" /> Subfluxos (blocos reutilizáveis)
            </h2>
            {subs.length ? list(subs) : <EmptyState title="Nenhum subfluxo">Crie um subfluxo para agrupar várias fórmulas em um bloco.</EmptyState>}
          </section>
        </div>
      )}

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Novo fluxo"
        size="sm"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancelar</Button>
            <Button variant="primary" loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>
              Criar e abrir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Pedido com substituição tributária" />
          </Field>
          <Field label="Tipo" hint={kind === 'PEDIDO' ? 'Começa no webhook e termina na resposta.' : 'Vira um bloco que outros fluxos usam (ex.: impostos de um item).'}>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as 'PEDIDO' | 'SUBFLUXO')}
              options={[{ value: 'PEDIDO', label: 'Fluxo de pedido' }, { value: 'SUBFLUXO', label: 'Subfluxo (bloco reutilizável)' }]}
            />
          </Field>
          <Field label="Descrição">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
