# Motor Fiscal — POC

Motor fiscal/financeiro para o **Yzidro ERP**, montado como uma plataforma de fluxos (estilo n8n).
O sistema X envia um webhook com o pedido; o motor valida o payload, calcula os impostos item a item,
monta a NF-e, autoriza (SEFAZ simulada), gera as parcelas e os boletos, e responde com o resultado.

Cada imposto é um **bloco** com entradas e saídas tipadas. Cada empresa pode fazer **override** de qualquer
bloco (parâmetros e/ou código JavaScript) com vigência e base legal, para benefícios obtidos na justiça.

> ⚠️ **As alíquotas do seed são valores de referência para a POC.** Confira com o contador antes de qualquer uso real
> (ICMS interno por UF, FCP, MVA, TIPI, anexos do Simples e as alíquotas de transição da reforma tributária).

## Subir tudo (Docker)

```bash
docker compose up --build
```

| O quê | Onde |
|---|---|
| Interface (editor de fluxos etc.) | http://localhost:8080 |
| API | http://localhost:3000 (`/api/...`) |
| Webhooks | `POST http://localhost:8080/webhook/<slug>` (ou `:3000`) |
| Postgres | `localhost:5433` (usuário/senha/banco: `motor` / `motor` / `motor_fiscal`) |

Na primeira subida a API aplica as migrations e cria os dados de demonstração (`SEED_ON_START=true`).

### Disparar o webhook de exemplo

```bash
curl -X POST http://localhost:8080/webhook/calcular-nota-vinicius \
  -H 'Content-Type: application/json' \
  -d @examples/pedido.json
```

Resposta (resumida): chave de acesso de 44 dígitos, protocolo, XML da NF-e, totais, impostos por item,
parcelas e boletos (código de barras e linha digitável). O cabeçalho `X-Execution-Id` leva ao passo a passo
na tela **Execuções**.

- Repetir o mesmo `id` do pedido **não emite outra nota**: devolve a resposta anterior com o header
  `Idempotent-Replay: true`. Para um pedido novo, troque o `id` (ou envie outro `Idempotency-Key`).
- Payload inválido responde **422** com a lista de campos e mensagens em pt-BR.

### Empresas de demonstração

| Empresa | Regime | Webhook | O que demonstra |
|---|---|---|---|
| Vinícius Distribuidora Ltda (SP) | Lucro Presumido | `calcular-nota-vinicius` | ICMS, PIS/COFINS cumulativos, CBS/IBS 2026 |
| Loja Simples ME (MG) | Simples Nacional | `calcular-nota-loja-simples` | alíquota efetiva, CSOSN 101 e crédito de ICMS |
| Indústria Liminar S/A (PR) | Lucro Real | `calcular-nota-industria` | **override**: liminar com redução de 50% na base do ICMS |

## Como funciona

```
apps/api        NestJS: API admin (/api/*), receptor de webhooks (/webhook/:slug), sandbox de código, seed
apps/web        React + Vite + Tailwind v4 + Radix + React Flow + Motion
packages/shared Schemas Zod, tipos de porta, DSL do payload do webhook, validadores BR (CNPJ alfanumérico etc.)
packages/engine Motor de execução do grafo + blocos fiscais/financeiros (TypeScript puro, sem Nest)
```

- **Fluxo** = grafo de blocos. O publicado vira uma versão **imutável** com os subfluxos embutidos.
- **Bloco** = `entradas → saídas`, com parâmetros. A saída de cada bloco é validada pelo tipo da porta, então um
  override não consegue quebrar o contrato do bloco que substitui.
- **Subfluxo** = fluxo usado como bloco. O fluxo padrão roda o subfluxo *Impostos do item* uma vez por item
  (`Para cada item`), ramificando por regime (Simples × regime normal).
- **Override** = por empresa, por bloco, com vigência (início/fim), base legal e ativo/inativo. Pode só trocar
  parâmetros (ex.: `pRedBC: 50`) ou substituir o bloco com código JavaScript. Aparece no trace de cada execução.
- **Tabelas de referência com vigência**: a alíquota nova é uma linha nova com data de início, sem mudar código.
  O cálculo usa a **data de emissão** do pedido, então reprocessar um pedido antigo dá o mesmo resultado.
  Há linhas globais e linhas por empresa (a da empresa tem prioridade).
- **Sandbox**: o código dos overrides roda em um isolate do V8 (`isolated-vm`) com limite de 1 s e 32 MB,
  sem `process`, `require`, rede nem arquivos. Para Python, basta implementar outro `CodeRunner`.
- **Webhook**: slug único, schema do payload (DSL → Zod, com CNPJ/CPF/NCM/CFOP/UF...), token opcional
  (`X-Webhook-Token`), idempotência e template de resposta com `{{input.*}}` e `{{nodes.<id>.<porta>}}`.

### Blocos disponíveis

IPI · ICMS · ICMS-ST (MVA ajustada) · DIFAL (base única e dupla) · FCP (próprio, ST, UF destino) · PIS/COFINS
(cumulativo e não cumulativo, com exclusão do ICMS da base) · Simples (alíquota efetiva e CSOSN) ·
CBS · IBS · Imposto Seletivo · transição do ICMS (2029–2033) · fórmula · se/senão · código JavaScript ·
subfluxo · para cada item · totais · chave de acesso (aceita CNPJ alfanumérico) · XML da NF-e (layout 4.00 com grupo IBSCBS) ·
SEFAZ (mock) · parcelas · boletos (mock FEBRABAN, fator de vencimento na nova base). Detalhes e fórmulas na tela **Blocos**.

## Desenvolvimento local

Requer Node 22 e pnpm 10.

```bash
pnpm install
docker compose up -d postgres          # só o banco
cp .env.example apps/api/.env          # DATABASE_URL apontando para localhost:5433
pnpm build:libs                        # shared e engine
pnpm --filter @motor-fiscal/api prisma:deploy
SEED_ON_START=true pnpm dev:api        # API em :3000 (com seed na primeira vez)
pnpm dev:web                           # UI em :5173, com proxy para a API
```

O `isolated-vm` exige `--no-node-snapshot` no Node 20+ (os scripts de `start` e `test` da API já passam a flag).

### Testes

```bash
pnpm typecheck
pnpm test      # shared (18) · engine (42) · api e2e (29, exige o Postgres do compose)
```

Os testes do motor trazem casos calculados à mão (ICMS 18% sobre 1.050 = 189,00; PIS 5,60; COFINS 25,83;
CBS 7,47; IBS 0,83), ST com MVA ajustada, DIFAL pelos dois métodos, Simples, vigência 2026 × 2027, transição do
ICMS em 2030, overrides e rejeição da SEFAZ. Os e2e cobrem o webhook (422, token, idempotência, concorrência),
overrides, publicação de versões e o sandbox (loop infinito, memória, `process`/`require`/`fetch`).

## Decisões e diferenças em relação ao plano (`docs/PLANO-POC.md`)

- **Sem tabela `BlockDefinition`**: o reaproveitamento é feito por **subfluxos** e pelo bloco **Código JavaScript**
  (com portas declaradas no próprio fluxo).
- **Sem bloco `output.resposta`**: a resposta é montada pelo template do webhook, que enxerga a saída de qualquer nó.
- **ICMS interestadual** (4/7/12%) é uma regra no código (Resolução do Senado), não uma tabela.
- **Auto-layout com dagre** (em vez de elkjs); formulários com `useState` + os mesmos schemas Zod (sem react-hook-form);
  `ZodPipe` próprio (sem `nestjs-zod`).
- **Numeração da NF-e**: sequência única por empresa (incrementada de forma atômica). Se o fluxo falha depois de
  reservar o número, ele é consumido (na prática seria uma inutilização).
- O **teste do editor** (“Testar”) roda a seco: não grava execução nem consome a numeração real.
- No **Simples Nacional** o IBS/CBS de 2026 fica zerado por padrão (teste dispensado; o bloco tem a opção
  `calcularParaSimples`).

## Fora do escopo da POC

Login/RBAC · SEFAZ real, certificado A1 e assinatura do XML · DANFE em PDF · NFS-e/ISS · cancelamento, CC-e e
contingência · fila assíncrona com callback · runner Python (só a interface `CodeRunner`) · registro bancário real do boleto ·
testes automatizados de UI.
