import { describe, expect, it } from 'vitest';
import {
  EXEMPLO_PEDIDO, cnpjWithDv, isValidChaveNfe, type FlowGraph, type FlowNode, type TenantInfo,
} from '@motor-fiscal/shared';
import {
  D, InMemoryTables, buildPedidoGraphComSubfluxo, buildReferenceRows, evalExpression, fatorVencimento,
  mockServices, mod10, mod11Barras, montarChaveAcesso, runBlockOnce, runFlow, validateGraph,
  type CodeRunner, type EngineContext, type OverrideEntry,
} from './index';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const tenant = (over: Partial<TenantInfo> = {}): TenantInfo => ({
  id: 't1',
  cnpj: '11222333000181',
  razaoSocial: 'Vinícius Distribuidora Ltda',
  ie: '110042490114',
  uf: 'SP',
  codMunicipio: '3550308',
  regime: 'PRESUMIDO',
  crt: 3,
  rbt12: null,
  config: {},
  ...over,
});

const ctxOf = (t: TenantInfo, extra: Partial<EngineContext> = {}): EngineContext => ({
  tenant: t,
  tables: new InMemoryTables(buildReferenceRows()),
  services: mockServices(),
  referenceDate: '2026-09-30',
  ...extra,
});

/** Runner de teste (NÃO é sandbox: a API usa isolated-vm). */
const testRunner: CodeRunner = {
  language: 'javascript',
  async run({ code, inputs, params, tabela }) {
    const fn = new Function('D', `${code}\n;return calcular;`)(D) as (a: unknown) => Record<string, unknown>;
    return fn({ inputs, params, D: (v: unknown) => new D(v as string), tabela });
  },
};

const pedido = (over: Record<string, unknown> = {}) => ({ ...JSON.parse(JSON.stringify(EXEMPLO_PEDIDO)), ...over });
const graph = () => buildPedidoGraphComSubfluxo();

const runPedido = (t: TenantInfo, payload: unknown = pedido(), extra: Partial<EngineContext> = {}) =>
  runFlow({ graph: graph(), payload, ctx: ctxOf(t, extra) });

/** Contexto mínimo para testar blocos isoladamente. */
const contexto = (t: TenantInfo, ufDestino: string, o: Record<string, unknown> = {}) => ({
  tenant: t,
  operacao: {
    ufOrigem: t.uf, ufDestino, idDest: ufDestino === t.uf ? 1 : 2, interestadual: ufDestino !== t.uf,
    consumidorFinal: false, contribuinte: true, indIEDest: 1, dataEmissao: '2026-09-30', ano: 2026, cfop: '5102', ...o,
  },
  destinatario: { nome: 'Dest', documento: '11222333000181', uf: ufDestino },
});

const item = (over: Record<string, unknown> = {}) => ({
  nItem: 1, codigo: 'X', descricao: 'X', ncm: '61091000', origem: 0, unidade: 'UN', quantidade: '10', valorUnitario: '100',
  vProd: '1000.00', vDesc: '0.00', vFrete: '50.00', vSeg: '0.00', vOutro: '0.00', ...over,
});

const icmsTrib = (base: string, aliq: string, valor: string) => ({ base, aliquota: aliq, valor, aplicavel: true });

const out = async (blockKey: string, inputs: Record<string, unknown>, params: Record<string, unknown> = {}, t = tenant(), extra: Partial<EngineContext> = {}) =>
  (await runBlockOnce({ blockKey, inputs, params, ctx: ctxOf(t, extra) })).outputs;

// ---------------------------------------------------------------------------
// Fluxo completo (caso dourado)
// ---------------------------------------------------------------------------

describe('fluxo completo — Lucro Presumido, SP → SP, 2026', () => {
  it('calcula os impostos do item conforme a conta feita à mão', async () => {
    const r = await runPedido(tenant());
    expect(r.status).toBe('OK');
    const res = (r.nodes.itens!.resultados as any[])[0];
    // ICMS 18% sobre 1.000 + 50 de frete
    expect(res.icms).toMatchObject({ base: '1050.00', aliquota: '18', valor: '189.00' });
    // PIS/COFINS sobre (1.050 − ICMS 189) = 861
    expect(res.pis).toMatchObject({ base: '861.00', aliquota: '0.65', valor: '5.60' });
    expect(res.cofins).toMatchObject({ base: '861.00', aliquota: '3', valor: '25.83' });
    // IBS/CBS: base = 1.050 − 189 − 5,60 − 25,83 = 829,57 (2026: CBS 0,9% / IBS 0,1%)
    expect(res.cbs).toMatchObject({ base: '829.57', aliquota: '0.9', valor: '7.47' });
    expect(res.ibs).toMatchObject({ base: '829.57', aliquota: '0.1', valor: '0.83' });
    expect(res.ipi.valor).toBe('0.00');
    // ramo do Simples não roda
    expect(res.difal.aplicavel).toBe(false);
  });

  it('totaliza a nota, gera a chave, autoriza (mock) e emite os boletos', async () => {
    const r = await runPedido(tenant());
    const totais = r.nodes.totalizar!.totais as any;
    expect(totais).toMatchObject({ vProd: '1000.00', vFrete: '50.00', vNF: '1050.00', vBC: '1050.00', vICMS: '189.00', vPIS: '5.60', vCOFINS: '25.83' });
    expect(totais.ibscbs).toMatchObject({ vCBS: '7.47', vIBS: '0.83' });

    const chave = r.nodes.chave!.chave as string;
    expect(chave).toHaveLength(44);
    expect(isValidChaveNfe(chave)).toBe(true);
    expect(chave.startsWith('35' + '2609' + '11222333000181' + '55' + '001')).toBe(true);

    const aut = r.nodes.sefaz!.autorizacao as any;
    expect(aut).toMatchObject({ autorizada: true, cStat: '100', mock: true });
    expect(aut.nProt).toHaveLength(15);

    const parcelas = r.nodes.parcelas!.parcelas as any[];
    expect(parcelas.map((p) => p.valor)).toEqual(['350.00', '350.00', '350.00']);
    expect(parcelas.map((p) => p.vencimento)).toEqual(['2026-10-30', '2026-11-29', '2026-12-29']);

    const boletos = r.nodes.boleto!.boletos as any[];
    expect(boletos).toHaveLength(3);
    for (const b of boletos) {
      expect(b.codigoBarras).toMatch(/^\d{44}$/);
      expect(b.linhaDigitavel).toMatch(/^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
      // DV geral confere
      const semDv = b.codigoBarras.slice(0, 4) + b.codigoBarras.slice(5);
      expect(mod11Barras(semDv)).toBe(Number(b.codigoBarras[4]));
      expect(b.codigoBarras.slice(9, 19)).toBe('0000035000');
    }
  });

  it('o XML traz os grupos de imposto e a chave', async () => {
    const r = await runPedido(tenant());
    const xml = r.nodes.xml!.xml as string;
    expect(xml).toContain(`Id="NFe${r.nodes.chave!.chave}"`);
    expect(xml).toContain('<ICMS00>');
    expect(xml).toContain('<vICMS>189.00</vICMS>');
    expect(xml).toContain('<PISAliq>');
    expect(xml).toContain('<IBSCBS>');
    expect(xml).toContain('<vCBS>7.47</vCBS>');
    expect(xml).toContain('<vNF>1050.00</vNF>');
  });

  it('reprocessar o mesmo pedido dá o mesmo resultado (vigência por data)', async () => {
    const a = await runPedido(tenant());
    const b = await runPedido(tenant(), pedido(), { services: mockServices() });
    expect(a.nodes.totalizar).toEqual(b.nodes.totalizar);
    expect((a.nodes.itens as any).resultados).toEqual((b.nodes.itens as any).resultados);
  });

  it('aplica as alíquotas da reforma vigentes na data de emissão (2027 ≠ 2026)', async () => {
    const r = await runPedido(tenant(), pedido({ dataEmissao: '2027-03-10' }), { referenceDate: '2027-03-10' });
    const res = (r.nodes.itens!.resultados as any[])[0];
    expect(res.cbs.aliquota).toBe('8.8');
    expect(res.cbs.valor).toBe('73.00'); // 829,57 × 8,8% = 72,998
    expect(res.ibs.aliquota).toBe('0.1');
  });

  it('rejeição da SEFAZ encerra como REJEITADA e não emite boleto', async () => {
    const r = await runPedido(tenant({ cnpj: '11222333000182' }));
    expect(r.status).toBe('REJEITADA');
    expect(r.error).toMatchObject({ code: 'SEFAZ_REJEICAO', nodeId: 'sefaz' });
    expect(r.error!.message).toContain('207');
    expect(r.trace.find((t) => t.nodeId === 'boleto')).toBeUndefined();
    expect(r.trace.find((t) => t.nodeId === 'sefaz')!.status).toBe('error');
  });

  it('pedido inválido vira erro de bloco com os detalhes', async () => {
    const bad = pedido();
    bad.destinatario.documento = '123';
    const r = await runPedido(tenant(), bad);
    expect(r.status).toBe('ERRO');
    expect(r.error!.code).toBe('PEDIDO_INVALIDO');
    expect(JSON.stringify(r.error!.details)).toContain('destinatario.documento');
  });

  it('o trace traz os subfluxos de cada item', async () => {
    const p = pedido();
    p.itens.push({ ...p.itens[0], codigo: 'CAM-002' });
    const r = await runPedido(tenant(), p);
    const entry = r.trace.find((t) => t.nodeId === 'itens')!;
    expect(entry.children).toHaveLength(2);
    expect(entry.children![0]!.label).toContain('CAM-001');
    const skippedNodes = entry.children![0]!.trace.filter((t) => t.status === 'skipped').map((t) => t.nodeId);
    expect(skippedNodes).toEqual(expect.arrayContaining(['simplesAliq', 'simplesIcms']));
    expect((r.nodes.totalizar!.totais as any).vProd).toBe('2000.00');
  });
});

describe('Simples Nacional', () => {
  const simples = () => tenant({ regime: 'SIMPLES', crt: 1, uf: 'MG', rbt12: '300000', config: { anexoSimples: 'I' } });

  it('calcula a alíquota efetiva e o crédito de ICMS (CSOSN 101)', async () => {
    const r = await runPedido(simples(), pedido({ destinatario: { ...pedido().destinatario, uf: 'MG' } }));
    expect(r.status).toBe('OK');
    const res = (r.nodes.itens!.resultados as any[])[0];
    // faixa 2 do Anexo I: (300.000 × 7,3% − 5.940) / 300.000 = 5,32% · ICMS = 34% disso = 1,8088%
    expect(res.icms).toMatchObject({ csosn: '101', aliquota: '1.8088', valor: '18.99' });
    expect(res.pis).toBeUndefined();
    expect(res.cbs.aplicavel).toBe(false); // teste de 2026 dispensado para o Simples
    const totais = r.nodes.totalizar!.totais as any;
    expect(totais).toMatchObject({ vICMS: '0.00', vCredICMSSN: '18.99', vNF: '1050.00' });
    const xml = r.nodes.xml!.xml as string;
    expect(xml).toContain('<ICMSSN101>');
    expect(xml).toContain('PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ 18.99');
    expect(xml).toContain('<CRT>1</CRT>');
  });

  it('falha com mensagem clara sem RBT12', async () => {
    const r = await runPedido({ ...simples(), rbt12: null });
    expect(r.status).toBe('ERRO');
    expect(r.error!.code).toBe('SEM_RBT12');
  });
});

// ---------------------------------------------------------------------------
// Blocos isolados
// ---------------------------------------------------------------------------

describe('ICMS-ST', () => {
  it('interna: BCST = base × (1+MVA); ST = BCST × alíquota − ICMS próprio', async () => {
    const t = tenant();
    const it = item({ ncm: '22021000', vFrete: '0.00' });
    const icms = icmsTrib('1000.00', '18', '180.00');
    const { icmsSt } = (await out('tax.icmsSt', { item: it, contexto: contexto(t, 'SP'), icms })) as any;
    expect(icmsSt).toMatchObject({ base: '1400.00', aliquota: '18', valor: '72.00', mva: '40' });
  });

  it('interestadual: usa a MVA ajustada', async () => {
    const t = tenant();
    const it = item({ ncm: '22021000', vFrete: '0.00' });
    const icms = icmsTrib('1000.00', '12', '120.00');
    const { icmsSt } = (await out('tax.icmsSt', { item: it, contexto: contexto(t, 'MG'), icms })) as any;
    // MVAaj = 1,4 × (1 − 0,12) / (1 − 0,18) − 1 = 50,2439%
    expect(icmsSt.mvaAjustada).toBe('50.2439');
    expect(icmsSt).toMatchObject({ base: '1502.44', valor: '150.44' });
  });

  it('sem MVA para o NCM, não há ST', async () => {
    const { icmsSt } = (await out('tax.icmsSt', { item: item(), contexto: contexto(tenant(), 'SP'), icms: icmsTrib('1050.00', '18', '189.00') })) as any;
    expect(icmsSt).toMatchObject({ aplicavel: false, valor: '0.00' });
  });
});

describe('DIFAL e FCP', () => {
  const ctx = () => contexto(tenant(), 'BA', { consumidorFinal: true, contribuinte: false, indIEDest: 9 });
  const icms = icmsTrib('1050.00', '7', '73.50');

  it('ICMS interestadual SP → BA é 7%', async () => {
    const { icms: r } = (await out('tax.icms', { item: item(), contexto: ctx() })) as any;
    expect(r).toMatchObject({ base: '1050.00', aliquota: '7', valor: '73.50' });
  });

  it('base única: BC × (ALQ destino − ALQ inter)', async () => {
    const { difal } = (await out('tax.difal', { item: item(), contexto: ctx(), icms }, { metodo: 'base_unica' })) as any;
    expect(difal).toMatchObject({ base: '1050.00', aliquota: '20.5', valor: '141.75' });
  });

  it('base dupla: (BC − ICMS) / (1 − ALQ destino)', async () => {
    const { difal } = (await out('tax.difal', { item: item(), contexto: ctx(), icms }, { metodo: 'base_dupla' })) as any;
    expect(difal.base).toBe('1228.30');
    expect(difal.valor).toBe('178.30');
  });

  it('não há DIFAL quando o destinatário não é consumidor final', async () => {
    const c = contexto(tenant(), 'BA', { consumidorFinal: false });
    const { difal } = (await out('tax.difal', { item: item(), contexto: c, icms })) as any;
    expect(difal.aplicavel).toBe(false);
  });

  it('FCP da UF de destino sobre a base do DIFAL', async () => {
    const { difal } = (await out('tax.difal', { item: item(), contexto: ctx(), icms })) as any;
    const { fcp } = (await out('tax.fcp', { item: item(), contexto: ctx(), difal }, { tipo: 'ufDestino' })) as any;
    expect(fcp).toMatchObject({ base: '1050.00', aliquota: '2', valor: '21.00', uf: 'BA' });
  });

  it('IPI integra a base do ICMS para consumidor final', async () => {
    const ipi = { base: '1050.00', aliquota: '10', valor: '105.00', aplicavel: true };
    const { icms: r } = (await out('tax.icms', { item: item(), contexto: ctx(), ipi })) as any;
    expect(r.base).toBe('1155.00');
    const { icms: r2 } = (await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP'), ipi })) as any;
    expect(r2.base).toBe('1050.00'); // contribuinte: IPI fora da base
  });

  it('origem importada usa 4% na operação interestadual', async () => {
    const { icms: r } = (await out('tax.icms', { item: item({ origem: 1 }), contexto: ctx() })) as any;
    expect(r.aliquota).toBe('4');
  });
});

describe('PIS/COFINS, transição do ICMS e Lucro Real', () => {
  it('Lucro Real usa alíquotas não cumulativas', async () => {
    const t = tenant({ regime: 'REAL' });
    const icms = icmsTrib('1050.00', '18', '189.00');
    const { pis } = (await out('tax.pis', { item: item(), contexto: contexto(t, 'SP'), icms }, {}, t)) as any;
    const { cofins } = (await out('tax.cofins', { item: item(), contexto: contexto(t, 'SP'), icms }, {}, t)) as any;
    expect(pis).toMatchObject({ aliquota: '1.65', valor: '14.21' }); // 861 × 1,65%
    expect(cofins).toMatchObject({ aliquota: '7.6', valor: '65.44' }); // 861 × 7,6%
  });

  it('a exclusão do ICMS da base pode ser desligada', async () => {
    const icms = icmsTrib('1050.00', '18', '189.00');
    const { pis } = (await out('tax.pis', { item: item(), contexto: contexto(tenant(), 'SP'), icms }, { excluirIcmsDaBase: false })) as any;
    expect(pis.base).toBe('1050.00');
  });

  it('em 2030 o ICMS é reduzido em 20%', async () => {
    const c = contexto(tenant(), 'SP', { dataEmissao: '2030-05-02', ano: 2030 });
    const icms = icmsTrib('1050.00', '18', '189.00');
    const r = (await out('reforma.transicaoIcms', { contexto: c, icms })) as any;
    expect(r.fator).toBe('0.2');
    expect(r.icms).toMatchObject({ aliquota: '14.4', valor: '151.20' });
    // antes de 2029, passa direto
    const r0 = (await out('reforma.transicaoIcms', { contexto: contexto(tenant(), 'SP'), icms })) as any;
    expect(r0.icms.valor).toBe('189.00');
  });
});

// ---------------------------------------------------------------------------
// Override
// ---------------------------------------------------------------------------

describe('override por empresa', () => {
  const ov = (over: Partial<OverrideEntry> = {}): OverrideEntry => ({
    id: 'ov1', blockKey: 'tax.icms', name: 'Liminar redução 50%', params: { pRedBC: 50 },
    validFrom: '2026-01-01', validTo: null, legalBasis: 'Mandado de segurança 123/2025', active: true, ...over,
  });

  it('override de parâmetros troca o cálculo e aparece no trace', async () => {
    const r = await runPedido(tenant(), pedido(), { overrides: [ov()] });
    const res = (r.nodes.itens!.resultados as any[])[0];
    expect(res.icms).toMatchObject({ base: '525.00', valor: '94.50' });
    const icmsTrace = r.trace.find((t) => t.nodeId === 'itens')!.children![0]!.trace.find((t) => t.nodeId === 'icms')!;
    expect(icmsTrace.override).toMatchObject({ id: 'ov1', kind: 'parametros', legalBasis: 'Mandado de segurança 123/2025' });
  });

  it('só vale dentro da vigência e quando está ativo', async () => {
    const base = await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') });
    expect((base.icms as any).valor).toBe('189.00');
    for (const o of [ov({ validTo: '2026-06-30' }), ov({ validFrom: '2026-10-01' }), ov({ active: false })]) {
      const r = await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), { overrides: [o] });
      expect((r.icms as any).valor).toBe('189.00');
    }
  });

  it('o override de vigência mais recente vence', async () => {
    const r = await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), {
      overrides: [ov({ id: 'a', params: { pRedBC: 10 }, validFrom: '2026-01-01' }), ov({ id: 'b', params: { pRedBC: 50 }, validFrom: '2026-06-01' })],
    });
    expect((r.icms as any).valor).toBe('94.50');
  });

  it('override com código substitui o bloco e é validado pelo contrato de saída', async () => {
    const code = `function calcular({ inputs, D }) {
      const base = D(inputs.item.vProd).plus(D(inputs.item.vFrete)).times('0.5');
      return { icms: { base: base.toFixed(2), aliquota: '18', valor: base.times('0.18').toFixed(2), aplicavel: true } };
    }`;
    const r = await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), {
      overrides: [ov({ code, params: {} })], runner: testRunner,
    });
    expect(r.icms).toMatchObject({ base: '525.00', valor: '94.50' });

    // saída fora do contrato (sem "valor") é barrada
    const bad = `function calcular() { return { icms: { base: '1.00', aliquota: '18' } }; }`;
    await expect(
      out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), { overrides: [ov({ code: bad, params: {} })], runner: testRunner }),
    ).rejects.toMatchObject({ code: 'SAIDA_INVALIDA' });

    // saída ausente
    const none = `function calcular() { return {}; }`;
    await expect(
      out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), { overrides: [ov({ code: none, params: {} })], runner: testRunner }),
    ).rejects.toMatchObject({ code: 'SAIDA_AUSENTE' });
  });

  it('código sem runner configurado falha com erro claro', async () => {
    await expect(
      out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), { overrides: [ov({ code: 'function calcular(){}', params: {} })] }),
    ).rejects.toMatchObject({ code: 'SEM_RUNNER' });
  });

  it('o código pode consultar as tabelas de referência', async () => {
    const code = `function calcular({ inputs, tabela }) {
      const t = tabela('icms_interna', { uf: 'RJ' });
      return { icms: { base: '100.00', aliquota: t.aliquota, valor: '20.00', aplicavel: true } };
    }`;
    const r = await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') }, {}, tenant(), { overrides: [ov({ code, params: {} })], runner: testRunner });
    expect((r.icms as any).aliquota).toBe('20');
  });
});

// ---------------------------------------------------------------------------
// Blocos de lógica
// ---------------------------------------------------------------------------

const n = (id: string, blockKey: string, data: Record<string, unknown> = {}): FlowNode => ({
  id, position: { x: 0, y: 0 }, data: { blockKey, ...data } as any,
});

describe('blocos de lógica', () => {
  it('bloco de código com portas declaradas roda no runner e valida as saídas', async () => {
    const g: FlowGraph = {
      nodes: [
        n('t', 'trigger.webhook'),
        n('f', 'logic.expressao', { params: { expressao: '10.5 * 2', casas: 2 } }),
        n('c', 'logic.codigo', {
          params: { code: 'function calcular({ inputs, D }) { return { dobro: D(inputs.valor).times(2).toFixed(2) }; }' },
          inputs: [{ id: 'valor', label: 'Valor', type: 'decimal', required: true }],
          outputs: [{ id: 'dobro', label: 'Dobro', type: 'decimal', required: true }],
        }),
      ],
      edges: [{ id: 'e1', source: 'f', sourceHandle: 'resultado', target: 'c', targetHandle: 'valor' }],
    };
    expect(validateGraph(g).filter((i) => i.level === 'error')).toEqual([]);
    const r = await runFlow({ graph: g, payload: {}, ctx: ctxOf(tenant(), { runner: testRunner }) });
    expect(r.status).toBe('OK');
    expect(r.nodes.f!.resultado).toBe('21.00');
    expect(r.nodes.c!.dobro).toBe('42.00');
  });

  it('saída do código com tipo errado é rejeitada', async () => {
    const g: FlowGraph = {
      nodes: [
        n('t', 'trigger.webhook'),
        n('c', 'logic.codigo', {
          params: { code: "function calcular() { return { v: 'abc' }; }" },
          inputs: [],
          outputs: [{ id: 'v', label: 'V', type: 'decimal', required: true }],
        }),
      ],
      edges: [],
    };
    const r = await runFlow({ graph: g, payload: {}, ctx: ctxOf(tenant(), { runner: testRunner }) });
    expect(r.status).toBe('ERRO');
    expect(r.error).toMatchObject({ code: 'SAIDA_INVALIDA', nodeId: 'c' });
  });

  const ramo = (id: string) =>
    n(id, 'logic.codigo', {
      params: { code: 'function calcular(){ return {}; }' },
      inputs: [{ id: 'x', label: 'x', type: 'object', required: true }],
      outputs: [],
    });

  it('condição ativa só um ramo e ignora o outro', async () => {
    const g: FlowGraph = {
      nodes: [
        n('t', 'trigger.webhook'),
        n('if', 'logic.condicao', { params: { caminho: 'valor', operador: 'maior', valor: 100 } }),
        ramo('sim'),
        ramo('nao'),
      ],
      edges: [
        { id: '1', source: 't', sourceHandle: 'payload', target: 'if', targetHandle: 'entrada' },
        { id: '2', source: 'if', sourceHandle: 'verdadeiro', target: 'sim', targetHandle: 'x' },
        { id: '3', source: 'if', sourceHandle: 'falso', target: 'nao', targetHandle: 'x' },
      ],
    };
    const status = async (valor: number) => {
      const r = await runFlow({ graph: g, payload: { valor }, ctx: ctxOf(tenant(), { runner: testRunner }) });
      expect(r.status).toBe('OK');
      return Object.fromEntries(r.trace.map((t) => [t.nodeId, t.status]));
    };
    expect(await status(150)).toMatchObject({ sim: 'ok', nao: 'skipped' });
    expect(await status(50)).toMatchObject({ sim: 'skipped', nao: 'ok' });
  });

  it('ramo inativo em entrada obrigatória pula o bloco', async () => {
    const g: FlowGraph = {
      nodes: [
        n('t', 'trigger.webhook'),
        n('if', 'logic.condicao', { params: { caminho: 'valor', operador: 'maior', valor: 100 } }),
        n('u', 'logic.codigo', {
          params: { code: 'function calcular(){ return {}; }' },
          inputs: [{ id: 'x', label: 'x', type: 'object', required: true }],
          outputs: [],
        }),
      ],
      edges: [
        { id: '1', source: 't', sourceHandle: 'payload', target: 'if', targetHandle: 'entrada' },
        { id: '2', source: 'if', sourceHandle: 'verdadeiro', target: 'u', targetHandle: 'x' },
      ],
    };
    const r = await runFlow({ graph: g, payload: { valor: 1 }, ctx: ctxOf(tenant(), { runner: testRunner }) });
    expect(r.status).toBe('OK');
    expect(r.trace.find((t) => t.nodeId === 'u')!.status).toBe('skipped');
  });

  it('avaliador de fórmulas usa decimais exatos', () => {
    expect(evalExpression('0.1 + 0.2', {}).toFixed()).toBe('0.3');
    expect(evalExpression('round(base * (1 - reducao / 100), 2)', { base: '1050', reducao: 50 }).toFixed()).toBe('525');
    expect(evalExpression('-a + max(b, 3) * 2', { a: 1, b: 5 }).toFixed()).toBe('9');
    expect(() => evalExpression('1 / 0', {})).toThrow(/zero/);
    expect(() => evalExpression('process.exit()', {})).toThrow();
    expect(() => evalExpression('x + 1', {})).toThrow(/desconhecida/);
  });
});

// ---------------------------------------------------------------------------
// Validação do grafo
// ---------------------------------------------------------------------------

describe('validação do grafo', () => {
  it('o fluxo padrão é válido', () => {
    const errors = validateGraph(graph()).filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('detecta gatilho ausente, tipo incompatível, entrada sem conexão e ciclo', () => {
    const g = graph();
    const semGatilho: FlowGraph = { ...g, nodes: g.nodes.filter((x) => x.id !== 'gatilho'), edges: g.edges.filter((e) => e.source !== 'gatilho') };
    expect(validateGraph(semGatilho).map((i) => i.message).join('|')).toMatch(/Webhook recebido/);
    expect(validateGraph(semGatilho).map((i) => i.message).join('|')).toMatch(/obrigatória e não está conectada/);

    const incompat: FlowGraph = { ...g, edges: [...g.edges, { id: 'x', source: 'chave', sourceHandle: 'numero', target: 'xml', targetHandle: 'pedido' }] };
    expect(validateGraph(incompat).map((i) => i.message).join('|')).toMatch(/Tipos incompatíveis/);

    const ciclo: FlowGraph = {
      nodes: [n('t', 'trigger.webhook'), n('a', 'logic.expressao'), n('b', 'logic.expressao')],
      edges: [
        { id: '1', source: 'a', sourceHandle: 'resultado', target: 'b', targetHandle: 'a' },
        { id: '2', source: 'b', sourceHandle: 'resultado', target: 'a', targetHandle: 'a' },
      ],
    };
    expect(validateGraph(ciclo).map((i) => i.message).join('|')).toMatch(/ciclo/);
  });

  it('detecta subfluxo inexistente e bloco desconhecido', () => {
    const g: FlowGraph = {
      nodes: [n('t', 'trigger.webhook'), n('s', 'flow.subfluxo', { flowId: 'nope' }), n('z', 'nao.existe')],
      edges: [],
    };
    const msgs = validateGraph(g).map((i) => i.message).join('|');
    expect(msgs).toMatch(/subfluxo "nope" não encontrado/);
    expect(msgs).toMatch(/Bloco desconhecido/);
  });

  it('o executor respeita o limite de execuções', async () => {
    const r = await runFlow({ graph: graph(), payload: pedido(), ctx: ctxOf(tenant(), { maxNodeRuns: 5 }) });
    expect(r.status).toBe('ERRO');
    expect(r.error!.code).toBe('LIMITE_EXECUCAO');
  });
});

// ---------------------------------------------------------------------------
// Utilitários fiscais
// ---------------------------------------------------------------------------

describe('utilitários fiscais', () => {
  it('fator de vencimento: nova base em 22/02/2025', () => {
    expect(fatorVencimento('2025-02-22')).toBe('1000');
    expect(fatorVencimento('2025-02-21')).toBe('9999');
    expect(fatorVencimento('2025-03-01')).toBe('1007');
  });

  it('módulo 10 e 11', () => {
    expect(mod10('123456789')).toBe(7);
    expect(mod11Barras('0'.repeat(43))).toBe(1);
  });

  it('chave de acesso com CNPJ alfanumérico', () => {
    const cnpj = cnpjWithDv('12ABC34501DE');
    const chave = montarChaveAcesso({ uf: 'SP', dataEmissao: '2026-08-15', cnpj, serie: 1, numero: 123, cNF: '00012345' });
    expect(chave).toHaveLength(44);
    expect(chave).toContain('12ABC34501DE35');
    expect(isValidChaveNfe(chave)).toBe(true);
  });

  it('tabelas: vigência, especificidade de NCM e prioridade da empresa', () => {
    const t = new InMemoryTables([
      { table: 'x', keys: { ncm: '*' }, value: { a: 'padrao' }, validFrom: '2000-01-01' },
      { table: 'x', keys: { ncm: '22' }, value: { a: 'capitulo' }, validFrom: '2000-01-01' },
      { table: 'x', keys: { ncm: '2202' }, value: { a: 'posicao' }, validFrom: '2000-01-01' },
      { table: 'x', keys: { ncm: '2202' }, value: { a: 'empresa' }, validFrom: '2000-01-01', tenantSpecific: true },
      { table: 'y', keys: {}, value: { v: 1 }, validFrom: '2026-01-01', validTo: '2026-12-31' },
      { table: 'y', keys: {}, value: { v: 2 }, validFrom: '2027-01-01' },
    ]);
    expect(t.lookup('x', { ncm: '61091000' }, '2026-01-01')).toEqual({ a: 'padrao' });
    expect(t.lookup('x', { ncm: '22030000' }, '2026-01-01')).toEqual({ a: 'capitulo' });
    expect(t.lookup('x', { ncm: '22021000' }, '2026-01-01')).toEqual({ a: 'empresa' });
    expect(t.lookup('y', {}, '2026-06-01')).toEqual({ v: 1 });
    expect(t.lookup('y', {}, '2027-06-01')).toEqual({ v: 2 });
    expect(t.lookup('y', {}, '2025-06-01')).toBeUndefined();
  });
});
