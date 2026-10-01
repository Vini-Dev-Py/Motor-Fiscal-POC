import type { UF } from '@motor-fiscal/shared';
import { D, dec, fix, pctStr, type Dec } from '../money';
import type { TableProvider } from '../tables';
import type { Contexto, ItemNormalizado } from '../types';

const SUL_SUDESTE_EXCETO_ES: UF[] = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'];

/**
 * Alíquota interestadual do ICMS (Resolução do Senado 22/1989 e 13/2012):
 *  - 4%  mercadoria importada (origem 1, 2, 3 ou 8);
 *  - 7%  origem Sul/Sudeste (exceto ES) para N/NE/CO/ES;
 *  - 12% demais operações.
 */
export function aliquotaInterestadual(ufOrigem: UF, ufDestino: UF, origemMercadoria: number): Dec {
  if ([1, 2, 3, 8].includes(origemMercadoria)) return new D(4);
  if (SUL_SUDESTE_EXCETO_ES.includes(ufOrigem) && !SUL_SUDESTE_EXCETO_ES.includes(ufDestino)) return new D(7);
  return new D(12);
}

/** Alíquota interna modal da UF (tabela `icms_interna`, padrão 18%). */
export function aliquotaInterna(tables: TableProvider, uf: UF, date: string): Dec {
  const row = tables.lookup<{ aliquota: string }>('icms_interna', { uf }, date);
  return dec(row?.aliquota ?? 18);
}

/** Alíquota do ICMS próprio da operação: interestadual quando UF de origem ≠ destino. */
export function aliquotaIcmsOperacao(tables: TableProvider, ctx: Contexto, item: ItemNormalizado): Dec {
  const op = ctx.operacao;
  if (op.idDest === 3) return new D(0);
  return op.interestadual
    ? aliquotaInterestadual(op.ufOrigem, op.ufDestino, item.origem)
    : aliquotaInterna(tables, op.ufOrigem, op.dataEmissao);
}

/** vProd + vFrete + vSeg + vOutro - vDesc */
export function valorOperacao(item: ItemNormalizado): Dec {
  return dec(item.vProd).plus(dec(item.vFrete)).plus(dec(item.vSeg)).plus(dec(item.vOutro)).minus(dec(item.vDesc));
}

export interface TributoOut {
  base: string;
  aliquota: string;
  valor: string;
  aplicavel: boolean;
  cst?: string;
  csosn?: string;
  [extra: string]: unknown;
}

/** Tributo "não aplicável": todos os valores zerados (mantém o contrato de saída do bloco). */
export function tributoZero(extra: Record<string, unknown> = {}): TributoOut {
  return { base: '0.00', aliquota: '0', valor: '0.00', aplicavel: false, ...extra };
}

export function tributo(base: Dec, aliquota: Dec, valor: Dec, extra: Record<string, unknown> = {}): TributoOut {
  return { base: fix(base), aliquota: pctStr(aliquota), valor: fix(valor), aplicavel: true, ...extra };
}

/** CSTs de ICMS sem imposto destacado. */
export const CST_ICMS_SEM_VALOR = ['30', '40', '41', '50', '60'];

/** Ano (AAAA) de uma data ISO. */
export const yearOf = (date: string) => Number(date.slice(0, 4));
