import { z } from 'zod';
import type { PortDef } from '@motor-fiscal/shared';
import { D, dec, fix, max0, pctOf, pctStr } from '../money';
import { tributo, tributoZero, valorOperacao } from '../fiscal/rules';
import { BlockError, defineBlock, type Contexto, type ItemNormalizado } from '../types';

const IN_ITEM: PortDef = { id: 'item', label: 'Item', type: 'item', required: true };
const IN_CTX: PortDef = { id: 'contexto', label: 'Contexto', type: 'contexto', required: true };
const optTributo = (id: string, label: string): PortDef => ({ id, label, type: 'tributo', required: false });
const outTributo = (id: string, label: string): PortDef => ({ id, label, type: 'tributo', required: true });

type TributoIn = { base: string; aliquota: string; valor: string; aplicavel?: boolean } | undefined;
const valorDe = (t: TributoIn) => (t && t.aplicavel !== false ? dec(t.valor) : dec(0));

// ---------------------------------------------------------------------------
// Simples Nacional
// ---------------------------------------------------------------------------

export const simplesAliquotaEfetiva = defineBlock({
  key: 'simples.aliquotaEfetiva',
  version: 1,
  label: 'Alíquota efetiva (Simples)',
  category: 'simples',
  description:
    'Calcula a alíquota efetiva do Simples Nacional a partir da RBT12 da empresa e do anexo (I comércio, II indústria). ' +
    'Também devolve a parcela da alíquota que corresponde ao ICMS (repartição do anexo).',
  formula: 'Alíquota efetiva = (RBT12 × Aliq − PD) / RBT12 · ICMS do Simples = efetiva × %ICMS da faixa',
  inputs: [IN_CTX],
  outputs: [
    { id: 'aliquotaEfetiva', label: 'Alíquota efetiva', type: 'percent', required: true },
    { id: 'aliquotaIcmsSimples', label: 'Parcela de ICMS', type: 'percent', required: true },
    { id: 'faixa', label: 'Faixa', type: 'integer', required: true },
  ],
  params: z.object({ anexo: z.enum(['I', 'II']).optional() }),
  run: ({ inputs, params, ctx }) => {
    const c = inputs.contexto as Contexto;
    const rbt12 = dec(c.tenant.rbt12);
    if (rbt12.lte(0)) {
      throw new BlockError('RBT12 da empresa não informada (necessária para o Simples Nacional)', 'SEM_RBT12');
    }
    const anexo = params.anexo ?? c.tenant.config?.anexoSimples ?? 'I';
    const faixas = ctx.tables
      .list('simples_anexos', c.operacao.dataEmissao)
      .filter((r) => r.keys.anexo === anexo)
      .sort((x, y) => Number(x.value.ate) - Number(y.value.ate));
    const faixa = faixas.find((r) => rbt12.lte(dec(r.value.ate)));
    if (!faixa) {
      throw new BlockError(`RBT12 ${fix(rbt12)} acima do limite do Anexo ${anexo} do Simples Nacional`, 'RBT12_EXCEDIDA');
    }
    const v = faixa.value as { aliquota: string; deduzir: string; percIcms: string };
    const efetiva = rbt12.times(dec(v.aliquota)).div(100).minus(dec(v.deduzir)).div(rbt12).times(100);
    const icms = efetiva.times(dec(v.percIcms)).div(100);
    return {
      aliquotaEfetiva: efetiva.toDecimalPlaces(4).toFixed(),
      aliquotaIcmsSimples: icms.toDecimalPlaces(4).toFixed(),
      faixa: Number(faixa.keys.faixa),
    };
  },
});

export const simplesIcms = defineBlock({
  key: 'simples.icms',
  version: 1,
  label: 'ICMS (Simples)',
  category: 'simples',
  description:
    'Tratamento do ICMS por CSOSN. O 101 (e 201) informa o crédito que o destinatário pode aproveitar; ' +
    '102/103/300/400/500 não destacam ICMS.',
  formula: 'CSOSN 101: vCredICMSSN = vOperação × pCredSN (parcela de ICMS da alíquota efetiva)',
  inputs: [IN_ITEM, IN_CTX, { id: 'aliquotaIcmsSimples', label: 'Parcela de ICMS', type: 'percent', required: false }],
  outputs: [outTributo('icms', 'ICMS (Simples)')],
  params: z.object({
    csosn: z.string().default('101'),
    aliquotaCredito: z.number().min(0).max(100).optional(),
  }),
  run: ({ inputs, params }) => {
    const item = inputs.item as ItemNormalizado;
    if (!['101', '201'].includes(params.csosn)) return { icms: tributoZero({ csosn: params.csosn }) };
    const p = params.aliquotaCredito !== undefined ? dec(params.aliquotaCredito) : dec(inputs.aliquotaIcmsSimples);
    const base = valorOperacao(item);
    const cred = pctOf(base, p);
    return { icms: tributo(base, p, cred, { csosn: params.csosn, pCredSN: pctStr(p), vCredICMSSN: fix(cred) }) };
  },
});

// ---------------------------------------------------------------------------
// Reforma tributária (LC 214/2025)
// ---------------------------------------------------------------------------

const reformaInputs: PortDef[] = [
  IN_ITEM, IN_CTX,
  optTributo('icms', 'ICMS'), optTributo('pis', 'PIS'), optTributo('cofins', 'COFINS'),
  optTributo('difal', 'DIFAL'), optTributo('fcp', 'FCP'), optTributo('is', 'Imposto Seletivo'),
];

const reformaParams = z.object({
  cst: z.string().default('000'),
  cClassTrib: z.string().default('000001'),
  /** Redução de alíquota (%), ex.: 30, 60 ou 100 conforme o cClassTrib. */
  pRedAliq: z.number().min(0).max(100).default(0),
  aliquota: z.number().min(0).max(100).optional(),
  /** No Simples Nacional o teste de 2026 é dispensado; ligue para calcular mesmo assim. */
  calcularParaSimples: z.boolean().default(false),
});

/** Base de cálculo do IBS/CBS (NT 2025.002-RTC): exclui PIS, COFINS, ICMS, DIFAL e FCP; inclui o IS. */
function baseIbsCbs(item: ItemNormalizado, i: Record<string, TributoIn>) {
  return max0(
    valorOperacao(item)
      .minus(valorDe(i.pis))
      .minus(valorDe(i.cofins))
      .minus(valorDe(i.icms))
      .minus(valorDe(i.difal))
      .minus(valorDe(i.fcp))
      .plus(valorDe(i.is)),
  );
}

const efetiva = (aliq: ReturnType<typeof dec>, red: number) => aliq.times(new D(1).minus(dec(red).div(100)));

function aliquotaReforma(
  ctx: { tables: { lookup: <T>(t: string, k: Record<string, string>, d: string) => T | undefined } },
  tributoKey: 'CBS' | 'IBS_UF' | 'IBS_MUN',
  date: string,
) {
  return dec(ctx.tables.lookup<{ aliquota: string }>('ibs_cbs_aliquotas', { tributo: tributoKey }, date)?.aliquota ?? 0);
}

export const reformaCbs = defineBlock({
  key: 'reforma.cbs',
  version: 1,
  label: 'CBS',
  category: 'reforma',
  description:
    'Contribuição sobre Bens e Serviços (federal). Alíquota pela tabela com vigência (2026: 0,9% como teste). ' +
    'Em 2026 é informativa e compensável com PIS/COFINS.',
  formula: 'vBC = vOperação − vPIS − vCOFINS − vICMS − vDIFAL − vFCP + vIS · pEfet = pCBS × (1 − pRedAliq) · vCBS = vBC × pEfet',
  inputs: reformaInputs,
  outputs: [outTributo('cbs', 'CBS')],
  params: reformaParams,
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    const extra = { cst: params.cst, cClassTrib: params.cClassTrib };
    if (c.tenant.regime === 'SIMPLES' && !params.calcularParaSimples) return { cbs: tributoZero(extra) };
    const pAliq = params.aliquota !== undefined ? dec(params.aliquota) : aliquotaReforma(ctx, 'CBS', c.operacao.dataEmissao);
    const pEf = efetiva(pAliq, params.pRedAliq);
    const base = baseIbsCbs(item, inputs as Record<string, TributoIn>);
    return {
      cbs: tributo(base, pEf, pctOf(base, pEf), { ...extra, pAliq: pctStr(pAliq), pRedAliq: pctStr(dec(params.pRedAliq)) }),
    };
  },
});

export const reformaIbs = defineBlock({
  key: 'reforma.ibs',
  version: 1,
  label: 'IBS',
  category: 'reforma',
  description:
    'Imposto sobre Bens e Serviços (estadual + municipal), que substitui ICMS e ISS até 2033. ' +
    'Alíquotas de transição na tabela com vigência (2026: 0,1% como teste).',
  formula: 'vIBSUF = vBC × pIBSUF × (1 − pRed) · vIBSMun = vBC × pIBSMun × (1 − pRed) · vIBS = vIBSUF + vIBSMun',
  inputs: reformaInputs,
  outputs: [outTributo('ibs', 'IBS')],
  params: reformaParams,
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    const extra = { cst: params.cst, cClassTrib: params.cClassTrib };
    if (c.tenant.regime === 'SIMPLES' && !params.calcularParaSimples) return { ibs: tributoZero(extra) };
    const date = c.operacao.dataEmissao;
    const pUf = params.aliquota !== undefined ? dec(params.aliquota) : aliquotaReforma(ctx, 'IBS_UF', date);
    const pMun = params.aliquota !== undefined ? dec(0) : aliquotaReforma(ctx, 'IBS_MUN', date);
    const pUfEf = efetiva(pUf, params.pRedAliq);
    const pMunEf = efetiva(pMun, params.pRedAliq);
    const base = baseIbsCbs(item, inputs as Record<string, TributoIn>);
    const vUf = pctOf(base, pUfEf);
    const vMun = pctOf(base, pMunEf);
    return {
      ibs: tributo(base, pUfEf.plus(pMunEf), vUf.plus(vMun), {
        ...extra,
        pIBSUF: pctStr(pUfEf), vIBSUF: fix(vUf),
        pIBSMun: pctStr(pMunEf), vIBSMun: fix(vMun),
        pRedAliq: pctStr(dec(params.pRedAliq)),
      }),
    };
  },
});

export const reformaIs = defineBlock({
  key: 'reforma.is',
  version: 1,
  label: 'Imposto Seletivo',
  category: 'reforma',
  description:
    'Imposto Seletivo (IS) sobre bens e serviços prejudiciais à saúde/meio ambiente, por NCM. ' +
    'Vigente a partir de 2027; sem alíquota cadastrada o valor é zero.',
  formula: 'vIS = vOperação × pIS (alíquota por NCM na tabela imposto_seletivo)',
  inputs: [IN_ITEM, IN_CTX],
  outputs: [outTributo('is', 'IS')],
  params: z.object({ aliquota: z.number().min(0).optional() }),
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    const aliq =
      params.aliquota !== undefined
        ? dec(params.aliquota)
        : dec(ctx.tables.lookup<{ aliquota: string }>('imposto_seletivo', { ncm: item.ncm }, c.operacao.dataEmissao)?.aliquota ?? 0);
    if (aliq.isZero()) return { is: tributoZero() };
    const base = valorOperacao(item);
    return { is: tributo(base, aliq, pctOf(base, aliq)) };
  },
});

export const reformaTransicaoIcms = defineBlock({
  key: 'reforma.transicaoIcms',
  version: 1,
  label: 'Transição do ICMS',
  category: 'reforma',
  description:
    'Aplica a redução gradual do ICMS durante a transição (2029: 10%, 2030: 20%, 2031: 30%, 2032: 40%; extinto em 2033). ' +
    'Antes de 2029 o ICMS passa sem alteração.',
  formula: 'pICMS ajustada = pICMS × (1 − fator do ano) · vICMS = vBC × pICMS ajustada',
  inputs: [IN_CTX, { id: 'icms', label: 'ICMS', type: 'tributo', required: true }],
  outputs: [outTributo('icms', 'ICMS ajustado'), { id: 'fator', label: 'Fator de redução', type: 'decimal', required: true }],
  params: z.object({}),
  run: ({ inputs, ctx }) => {
    const c = inputs.contexto as Contexto;
    const icms = inputs.icms as NonNullable<TributoIn> & Record<string, unknown>;
    const fator = dec(ctx.tables.lookup<{ fator: string }>('transicao_icms', {}, c.operacao.dataEmissao)?.fator ?? 0);
    if (fator.isZero() || icms.aplicavel === false) return { icms, fator: '0' };
    const nova = dec(icms.aliquota).times(new D(1).minus(fator));
    return {
      icms: { ...icms, aliquota: pctStr(nova), valor: fix(pctOf(dec(icms.base), nova)), fatorReducao: fator.toFixed() },
      fator: fator.toFixed(),
    };
  },
});
