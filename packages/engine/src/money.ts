import Decimal from 'decimal.js';

/** Construtor Decimal isolado (não altera a config global da lib). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

/** Converte qualquer valor numérico/textual em Decimal; vazio/undefined vira 0. */
export function dec(v: unknown): Dec {
  if (v === undefined || v === null || v === '') return new D(0);
  return new D(v as string | number);
}

/** Arredonda (half-up) em `places` casas e devolve string com casas fixas. */
export function fix(v: Dec, places = 2): string {
  return v.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

/** Valor percentual (ex.: "18") aplicado sobre uma base: base * pct / 100, arredondado em 2 casas. */
export function pctOf(base: Dec, pct: Dec): Dec {
  return base.times(pct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export const max0 = (v: Dec): Dec => (v.isNegative() ? new D(0) : v);

/** Remove zeros à direita de um percentual: "18.0000" -> "18". */
export function pctStr(v: Dec): string {
  return v.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed();
}
