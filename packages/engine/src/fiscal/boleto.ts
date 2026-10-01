import type { Boleto, BoletoRequest } from '../types';
import { dec } from '../money';

/** DV módulo 10 (pesos 2,1,2,1... da direita para a esquerda; soma dos algarismos dos produtos). */
export function mod10(num: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    const p = Number(num[i]) * weight;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    weight = weight === 2 ? 1 : 2;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

/** DV geral do código de barras: módulo 11 (pesos 2..9); 0, 10 e 11 viram 1. */
export function mod11Barras(num: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

const MS_DIA = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/**
 * Fator de vencimento. A base original (07/10/1997 = 0000; 03/07/2000 = 1000) chegou a 9999 em 21/02/2025;
 * desde 22/02/2025 o fator recomeça em 1000 (FEBRABAN).
 */
export function fatorVencimento(vencimento: string): string {
  const dias = Math.round((utc(vencimento) - Date.UTC(2025, 1, 22)) / MS_DIA);
  if (dias < 0) {
    // antes da nova base: contagem original (dias desde 07/10/1997)
    const antiga = Math.round((utc(vencimento) - Date.UTC(1997, 9, 7)) / MS_DIA);
    return String(antiga).padStart(4, '0');
  }
  return String(1000 + (dias % 9000)).padStart(4, '0');
}

const digits = (v: string, n: number) => v.replace(/\D/g, '').padStart(n, '0').slice(-n);

/** Hash determinístico usado para gerar o "nosso número" do mock. */
function seqFrom(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100_000_000;
}

export function gerarBoleto(req: BoletoRequest): Boleto {
  const { config } = req;
  const nossoBase =
    String(seqFrom(`${req.tenant.id}|${req.numeroDocumento}`)).padStart(8, '0') + digits(String(req.parcela), 2);
  const nossoNumero = nossoBase + mod10(nossoBase); // 11 posições

  // campo livre (25): agência(4) + carteira(3) + nosso número(11) + conta(6) + 0
  const campoLivre = digits(config.agencia, 4) + digits(config.carteira, 3) + nossoNumero + digits(config.conta, 6) + '0';
  const valor = digits(dec(req.valor).times(100).toFixed(0), 10);
  const fator = fatorVencimento(req.vencimento);
  const banco = digits(config.banco, 3);

  const semDv = `${banco}9${fator}${valor}${campoLivre}`; // 43 posições
  const dvGeral = mod11Barras(semDv);
  const codigoBarras = `${banco}9${dvGeral}${fator}${valor}${campoLivre}`;

  const c1 = `${banco}9${campoLivre.slice(0, 5)}`;
  const c2 = campoLivre.slice(5, 15);
  const c3 = campoLivre.slice(15, 25);
  const linhaDigitavel =
    `${c1.slice(0, 5)}.${c1.slice(5)}${mod10(c1)} ` +
    `${c2.slice(0, 5)}.${c2.slice(5)}${mod10(c2)} ` +
    `${c3.slice(0, 5)}.${c3.slice(5)}${mod10(c3)} ` +
    `${dvGeral} ${fator}${valor}`;

  return {
    numeroDocumento: req.numeroDocumento,
    parcela: req.parcela,
    nossoNumero,
    codigoBarras,
    linhaDigitavel,
    vencimento: req.vencimento,
    valor: req.valor,
    banco,
    pagador: { nome: req.pagador.nome, documento: req.pagador.documento },
    beneficiario: config.beneficiario,
    mock: true,
  };
}
