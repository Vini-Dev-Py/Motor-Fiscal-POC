# Arquitetura técnica

Este documento explica como o sistema funciona por dentro: pastas, módulos, contratos entre eles e o caminho de
uma chamada de webhook do início ao fim. Para o passo a passo de uso, veja o [guia de fluxos](GUIA-FLUXOS.md);
para criar impostos novos, o [guia de novo imposto](NOVO-IMPOSTO.md).

## 1. Visão geral

```
  Sistema X ──POST /webhook/:slug──▶  API (NestJS)
                                        │ 1. acha o webhook, confere token
                                        │ 2. valida o payload (DSL → Zod)
                                        │ 3. idempotência (reserva a execução no banco)
                                        │ 4. carrega empresa, tabelas, overrides  ──▶ PostgreSQL
                                        │ 5. executa a versão publicada do fluxo
                                        ▼
                                  Motor (packages/engine)
                                    ordena o grafo → executa bloco a bloco
                                    (valida entradas/saídas, aplica override, sandbox de código)
                                        │ 6. monta a resposta pelo template
                                        ▼
  Sistema X ◀──────── 200 / 422 / 5xx ──┘   (a execução inteira + trace fica gravada)
```

Três ideias sustentam o desenho:

1. **O cálculo é dado, não código fixo.** O fluxo é um grafo guardado em JSON; os impostos são blocos
   configuráveis; as alíquotas ficam em tabelas com vigência.
2. **Tudo que entra e sai de um bloco é tipado e validado.** Quem escreve um override (ou um bloco novo) não
   consegue quebrar quem vem depois, porque a saída é checada contra o contrato do bloco.
3. **Cada execução é reproduzível e auditável.** A data de emissão escolhe as alíquotas e overrides vigentes, a
   versão publicada do fluxo é imutável e o trace guarda entrada, saída e override de cada bloco.

## 2. Estrutura do repositório

```
motor-fiscal/
├─ apps/
│  ├─ api/                        Backend NestJS
│  │  ├─ prisma/                    schema.prisma + migrations
│  │  ├─ src/
│  │  │  ├─ main.ts, setup.ts, app.module.ts
│  │  │  ├─ common/                 ZodPipe, @TenantId(), filtro de erros do Prisma
│  │  │  ├─ prisma/                 PrismaService (módulo global)
│  │  │  ├─ engine/                 EngineService (monta o contexto do motor) e sandbox.ts (isolated-vm)
│  │  │  ├─ tenants/                CRUD de empresas
│  │  │  ├─ catalog/                catálogo de blocos + entradas de exemplo
│  │  │  ├─ overrides/              CRUD de overrides + teste padrão × override
│  │  │  ├─ flows/                  CRUD, validar, publicar, executar a seco
│  │  │  ├─ webhooks/               cadastro (admin) e receptor público /webhook/:slug
│  │  │  ├─ executions/             consulta das execuções (com trace)
│  │  │  ├─ reference/              tabelas de referência com vigência
│  │  │  ├─ health/                 /health e /api/meta
│  │  │  └─ seed/                   dados de demonstração
│  │  └─ test/app.e2e-spec.ts       testes e2e (supertest)
│  └─ web/                        Frontend React
│     └─ src/
│        ├─ main.tsx, App.tsx       providers e rotas
│        ├─ components/             ui.tsx (Radix + Tailwind), shell, trace, code-editor (Monaco)
│        ├─ features/editor/        editor de fluxos (React Flow)
│        ├─ features/webhooks/      construtor visual do schema do payload
│        ├─ pages/                  uma página por tela
│        └─ lib/                    api.ts (cliente HTTP), queries.ts, tenant.tsx, utils.ts
├─ packages/
│  ├─ shared/                     Contratos usados por front e back (Zod, tipos)
│  └─ engine/                     Motor: executor + blocos (TypeScript puro, sem Nest)
├─ docs/                          Esta documentação
├─ examples/pedido.json           Payload de exemplo
└─ docker-compose.yml             postgres + api + web
```

Dependências entre pacotes (setas = "depende de"):

```
apps/web ───▶ packages/shared ◀─── packages/engine ◀─── apps/api ───▶ packages/shared
```

- `shared` e `engine` são compilados com `tsup` para ESM e CJS (`dist/`). A API consome o `dist` (por isso,
  depois de mudar o engine ou o shared é preciso rodar `pnpm build:libs` e reiniciar a API).
- O front importa o **código-fonte** do `shared` direto (alias no `vite.config.ts` e no `tsconfig.json`), então
  mudanças no `shared` aparecem no `pnpm dev:web` sem rebuild. Os testes do engine também usam o fonte do
  `shared` (`packages/engine/vitest.config.ts`).

## 3. `packages/shared` — contratos

| Arquivo | O que tem |
|---|---|
| `ports.ts` | Os **tipos de porta** (`decimal`, `tributo`, `item`, `contexto`...), a matriz de compatibilidade `isPortCompatible`, e os schemas Zod que validam o valor de cada tipo (`PORT_VALUE_SCHEMAS`, `validatePortValue`). |
| `graph.ts` | Formato do grafo (`FlowGraph`, `FlowNode`, `FlowEdge`), compatível com React Flow, e o schema Zod que o valida. |
| `webhook-schema.ts` | A **DSL** que descreve o payload de um webhook (`FieldDef`), `buildZodSchema` (DSL → Zod), `validatePayload` e `inferSchemaFromJson`. |
| `template.ts` | `renderTemplate`: troca `{{caminho}}` pelo valor, preservando o tipo quando a string é só um token. |
| `domain.ts` | `TenantInfo`, regimes, o **pedido canônico** (`pedidoSchema`), `BlockMeta` (catálogo), `TraceEntry`, `GraphIssue`. |
| `api-schemas.ts` | Schemas de entrada da API (empresa, override, fluxo, webhook, linha de tabela), compartilhados com os formulários do front. |
| `br-validators.ts` | CNPJ numérico **e alfanumérico**, CPF, NCM, CFOP, CEP, UF, chave de acesso e DV (módulo 11). |
| `examples.ts` | Payload, schema e template de resposta de exemplo (usados no seed e na UI). |

### Tipos de porta

Cada entrada/saída de bloco (`PortDef`: `id`, `label`, `type`, `required`, `default`) tem um tipo. Dois pontos
importam:

- **Decimais trafegam como `string`** (`"189.00"`), nunca como `number`, para não perder precisão. O validador
  aceita `number` na entrada e normaliza para string.
- **Compatibilidade** (`isPortCompatible(de, para)`): mesmo tipo; `any` com qualquer um; `integer`/`decimal`/
  `percent` entre si (exceto decimal → integer); `uf`/`date`/`xml` → `string`; tipos de objeto
  (`tributo`, `item`, `contexto`...) → `object`; `parcelas`/`boletos` → `lista`. O editor bloqueia ligações
  incompatíveis e o validador do grafo também.

O tipo **`tributo`** é o contrato comum dos impostos: `{ base, aliquota, valor }` (strings) mais `aplicavel`,
`cst`/`csosn` e campos extras livres (`passthrough`).

## 4. `packages/engine` — o motor

TypeScript puro: não conhece Nest, banco nem HTTP. Recebe um grafo, um payload e um `EngineContext` e devolve um
resultado. Por isso é testável sem infraestrutura.

| Arquivo | Responsabilidade |
|---|---|
| `types.ts` | `BlockDef`/`defineBlock`, `BlockRunCtx`, `EngineContext`, `Services` (SEFAZ, boleto, numeração), `CodeRunner`, `OverrideEntry`, erros (`BlockError`, `FiscalRejection`), tipos `Contexto`/`ItemNormalizado`. |
| `executor.ts` | `runFlow`, `validateGraph`, `validateSubflowGraph`, `runBlockOnce`, `findOverride`, `resolvePorts`. |
| `registry.ts` | `BUILTIN_BLOCKS`, `createRegistry`, `blockMeta` (gera o catálogo, inclusive o JSON Schema dos parâmetros). |
| `blocks/contexto.ts` | gatilho, empresa, normalizar pedido, operação fiscal, consultas. |
| `blocks/impostos.ts` | IPI, ICMS, ICMS-ST, DIFAL, FCP, PIS, COFINS. |
| `blocks/simples-reforma.ts` | Simples (alíquota efetiva, ICMS por CSOSN), CBS, IBS, IS, transição do ICMS. |
| `blocks/logica.ts` | fórmula, se/senão, código JavaScript, entrada/saída de subfluxo, subfluxo, para cada item. |
| `blocks/nfe-financeiro.ts` | totalizar, chave de acesso, XML, SEFAZ, parcelas, boletos. |
| `fiscal/rules.ts` | funções de regra reutilizáveis: alíquota interestadual/interna, `valorOperacao`, `tributo`, `tributoZero`. |
| `fiscal/chave.ts`, `boleto.ts`, `nfe-xml.ts` | chave de acesso, código de barras/linha digitável, montagem do XML 4.00. |
| `fiscal/gateways.ts` | **mocks** de SEFAZ, boleto e numeração (os adapters a trocar por reais). |
| `tables.ts` | `InMemoryTables`: consulta às tabelas de referência com vigência. |
| `reference-data.ts` | catálogo das tabelas e linhas do seed (`buildReferenceRows`). |
| `default-flows.ts` | monta o fluxo padrão e o subfluxo de impostos (usados pelo seed e pelos testes). |
| `money.ts` | `D` (Decimal.js isolado), `dec`, `fix`, `pctOf`, `max0`, `pctStr`. |
| `expr.ts` | avaliador seguro das fórmulas do bloco "Fórmula" (sem `eval`). |

### 4.1 Anatomia de um bloco

```ts
interface BlockDef<P> {
  key: string;            // 'tax.icms' — identificador estável (vai gravado nos fluxos)
  version: number;
  label, category, description, formula?;
  inputs: PortDef[];      // contrato de entrada
  outputs: PortDef[];     // contrato de saída
  params: z.ZodType<P>;   // configuração estática do nó (parse({}) deve funcionar: valores padrão)
  branching?: boolean;    // bloco que ativa só uma das saídas
  overridable?: boolean;  // aceita override por empresa (padrão: sim)
  dynamicPorts?: 'codigo' | 'entrada' | 'saida' | 'subfluxo';  // portas declaradas no nó
  run({ inputs, params, ctx }): outputs;
}
```

`ctx` (`BlockRunCtx`) dá ao bloco: `tenant`, `tables`, `services`, `referenceDate`, `D`, `log`, `payload`,
`runSubflow` e `runCode`. O bloco nunca acessa banco nem rede: tudo vem do contexto.

### 4.2 Algoritmo de execução (`runFlow`)

1. **Ordena** os nós topologicamente (algoritmo de Kahn; ciclo = erro `GRAFO_CICLICO`).
2. Para cada nó, **monta as entradas** a partir das arestas (`sourceHandle` → `targetHandle`):
   - uma porta pode receber várias arestas; vale a **primeira aresta ativa que tenha valor** (é assim que o ramo
     Simples e o ramo regime normal desembocam na mesma porta de saída);
   - se a porta tem `default` e não chegou valor, usa o default.
3. **Pula o nó** (`skipped`) quando alguma entrada **obrigatória** só tem arestas vindas de ramo inativo ou de nó
   pulado. Entradas opcionais nessa situação ficam vazias e o nó roda normalmente.
4. **Valida as entradas** pelo tipo da porta (`ENTRADA_AUSENTE` / `ENTRADA_INVALIDA`).
5. **Resolve o override**: se a empresa tem um override ativo, vigente na `referenceDate`, para aquele `blockKey`
   (e o bloco aceita override), ele vale. Vários vigentes: o de `validFrom` mais recente.
   - com `params`: mescla sobre os parâmetros do nó (o override vence);
   - com `code`: o código substitui o `run()` do bloco, executado no sandbox.
6. **Valida os parâmetros** com o schema Zod do bloco (`PARAMS_INVALIDOS`).
7. **Executa** e **valida as saídas** pelo tipo de cada porta (`SAIDA_AUSENTE` / `SAIDA_INVALIDA`). Só as portas
   declaradas sobrevivem; o resto é descartado.
8. Em bloco de **ramificação** (`logic.condicao`), as saídas não ativadas ficam inativas para os nós seguintes.
9. Grava no **trace**: entradas, saídas, duração, override aplicado, logs e, se houver, os traces dos subfluxos.

**Subfluxos.** `flow.paraCadaItem` e `flow.subfluxo` chamam `ctx.runSubflow`, que executa o grafo do subfluxo com
as mesmas regras. A `sub.entrada` entrega os valores recebidos e a `sub.saida` coleta as portas ligadas; o
resultado do subfluxo é o conjunto de valores da `sub.saida`. Em `paraCadaItem` cada resultado vira
`{ item, ...saidas }`, e a lista completa é a saída `resultados`.

**Limites de segurança:** 5.000 execuções de bloco por chamada (`LIMITE_EXECUCAO`) e profundidade máxima de
subfluxos 4 (`LIMITE_PROFUNDIDADE`).

**Resultado** (`FlowRunResult`): `status` `OK` | `ERRO` | `REJEITADA` (rejeição fiscal, `FiscalRejection`),
`nodes` (saídas de cada nó do fluxo raiz), `trace`, `error` (mensagem, código, nó, detalhes) e `durationMs`.

### 4.3 Validação do grafo (`validateGraph`)

Roda ao validar, ao publicar e antes de um teste a seco. Verifica: um (e só um) gatilho no fluxo de pedido;
entrada e saída em subfluxos; blocos desconhecidos; parâmetros inválidos; subfluxo referenciado que não existe;
nós duplicados; arestas para nós/portas inexistentes; **tipos incompatíveis**; **entradas obrigatórias sem
conexão**; ciclos. Devolve `GraphIssue[]` (`error` | `warning`, com `nodeId`/`edgeId`).

### 4.4 Overrides e sandbox

O motor só conhece a interface `CodeRunner { run({ code, inputs, params, tabela, limits }) }`. A implementação
real está na API (`apps/api/src/engine/sandbox.ts`): `isolated-vm`, um isolate do V8 novo por execução, com
**1 s** de tempo e **32 MB** de memória, sem `process`, `require`, rede nem arquivos. O Decimal.js é carregado
dentro do isolate e exposto como `D`; `tabela(nome, chaves)` volta ao host por um callback síncrono. Para
Python basta outra implementação de `CodeRunner` (por exemplo, um container chamado por HTTP).

### 4.5 Tabelas de referência (`tables.ts`)

Linha = `{ table, keys, value, validFrom, validTo?, tenantSpecific? }`. A consulta
`lookup(tabela, chaves, data)`:

1. descarta linhas fora da vigência (`validFrom ≤ data ≤ validTo`);
2. casa as chaves: `"*"` casa com tudo; a chave `ncm` casa por **prefixo** (mais longo = mais específico);
3. escolhe a mais específica; no empate, a **linha da empresa** vence a global; depois a `validFrom` mais recente.

## 5. `apps/api` — backend

### 5.1 Pipeline do webhook (`webhooks/webhooks.module.ts`)

| Passo | Resposta em caso de falha |
|---|---|
| Busca o webhook pelo `slug` | 404 `WEBHOOK_NAO_ENCONTRADO` / `WEBHOOK_INATIVO` |
| Confere `X-Webhook-Token` (comparação em tempo constante), se o webhook tem token | 401 `TOKEN_INVALIDO` |
| Valida o corpo com o schema do webhook (DSL → Zod) | 422 `PAYLOAD_INVALIDO` com `detalhes[{path, message}]` (a tentativa fica registrada) |
| Calcula a chave de idempotência (header `Idempotency-Key`, senão o campo configurado) e **reserva a execução** (`EXECUTANDO`); conflito de chave única = replay | replay devolve a resposta salva com `Idempotent-Replay: true`; se ainda estiver rodando, 409 `EXECUCAO_EM_ANDAMENTO` |
| Pega a **última versão publicada** do fluxo | 409 `FLUXO_NAO_PUBLICADO` |
| Monta o contexto (empresa, tabelas global+empresa, overrides ativos, serviços) e executa | — |
| `OK` → renderiza o template de resposta | 200 |
| `REJEITADA` (SEFAZ) | 422 `NFE_REJEITADA` |
| `ERRO` | 422 para erros de negócio (`PEDIDO_INVALIDO`, `SEM_RBT12`...) ou 500 |
| Grava status, resposta, trace, duração e versão usada | header `X-Execution-Id` em todas |

A data de vigência vem do campo `dateField` do webhook (padrão `dataEmissao`); sem ela, vale hoje.

### 5.2 `EngineService`

Faz a ponte banco → motor: `buildContext(tenantId, referenceDate, { dryRun })` carrega a empresa (`TenantInfo`),
as tabelas (linhas globais + da empresa → `InMemoryTables`), os overrides ativos, e injeta os serviços. A
numeração da NF-e é uma sequência atômica no banco (`UPDATE ... SET nfeProximoNumero = nfeProximoNumero + 1`);
no `dryRun` usa uma numeração em memória que não consome a real. `embedSubflows` embute no grafo os subfluxos
referenciados (recursivamente), para a versão publicada ser autocontida.

### 5.3 Endpoints

Todos sob `/api`, exceto o webhook e o `/health`. Os que dependem da empresa exigem o header `X-Tenant-Id`.

| Recurso | Rotas |
|---|---|
| Empresas | `GET/POST /tenants` · `GET/PUT/DELETE /tenants/:id` |
| Blocos | `GET /blocks` · `GET /blocks/:key` · `GET /blocks/code-template` · `GET /blocks/:key/sample-inputs` |
| Overrides | `GET/POST /overrides` · `GET/PUT/DELETE /overrides/:id` · `POST /overrides/:id/test` |
| Fluxos | `GET /flows?kind=` · `POST /flows` · `GET/PUT/DELETE /flows/:id` · `GET /flows/:id/ports` · `GET /flows/:id/versions` · `POST /flows/:id/validate` · `POST /flows/:id/publish` · `POST /flows/:id/run` |
| Webhooks | `GET/POST /webhooks` · `GET/PUT/DELETE /webhooks/:id` |
| Execuções | `GET /executions?limit=&webhookId=&status=` · `GET /executions/:id` |
| Tabelas | `GET /reference-tables` · `GET /reference-rows?table=` · `POST /reference-rows` · `PUT/DELETE /reference-rows/:id` |
| Outros | `GET /health` · `GET /api/meta` |
| Público | `POST /webhook/:slug` |

Convenções: validação de entrada com `ZodPipe` (os mesmos schemas do `shared` que o front usa; erro = 422 com
`issues`); erros do Prisma viram 409 (duplicado), 400 (referência inválida) ou 404; rate limit de 300
requisições/min por IP (`RATE_LIMIT`).

### 5.4 Banco de dados (Prisma)

| Modelo | Papel |
|---|---|
| `Tenant` | empresa: CNPJ, UF, município, regime, CRT, RBT12, `config` (boleto, anexo do Simples), `nfeProximoNumero` |
| `BlockOverride` | override: `blockKey`, `code?`, `params`, vigência, base legal, ativo |
| `Flow` | fluxo (`PEDIDO` ou `SUBFLUXO`) com o **rascunho** do grafo em JSONB |
| `FlowVersion` | versão publicada, **imutável**, com o grafo e os subfluxos embutidos |
| `WebhookEndpoint` | `slug` único global, fluxo, schema do payload (JSONB), template de resposta, token, config |
| `Execution` | uma chamada: payload, resposta, status, `trace` (JSONB), versão usada, chave de idempotência (única por webhook) |
| `ReferenceRow` | linha de tabela de referência (`tenantId` nulo = global) |

### 5.5 Seed

`SeedService` roda na subida quando `SEED_ON_START=true` e **só se não existir nenhuma empresa**. Cria as linhas
de referência, três empresas, o subfluxo de impostos, o fluxo "Pedido padrão" publicado, um webhook por empresa e
o override da liminar. Como só roda em banco vazio, **linhas novas de tabela adicionadas ao código não aparecem
em um banco que já existe** — nesse caso use a tela Tabelas (ou um script).

## 6. `apps/web` — frontend

- **Stack:** React 19, Vite, Tailwind v4 (tokens em `index.css`, tema claro/escuro por classe `dark`), Radix
  (Dialog, Select, Switch, Tabs, Tooltip), React Flow (`@xyflow/react`), Motion, TanStack Query, Monaco
  (empacotado localmente, carregado sob demanda), Sonner (toasts).
- **Empresa atual:** `lib/tenant.tsx` guarda a escolha (localStorage) e `lib/api.ts` envia `X-Tenant-Id`. Toda
  query da empresa inclui o id na chave (`useTenantQuery`), então trocar de empresa refaz as buscas.
- **Catálogo vem da API:** a paleta e os formulários de parâmetros são gerados a partir de `GET /api/blocks`
  (`BlockMeta` com o JSON Schema dos parâmetros). **Blocos novos no engine aparecem na UI sem mudar o front.**

### Editor de fluxos (`features/editor/`)

| Arquivo | Papel |
|---|---|
| `editor-page.tsx` | estado do grafo (nodes/edges), salvar, validar, publicar, teste a seco, animação da execução, atalhos (Ctrl+S) |
| `graph-utils.ts` | `portsOf` (portas efetivas do nó, espelha o motor), conversão de/para o formato salvo, detecção de ciclo, ids legíveis, auto-layout (dagre) |
| `block-node.tsx` | nó customizado: handles coloridos por tipo, badge de override, anel de status; lê o contexto `EditorContext` |
| `palette.tsx` | paleta por categoria com busca, arrastar e soltar; subfluxos entram como blocos |
| `inspector.tsx` | painel do nó: parâmetros, portas, código, subfluxo, resultado do último teste |
| `schema-form.tsx` | formulário gerado do JSON Schema + editor de portas |

Detalhes úteis: `isValidConnection` impede ligação entre tipos incompatíveis, para si mesmo e as que fechariam
ciclo; o id do nó é gerado a partir do nome do bloco em camelCase (`icms`, `totalizarNota`, `icms2` se repetir) e é ele que aparece nos caminhos do
template (`nodes.<id>.<porta>`); o grafo salvo é só `{ id, type, position, data }` + arestas — status de execução
fica fora do dado.

## 7. Infraestrutura

`docker-compose.yml` sobe `postgres` (porta 5433 no host), `api` (3000) e `web` (8080, nginx). O nginx serve o
build do front e repassa `/api`, `/webhook` e `/health` para a API (mesma origem, então a URL pública do webhook
é `https://<host>/webhook/<slug>`). A imagem da API roda `prisma migrate deploy` e depois `node dist/main.js`, com
`NODE_OPTIONS=--no-node-snapshot` (exigido pelo `isolated-vm` no Node 20+).

| Variável | Onde | Para quê |
|---|---|---|
| `DATABASE_URL` | api | conexão do Postgres |
| `PORT` | api | porta (padrão 3000) |
| `SEED_ON_START` | api | `true` cria os dados de demonstração em banco vazio |
| `PUBLIC_BASE_URL` | api | base usada na UI para mostrar a URL pública dos webhooks (opcional) |
| `RATE_LIMIT` | api | requisições por minuto por IP (padrão 300) |
| `API_URL` | web (dev) | destino do proxy do Vite (padrão `http://127.0.0.1:3000`) |

## 8. Invariantes (não quebrar)

1. **Decimal sempre como string e com `decimal.js`** — nunca `number` em conta de dinheiro.
2. **Arredondamento:** o valor de cada tributo é arredondado (half-up) em 2 casas ao ser calculado; as bases
   dos tributos seguintes usam os valores já arredondados (é o que a NF-e exige).
3. **Vigência pela data de emissão**, nunca pela data de processamento.
4. **Versão publicada é imutável** e carrega seus subfluxos; editar o rascunho não muda o que está no ar.
5. **Saída de bloco é sempre validada** pelo contrato — inclusive a de override com código.
6. **`key` de bloco é estável:** está gravada nos fluxos publicados. Para mudar o comportamento de forma
   incompatível, crie um bloco novo (ou suba `version`) em vez de renomear.

## 9. Limitações conhecidas

- SEFAZ, boleto e numeração são **mocks** (interfaces prontas para adapters reais). O XML não é assinado.
- O totalizador (`nfe.totalizar`) e o montador de XML conhecem só os tributos nativos. Um imposto novo criado por
  código/fórmula aparece em `resultados` e na resposta, mas **não entra no `vNF` nem no XML** até ser integrado
  (veja [Novo imposto](NOVO-IMPOSTO.md#integrando-na-nota-vnf-e-xml)).
- A numeração da NF-e é uma sequência única por empresa; falha depois da reserva consome o número.
- Execução síncrona: o webhook espera a nota ficar pronta. Fila e callback ficam para depois.
- As alíquotas do seed são de referência e precisam de revisão tributária.
