import type { RequestSchemaDsl } from './webhook-schema';

/** Payload de exemplo do Sistema X (formato canônico do pedido). */
export const EXEMPLO_PEDIDO = {
  id: 'PED-1001',
  dataEmissao: '2026-09-30',
  naturezaOperacao: 'Venda de mercadoria',
  destinatario: {
    nome: 'Mercado Bom Preço Ltda',
    documento: '11222333000181',
    uf: 'SP',
    codMunicipio: '3550308',
    ie: '110042490114',
    indIEDest: 1,
    consumidorFinal: false,
  },
  itens: [
    {
      codigo: 'CAM-001',
      descricao: 'Camiseta algodão',
      ncm: '61091000',
      origem: 0,
      unidade: 'UN',
      quantidade: 10,
      valorUnitario: 100,
      frete: 50,
    },
  ],
  pagamento: { condicao: '30/60/90', primeiroVencimento: '2026-10-30', meio: '15' },
};

const money = (name: string, description?: string) => ({
  name, type: 'decimal' as const, required: false, min: 0, ...(description ? { description } : {}),
});

/** DSL do payload canônico: é o schema padrão do webhook de exemplo. */
export const EXEMPLO_REQUEST_SCHEMA: RequestSchemaDsl = {
  fields: [
    { name: 'id', type: 'string', required: true, min: 1, description: 'Identificador do pedido no sistema X' },
    { name: 'dataEmissao', type: 'date', required: true },
    { name: 'naturezaOperacao', type: 'string', required: false },
    {
      name: 'destinatario', type: 'object', required: true,
      fields: [
        { name: 'nome', type: 'string', required: true, min: 1 },
        { name: 'documento', type: 'string', required: true, format: 'cnpjOuCpf' },
        { name: 'uf', type: 'string', required: true, format: 'uf' },
        { name: 'codMunicipio', type: 'string', required: false, regex: '^\\d{7}$' },
        { name: 'ie', type: 'string', required: false },
        { name: 'indIEDest', type: 'integer', required: true, min: 1, max: 9 },
        { name: 'consumidorFinal', type: 'boolean', required: true },
      ],
    },
    {
      name: 'itens', type: 'array', required: true, minItems: 1,
      items: {
        name: 'item', type: 'object', required: true,
        fields: [
          { name: 'codigo', type: 'string', required: true, min: 1 },
          { name: 'descricao', type: 'string', required: true, min: 1 },
          { name: 'ncm', type: 'string', required: true, format: 'ncm' },
          { name: 'cfop', type: 'string', required: false, format: 'cfop' },
          { name: 'origem', type: 'integer', required: true, min: 0, max: 8 },
          { name: 'unidade', type: 'string', required: false },
          { name: 'quantidade', type: 'decimal', required: true, min: 0 },
          { name: 'valorUnitario', type: 'decimal', required: true, min: 0 },
          money('desconto'),
          money('frete'),
          money('seguro'),
          money('outrasDespesas'),
        ],
      },
    },
    {
      name: 'pagamento', type: 'object', required: false,
      fields: [
        { name: 'condicao', type: 'string', required: false, regex: '^\\d+(/\\d+)*$', description: 'Ex.: 30/60/90 ou 0 (à vista)' },
        { name: 'primeiroVencimento', type: 'date', required: false },
        { name: 'meio', type: 'string', required: false },
      ],
    },
  ],
};

/** Template de resposta padrão do webhook de exemplo. */
export const EXEMPLO_RESPONSE_TEMPLATE = {
  pedido: '{{input.id}}',
  status: 'AUTORIZADA',
  nota: {
    chaveAcesso: '{{nodes.chave.chave}}',
    numero: '{{nodes.chave.numero}}',
    protocolo: '{{nodes.sefaz.autorizacao.nProt}}',
    xml: '{{nodes.xml.xml}}',
  },
  totais: '{{nodes.totalizar.totais}}',
  impostosPorItem: '{{nodes.itens.resultados}}',
  financeiro: {
    parcelas: '{{nodes.parcelas.parcelas}}',
    boletos: '{{nodes.boleto.boletos}}',
  },
};
