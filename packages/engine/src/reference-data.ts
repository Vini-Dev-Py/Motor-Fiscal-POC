import type { RefRow } from './tables';

/**
 * ATENÇÃO: valores de REFERÊNCIA para a POC. Devem ser conferidos com o contador/consultoria
 * tributária antes de qualquer uso real (alíquotas mudam por UF, produto e ano).
 */

export interface ReferenceTableInfo {
  key: string;
  name: string;
  description: string;
  keyFields: string[];
  valueFields: string[];
}

export const REFERENCE_TABLES: ReferenceTableInfo[] = [
  { key: 'icms_interna', name: 'ICMS interno por UF', description: 'Alíquota modal interna do ICMS.', keyFields: ['uf'], valueFields: ['aliquota'] },
  { key: 'fcp', name: 'FCP por UF', description: 'Adicional do Fundo de Combate à Pobreza (%).', keyFields: ['uf'], valueFields: ['aliquota'] },
  { key: 'ibs_cbs_aliquotas', name: 'IBS/CBS (transição)', description: 'Alíquotas da reforma tributária por ano de vigência. Chaves: CBS, IBS_UF, IBS_MUN.', keyFields: ['tributo'], valueFields: ['aliquota'] },
  { key: 'transicao_icms', name: 'Transição do ICMS', description: 'Fator de redução do ICMS de 2029 a 2033 (0,1 = reduz 10%).', keyFields: [], valueFields: ['fator'] },
  { key: 'imposto_seletivo', name: 'Imposto Seletivo', description: 'Alíquota do IS por NCM (prefixo). Valores ilustrativos.', keyFields: ['ncm'], valueFields: ['aliquota'] },
  { key: 'tipi', name: 'TIPI (IPI)', description: 'Alíquota de IPI por NCM (prefixo). Amostra ilustrativa.', keyFields: ['ncm'], valueFields: ['aliquota'] },
  { key: 'mva_st', name: 'MVA para ICMS-ST', description: 'Margem de valor agregado por NCM (prefixo) e UF de destino. Amostra ilustrativa.', keyFields: ['ncm', 'uf'], valueFields: ['mva'] },
  { key: 'simples_anexos', name: 'Simples Nacional — anexos', description: 'Faixas dos Anexos I (comércio) e II (indústria): alíquota nominal, parcela a deduzir e % de ICMS.', keyFields: ['anexo', 'faixa'], valueFields: ['ate', 'aliquota', 'deduzir', 'percIcms'] },
];

const FROM = '2000-01-01';
const row = (table: string, keys: Record<string, string>, value: Record<string, unknown>, validFrom = FROM, validTo?: string): RefRow => ({
  table, keys, value, validFrom, ...(validTo ? { validTo } : {}),
});

const ICMS_INTERNA: Record<string, string> = {
  AC: '19', AL: '20', AM: '20', AP: '18', BA: '20.5', CE: '20', DF: '20', ES: '17', GO: '19', MA: '23', MG: '18',
  MS: '17', MT: '17', PA: '19', PB: '20', PE: '20.5', PI: '22.5', PR: '19.5', RJ: '20', RN: '20', RO: '19.5',
  RR: '20', RS: '17', SC: '17', SE: '20', SP: '18', TO: '20',
};

const FCP: Record<string, string> = {
  AL: '2', AM: '2', BA: '2', CE: '2', DF: '2', MA: '2', MT: '2', PA: '2', PB: '2', PE: '2', PI: '2', RJ: '2', RN: '2', SE: '2', TO: '2',
};

/** Anexos I e II: [ate, aliquota, deduzir, percIcms] */
const SIMPLES: Record<'I' | 'II', Array<[number, string, string, string]>> = {
  I: [
    [180000, '4', '0', '34'], [360000, '7.3', '5940', '34'], [720000, '9.5', '13860', '33.5'],
    [1800000, '10.7', '22500', '33.5'], [3600000, '14.3', '87300', '33.5'], [4800000, '19', '378000', '0'],
  ],
  II: [
    [180000, '4.5', '0', '32'], [360000, '7.8', '5940', '32'], [720000, '10', '13860', '32'],
    [1800000, '11.2', '22500', '32'], [3600000, '14.7', '85500', '32'], [4800000, '30', '720000', '0'],
  ],
};

export function buildReferenceRows(): RefRow[] {
  const rows: RefRow[] = [];

  for (const [uf, aliquota] of Object.entries(ICMS_INTERNA)) rows.push(row('icms_interna', { uf }, { aliquota }));
  for (const [uf, aliquota] of Object.entries(FCP)) rows.push(row('fcp', { uf }, { aliquota }));

  // Reforma tributária: 2026 é o ano de teste (CBS 0,9% + IBS 0,1%); 2027+ são estimativas de referência.
  const anos: Array<{ de: string; ate: string; cbs: string; ibsUf: string; ibsMun: string }> = [
    { de: '2026-01-01', ate: '2026-12-31', cbs: '0.9', ibsUf: '0.1', ibsMun: '0' },
    { de: '2027-01-01', ate: '2028-12-31', cbs: '8.8', ibsUf: '0.1', ibsMun: '0' },
    { de: '2029-01-01', ate: '2029-12-31', cbs: '8.8', ibsUf: '1', ibsMun: '0.77' },
    { de: '2030-01-01', ate: '2030-12-31', cbs: '8.8', ibsUf: '2', ibsMun: '1.54' },
    { de: '2031-01-01', ate: '2031-12-31', cbs: '8.8', ibsUf: '3', ibsMun: '2.31' },
    { de: '2032-01-01', ate: '2032-12-31', cbs: '8.8', ibsUf: '4', ibsMun: '3.08' },
    { de: '2033-01-01', ate: '2099-12-31', cbs: '8.8', ibsUf: '10', ibsMun: '7.7' },
  ];
  for (const a of anos) {
    rows.push(row('ibs_cbs_aliquotas', { tributo: 'CBS' }, { aliquota: a.cbs }, a.de, a.ate));
    rows.push(row('ibs_cbs_aliquotas', { tributo: 'IBS_UF' }, { aliquota: a.ibsUf }, a.de, a.ate));
    rows.push(row('ibs_cbs_aliquotas', { tributo: 'IBS_MUN' }, { aliquota: a.ibsMun }, a.de, a.ate));
  }

  // Transição do ICMS (2029–2033): reduz 10%, 20%, 30%, 40% e extingue em 2033.
  const fatores: Array<[string, string, string]> = [
    ['2029-01-01', '2029-12-31', '0.1'], ['2030-01-01', '2030-12-31', '0.2'], ['2031-01-01', '2031-12-31', '0.3'],
    ['2032-01-01', '2032-12-31', '0.4'], ['2033-01-01', '2099-12-31', '1'],
  ];
  for (const [de, ate, fator] of fatores) rows.push(row('transicao_icms', {}, { fator }, de, ate));

  // TIPI — amostra ilustrativa (NCM por prefixo). Demais NCMs: 0%.
  rows.push(row('tipi', { ncm: '*' }, { aliquota: '0' }));
  rows.push(row('tipi', { ncm: '2402' }, { aliquota: '300' })); // cigarros
  rows.push(row('tipi', { ncm: '2204' }, { aliquota: '10' })); // vinhos
  rows.push(row('tipi', { ncm: '3303' }, { aliquota: '20' })); // perfumes

  // MVA ST — amostra ilustrativa
  rows.push(row('mva_st', { ncm: '2202', uf: '*' }, { mva: '40' })); // bebidas não alcoólicas
  rows.push(row('mva_st', { ncm: '3303', uf: '*' }, { mva: '42' })); // perfumaria

  // Imposto Seletivo — placeholder: alíquotas reais serão definidas em lei ordinária (vigência 2027+)
  rows.push(row('imposto_seletivo', { ncm: '2402' }, { aliquota: '1' }, '2027-01-01'));

  for (const anexo of ['I', 'II'] as const) {
    SIMPLES[anexo].forEach(([ate, aliquota, deduzir, percIcms], i) => {
      rows.push(row('simples_anexos', { anexo, faixa: String(i + 1) }, { ate, aliquota, deduzir, percIcms }));
    });
  }
  return rows;
}
