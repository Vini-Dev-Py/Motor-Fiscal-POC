# Fórmulas e contratos de dados

Referência para quem **define fórmulas**: convenções numéricas, o bloco *Fórmula*, o bloco/override com código
JavaScript, os formatos de dados que circulam (item, contexto, tributo) e um resumo das contas fiscais que o motor
já faz. Para o passo a passo, veja [Novo imposto](NOVO-IMPOSTO.md).

> As contas abaixo descrevem **o que o código faz hoje**, com alíquotas de referência. A interpretação da
> legislação (base de cálculo, enquadramento, vigência) deve ser validada por quem responde pela área fiscal.

## 1. Convenções numéricas

| Regra | Detalhe |
|---|---|
| **Decimal como string** | valores monetários, bases e alíquotas trafegam como `"189.00"`, `"18"`. Nunca `number`. |
| **Percentual em pontos** | 18% é `"18"` (não `0.18`). `pct(base, 18)` = `base × 18 / 100`. |
| **Aritmética exata** | decimal.js (40 dígitos). `0.1 + 0.2` dá `0.3`. |
| **Arredondamento** | *half-up* (0,5 sobe). O **valor de cada tributo** é arredondado em 2 casas quando calculado (`pctOf`); a base do imposto seguinte já usa o valor arredondado — como na NF-e. |
| **Casas dos percentuais** | até 4 casas no resultado (`1.8088`). |
| **Moeda** | sem símbolo, ponto como separador decimal. |

## 2. Dados que circulam

### `item` (por item do pedido)

```json
{
  "nItem": 1, "codigo": "CAM-001", "descricao": "Camiseta algodão", "ncm": "61091000", "cfop": "5102",
  "origem": 0, "unidade": "UN", "quantidade": "10", "valorUnitario": "100",
  "vProd": "1000.00", "vDesc": "0.00", "vFrete": "50.00", "vSeg": "0.00", "vOutro": "0.00"
}
```

`vProd = quantidade × valorUnitario` (arredondado em 2 casas). `cfop` só existe se veio no pedido. `origem` é a origem
da mercadoria (0 nacional; 1, 2, 3 e 8 importada — usada no ICMS interestadual de 4%).

### `contexto`

```json
{
  "tenant": { "id": "…", "cnpj": "11222333000181", "razaoSocial": "…", "ie": "…", "uf": "SP", "codMunicipio": "3550308",
              "regime": "PRESUMIDO", "crt": 3, "rbt12": null, "config": { } },
  "operacao": { "ufOrigem": "SP", "ufDestino": "SP", "idDest": 1, "interestadual": false,
                "consumidorFinal": false, "contribuinte": true, "indIEDest": 1,
                "dataEmissao": "2026-09-30", "ano": 2026, "cfop": "5102" },
  "destinatario": { "nome": "…", "documento": "11222333000181", "uf": "SP", "ie": "…", "codMunicipio": "…" }
}
```

`regime`: `SIMPLES` | `PRESUMIDO` | `REAL`. `idDest`: 1 interna, 2 interestadual. `indIEDest`: 1 contribuinte,
2 isento, 9 não contribuinte. `operacao.dataEmissao` é a data que escolhe tabelas e overrides vigentes.

### `tributo` (saída de qualquer imposto)

```json
{ "base": "1050.00", "aliquota": "18", "valor": "189.00", "aplicavel": true, "cst": "00", "pRedBC": "0" }
```

- Obrigatórios: `base`, `aliquota`, `valor` (strings decimais). Campos extras são livres e preservados
  (`cst`, `csosn`, `mva`, `vICMSUFDest`...).
- `aplicavel: false` + valores zerados é o jeito de dizer "este imposto não se aplica": os blocos seguintes e o
  totalizador ignoram tributos com `aplicavel: false`.

## 3. Bloco Fórmula (`logic.expressao`)

Conta simples sem programar. Avaliador próprio, **sem `eval`**, em aritmética decimal.

**Entradas** (todas opcionais): `a`, `b`, `c` (decimais; sem ligação valem `0`) e `item`. Com o `item` ligado,
ficam disponíveis também: `vProd`, `vFrete`, `vSeg`, `vOutro`, `vDesc`, `vOperacao`
(= `vProd + vFrete + vSeg + vOutro − vDesc`), `quantidade`, `valorUnitario`.

**Parâmetros:** `expressao` (padrão `a * b / 100`) e `casas` (0 a 10, padrão 2). **Saída:** `resultado` (decimal,
arredondado em `casas`).

**Sintaxe**

| Elemento | Exemplos |
|---|---|
| números | `100`, `0.015` (sem notação científica) |
| operadores | `+ - * /` e `-` / `+` unários; parênteses `( )` |
| funções | `min(a, b)`, `max(a, b, c)`, `abs(x)`, `round(x, casas)`, `pct(base, percentual)` |
| variáveis | `a`, `b`, `c` e as do item listadas acima |

Não existem comparações, `if`/ternário, potência nem variáveis próprias. Para lógica condicional use o bloco
*Se / senão*; para o resto, o bloco de código.

**Exemplos**

```
a * (1 - b / 100)                     reduz "a" em b%
round(a * (1 - b / 100), 2)           idem, arredondando
pct(vOperacao, 1.5)                   1,5% do valor da operação (com o item ligado)
max(pct(vOperacao, 1.5), 20)          1,5% com mínimo de 20
vProd - vDesc + a                     soma uma entrada
```

**Erros** (código `EXPRESSAO_INVALIDA`, mensagem em português): variável ou função desconhecida, parênteses sem
fechar, caractere inválido, divisão por zero.

## 4. Bloco Se / senão (`logic.condicao`)

Parâmetros: `caminho` (caminho dentro da entrada, com pontos; vazio = o próprio valor), `operador` e `valor`.
Operadores: `igual`, `diferente` (comparam como texto), `maior`, `menor`, `maiorIgual`, `menorIgual` (comparam como
número), `contem` (texto ou lista), `em` (o valor está na lista; aceita lista JSON ou texto separado por vírgula).
A entrada é repassada à saída `Verdadeiro` ou `Falso`; a outra fica inativa (veja
[Guia de fluxos §4](GUIA-FLUXOS.md#4-ramificar-o-fluxo-se--senão)).

## 5. Código JavaScript

Usado no bloco **Código JavaScript** e nos **overrides com código**. Roda isolado: 1 segundo, 32 MB, sem rede,
sem arquivos, sem `process` nem `require`. (`console.log` existe, mas **não imprime em lugar nenhum**: para depurar,
use o painel de teste do override e o trace.)

### Contrato

```js
function calcular({ inputs, params, D, tabela }) {
  // inputs  → as entradas do bloco (já validadas e normalizadas)
  // params  → os parâmetros do bloco (com os padrões aplicados; no override, já mesclados com os do override)
  // D(x)    → cria um decimal exato (Decimal.js)
  // tabela(nome, chaves) → linha da tabela de referência vigente na data de emissão, ou null
  return { /* uma chave por porta de saída */ };
}
```

- Defina **uma função chamada `calcular`**, síncrona. Com `async`/Promise o retorno vira `{}` e a execução falha
  com `SAIDA_AUSENTE`.
- Devolva um objeto com **uma chave por porta de saída** (`id` da porta). Em override, as chaves são as saídas do
  bloco substituído (ex.: `tax.icms` devolve `{ icms: {...} }`).
- Valores decimais **como string** (`valor.toFixed(2)`). Objetos `Decimal` também serializam como string, mas
  prefira `toFixed`.
- A saída passa pela validação de tipo da porta: faltou uma porta obrigatória → `SAIDA_AUSENTE`; um `tributo` sem
  `valor` → `SAIDA_INVALIDA`.

### Decimal (`D`) — métodos úteis

`plus`, `minus`, `times`, `div`, `abs`, `neg`, `floor`, `ceil`, `pow`, `toDecimalPlaces(n)`, `toFixed(n)`,
`toString()`, comparações `eq`, `gt`, `gte`, `lt`, `lte`, `cmp`, e `isZero()`, `isNegative()`. Arredonde com
`toDecimalPlaces(2)` (padrão *half-up*) antes de devolver.

```js
function calcular({ inputs, params, D, tabela }) {
  const it = inputs.item;
  const base = D(it.vProd).plus(it.vFrete).plus(it.vSeg).plus(it.vOutro).minus(it.vDesc);
  const row = tabela('icms_interna', { uf: inputs.contexto.operacao.ufDestino });   // { aliquota: "18" } ou null
  const aliq = D(row ? row.aliquota : 0);
  const valor = base.times(aliq).div(100).toDecimalPlaces(2);
  return { icms: { base: base.toFixed(2), aliquota: aliq.toString(), valor: valor.toFixed(2), aplicavel: true } };
}
```

### Códigos de erro do sandbox

| Código | Causa |
|---|---|
| `CODIGO_TIMEOUT` | passou de 1 s (ex.: laço infinito) |
| `CODIGO_MEMORIA` | passou de 32 MB |
| `CODIGO_ERRO` | erro de sintaxe, exceção lançada, acesso a algo proibido (`process is not defined`), falta da função `calcular`, retorno que não é objeto |
| `SAIDA_AUSENTE` / `SAIDA_INVALIDA` | saída não respeita o contrato do bloco |
| `SEM_RUNNER` | não há executor de código configurado (só ocorre fora da API) |

O limite de tamanho do código de um override é de 50 KB. A mensagem de erro aparece no teste do override e no trace
da execução.

## 6. Tabelas de referência

`tabela(nome, chaves)` (no código) e `ctx.tables.lookup(nome, chaves, data)` (no bloco nativo) usam a mesma regra:
só linhas **vigentes** na data; `"*"` casa com qualquer valor; a chave `ncm` casa por **prefixo** (a mais longa
vence); a linha **da empresa** vence a global; no empate, a de `validFrom` mais recente. Tabelas existentes:

| Tabela | Chaves | Valor |
|---|---|---|
| `icms_interna` | `uf` | `aliquota` |
| `fcp` | `uf` | `aliquota` |
| `ibs_cbs_aliquotas` | `tributo` = `CBS` \| `IBS_UF` \| `IBS_MUN` | `aliquota` |
| `transicao_icms` | (nenhuma) | `fator` (0,1 = reduz 10%) |
| `imposto_seletivo` | `ncm` | `aliquota` |
| `tipi` | `ncm` | `aliquota` (IPI) |
| `mva_st` | `ncm`, `uf` | `mva` |
| `simples_anexos` | `anexo`, `faixa` | `ate`, `aliquota`, `deduzir`, `percIcms` |

## 7. Contas fiscais implementadas

Notação: `vOp` = valor da operação = `vProd + vFrete + vSeg + vOutro − vDesc`. Alíquotas vêm das tabelas acima
(valores de referência); quase todos os blocos permitem fixar a alíquota/parâmetro no próprio nó.

| Bloco | Conta |
|---|---|
| **IPI** | `base = vOp` · `vIPI = base × pIPI` (TIPI pelo NCM; padrão 0). Simples e CST 51–55: zero. |
| **ICMS** | `base = (vOp [+ vIPI]) × (1 − pRedBC/100)` · `vICMS = base × pICMS`. O IPI entra na base quando o destinatário é consumidor final (`ipiNaBase`: `auto`/`sim`/`nao`). Alíquota: interna da UF de origem, ou **interestadual**: 4% (origem importada 1/2/3/8), 7% (Sul/Sudeste exceto ES → N/NE/CO/ES), 12% (demais). Simples e CST 30/40/41/50/60: zero. |
| **ICMS-ST** | `MVAaj = [(1+MVA)(1−ALQinter)/(1−ALQintra)] − 1` (só interestadual) · `BCST = (vOp + vIPI) × (1+MVAaj) × (1 − pRedBCST)` · `vST = BCST × ALQintra − vICMSprópio` (nunca negativo). MVA pela tabela (NCM + UF destino) ou parâmetro; sem MVA = não aplica. |
| **DIFAL** | só interestadual **e** consumidor final. Base única: `vBC × (ALQintra − ALQinter)`. Base dupla: `BCdest = (vBC − vICMS)/(1 − ALQintra)`; `vDIFAL = BCdest × ALQintra − vICMS`. 100% para a UF de destino. |
| **FCP** | `vFCP = base × pFCP` (tabela por UF). `tipo`: `proprio` (base do ICMS, UF origem), `st` (base do ICMS-ST), `ufDestino` (base do DIFAL). |
| **PIS / COFINS** | `base = vOp − vICMS` (exclusão do ICMS; parâmetro `excluirIcmsDaBase`). Presumido (cumulativo): 0,65% / 3%. Real (não cumulativo): 1,65% / 7,6%. Simples: zero (CST 49). |
| **Simples — alíquota efetiva** | `(RBT12 × Aliq − PD) / RBT12` pela faixa do anexo da RBT12; devolve também a parcela de ICMS (`efetiva × %ICMS da faixa`). |
| **Simples — ICMS** | CSOSN 101/201: `vCredICMSSN = vOp × pCredSN` (parcela de ICMS da efetiva). Outros CSOSN: sem destaque. |
| **CBS / IBS** | `base = vOp − vPIS − vCOFINS − vICMS − vDIFAL − vFCP + vIS` · `pEfet = p × (1 − pRedAliq/100)` · `valor = base × pEfet`. IBS = parte estadual + municipal. Alíquotas pela tabela com vigência (2026: CBS 0,9%, IBS 0,1%). Simples fica zerado por padrão (`calcularParaSimples`). |
| **Imposto Seletivo** | `vIS = vOp × pIS` (tabela por NCM; sem linha = zero). |
| **Transição do ICMS** | `pICMS ajustada = pICMS × (1 − fator do ano)` (2029: 0,1 … 2032: 0,4; 2033: 1). Antes de 2029 não altera. |
| **Totalizar** | soma dos itens nos grupos ICMSTot/IBSCBSTot · `vNF = vProd − vDesc + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol`. ICMS, PIS, COFINS e IBS/CBS **não** somam ao `vNF`. |
| **Parcelas** | condição `30/60/90`: `parcela = ⌊vNF/n⌋` em centavos; a 1ª recebe o resíduo. Vencimento = emissão + dias (ou, se informado, `primeiroVencimento` + diferenças). |
| **Chave de acesso** | `cUF + AAMM + CNPJ + mod + série + nNF + tpEmis + cNF + cDV`; DV módulo 11 (pesos 2–9); no CNPJ alfanumérico o valor do caractere é `ASCII − 48`. |
| **Boleto** | código de barras de 44 posições (DV módulo 11), linha digitável (DVs módulo 10); fator de vencimento na nova base (22/02/2025 = 1000). |

### Conferência manual (caso usado nos testes)

Item de R$ 1.000,00 + frete R$ 50,00, SP → SP, Lucro Presumido, 2026:

```
ICMS    1.050,00 × 18%            = 189,00
PIS     (1.050 − 189) × 0,65%     =   5,60      (861,00 × 0,0065 = 5,5965)
COFINS  861,00 × 3%               =  25,83
CBS     (1.050 − 189 − 5,60 − 25,83) = 829,57 × 0,9% = 7,47
IBS     829,57 × 0,1%             =   0,83
vNF     1.000 + 50                = 1.050,00
```
