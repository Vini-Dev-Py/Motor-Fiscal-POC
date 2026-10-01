# POC — Motor Fiscal/Financeiro baseado em fluxos (estilo n8n)

## Contexto

O Yzidro ERP é um sistema desktop legado. Cálculo de impostos, emissão de NF-e e geração de boleto ficam presos no core dele, e por isso ele não consegue atender uma integração em que o **Sistema X envia um webhook com um pedido** e espera receber de volta impostos calculados, NF-e autorizada e boleto.

Além disso, há três pressões sobre as regras fiscais:

1. **Reforma tributária** (LC 214/2025): IBS, CBS e IS entram gradualmente de 2026 a 2033, com alíquotas mudando ano a ano.
2. **Impostos novos** surgem com frequência.
3. **Clientes com benefícios fiscais obtidos na justiça** precisam de fórmulas próprias.

A solução é uma **plataforma de fluxos visuais** (React Flow). Cada imposto, etapa fiscal ou etapa financeira é um **bloco com entradas e saídas tipadas**. A plataforma entrega blocos padrão e deixa cada empresa (tenant) fazer **override** de um bloco com código JavaScript num sandbox. Webhooks cadastrados (`/webhook/<slug>`) disparam um fluxo publicado. O payload é validado com Zod e a resposta é montada a partir de um template.

**Decisões já tomadas:** PostgreSQL + JSONB · código custom em JS (a interface fica pronta para um runner Python no futuro) · NF-e, SEFAZ e boleto como **mock realista** atrás de adapters · regimes Simples, Presumido e Real mais a reforma (CBS/IBS/IS) · sem login (o tenant é escolhido pelo header `X-Tenant-Id` ou por um seletor na UI).

---

## Arquitetura

Monorepo com **pnpm workspaces**:

```
motor-fiscal/
├─ apps/
│  ├─ api/                 NestJS (REST admin + receptor público de webhooks)
│  └─ web/                 React + Vite + Tailwind v4 + Radix + React Flow + Motion
├─ packages/
│  ├─ shared/              Schemas Zod, tipos de porta, contratos de bloco, validadores BR
│  └─ engine/              Motor de execução de grafos + blocos padrão (TS puro, sem Nest)
├─ docker-compose.yml      postgres:17, api, web (+ adminer opcional)
└─ README.md               como subir, curl de exemplo
```

- O **`packages/engine` é TS puro**: roda nos testes (Vitest) sem banco nem Nest, e a API só o envolve. Fica mais fácil testar e trocar peças.
- O **`packages/shared`** é importado pelo front e pelo back. O mesmo schema Zod valida os formulários (react-hook-form + zodResolver) e os DTOs (via `nestjs-zod`).
- **Dinheiro:** usar `decimal.js` em todo lugar, nunca `number`. Arredondamento em 2 casas (ROUND_HALF_UP, configurável) apenas nos valores finais de cada tributo, como a NF-e exige.
- **ORM:** Prisma, que tem migrations, suporte a JSONB e se integra bem com Nest.

### Stack

| Camada | Libs |
|---|---|
| Front | React 19, Vite, Tailwind v4, Radix Primitives (componentes no estilo shadcn), `@xyflow/react` v12, `motion`, `@monaco-editor/react`, TanStack Query, React Router, react-hook-form, zod, lucide-react, elkjs (auto-layout) |
| Back | NestJS 11, Prisma, `nestjs-zod`, `isolated-vm` (sandbox JS), `decimal.js`, `fast-xml-parser`/`xmlbuilder2` (XML NF-e), `@nestjs/throttler` |
| Infra | Docker, docker-compose, PostgreSQL 17 |
| Testes | Vitest (engine/shared), Jest + supertest (e2e da API) |

> O `isolated-vm` é um módulo nativo. Ele roda no container Linux (`node:22-bookworm`) com a flag `--no-node-snapshot`. Assim o dev no Windows não precisa de build tools, porque a API sobe via Docker.

---

## Modelo de dados (Prisma / PostgreSQL)

| Tabela | Campos principais |
|---|---|
| `Tenant` | id, cnpj (aceita o **CNPJ alfanumérico**, vigente desde jul/2026), razaoSocial, ie, uf, codMunicipio, regime (`SIMPLES`, `PRESUMIDO`, `REAL`), crt, rbt12 (Simples), config JSONB |
| `BlockDefinition` | id, key (`tax.icms`), version, category, label, description, inputs JSONB, outputs JSONB, paramsSchema JSONB, kind (`BUILTIN` ou `CODE`), code (quando é CODE), tenantId (null = bloco global; preenchido = bloco custom da empresa) |
| `BlockOverride` | id, tenantId, blockKey, code, params JSONB, validFrom, validTo, legalBasis (nº do processo ou liminar), active, createdAt |
| `Flow` | id, tenantId (null = template global), name, kind (`PEDIDO` ou `SUBFLUXO`), draftGraph JSONB (nodes/edges do React Flow) |
| `FlowVersion` | id, flowId, version, graph JSONB (imutável), publishedAt |
| `WebhookEndpoint` | id, tenantId, slug (único global), flowVersionId, requestSchema JSONB (DSL de campos), responseTemplate JSONB, token (opcional), active |
| `Execution` | id, tenantId, webhookId?, flowVersionId, idempotencyKey (único por webhook), input JSONB, output JSONB, status, trace JSONB (entradas, saídas, duração, bloco/override usado e erro de cada nó), createdAt |
| `ReferenceTable` / `ReferenceRow` | chave da tabela (`icms_interna`, `icms_interestadual`, `fcp`, `ibs_cbs_aliquotas`, `tipi`, `mva_st`, `simples_anexos`, `transicao_icms`), keys JSONB, value JSONB, validFrom/validTo |

As tabelas de referência com **vigência** são o que resolve a instabilidade da reforma. Alíquota nova vira linha nova com `validFrom`, sem mudar código. Os blocos consultam essas tabelas pela `dataEmissao` do pedido, então o mesmo pedido reprocessado dá sempre o mesmo resultado, o que garante auditoria determinística.

---

## Motor de blocos (`packages/engine`)

### Contrato de bloco

```ts
interface BlockDefinition<P> {
  key: string; version: number; label: string; category: Category;
  inputs: PortDef[];   // { id, label, type, required, default? }
  outputs: PortDef[];
  params: ZodType<P>;  // configuração estática do nó (ex.: CST, pRedBC)
  run(ctx: BlockContext<P>): Record<string, unknown> | Promise<...>;
}
// BlockContext = { inputs, params, tables.lookup(tabela, chaves, data), D (decimal), tenant, dataEmissao, log }
```

**Tipos de porta:** `decimal`, `percent`, `integer`, `string`, `boolean`, `uf`, `date`, `pedido`, `item`, `contexto`, `tributo` (`{cst, base, aliquota, valor, ...}`), `tributos[]`, `totais`, `nfe`, `boleto`, `any`. Uma matriz de compatibilidade é usada no `isValidConnection` do React Flow e na validação do grafo ao publicar.

### Execução

1. **Resolver** cada nó: se existe `BlockOverride` ativo para (tenant, blockKey) vigente na `dataEmissao`, usa o override; se não, usa o bloco padrão. Um bloco custom do tenant funciona como qualquer outro.
2. **Validar o grafo:** DAG sem ciclos, inputs obrigatórios conectados ou com default, tipos compatíveis.
3. **Ordenar topologicamente** e executar nó a nó. Em cada nó: montar os inputs a partir das arestas (`sourceHandle` → `targetHandle`), validar os inputs com Zod, executar (builtin ou sandbox), **validar os outputs com Zod**, gravar o trace. Com isso, um override não consegue quebrar o contrato do bloco que substitui.
4. **Condição:** o nó `logic.condicao` ativa um ramo, e os nós do ramo inativo ficam marcados como `skipped`.
5. **Subfluxo:** um `Flow` do tipo `SUBFLUXO`, com nós Entrada e Saída, vira um **bloco composto** cujas portas são derivadas dessas pontas. É assim que se monta uma fórmula que engloba vários impostos e se reaproveita.
6. **`flow.paraCadaItem`:** executa um subfluxo para cada item do pedido e devolve `tributos[]`. Impostos de NF-e são calculados por item. Esse nó mantém o fluxo principal legível (pedido → itens → totalizar → NF-e → SEFAZ → boleto).

### Sandbox de código (override e bloco custom)

- Interface `CodeRunner { run(code, input, limits) }`. Na POC existe a implementação `JsIsolatedRunner` (isolated-vm) e a `PythonRunner` fica só como stub, a ser implementada depois via container separado + HTTP.
- Limites: 1 s de CPU, 32 MB de memória, código de até 50 KB, sem `require`, rede, `process` ou fs. O `decimal.js` é pré-carregado no isolate como `D`, e a comunicação é feita com JSON (decimais trafegam como string).
- Contrato do código do usuário:
  ```js
  function calcular({ inputs, params, D, tabela }) {
    const base = D(inputs.base).times(1 - params.reducao);
    return { base: base.toFixed(2), aliquota: inputs.aliquota, valor: base.times(inputs.aliquota).div(100).toFixed(2) };
  }
  ```

---

## Catálogo de blocos padrão (fórmulas)

Abreviações usadas nas fórmulas: `vProd` (valor dos produtos), `vFrete`, `vSeg` (seguro), `vOutro` (outras despesas), `vDesc` (desconto), `vBC` (base de cálculo), `p*` (alíquota, ex.: `pICMS`).

Todas as alíquotas vêm das tabelas de referência (seed com valores de referência, **a validar com o contador**) e podem ser sobrescritas pelos params do nó.

| Bloco | Fórmula / comportamento |
|---|---|
| `trigger.webhook` | Saída: `pedido` (payload já validado) |
| `ctx.empresa` | Saída: regime, CRT, UF de origem, RBT12 |
| `ctx.operacao` | A partir das UFs de origem e destino e do indicador IE do destinatário, deduz `idDest` (interna, interestadual ou exterior), `indFinal`, contribuinte sim/não e o CFOP sugerido |
| `lookup.aliquotaIcms` | Alíquota interna da UF de destino; interestadual de **7%** (Sul/Sudeste, exceto ES, para N/NE/CO/ES), **12%** (demais) ou **4%** (importado, Res. SF 13/2012) |
| `lookup.tabela` | Consulta genérica: tabela + chaves + data → valor |
| `calc.baseCalculo` | `vBC = vProd + vFrete + vSeg + vOutro − vDesc` (flags para somar o IPI) |
| `tax.ipi` | `vBC = vProd + vFrete + vSeg + vOutro − vDesc`; `vIPI = vBC × pIPI` (TIPI por NCM); CST 50/51/52/99 |
| `tax.icms` | `vBC = (vProd + vFrete + vSeg + vOutro − vDesc [+ vIPI se o destinatário for consumidor final]) × (1 − pRedBC)`; `vICMS = vBC × pICMS`; CST 00/20/40/41/51/90 |
| `tax.icmsSt` | `MVAaj = [(1 + MVA) × (1 − ALQinter) / (1 − ALQintraDest)] − 1` (em operação interestadual); `vBCST = (vProd + vIPI + vFrete + vSeg + vOutro − vDesc) × (1 + MVAaj)`; `vICMSST = vBCST × ALQintraDest − vICMSproprio`; CST 10/70, CSOSN 201/202 |
| `tax.difal` | Vale para consumidor final em operação interestadual (EC 87/2015, LC 190/2022). Param `metodo`:<br>• **base única:** `vBC × (ALQintraDest − ALQinter)`<br>• **base dupla:** `vBCdest = (vBC − ICMSorig) / (1 − ALQintraDest)` e `DIFAL = vBCdest × ALQintraDest − ICMSorig` |
| `tax.fcp` | `vFCP = vBC × pFCP` (UF de destino); variantes FCP-ST e FCP UF destino |
| `tax.pis` / `tax.cofins` | `vBC = vProd + vFrete + vSeg + vOutro − vDesc − vICMS` (exclusão do ICMS: Tema 69 STF e Lei 14.592/2023, controlada pela flag `excluirIcmsDaBase`)<br>• **cumulativo (Presumido):** 0,65% / 3,00%<br>• **não cumulativo (Real):** 1,65% / 7,60% |
| `simples.aliquotaEfetiva` | `(RBT12 × Aliq − PD) / RBT12`, com Anexo I (comércio) e Anexo II (indústria) na tabela de referência; também devolve o % de ICMS da faixa (partilha) |
| `simples.icms` | CSOSN 101: `vCredICMSSN = vProd × pCredSN` (crédito permitido)<br>CSOSN 102/103/300/400: sem destaque<br>CSOSN 500: ST retida anteriormente |
| `reforma.cbs` / `reforma.ibs` | Base (NT 2025.002-RTC): `vBC = vProd + vFrete + vSeg + vOutro − vDesc − vPIS − vCOFINS − vICMS − vICMSUFDest − vFCP − vFCPUFDest`<br>`pAliqEfet = pAliq × (1 − pRedAliq)`, `v = vBC × pAliqEfet`<br>Em **2026**: CBS 0,9%, IBS UF 0,1%, IBS municipal 0% (ano de teste, informativo). Os anos 2027–2033 ficam na tabela.<br>Saem também CST IBS/CBS e cClassTrib, com redução de 30/60/100% por cClassTrib. |
| `reforma.is` | Imposto Seletivo por NCM (vigente a partir de 2027; alíquota 0 em 2026) |
| `reforma.transicaoIcms` | Fator de redução do ICMS: 2029 = 10%, 2030 = 20%, 2031 = 30%, 2032 = 40%, 2033 = extinto (vem da tabela) |
| `logic.expressao` | Fórmula simples, sem código livre (ex.: `base * aliquota / 100`), avaliada com parser seguro (`expr-eval`) |
| `logic.condicao` | Se/senão com base num valor (ex.: regime = SIMPLES → ramo Simples) |
| `logic.codigo` | Nó de código JS livre, com portas declaradas pelo usuário |
| `flow.subfluxo` / `flow.paraCadaItem` | Composição de fluxos (ver seção do motor) |
| `nfe.totalizar` | Soma os itens em ICMSTot e IBSCBSTot. `vNF = vProd − vDesc + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol`. Em 2026 o IBS/CBS não entra no vNF. |
| `nfe.chaveAcesso` | 44 dígitos: `cUF + AAMM + CNPJ + mod + série + nNF + tpEmis + cNF + cDV`, com DV módulo 11. Suporta CNPJ alfanumérico (valor do caractere = ASCII − 48). |
| `nfe.montarXml` | XML do layout 4.00 com os grupos `imposto/ICMS`, `IPI`, `PIS`, `COFINS` e `IBSCBS`, sem assinatura (mock) |
| `sefaz.autorizar` | Adapter `SefazGateway`. O **mock** devolve cStat 100, nProt e dhRecbto, e simula rejeições por regra (ex.: CNPJ inválido gera 207; vNF divergente gera 531) |
| `financeiro.parcelas` | Divide o vNF conforme a condição de pagamento (ex.: 30/60/90), jogando o resíduo de centavos na 1ª parcela |
| `financeiro.boleto` | Adapter `BoletoGateway`. O **mock** gera nosso número, código de barras de 44 posições (DV módulo 11) e linha digitável (DV módulo 10) pelo padrão FEBRABAN. O fator de vencimento usa a nova base (22/02/2025 = 1000). |
| `output.resposta` | Marca quais dados alimentam o template de resposta |

---

## Webhooks

- **Cadastro** (tela e API): slug (regex `^[a-z0-9-]+$`, único), fluxo publicado, token opcional (header `X-Webhook-Token`), schema de request e template de response.
- **Schema de request:** uma DSL em JSON guardada no banco. Campos com nome, tipo (`string`, `number`, `integer`, `boolean`, `date`, `enum`, `object`, `array`), obrigatório, min/max, regex e formatos BR (`cnpj`, `cpf`, `cep`, `ncm` com 8 dígitos, `cfop` com 4, `uf`, `chaveNfe`).
  - `buildZodSchema(dsl)` em `packages/shared` converte a DSL em Zod em tempo de execução.
  - A própria DSL é validada por um meta-schema Zod.
  - Botão **"inferir de JSON de exemplo"** gera a DSL a partir de um payload colado.
- **Receptor** `POST /webhook/:slug`:
  1. Busca o endpoint e verifica se está ativo e se o token confere.
  2. Valida o body com o Zod dinâmico. Se falhar, responde **422** com `issues` (path, mensagem em pt-BR).
  3. Checa **idempotência** (header `Idempotency-Key` ou campo configurável, ex.: `pedido.id`). Se já existe execução, devolve o resultado anterior. Isso é essencial para não emitir nota duas vezes.
  4. Executa o fluxo de forma síncrona.
  5. Monta a resposta pelo template (`{"chave": "{{nodes.sefaz.chave}}", "boleto": "{{nodes.boleto.linhaDigitavel}}", "impostos": "{{nodes.totalizar}}"}`).
  6. Grava a `Execution`.
- Rate limit básico com `@nestjs/throttler`. Modo assíncrono (fila + callback) fica **fora da POC**, mas o design já prevê `executionId`.

## API admin (REST, header `X-Tenant-Id`)

`/api/tenants` · `/api/blocks` (catálogo: globais + custom do tenant) · `/api/overrides` (+ `POST /:id/test`, que compara padrão × override com o mesmo input) · `/api/flows` (+ `/validate`, `/publish`, `/run` para dry-run com payload) · `/api/flow-versions` · `/api/webhooks` · `/api/executions` · `/api/reference-tables`.

## Frontend (telas)

1. **Layout:** sidebar, seletor de empresa (tenant) no topo, tema claro/escuro, transições com Motion.
2. **Empresas:** CRUD com validação de CNPJ (inclusive alfanumérico) e regime.
3. **Editor de fluxos (React Flow)**, a tela principal:
   - paleta lateral com os blocos por categoria (arrastar e soltar);
   - nó customizado com handles coloridos por tipo;
   - `isValidConnection` bloqueando tipos incompatíveis;
   - painel de configuração do nó (Radix Dialog/Popover + form Zod);
   - badge de "override ativo" no nó;
   - botão **Testar**: roda com payload de exemplo, anima o caminho executado (Motion) e mostra a saída de cada nó ao clicar, como no n8n;
   - publicar versão.
4. **Catálogo de blocos:** contrato de entrada e saída, fórmula documentada, código.
5. **Overrides da empresa:** editor Monaco, vigência, base legal, painel de teste lado a lado (padrão × override).
6. **Webhooks:** formulário de cadastro, construtor de schema, editor do template de resposta, "copiar URL", console para disparar um payload de teste.
7. **Execuções:** lista e detalhe com o trace nó a nó, input, output e XML.
8. **Tabelas de referência:** grid editável com vigência.

---

## Seeds de demonstração

- **Tenants:**
  - *Vinícius Distribuidora*: Lucro Presumido, SP.
  - *Loja Simples*: Simples Nacional, MG, Anexo I.
  - *Indústria Liminar*: Lucro Real, PR, com um **override** judicial, por exemplo redução de 50% na base do ICMS com o nº do processo como base legal.
- **Fluxo template "Pedido padrão":** webhook → empresa/operação → paraCadaItem(subfluxo "Impostos do item") → totalizar → chave → XML → SEFAZ (mock) → parcelas → boleto → resposta.
- **Subfluxo "Impostos do item":** condição por regime → ICMS/ST/DIFAL/FCP ou Simples → IPI → PIS/COFINS → CBS/IBS/IS.
- **Webhook** `calcular-nota-vinicius` apontando para o fluxo publicado da Vinícius Distribuidora.
- Tabelas de referência: ICMS interno das 27 UFs, matriz interestadual, FCP, IBS/CBS 2026–2033, TIPI e MVA (amostra de NCMs), anexos I e II do Simples.

---

## Fases de implementação

1. **Setup:** monorepo pnpm, docker-compose (postgres, api, web), Prisma schema + migration, lint e tsconfig compartilhados.
2. **`packages/shared`:** tipos de porta, validadores BR (CNPJ numérico e alfanumérico, CPF, NCM, CFOP, UF), DSL → Zod, meta-schemas.
3. **`packages/engine`:** executor de grafo, resolução de override, lookup de tabelas, todos os blocos fiscais e financeiros, com **testes dourados**.
4. **API Nest:** módulos Tenants, Blocks, Overrides, Flows, Engine (+ `JsIsolatedRunner`), ReferenceTables, Executions, Fiscal (mock SEFAZ e XML), Finance (mock boleto) e Webhooks (admin + receptor); seeds.
5. **Web:** layout e tenants, editor de fluxos, overrides, webhooks, execuções, tabelas.
6. **Polimento:** README com `docker compose up` e `curl` de exemplo, e animações.

## Verificação

- **Vitest no engine, com casos dourados calculados à mão.** Exemplo: item de vProd 1.000,00 com frete 50,00, operação SP→SP, Lucro Presumido:

  | Tributo | Base | Cálculo | Valor |
  |---|---|---|---|
  | ICMS 18% | 1.050,00 | 1.050,00 × 18% | 189,00 |
  | PIS 0,65% | 861,00 (1.050 − 189) | 861,00 × 0,65% | 5,60 |
  | COFINS 3% | 861,00 | 861,00 × 3% | 25,83 |
  | CBS 0,9% | 829,57 (1.050 − 189 − 5,60 − 25,83) | 829,57 × 0,9% | 7,47 |
  | IBS 0,1% | 829,57 | 829,57 × 0,1% | 0,83 |

  Também haverá casos para ST com MVA ajustada, DIFAL por base única e base dupla, Simples com CSOSN 101, DV da chave de acesso, código de barras e linha digitável do boleto, e vigência de tabelas (2026 × 2027).
- **Sandbox:** loop infinito é abortado em 1 s, estouro de memória é barrado, acesso a `process` ou `require` falha, output fora do contrato é rejeitado.
- **Override:** fica ativo só dentro da vigência; o tenant sem override usa o bloco padrão.
- **E2E (supertest):**
  - payload inválido → 422 com issues;
  - token errado → 401;
  - `Idempotency-Key` repetida → mesmo resultado sem nova execução;
  - fluxo completo → 200 com chave de 44 dígitos, protocolo e linha digitável.
- **Manual:**
  1. Rodar `docker compose up`.
  2. Abrir o web e montar ou editar o fluxo.
  3. Clicar em **Testar** e conferir as saídas por nó.
  4. Rodar `curl -X POST http://localhost:3000/webhook/calcular-nota-vinicius -d @pedido.json`.
  5. Ver a execução com o trace na tela de Execuções.
  6. Trocar para o tenant com liminar e confirmar que o ICMS muda.

## Fora do escopo da POC

Login/RBAC, SEFAZ real e certificado A1, assinatura XML, DANFE em PDF, NFS-e/ISS, cancelamento/CC-e/contingência, fila assíncrona, runner Python (só a interface) e registro bancário real de boleto.
