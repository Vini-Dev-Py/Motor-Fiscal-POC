import { z } from 'zod';
import { getPath, pedidoSchema, type PedidoCanonico, type UF } from '@motor-fiscal/shared';
import { dec, fix } from '../money';
import { aliquotaInterestadual, aliquotaInterna, yearOf } from '../fiscal/rules';
import { BlockError, defineBlock, type Contexto, type ItemNormalizado } from '../types';

export const triggerWebhook = defineBlock({
  key: 'trigger.webhook',
  version: 1,
  label: 'Webhook recebido',
  category: 'gatilho',
  description: 'Ponto de entrada do fluxo: entrega o payload (já validado pelo cadastro do webhook).',
  inputs: [],
  outputs: [{ id: 'payload', label: 'Payload', type: 'object', required: true }],
  params: z.object({}),
  overridable: false,
  run: ({ ctx }) => ({ payload: ctx.payload ?? {} }),
});

export const ctxEmpresa = defineBlock({
  key: 'ctx.empresa',
  version: 1,
  label: 'Empresa emitente',
  category: 'contexto',
  description: 'Dados fiscais da empresa dona do fluxo: UF, regime tributário, CRT e RBT12.',
  inputs: [],
  outputs: [{ id: 'empresa', label: 'Empresa', type: 'object', required: true }],
  params: z.object({}),
  run: ({ ctx }) => ({ empresa: ctx.tenant }),
});

const pedidoParams = z.object({
  /** campo canônico → caminho no payload (ex.: { "itens": "produtos", "id": "pedido.numero" }) */
  mapeamento: z.record(z.string(), z.string()).default({}),
  /** campo canônico do item → caminho dentro de cada item do payload (ex.: { "codigo": "sku" }) */
  mapeamentoItem: z.record(z.string(), z.string()).default({}),
});

export const ctxPedido = defineBlock({
  key: 'ctx.pedido',
  version: 1,
  label: 'Normalizar pedido',
  category: 'contexto',
  description:
    'Converte o payload do sistema de origem no pedido canônico que os blocos fiscais entendem. ' +
    'Use o mapeamento quando os nomes dos campos forem diferentes.',
  formula: 'vProd = quantidade × valorUnitario (arredondado em 2 casas)',
  inputs: [{ id: 'payload', label: 'Payload', type: 'object', required: true }],
  outputs: [
    { id: 'pedido', label: 'Pedido', type: 'pedido', required: true },
    { id: 'itens', label: 'Itens', type: 'lista', required: true },
  ],
  params: pedidoParams,
  run: ({ inputs, params }) => {
    const payload = inputs.payload as Record<string, unknown>;
    const candidate: Record<string, unknown> = { ...payload };
    for (const [campo, caminho] of Object.entries(params.mapeamento)) {
      const v = getPath(payload, caminho);
      if (v !== undefined) candidate[campo] = v;
    }
    if (Array.isArray(candidate.itens) && Object.keys(params.mapeamentoItem).length > 0) {
      candidate.itens = candidate.itens.map((it) => {
        const out: Record<string, unknown> = { ...(it as Record<string, unknown>) };
        for (const [campo, caminho] of Object.entries(params.mapeamentoItem)) {
          const v = getPath(it, caminho);
          if (v !== undefined) out[campo] = v;
        }
        return out;
      });
    }

    const parsed = pedidoSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new BlockError(
        'O payload não pôde ser convertido em pedido',
        'PEDIDO_INVALIDO',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const pedido: PedidoCanonico = parsed.data;
    const itens: ItemNormalizado[] = pedido.itens.map((it, i) => ({
      nItem: i + 1,
      codigo: it.codigo,
      descricao: it.descricao,
      ncm: it.ncm,
      ...(it.cfop ? { cfop: it.cfop } : {}),
      origem: it.origem,
      unidade: it.unidade,
      quantidade: String(it.quantidade),
      valorUnitario: String(it.valorUnitario),
      vProd: fix(dec(it.quantidade).times(dec(it.valorUnitario))),
      vDesc: fix(dec(it.desconto)),
      vFrete: fix(dec(it.frete)),
      vSeg: fix(dec(it.seguro)),
      vOutro: fix(dec(it.outrasDespesas)),
    }));
    return { pedido: { ...pedido, itens }, itens };
  },
});

export const ctxOperacao = defineBlock({
  key: 'ctx.operacao',
  version: 1,
  label: 'Operação fiscal',
  category: 'contexto',
  description:
    'Deduz o tipo da operação (interna/interestadual), se o destinatário é consumidor final/contribuinte ' +
    'e o CFOP sugerido. Gera o contexto usado por todos os blocos de imposto.',
  formula: 'idDest = 1 se UF origem = UF destino, senão 2 · CFOP: 5102 (interna) / 6102 (interestadual)',
  inputs: [
    { id: 'empresa', label: 'Empresa', type: 'object', required: true },
    { id: 'pedido', label: 'Pedido', type: 'pedido', required: true },
  ],
  outputs: [{ id: 'contexto', label: 'Contexto', type: 'contexto', required: true }],
  params: z.object({
    cfopInterno: z.string().regex(/^[1-7]\d{3}$/).default('5102'),
    cfopInterestadual: z.string().regex(/^[1-7]\d{3}$/).default('6102'),
  }),
  run: ({ inputs, params }) => {
    const tenant = inputs.empresa as Contexto['tenant'];
    const pedido = inputs.pedido as PedidoCanonico;
    const dest = pedido.destinatario;
    const interestadual = dest.uf !== tenant.uf;
    const dataEmissao = String(pedido.dataEmissao).slice(0, 10);
    const contexto: Contexto = {
      tenant,
      operacao: {
        ufOrigem: tenant.uf,
        ufDestino: dest.uf as UF,
        idDest: interestadual ? 2 : 1,
        interestadual,
        consumidorFinal: dest.consumidorFinal,
        contribuinte: dest.indIEDest === 1,
        indIEDest: dest.indIEDest,
        dataEmissao,
        ano: yearOf(dataEmissao),
        cfop: interestadual ? params.cfopInterestadual : params.cfopInterno,
      },
      destinatario: {
        nome: dest.nome,
        documento: dest.documento,
        uf: dest.uf as UF,
        ...(dest.ie ? { ie: dest.ie } : {}),
        ...(dest.codMunicipio ? { codMunicipio: dest.codMunicipio } : {}),
      },
    };
    return { contexto };
  },
});

export const lookupAliquotaIcms = defineBlock({
  key: 'lookup.aliquotaIcms',
  version: 1,
  label: 'Alíquotas de ICMS',
  category: 'lookup',
  description: 'Consulta a alíquota interestadual, a interna da UF de destino e a aplicável à operação.',
  formula: 'Interestadual: 4% (importado) · 7% (Sul/Sudeste exceto ES → N/NE/CO/ES) · 12% (demais)',
  inputs: [
    { id: 'item', label: 'Item', type: 'item', required: true },
    { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
  ],
  outputs: [
    { id: 'aliquotaInterestadual', label: 'Interestadual', type: 'percent', required: true },
    { id: 'aliquotaInterna', label: 'Interna (destino)', type: 'percent', required: true },
    { id: 'aliquotaOperacao', label: 'Da operação', type: 'percent', required: true },
  ],
  params: z.object({}),
  run: ({ inputs, ctx }) => {
    const c = inputs.contexto as Contexto;
    const item = inputs.item as ItemNormalizado;
    const inter = aliquotaInterestadual(c.operacao.ufOrigem, c.operacao.ufDestino, item.origem);
    const interna = aliquotaInterna(ctx.tables, c.operacao.ufDestino, c.operacao.dataEmissao);
    return {
      aliquotaInterestadual: inter.toFixed(),
      aliquotaInterna: interna.toFixed(),
      aliquotaOperacao: (c.operacao.interestadual ? inter : interna).toFixed(),
    };
  },
});

export const lookupTabela = defineBlock({
  key: 'lookup.tabela',
  version: 1,
  label: 'Consultar tabela',
  category: 'lookup',
  description:
    'Consulta genérica às tabelas de referência com vigência (alíquotas, MVA, TIPI...). ' +
    'A data usada é a de emissão, então reprocessar um pedido antigo dá o mesmo resultado.',
  inputs: [
    { id: 'chaves', label: 'Chaves', type: 'object', required: false },
    { id: 'data', label: 'Data', type: 'date', required: false },
  ],
  outputs: [
    { id: 'valor', label: 'Valor', type: 'object', required: true },
    { id: 'encontrado', label: 'Encontrado', type: 'boolean', required: true },
  ],
  params: z.object({
    tabela: z.string().default('icms_interna'),
    chaves: z.record(z.string(), z.string()).default({}),
  }),
  run: ({ inputs, params, ctx }) => {
    const chaves: Record<string, string> = { ...params.chaves };
    for (const [k, v] of Object.entries((inputs.chaves ?? {}) as Record<string, unknown>)) chaves[k] = String(v);
    const data = String(inputs.data ?? ctx.referenceDate).slice(0, 10);
    const valor = ctx.tables.lookup(params.tabela, chaves, data);
    return { valor: valor ?? {}, encontrado: valor !== undefined };
  },
});
