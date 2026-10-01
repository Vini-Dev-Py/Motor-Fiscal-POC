# Guia: criar um novo imposto (ou mudar a regra de um existente)

Há quatro caminhos. Escolha o mais simples que resolve:

| Situação | Caminho | Precisa mexer no código do motor? |
|---|---|---|
| A **alíquota mudou** (ou passa a mudar numa data) | [A. Tabela com vigência](#a-alíquota-nova-é-uma-linha-nova) | não |
| Uma **empresa específica** tem regra/benefício próprio | [B. Override da empresa](#b-override-da-empresa-parâmetros-ou-código) | não |
| Um **imposto novo** com conta simples | [C. Fórmula ou código no fluxo](#c-imposto-novo-por-fórmula-ou-código-no-fluxo) | não |
| Um imposto novo que **todos** usam e que precisa entrar na nota (totais/XML), com testes | [D. Bloco nativo](#d-bloco-nativo-em-typescript) | sim |

Antes de começar, leia a convenção do tipo **`tributo`** (é o formato de saída de qualquer imposto) e as regras de
fórmula em [Fórmulas e contratos](FORMULAS.md).

---

## A. Alíquota nova é uma linha nova

A reforma tributária muda alíquotas ano a ano. Nada disso precisa de código: as alíquotas vivem em **tabelas de
referência com vigência**, e o cálculo escolhe a linha vigente pela **data de emissão** do pedido.

1. Menu **Tabelas**, escolha a tabela (ex.: *IBS/CBS (transição)*, *ICMS interno por UF*, *MVA para ICMS-ST*).
2. **Nova linha**: preencha as chaves (`*` ou vazio = qualquer), o valor, a **vigência** (início e fim opcional) e
   o escopo:
   - *global* — vale para todas as empresas;
   - *só desta empresa* — tem **prioridade** sobre a global de mesma especificidade.
3. Pronto. Pedidos com data de emissão dentro da vigência passam a usar a linha; pedidos antigos continuam
   calculando com a alíquota antiga (reprocessar dá o mesmo resultado).

Exemplo — ICMS interno de SP passa a 19% em 01/01/2027: tabela `icms_interna`, chave `uf = SP`, valor
`aliquota = 19`, vigência início `2027-01-01`. A linha antiga (18%) continua valendo para datas anteriores.

Como a consulta escolhe a linha: veja [Arquitetura §4.5](ARQUITETURA.md#45-tabelas-de-referência-tablests).

## B. Override da empresa (parâmetros ou código)

Para um benefício fiscal de **uma** empresa (liminar, regime especial). Passo a passo na tela **Overrides** em
[Guia de fluxos §7](GUIA-FLUXOS.md#7-override-por-empresa-benefício-fiscal). Resumo técnico:

- **Só parâmetros** — `{ "pRedBC": 50 }`: o bloco padrão roda com esse parâmetro trocado. Os parâmetros
  disponíveis de cada bloco estão na tela **Blocos** e aparecem como dica no formulário do override.
- **Com código** — substitui o bloco inteiro (contrato em [Fórmulas e contratos](FORMULAS.md#5-código-javascript)).
  A saída é validada pelo contrato do bloco: se faltar `valor` num `tributo`, a execução falha com `SAIDA_INVALIDA`
  em vez de passar um valor errado adiante.
- Vigência (`validFrom`/`validTo`) é comparada com a **data de emissão**. Vários overrides vigentes: o de início
  mais recente vence.
- **Não** aceitam override: *Se / senão*, *Código JavaScript*, *Subfluxo*, *Para cada item*, *Entrada*/*Saída* do
  subfluxo e *Webhook recebido* (a tela só lista os blocos que aceitam).

## C. Imposto novo por fórmula ou código (no fluxo)

Serve para calcular algo que o motor ainda não conhece **sem alterar o motor**. O resultado aparece por item na
resposta, mas **não entra no total da nota nem no XML** (veja
[Integrando na nota](#integrando-na-nota-vnf-e-xml) para promovê-lo a nativo).

### C.1 Por fórmula (conta simples)

Bloco **Fórmula** (`logic.expressao`): entradas decimais opcionais `a`, `b`, `c` e a entrada opcional **`item`**;
saída `resultado` (decimal). Ligando o `item`, a fórmula enxerga `vProd`, `vFrete`, `vSeg`, `vOutro`, `vDesc`,
`vOperacao` (= vProd + vFrete + vSeg + vOutro − vDesc), `quantidade` e `valorUnitario`.

Exemplo — taxa de 1,5% sobre o valor da operação, com mínimo de R$ 20:

1. No subfluxo dos impostos, adicione **Fórmula** e ligue `Entrada.Item` → `item` do bloco.
2. Parâmetro `expressao`: `max(pct(vOperacao, 1.5), 20)` (e `casas` = 2).
3. Crie na **Saída** a porta `taxaX` (tipo *Decimal*, opcional) e ligue `resultado` → `taxaX`.

`pct(base, percentual)` é `base × percentual / 100`; `max`, `min`, `abs` e `round(x, casas)` também existem. Sintaxe
completa e limites em [Fórmulas](FORMULAS.md#3-bloco-fórmula-logicexpressao).

> A fórmula devolve um **decimal**. Para uma saída do tipo `tributo` (base/alíquota/valor) use o bloco de código.

### C.2 Por código JavaScript (devolvendo um `tributo`)

1. No **subfluxo** dos impostos (ex.: *Impostos do item*), adicione o bloco **Código JavaScript**.
2. Declare as **portas** no painel: entrada `item` (tipo *Item*); saída `taxaX` (tipo *Tributo*).
3. Cole o código:

   ```js
   function calcular({ inputs, D, tabela }) {
     const it = inputs.item;
     const base = D(it.vProd).plus(it.vFrete).plus(it.vSeg).plus(it.vOutro).minus(it.vDesc);
     const valor = base.times('0.015').toDecimalPlaces(2);          // 1,5%
     return { taxaX: { base: base.toFixed(2), aliquota: '1.5', valor: valor.toFixed(2), aplicavel: true } };
   }
   ```

4. Na **Saída** do subfluxo, crie a porta `taxaX` (tipo *Tributo*, opcional) e ligue o bloco de código a ela.
   Ligue `Entrada.Item` → `item` do bloco de código.
5. **Salvar** e **Testar** o fluxo de pedido. Em `Para cada item.resultados[n].taxaX` está o valor (`"15.75"`
   para o item de R$ 1.050); na resposta, use `{{nodes.paraCadaItem.resultados}}` no template.
6. **Publicar** o fluxo de pedido (a versão publicada carrega a cópia atual do subfluxo).

Dentro do código você pode consultar tabelas com vigência: `tabela('taxa_x', { uf: inputs.contexto.operacao.ufDestino })`
(a tabela precisa existir em `REFERENCE_TABLES` — veja o caminho D — porque só as tabelas catalogadas podem ter
linhas cadastradas pela tela).

---

## D. Bloco nativo em TypeScript

O caminho certo para um imposto de verdade: tem contrato tipado, aparece no catálogo e na paleta, pode ser testado
com casos calculados à mão e (se necessário) entrar nos totais e no XML.

O exemplo abaixo cria o **Taxa X**: alíquota por UF (tabela com vigência) sobre o valor da operação, com valor
mínimo. O código foi executado e testado; troque a regra pela do seu imposto.

### D.1 Escreva o bloco

Crie `packages/engine/src/blocks/taxa-x.ts`:

```ts
import { z } from 'zod';
import { D, dec, pctOf } from '../money';
import { tributo, tributoZero, valorOperacao } from '../fiscal/rules';
import { defineBlock, type Contexto, type ItemNormalizado } from '../types';

export const taxTaxaX = defineBlock({
  key: 'tax.taxaX',                    // identificador estável: fica gravado nos fluxos
  version: 1,
  label: 'Taxa X',
  category: 'imposto',                 // define o grupo na paleta e a cor
  description: 'Taxa estadual fictícia: alíquota por UF (tabela com vigência) sobre o valor da operação, com mínimo.',
  formula: 'vTaxaX = máx(vOperação × pTaxaX, mínimo)',   // aparece na tela Blocos e no painel do nó
  inputs: [
    { id: 'item', label: 'Item', type: 'item', required: true },
    { id: 'contexto', label: 'Contexto', type: 'contexto', required: true },
  ],
  outputs: [{ id: 'taxaX', label: 'Taxa X', type: 'tributo', required: true }],
  params: z.object({                   // vira o formulário do painel (tipos simples) e aceita override
    aliquota: z.number().min(0).max(100).optional(),   // fixa a alíquota no nó (ignora a tabela)
    minimo: z.number().min(0).default(0),
  }),
  run: ({ inputs, params, ctx }) => {
    const item = inputs.item as ItemNormalizado;
    const c = inputs.contexto as Contexto;
    // alíquota da tabela, pela UF de destino e pela DATA DE EMISSÃO (vigência)
    const row = ctx.tables.lookup<{ aliquota: string }>('taxa_x', { uf: c.operacao.ufDestino }, c.operacao.dataEmissao);
    const aliq = params.aliquota !== undefined ? dec(params.aliquota) : dec(row?.aliquota ?? 0);
    if (aliq.isZero()) return { taxaX: tributoZero() };          // "não se aplica": mantém o contrato
    const base = valorOperacao(item);
    const valor = D.max(pctOf(base, aliq), dec(params.minimo));  // pctOf já arredonda em 2 casas
    return { taxaX: tributo(base, aliq, valor, { minimo: String(params.minimo) }) };
  },
});
```

Regras do contrato (o executor valida; o que violar vira erro de execução, não resultado errado):

- `params.parse({})` precisa funcionar: todo parâmetro é opcional ou tem `.default()`.
- Devolva **todas** as saídas `required` (as opcionais podem faltar). Só as portas declaradas são mantidas.
- Imposto = tipo **`tributo`**: `base`, `aliquota`, `valor` como **string decimal**. Use os helpers
  `tributo(base, aliquota, valor, extras)` e `tributoZero(extras)` (`fiscal/rules.ts`), que já formatam e marcam
  `aplicavel`.
- **Conta sempre com Decimal** (`dec`, `D`, `pctOf`, `fix` de `money.ts`) — nunca `number`. Percentual é
  `"18"` (não `0.18`).
- Não acesse banco, rede nem relógio: tudo vem de `ctx` (`tables`, `tenant`, `referenceDate`, `services`).
  Use a **data de emissão** (`c.operacao.dataEmissao`) para vigência.
- Erro de negócio: `throw new BlockError('mensagem clara', 'CODIGO')`. Para a API responder **422** (e não 500)
  inclua o código em `BUSINESS_ERROR_CODES` (`apps/api/src/webhooks/webhooks.module.ts`).
- Reutilize as regras prontas em `fiscal/rules.ts` (`valorOperacao`, `aliquotaInterna`, `aliquotaIcmsOperacao`...)
  em vez de recalcular.

### D.2 Registre o bloco

Em `packages/engine/src/registry.ts`, importe e acrescente em `BUILTIN_BLOCKS`:

```ts
import { taxTaxaX } from './blocks/taxa-x';
// ...
export const BUILTIN_BLOCKS: BlockDef[] = [ /* ... */, taxPis, taxCofins, taxTaxaX, /* ... */ ];
```

Pronto para o catálogo: `GET /api/blocks` já devolve o bloco (com o JSON Schema dos parâmetros) e a paleta do
editor o mostra em *Impostos*. **O front não muda.**

### D.3 Cadastre a tabela de referência (se o imposto tem alíquota)

Em `packages/engine/src/reference-data.ts`:

```ts
// 1) catálogo (aparece na tela Tabelas)
{ key: 'taxa_x', name: 'Taxa X por UF', description: 'Alíquota da Taxa X (%).', keyFields: ['uf'], valueFields: ['aliquota'] },

// 2) linhas do seed (dentro de buildReferenceRows)
rows.push(row('taxa_x', { uf: 'SP' }, { aliquota: '1.5' }, '2026-01-01'));
```

> **Atenção:** o seed só roda em **banco vazio**. Num banco que já existe, as linhas novas do código **não**
> aparecem — cadastre-as pela tela **Tabelas** (ou com um script). A tabela em si (o catálogo) já aparece.

### D.4 Use o bloco num fluxo

- **Pela interface (banco existente):** abra o subfluxo *Impostos do item*, adicione o bloco *Taxa X*, ligue
  `Entrada.Item` e `Entrada.Contexto` a ele, crie na **Saída** a porta `taxaX` (tipo *Tributo*, opcional) e ligue.
  Publique o fluxo de pedido.
- **Pelo seed (bancos novos):** em `packages/engine/src/default-flows.ts`, em `buildImpostosItemGraph`,
  adicione o nó, as arestas e a porta (`tributoPort('taxaX', 'Taxa X')`) à lista `saidaPorts`.

### D.5 Teste

Teste o bloco isolado, com o conta feita à mão, **sem registrá-lo** (use um registro à parte) — veja o padrão
completo em [Testes](TESTES.md#3-testes-do-motor-vitest):

```ts
const registry = createRegistry([...BUILTIN_BLOCKS, taxTaxaX]);
const r = await runBlockOnce({ blockKey: 'tax.taxaX', inputs: { item, contexto }, ctx, registry });
expect(r.outputs.taxaX).toMatchObject({ base: '1050.00', aliquota: '1.5', valor: '15.75' });   // 1050 × 1,5%
```

Rodar só esse teste: `pnpm --filter @motor-fiscal/engine exec vitest run -t "Taxa X"`.

### D.6 Compile e reinicie

A API usa o **build** dos pacotes. Depois de mexer no engine/shared:

```bash
pnpm build:libs              # recompila shared e engine
# reinicie a API (pnpm dev:api) — ou, no Docker:
docker compose up -d --build api
```

O front (`pnpm dev:web`) lê o catálogo da API, então o bloco novo aparece ao recarregar a página.

### Integrando na nota (vNF e XML)

Um imposto novo só **entra no total e no XML** se o totalizador e o montador de XML o conhecerem. Hoje eles
conhecem apenas: `icms`, `icmsSt`, `difal`, `fcp`, `fcpSt`, `fcpUfDestino`, `ipi`, `pis`, `cofins`, `cbs`, `ibs`, `is`.
Para integrar o `taxaX`:

1. `packages/engine/src/fiscal/nfe-xml.ts`: acrescente `taxaX?: Tri` em `ResultadoItem` e o campo desejado em
   `Totais`.
2. `packages/engine/src/blocks/nfe-financeiro.ts` (`nfeTotalizar`): some o novo tributo, ex.
   `vTaxaX: fix(somar(ok('taxaX').map((t) => t.valor)))`. Decida se ele compõe o `vNF` (a fórmula do `vNF` está
   no mesmo bloco) — isso depende da legislação do imposto.
3. Se o imposto tem **grupo no layout da NF-e**, gere-o em `detXml`/`montarNfeXml` (`fiscal/nfe-xml.ts`).
4. A porta de saída do subfluxo precisa ter o **mesmo id** (`taxaX`) para o totalizador enxergá-la.
5. Atualize os testes do totalizador e do XML.

### Variações

- **Novo tipo de dado (porta):** acrescente em `PORT_TYPES`, `PORT_TYPE_LABELS`, `PORT_VALUE_SCHEMAS` e na matriz
  `isPortCompatible` (`packages/shared/src/ports.ts`) e uma cor em `PORT_COLORS` (`apps/web/src/lib/utils.ts`).
- **Nova categoria de bloco:** `BLOCK_CATEGORIES` e `BLOCK_CATEGORY_LABELS` (`packages/shared/src/domain.ts`) e uma
  cor em `CATEGORY_COLORS` (`apps/web/src/lib/utils.ts`).
- **Mudar uma regra existente:** edite o bloco; se a mudança for incompatível com fluxos publicados, crie um bloco
  novo (`tax.icms2`) em vez de alterar o comportamento do atual — o `key` está gravado nas versões publicadas.

---

## Checklist de um imposto novo

- [ ] Fórmula escrita no `description`/`formula` do bloco (aparece para quem monta o fluxo).
- [ ] Todas as contas em Decimal; percentuais em "pontos" (`"18"`).
- [ ] Alíquotas em tabela com **vigência**, nunca fixas no código.
- [ ] Caso "não se aplica" devolve `tributoZero()` (não deixa a porta vazia).
- [ ] Teste com **resultado calculado à mão** (mínimo: caso normal, caso zero, caso de vigência diferente).
- [ ] Integrado ao totalizador/XML, se for entrar na nota.
- [ ] Revisado pelo contador (as regras são de responsabilidade fiscal, não só técnica).
