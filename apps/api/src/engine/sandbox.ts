import { readFileSync } from 'node:fs';
import ivm from 'isolated-vm';
import { BlockError, type CodeRunRequest, type CodeRunner } from '@motor-fiscal/engine';

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MEMORY_MB = 32;

/**
 * Executa JavaScript do usuário num isolate do V8 (isolated-vm): sem `require`, `process`, rede ou
 * arquivos; com limite de tempo e de memória. O código define `function calcular({ inputs, params, D, tabela })`.
 * `D(x)` cria decimais exatos (decimal.js) e `tabela(nome, chaves)` consulta as tabelas de referência.
 *
 * Para Python basta outra implementação de `CodeRunner` (ex.: container separado chamado por HTTP).
 */
export class IsolatedVmRunner implements CodeRunner {
  readonly language = 'javascript' as const;
  private readonly decimalSource = readFileSync(require.resolve('decimal.js'), 'utf8');

  async run(req: CodeRunRequest): Promise<Record<string, unknown>> {
    const timeoutMs = req.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const isolate = new ivm.Isolate({ memoryLimit: req.limits?.memoryMb ?? DEFAULT_MEMORY_MB });
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set('globalThis', jail.derefInto());

      await (await isolate.compileScript(this.decimalSource)).run(context, { timeout: timeoutMs });

      await jail.set(
        '__tabela',
        new ivm.Callback((nome: string, chaves: string) => JSON.stringify(req.tabela(nome, JSON.parse(chaves)) ?? null)),
      );
      await jail.set('__input', JSON.stringify({ inputs: req.inputs, params: req.params }));

      const wrapper = `(function () {
${req.code}
;
if (typeof calcular !== 'function') {
  throw new Error('O código deve definir a função calcular({ inputs, params, D, tabela })');
}
var __in = JSON.parse(__input);
var D = function (v) { return new Decimal(v); };
var tabela = function (nome, chaves) { return JSON.parse(__tabela(nome, JSON.stringify(chaves || {}))); };
var r = calcular({ inputs: __in.inputs, params: __in.params, D: D, tabela: tabela });
if (r === undefined || r === null || typeof r !== 'object') {
  throw new Error('calcular deve devolver um objeto com as saídas');
}
return JSON.stringify(r);
})()`;

      const script = await isolate.compileScript(wrapper);
      const result = (await script.run(context, { timeout: timeoutMs })) as string;
      return JSON.parse(result) as Record<string, unknown>;
    } catch (e) {
      throw this.translate(e, timeoutMs);
    } finally {
      if (!isolate.isDisposed) isolate.dispose();
    }
  }

  private translate(e: unknown, timeoutMs: number): BlockError {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof BlockError) return e;
    if (/timed out/i.test(msg)) return new BlockError(`Tempo limite do código excedido (${timeoutMs} ms)`, 'CODIGO_TIMEOUT');
    if (/memory limit|disposed/i.test(msg)) return new BlockError('Limite de memória do código excedido', 'CODIGO_MEMORIA');
    return new BlockError(`Erro no código: ${msg}`, 'CODIGO_ERRO');
  }
}
