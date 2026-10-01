/** Tabelas de referência com vigência (alíquotas, MVA, TIPI, faixas do Simples...). */

export interface RefRow {
  table: string;
  /** Chaves de busca. "*" casa com qualquer valor; em `ncm` vale prefixo. */
  keys: Record<string, string>;
  value: Record<string, unknown>;
  /** AAAA-MM-DD */
  validFrom: string;
  validTo?: string | null;
  /** Linha específica da empresa: vence as linhas globais de mesma especificidade. */
  tenantSpecific?: boolean;
}

export interface TableProvider {
  /** Melhor linha vigente em `date` para as chaves informadas. */
  lookup<T = Record<string, unknown>>(table: string, keys: Record<string, string>, date: string): T | undefined;
  /** Todas as linhas vigentes em `date` (sem resolver conflitos). */
  list(table: string, date: string): RefRow[];
}

const day = (d: string) => d.slice(0, 10);

function effectiveOn(row: RefRow, date: string): boolean {
  const d = day(date);
  return row.validFrom <= d && (!row.validTo || d <= row.validTo);
}

/** Retorna a pontuação de especificidade da linha para as chaves, ou -1 se não casa. */
function matchScore(row: RefRow, keys: Record<string, string>): number {
  let score = 0;
  for (const [k, expected] of Object.entries(row.keys)) {
    const actual = keys[k];
    if (expected === '*') continue;
    if (actual === undefined) return -1;
    if (k === 'ncm') {
      if (!actual.startsWith(expected)) return -1;
      score += 1 + expected.length; // NCM mais longo = mais específico
    } else {
      if (actual !== expected) return -1;
      score += 1000;
    }
  }
  return score;
}

export class InMemoryTables implements TableProvider {
  private byTable = new Map<string, RefRow[]>();

  constructor(rows: RefRow[] = []) {
    for (const r of rows) this.add(r);
  }

  add(row: RefRow): void {
    const list = this.byTable.get(row.table) ?? [];
    list.push(row);
    this.byTable.set(row.table, list);
  }

  lookup<T = Record<string, unknown>>(table: string, keys: Record<string, string>, date: string): T | undefined {
    let best: { row: RefRow; score: number } | undefined;
    for (const row of this.byTable.get(table) ?? []) {
      if (!effectiveOn(row, date)) continue;
      const score = matchScore(row, keys);
      if (score < 0) continue;
      const better =
        !best ||
        score > best.score ||
        (score === best.score &&
          (Number(!!row.tenantSpecific) > Number(!!best.row.tenantSpecific) ||
            (!!row.tenantSpecific === !!best.row.tenantSpecific && row.validFrom > best.row.validFrom)));
      if (better) best = { row, score };
    }
    return best?.row.value as T | undefined;
  }

  list(table: string, date: string): RefRow[] {
    return (this.byTable.get(table) ?? []).filter((r) => effectiveOn(r, date));
  }
}
