# EsterIA

Serviço local que conduz uma **esteira de desenvolvimento com agentes de código**: um orquestrador planeja,
executores implementam, revisores de outra família revisam, testes e commit fecham cada tarefa. Tudo
configurável pela interface web, por projeto, e medido (tokens, custo, cota, qualidade).

CLIs de agente suportados: **Claude Code** (`claude`), **Cursor** (`cursor-agent`), **Antigravity** (`agy`) e
**Codex** (`codex`). Um CLI só entra na estrutura quando o caminho dele é válido e o `--version` responde.

Plataforma: feito e testado no **Windows** (comandos abaixo em PowerShell). O código é Node puro e deve rodar
em Linux e macOS, mas lá não foi testado (veja [Linux e macOS](#linux-e-macos)).

---

## Instalação passo a passo

Escrito para ser seguido por uma pessoa ou por um agente (por exemplo, o Claude Code) do começo ao fim. Cada passo
diz o comando, o que esperar e o que fazer se der errado.

### Regras para o agente que estiver instalando

- **Pode fazer sozinho:** clonar, baixar o Node portátil oficial (nodejs.org, conferindo o SHA-256), `npm ci`,
  `npm run build`, `painel instalar --sem-mcp`, `painel doctor`, subir o serviço para testar.
- **Pergunte antes ao usuário:** adicionar ao PATH (`--adicionar-ao-path`), registrar o MCP no Claude Code
  (o `instalar` sem `--sem-mcp`), criar tarefa de início automático, liberar algo no firewall, `painel init` num
  projeto (ele grava arquivos e mexe no `CLAUDE.md` do projeto).
- **Só o usuário faz:** login nos CLIs de agente (passo 6) e qualquer coisa que peça senha ou conta.
- Pasta sugerida: `C:\Ferramentas\EsterIA`. Se o usuário pedir outra, troque nos comandos.
- Ao terminar, rode `painel doctor` e mostre o resultado ao usuário (passo 8).

### 1. Pré-requisitos

```powershell
git --version
```

Esperado: `git version 2.x`. Se não existir, peça ao usuário para instalar o Git for Windows (git-scm.com) e pare.

```powershell
node --version
```

Esperado: **v22.13 ou mais novo**. Se der erro ou for mais antigo, **não atualize o Node do sistema**: use o
Node portátil do passo 3. Anote qual caminho vai seguir.

### 2. Clonar

```powershell
git clone https://github.com/deividysantos/EsterIA.git C:\Ferramentas\EsterIA
```
```powershell
cd C:\Ferramentas\EsterIA
```

### 3. Node portátil (só se o passo 1 mostrou Node ausente ou abaixo de 22.13)

Baixa o zip oficial, confere o checksum e extrai em `runtime\` (pasta ignorada pelo git):

```powershell
$v = 'v22.23.1'; $zip = "node-$v-win-x64.zip"
Invoke-WebRequest "https://nodejs.org/dist/$v/$zip" -OutFile $zip
Invoke-WebRequest "https://nodejs.org/dist/$v/SHASUMS256.txt" -OutFile SHASUMS256.txt
$esperado = ((Select-String -Path SHASUMS256.txt -Pattern " $zip$").Line -split '\s+')[0]
$real = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($esperado -ne $real) { throw "Checksum não confere: $real" }
Expand-Archive $zip -DestinationPath runtime-tmp
Move-Item "runtime-tmp\node-$v-win-x64" runtime
Remove-Item runtime-tmp, $zip, SHASUMS256.txt
```

Depois, **em todo terminal** em que for rodar `npm` para este projeto, ponha esse Node na frente do PATH:

```powershell
$env:Path = "$PWD\runtime;$env:Path"; node --version
```

Esperado: `v22.23.1`. (O atalho `painel` criado no passo 5 já usa esse Node sozinho; isto vale só para `npm`.)

### 4. Dependências e build

```powershell
npm ci
```
```powershell
npm run build
```

Esperado: o build termina com `✓ built` e cria a pasta `dist\`. Se o `npm ci` falhar por rede, tente de novo;
se falhar por versão do Node, volte ao passo 3.

Opcional, para conferir que está tudo certo (demora cerca de 2 minutos):

```powershell
npm test
```

Esperado: `# fail 0`.

### 5. Instalar na máquina

Com o Node portátil, use `runtime\node.exe` no lugar de `node` nos comandos abaixo.

Sem tocar em PATH nem no Claude Code:

```powershell
node bin\painel.mjs instalar --sem-mcp
```

Esperado: linhas com ✓ para Node, build, dados (`~\.painel-agentes`) e atalho criado; um aviso `!` de que a pasta
do atalho não está no PATH; e a lista dos CLIs encontrados.

Com o aval do usuário, a instalação completa (põe o atalho no PATH do usuário e registra o MCP `painel-agentes`
no Claude Code, escopo do usuário):

```powershell
node bin\painel.mjs instalar --adicionar-ao-path
```

**Abra um terminal novo** depois disso: só nele o comando `painel` funciona. Para conferir o MCP:

```powershell
claude mcp get painel-agentes
```

Esperado: `Status: ✔ Connected` (ou conectado na próxima sessão).

### 6. CLIs de agente (feito pelo usuário)

O painel só usa CLIs **já instalados e logados**. Para cada um que o usuário quiser usar:

| CLI | Conferir | Login |
|---|---|---|
| Claude Code | `claude --version` | rode `claude` e faça login quando pedir |
| Cursor | `cursor-agent --version` | `cursor-agent login` |
| Antigravity | `agy --version` | abra o Antigravity e entre na conta |
| Codex | `codex --version` | `codex login` |

O painel detecta sozinho os instalados nos lugares padrão (PATH, `~\.local\bin`, `%LOCALAPPDATA%\agy\bin`,
`%LOCALAPPDATA%\cursor-agent`, `%APPDATA%\npm`). Se algum estiver em outro lugar, informe o caminho na tela
**Provedores**. Atenção: o painel confere só o `--version`; um CLI instalado e **não logado** aparece como
habilitado, mas falha ao rodar (veja o teste no passo 7).

### 7. Subir o serviço e testar

```powershell
painel servidor
```

Esperado: `Painel de agentes 2.x em http://127.0.0.1:4710`. Deixe esse terminal aberto (o serviço vive nele;
Ctrl+C encerra). Abra http://127.0.0.1:4710 e:

1. **Provedores**: confira os CLIs habilitados.
2. **Modelos**: ajuste o catálogo (família, notas de custo/velocidade/qualidade, preços, tags).
3. **Runs → Novo run**: escolha um modelo, modo **Leitura**, uma pasta qualquer e o prompt
   `Responda apenas: ok`. Deve terminar como **Concluído**. Se falhar com erro de autenticação, falta o login
   daquele CLI (passo 6).

### 8. Conferir

```powershell
painel doctor
```

Esperado: ✓ em Node, build, banco, serviço e nos CLIs que o usuário usa; `!` aponta o que falta, com a correção
na linha de baixo. Sem nenhum ✗, a instalação está completa.

### 9. Ligar um projeto (com o aval do usuário)

Na raiz do projeto (que deve ser um repositório git):

```powershell
painel init
```

Cadastra o projeto, cria a esteira a partir do modelo padrão, grava `.agentes/projeto.json` (pode ir para o git:
não tem caminhos da máquina) e acrescenta um bloco de instruções ao `CLAUDE.md`. Opções: `--id`, `--nome`,
`--esteira padrao|nenhuma|copiar:<id>`, `--sem-claude-md`. Rodar de novo não duplica nada.

A etapa de **commit** da esteira usa o git do projeto, então ele precisa de identidade:

```powershell
git config user.name; git config user.email
```

Se algum vier vazio, peça ao usuário os valores e configure (`git config user.name "Nome"`, idem para
`user.email`; use `--global` só se o usuário quiser para todos os repositórios).

### 10. Início automático com o Windows (opcional, com o aval do usuário)

Para o serviço subir sozinho no login do usuário (abre uma janela de console, que pode ficar minimizada):

```powershell
$acao = New-ScheduledTaskAction -Execute "$env:USERPROFILE\.painel-agentes\bin\painel.cmd" -Argument 'servidor'
Register-ScheduledTask -TaskName EsterIA -Action $acao -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
```

Para remover: `Unregister-ScheduledTask -TaskName EsterIA -Confirm:$false`. Se usar o acesso pelo celular,
ponha as opções no `-Argument`, por exemplo `-Argument 'servidor --host 127.0.0.1,100.x.y.z --permitir pc'`.

### Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `painel` não é reconhecido | Terminal aberto antes do `--adicionar-ao-path`: abra outro. Ou rode `C:\Users\<voce>\.painel-agentes\bin\painel.cmd`. |
| `Build não encontrado` | Falta o passo 4 (`npm run build`). |
| `npm` usa Node antigo | Faltou `$env:Path = "$PWD\runtime;$env:Path"` neste terminal (passo 3). |
| `Serviço fora do ar` no doctor ou no MCP | Suba `painel servidor` (passo 7). |
| Porta 4710 ocupada (`EADDRINUSE`) | Já há um serviço rodando (use-o) ou use `painel servidor --porta 4711` e `PAINEL_PORTA=4711` nos outros comandos. |
| CLI habilitado mas o run falha | Login do CLI (passo 6). Veja o erro na tela do run. |
| Esteira bloqueia no commit | Identidade do git no projeto (passo 9). |
| MCP aponta para outra pasta | A pasta do painel mudou: rode `painel instalar` de novo. |

### Linux e macOS

Não testado. O caminho esperado: Node 22.13+ do sistema, `npm ci`, `npm run build`,
`node bin/painel.mjs instalar` (ele mostra a linha `export PATH=...` para pôr no seu shell em vez de mexer no
PATH). O restante (servidor, init, doctor, MCP) é igual.

---

## Atualizar

```powershell
painel atualizar
```

Confere se há etapa rodando na fila e se há mudança local no código (para nos dois casos; `--forcar` passa
por cima), copia o banco para `~/.painel-agentes/backups` (guarda as 10 últimas), faz `git pull`, roda `npm ci`
só se as dependências mudaram e refaz o build com o mesmo Node do comando. Depois, reinicie o `painel servidor`
(as migrações do banco rodam na subida). O `painel doctor` avisa quando o serviço no ar está com código antigo.

## Acessar pelo celular (Tailscale)

O painel não tem login, então por padrão só aceita a própria máquina. Para abrir pelo celular na sua tailnet,
escute também no IP do Tailscale (`tailscale ip -4`) e libere o nome MagicDNS da máquina:

```powershell
painel servidor --host 127.0.0.1,100.x.y.z --permitir pc,pc.tail1234.ts.net
```

No celular, abra `http://pc:4710` (ou `http://100.x.y.z:4710`). O tráfego vai cifrado pelo próprio Tailscale.
Na primeira vez o Windows Firewall pode pedir para liberar o `node.exe`: libere em redes privadas.
Mantenha o `127.0.0.1` na lista: é por ele que o navegador do PC, o MCP e o `painel init` falam com o serviço.

Se a sua tailnet tiver certificados HTTPS ligados, também funciona `tailscale serve --bg 4710` com
`painel servidor --permitir pc.tail1234.ts.net` (e o serviço continua só em `127.0.0.1`).

`PAINEL_HOSTS_PERMITIDOS` faz o mesmo que `--permitir` (vários separados por vírgula; `*.dominio` libera
subdomínios). Libere só endereços que apenas você alcança: nunca escute em `0.0.0.0` numa rede que não é sua.

## Usar no dia a dia

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
| `painel instalar` | Configuração da máquina (atalho, CLIs, MCP). `--adicionar-ao-path`, `--sem-mcp`. |
| `painel servidor` | Sobe o serviço (interface + motor da esteira). `--porta`, `--host`, `--permitir`, `--banco`. |
| `painel init [pasta]` | Liga um projeto ao painel. |
| `painel atualizar` | Atualiza o código com segurança (fila, cópia do banco, pull, build). |
| `painel doctor` | Mostra o que falta (serviço, CLIs, MCP, projeto da pasta) e como resolver. |
| `painel mcp` | Servidor MCP por stdio (chamado pelo Claude Code). |

Variáveis: `PAINEL_PORTA` (4710), `PAINEL_HOSTS_PERMITIDOS`, `PAINEL_URL`, `PAINEL_DADOS_DIR` (`~/.painel-agentes`),
`PAINEL_BANCO`. Os dados (banco, cópias, atalho) ficam em `~/.painel-agentes`, separados do código.

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
- O painel não tem login: proteja o acesso pela rede (só a própria máquina ou a sua tailnet).

## Desenvolvimento

```powershell
npm run typecheck
npm test
npm run dev       # API com recarga (porta 4710)
npm run dev:web   # interface com Vite na 5173
```

Detalhes de arquitetura e fases em `docs/PLANO-V2.md`.
