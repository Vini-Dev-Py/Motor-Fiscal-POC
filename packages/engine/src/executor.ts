import {
  isPortCompatible, validatePortValue,
  type FlowEdge, type FlowGraph, type FlowNode, type GraphIssue, type PortDef, type TraceEntry,
} from '@motor-fiscal/shared';
import { dec } from './money';
import { defaultRegistry, type BlockRegistry } from './registry';
import {
  BlockError, FiscalRejection,
  type BlockDef, type BlockRunCtx, type EngineContext, type FlowRunResult, type OverrideEntry, type RunFlowOptions,
} from './types';

type SubGraph = { nodes: FlowNode[]; edges: FlowEdge[]; name?: string };

const isRequired = (p: PortDef) => p.required !== false;

// ---------------------------------------------------------------------------
// Portas e overrides
// ---------------------------------------------------------------------------

/** Portas efetivas de um nó (blocos dinâmicos usam as portas declaradas no próprio nó). */
export function resolvePorts(node: FlowNode, def: BlockDef | undefined): { inputs: PortDef[]; outputs: PortDef[] } {
  if (!def) return { inputs: [], outputs: [] };
  switch (def.dynamicPorts) {
    case 'entrada':
      return { inputs: [], outputs: node.data.outputs ?? def.outputs };
    case 'saida':
      return { inputs: node.data.inputs ?? [], outputs: [] };
    case 'codigo':
    case 'subfluxo':
      return { inputs: node.data.inputs ?? [], outputs: node.data.outputs ?? [] };
    default:
      return { inputs: def.inputs, outputs: def.outputs };
  }
}

/** Override ativo e vigente em `date` para o bloco (o de vigência mais recente vence). */
export function findOverride(overrides: OverrideEntry[], blockKey: string, date: string): OverrideEntry | null {
  const d = date.slice(0, 10);
  const hits = overrides
    .filter((o) => o.active && o.blockKey === blockKey && o.validFrom <= d && (!o.validTo || d <= o.validTo))
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
  return hits[0] ?? null;
}

const nodeParams = (node: FlowNode): Record<string, unknown> => ({
  ...(node.data.params ?? {}),
  ...(node.data.flowId ? { flowId: node.data.flowId } : {}),
});

// ---------------------------------------------------------------------------
// Validação do grafo
// ---------------------------------------------------------------------------

const SUBFLOW_BLOCKS = ['flow.subfluxo', 'flow.paraCadaItem'];

function checkGraph(
  nodes: FlowNode[], edges: FlowEdge[], prefix: string, isSub: boolean,
  subflows: Record<string, SubGraph>, reg: BlockRegistry, out: GraphIssue[],
): void {
  const err = (message: string, extra: Partial<GraphIssue> = {}) => out.push({ level: 'error', message: prefix + message, ...extra });
  const warn = (message: string, extra: Partial<GraphIssue> = {}) => out.push({ level: 'warning', message: prefix + message, ...extra });

  const byId = new Map<string, FlowNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) err(`Nó duplicado: ${n.id}`, { nodeId: n.id });
    byId.set(n.id, n);
  }

  const triggers = nodes.filter((n) => n.data.blockKey === 'trigger.webhook');
  if (!isSub) {
    if (triggers.length === 0) err('O fluxo precisa de um bloco "Webhook recebido"');
    if (triggers.length > 1) err('Só pode haver um bloco "Webhook recebido"');
  } else {
    if (triggers.length > 0) err('Subfluxos não podem ter gatilho de webhook');
    if (nodes.filter((n) => n.data.blockKey === 'sub.entrada').length !== 1) err('O subfluxo precisa de exatamente uma "Entrada do subfluxo"');
    if (nodes.filter((n) => n.data.blockKey === 'sub.saida').length < 1) err('O subfluxo precisa de uma "Saída do subfluxo"');
  }

  for (const n of nodes) {
    const def = reg.get(n.data.blockKey);
    const nm = n.data.label ?? n.id;
    if (!def) { err(`Bloco desconhecido "${n.data.blockKey}" (${nm})`, { nodeId: n.id }); continue; }
    const p = def.params.safeParse(nodeParams(n));
    if (!p.success) {
      err(`${nm}: parâmetros inválidos — ${p.error.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ')}`, { nodeId: n.id });
    }
    if (SUBFLOW_BLOCKS.includes(def.key)) {
      const fid = n.data.flowId;
      if (!fid) err(`${nm}: selecione o subfluxo`, { nodeId: n.id });
      else if (!subflows[fid]) err(`${nm}: subfluxo "${fid}" não encontrado`, { nodeId: n.id });
    }
    if (def.key === 'logic.codigo' && !String((n.data.params as { code?: string } | undefined)?.code ?? '').trim()) {
      warn(`${nm}: bloco de código sem código`, { nodeId: n.id });
    }
  }

  const connected = new Map<string, Set<string>>();
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) { err(`Conexão aponta para nó inexistente (${e.id})`, { edgeId: e.id }); continue; }
    const sp = resolvePorts(s, reg.get(s.data.blockKey)).outputs.find((x) => x.id === e.sourceHandle);
    const tp = resolvePorts(t, reg.get(t.data.blockKey)).inputs.find((x) => x.id === e.targetHandle);
    if (!sp) { err(`${s.data.label ?? s.id}: saída "${e.sourceHandle}" não existe`, { edgeId: e.id }); continue; }
    if (!tp) { err(`${t.data.label ?? t.id}: entrada "${e.targetHandle}" não existe`, { edgeId: e.id }); continue; }
    if (!isPortCompatible(sp.type, tp.type)) {
      err(`Tipos incompatíveis: ${s.data.label ?? s.id}.${sp.label} (${sp.type}) → ${t.data.label ?? t.id}.${tp.label} (${tp.type})`, { edgeId: e.id });
    }
    const set = connected.get(t.id) ?? new Set<string>();
    set.add(e.targetHandle);
    connected.set(t.id, set);
  }

  for (const n of nodes) {
    const def = reg.get(n.data.blockKey);
    if (!def) continue;
    for (const port of resolvePorts(n, def).inputs) {
      if (isRequired(port) && port.default === undefined && !connected.get(n.id)?.has(port.id)) {
        err(`${n.data.label ?? n.id}: a entrada "${port.label}" é obrigatória e não está conectada`, { nodeId: n.id });
      }
    }
  }

  try {
    topoOrder(nodes, edges.filter((e) => byId.has(e.source) && byId.has(e.target)));
  } catch {
    err('O fluxo contém um ciclo (um bloco depende dele mesmo)');
  }
}

/** Valida o grafo (inclusive os subfluxos embutidos). Retorna a lista de problemas. */
export function validateGraph(graph: FlowGraph, registry: BlockRegistry = defaultRegistry): GraphIssue[] {
  const out: GraphIssue[] = [];
  const subflows = graph.subflows ?? {};
  checkGraph(graph.nodes, graph.edges, '', false, subflows, registry, out);
  for (const [id, sub] of Object.entries(subflows)) {
    checkGraph(sub.nodes, sub.edges, `Subfluxo "${sub.name ?? id}": `, true, subflows, registry, out);
  }
  return out;
}

/** Valida a estrutura de um subfluxo isolado (entrada/saída em vez de gatilho de webhook). */
export function validateSubflowGraph(
  sub: { nodes: FlowNode[]; edges: FlowEdge[]; subflows?: FlowGraph['subflows'] },
  registry: BlockRegistry = defaultRegistry,
): GraphIssue[] {
  const out: GraphIssue[] = [];
  const subflows = sub.subflows ?? {};
  checkGraph(sub.nodes, sub.edges, '', true, subflows, registry, out);
  for (const [id, s] of Object.entries(subflows)) {
    checkGraph(s.nodes, s.edges, `Subfluxo "${s.name ?? id}": `, true, subflows, registry, out);
  }
  return out;
}

function topoOrder(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: FlowNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const next of out.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.length) throw new BlockError('O fluxo contém um ciclo', 'GRAFO_CICLICO');
  return order;
}

// ---------------------------------------------------------------------------
// Execução de um bloco
// ---------------------------------------------------------------------------

function validateInputs(ports: PortDef[], inputs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const port of ports) {
    const v = inputs[port.id];
    if (v === undefined || v === null) {
      if (isRequired(port)) throw new BlockError(`Entrada obrigatória sem valor: "${port.label}"`, 'ENTRADA_AUSENTE');
      continue;
    }
    const r = validatePortValue(port.type, v);
    if (!r.ok) throw new BlockError(`Entrada "${port.label}" inválida: ${r.message}`, 'ENTRADA_INVALIDA');
    out[port.id] = r.value;
  }
  return out;
}

function validateOutputs(def: BlockDef, ports: PortDef[], raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') {
    throw new BlockError('O bloco não devolveu um objeto com as saídas', 'SAIDA_INVALIDA');
  }
  const out: Record<string, unknown> = {};
  for (const port of ports) {
    const v = raw[port.id];
    if (v === undefined || v === null) {
      if (isRequired(port)) throw new BlockError(`Saída "${port.label}" não foi produzida`, 'SAIDA_AUSENTE');
      continue;
    }
    const r = validatePortValue(port.type, v);
    if (!r.ok) throw new BlockError(`Saída "${port.label}" fora do contrato: ${r.message}`, 'SAIDA_INVALIDA');
    out[port.id] = r.value;
  }
  if (def.branching && typeof raw.__ativo === 'string') out.__ativo = raw.__ativo;
  return out;
}

interface ExecuteArgs {
  def: BlockDef;
  ports: { inputs: PortDef[]; outputs: PortDef[] };
  params: Record<string, unknown>;
  inputs: Record<string, unknown>;
  ctx: EngineContext;
  payload?: unknown;
  runSubflow?: BlockRunCtx['runSubflow'];
  /** undefined = resolver pela vigência; null = forçar sem override. */
  override?: OverrideEntry | null;
}

async function executeBlock(a: ExecuteArgs) {
  const { def, ctx } = a;
  const ov =
    a.override !== undefined
      ? a.override
      : def.overridable !== false && !def.dynamicPorts
        ? findOverride(ctx.overrides ?? [], def.key, ctx.referenceDate)
        : null;

  const merged = ov?.params && Object.keys(ov.params).length ? { ...a.params, ...ov.params } : a.params;
  const parsed = def.params.safeParse(merged);
  if (!parsed.success) {
    throw new BlockError(
      'Parâmetros inválidos',
      'PARAMS_INVALIDOS',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  const logs: string[] = [];
  const runCtx: BlockRunCtx = {
    tenant: ctx.tenant,
    tables: ctx.tables,
    services: ctx.services,
    referenceDate: ctx.referenceDate,
    D: dec,
    log: (m) => void logs.push(m),
    payload: a.payload,
    runSubflow:
      a.runSubflow ??
      (() => {
        throw new BlockError('Subfluxos não estão disponíveis neste contexto', 'SEM_SUBFLUXO');
      }),
    runCode: async (code, inputs, params) => {
      if (!ctx.runner) throw new BlockError('Nenhum executor de código configurado', 'SEM_RUNNER');
      try {
        return await ctx.runner.run({
          code,
          inputs,
          params,
          tabela: (nome, chaves) => ctx.tables.lookup(nome, chaves, ctx.referenceDate) ?? null,
        });
      } catch (e) {
        if (e instanceof BlockError) throw e;
        throw new BlockError(`Erro no código: ${(e as Error).message}`, 'CODIGO_ERRO');
      }
    },
  };

  const useCode = !!ov?.code && ov.code.trim().length > 0;
  const raw = useCode
    ? await runCtx.runCode(ov!.code!, a.inputs, parsed.data as Record<string, unknown>)
    : await def.run({ inputs: a.inputs, params: parsed.data, ctx: runCtx });

  return {
    outputs: validateOutputs(def, a.ports.outputs, raw),
    override: ov
      ? { id: ov.id, name: ov.name, legalBasis: ov.legalBasis, kind: (useCode ? 'codigo' : 'parametros') as 'codigo' | 'parametros' }
      : undefined,
    logs,
  };
}

/**
 * Executa um único bloco fora de um fluxo (usado para testar overrides lado a lado com o bloco padrão).
 * `override: null` força o bloco padrão; omitido, resolve o override vigente.
 */
export async function runBlockOnce(args: {
  blockKey: string;
  inputs: Record<string, unknown>;
  params?: Record<string, unknown>;
  ctx: EngineContext;
  override?: OverrideEntry | null;
  registry?: BlockRegistry;
}): Promise<{ outputs: Record<string, unknown>; override?: TraceEntry['override']; durationMs: number }> {
  const def = (args.registry ?? defaultRegistry).get(args.blockKey);
  if (!def) throw new BlockError(`Bloco desconhecido: ${args.blockKey}`, 'BLOCO_DESCONHECIDO');
  const t0 = Date.now();
  const ports = { inputs: def.inputs, outputs: def.outputs };
  const r = await executeBlock({
    def, ports,
    params: args.params ?? {},
    inputs: validateInputs(ports.inputs, args.inputs),
    ctx: args.ctx,
    override: args.override,
  });
  return { outputs: r.outputs, override: r.override, durationMs: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Execução do grafo
// ---------------------------------------------------------------------------

class GraphFailure extends Error {
  constructor(
    public readonly trace: TraceEntry[],
    public readonly nodes: Record<string, Record<string, unknown>>,
    public readonly failure: unknown,
    public readonly nodeId: string,
  ) {
    super(failure instanceof Error ? failure.message : String(failure));
  }
}

interface RunGraphArgs {
  nodes: FlowNode[];
  edges: FlowEdge[];
  subflows: Record<string, SubGraph>;
  ctx: EngineContext;
  reg: BlockRegistry;
  counter: { runs: number };
  depth: number;
  payload?: unknown;
  flowInputs?: Record<string, unknown>;
}

const MAX_DEPTH = 4;

async function runGraph(a: RunGraphArgs): Promise<{ nodes: Record<string, Record<string, unknown>>; trace: TraceEntry[]; outputs: Record<string, unknown> }> {
  const order = topoOrder(a.nodes, a.edges);
  const values: Record<string, Record<string, unknown>> = {};
  const inactive = new Map<string, Set<string>>();
  const skipped = new Set<string>();
  const trace: TraceEntry[] = [];
  const flowOutputs: Record<string, unknown> = {};
  const maxRuns = a.ctx.maxNodeRuns ?? 5000;

  for (const node of order) {
    const def = a.reg.get(node.data.blockKey);
    const entry: TraceEntry = {
      nodeId: node.id,
      blockKey: node.data.blockKey,
      label: node.data.label ?? def?.label ?? node.data.blockKey,
      status: 'ok',
      durationMs: 0,
    };
    const fail = (err: unknown, t0: number): never => {
      entry.status = 'error';
      entry.durationMs = Date.now() - t0;
      const e = err instanceof BlockError ? err : new BlockError((err as Error)?.message ?? String(err), 'ERRO_INTERNO');
      entry.error = { message: e.message, code: e.code, ...(e.details !== undefined ? { details: e.details } : {}) };
      trace.push(entry);
      throw new GraphFailure(trace, values, err, node.id);
    };

    const t0 = Date.now();
    if (!def) return fail(new BlockError(`Bloco desconhecido: ${node.data.blockKey}`, 'BLOCO_DESCONHECIDO'), t0);
    const ports = resolvePorts(node, def);

    // -- entradas: cada porta pode receber várias arestas; vale a primeira ativa com valor.
    const incoming = a.edges.filter((e) => e.target === node.id);
    const inputs: Record<string, unknown> = {};
    let skip = false;
    for (const port of ports.inputs) {
      const es = incoming.filter((e) => e.targetHandle === port.id);
      let val: unknown;
      let anyActive = false;
      for (const e of es) {
        const active = !skipped.has(e.source) && !inactive.get(e.source)?.has(e.sourceHandle);
        if (!active) continue;
        anyActive = true;
        const v = values[e.source]?.[e.sourceHandle];
        if (val === undefined && v !== undefined) val = v;
      }
      // ramo inativo alimentando uma entrada obrigatória → este nó não executa
      if (es.length > 0 && !anyActive && isRequired(port)) skip = true;
      if (val === undefined && port.default !== undefined) val = port.default;
      inputs[port.id] = val;
    }
    if (skip) {
      entry.status = 'skipped';
      trace.push(entry);
      skipped.add(node.id);
      continue;
    }

    if (++a.counter.runs > maxRuns) {
      return fail(new BlockError(`Limite de ${maxRuns} execuções de bloco excedido`, 'LIMITE_EXECUCAO'), t0);
    }

    const children: NonNullable<TraceEntry['children']> = [];
    const runSubflow: BlockRunCtx['runSubflow'] = async (flowId, subInputs, label) => {
      const sub = a.subflows[flowId];
      if (!sub) throw new BlockError(`Subfluxo "${flowId}" não encontrado`, 'SUBFLUXO_AUSENTE');
      if (a.depth >= MAX_DEPTH) throw new BlockError('Profundidade máxima de subfluxos excedida', 'LIMITE_PROFUNDIDADE');
      const childLabel = label ?? sub.name ?? flowId;
      try {
        const r = await runGraph({ ...a, nodes: sub.nodes, edges: sub.edges, flowInputs: subInputs, depth: a.depth + 1, payload: undefined });
        children.push({ label: childLabel, trace: r.trace });
        return r.outputs;
      } catch (e) {
        if (e instanceof GraphFailure) {
          children.push({ label: childLabel, trace: e.trace });
          throw e.failure;
        }
        throw e;
      }
    };

    try {
      if (def.key === 'sub.entrada') {
        const given = a.flowInputs ?? {};
        const out: Record<string, unknown> = {};
        for (const p of ports.outputs) {
          const v = given[p.id];
          if (v === undefined || v === null) {
            if (isRequired(p)) throw new BlockError(`Subfluxo chamado sem a entrada "${p.label}"`, 'ENTRADA_AUSENTE');
            continue;
          }
          out[p.id] = v;
        }
        values[node.id] = out;
        entry.outputs = out;
      } else if (def.key === 'sub.saida') {
        const out = validateInputs(ports.inputs, inputs);
        Object.assign(flowOutputs, out);
        values[node.id] = {};
        entry.inputs = out;
      } else {
        const validated = validateInputs(ports.inputs, inputs);
        entry.inputs = validated;
        const r = await executeBlock({
          def, ports,
          params: nodeParams(node),
          inputs: validated,
          ctx: a.ctx,
          payload: a.payload,
          runSubflow,
        });
        const { __ativo, ...outputs } = r.outputs as Record<string, unknown> & { __ativo?: string };
        values[node.id] = outputs;
        entry.outputs = outputs;
        if (r.override) entry.override = r.override;
        if (r.logs.length) entry.logs = r.logs;
        if (def.branching) {
          inactive.set(node.id, new Set(ports.outputs.map((p) => p.id).filter((id) => id !== __ativo)));
        }
      }
    } catch (err) {
      if (children.length) entry.children = children;
      return fail(err, t0);
    }

    if (children.length) entry.children = children;
    entry.durationMs = Date.now() - t0;
    trace.push(entry);
  }

  return { nodes: values, trace, outputs: flowOutputs };
}

/** Executa um fluxo (grafo já publicado ou rascunho com subfluxos embutidos). */
export async function runFlow(opts: RunFlowOptions & { registry?: BlockRegistry }): Promise<FlowRunResult> {
  const started = Date.now();
  try {
    const r = await runGraph({
      nodes: opts.graph.nodes,
      edges: opts.graph.edges,
      subflows: opts.graph.subflows ?? {},
      ctx: opts.ctx,
      reg: opts.registry ?? defaultRegistry,
      counter: { runs: 0 },
      depth: 0,
      payload: opts.payload,
    });
    return { status: 'OK', nodes: r.nodes, trace: r.trace, durationMs: Date.now() - started };
  } catch (e) {
    if (e instanceof GraphFailure) {
      const cause = e.failure;
      const be = cause instanceof BlockError ? cause : new BlockError((cause as Error)?.message ?? String(cause), 'ERRO_INTERNO');
      return {
        status: cause instanceof FiscalRejection ? 'REJEITADA' : 'ERRO',
        nodes: e.nodes,
        trace: e.trace,
        error: { message: be.message, code: be.code, nodeId: e.nodeId, ...(be.details !== undefined ? { details: be.details } : {}) },
        durationMs: Date.now() - started,
      };
    }
    throw e;
  }
}

