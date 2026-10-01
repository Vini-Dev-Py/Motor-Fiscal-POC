import { z } from 'zod';
import type { PortDef } from '@motor-fiscal/shared';
import { D, dec, fix } from '../money';
import { gerarCNF, montarChaveAcesso } from '../fiscal/chave';
import { montarNfeXml, type ResultadoItem, type Totais } from '../fiscal/nfe-xml';
import { BlockError, FiscalRejection, defineBlock, type Autorizacao, type Contexto } from '../types';

const IN_CTX: PortDef = { id: 'contexto', label: 'Contexto', type: 'contexto', required: true };

const somar = (xs: Array<string | undefined>) => xs.reduce((acc, v) => acc.plus(dec(v)), new D(0));

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export const nfeTotalizar = defineBlock({
  key: 'nfe.totalizar',
  version: 1,
  label: 'Totalizar nota',
  category: 'nfe',
  description: 'Soma os itens nos grupos ICMSTot e IBSCBSTot da NF-e e calcula o valor total da nota (vNF).',
  formula: 'vNF = vProd − vDesc + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol',
  inputs: [{ id: 'resultados', label: 'Resultados por item', type: 'lista', required: true }, IN_CTX],
  outputs: [{ id: 'totais', label: 'Totais', type: 'totais', required: true }],
  params: z.object({}),
  run: ({ inputs }) => {
    const rs = inputs.resultados as ResultadoItem[];
    const ok = <K extends keyof ResultadoItem>(k: K) =>
      rs.map((r) => r[k] as { valor: string; base: string; aplicavel?: boolean; csosn?: string } | undefined).filter((t) => t && t.aplicavel !== false) as Array<{
        valor: string; base: string; csosn?: string;
      }>;
    const icmsNormal = ok('icms').filter((t) => !t.csosn);
    const credSn = ok('icms').filter((t) => t.csosn);
    const fcpUf = ok('fcpUfDestino');

    const vProd = somar(rs.map((r) => r.item.vProd));
    const vDesc = somar(rs.map((r) => r.item.vDesc));
    const vFrete = somar(rs.map((r) => r.item.vFrete));
    const vSeg = somar(rs.map((r) => r.item.vSeg));
    const vOutro = somar(rs.map((r) => r.item.vOutro));
    const vIPI = somar(ok('ipi').map((t) => t.valor));
    const vST = somar(ok('icmsSt').map((t) => t.valor));
    const vFCPST = somar(ok('fcpSt').map((t) => t.valor));
    const vNF = vProd.minus(vDesc).plus(vST).plus(vFCPST).plus(vFrete).plus(vSeg).plus(vOutro).plus(vIPI);

    const totais: Totais = {
      vBC: fix(somar(icmsNormal.map((t) => t.base))),
      vICMS: fix(somar(icmsNormal.map((t) => t.valor))),
      vICMSDeson: '0.00',
      vFCPUFDest: fix(somar(fcpUf.map((t) => t.valor))),
      vICMSUFDest: fix(somar(ok('difal').map((t) => t.valor))),
      vICMSUFRemet: '0.00',
      vFCP: fix(somar(ok('fcp').map((t) => t.valor))),
      vBCST: fix(somar(ok('icmsSt').map((t) => t.base))),
      vST: fix(vST),
      vFCPST: fix(vFCPST),
      vFCPSTRet: '0.00',
      vProd: fix(vProd),
      vFrete: fix(vFrete),
      vSeg: fix(vSeg),
      vDesc: fix(vDesc),
      vII: '0.00',
      vIPI: fix(vIPI),
      vIPIDevol: '0.00',
      vPIS: fix(somar(ok('pis').map((t) => t.valor))),
      vCOFINS: fix(somar(ok('cofins').map((t) => t.valor))),
      vOutro: fix(vOutro),
      vNF: fix(vNF),
      vCredICMSSN: fix(somar(credSn.map((t) => t.valor))),
      ibscbs: {
        vBC: fix(somar(ok('cbs').map((t) => t.base))),
        vIBSUF: fix(somar(rs.map((r) => String(r.ibs?.vIBSUF ?? 0)))),
        vIBSMun: fix(somar(rs.map((r) => String(r.ibs?.vIBSMun ?? 0)))),
        vIBS: fix(somar(ok('ibs').map((t) => t.valor))),
        vCBS: fix(somar(ok('cbs').map((t) => t.valor))),
        vIS: fix(somar(ok('is').map((t) => t.valor))),
      },
      quantidadeItens: rs.length,
    };
    const pCred = credSn.length ? rs.find((r) => r.icms?.csosn)?.icms?.pCredSN : undefined;
    if (pCred !== undefined) totais.pCredSN = String(pCred);
    return { totais };
  },
});

// ---------------------------------------------------------------------------
// Chave de acesso
// ---------------------------------------------------------------------------

export const nfeChaveAcesso = defineBlock({
  key: 'nfe.chaveAcesso',
  version: 1,
  label: 'Chave de acesso',
  category: 'nfe',
  description:
    'Reserva o próximo número da série e monta a chave de acesso de 44 posições com o dígito verificador (módulo 11). ' +
    'Aceita CNPJ alfanumérico.',
  formula: 'cUF + AAMM + CNPJ + mod + série + nNF + tpEmis + cNF + cDV (DV: módulo 11, pesos 2..9)',
  inputs: [IN_CTX, { id: 'pedido', label: 'Pedido', type: 'pedido', required: false }],
  outputs: [
    { id: 'chave', label: 'Chave', type: 'string', required: true },
    { id: 'numero', label: 'Número', type: 'integer', required: true },
    { id: 'serie', label: 'Série', type: 'integer', required: true },
  ],
  params: z.object({
    serie: z.number().int().min(0).max(999).default(1),
    modelo: z.number().int().default(55),
    tpEmis: z.number().int().min(1).max(9).default(1),
  }),
  run: async ({ inputs, params, ctx }) => {
    const c = inputs.contexto as Contexto;
    const numero = await ctx.services.numeracao.next(params.serie);
    const seed = String((inputs.pedido as { id?: string } | undefined)?.id ?? c.tenant.id);
    const chave = montarChaveAcesso({
      uf: c.tenant.uf,
      dataEmissao: c.operacao.dataEmissao,
      cnpj: c.tenant.cnpj,
      modelo: params.modelo,
      serie: params.serie,
      numero,
      tpEmis: params.tpEmis,
      cNF: gerarCNF(seed, numero),
    });
    return { chave, numero, serie: params.serie };
  },
});

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

export const nfeMontarXml = defineBlock({
  key: 'nfe.montarXml',
  version: 1,
  label: 'Montar XML da NF-e',
  category: 'nfe',
  description:
    'Gera o XML da NF-e (layout 4.00) com os grupos ICMS, IPI, PIS, COFINS e IBSCBS de cada item. ' +
    'Nesta POC o XML não é assinado.',
  inputs: [
    IN_CTX,
    { id: 'pedido', label: 'Pedido', type: 'pedido', required: true },
    { id: 'resultados', label: 'Resultados por item', type: 'lista', required: true },
    { id: 'totais', label: 'Totais', type: 'totais', required: true },
    { id: 'chave', label: 'Chave', type: 'string', required: true },
    { id: 'numero', label: 'Número', type: 'integer', required: true },
    { id: 'serie', label: 'Série', type: 'integer', required: true },
    { id: 'parcelas', label: 'Parcelas', type: 'parcelas', required: false },
  ],
  outputs: [{ id: 'xml', label: 'XML', type: 'xml', required: true }],
  params: z.object({ ambiente: z.union([z.literal(1), z.literal(2)]).default(2) }),
  run: ({ inputs, params }) => ({
    xml: montarNfeXml({
      contexto: inputs.contexto as Contexto,
      pedido: inputs.pedido as never,
      resultados: inputs.resultados as ResultadoItem[],
      totais: inputs.totais as Totais,
      chave: inputs.chave as string,
      numero: inputs.numero as number,
      serie: inputs.serie as number,
      parcelas: inputs.parcelas as never,
      ambiente: params.ambiente,
    }),
  }),
});

// ---------------------------------------------------------------------------
// SEFAZ
// ---------------------------------------------------------------------------

export const sefazAutorizar = defineBlock({
  key: 'sefaz.autorizar',
  version: 1,
  label: 'Autorizar na SEFAZ',
  category: 'sefaz',
  description:
    'Envia a NF-e para autorização. Na POC usa uma SEFAZ simulada (cStat 100 autoriza; 207, 208, 237 e 531 rejeitam). ' +
    'Com "falharSeRejeitada" a execução termina como REJEITADA e nada depois roda.',
  inputs: [
    { id: 'xml', label: 'XML', type: 'xml', required: true },
    { id: 'chave', label: 'Chave', type: 'string', required: true },
    { id: 'totais', label: 'Totais', type: 'totais', required: true },
    IN_CTX,
    { id: 'resultados', label: 'Resultados por item', type: 'lista', required: false },
  ],
  outputs: [{ id: 'autorizacao', label: 'Autorização', type: 'autorizacao', required: true }],
  params: z.object({ falharSeRejeitada: z.boolean().default(true) }),
  run: async ({ inputs, params, ctx }) => {
    const c = inputs.contexto as Contexto;
    const totais = inputs.totais as Totais;
    const itens = (inputs.resultados as ResultadoItem[] | undefined) ?? [];
    const somaBc = itens
      .map((r) => r.icms)
      .filter((t) => t && t.aplicavel !== false && !t.csosn)
      .reduce((acc, t) => acc.plus(dec(t!.base)), new D(0));
    const autorizacao: Autorizacao = await ctx.services.sefaz.autorizar({
      xml: inputs.xml as string,
      chave: inputs.chave as string,
      tenant: c.tenant,
      destinatarioDocumento: c.destinatario.documento,
      vNF: totais.vNF,
      somaBcIcmsItens: itens.length ? fix(somaBc) : totais.vBC,
      totalBcIcms: totais.vBC,
    });
    if (!autorizacao.autorizada && params.falharSeRejeitada) {
      throw new FiscalRejection(autorizacao.cStat, autorizacao.xMotivo);
    }
    return { autorizacao };
  },
});

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

function addDias(iso: string, dias: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const financeiroParcelas = defineBlock({
  key: 'financeiro.parcelas',
  version: 1,
  label: 'Gerar parcelas',
  category: 'financeiro',
  description:
    'Divide o valor da nota conforme a condição de pagamento do pedido (ex.: 30/60/90). ' +
    'O resíduo de centavos vai para a 1ª parcela.',
  formula: 'parcela = ⌊vNF / n⌋ (centavos) · 1ª parcela recebe vNF − parcela × (n − 1)',
  inputs: [
    { id: 'totais', label: 'Totais', type: 'totais', required: true },
    { id: 'pedido', label: 'Pedido', type: 'pedido', required: true },
  ],
  outputs: [{ id: 'parcelas', label: 'Parcelas', type: 'parcelas', required: true }],
  params: z.object({}),
  run: ({ inputs }) => {
    const totais = inputs.totais as Totais;
    const pedido = inputs.pedido as { dataEmissao: string; pagamento?: { condicao?: string; primeiroVencimento?: string } };
    const prazos = (pedido.pagamento?.condicao ?? '0').split('/').map(Number);
    if (prazos.some((p) => !Number.isInteger(p) || p < 0)) {
      throw new BlockError(`Condição de pagamento inválida: ${pedido.pagamento?.condicao}`, 'CONDICAO_INVALIDA');
    }
    const n = prazos.length;
    const totalCent = dec(totais.vNF).times(100).toDecimalPlaces(0);
    const base = totalCent.div(n).floor();
    const primeiraCent = totalCent.minus(base.times(n - 1));
    const primeiro = pedido.pagamento?.primeiroVencimento?.slice(0, 10);
    const parcelas = prazos.map((dias, i) => ({
      numero: i + 1,
      vencimento: primeiro ? addDias(primeiro, dias - prazos[0]!) : addDias(pedido.dataEmissao, dias),
      valor: (i === 0 ? primeiraCent : base).div(100).toFixed(2),
    }));
    return { parcelas };
  },
});

export const financeiroBoleto = defineBlock({
  key: 'financeiro.boleto',
  version: 1,
  label: 'Gerar boletos',
  category: 'financeiro',
  description:
    'Emite um boleto por parcela (nosso número, código de barras de 44 posições e linha digitável no padrão FEBRABAN, ' +
    'com o fator de vencimento da nova base). Na POC o registro no banco é simulado.',
  formula: 'Código de barras: banco + moeda + DV + fator de vencimento + valor (10) + campo livre (25) · DVs: módulo 10 e 11',
  inputs: [
    { id: 'parcelas', label: 'Parcelas', type: 'parcelas', required: true },
    IN_CTX,
    { id: 'pedido', label: 'Pedido', type: 'pedido', required: true },
    // ligar à autorização garante que o boleto só é emitido depois da nota autorizada
    { id: 'autorizacao', label: 'Autorização', type: 'autorizacao', required: false },
  ],
  outputs: [{ id: 'boletos', label: 'Boletos', type: 'boletos', required: true }],
  params: z.object({
    banco: z.string().regex(/^\d{3}$/).optional(),
    agencia: z.string().optional(),
    conta: z.string().optional(),
    carteira: z.string().optional(),
  }),
  run: async ({ inputs, params, ctx }) => {
    const c = inputs.contexto as Contexto;
    const pedido = inputs.pedido as { id: string };
    const cfg = c.tenant.config?.boleto ?? {};
    const config = {
      banco: params.banco ?? cfg.banco ?? '341',
      agencia: params.agencia ?? cfg.agencia ?? '1234',
      conta: params.conta ?? cfg.conta ?? '123456',
      carteira: params.carteira ?? cfg.carteira ?? '109',
      beneficiario: cfg.beneficiario ?? c.tenant.razaoSocial,
    };
    const parcelas = inputs.parcelas as Array<{ numero: number; vencimento: string; valor: string }>;
    const boletos = [];
    for (const p of parcelas) {
      boletos.push(
        await ctx.services.boleto.emitir({
          tenant: c.tenant,
          pagador: { nome: c.destinatario.nome, documento: c.destinatario.documento, uf: c.destinatario.uf },
          numeroDocumento: pedido.id,
          parcela: p.numero,
          vencimento: p.vencimento,
          valor: p.valor,
          config,
        }),
      );
    }
    return { boletos };
  },
});
