import { D, type Dec } from './money';

/**
 * Avaliador seguro de fórmulas simples, em aritmética decimal (sem eval):
 *   números, variáveis, + - * / ( ), e funções min, max, abs, round(x, casas), pct(base, percentual).
 * Exemplo: `round(base * (1 - reducao / 100), 2)`
 */
type Token = { t: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      out.push({ t: 'num', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(') { out.push({ t: 'lp', v: ch }); i++; continue; }
    if (ch === ')') { out.push({ t: 'rp', v: ch }); i++; continue; }
    if (ch === ',') { out.push({ t: 'comma', v: ch }); i++; continue; }
    throw new Error(`Caractere inválido na expressão: "${ch}"`);
  }
  return out;
}

const FUNCS: Record<string, (args: Dec[]) => Dec> = {
  min: (a) => D.min(...a),
  max: (a) => D.max(...a),
  abs: (a) => a[0]!.abs(),
  round: (a) => a[0]!.toDecimalPlaces(a[1] ? a[1].toNumber() : 2, D.ROUND_HALF_UP),
  pct: (a) => a[0]!.times(a[1]!).div(100),
};

export function evalExpression(src: string, vars: Record<string, unknown>): Dec {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function primary(): Dec {
    const tk = eat();
    if (!tk) throw new Error('Expressão incompleta');
    if (tk.t === 'num') return new D(tk.v);
    if (tk.t === 'lp') {
      const v = expr();
      if (eat()?.t !== 'rp') throw new Error('Faltou fechar parênteses');
      return v;
    }
    if (tk.t === 'id') {
      if (peek()?.t === 'lp') {
        eat();
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error(`Função desconhecida: ${tk.v}`);
        const args: Dec[] = [];
        if (peek()?.t !== 'rp') {
          args.push(expr());
          while (peek()?.t === 'comma') { eat(); args.push(expr()); }
        }
        if (eat()?.t !== 'rp') throw new Error('Faltou fechar parênteses da função');
        return fn(args);
      }
      if (!(tk.v in vars)) throw new Error(`Variável desconhecida: ${tk.v}`);
      const raw = vars[tk.v];
      return new D(raw === undefined || raw === null || raw === '' ? 0 : (raw as string | number));
    }
    throw new Error(`Token inesperado: ${tk.v}`);
  }

  function factor(): Dec {
    const tk = peek();
    if (tk?.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      eat();
      const v = factor();
      return tk.v === '-' ? v.neg() : v;
    }
    return primary();
  }

  function term(): Dec {
    let v = factor();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = eat()!.v;
      const r = factor();
      if (op === '/' && r.isZero()) throw new Error('Divisão por zero');
      v = op === '*' ? v.times(r) : v.div(r);
    }
    return v;
  }

  function expr(): Dec {
    let v = term();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = eat()!.v;
      const r = term();
      v = op === '+' ? v.plus(r) : v.minus(r);
    }
    return v;
  }

  const result = expr();
  if (pos < tokens.length) throw new Error(`Trecho inesperado: "${tokens[pos]!.v}"`);
  return result;
}
