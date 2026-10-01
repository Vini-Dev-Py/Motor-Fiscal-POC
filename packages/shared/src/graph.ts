import { z } from 'zod';
import { portDefSchema, type PortDef } from './ports';

/**
 * Formato do grafo de um fluxo. É compatível com o React Flow
 * (nodes com `position`/`data`, edges com `sourceHandle`/`targetHandle`).
 */
export interface FlowNodeData {
  /** Chave do bloco no catálogo (ex.: `tax.icms`). */
  blockKey: string;
  label?: string;
  params?: Record<string, unknown>;
  /** Portas dinâmicas (logic.codigo, sub.entrada, sub.saida, flow.subfluxo). */
  inputs?: PortDef[];
  outputs?: PortDef[];
  /** Fluxo referenciado (flow.subfluxo / flow.paraCadaItem). */
  flowId?: string;
  [extra: string]: unknown;
}

export interface FlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Subfluxos embutidos no momento da publicação (id do fluxo → grafo). */
  subflows?: Record<string, { nodes: FlowNode[]; edges: FlowEdge[]; name?: string }>;
}

const nodeSchema: z.ZodType<FlowNode> = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z
    .object({
      blockKey: z.string().min(1),
      label: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
      inputs: z.array(portDefSchema).optional(),
      outputs: z.array(portDefSchema).optional(),
      flowId: z.string().optional(),
    })
    .passthrough(),
}) as unknown as z.ZodType<FlowNode>;

const edgeSchema: z.ZodType<FlowEdge> = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
});

const subflowSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  name: z.string().optional(),
});

export const flowGraphSchema: z.ZodType<FlowGraph> = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  subflows: z.record(z.string(), subflowSchema).optional(),
});

export const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };
