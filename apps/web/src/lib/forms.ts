import type { z } from 'zod';

/** Primeiro erro por campo (caminho com pontos) de uma validação Zod. */
export function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const p = i.path.join('.') || '_';
    if (!(p in out)) out[p] = i.message;
  }
  return out;
}
