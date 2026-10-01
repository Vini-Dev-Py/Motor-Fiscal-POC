import { COD_UF, onlyDocChars } from '@motor-fiscal/shared';
import { dec } from '../money';
import type { Contexto, ItemNormalizado } from '../types';

/** Resultado dos impostos de um item (saída do subfluxo de impostos). */
export interface ResultadoItem {
  item: ItemNormalizado;
  icms?: Tri;
  icmsSt?: Tri;
  difal?: Tri;
  fcp?: Tri;
  fcpSt?: Tri;
  fcpUfDestino?: Tri;
  ipi?: Tri;
  pis?: Tri;
  cofins?: Tri;
  cbs?: Tri;
  ibs?: Tri;
  is?: Tri;
}

export type Tri = {
  base: string;
  aliquota: string;
  valor: string;
  aplicavel?: boolean;
  cst?: string;
  csosn?: string;
  [extra: string]: unknown;
};

export interface Totais {
  vBC: string; vICMS: string; vICMSDeson: string; vFCPUFDest: string; vICMSUFDest: string; vICMSUFRemet: string;
  vFCP: string; vBCST: string; vST: string; vFCPST: string; vFCPSTRet: string; vProd: string; vFrete: string;
  vSeg: string; vDesc: string; vII: string; vIPI: string; vIPIDevol: string; vPIS: string; vCOFINS: string;
  vOutro: string; vNF: string; vCredICMSSN: string; pCredSN?: string;
  ibscbs: { vBC: string; vIBSUF: string; vIBSMun: string; vIBS: string; vCBS: string; vIS: string };
  quantidadeItens: number;
}

export interface XmlInput {
  contexto: Contexto;
  pedido: { id: string; naturezaOperacao?: string; dataEmissao: string; destinatario: Contexto['destinatario'] & { indIEDest?: number }; pagamento?: { meio?: string; condicao?: string } };
  resultados: ResultadoItem[];
  totais: Totais;
  chave: string;
  numero: number;
  serie: number;
  parcelas?: Array<{ numero: number; vencimento: string; valor: string }>;
  ambiente?: 1 | 2;
}

const esc = (v: unknown) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const el = (name: string, content: string | number | undefined | null, attrs = '') =>
  content === undefined || content === null || content === '' ? '' : `<${name}${attrs}>${esc(content)}</${name}>`;
const grp = (name: string, inner: string, attrs = '') => (inner ? `<${name}${attrs}>${inner}</${name}>` : '');
const p4 = (v: string | undefined) => dec(v ?? 0).toFixed(4);
const p2 = (v: string | undefined) => dec(v ?? 0).toFixed(2);

function icmsXml(r: ResultadoItem): string {
  const t = r.icms;
  const orig = r.item.origem;
  if (!t) return '';
  if (t.csosn) {
    const base = el('orig', orig) + el('CSOSN', t.csosn);
    if (t.csosn === '101' || t.csosn === '201') {
      return grp('ICMS', grp('ICMSSN101', base + el('pCredSN', p4(String(t.pCredSN ?? t.aliquota))) + el('vCredICMSSN', p2(t.valor))));
    }
    if (t.csosn === '500') return grp('ICMS', grp('ICMSSN500', base));
    return grp('ICMS', grp('ICMSSN102', base));
  }
  const cst = t.cst ?? '00';
  const st = r.icmsSt && r.icmsSt.aplicavel !== false ? r.icmsSt : undefined;
  const fcp = r.fcp && r.fcp.aplicavel !== false ? r.fcp : undefined;
  const fcpXml = fcp ? el('vBCFCP', p2(fcp.base)) + el('pFCP', p4(fcp.aliquota)) + el('vFCP', p2(fcp.valor)) : '';
  const proprio = el('modBC', 3) + el('vBC', p2(t.base)) + el('pICMS', p4(t.aliquota)) + el('vICMS', p2(t.valor));
  const red = dec(String(t.pRedBC ?? 0));

  if (st) {
    const grupo = red.gt(0) ? 'ICMS70' : 'ICMS10';
    const stXml =
      el('modBCST', 4) + el('pMVAST', p4(String(st.mvaAjustada ?? st.mva ?? 0))) + el('vBCST', p2(st.base)) +
      el('pICMSST', p4(st.aliquota)) + el('vICMSST', p2(st.valor));
    return grp(
      'ICMS',
      grp(
        grupo,
        el('orig', orig) + el('CST', red.gt(0) ? '70' : '10') + el('modBC', 3) +
          (red.gt(0) ? el('pRedBC', p4(red.toFixed())) : '') +
          el('vBC', p2(t.base)) + el('pICMS', p4(t.aliquota)) + el('vICMS', p2(t.valor)) + stXml,
      ),
    );
  }
  switch (cst) {
    case '00':
      return grp('ICMS', grp('ICMS00', el('orig', orig) + el('CST', '00') + proprio + fcpXml));
    case '20':
      return grp(
        'ICMS',
        grp(
          'ICMS20',
          el('orig', orig) + el('CST', '20') + el('modBC', 3) + el('pRedBC', p4(red.toFixed())) +
            el('vBC', p2(t.base)) + el('pICMS', p4(t.aliquota)) + el('vICMS', p2(t.valor)) + fcpXml,
        ),
      );
    case '40':
    case '41':
    case '50':
      return grp('ICMS', grp('ICMS40', el('orig', orig) + el('CST', cst)));
    case '60':
      return grp('ICMS', grp('ICMS60', el('orig', orig) + el('CST', '60')));
    default:
      return grp('ICMS', grp('ICMS90', el('orig', orig) + el('CST', cst) + proprio));
  }
}

function ipiXml(r: ResultadoItem, regime: string): string {
  if (regime === 'SIMPLES') return '';
  const t = r.ipi;
  if (!t || t.aplicavel === false) return grp('IPI', el('cEnq', '999') + grp('IPINT', el('CST', '53')));
  return grp(
    'IPI',
    el('cEnq', '999') + grp('IPITrib', el('CST', t.cst ?? '50') + el('vBC', p2(t.base)) + el('pIPI', p4(t.aliquota)) + el('vIPI', p2(t.valor))),
  );
}

function pisCofinsXml(r: ResultadoItem, tipo: 'PIS' | 'COFINS'): string {
  const t = tipo === 'PIS' ? r.pis : r.cofins;
  const aliq = tipo === 'PIS' ? 'PISAliq' : 'COFINSAliq';
  const outr = tipo === 'PIS' ? 'PISOutr' : 'COFINSOutr';
  if (!t || t.aplicavel === false) {
    return grp(tipo, grp(outr, el('CST', '49') + el('vBC', '0.00') + el(`p${tipo}`, '0.0000') + el(`v${tipo}`, '0.00')));
  }
  return grp(tipo, grp(aliq, el('CST', t.cst ?? '01') + el('vBC', p2(t.base)) + el(`p${tipo}`, p4(t.aliquota)) + el(`v${tipo}`, p2(t.valor))));
}

function ibsCbsXml(r: ResultadoItem): string {
  const cbs = r.cbs;
  const ibs = r.ibs;
  if (!cbs || !ibs || (cbs.aplicavel === false && ibs.aplicavel === false)) return '';
  const vIbs = dec(ibs.valor);
  return grp(
    'IBSCBS',
    el('CST', String(ibs.cst ?? '000')) + el('cClassTrib', String(ibs.cClassTrib ?? '000001')) +
      grp(
        'gIBSCBS',
        el('vBC', p2(cbs.base)) +
          grp('gIBSUF', el('pIBSUF', p4(String(ibs.pIBSUF ?? 0))) + el('vIBSUF', p2(String(ibs.vIBSUF ?? 0)))) +
          grp('gIBSMun', el('pIBSMun', p4(String(ibs.pIBSMun ?? 0))) + el('vIBSMun', p2(String(ibs.vIBSMun ?? 0)))) +
          el('vIBS', vIbs.toFixed(2)) +
          grp('gCBS', el('pCBS', p4(cbs.aliquota)) + el('vCBS', p2(cbs.valor))),
      ),
  );
}

function detXml(r: ResultadoItem, c: Contexto, cfopPadrao: string): string {
  const it = r.item;
  const prod =
    el('cProd', it.codigo) + el('cEAN', 'SEM GTIN') + el('xProd', it.descricao) + el('NCM', it.ncm) +
    el('CFOP', it.cfop ?? cfopPadrao) + el('uCom', it.unidade) + el('qCom', dec(it.quantidade).toFixed(4)) +
    el('vUnCom', dec(it.valorUnitario).toFixed(10)) + el('vProd', p2(it.vProd)) + el('cEANTrib', 'SEM GTIN') +
    el('uTrib', it.unidade) + el('qTrib', dec(it.quantidade).toFixed(4)) + el('vUnTrib', dec(it.valorUnitario).toFixed(10)) +
    (dec(it.vFrete).gt(0) ? el('vFrete', p2(it.vFrete)) : '') +
    (dec(it.vSeg).gt(0) ? el('vSeg', p2(it.vSeg)) : '') +
    (dec(it.vDesc).gt(0) ? el('vDesc', p2(it.vDesc)) : '') +
    (dec(it.vOutro).gt(0) ? el('vOutro', p2(it.vOutro)) : '') +
    el('indTot', 1);
  const imposto =
    icmsXml(r) + ipiXml(r, c.tenant.regime) + pisCofinsXml(r, 'PIS') + pisCofinsXml(r, 'COFINS') + ibsCbsXml(r);
  return `<det nItem="${it.nItem}">${grp('prod', prod)}${grp('imposto', imposto)}</det>`;
}

export function montarNfeXml(i: XmlInput): string {
  const { contexto: c, pedido, totais: t } = i;
  const emit = c.tenant;
  const docDest = onlyDocChars(pedido.destinatario.documento);
  const tag = docDest.length === 14 ? 'CNPJ' : 'CPF';
  const aVista = !i.parcelas || i.parcelas.length <= 1;

  const ide =
    el('cUF', COD_UF[c.operacao.ufOrigem]) + el('cNF', i.chave.slice(35, 43)) + el('natOp', pedido.naturezaOperacao ?? 'Venda de mercadoria') +
    el('mod', 55) + el('serie', i.serie) + el('nNF', i.numero) + el('dhEmi', `${c.operacao.dataEmissao}T12:00:00-03:00`) +
    el('tpNF', 1) + el('idDest', c.operacao.idDest) + el('cMunFG', emit.codMunicipio) + el('tpImp', 1) + el('tpEmis', 1) +
    el('cDV', i.chave.slice(43)) + el('tpAmb', i.ambiente ?? 2) + el('finNFe', 1) + el('indFinal', c.operacao.consumidorFinal ? 1 : 0) +
    el('indPres', 9) + el('procEmi', 0) + el('verProc', 'motor-fiscal-poc-0.1');

  const emitXml =
    el('CNPJ', onlyDocChars(emit.cnpj)) + el('xNome', emit.razaoSocial) +
    grp('enderEmit', el('xLgr', 'NAO INFORMADO') + el('nro', 'S/N') + el('xBairro', 'NAO INFORMADO') + el('cMun', emit.codMunicipio) + el('UF', emit.uf)) +
    el('IE', emit.ie ?? '') + el('CRT', emit.crt);

  const destXml =
    el(tag, docDest) + el('xNome', pedido.destinatario.nome) +
    grp('enderDest', el('xLgr', 'NAO INFORMADO') + el('nro', 'S/N') + el('xBairro', 'NAO INFORMADO') + el('cMun', pedido.destinatario.codMunicipio ?? '') + el('UF', pedido.destinatario.uf)) +
    el('indIEDest', c.operacao.indIEDest) + (pedido.destinatario.ie ? el('IE', pedido.destinatario.ie) : '');

  const icmsTot =
    el('vBC', p2(t.vBC)) + el('vICMS', p2(t.vICMS)) + el('vICMSDeson', p2(t.vICMSDeson)) + el('vFCPUFDest', p2(t.vFCPUFDest)) +
    el('vICMSUFDest', p2(t.vICMSUFDest)) + el('vICMSUFRemet', p2(t.vICMSUFRemet)) + el('vFCP', p2(t.vFCP)) +
    el('vBCST', p2(t.vBCST)) + el('vST', p2(t.vST)) + el('vFCPST', p2(t.vFCPST)) + el('vFCPSTRet', p2(t.vFCPSTRet)) +
    el('vProd', p2(t.vProd)) + el('vFrete', p2(t.vFrete)) + el('vSeg', p2(t.vSeg)) + el('vDesc', p2(t.vDesc)) +
    el('vII', p2(t.vII)) + el('vIPI', p2(t.vIPI)) + el('vIPIDevol', p2(t.vIPIDevol)) + el('vPIS', p2(t.vPIS)) +
    el('vCOFINS', p2(t.vCOFINS)) + el('vOutro', p2(t.vOutro)) + el('vNF', p2(t.vNF));

  const ibsCbsTot = dec(t.ibscbs.vIBS).plus(dec(t.ibscbs.vCBS)).gt(0)
    ? grp(
        'IBSCBSTot',
        el('vBCIBSCBS', p2(t.ibscbs.vBC)) +
          grp('gIBS', grp('gIBSUF', el('vIBSUF', p2(t.ibscbs.vIBSUF))) + grp('gIBSMun', el('vIBSMun', p2(t.ibscbs.vIBSMun))) + el('vIBS', p2(t.ibscbs.vIBS))) +
          grp('gCBS', el('vCBS', p2(t.ibscbs.vCBS))),
      )
    : '';

  const cobr = i.parcelas?.length
    ? grp(
        'cobr',
        grp('fat', el('nFat', pedido.id) + el('vOrig', p2(t.vNF)) + el('vLiq', p2(t.vNF))) +
          i.parcelas.map((p) => grp('dup', el('nDup', String(p.numero).padStart(3, '0')) + el('dVenc', p.vencimento) + el('vDup', p2(p.valor)))).join(''),
      )
    : '';

  const pag = grp('pag', grp('detPag', el('indPag', aVista ? 0 : 1) + el('tPag', pedido.pagamento?.meio ?? '15') + el('vPag', p2(t.vNF))));

  const infCpl: string[] = [`Pedido ${pedido.id}`];
  if (dec(t.vCredICMSSN).gt(0)) {
    infCpl.push(
      `PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ ${p2(t.vCredICMSSN)} CORRESPONDENTE A ALIQUOTA DE ${dec(t.pCredSN ?? 0).toFixed(2)}%, NOS TERMOS DO ART. 23 DA LC 123/2006`,
    );
  }
  infCpl.push('DOCUMENTO GERADO PELO MOTOR FISCAL (POC) - SEM VALOR FISCAL');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">' +
    `<infNFe Id="NFe${i.chave}" versao="4.00">` +
    grp('ide', ide) + grp('emit', emitXml) + grp('dest', destXml) +
    i.resultados.map((r) => detXml(r, c, c.operacao.cfop)).join('') +
    grp('total', grp('ICMSTot', icmsTot) + ibsCbsTot) +
    grp('transp', el('modFrete', 9)) + cobr + pag +
    grp('infAdic', el('infCpl', infCpl.join(' | '))) +
    '</infNFe></NFe>'
  );
}
