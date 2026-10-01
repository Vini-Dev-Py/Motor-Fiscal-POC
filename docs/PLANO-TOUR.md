# Tour guiado nas telas do Motor Fiscal (apps/web)

> **Status:** planejado, ainda não implementado (2026-09-30).

## Contexto
Quem entra para testar a POC não sabe o que cada tela faz nem como usar ferramentas como o editor de fluxos. Vamos adicionar um tour guiado por tela que:
- abre sozinho na **primeira visita a cada tela**;
- pode ser reaberto pelo botão **"Ver tour"**, um ícone `?` no header ao lado do botão de tema;
- destaca **só os elementos visíveis da tela**, sem abrir diálogos nem abas. O que existe dentro dos diálogos é explicado no texto do passo.

## Biblioteca: `react-joyride` v3 (3.2.0)
- A v3 aceita React 16.8 até 19 (`peerDependencies: react 16.8 - 19`). A v2 não funcionava com React 19, e a v3 resolve isso.
- Tem foco preso no tooltip, navegação por teclado e ARIA. Aceita um **tooltip customizado**, o que deixa o visual 100% no nosso design system com Tailwind.
- O driver.js foi considerado e descartado. Ele não é React, e estilizá-lo com nossos tokens seria mais trabalhoso.
- Instalação: `npm i react-joyride -w apps/web`. Antes de codar, confirmo a API da v3 no guia de migração (https://react-joyride.com/docs/migration): nomes de props, callback/eventos e `tooltipComponent`.

## Estrutura

Nova feature em `apps/web/src/features/tour/`:

| Arquivo | Responsabilidade |
|---|---|
| `tour-provider.tsx` | `TourContext` com uma única instância de `<Joyride>`. Expõe `registerTour(id, steps, ready)`, `startTour()` e `hasTour`. Faz a persistência e o auto-start. |
| `use-page-tour.ts` | Hook que cada página chama: `usePageTour('fluxos', { ready: !isLoading })`. Registra o tour no mount e remove no unmount. |
| `tours.ts` | Textos e alvos de todos os tours (pt-BR), num só lugar e fáceis de editar. Formato: `Record<TourId, { version: number; steps: Step[] }>`. |
| `tour-tooltip.tsx` | Tooltip customizado. |
| `storage.ts` | `getSeen(id)` e `markSeen(id, version)`, com `try/catch` como em `shell.tsx` e `lib/tenant.tsx`. |

### Comportamento
- **Persistência:** a chave é `motor-fiscal:tour:<id>` e o valor é a `version` vista, seguindo o padrão `motor-fiscal:*`. Se um tour mudar, basta subir a `version` para ele voltar a aparecer.
- **Auto-start:** acontece quando `ready === true`, o tour não foi visto na versão atual e já passou a animação de rota de 180ms (espero cerca de 300ms). "Concluir" e "Pular" marcam o tour como visto.
- **Alvos ausentes:** antes de iniciar, removo os passos cujo `target` não está no DOM, como o primeiro card numa lista vazia. Assim o tour não trava.
- **Tour "shell" de boas-vindas:** na primeira vez que qualquer tour roda, entram antes os passos globais: menu lateral, seletor de Empresa, tema e botão "Ver tour". Isso acontece uma vez só, controlado pela chave `motor-fiscal:tour:shell`.
- **Troca de rota durante o tour:** o tour é encerrado.
- **Botão "Ver tour":** fica em `components/shell.tsx`, no cluster da direita (~L109-122), junto do `ThemeToggle`. Usa o mesmo estilo de botão `size-8`, o ícone `CircleHelp` do lucide e o `Tooltip` de `components/ui.tsx` com o texto "Ver tour desta tela". Fica desabilitado se a rota não tiver tour.
- **Onde fica o provider:** em `src/main.tsx`, dentro do `BrowserRouter`, porque precisa de `useLocation`.

### Alvos
Uso atributos `data-tour="<pagina>-<elemento>"` e o seletor `[data-tour="..."]`. Hoje não existe nenhum id estável no código.
- `Button`, `Input`, `Textarea` e `Card` já repassam props, então o atributo vai direto neles.
- `PageHeader` (`components/ui.tsx`) precisa receber `...rest` no elemento raiz, ou ganhar uma prop `actionsProps`.
- `Select`, `Tabs`, `Palette` e `Inspector` recebem um `<div data-tour>` em volta, ou o atributo no `aside` raiz.
- No editor também uso classes do React Flow: `.react-flow__controls` e `.react-flow__minimap`.

## Estilo
O tooltip customizado (`tour-tooltip.tsx`) usa só os tokens de `src/index.css`, então acompanha o modo escuro sem esforço extra.
- **Cartão:** `bg-surface border border-border rounded-xl shadow-lg`, largura de cerca de 340px e texto `text-[13.5px]`.
- **Cabeçalho:** título em `font-semibold`, com o contador "2 de 7" em `text-faint` à direita.
- **Corpo:** pode ter `ReactNode`, como `<kbd>` para atalhos (Ctrl+S) e `<code>` em mono.
- **Rodapé:**
  - à esquerda, "Pular tour" como link `text-muted`;
  - à direita, os botões `Button` "Voltar" (`ghost`) e "Próximo"/"Concluir" (`primary` com `bg-accent`);
  - pontinhos de progresso em `bg-accent` / `bg-border-strong`.
- **Overlay e spotlight:**
  - overlay `rgba(15,17,23,.55)` e spotlight com raio 12px e padding 6px;
  - `zIndex: 100`, acima de Dialog (50), Select (70) e Tooltip (80);
  - sem beacon pulsante, com `disableBeacon` e passo inicial direto.
- **Animação:** fade/scale curto com `motion`, que já é dependência, respeitando `prefers-reduced-motion`.
- **Locale pt-BR:** Voltar, Próximo, Concluir, Pular, Fechar.

## Conteúdo dos tours (rascunho)
| Tour | Passos |
|---|---|
| **shell** (1ª vez) | menu de telas · seletor de Empresa (`X-Tenant-Id`) · tema · botão "Ver tour" |
| **fluxos** (`pages/flows.tsx`) | o que é um fluxo · "Novo fluxo" · seção Fluxos de pedido × Subfluxos · card (versão, Duplicar, Excluir; clique para editar) |
| **editor** (`features/editor/editor-page.tsx`, `palette.tsx`, `inspector.tsx`) | nome do fluxo · paleta (buscar e arrastar blocos) · canvas (conectar portas tipadas) · controles e minimapa · inspector (configurar o bloco selecionado, aba Resultado) · Organizar · Validar · Testar · Salvar (Ctrl+S) · Publicar |
| **webhooks** | botão de criar · card (URL e copiar, ativar/desativar, editar) · texto citando as abas Schema / Resposta / Testar |
| **overrides** | botão de criar · card de override · texto citando a aba Testar (padrão × override) |
| **execucoes** | filtros (webhook, status) · Atualizar · tabela (clique para ver o passo a passo, payload, resposta e XML) |
| **blocos** | busca · categorias · card (clique para ver detalhes) |
| **tabelas** | lista de tabelas · grade de linhas · "Nova linha" |
| **empresas** | card da empresa · "usar esta empresa" · editar dados fiscais e de boleto |

No editor, o "+" da paleta fica com `opacity-0` até o hover. Por isso o passo aponta para o `aside` inteiro da paleta, e não para o botão.

## Arquivos que mudam
- **Novos:** `apps/web/src/features/tour/*` (5 arquivos acima).
- **Infra:** `apps/web/package.json` (+ `react-joyride`), `src/main.tsx` (provider), `src/components/shell.tsx` (botão e alvos do shell), `src/components/ui.tsx` (`PageHeader` repassando props).
- **Páginas** (`data-tour` + `usePageTour`): `pages/flows.tsx`, `webhooks.tsx`, `overrides.tsx`, `executions.tsx`, `blocks.tsx`, `tables.tsx`, `tenants.tsx`, `features/editor/editor-page.tsx`, `palette.tsx`, `inspector.tsx`.

## Verificação
1. `npm run build -w apps/web` (tsc + vite) sem erros.
2. Subir o app (`npm run dev`) e, no Chrome, limpar as chaves `motor-fiscal:tour:*` do localStorage.
3. Verificar nas telas:
   - **Fluxos:** o tour shell e depois o de fluxos abrem sozinhos; ao recarregar, não aparecem de novo; "Ver tour" reabre.
   - **Demais telas e editor:** cada uma abre o próprio tour na primeira visita.
4. Verificar casos de borda e estilo:
   - **Lista vazia:** passos sem alvo são pulados sem travar.
   - **Modo escuro:** o tooltip segue os tokens.
   - **Teclado:** Esc fecha e as setas navegam.
   - **Troca de rota no meio do tour:** o tour fecha.
