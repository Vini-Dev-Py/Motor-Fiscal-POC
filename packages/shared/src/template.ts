/**
 * Template de resposta do webhook.
 *
 * Qualquer string do template pode conter `{{caminho.no.escopo}}`:
 *  - `input.*`            payload validado recebido no webhook
 *  - `nodes.<idDoNo>.<porta>`  saída de um nó do fluxo
 *  - `execution.id` / `execution.status`
 *
 * Quando a string é SOMENTE um token (`"{{nodes.totalizar.totais}}"`), o valor
 * original é preservado (objeto, número, lista...). Com texto ao redor, vira string.
 */
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const ONLY_TOKEN = /^\{\{\s*([^{}]+?)\s*\}\}$/;

export function getPath(scope: unknown, path: string): unknown {
  let cur: unknown = scope;
  for (const raw of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    const m = /^(\w+)\[(\d+)\]$/.exec(raw);
    if (m) {
      cur = (cur as Record<string, unknown>)[m[1]!];
      cur = Array.isArray(cur) ? cur[Number(m[2])] : undefined;
    } else {
      cur = (cur as Record<string, unknown>)[raw];
    }
  }
  return cur;
}

export function renderTemplate(template: unknown, scope: unknown): unknown {
  if (typeof template === 'string') {
    const only = ONLY_TOKEN.exec(template);
    if (only) return getPath(scope, only[1]!) ?? null;
    return template.replace(TOKEN, (_, p: string) => {
      const v = getPath(scope, p);
      if (v === undefined || v === null) return '';
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(template)) return template.map((t) => renderTemplate(t, scope));
  if (template !== null && typeof template === 'object') {
    return Object.fromEntries(
      Object.entries(template as Record<string, unknown>).map(([k, v]) => [k, renderTemplate(v, scope)]),
    );
  }
  return template;
}

/** Lista os caminhos referenciados em um template (para validação/autocomplete). */
export function listTemplatePaths(template: unknown): string[] {
  const out = new Set<string>();
  const walk = (t: unknown) => {
    if (typeof t === 'string') {
      for (const m of t.matchAll(TOKEN)) out.add(m[1]!);
    } else if (Array.isArray(t)) t.forEach(walk);
    else if (t && typeof t === 'object') Object.values(t).forEach(walk);
  };
  walk(template);
  return [...out];
}
