## PainelAgentes v2 (branch `v2`)

Reescrita do painel de agentes. O plano e as fases estão em `docs/PLANO-V2.md`.

- Node 22.13+ (use `runtime\node.exe` e o `runtime\npm.cmd`, fora do git: o Node do PATH desta máquina não
  serve). No Bash: `export PATH="$PWD/runtime:$PATH"` antes de `npm`.
- TypeScript estrito. Servidor Hono + `node:sqlite` em `src/server`, interface React + Vite em `src/web`,
  tipos e schemas zod compartilhados em `src/shared`, comando `painel` em `src/cli`.
- Imports do servidor terminam em `.js` (NodeNext); os testes importam os `.ts` direto via `tsx`.
- Comandos: `npm run typecheck`, `npm test`, `npm run build`, `npm run dev` (API com recarga) +
  `npm run dev:web` (Vite na 5173 com proxy para a API).
- Dados da v2 em `~/.painel-agentes/` e porta 4710, separados do v1 (`~/.agentes`, 4700).
  `PAINEL_DADOS_DIR`, `PAINEL_BANCO` e `PAINEL_PORTA` mudam isso. Testes nunca usam a pasta real: banco
  `:memory:` ou pasta temporária.
- Migrações em `src/server/db/migracoes.ts`, guiadas por `PRAGMA user_version`. Migração publicada não muda:
  crie a próxima.
- A API só responde a host local e recusa escrita de outra origem; mantenha isso em rotas novas (ficam sob
  `/api/*`).
- Verificação no navegador: configuração `painel-v2-teste` (porta 4799, banco em `.teste-dados/`).
