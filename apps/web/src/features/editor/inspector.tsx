import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PORT_TYPES, PORT_TYPE_LABELS, type BlockMeta, type FlowNodeData, type GraphIssue, type PortDef, type TraceEntry } from '@motor-fiscal/shared';
import { api, type FlowSummary, type Override } from '@/lib/api';
import { PORT_COLORS, formatDate, formatMs } from '@/lib/utils';
import { Badge, Button, CopyButton, Field, Input, JsonBlock, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { CodeEditor } from '@/components/code-editor';
import { TraceTree } from '@/components/trace';
import { PortsEditor, SchemaForm } from './schema-form';
import type { RFNode } from './graph-utils';

export interface InspectorProps {
  node: RFNode | null;
  meta: BlockMeta | undefined;
  flowKind: 'PEDIDO' | 'SUBFLUXO';
  subflows: FlowSummary[];
  overrides: Override[];
  traceEntry: TraceEntry | undefined;
  hasRun: boolean;
  issues: GraphIssue[];
  tab: string;
  onTab: (t: string) => void;
  onChangeData: (id: string, updater: (d: FlowNodeData) => FlowNodeData) => void;
  onDelete: (id: string) => void;
  onSelectNode: (id: string) => void;
}

export function Inspector(p: InspectorProps) {
  const { node, meta } = p;

  if (!node) {
    return (
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">Como usar</h3>
        <ul className="space-y-1.5 text-[12.5px] text-muted">
          <li>• Arraste blocos da paleta para o canvas.</li>
          <li>• Ligue uma saída (direita) a uma entrada (esquerda). Só tipos compatíveis se conectam.</li>
          <li>• Várias ligações na mesma entrada: vale a do ramo ativo.</li>
          <li>• Clique num bloco para configurar; use <b>Testar</b> para ver o resultado de cada bloco.</li>
        </ul>
        <h3 className="mt-5 mb-2 text-[13px] font-semibold">Tipos de dado</h3>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {PORT_TYPES.map((t) => (
            <div key={t} className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="size-2.5 rounded-full" style={{ background: PORT_COLORS[t] }} />
              {PORT_TYPE_LABELS[t]}
            </div>
          ))}
        </div>
        {p.issues.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-[13px] font-semibold">Validação</h3>
            <IssueList issues={p.issues} onSelectNode={p.onSelectNode} />
          </>
        )}
      </aside>
    );
  }

  const data = node.data;
  const set = (patch: Partial<FlowNodeData>) => p.onChangeData(node.id, (d) => ({ ...d, ...patch }));
  const params = (data.params ?? {}) as Record<string, unknown>;
  const myIssues = p.issues.filter((i) => i.nodeId === node.id);

  const chooseSubflow = async (flowId: string) => {
    const sub = p.subflows.find((s) => s.id === flowId);
    if (data.blockKey === 'flow.paraCadaItem') {
      set({ flowId, ...(sub ? {} : {}) });
      return;
    }
    try {
      const ports = await api.get<{ inputs: PortDef[]; outputs: PortDef[] }>(`/api/flows/${flowId}/ports`);
      set({ flowId, inputs: ports.inputs, outputs: ports.outputs, label: sub?.name ?? data.label });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
      <Tabs value={p.tab} onValueChange={p.onTab} className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{meta?.label ?? data.blockKey}</div>
              <div className="font-mono text-[11px] text-faint">{data.blockKey}</div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Remover bloco" onClick={() => p.onDelete(node.id)}>
              <Trash2 className="size-4 text-danger" />
            </Button>
          </div>
          <TabsList className="mt-2">
            <TabsTrigger value="config">Configurar</TabsTrigger>
            <TabsTrigger value="result">Resultado</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TabsContent value="config" className="space-y-4">
            {myIssues.map((i, k) => (
              <div key={k} className="flex items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {i.message}
              </div>
            ))}
            {meta?.description && <p className="text-[12.5px] leading-relaxed text-muted">{meta.description}</p>}
            {meta?.formula && <div className="rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed">{meta.formula}</div>}

            {p.overrides.length > 0 && (
              <div className="rounded-lg border border-warn/40 bg-warn-soft px-2.5 py-2 text-[12px] text-warn">
                <div className="flex items-center gap-1.5 font-semibold"><ShieldAlert className="size-3.5" /> Override desta empresa</div>
                <ul className="mt-1 space-y-0.5">
                  {p.overrides.map((o) => (
                    <li key={o.id}>{o.name} — {formatDate(o.validFrom)} → {o.validTo ? formatDate(o.validTo) : 'sem fim'}</li>
                  ))}
                </ul>
                <div className="mt-1 opacity-80">Dentro da vigência, o override substitui os parâmetros/código deste bloco.</div>
              </div>
            )}

            <Field label="Nome do bloco">
              <Input value={data.label ?? ''} placeholder={meta?.label} onChange={(e) => set({ label: e.target.value || undefined })} />
            </Field>
            <div>
              <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
                <span>Id no fluxo</span>
                <CopyButton text={`nodes.${node.id}`} label="" />
              </div>
              <div className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[12px]">{node.id}</div>
              <div className="mt-1 text-[11.5px] text-faint">Use no template: <span className="font-mono">{`{{nodes.${node.id}.<porta>}}`}</span></div>
            </div>

            {(data.blockKey === 'flow.paraCadaItem' || data.blockKey === 'flow.subfluxo') && (
              <Field label="Subfluxo" required hint={data.blockKey === 'flow.paraCadaItem' ? 'Roda uma vez para cada item do pedido.' : 'As portas vêm da entrada/saída do subfluxo.'}>
                <Select
                  value={data.flowId}
                  onValueChange={(v) => void chooseSubflow(v)}
                  options={p.subflows.map((s) => ({ value: s.id, label: s.name }))}
                  placeholder={p.subflows.length ? 'Escolha o subfluxo' : 'Crie um subfluxo antes'}
                />
              </Field>
            )}
            {data.blockKey === 'flow.subfluxo' && data.flowId && (
              <Button size="sm" onClick={() => void chooseSubflow(data.flowId!)}>Atualizar portas do subfluxo</Button>
            )}

            {data.blockKey === 'logic.codigo' && (
              <>
                <PortsEditor title="Entradas" ports={data.inputs ?? []} onChange={(inputs) => set({ inputs })} />
                <PortsEditor title="Saídas" ports={data.outputs ?? []} onChange={(outputs) => set({ outputs })} />
                <div>
                  <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Código JavaScript</div>
                  <CodeEditor language="javascript" value={String(params.code ?? '')} onChange={(code) => set({ params: { ...params, code } })} height={300} />
                  <p className="mt-1 text-[11.5px] text-muted">Roda isolado (1 s · 32 MB, sem rede). Devolva um objeto com as saídas declaradas.</p>
                </div>
              </>
            )}
            {data.blockKey === 'sub.entrada' && <PortsEditor title="Portas de entrada do subfluxo" ports={data.outputs ?? []} onChange={(outputs) => set({ outputs })} />}
            {data.blockKey === 'sub.saida' && <PortsEditor title="Portas de saída do subfluxo" ports={data.inputs ?? []} onChange={(inputs) => set({ inputs })} />}

            {meta && !meta.dynamicPorts && meta.key !== 'flow.paraCadaItem' && (
              <div>
                <div className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Parâmetros</div>
                <SchemaForm schema={meta.paramsSchema} value={params} onChange={(v) => set({ params: v })} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="result" className="space-y-3">
            {!p.hasRun ? (
              <p className="py-8 text-center text-[12.5px] text-muted">Clique em <b>Testar</b> para ver as entradas e saídas deste bloco.</p>
            ) : !p.traceEntry ? (
              <p className="py-8 text-center text-[12.5px] text-muted">Este bloco não foi alcançado no último teste.</p>
            ) : (
              <NodeResult entry={p.traceEntry} />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function NodeResult({ entry }: { entry: TraceEntry }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {entry.status === 'ok' && <Badge tone="ok"><CheckCircle2 className="size-3" /> executado</Badge>}
        {entry.status === 'skipped' && <Badge>ignorado (ramo inativo)</Badge>}
        {entry.status === 'error' && <Badge tone="danger">erro</Badge>}
        {entry.status !== 'skipped' && <span className="font-mono text-[11.5px] text-faint">{formatMs(entry.durationMs)}</span>}
      </div>
      {entry.status === 'error' || entry.children?.length || entry.override ? <TraceTree trace={[entry]} /> : null}
      {entry.status === 'ok' && !entry.children?.length && !entry.override && (
        <>
          {entry.inputs && (
            <div>
              <div className="mb-1 text-[12px] font-semibold text-muted">Entradas</div>
              <JsonBlock value={entry.inputs} maxHeight={220} />
            </div>
          )}
          {entry.outputs && (
            <div>
              <div className="mb-1 text-[12px] font-semibold text-muted">Saídas</div>
              <JsonBlock value={entry.outputs} maxHeight={260} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function IssueList({ issues, onSelectNode }: { issues: GraphIssue[]; onSelectNode?: (id: string) => void }) {
  return (
    <ul className="space-y-1.5">
      {issues.map((i, k) => (
        <li
          key={k}
          className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12.5px] ${i.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'} ${i.nodeId && onSelectNode ? 'cursor-pointer' : ''}`}
          onClick={() => i.nodeId && onSelectNode?.(i.nodeId)}
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {i.message}
        </li>
      ))}
    </ul>
  );
}
