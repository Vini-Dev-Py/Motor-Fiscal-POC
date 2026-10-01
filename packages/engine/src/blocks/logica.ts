import { z } from 'zod';
import { getPath, type PortDef } from '@motor-fiscal/shared';
import { evalExpression } from '../expr';
import { fix } from '../money';
import { BlockError, defineBlock } from '../types';

// ---------------------------------------------------------------------------
// Expressão
// ---------------------------------------------------------------------------

export const logicExpressao = defineBlock({
  key: 'logic.expressao',
  version: 1,
  label: 'Fórmula',
  category: 'logica',
  description:
    'Avalia uma fórmula simples com as entradas a, b e c (aritmética decimal exata, sem código livre). ' +
    'Funções: min, max, abs, round(x, casas), pct(base, %).',
  formula: 'resultado = expressao(a, b, c)',
  inputs: [
    { id: 'a', label: 'a', type: 'decimal', required: false },
    { id: 'b', label: 'b', type: 'decimal', required: false },
    { id: 'c', label: 'c', type: 'decimal', required: false },
  ],
  outputs: [{ id: 'resultado', label: 'Resultado', type: 'decimal', required: true }],
  params: z.object({
    expressao: z.string().min(1).default('a * b / 100'),
    casas: z.number().int().min(0).max(10).default(2),
  }),
  run: ({ inputs, params }) => {
    try {
      return { resultado: fix(evalExpression(params.expressao, inputs), params.casas) };
    } catch (e) {
      throw new BlockError(`Fórmula inválida: ${(e as Error).message}`, 'EXPRESSAO_INVALIDA');
    }
  },
});

// ---------------------------------------------------------------------------
// Condição
// ---------------------------------------------------------------------------

const OPERADORES = ['igual', 'diferente', 'maior', 'menor', 'maiorIgual', 'menorIgual', 'contem', 'em'] as const;

function comparar(op: (typeof OPERADORES)[number], atual: unknown, esperado: unknown): boolean {
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  switch (op) {
    case 'igual':
      return String(atual) === String(esperado);
    case 'diferente':
      return String(atual) !== String(esperado);
    case 'maior':
      return num(atual) > num(esperado);
    case 'menor':
      return num(atual) < num(esperado);
    case 'maiorIgual':
      return num(atual) >= num(esperado);
    case 'menorIgual':
      return num(atual) <= num(esperado);
    case 'contem':
      return Array.isArray(atual) ? atual.map(String).includes(String(esperado)) : String(atual).includes(String(esperado));
    case 'em':
      return (Array.isArray(esperado) ? esperado : String(esperado).split(',').map((s) => s.trim())).map(String).includes(String(atual));
  }
}

export const logicCondicao = defineBlock({
  key: 'logic.condicao',
  version: 1,
  label: 'Se / senão',
  category: 'logica',
  description:
    'Ramifica o fluxo: compara um valor (caminho dentro da entrada) e ativa a saída "verdadeiro" ou "falso". ' +
    'Os blocos ligados ao ramo inativo são ignorados.',
  inputs: [{ id: 'entrada', label: 'Entrada', type: 'any', required: true }],
  outputs: [
    { id: 'verdadeiro', label: 'Verdadeiro', type: 'any', required: false },
    { id: 'falso', label: 'Falso', type: 'any', required: false },
  ],
  params: z.object({
    caminho: z.string().default('').describe('Caminho do valor na entrada, ex.: tenant.regime'),
    operador: z.enum(OPERADORES).default('igual'),
    valor: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).default(''),
  }),
  branching: true,
  overridable: false,
  run: ({ inputs, params }) => {
    const atual = params.caminho ? getPath(inputs.entrada, params.caminho) : inputs.entrada;
    const ok = comparar(params.operador, atual, params.valor);
    return ok ? { verdadeiro: inputs.entrada, __ativo: 'verdadeiro' } : { falso: inputs.entrada, __ativo: 'falso' };
  },
});

// ---------------------------------------------------------------------------
// Código livre (sandbox)
// ---------------------------------------------------------------------------

export const CODIGO_TEMPLATE = `// Receba as entradas declaradas e devolva um objeto com as saídas declaradas.
// D(x) cria decimais exatos; tabela(nome, chaves) consulta as tabelas de referência.
function calcular({ inputs, params, D, tabela }) {
  const base = D(inputs.base);
  return { resultado: base.times(2).toFixed(2) };
}
`;

export const logicCodigo = defineBlock({
  key: 'logic.codigo',
  version: 1,
  label: 'Código JavaScript',
  category: 'logica',
  description:
    'Executa código JavaScript isolado (sandbox com limite de tempo e memória, sem rede/arquivos). ' +
    'As portas de entrada e saída são declaradas no bloco e as saídas são validadas pelo tipo.',
  inputs: [],
  outputs: [],
  params: z.object({ code: z.string().default(CODIGO_TEMPLATE) }),
  dynamicPorts: 'codigo',
  overridable: false,
  run: ({ inputs, params, ctx }) => ctx.runCode(params.code, inputs, {}),
});

// ---------------------------------------------------------------------------
// Subfluxos
// ---------------------------------------------------------------------------

const defaultEntradaPorts: PortDef[] = [
  { id: 'item', label: 'Item', type: 'item', required: true },
  { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
];

export const subEntrada = defineBlock({
  key: 'sub.entrada',
  version: 1,
  label: 'Entrada do subfluxo',
  category: 'fluxo',
  description: 'Define as portas de entrada de um subfluxo. Só existe dentro de subfluxos.',
  inputs: [],
  outputs: defaultEntradaPorts,
  params: z.object({}),
  dynamicPorts: 'entrada',
  overridable: false,
  run: () => {
    throw new BlockError('sub.entrada só pode ser executado dentro de um subfluxo', 'FORA_DE_SUBFLUXO');
  },
});

export const subSaida = defineBlock({
  key: 'sub.saida',
  version: 1,
  label: 'Saída do subfluxo',
  category: 'fluxo',
  description: 'Define as portas de saída de um subfluxo. O valor ligado a cada porta é devolvido a quem chamou.',
  inputs: [],
  outputs: [],
  params: z.object({}),
  dynamicPorts: 'saida',
  overridable: false,
  run: () => {
    throw new BlockError('sub.saida só pode ser executado dentro de um subfluxo', 'FORA_DE_SUBFLUXO');
  },
});

export const flowSubfluxo = defineBlock({
  key: 'flow.subfluxo',
  version: 1,
  label: 'Subfluxo',
  category: 'fluxo',
  description:
    'Executa outro fluxo como se fosse um bloco. É assim que uma fórmula que engloba vários impostos vira ' +
    'um bloco reutilizável. As portas vêm das pontas (entrada/saída) do fluxo referenciado.',
  inputs: [],
  outputs: [],
  params: z.object({ flowId: z.string().default('') }),
  dynamicPorts: 'subfluxo',
  overridable: false,
  run: ({ inputs, params, ctx }) => {
    if (!params.flowId) throw new BlockError('Subfluxo não selecionado', 'SUBFLUXO_AUSENTE');
    return ctx.runSubflow(params.flowId, inputs);
  },
});

export const flowParaCadaItem = defineBlock({
  key: 'flow.paraCadaItem',
  version: 1,
  label: 'Para cada item',
  category: 'fluxo',
  description:
    'Executa um subfluxo para cada item do pedido (os impostos da NF-e são calculados por item). ' +
    'O subfluxo recebe "item", "contexto" e "indice" e devolve as portas da sua saída.',
  inputs: [
    { id: 'itens', label: 'Itens', type: 'lista', required: true },
    { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
  ],
  outputs: [{ id: 'resultados', label: 'Resultados por item', type: 'lista', required: true }],
  params: z.object({ flowId: z.string().default('') }),
  overridable: false,
  run: async ({ inputs, params, ctx }) => {
    if (!params.flowId) throw new BlockError('Subfluxo dos itens não selecionado', 'SUBFLUXO_AUSENTE');
    const itens = inputs.itens as Array<Record<string, unknown>>;
    const resultados: unknown[] = [];
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i]!;
      const out = await ctx.runSubflow(
        params.flowId,
        { item, contexto: inputs.contexto, indice: i },
        `Item ${i + 1}: ${String(item.codigo ?? '')}`,
      );
      resultados.push({ item, ...out });
    }
    return { resultados };
  },
});
