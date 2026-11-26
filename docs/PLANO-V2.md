# PainelAgentes v2 — plano

Reescrita do painel com estas decisões: **o serviço conduz a esteira** (o orquestrador passa a ser um papel),
stack **TypeScript + React**, usage completo (tokens/custo, qualidade e limites de assinatura) e **banco novo
do zero**, sem importar o v1.

## 1. Conceitos

| Conceito | O que é |
|---|---|
| **Provedor** | Um CLI de agente: `claude`, `cursor-agent`, `agy` (Antigravity) e `codex`. Só fica **habilitado** quando o caminho do executável é válido (detecção automática + campo manual) e `--version` responde. |
| **Adaptador** | Código por provedor que sabe montar o comando (prompt, modelo, esforço, modo leitura/escrita, retomar sessão, JSON schema) e interpretar o stream (eventos, sessão, resultado, saída estruturada, usage). |
| **Modelo** | Provedor + id do modelo + parâmetros (ex.: `cursor` / `cursor-grok-4.6-high`). Tem **família** (para a regra de revisão cruzada), **atributos declarados** (custo relativo, velocidade, qualidade, contexto, tags livres como "regra de negócio") e **métricas medidas** (vindas do histórico). |
| **Papel** | Orquestrador, executor, revisor, crítico, testador ou outro criado pelo usuário. Cada papel diz quais modelos podem ocupá-lo e em que modo (leitura ou escrita). |
| **Critérios de escolha** | Por projeto: que métricas o orquestrador usa para escolher o modelo de cada tarefa, com pesos (ex.: qualidade 0,5, custo 0,3, velocidade 0,2) e **regras rígidas** (ex.: "revisor de outra família que o executor", "tarefa trivial → modelo rápido"). |
| **Esteira** | Por projeto e versionada: a sequência de etapas que um problema percorre. Um problema roda sempre na versão da esteira com que começou. |
| **Fila** | Jobs que o motor executa, com limite de concorrência por provedor e por projeto e trava por árvore de trabalho. |

## 2. Esteira configurável

Cada etapa tem:
- **tipo**: `planejar`, `criticar_plano`, `aprovacao_humana`, `executar`, `revisar`, `comando`
  (testes, lint, build), `commit` ou `prompt_livre` (etapa nova que você define);
- **escopo**: uma vez por problema ou uma vez por tarefa;
- **quem**: modelo fixo, ou "escolhido pelo orquestrador" segundo os critérios do projeto;
- **modo**: leitura (revisores e críticos sempre) ou escrita;
- **prompt**: modelo com variáveis (`{{problema}}`, `{{tarefa}}`, `{{diff}}`, `{{parecer_anterior}}` …);
- **condição de saída**: `aprovado` no JSON, código de saída 0, aprovação humana;
- **em caso de falha**: voltar para a etapa X retomando a sessão, máximo de N tentativas, trocar de modelo
  na tentativa N (ex.: high → xhigh) e, por fim, bloquear e avisar.

**Modelo padrão** (equivalente ao fluxo de hoje):
`planejar → [criticar_plano] → aprovacao_humana → por tarefa: executar → comando(testes) → revisar → commit`.
Acrescentar uma etapa (ex.: "QA de segurança" depois da revisão) é arrastar um bloco no editor da esteira.

**Conversa com o orquestrador:** o problema nasce na interface (descrição). A etapa `planejar` pode devolver
perguntas: elas aparecem no painel, você responde e a etapa roda de novo na mesma sessão. O resultado é
estruturado (problema, tarefas, dependências, modelo escolhido por tarefa **com justificativa**). O motor
confere as regras rígidas antes de aceitar o plano.

## 3. Motor e fila

- Jobs persistidos no SQLite (sobrevivem a reinício). O motor retoma o que estava em andamento.
- Concorrência configurável: global, por provedor e por projeto.
- Escrita: um executor por árvore de trabalho. Opção por projeto: **git worktree por tarefa**, o que permite
  tarefas paralelas sem dependência entre elas, com merge na etapa `commit`.
- Cancelar, pausar e reenfileirar pela interface; o processo do CLI é encerrado com a árvore de filhos.
- Atualização ao vivo na interface via SSE.

## 4. Usage e métricas

**Tokens e custo (por run):** entrada, saída, cache de leitura e escrita, raciocínio, duração, número de
turnos, custo informado pelo CLI ou estimado por uma tabela de preços editável. Cursor e `agy` já trazem
`usage` no stream (ver `amostras/`); o Claude traz `usage` e `total_cost_usd`; o Codex traz `usage` no
`turn.completed` do `exec --json`.

**Qualidade (por modelo, papel e tipo de tarefa):** aprovação na 1ª tentativa, média de tentativas,
problemas apontados por severidade, **precisão do revisor** (quantos pontos o orquestrador confirmou ou
descartou: cada ponto do parecer é gravado com essa decisão), tempo até concluir, linhas alteradas e custo
por tarefa e por problema. Essas métricas medidas alimentam os critérios de escolha.

**Limites da assinatura (melhor esforço):** cada adaptador declara se consegue ler a cota (janela de 5 h,
semanal, % usado) e com que confiabilidade. Onde o CLI expõe (ex.: `rate_limits` nos eventos do Codex), o
painel guarda snapshots. Onde não expõe, mostra só o consumo medido. O motor pode evitar um provedor perto
do limite.

## 5. Dados (esquema novo)

Tudo em SQLite (`node:sqlite`), migrações por `PRAGMA user_version`, dados em `~/.agentes/`.

- Configuração: `provedores`, `modelos`, `precos`, `papeis`, `projetos`, `criterios`, `esteiras`,
  `esteira_versoes` (definição em JSON).
- Processo: `problemas`, `problema_versoes`, `tarefas`, `etapas_execucao` (instância de etapa por
  problema ou tarefa, com status e tentativa), `jobs`, `interacoes` (perguntas e respostas, aprovações
  humanas), `decisoes` (modelo escolhido + justificativa + pontuação de cada candidato).
- Execução: `runs` (comando, cwd, prompt, sessão, início e fim, saída, usage completo, custo, arquivos
  e linhas alterados), `eventos` (normalizado + bruto), `stderr`, `pareceres`, `parecer_itens` (cada
  ponto, severidade e decisão do orquestrador), `resultados_comando` (testes).
- Usage: `limites_snapshots`.

Os markdowns `PROBLEMA.md`/`TAREFAS.md` deixam de ser a fonte de verdade: o painel exporta para a pasta
`problemas/<id>/` do projeto, para ficar legível no git.

## 6. Stack e estrutura

- Node 22 (≥ 22.13, `node:sqlite` sem flag), TypeScript, servidor **Hono**, validação **zod**
  compartilhada entre servidor e interface.
- Interface **React + Vite + TanStack Query**, servida pelo próprio serviço depois do build.
- Testes com `node --test` (via `tsx`) e CLIs falsos que reproduzem as `amostras/`.
- MCP mantido (stdio, cliente da API) para uma sessão de agente consultar e criar problemas.
- Comando `painel`: `servidor`, `init` (marca o projeto com `.agentes/projeto.json`), `doctor`.
  O instalador (detectar Node e CLIs, registrar o MCP, criar o `painel.cmd`) entra na fase 7.

```
src/
  shared/      tipos e schemas zod
  server/      api/, db/ (migrações), motor/ (fila, esteira), adaptadores/ (claude, cursor, agy, codex)
  web/         React
  cli/         painel, mcp
testes/
```

## 7. Fases

Cada fase termina usável e testada.

| Fase | Entrega |
|---|---|
| **F0 — Esqueleto** | Projeto TS, servidor + banco + migrações, casca da interface, comando `painel servidor`. |
| **F1 — Provedores e modelos** | Detecção dos 4 CLIs, tela de configuração (caminho, habilitado, versão), catálogo de modelos com família e atributos, tabela de preços. |
| **F2 — Runs e usage** | Adaptadores rodando um agente avulso, eventos ao vivo, captura de usage, telas de run e de usage por modelo. |
| **F3 — Esteira** | Editor de esteira por projeto, versões, modelo padrão. |
| **F4 — Motor e fila** | Jobs, concorrência, retentativas, aprovação humana, cancelamento. Feito: tarefas do mesmo problema rodam uma por vez; worktree por tarefa (paralelismo) ficou para depois. |
| **F5 — Orquestrador e critérios** | Etapa de planejamento estruturada, perguntas pela interface, critérios com pesos, regras rígidas, registro de decisões. |
| **F6 — Qualidade e limites** | Métricas de qualidade, precisão do revisor, snapshots de cota, uso das métricas na escolha. Feito: a precisão vem das suas marcações (procede / não procede); cota do Claude pelos runs e do Codex pelas sessões locais; Cursor e Antigravity não informam cota. |
| **F7 — Instalação** | Instalador, `doctor`, MCP registrado, `painel init` em qualquer projeto. |

## 8. Riscos e pendências

- Nesta máquina só o `claude` está instalado; `cursor-agent`, `agy` e `codex` serão testados com CLIs
  falsos baseados nas amostras e validados na máquina que os tem. O adaptador do Codex não tem amostra
  real ainda.
- Leitura de cota depende de dados não oficiais de cada CLI e pode quebrar com atualizações.
- Worktree por tarefa muda o fluxo de commit; o padrão continua sendo uma tarefa de escrita por vez.
- O v1 continua no `master` até a v2 cobrir o fluxo atual (fim da F5).
