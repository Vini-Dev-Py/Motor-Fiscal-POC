import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import {
  isPortCompatible, type BlockMeta, type FlowEdge, type FlowGraph, type FlowNode, type FlowNodeData, type PortDef,
} from '@motor-fiscal/shared';

export type RFNode = Node<FlowNodeData, 'block'>;

export const NODE_WIDTH = 252;
export const ROW_HEIGHT = 26;
export const HEADER_HEIGHT = 38;

/** Portas efetivas do nó (espelha o resolvePorts do motor). */
export function portsOf(data: FlowNodeData, meta?: BlockMeta): { inputs: PortDef[]; outputs: PortDef[] } {
  if (!meta) return { inputs: [], outputs: [] };
  switch (meta.dynamicPorts) {
    case 'entrada': return { inputs: [], outputs: data.outputs ?? meta.outputs };
    case 'saida': return { inputs: data.inputs ?? [], outputs: [] };
    case 'codigo':
    case 'subfluxo': return { inputs: data.inputs ?? [], outputs: data.outputs ?? [] };
    default: return { inputs: meta.inputs, outputs: meta.outputs };
  }
}

export const nodeHeight = (data: FlowNodeData, meta?: BlockMeta) => {
  const p = portsOf(data, meta);
  return HEADER_HEIGHT + 14 + Math.max(p.inputs.length, p.outputs.length, 1) * ROW_HEIGHT;
};

export const toRFNodes = (nodes: FlowNode[]): RFNode[] =>
  nodes.map((n) => ({ id: n.id, type: 'block', position: n.position, data: n.data }));

export const toRFEdges = (edges: FlowEdge[]): Edge[] =>
  edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle }));

/** Serializa para o formato salvo no banco (sem estado interno do React Flow nem status de execução). */
export function toGraph(nodes: RFNode[], edges: Edge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: 'block', position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
    edges: edges
      .filter((e) => e.sourceHandle && e.targetHandle)
      .map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle!, target: e.target, targetHandle: e.targetHandle! })),
  };
}

/** Criar uma ligação de `source` para `target` fecharia um ciclo? */
export function createsCycle(edges: Array<{ source: string; target: string }>, source: string, target: string): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(out.get(cur) ?? []));
  }
  return false;
}

export function portCompatible(from: PortDef | undefined, to: PortDef | undefined): boolean {
  return !!from && !!to && isPortCompatible(from.type, to.type);
}

/** Gera um id legível e único (aparece nos caminhos do template: nodes.<id>.<porta>). */
export function uniqueNodeId(blockKey: string, label: string | undefined, existing: string[]): string {
  const raw = (label ?? blockKey.split('.').pop() ?? 'bloco').normalize('NFD').replace(/[̀-ͯ]/g, '');
  // "ICMS" → icms · "Totalizar nota" → totalizarNota · "Impostos do item" → impostosDoItem
  const base =
    (/^[A-Z0-9 \-/]+$/.test(raw) ? raw.toLowerCase() : raw)
      .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
      .replace(/^./, (c) => c.toLowerCase()) || 'bloco';
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}${i}`)) i++;
  return `${base}${i}`;
}

/** Organiza o grafo da esquerda para a direita. */
export function autoLayout(nodes: RFNode[], edges: Edge[], metaOf: (key: string) => BlockMeta | undefined): RFNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 36, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n.data, metaOf(n.data.blockKey)) });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    const h = nodeHeight(n.data, metaOf(n.data.blockKey));
    return { ...n, position: { x: p.x - NODE_WIDTH / 2, y: p.y - h / 2 } };
  });
}

export const DEFAULT_CODE_PORTS = {
  inputs: [{ id: 'valor', label: 'Valor', type: 'decimal', required: true }] as PortDef[],
  outputs: [{ id: 'resultado', label: 'Resultado', type: 'decimal', required: true }] as PortDef[],
};

export const DEFAULT_ENTRADA_PORTS: PortDef[] = [
  { id: 'item', label: 'Item', type: 'item', required: true },
  { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
];
