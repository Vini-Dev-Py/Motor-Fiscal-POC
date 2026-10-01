/** Validadores de documentos e códigos fiscais brasileiros. */

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;
export type UF = (typeof UFS)[number];

/** Código IBGE de cada UF (usado no cUF da chave de acesso e da NF-e). */
export const COD_UF: Record<UF, string> = {
  AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23', DF: '53', ES: '32', GO: '52',
  MA: '21', MG: '31', MS: '50', MT: '51', PA: '15', PB: '25', PE: '26', PI: '22', PR: '41',
  RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42', SE: '28', SP: '35', TO: '17',
};

export const isUF = (v: unknown): v is UF => typeof v === 'string' && (UFS as readonly string[]).includes(v);

/** Remove máscara (. / -) e normaliza para maiúsculas. */
export function onlyDocChars(v: string): string {
  return v.replace(/[.\-/\s]/g, '').toUpperCase();
}

export function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/**
 * Valor do caractere no cálculo do DV do CNPJ: ASCII - 48.
 * Vale para o CNPJ numérico e para o alfanumérico (vigente a partir de julho/2026).
 */
const cnpjCharValue = (c: string) => c.charCodeAt(0) - 48;

const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function cnpjDv(chars: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += cnpjCharValue(chars[i]!) * weights[i]!;
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Valida CNPJ numérico ou alfanumérico (aceita máscara). */
export function isValidCnpj(input: string): boolean {
  const v = onlyDocChars(input);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(v)) return false;
  if (/^(\d)\1{13}$/.test(v)) return false;
  const dv1 = cnpjDv(v, CNPJ_W1);
  const dv2 = cnpjDv(v.slice(0, 12) + dv1, CNPJ_W2);
  return v.endsWith(`${dv1}${dv2}`);
}

/** Gera os 2 dígitos verificadores para uma base de 12 caracteres (útil em testes e seeds). */
export function cnpjWithDv(base12: string): string {
  const b = onlyDocChars(base12);
  if (!/^[0-9A-Z]{12}$/.test(b)) throw new Error('A base do CNPJ deve ter 12 caracteres [0-9A-Z]');
  const dv1 = cnpjDv(b, CNPJ_W1);
  const dv2 = cnpjDv(b + dv1, CNPJ_W2);
  return `${b}${dv1}${dv2}`;
}

export function isValidCpf(input: string): boolean {
  const v = digitsOnly(input);
  if (v.length !== 11 || /^(\d)\1{10}$/.test(v)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(v[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(v[9]) && calc(10) === Number(v[10]);
}

export const isValidCnpjOrCpf = (v: string) => isValidCnpj(v) || isValidCpf(v);

export const isValidNcm = (v: string) => /^\d{8}$/.test(v);
export const isValidCfop = (v: string) => /^[1-7]\d{3}$/.test(v);
export const isValidCep = (v: string) => /^\d{8}$/.test(digitsOnly(v)) && digitsOnly(v) === v.replace(/-/g, '');

/**
 * DV (módulo 11, pesos 2..9 da direita para a esquerda) da chave de acesso da NF-e.
 * Com o CNPJ alfanumérico a chave pode ter letras: o valor do caractere é ASCII - 48.
 */
export function chaveAcessoDv(chave43: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    sum += (chave43.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isValidChaveNfe(v: string): boolean {
  return /^[0-9A-Z]{43}\d$/.test(v) && chaveAcessoDv(v.slice(0, 43)) === Number(v[43]);
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isValidIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isValidIsoDateTime(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
}

export const FORMAT_VALIDATORS = {
  cnpj: { label: 'CNPJ', check: isValidCnpj, message: 'CNPJ inválido' },
  cpf: { label: 'CPF', check: isValidCpf, message: 'CPF inválido' },
  cnpjOuCpf: { label: 'CNPJ ou CPF', check: isValidCnpjOrCpf, message: 'CNPJ/CPF inválido' },
  cep: { label: 'CEP', check: isValidCep, message: 'CEP inválido (8 dígitos)' },
  ncm: { label: 'NCM', check: isValidNcm, message: 'NCM inválido (8 dígitos)' },
  cfop: { label: 'CFOP', check: isValidCfop, message: 'CFOP inválido (4 dígitos, começando de 1 a 7)' },
  uf: { label: 'UF', check: isUF, message: 'UF inválida' },
  chaveNfe: { label: 'Chave de acesso NF-e', check: isValidChaveNfe, message: 'Chave de acesso inválida' },
  email: { label: 'E-mail', check: isValidEmail, message: 'E-mail inválido' },
} as const;

export type FieldFormat = keyof typeof FORMAT_VALIDATORS;
export const FIELD_FORMATS = Object.keys(FORMAT_VALIDATORS) as FieldFormat[];
