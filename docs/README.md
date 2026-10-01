# Documentação

| Documento | Para quê |
|---|---|
| [ARQUITETURA.md](ARQUITETURA.md) | Como o sistema funciona por dentro: pastas, módulos, contratos, algoritmo de execução, pipeline do webhook, banco, API, frontend, infraestrutura. |
| [GUIA-FLUXOS.md](GUIA-FLUXOS.md) | Passo a passo para **montar um fluxo** de cálculo na interface: fluxo mínimo, ramificações por regime, subfluxos, publicação, webhook e override. |
| [NOVO-IMPOSTO.md](NOVO-IMPOSTO.md) | Como **criar um imposto novo** ou mudar uma regra: tabela com vigência, override, fórmula/código no fluxo e bloco nativo em TypeScript (com exemplo completo). |
| [FORMULAS.md](FORMULAS.md) | Como **definir fórmulas**: convenções numéricas, bloco Fórmula, código JavaScript, formatos de dados (item, contexto, tributo) e as contas fiscais implementadas. |
| [TESTES.md](TESTES.md) | Como **testar**: pela interface, por `curl`, testes do motor, e2e da API, diagnóstico de erros e checklist. |
| [PLANO-POC.md](PLANO-POC.md) | Plano original da POC (decisões iniciais; veja o README para as diferenças da implementação). |

**Por onde começar**

- Quer entender o sistema → [ARQUITETURA](ARQUITETURA.md).
- Quer montar/ajustar um cálculo na tela → [GUIA-FLUXOS](GUIA-FLUXOS.md).
- Surgiu um imposto novo ou uma regra especial → [NOVO-IMPOSTO](NOVO-IMPOSTO.md) (a tabela no início ajuda a escolher o caminho).
- Vai escrever uma fórmula ou um código → [FORMULAS](FORMULAS.md).
- Mudou algo e quer ter certeza de que funciona → [TESTES](TESTES.md).

> As alíquotas e regras do seed são **de referência para a POC**; a validação fiscal é responsabilidade de quem
> responde pela área tributária.
