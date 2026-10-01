# Guia: como testar

Existem quatro níveis de teste, do mais rápido (olhar o resultado na tela) ao mais completo (suíte automatizada).
Use o nível que combina com o que você mudou.

| O que você mudou | Teste mais rápido | Teste que deve ficar no repositório |
|---|---|---|
| Montou/alterou um **fluxo** | botão **Testar** do editor | — (é dado, não código) |
| Criou um **override** | aba **Testar** do override | caso no e2e se for regra importante |
| Mudou **tabela** ou alíquota | **Testar** do editor com a data do cenário | teste do motor com a vigência |
| Criou/alterou um **bloco nativo** | teste do motor (`vitest`) | teste do motor com conta feita à mão |
| Mexeu em **webhook/API** | console do webhook / `curl` | teste e2e (`supertest`) |

## 1. Pela interface

### 1.1 Testar um fluxo (a seco)

No editor, **Testar** → ajuste o payload → **Executar**. Roda o **rascunho atual** (mesmo sem salvar) e:

- **não grava** execução;
- **não consome** a numeração real da NF-e (usa uma numeração em memória);
- anima a execução e colore os blocos: verde = executado, esmaecido = ignorado (ramo inativo), vermelho = erro;
- **Resultado** (painel do bloco) mostra as entradas e saídas daquele bloco; **Ver passo a passo** mostra a árvore
  completa, incluindo o subfluxo de cada item, os overrides aplicados e os erros com detalhes.

Para testar **vigência**, mude `dataEmissao` no payload: ela escolhe as alíquotas e os overrides vigentes.
Para testar **regimes**, troque a empresa no seletor do topo (cada empresa tem o seu regime).

### 1.2 Testar um override (padrão × override)

**Overrides →** abra o override → aba **Testar**: carrega entradas de exemplo da empresa (editáveis), roda o
**bloco padrão e o override com as mesmas entradas** e mostra as saídas lado a lado e a **tabela de diferenças**
campo a campo. O teste ignora "ativo" e vigência (serve para validar antes de ligar). Erros de código (tempo, memória,
sintaxe, saída fora do contrato) aparecem no lado do override, sem afetar o padrão.

### 1.3 Testar o webhook de ponta a ponta

**Webhooks →** abra o webhook → aba **Testar**: o payload vem de um exemplo gerado pelo schema; **Enviar** chama
`POST /webhook/<slug>` **de verdade** (cria execução, consome a numeração mock). Mostra o status HTTP, o tempo, os
headers `X-Execution-Id` / `Idempotent-Replay` e o corpo. O botão **Novo id no payload** evita o replay de
idempotência. Depois, **Execuções** mostra o payload recebido, a resposta, o XML da NF-e e o trace.

## 2. Pela linha de comando (`curl`)

```bash
# disparar o webhook (use um "id" novo, senão recebe o replay da execução anterior)
curl -i -X POST http://localhost:8080/webhook/calcular-nota-vinicius \
  -H 'Content-Type: application/json' -d @examples/pedido.json

# token e idempotência explícita
curl -X POST http://localhost:8080/webhook/<slug> \
  -H 'Content-Type: application/json' -H 'X-Webhook-Token: <token>' -H 'Idempotency-Key: pedido-123' -d @pedido.json
```

Dry-run de um fluxo e validação pela API (precisa do id da empresa e do fluxo):

```bash
curl localhost:3000/api/tenants                                              # ids das empresas
curl localhost:3000/api/flows?kind=PEDIDO -H 'X-Tenant-Id: <empresa>'        # ids dos fluxos

curl -X POST localhost:3000/api/flows/<fluxo>/validate -H 'X-Tenant-Id: <empresa>' \
  -H 'Content-Type: application/json' -d '{}'                                # {valid, issues[]}

curl -X POST localhost:3000/api/flows/<fluxo>/run -H 'X-Tenant-Id: <empresa>' \
  -H 'Content-Type: application/json' -d '{"payload": { ... }}'              # {status, nodes, trace, ...}
```

## 3. Testes do motor (vitest)

Os testes do motor não precisam de banco nem de Docker. Ficam em `packages/engine/src/engine.test.ts`.

```bash
pnpm --filter @motor-fiscal/engine test                              # todos
pnpm --filter @motor-fiscal/engine exec vitest run -t "ICMS-ST"      # só os que casam com o nome
pnpm --filter @motor-fiscal/engine exec vitest                       # modo watch
```

### Peças reutilizáveis

```ts
import { InMemoryTables, buildReferenceRows, mockServices, runBlockOnce, runFlow, createRegistry, BUILTIN_BLOCKS } from './index';

// contexto de execução: empresa + tabelas do seed + serviços mock + data de vigência
const ctxOf = (tenant, extra = {}) => ({
  tenant,
  tables: new InMemoryTables(buildReferenceRows()),
  services: mockServices(),
  referenceDate: '2026-09-30',
  ...extra,                                   // overrides, runner, maxNodeRuns...
});
```

- **Um bloco isolado:** `runBlockOnce({ blockKey, inputs, params, ctx, override?, registry? })` — valida as entradas,
  aplica override, executa e valida as saídas. Passe `registry: createRegistry([...BUILTIN_BLOCKS, meuBloco])` para
  testar um bloco novo sem registrá-lo.
- **Um fluxo inteiro:** `runFlow({ graph, payload, ctx })`. O fluxo padrão vem de
  `buildPedidoGraphComSubfluxo()`; para o fluxo mínimo ou customizado, monte o grafo à mão.
- **Validar o grafo:** `validateGraph(grafo)` devolve os problemas (use `expect(...).toEqual([])`).
- **Override com código:** o motor só conhece a interface `CodeRunner`. Nos testes use um executor simples (não é
  sandbox — o sandbox real é testado no e2e):

  ```ts
  const testRunner: CodeRunner = {
    language: 'javascript',
    async run({ code, inputs, params, tabela }) {
      const fn = new Function('D', `${code}\n;return calcular;`)(D);
      return fn({ inputs, params, D: (v) => new D(v), tabela });
    },
  };
  // ctxOf(tenant, { runner: testRunner, overrides: [{ id, blockKey, name, code, params, validFrom, validTo, legalBasis, active }] })
  ```

- **Tabelas do teste:** acrescente linhas ao `InMemoryTables` (`{ table, keys, value, validFrom, validTo? }`) para
  testar vigência (uma linha para 2026 e outra para 2027) sem tocar no seed.

### Como escrever um bom caso (conta feita à mão)

1. Monte entradas pequenas e redondas (item de 1.000,00 + frete 50,00).
2. **Calcule o resultado no papel**, antes de rodar. Escreva a conta no comentário do teste.
3. Verifique base, alíquota e valor (não só o valor) — erro de base é o mais comum.
4. Cubra o caso normal, o caso "não se aplica" (`aplicavel: false`) e um caso de **vigência diferente**.
5. Para override: teste dentro da vigência, fora dela, inativo e com a saída fora do contrato.

```ts
// `out`, `item()`, `contexto()` e `tenant()` são helpers do próprio engine.test.ts (veja o início do arquivo)
it('ICMS 18% sobre 1.050 = 189,00', async () => {
  const { icms } = (await out('tax.icms', { item: item(), contexto: contexto(tenant(), 'SP') })) as any;
  expect(icms).toMatchObject({ base: '1050.00', aliquota: '18', valor: '189.00' });
});
```

Os testes existentes são bons modelos: ST com MVA ajustada, DIFAL (base única e dupla), Simples, transição do ICMS,
overrides com código, grafo e tabelas.

## 4. Testes da API (e2e)

Sobem a aplicação Nest em memória e fazem requisições HTTP reais contra o **Postgres do Docker**.

```bash
docker compose up -d postgres                       # banco em localhost:5433
cp .env.example apps/api/.env                       # DATABASE_URL (uma vez)
pnpm build:libs                                     # a API usa o build de shared/engine
pnpm --filter @motor-fiscal/api test                # todos
pnpm --filter @motor-fiscal/api test -t "sandbox"   # só os que casam
```

- Antes dos testes o `SeedService` roda (só semeia se o banco estiver vazio), então os testes usam as **empresas e
  webhooks de demonstração**. O que o teste cria, ele remove; as execuções criadas usam chaves com prefixo `e2e-`.
- Cobrem: webhook (sucesso, 422, 404, token, idempotência, concorrência), cadastro de webhook, fluxos
  (validar, publicar, versões, teste a seco), overrides, **sandbox** (laço infinito, memória, `process`/`require`/`fetch`,
  saída fora do contrato), empresas (CNPJ alfanumérico), catálogo, tabelas e vigência.
- **Atenção:** se você mudou o engine ou o shared, rode `pnpm build:libs` antes — a API testa o `dist`.

## 5. Tudo de uma vez

```bash
pnpm typecheck     # shared, engine, api, web
pnpm test          # shared · engine · api e2e (executa um pacote por vez)
```

## 6. Diagnóstico: lendo os erros

O trace de cada bloco traz `error.code`, `error.message` e `error.details`. Códigos mais comuns:

**No motor**

| Código | Significado |
|---|---|
| `PEDIDO_INVALIDO` | o payload não virou pedido canônico (detalhes listam os campos); revise o schema do webhook ou o mapeamento em *Normalizar pedido* |
| `ENTRADA_AUSENTE` / `ENTRADA_INVALIDA` | entrada obrigatória sem valor / fora do tipo da porta |
| `SAIDA_AUSENTE` / `SAIDA_INVALIDA` | o bloco (ou override) não respeitou o contrato de saída |
| `PARAMS_INVALIDOS` | parâmetro fora do esquema do bloco |
| `SEM_RBT12` / `RBT12_EXCEDIDA` | Simples sem RBT12 cadastrada / acima do limite do anexo |
| `SEFAZ_REJEICAO` | a autorização foi rejeitada (`cStat` e motivo nos detalhes) → execução `REJEITADA` |
| `CODIGO_TIMEOUT` / `CODIGO_MEMORIA` / `CODIGO_ERRO` | problemas no código do sandbox |
| `EXPRESSAO_INVALIDA` | fórmula do bloco *Fórmula* inválida |
| `CONDICAO_INVALIDA` | condição de pagamento fora do formato (`30/60/90`) |
| `SUBFLUXO_AUSENTE` | subfluxo não selecionado ou inexistente na versão |
| `GRAFO_CICLICO`, `BLOCO_DESCONHECIDO` | grafo inválido (o validador costuma pegar antes) |
| `LIMITE_EXECUCAO` / `LIMITE_PROFUNDIDADE` | passou de 5.000 execuções de bloco / 4 níveis de subfluxo |

**Na API (corpo `{ "erro": { "codigo", "mensagem", "detalhes" } }`)**

| Código | HTTP |
|---|---|
| `PAYLOAD_INVALIDO` | 422 |
| `NFE_REJEITADA` | 422 |
| `TOKEN_INVALIDO` | 401 |
| `WEBHOOK_NAO_ENCONTRADO` / `WEBHOOK_INATIVO` | 404 |
| `EXECUCAO_EM_ANDAMENTO` | 409 |
| `FLUXO_NAO_PUBLICADO` | 409 |
| erros de negócio do motor (`PEDIDO_INVALIDO`, `SEM_RBT12`...) | 422 |
| demais erros do fluxo | 500 |

Dicas rápidas:

- **Valor diferente do esperado?** Abra o passo a passo, vá ao bloco do imposto e compare `base`, `aliquota` e
  `valor` com a sua conta; veja também se há **override** aplicado (badge no trace) e qual **data de emissão** foi usada.
- **Alíquota "errada"?** Confira a tabela na tela **Tabelas** (linha da empresa vs global, vigência, `*` nas chaves).
- **Mudou o código do motor e nada mudou na tela?** Falta `pnpm build:libs` + reiniciar a API (ou
  `docker compose up -d --build api`).
- **Mudou um subfluxo e o webhook não refletiu?** Republique o fluxo de pedido: a versão publicada guarda uma
  cópia do subfluxo.

## 7. Checklist antes de publicar uma mudança de cálculo

- [ ] Caso calculado à mão passa (normal, "não se aplica" e outra vigência).
- [ ] O fluxo valida (`Validar`) e o **Testar** dá o resultado esperado em cada regime afetado.
- [ ] `pnpm typecheck` e `pnpm test` verdes.
- [ ] Se alterou tabela/alíquota: vigência e escopo (global × empresa) conferidos.
- [ ] Se alterou bloco já usado em fluxos publicados: a mudança é compatível (senão, bloco novo).
- [ ] Revisão do contador.
