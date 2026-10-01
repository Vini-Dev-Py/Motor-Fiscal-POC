# Guia: montar um fluxo de cálculo de imposto

Este guia mostra, passo a passo, como montar um fluxo na interface — do mais simples (só ICMS e PIS/COFINS) até
ramificações por regime, subfluxos, publicação e webhook. Os conceitos técnicos estão em
[Arquitetura](ARQUITETURA.md); para criar um imposto que não existe, veja [Novo imposto](NOVO-IMPOSTO.md).

## 1. Conceitos em 2 minutos

- **Bloco**: uma etapa (calcular ICMS, totalizar a nota, autorizar na SEFAZ...). Tem **entradas** (lado esquerdo),
  **saídas** (lado direito) e **parâmetros** (painel à direita).
- **Porta**: cada entrada/saída tem um **tipo** (cor do ponto). Só se ligam tipos compatíveis. Ponto com borda
  tracejada = entrada opcional; asterisco vermelho = obrigatória.
- **Fluxo de pedido**: começa no bloco *Webhook recebido* e é o que um webhook executa.
- **Subfluxo**: um fluxo que vira um **bloco reutilizável**. O padrão é o subfluxo *Impostos do item*, executado
  uma vez por item do pedido.
- **Publicar**: congela uma versão do fluxo. O webhook sempre usa a **última versão publicada**.

Dados que circulam entre os blocos:

| Tipo | Conteúdo |
|---|---|
| `pedido` / `lista` de itens | pedido normalizado e seus itens (com `vProd`, `vFrete`, `vDesc`...) |
| `contexto` | empresa + operação (UF origem/destino, interestadual?, consumidor final?, data de emissão, CFOP) |
| `tributo` | `{ base, aliquota, valor, ... }` de um imposto |
| `totais` | somatórios da nota (ICMSTot, IBSCBSTot, `vNF`) |

## 2. Montando do zero: o fluxo mínimo

Objetivo: receber um pedido e devolver o total e os impostos (ICMS, PIS, COFINS), sem emitir nota.

### 2.1 Crie o subfluxo dos impostos do item

1. Menu **Fluxos → Novo fluxo**, tipo **Subfluxo (bloco reutilizável)**, nome `Impostos mínimos`.
   O editor já abre com os blocos **Entrada** (portas `item` e `contexto`) e **Saída**.
2. Da paleta, adicione **ICMS**, **PIS** e **COFINS** (arraste ou clique no `+`).
3. Ligue (arraste de uma bolinha de saída até uma de entrada):

   | De | Para |
   |---|---|
   | Entrada.`Item` | ICMS.`Item`, PIS.`Item`, COFINS.`Item` |
   | Entrada.`Contexto` | ICMS.`Contexto`, PIS.`Contexto`, COFINS.`Contexto` |
   | ICMS.`ICMS` | PIS.`ICMS`, COFINS.`ICMS` (a base do PIS/COFINS exclui o ICMS) |

4. Selecione o bloco **Saída** e, na aba *Configurar*, em **Portas de saída do subfluxo**: remova a porta
   `resultado` que já vem de exemplo e crie três com **+ Porta**, de tipo **Tributo** e ids `icms`, `pis`, `cofins`
   (novas portas nascem como tipo *Qualquer*; deixe *obrigatória* desligada). Ligue ICMS.`ICMS` → `icms`,
   PIS.`PIS` → `pis`, COFINS.`COFINS` → `cofins`.
5. **Validar** (se algo estiver errado, a lista aponta o bloco) e **Salvar** (ou `Ctrl+S`).

> O **id** de cada porta de saída é o nome que o `totalizar` e o template de resposta vão enxergar.
> O `nfe.totalizar` procura exatamente por `icms`, `icmsSt`, `difal`, `fcp`, `fcpSt`, `fcpUfDestino`, `ipi`,
> `pis`, `cofins`, `cbs`, `ibs` e `is` — use esses ids para que o total some os tributos.

### 2.2 Crie o fluxo de pedido

1. **Novo fluxo** → tipo **Fluxo de pedido**, nome `Pedido simples`. Já vem com *Webhook recebido*.
2. Adicione: **Normalizar pedido**, **Empresa emitente**, **Operação fiscal**, **Para cada item** (categoria
   *Fluxo*) e **Totalizar nota**.
3. Ligue:

   | De | Para |
   |---|---|
   | Webhook recebido.`Payload` | Normalizar pedido.`Payload` |
   | Normalizar pedido.`Pedido` | Operação fiscal.`Pedido` |
   | Empresa emitente.`Empresa` | Operação fiscal.`Empresa` |
   | Normalizar pedido.`Itens` | Para cada item.`Itens` |
   | Operação fiscal.`Contexto` | Para cada item.`Contexto` e Totalizar nota.`Contexto` |
   | Para cada item.`Resultados por item` | Totalizar nota.`Resultados por item` |

4. Selecione **Para cada item**, aba *Configurar* → **Subfluxo**: escolha `Impostos mínimos`.

### 2.3 Teste antes de publicar

Clique em **Testar**: o editor abre um payload de exemplo; **Executar** roda o *rascunho atual* sem gravar nada e
sem consumir a numeração da NF-e. Os blocos acendem em sequência (verde = executado, esmaecido = ignorado,
vermelho = erro). Clique num bloco → aba **Resultado** para ver entradas e saídas dele; **Ver passo a passo**
mostra a árvore completa, inclusive o subfluxo de cada item.

Resultado esperado com o payload de exemplo, na empresa *Vinícius Distribuidora* (SP→SP, Lucro Presumido, item
de R$ 1.000 + R$ 50 de frete):
`vNF 1050.00`, `vICMS 189.00`, `vPIS 5.60`, `vCOFINS 25.83`.

### 2.4 Publique e crie o webhook

1. **Publicar**. Se houver erro, a publicação é recusada e a lista aparece. Sucesso: "Versão N publicada".
2. Menu **Webhooks → Novo webhook**:
   - **Geral**: nome, `slug` (vira `/webhook/<slug>`), o fluxo `Pedido simples`, token opcional, campo de data de
     vigência (`dataEmissao`) e campo de idempotência (`id`).
   - **Schema do payload**: use **Usar schema de pedido padrão**, ou **Inferir de JSON de exemplo**, ou monte
     campo a campo (tipos, obrigatório, formatos CNPJ/CPF/NCM/CFOP/UF, mínimo/máximo, regex, listas).
   - **Resposta**: o template JSON. Para este fluxo:

     ```json
     {
       "pedido": "{{input.id}}",
       "total": "{{nodes.totalizarNota.totais.vNF}}",
       "icms": "{{nodes.totalizarNota.totais.vICMS}}",
       "impostosPorItem": "{{nodes.paraCadaItem.resultados}}"
     }
     ```

     Os ids dos nós (`totalizarNota`, `paraCadaItem`) aparecem no rodapé de cada bloco e no painel *Configurar*.
     A lista **Caminhos disponíveis** copia o token pronto com um clique.
   - **Testar**: dispara o webhook de verdade.
3. Salve e chame com `curl` (veja o [README](../README.md)).

## 3. Regras de ligação e como corrigir os erros mais comuns

| Mensagem | Causa | Correção |
|---|---|---|
| "a entrada X é obrigatória e não está conectada" | porta obrigatória sem aresta e sem valor padrão | ligue a porta, ou (em bloco de código/subfluxo) marque-a como opcional |
| "Tipos incompatíveis: A.x (tipo) → B.y (tipo)" | ligação entre tipos que não conversam | use o tipo certo; para qualquer dado use `Qualquer` (`any`) ou `Objeto` |
| "O fluxo precisa de um bloco *Webhook recebido*" | gatilho ausente (ou duplicado) | exatamente um por fluxo de pedido |
| "subfluxo ... não encontrado" / "selecione o subfluxo" | `Para cada item` ou `Subfluxo` sem subfluxo escolhido | escolha o subfluxo no painel |
| "O fluxo contém um ciclo" | um bloco depende dele mesmo | remova a ligação que volta |
| "parâmetros inválidos" | valor fora do esquema (ex.: `pRedBC` > 100) | corrija no painel *Configurar* |

O editor também **impede** na hora de arrastar: tipos incompatíveis, ligar um bloco a ele mesmo e ligações que
fechariam ciclo.

## 4. Ramificar o fluxo (se / senão)

O bloco **Se / senão** compara um valor e ativa **uma** de duas saídas. Os blocos ligados à saída inativa **não
executam** (aparecem esmaecidos no teste).

Exemplo (é o que o subfluxo padrão faz): separar Simples Nacional do regime normal.

1. Adicione **Se / senão**; ligue Entrada.`Contexto` → `Entrada` do bloco.
2. Parâmetros: `caminho` = `tenant.regime`, `operador` = `igual`, `valor` = `SIMPLES`.
3. Os blocos do Simples recebem o **Contexto** de `Verdadeiro`; os do regime normal, de `Falso`. (Eles
   também recebem o `Item` direto da Entrada.)
4. Na Saída, a porta `icms` pode receber **duas ligações** — uma de cada ramo. Vale a do ramo que executou.

Regras que fazem isso funcionar:

- Uma **entrada obrigatória** ligada só a um ramo inativo faz o bloco ser **ignorado** (não é erro).
- Uma entrada **opcional** nessa situação fica vazia e o bloco roda mesmo assim.
- Uma porta pode receber **várias ligações**; vale a primeira que estiver ativa e tiver valor.

Operadores do *Se / senão*: `igual`, `diferente`, `maior`, `menor`, `maiorIgual`, `menorIgual`, `contem`, `em`
(lista separada por vírgula). O `caminho` navega no objeto de entrada (`operacao.interestadual`,
`tenant.uf`...); vazio = o próprio valor.

## 5. Reaproveitar com subfluxos

- Qualquer fluxo do tipo **Subfluxo** aparece na paleta (categoria *Fluxo*) como um bloco com as portas definidas
  na sua **Entrada** e **Saída**. Use para encapsular "todos os impostos de um item" ou "regra especial do
  cliente X".
- Mudou as portas do subfluxo? No bloco que o usa, **Atualizar portas do subfluxo**.
- **Para cada item** executa o subfluxo uma vez por item e entrega `{ item, ...portas de saída }` por item. O
  subfluxo recebe `item`, `contexto` e `indice`.
- Ao publicar, os subfluxos são **copiados para dentro da versão**: editar um subfluxo depois **não** altera
  fluxos já publicados — republique o fluxo para levar a mudança.

## 6. Calcular um imposto "customizado" sem programar o motor

Três caminhos, do mais simples ao mais flexível (detalhes e exemplos em [Novo imposto](NOVO-IMPOSTO.md)):

1. **Fórmula**: bloco *Fórmula* (`a * b / 100`, `max(pct(a, b), 20)`...).
2. **Código JavaScript**: bloco com portas e código seus.
3. **Override da empresa**: troca parâmetros (`pRedBC: 50`) ou o código de um bloco existente, só para uma
   empresa e dentro de uma vigência — é o caminho para benefícios obtidos na justiça.

## 7. Override por empresa (benefício fiscal)

Menu **Overrides → Novo override** (vale para a empresa selecionada no topo):

1. Escolha o **bloco** (ex.: *ICMS*), dê um nome e informe a **vigência** e a **base legal** (nº do processo).
2. Só parâmetros: `{ "pRedBC": 50 }` (o bloco padrão roda com o valor trocado). Ou escreva **código** que
   substitui o bloco (o botão *Inserir modelo do bloco* gera o esqueleto com as entradas e saídas).
3. Salve e use a aba **Testar**: roda o **bloco padrão e o override com as mesmas entradas** e mostra as
   diferenças campo a campo. O teste ignora "ativo" e vigência — serve para validar antes de ligar.
4. Marque **Ativo**. Dentro da vigência (pela data de emissão do pedido), o override passa a valer em todos os
   fluxos da empresa que usam aquele bloco; o trace de cada execução mostra o override aplicado e a base legal.

## 8. Dicas

- **Ids dos nós** são gerados a partir do nome do bloco e usados nos templates (`nodes.<id>.<porta>`). Prefira
  decidir o nome do bloco **antes** de criá-lo; trocar o *nome exibido* depois não muda o id.
- **Organizar** (ícone de grade) reposiciona o grafo da esquerda para a direita.
- Itens do mesmo pedido são calculados **um por um**; um erro em qualquer item interrompe a execução e o trace
  mostra qual item e qual bloco falharam.
- **Rejeição da SEFAZ** (bloco *Autorizar na SEFAZ* com "falharSeRejeitada") encerra a execução como
  `REJEITADA` (HTTP 422) e os blocos seguintes — como o boleto — não rodam.
- Para ver a diferença entre **rascunho** e **publicado**: o botão *Testar* usa o rascunho; o webhook usa a
  última versão publicada.
