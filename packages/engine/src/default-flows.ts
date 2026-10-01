import type { FlowEdge, FlowGraph, FlowNode, FlowNodeData, PortDef } from '@motor-fiscal/shared';

const node = (id: string, blockKey: string, col: number, row: number, data: Partial<FlowNodeData> = {}): FlowNode => ({
  id,
  type: 'block',
  position: { x: col * 330, y: row * 170 },
  data: { blockKey, ...data },
});

const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): FlowEdge => ({
  id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

const tributoPort = (id: string, label: string): PortDef => ({ id, label, type: 'tributo', required: false });

export const NOME_SUBFLUXO_IMPOSTOS = 'Impostos do item';

/**
 * Subfluxo "Impostos do item": roda para cada item do pedido.
 * Ramifica por regime (Simples x regime normal) e junta tudo nas portas de saída.
 */
export function buildImpostosItemGraph(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const saidaPorts: PortDef[] = [
    tributoPort('icms', 'ICMS'), tributoPort('icmsSt', 'ICMS-ST'), tributoPort('difal', 'DIFAL'),
    tributoPort('fcp', 'FCP'), tributoPort('fcpSt', 'FCP-ST'), tributoPort('fcpUfDestino', 'FCP UF destino'),
    tributoPort('ipi', 'IPI'), tributoPort('pis', 'PIS'), tributoPort('cofins', 'COFINS'),
    tributoPort('cbs', 'CBS'), tributoPort('ibs', 'IBS'), tributoPort('is', 'IS'),
  ];

  const nodes: FlowNode[] = [
    node('entrada', 'sub.entrada', 0, 3, {
      label: 'Entrada',
      outputs: [
        { id: 'item', label: 'Item', type: 'item', required: true },
        { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
        { id: 'indice', label: 'Índice', type: 'integer', required: false },
      ],
    }),
    node('ipi', 'tax.ipi', 1, 0, { label: 'IPI' }),
    node('regime', 'logic.condicao', 1, 4, {
      label: 'É Simples Nacional?',
      params: { caminho: 'tenant.regime', operador: 'igual', valor: 'SIMPLES' },
    }),
    // ---- ramo Simples Nacional
    node('simplesAliq', 'simples.aliquotaEfetiva', 2, 7, { label: 'Alíquota efetiva' }),
    node('simplesIcms', 'simples.icms', 3, 7, { label: 'ICMS (Simples)', params: { csosn: '101' } }),
    // ---- ramo regime normal
    node('icms', 'tax.icms', 2, 2, { label: 'ICMS' }),
    node('transicao', 'reforma.transicaoIcms', 3, 2, { label: 'Transição do ICMS' }),
    node('icmsSt', 'tax.icmsSt', 4, 0, { label: 'ICMS-ST' }),
    node('difal', 'tax.difal', 4, 2, { label: 'DIFAL' }),
    node('fcp', 'tax.fcp', 5, 0, { label: 'FCP', params: { tipo: 'proprio' } }),
    node('fcpSt', 'tax.fcp', 5, 1, { label: 'FCP-ST', params: { tipo: 'st' } }),
    node('fcpUf', 'tax.fcp', 5, 2, { label: 'FCP UF destino', params: { tipo: 'ufDestino' } }),
    node('pis', 'tax.pis', 4, 4, { label: 'PIS' }),
    node('cofins', 'tax.cofins', 4, 5, { label: 'COFINS' }),
    // ---- reforma (comum aos regimes)
    node('is', 'reforma.is', 5, 4, { label: 'Imposto Seletivo' }),
    node('cbs', 'reforma.cbs', 6, 4, { label: 'CBS' }),
    node('ibs', 'reforma.ibs', 6, 5, { label: 'IBS' }),
    node('saida', 'sub.saida', 7, 3, { label: 'Saída', inputs: saidaPorts }),
  ];

  const edges: FlowEdge[] = [
    edge('entrada', 'item', 'ipi', 'item'), edge('entrada', 'contexto', 'ipi', 'contexto'),
    edge('entrada', 'contexto', 'regime', 'entrada'),

    // Simples
    edge('regime', 'verdadeiro', 'simplesAliq', 'contexto'),
    edge('entrada', 'item', 'simplesIcms', 'item'),
    edge('regime', 'verdadeiro', 'simplesIcms', 'contexto'),
    edge('simplesAliq', 'aliquotaIcmsSimples', 'simplesIcms', 'aliquotaIcmsSimples'),

    // Regime normal
    edge('entrada', 'item', 'icms', 'item'), edge('regime', 'falso', 'icms', 'contexto'), edge('ipi', 'ipi', 'icms', 'ipi'),
    edge('regime', 'falso', 'transicao', 'contexto'), edge('icms', 'icms', 'transicao', 'icms'),

    edge('entrada', 'item', 'icmsSt', 'item'), edge('regime', 'falso', 'icmsSt', 'contexto'),
    edge('transicao', 'icms', 'icmsSt', 'icms'), edge('ipi', 'ipi', 'icmsSt', 'ipi'),

    edge('entrada', 'item', 'difal', 'item'), edge('regime', 'falso', 'difal', 'contexto'),
    edge('transicao', 'icms', 'difal', 'icms'),

    edge('entrada', 'item', 'fcp', 'item'), edge('regime', 'falso', 'fcp', 'contexto'), edge('transicao', 'icms', 'fcp', 'icms'),
    edge('entrada', 'item', 'fcpSt', 'item'), edge('regime', 'falso', 'fcpSt', 'contexto'), edge('icmsSt', 'icmsSt', 'fcpSt', 'icmsSt'),
    edge('entrada', 'item', 'fcpUf', 'item'), edge('regime', 'falso', 'fcpUf', 'contexto'), edge('difal', 'difal', 'fcpUf', 'difal'),

    edge('entrada', 'item', 'pis', 'item'), edge('regime', 'falso', 'pis', 'contexto'), edge('transicao', 'icms', 'pis', 'icms'),
    edge('entrada', 'item', 'cofins', 'item'), edge('regime', 'falso', 'cofins', 'contexto'), edge('transicao', 'icms', 'cofins', 'icms'),

    // Reforma
    edge('entrada', 'item', 'is', 'item'), edge('entrada', 'contexto', 'is', 'contexto'),
    ...(['cbs', 'ibs'] as const).flatMap((id) => [
      edge('entrada', 'item', id, 'item'), edge('entrada', 'contexto', id, 'contexto'),
      edge('transicao', 'icms', id, 'icms'), edge('pis', 'pis', id, 'pis'), edge('cofins', 'cofins', id, 'cofins'),
      edge('difal', 'difal', id, 'difal'), edge('fcp', 'fcp', id, 'fcp'), edge('is', 'is', id, 'is'),
    ]),

    // Saída (várias arestas na mesma porta: vale a do ramo ativo)
    edge('transicao', 'icms', 'saida', 'icms'), edge('simplesIcms', 'icms', 'saida', 'icms'),
    edge('icmsSt', 'icmsSt', 'saida', 'icmsSt'), edge('difal', 'difal', 'saida', 'difal'),
    edge('fcp', 'fcp', 'saida', 'fcp'), edge('fcpSt', 'fcp', 'saida', 'fcpSt'), edge('fcpUf', 'fcp', 'saida', 'fcpUfDestino'),
    edge('ipi', 'ipi', 'saida', 'ipi'), edge('pis', 'pis', 'saida', 'pis'), edge('cofins', 'cofins', 'saida', 'cofins'),
    edge('cbs', 'cbs', 'saida', 'cbs'), edge('ibs', 'ibs', 'saida', 'ibs'), edge('is', 'is', 'saida', 'is'),
  ];
  return { nodes, edges };
}

/**
 * Fluxo "Pedido padrão": webhook → empresa/operação → impostos por item → totais → chave → parcelas →
 * XML → SEFAZ → boletos. Os ids dos nós são usados no template de resposta (`nodes.<id>.<porta>`).
 */
export function buildPedidoGraph(subfluxoImpostosId: string): FlowGraph {
  const nodes: FlowNode[] = [
    node('gatilho', 'trigger.webhook', 0, 1, { label: 'Webhook recebido' }),
    node('empresa', 'ctx.empresa', 0, 3, { label: 'Empresa emitente' }),
    node('pedido', 'ctx.pedido', 1, 1, { label: 'Normalizar pedido' }),
    node('operacao', 'ctx.operacao', 2, 2, { label: 'Operação fiscal' }),
    node('itens', 'flow.paraCadaItem', 3, 1, { label: 'Impostos por item', flowId: subfluxoImpostosId }),
    node('totalizar', 'nfe.totalizar', 4, 1, { label: 'Totalizar nota' }),
    node('chave', 'nfe.chaveAcesso', 4, 3, { label: 'Chave de acesso', params: { serie: 1 } }),
    node('parcelas', 'financeiro.parcelas', 5, 3, { label: 'Gerar parcelas' }),
    node('xml', 'nfe.montarXml', 6, 1, { label: 'Montar XML da NF-e' }),
    node('sefaz', 'sefaz.autorizar', 7, 1, { label: 'Autorizar na SEFAZ' }),
    node('boleto', 'financeiro.boleto', 8, 3, { label: 'Gerar boletos' }),
  ];
  const edges: FlowEdge[] = [
    edge('gatilho', 'payload', 'pedido', 'payload'),
    edge('pedido', 'pedido', 'operacao', 'pedido'), edge('empresa', 'empresa', 'operacao', 'empresa'),
    edge('pedido', 'itens', 'itens', 'itens'), edge('operacao', 'contexto', 'itens', 'contexto'),
    edge('itens', 'resultados', 'totalizar', 'resultados'), edge('operacao', 'contexto', 'totalizar', 'contexto'),
    edge('operacao', 'contexto', 'chave', 'contexto'), edge('pedido', 'pedido', 'chave', 'pedido'),
    edge('totalizar', 'totais', 'parcelas', 'totais'), edge('pedido', 'pedido', 'parcelas', 'pedido'),
    edge('operacao', 'contexto', 'xml', 'contexto'), edge('pedido', 'pedido', 'xml', 'pedido'),
    edge('itens', 'resultados', 'xml', 'resultados'), edge('totalizar', 'totais', 'xml', 'totais'),
    edge('chave', 'chave', 'xml', 'chave'), edge('chave', 'numero', 'xml', 'numero'), edge('chave', 'serie', 'xml', 'serie'),
    edge('parcelas', 'parcelas', 'xml', 'parcelas'),
    edge('xml', 'xml', 'sefaz', 'xml'), edge('chave', 'chave', 'sefaz', 'chave'), edge('totalizar', 'totais', 'sefaz', 'totais'),
    edge('operacao', 'contexto', 'sefaz', 'contexto'), edge('itens', 'resultados', 'sefaz', 'resultados'),
    edge('parcelas', 'parcelas', 'boleto', 'parcelas'), edge('operacao', 'contexto', 'boleto', 'contexto'),
    edge('pedido', 'pedido', 'boleto', 'pedido'), edge('sefaz', 'autorizacao', 'boleto', 'autorizacao'),
  ];
  return { nodes, edges };
}

/** Grafo completo com o subfluxo embutido (como fica numa FlowVersion publicada). */
export function buildPedidoGraphComSubfluxo(subfluxoId = 'impostos-item'): FlowGraph {
  return {
    ...buildPedidoGraph(subfluxoId),
    subflows: { [subfluxoId]: { ...buildImpostosItemGraph(), name: NOME_SUBFLUXO_IMPOSTOS } },
  };
}
