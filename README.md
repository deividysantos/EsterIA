# Painel de agentes

Serviço local que conduz uma **esteira de desenvolvimento com agentes de código**: um orquestrador planeja,
executores implementam, revisores de outra família revisam, testes e commit fecham cada tarefa. Tudo
configurável pela interface web, por projeto, e medido (tokens, custo, cota, qualidade).

CLIs suportados: **Claude Code** (`claude`), **Cursor** (`cursor-agent`), **Antigravity** (`agy`) e **Codex** (`codex`).
Um CLI só entra na estrutura quando o caminho dele é válido e o `--version` responde.

## Instalar (uma vez por máquina)

Precisa de Node **22.13+** e git.

```powershell
git clone <este repositório> C:\Ferramentas\PainelAgentes
cd C:\Ferramentas\PainelAgentes
npm ci
npm run build
node bin\painel.mjs instalar --adicionar-ao-path
```

O `instalar`:
- confere Node e build e cria o atalho `painel` em `~/.painel-agentes/bin` (com `--adicionar-ao-path`, põe essa pasta no PATH do usuário);
- detecta os CLIs instalados;
- registra o servidor MCP `painel-agentes` no Claude Code, no escopo do usuário (`--sem-mcp` pula).

Pode rodar de novo a qualquer momento (por exemplo, depois de mover a pasta): ele atualiza o atalho e o registro.

Se o Node do PATH for antigo, use um Node 22 portátil: extraia o zip oficial de nodejs.org em `runtime\` e rode
`runtime\node.exe bin\painel.mjs instalar`. O atalho passa a usar esse Node.

## Subir o serviço

```powershell
painel servidor
```

Abre em http://127.0.0.1:4710. Um serviço atende todos os projetos. Na primeira vez:

1. **Provedores**: confira os CLIs detectados (ou informe o caminho manualmente).
2. **Modelos**: ajuste o catálogo (família, notas de custo/velocidade/qualidade, preços, tags).

## Usar em um projeto

Na raiz do projeto:

```powershell
painel init
```

Cadastra o projeto, cria a esteira a partir do modelo padrão, grava `.agentes/projeto.json` (pode ir para o git:
não tem caminhos da máquina) e acrescenta um bloco de instruções ao `CLAUDE.md`. Opções: `--id`, `--nome`,
`--esteira padrao|nenhuma|copiar:<id>`, `--sem-claude-md`. Rodar de novo não duplica nada.

Depois:
- **Esteiras** → ajuste as etapas do projeto (planejar, criticar, aprovação humana, executar, revisar, comandos,
  commit, etapas livres), quem roda cada uma, revisão cruzada e o que fazer em caso de falha.
- **Esteiras → Critérios de escolha** → pesos das métricas que o orquestrador usa para escolher modelos e regras rígidas.
- **Problemas → Novo problema** → descreva o trabalho; a esteira começa na hora. Perguntas do orquestrador,
  aprovações e bloqueios aparecem no painel.

De dentro de uma sessão do Claude Code no projeto, o MCP faz o mesmo: `criar_problema`, `ver_problema`,
`decidir`, `estado_fila` etc.

## Comandos

| Comando | O que faz |
|---|---|
| `painel instalar` | Configuração da máquina (atalho, CLIs, MCP). |
| `painel servidor` | Sobe o serviço (interface + motor da esteira). |
| `painel init [pasta]` | Liga um projeto ao painel. |
| `painel doctor` | Mostra o que falta (serviço, CLIs, MCP, projeto da pasta) e como resolver. |
| `painel mcp` | Servidor MCP por stdio (chamado pelo Claude Code). |

Variáveis: `PAINEL_PORTA` (4710), `PAINEL_URL`, `PAINEL_DADOS_DIR` (`~/.painel-agentes`), `PAINEL_BANCO`.

## Como funciona

- **Esteira por projeto, versionada.** Cada problema roda na versão com que começou.
- **O serviço conduz.** O motor decide o próximo passo, respeita dependências entre tarefas, retoma a sessão do
  mesmo agente com o retorno da revisão, volta etapas em caso de falha e para chamando você no limite de tentativas.
- **Escolha de modelo.** Fixa na etapa ou pelo orquestrador entre candidatos, com pontuação por critérios do
  projeto e revisão cruzada por família. Cada decisão fica registrada com todos os candidatos.
- **Fila.** Limites de execução global e por provedor; etapas de escrita no mesmo projeto não se sobrepõem;
  provedor com cota acima do limite não recebe etapas novas.
- **Medição.** Tokens e custo por run, cota das assinaturas (Claude Code pelos runs, Codex pelas sessões
  locais), aprovação na primeira revisão, retrabalho e precisão dos revisores (a partir das suas marcações).

## Limitações conhecidas

- Cursor e Codex ainda não foram validados com o CLI real (só com amostras e CLIs falsos).
- Tarefas de um mesmo problema rodam uma por vez (paralelismo com git worktree ainda não existe).
- Leitura de cota depende de dados não oficiais de cada CLI; Cursor e Antigravity não informam cota.

## Desenvolvimento

```powershell
npm run typecheck
npm test
npm run dev       # API com recarga (porta 4710)
npm run dev:web   # interface com Vite na 5173
```

Detalhes de arquitetura e fases em `docs/PLANO-V2.md`.
