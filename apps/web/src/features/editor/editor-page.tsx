import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, LayoutGrid, Play, Rocket, Save } from 'lucide-react';
import { toast } from 'sonner';
import { EXEMPLO_PEDIDO, type FlowNodeData, type GraphIssue } from '@motor-fiscal/shared';
import { ApiError, api, errorMessage, type Flow, type PortDef, type RunResult } from '@/lib/api';
import { useBlocks, useFlow, useFlows, useInvalidate, useOverrides } from '@/lib/queries';
import { formatMs, pretty, safeJsonParse } from '@/lib/utils';
import { Badge, Button, Dialog, ErrorBox, Input, Loading, Tooltip } from '@/components/ui';
import { CodeEditor } from '@/components/code-editor';
import { ExecStatusBadge, TraceTree } from '@/components/trace';
import { BlockNode, EditorContext, type RunStatus } from './block-node';
import { Inspector, IssueList } from './inspector';
import { DND_TYPE, Palette, type PaletteItem } from './palette';
import {
  DEFAULT_CODE_PORTS, DEFAULT_ENTRADA_PORTS, autoLayout, createsCycle, portCompatible, portsOf, toGraph, toRFEdges, toRFNodes, uniqueNodeId,
  type RFNode,
} from './graph-utils';

const nodeTypes = { block: BlockNode };

const CODE_TEMPLATE = `// Receba as entradas declaradas e devolva um objeto com as saídas declaradas.
// D(x) cria decimais exatos; tabela(nome, chaves) consulta as tabelas de referência.
function calcular({ inputs, params, D, tabela }) {
  const valor = D(inputs.valor);
  return { resultado: valor.times(2).toFixed(2) };
}
`;

function EditorInner({ flow }: { flow: Flow }) {
  const { data: blocks = [] } = useBlocks();
  const { data: subflows = [] } = useFlows('SUBFLUXO');
  const { data: overrides = [] } = useOverrides();
  const invalidate = useInvalidate();
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(toRFNodes(flow.draftGraph.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRFEdges(flow.draftGraph.edges));
  const [name, setName] = useState(flow.name);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState('config');
  const [issues, setIssues] = useState<GraphIssue[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [payload, setPayload] = useState(() => pretty({ ...EXEMPLO_PEDIDO, id: `PED-${Date.now().toString(36).toUpperCase()}` }));
  const [result, setResult] = useState<RunResult | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});
  const timers = useRef<number[]>([]);

  const metaOf = useCallback((key: string) => blocks.find((b) => b.key === key), [blocks]);
  const overrideKeys = useMemo(() => new Set(overrides.filter((o) => o.active).map((o) => o.blockKey)), [overrides]);
  const issueNodes = useMemo(() => new Set(issues.filter((i) => i.level === 'error' && i.nodeId).map((i) => i.nodeId!)), [issues]);
  const ctxValue = useMemo(() => ({ metaOf, runStatus, overrideKeys, issueNodes }), [metaOf, runStatus, overrideKeys, issueNodes]);
  const isPedido = flow.kind === 'PEDIDO';

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const currentGraph = useCallback(() => toGraph(nodes, edges), [nodes, edges]);

  // -- alterações --------------------------------------------------------------------------------
  const handleNodesChange: typeof onNodesChange = (changes) => {
    onNodesChange(changes);
    if (changes.some((c) => c.type === 'position' && c.dragging === false) || changes.some((c) => c.type === 'remove' || c.type === 'add')) setDirty(true);
  };
  const handleEdgesChange: typeof onEdgesChange = (changes) => {
    onEdgesChange(changes);
    if (changes.some((c) => c.type === 'remove' || c.type === 'add')) setDirty(true);
  };

  const portOf = useCallback(
    (nodeId: string, handle: string | null | undefined, dir: 'in' | 'out'): PortDef | undefined => {
      const n = rf.getNode(nodeId) as RFNode | undefined;
      if (!n) return undefined;
      const p = portsOf(n.data, metaOf(n.data.blockKey));
      return (dir === 'out' ? p.outputs : p.inputs).find((x) => x.id === handle);
    },
    [rf, metaOf],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      if (!portCompatible(portOf(c.source, c.sourceHandle, 'out'), portOf(c.target, c.targetHandle, 'in'))) return false;
      return !createsCycle(rf.getEdges(), c.source, c.target);
    },
    [portOf, rf],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) => addEdge({ ...c, id: `${c.source}.${c.sourceHandle}->${c.target}.${c.targetHandle}` }, es));
      setDirty(true);
    },
    [setEdges],
  );

  const updateData = useCallback(
    (id: string, updater: (d: FlowNodeData) => FlowNodeData) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: updater(n.data) } : n)));
      setDirty(true);
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  // -- adicionar blocos --------------------------------------------------------------------------
  const addBlock = useCallback(
    async (item: PaletteItem, at?: { x: number; y: number }) => {
      const meta = metaOf(item.blockKey);
      if (!meta) return;
      if (item.blockKey === 'trigger.webhook' && nodes.some((n) => n.data.blockKey === 'trigger.webhook')) {
        return void toast.info('O fluxo já tem um Webhook recebido');
      }
      let data: FlowNodeData = { blockKey: item.blockKey, label: item.label, params: {} };
      if (item.blockKey === 'logic.codigo') data = { ...data, inputs: DEFAULT_CODE_PORTS.inputs, outputs: DEFAULT_CODE_PORTS.outputs, params: { code: CODE_TEMPLATE } };
      if (item.blockKey === 'sub.entrada') data = { ...data, outputs: DEFAULT_ENTRADA_PORTS };
      if (item.blockKey === 'sub.saida') data = { ...data, inputs: [{ id: 'resultado', label: 'Resultado', type: 'object', required: false }] };
      if (item.blockKey === 'flow.subfluxo' && item.flowId) {
        try {
          const ports = await api.get<{ inputs: PortDef[]; outputs: PortDef[] }>(`/api/flows/${item.flowId}/ports`);
          data = { ...data, flowId: item.flowId, inputs: ports.inputs, outputs: ports.outputs };
        } catch (e) {
          return void toast.error(errorMessage(e));
        }
      }
      const bounds = wrapper.current?.getBoundingClientRect();
      const position =
        at ?? rf.screenToFlowPosition({ x: (bounds?.left ?? 0) + (bounds?.width ?? 600) / 2 - 120, y: (bounds?.top ?? 0) + (bounds?.height ?? 400) / 2 - 60 });
      const id = uniqueNodeId(item.blockKey, item.label, rf.getNodes().map((n) => n.id));
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'block', position, data, selected: true }]);
      setSelectedId(id);
      setTab('config');
      setDirty(true);
    },
    [metaOf, nodes, rf, setNodes],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw) return;
    void addBlock(JSON.parse(raw) as PaletteItem, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => setSelectedId(sel.length === 1 ? sel[0]!.id : null), []);

  const selectNode = (id: string) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    setSelectedId(id);
    const n = rf.getNode(id);
    if (n) void rf.setCenter(n.position.x + 126, n.position.y + 40, { zoom: 1, duration: 300 });
  };

  // -- layout ------------------------------------------------------------------------------------
  const layout = () => {
    setNodes((ns) => autoLayout(ns, edges, metaOf));
    setDirty(true);
    setTimeout(() => void rf.fitView({ padding: 0.15, duration: 300 }), 30);
  };

  // -- salvar / validar / publicar ---------------------------------------------------------------
  const save = useMutation({
    mutationFn: () => api.put<Flow>(`/api/flows/${flow.id}`, { name: name.trim() || flow.name, kind: flow.kind, description: flow.description, draftGraph: currentGraph() }),
    onSuccess: () => {
      setDirty(false);
      void invalidate('flows');
      void invalidate('flow', flow.id);
      toast.success('Rascunho salvo');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const validate = useMutation({
    mutationFn: () => api.post<{ valid: boolean; issues: GraphIssue[] }>(`/api/flows/${flow.id}/validate`, { graph: currentGraph() }),
    onSuccess: (r) => {
      setIssues(r.issues);
      if (r.valid && !r.issues.length) toast.success('Fluxo válido');
      else setIssuesOpen(true);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const publish = useMutation({
    mutationFn: async () => {
      await api.put<Flow>(`/api/flows/${flow.id}`, { name: name.trim() || flow.name, kind: flow.kind, description: flow.description, draftGraph: currentGraph() });
      setDirty(false);
      return api.post<{ version: number }>(`/api/flows/${flow.id}/publish`);
    },
    onSuccess: (r) => {
      setIssues([]);
      void invalidate('flows');
      toast.success(`Versão ${r.version} publicada — os webhooks deste fluxo já usam a nova versão`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues?.length) {
        setIssues(e.issues as GraphIssue[]);
        setIssuesOpen(true);
        toast.error('O fluxo tem erros e não foi publicado');
      } else toast.error(errorMessage(e));
    },
  });

  // -- teste (execução a seco) com animação ------------------------------------------------------
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const play = (res: RunResult) => {
    clearTimers();
    setRunStatus({});
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    res.trace.forEach((e, i) => {
      const final = e.status === 'error' ? 'error' : e.status === 'skipped' ? 'skipped' : 'ok';
      if (reduce) return void setRunStatus((s) => ({ ...s, [e.nodeId]: final }));
      timers.current.push(window.setTimeout(() => setRunStatus((s) => ({ ...s, [e.nodeId]: 'running' })), i * 120));
      timers.current.push(window.setTimeout(() => setRunStatus((s) => ({ ...s, [e.nodeId]: final })), i * 120 + 110));
    });
  };

  const run = useMutation({
    mutationFn: async () => {
      const p = safeJsonParse<Record<string, unknown>>(payload);
      if (!p.ok) throw new Error(`Payload inválido: ${p.error}`);
      return api.post<RunResult>(`/api/flows/${flow.id}/run`, { payload: p.value, graph: currentGraph() });
    },
    onSuccess: (res) => {
      setRunOpen(false);
      setResult(res);
      setIssues([]);
      play(res);
      if (selectedId) setTab('result');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues?.length) {
        setIssues(e.issues as GraphIssue[]);
        setRunOpen(false);
        setIssuesOpen(true);
      }
      toast.error(errorMessage(e));
    },
  });

  const clearRun = () => {
    clearTimers();
    setResult(null);
    setRunStatus({});
  };

  // -- arestas executadas (destaque verde) -------------------------------------------------------
  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const ran = runStatus[e.source] === 'ok' && (runStatus[e.target] === 'ok' || runStatus[e.target] === 'error' || runStatus[e.target] === 'running');
        return ran ? { ...e, className: 'executed', animated: runStatus[e.target] === 'running' } : e;
      }),
    [edges, runStatus],
  );

  // -- atalhos e aviso de alterações não salvas --------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  });

  const traceEntry = selected ? result?.trace.find((t) => t.nodeId === selected.id) : undefined;
  const errors = issues.filter((i) => i.level === 'error');

  return (
    <EditorContext.Provider value={ctxValue}>
      <div className="flex h-full flex-col">
        {/* barra superior */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
          <Link to="/fluxos" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Voltar aos fluxos">
            <ArrowLeft className="size-4" />
          </Link>
          <Input
            className="h-8 w-72 border-transparent bg-transparent text-[14px] font-semibold hover:border-border-strong"
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            aria-label="Nome do fluxo"
          />
          <Badge tone={isPedido ? 'accent' : 'info'}>{isPedido ? 'fluxo de pedido' : 'subfluxo'}</Badge>
          {dirty && <span className="text-[12px] text-warn">● alterações não salvas</span>}
          <div className="ml-auto flex items-center gap-2">
            <Tooltip content="Organizar automaticamente"><Button size="icon" variant="ghost" onClick={layout} aria-label="Organizar"><LayoutGrid className="size-4" /></Button></Tooltip>
            <Button size="sm" loading={validate.isPending} onClick={() => validate.mutate()}><CheckCircle2 className="size-4" /> Validar</Button>
            <Tooltip content={isPedido ? 'Executa o rascunho com um payload, sem gravar nada' : 'Teste o subfluxo pelo fluxo de pedido que o usa'}>
              <span><Button size="sm" disabled={!isPedido} onClick={() => setRunOpen(true)}><Play className="size-4" /> Testar</Button></span>
            </Tooltip>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}><Save className="size-4" /> Salvar</Button>
            {isPedido && <Button size="sm" variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}><Rocket className="size-4" /> Publicar</Button>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <Palette blocks={blocks} subflows={isPedido ? subflows : subflows.filter((s) => s.id !== flow.id)} kind={flow.kind} onAdd={(i) => void addBlock(i)} />

          <div ref={wrapper} className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}>
            <ReactFlow
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={onSelectionChange}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.2}
              maxZoom={1.6}
              deleteKeyCode={['Backspace', 'Delete']}
              defaultEdgeOptions={{ type: 'default' }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--border-strong)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!rounded-lg !border !border-border" nodeColor={() => 'var(--border-strong)'} />
            </ReactFlow>

            {result && (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-[13px] shadow-lg">
                <ExecStatusBadge status={result.status} />
                <span className="text-muted">{formatMs(result.durationMs)}</span>
                {result.error && <span className="min-w-0 flex-1 truncate text-danger" title={result.error.message}>{result.error.message}</span>}
                {!result.error && <span className="flex-1 text-muted">{result.trace.filter((t) => t.status === 'ok').length} blocos executados · {result.trace.filter((t) => t.status === 'skipped').length} ignorados</span>}
                <Button size="sm" onClick={() => setTraceOpen(true)}>Ver passo a passo</Button>
                <Button size="sm" variant="ghost" onClick={clearRun}>Limpar</Button>
              </div>
            )}
            {errors.length > 0 && !issuesOpen && (
              <button type="button" onClick={() => setIssuesOpen(true)} className="absolute top-3 left-3 cursor-pointer rounded-lg bg-danger-soft px-3 py-1.5 text-[12.5px] font-medium text-danger shadow">
                {errors.length} problema(s) no fluxo
              </button>
            )}
          </div>

          <Inspector
            node={selected}
            meta={selected ? metaOf(selected.data.blockKey) : undefined}
            flowKind={flow.kind}
            subflows={subflows.filter((s) => s.id !== flow.id)}
            overrides={selected ? overrides.filter((o) => o.blockKey === selected.data.blockKey && o.active) : []}
            traceEntry={traceEntry}
            hasRun={!!result}
            issues={issues}
            tab={tab}
            onTab={setTab}
            onChangeData={updateData}
            onDelete={deleteNode}
            onSelectNode={selectNode}
          />
        </div>

        {/* testar */}
        <Dialog
          open={runOpen}
          onOpenChange={setRunOpen}
          title="Testar fluxo"
          description="Executa o rascunho atual com este payload. Nada é gravado e a numeração real da NF-e não é consumida."
          size="lg"
          footer={<><Button onClick={() => setRunOpen(false)}>Cancelar</Button><Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}><Play className="size-4" /> Executar</Button></>}
        >
          <CodeEditor language="json" value={payload} onChange={setPayload} height={380} />
        </Dialog>

        {/* passo a passo */}
        <Dialog open={traceOpen} onOpenChange={setTraceOpen} title="Execução passo a passo" size="xl">
          {result && (
            <div className="space-y-3">
              {result.error && <ErrorBox error={new Error(`${result.error.code ?? 'ERRO'}: ${result.error.message}`)} />}
              <TraceTree trace={result.trace} onSelect={(id) => { setTraceOpen(false); selectNode(id); setTab('result'); }} selectedId={selectedId} />
            </div>
          )}
        </Dialog>

        {/* problemas de validação */}
        <Dialog open={issuesOpen} onOpenChange={setIssuesOpen} title="Validação do fluxo" description="Clique em um problema para ir até o bloco." size="md">
          {issues.length ? <IssueList issues={issues} onSelectNode={(id) => { setIssuesOpen(false); selectNode(id); }} /> : <p className="text-muted">Nenhum problema encontrado.</p>}
        </Dialog>
      </div>
    </EditorContext.Provider>
  );
}

export function FlowEditorPage() {
  const { id } = useParams();
  const { data: flow, isLoading, error } = useFlow(id);
  if (isLoading) return <Loading label="Abrindo fluxo…" />;
  if (error || !flow) return <div className="p-8"><ErrorBox error={error ?? new Error('Fluxo não encontrado')} /></div>;
  // a chave força o editor a reiniciar quando o fluxo muda
  return (
    <ReactFlowProvider>
      <EditorInner key={flow.id} flow={flow} />
    </ReactFlowProvider>
  );
}
