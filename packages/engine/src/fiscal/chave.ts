import { COD_UF, chaveAcessoDv, onlyDocChars, type UF } from '@motor-fiscal/shared';

export interface ChaveParts {
  uf: UF;
  /** AAAA-MM-DD */
  dataEmissao: string;
  cnpj: string;
  modelo?: number;
  serie: number;
  numero: number;
  tpEmis?: number;
  cNF: string;
}

const pad = (v: string | number, n: number) => String(v).padStart(n, '0');

/**
 * Chave de acesso (44): cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + série(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1).
 * O CNPJ pode ser alfanumérico (a partir de jul/2026): no DV o valor do caractere é ASCII − 48.
 */
export function montarChaveAcesso(p: ChaveParts): string {
  const aamm = p.dataEmissao.slice(2, 4) + p.dataEmissao.slice(5, 7);
  const base =
    COD_UF[p.uf] + aamm + onlyDocChars(p.cnpj) + pad(p.modelo ?? 55, 2) + pad(p.serie, 3) + pad(p.numero, 9) +
    String(p.tpEmis ?? 1) + pad(p.cNF, 8);
  if (base.length !== 43) throw new Error(`Chave inválida: base com ${base.length} posições`);
  return base + chaveAcessoDv(base);
}

/** Código numérico (cNF) determinístico: mesmo pedido e número geram a mesma chave. */
export function gerarCNF(seed: string, numero: number): string {
  let h = 2166136261;
  for (const ch of `${seed}|${numero}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let n = h % 100_000_000;
  // a NT proíbe cNF igual ao nNF
  if (n === numero) n = (n + 1) % 100_000_000;
  return pad(n, 8);
}
