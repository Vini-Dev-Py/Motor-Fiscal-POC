import { z } from 'zod';
import type { PortDef } from '@motor-fiscal/shared';
import { D, dec, fix, max0, pctOf, pctStr } from '../money';
import {
  CST_ICMS_SEM_VALOR, aliquotaIcmsOperacao, aliquotaInterna, tributo, tributoZero, valorOperacao,
} from '../fiscal/rules';
import { defineBlock, type Contexto, type ItemNormalizado } from '../types';

const IN_ITEM: PortDef = { id: 'item', label: 'Item', type: 'item', required: true };
const IN_CTX: PortDef = { id: 'contexto', label: 'Contexto', type: 'contexto', required: true };
const optTributo = (id: string, label: string): PortDef => ({ id, label, type: 'tributo', required: false });
const outTributo = (id: string, label: string): PortDef => ({ id, label, type: 'tributo', required: true });

type TributoIn = { base: string; aliquota: string; valor: string; aplicavel?: boolean } | undefined;

// ---------------------------------------------------------------------------
// IPI
// ---------------------------------------------------------------------------

const CST_IPI_SEM_VALOR = ['51', '52', '53', '54', '55'];

export const taxIpi = defineBlock({
  key: 'tax.ipi',
  version: 1,
  label: 'IPI',
  category: 'imposto',
  description: 'Imposto sobre Produtos Industrializados. Alíquota pela TIPI (por NCM), com possibilidade de fixar no bloco.',
  formula: 'vBC = vProd + vFrete + vSeg + vOutro − vDesc · vIPI = vBC × pIPI',
  inputs: [IN_ITEM, IN_CTX],
  outputs: [outTributo('ipi', 'IPI')],
  params: z.object({
    cst: z.string().default('50'),
    aliquota: z.number().min(0).optional(),
  }),
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    if (c.tenant.regime === 'SIMPLES') return { ipi: tributoZero({ cst: params.cst }) };
    const aliq =
      params.aliquota !== undefined
        ? dec(params.aliquota)
        : dec(ctx.tables.lookup<{ aliquota: string }>('tipi', { ncm: item.ncm }, c.operacao.dataEmissao)?.aliquota ?? 0);
    const base = valorOperacao(item);
    if (CST_IPI_SEM_VALOR.includes(params.cst)) return { ipi: tributoZero({ cst: params.cst }) };
    return { ipi: tributo(base, aliq, pctOf(base, aliq), { cst: params.cst }) };
  },
});

// ---------------------------------------------------------------------------
// ICMS
// ---------------------------------------------------------------------------

export const taxIcms = defineBlock({
  key: 'tax.icms',
  version: 1,
  label: 'ICMS',
  category: 'imposto',
  description:
    'ICMS próprio (regime normal). Alíquota interna da UF ou interestadual (4/7/12%). ' +
    'O IPI integra a base quando o destinatário é consumidor final.',
  formula: 'vBC = (vProd + vFrete + vSeg + vOutro − vDesc [+ vIPI]) × (1 − pRedBC) · vICMS = vBC × pICMS',
  inputs: [IN_ITEM, IN_CTX, optTributo('ipi', 'IPI')],
  outputs: [outTributo('icms', 'ICMS')],
  params: z.object({
    cst: z.string().default('00'),
    pRedBC: z.number().min(0).max(100).default(0),
    aliquota: z.number().min(0).max(100).optional(),
    ipiNaBase: z.enum(['auto', 'sim', 'nao']).default('auto'),
  }),
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    if (c.tenant.regime === 'SIMPLES') return { icms: tributoZero({ cst: params.cst }) };
    if (CST_ICMS_SEM_VALOR.includes(params.cst)) return { icms: tributoZero({ cst: params.cst }) };

    const aliq = params.aliquota !== undefined ? dec(params.aliquota) : aliquotaIcmsOperacao(ctx.tables, c, item);
    const ipi = dec((inputs.ipi as TributoIn)?.valor);
    const somaIpi = params.ipiNaBase === 'sim' || (params.ipiNaBase === 'auto' && c.operacao.consumidorFinal);
    const bruto = valorOperacao(item).plus(somaIpi ? ipi : 0);
    const base = bruto.times(new D(1).minus(dec(params.pRedBC).div(100))).toDecimalPlaces(2);
    return {
      icms: tributo(base, aliq, pctOf(base, aliq), { cst: params.cst, pRedBC: pctStr(dec(params.pRedBC)) }),
    };
  },
});

// ---------------------------------------------------------------------------
// ICMS-ST
// ---------------------------------------------------------------------------

export const taxIcmsSt = defineBlock({
  key: 'tax.icmsSt',
  version: 1,
  label: 'ICMS-ST',
  category: 'imposto',
  description:
    'Substituição tributária. MVA pela tabela (NCM + UF de destino) ou fixada no bloco. ' +
    'Em operação interestadual a MVA é ajustada.',
  formula:
    'MVAaj = [(1+MVA) × (1−ALQinter) / (1−ALQintra)] − 1 · vBCST = (vProd+vIPI+vFrete+vSeg+vOutro−vDesc) × (1+MVAaj) · vST = vBCST × ALQintra − vICMSprópio',
  inputs: [IN_ITEM, IN_CTX, optTributo('icms', 'ICMS próprio'), optTributo('ipi', 'IPI')],
  outputs: [outTributo('icmsSt', 'ICMS-ST')],
  params: z.object({
    cst: z.string().default('10'),
    mva: z.number().min(0).optional(),
    pRedBCST: z.number().min(0).max(100).default(0),
    ajustarMva: z.boolean().default(true),
    aliquotaInternaDestino: z.number().min(0).max(100).optional(),
  }),
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    const op = c.operacao;
    const mvaTabela = ctx.tables.lookup<{ mva: string }>('mva_st', { ncm: item.ncm, uf: op.ufDestino }, op.dataEmissao)?.mva;
    const mvaRaw = params.mva !== undefined ? params.mva : mvaTabela;
    if (mvaRaw === undefined) return { icmsSt: tributoZero({ cst: params.cst, motivo: 'Sem MVA para o NCM/UF' }) };

    const mva = dec(mvaRaw).div(100);
    const alqIntra =
      params.aliquotaInternaDestino !== undefined
        ? dec(params.aliquotaInternaDestino).div(100)
        : aliquotaInterna(ctx.tables, op.ufDestino, op.dataEmissao).div(100);
    const icms = inputs.icms as TributoIn;
    const alqInter = (icms?.aplicavel !== false && icms ? dec(icms.aliquota) : aliquotaIcmsOperacao(ctx.tables, c, item)).div(100);

    const mvaAj =
      op.interestadual && params.ajustarMva
        ? new D(1).plus(mva).times(new D(1).minus(alqInter)).div(new D(1).minus(alqIntra)).minus(1)
        : mva;
    const ipi = dec((inputs.ipi as TributoIn)?.valor);
    const bcst = valorOperacao(item)
      .plus(ipi)
      .times(new D(1).plus(mvaAj))
      .times(new D(1).minus(dec(params.pRedBCST).div(100)))
      .toDecimalPlaces(2);
    const proprio = dec(icms?.valor);
    const vst = max0(pctOf(bcst, alqIntra.times(100)).minus(proprio));
    return {
      icmsSt: tributo(bcst, alqIntra.times(100), vst, {
        cst: params.cst,
        mva: pctStr(mva.times(100)),
        mvaAjustada: pctStr(mvaAj.times(100)),
        vICMSProprio: fix(proprio),
      }),
    };
  },
});

// ---------------------------------------------------------------------------
// DIFAL
// ---------------------------------------------------------------------------

export const taxDifal = defineBlock({
  key: 'tax.difal',
  version: 1,
  label: 'DIFAL',
  category: 'imposto',
  description:
    'Diferencial de alíquota (EC 87/2015, LC 190/2022): devido em venda interestadual a consumidor final. ' +
    'Cálculo por base única ou base dupla, conforme a UF de destino.',
  formula:
    'Base única: vDIFAL = vBC × (ALQintra − ALQinter) · Base dupla: vBCdest = (vBC − vICMS) / (1 − ALQintra); vDIFAL = vBCdest × ALQintra − vICMS',
  inputs: [IN_ITEM, IN_CTX, { id: 'icms', label: 'ICMS próprio', type: 'tributo', required: true }],
  outputs: [outTributo('difal', 'DIFAL')],
  params: z.object({
    metodo: z.enum(['base_unica', 'base_dupla']).default('base_unica'),
    aliquotaInternaDestino: z.number().min(0).max(100).optional(),
  }),
  run: ({ inputs, params, ctx }) => {
    const c = inputs.contexto as Contexto;
    const op = c.operacao;
    if (!(op.interestadual && op.consumidorFinal)) return { difal: tributoZero({ metodo: params.metodo }) };

    const icms = inputs.icms as NonNullable<TributoIn>;
    const alqIntra =
      params.aliquotaInternaDestino !== undefined
        ? dec(params.aliquotaInternaDestino)
        : aliquotaInterna(ctx.tables, op.ufDestino, op.dataEmissao);
    const alqInter = dec(icms.aliquota);
    const bc = dec(icms.base);
    const icmsOrig = dec(icms.valor);

    let base = bc;
    let valor;
    if (params.metodo === 'base_dupla') {
      base = bc.minus(icmsOrig).div(new D(1).minus(alqIntra.div(100))).toDecimalPlaces(2);
      valor = max0(pctOf(base, alqIntra).minus(icmsOrig));
    } else {
      valor = max0(pctOf(bc, alqIntra.minus(alqInter)));
    }
    return {
      difal: tributo(base, alqIntra, valor, {
        metodo: params.metodo,
        aliquotaInterestadual: pctStr(alqInter),
        vICMSUFDest: fix(valor), // desde 2019: 100% para a UF de destino
        vICMSUFRemet: '0.00',
      }),
    };
  },
});

// ---------------------------------------------------------------------------
// FCP
// ---------------------------------------------------------------------------

export const taxFcp = defineBlock({
  key: 'tax.fcp',
  version: 1,
  label: 'FCP',
  category: 'imposto',
  description:
    'Fundo de Combate à Pobreza. Variantes: próprio (base do ICMS), ST (base do ICMS-ST) e UF de destino (base do DIFAL).',
  formula: 'vFCP = vBC × pFCP (alíquota da UF conforme a variante)',
  inputs: [
    IN_ITEM, IN_CTX,
    optTributo('icms', 'ICMS próprio'), optTributo('icmsSt', 'ICMS-ST'), optTributo('difal', 'DIFAL'),
  ],
  outputs: [outTributo('fcp', 'FCP')],
  params: z.object({
    tipo: z.enum(['proprio', 'st', 'ufDestino']).default('proprio'),
    aliquota: z.number().min(0).max(100).optional(),
  }),
  run: ({ inputs, params, ctx }) => {
    const c = inputs.contexto as Contexto;
    const op = c.operacao;
    const uf = params.tipo === 'proprio' ? op.ufOrigem : op.ufDestino;
    const fonte = (params.tipo === 'proprio' ? inputs.icms : params.tipo === 'st' ? inputs.icmsSt : inputs.difal) as TributoIn;
    if (!fonte || fonte.aplicavel === false) return { fcp: tributoZero({ tipo: params.tipo, uf }) };
    const aliq =
      params.aliquota !== undefined
        ? dec(params.aliquota)
        : dec(ctx.tables.lookup<{ aliquota: string }>('fcp', { uf }, op.dataEmissao)?.aliquota ?? 0);
    if (aliq.isZero()) return { fcp: tributoZero({ tipo: params.tipo, uf }) };
    const base = dec(fonte.base);
    return { fcp: tributo(base, aliq, pctOf(base, aliq), { tipo: params.tipo, uf }) };
  },
});

// ---------------------------------------------------------------------------
// PIS / COFINS
// ---------------------------------------------------------------------------

const ALIQ_PIS_COFINS = {
  PIS: { cumulativo: 0.65, nao_cumulativo: 1.65 },
  COFINS: { cumulativo: 3, nao_cumulativo: 7.6 },
} as const;

function pisCofinsBlock(nome: 'PIS' | 'COFINS') {
  const key = nome.toLowerCase() as 'pis' | 'cofins';
  const a = ALIQ_PIS_COFINS[nome];
  return defineBlock({
    key: `tax.${key}`,
    version: 1,
    label: nome,
    category: 'imposto',
    description:
      `${nome} cumulativo (Lucro Presumido: ${a.cumulativo}%) ou não cumulativo (Lucro Real: ${a.nao_cumulativo}%). ` +
      'A base exclui o ICMS (Tema 69 do STF; Lei 14.592/2023). No Simples Nacional o tributo é recolhido no DAS.',
    formula: `vBC = vProd + vFrete + vSeg + vOutro − vDesc − vICMS · v${nome} = vBC × p${nome}`,
    inputs: [IN_ITEM, IN_CTX, optTributo('icms', 'ICMS')],
    outputs: [outTributo(key, nome)],
    params: z.object({
      cumulatividade: z.enum(['auto', 'cumulativo', 'nao_cumulativo']).default('auto'),
      excluirIcmsDaBase: z.boolean().default(true),
      aliquota: z.number().min(0).max(100).optional(),
      cst: z.string().default('01'),
    }),
    run: ({ inputs, params }) => {
      const item = inputs.item as ItemNormalizado;
      const c = inputs.contexto as Contexto;
      if (c.tenant.regime === 'SIMPLES') return { [key]: tributoZero({ cst: '49' }) };
      const modo =
        params.cumulatividade !== 'auto'
          ? params.cumulatividade
          : c.tenant.regime === 'REAL'
            ? 'nao_cumulativo'
            : 'cumulativo';
      const aliq = params.aliquota !== undefined ? dec(params.aliquota) : dec(a[modo]);
      const icms = inputs.icms as TributoIn;
      const menosIcms = params.excluirIcmsDaBase && icms && icms.aplicavel !== false ? dec(icms.valor) : dec(0);
      const base = max0(valorOperacao(item).minus(menosIcms));
      return { [key]: tributo(base, aliq, pctOf(base, aliq), { cst: params.cst, regime: modo }) };
    },
  });
}

export const taxPis = pisCofinsBlock('PIS');
export const taxCofins = pisCofinsBlock('COFINS');
