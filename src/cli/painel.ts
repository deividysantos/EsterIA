import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { obterCaminhoBanco, obterPorta, validarPorta, HOST_PADRAO } from '../server/config.js';
import { iniciarServidor } from '../server/servidor.js';
import { VERSAO } from '../server/versao.js';
import { ErroUso, RAIZ_PACOTE } from './comum.js';
import { doctor } from './doctor.js';
import { iniciarProjeto } from './init.js';
import { formatarLinhas, instalar } from './instalar.js';
import { rodarMcp } from './mcp.js';

export { ErroUso, RAIZ_PACOTE };

const AJUDA = `painel ${VERSAO} — painel e motor de esteira para agentes de código

Uso:
  painel instalar [--adicionar-ao-path] [--sem-mcp]
      Uma vez por máquina: confere Node e build, cria o atalho "painel", detecta os CLIs
      (Claude Code, Cursor, Antigravity, Codex) e registra o MCP no Claude Code.

  painel servidor [--porta <n>] [--host <h>] [--banco <arquivo>]
      Sobe o serviço (interface + motor da esteira). Um só atende todos os projetos.

  painel init [pasta] [--id <id>] [--nome <nome>] [--esteira padrao|nenhuma|copiar:<id>] [--sem-claude-md]
      Na pasta de um projeto: cadastra no painel, cria a esteira, grava .agentes/projeto.json
      e um bloco de instruções no CLAUDE.md. Pode rodar de novo sem duplicar nada.

  painel doctor
      Mostra o que está faltando (serviço, CLIs, MCP, projeto da pasta) e como resolver.

  painel mcp
      Servidor MCP por stdio (usado pelo Claude Code; registrado pelo "painel instalar").

  painel --version | --help

Ambiente:
  PAINEL_PORTA       porta do serviço (padrão 4710)
  PAINEL_URL         endereço do serviço para init/doctor/mcp (padrão http://127.0.0.1:<porta>)
  PAINEL_DADOS_DIR   pasta de dados (padrão ~/.painel-agentes)
  PAINEL_BANCO       arquivo do banco (padrão <dados>/painel.db)
`;

export type Comando =
  | { tipo: 'ajuda' }
  | { tipo: 'versao' }
  | { tipo: 'servidor'; porta?: number; host?: string; banco?: string }
  | { tipo: 'instalar' | 'init' | 'doctor' | 'mcp'; args: string[] };

export function parsearArgs(argv: readonly string[]): Comando {
  const [cmd, ...resto] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'ajuda') return { tipo: 'ajuda' };
  if (cmd === '--version' || cmd === '-v') return { tipo: 'versao' };
  if (cmd === 'instalar' || cmd === 'init' || cmd === 'doctor' || cmd === 'mcp') return { tipo: cmd, args: resto };
  if (cmd !== 'servidor') throw new ErroUso(`Comando desconhecido: "${cmd}".`);

  const r: Extract<Comando, { tipo: 'servidor' }> = { tipo: 'servidor' };
  for (let i = 0; i < resto.length; i++) {
    const bruto = resto[i]!;
    const [nome, valorInline] =
      bruto.startsWith('--') && bruto.includes('=') ? [bruto.slice(0, bruto.indexOf('=')), bruto.slice(bruto.indexOf('=') + 1)] : [bruto, undefined];
    const valor = () => {
      if (valorInline !== undefined) return valorInline;
      const v = resto[++i];
      if (v === undefined) throw new ErroUso(`Valor ausente para ${nome}.`);
      return v;
    };
    switch (nome) {
      case '--porta':
        try {
          r.porta = validarPorta(valor());
        } catch (err) {
          throw new ErroUso((err as Error).message);
        }
        break;
      case '--host':
        r.host = valor();
        break;
      case '--banco':
        r.banco = path.resolve(valor());
        break;
      default:
        throw new ErroUso(`Opção desconhecida: ${bruto}`);
    }
  }
  return r;
}

async function servidor(cmd: Extract<Comando, { tipo: 'servidor' }>): Promise<number> {
  const webDir = path.join(RAIZ_PACOTE, 'dist', 'web');
  const s = await iniciarServidor({
    caminhoBanco: cmd.banco ?? obterCaminhoBanco(),
    porta: cmd.porta ?? obterPorta(),
    host: cmd.host ?? HOST_PADRAO,
    webDir,
  });
  process.stdout.write(`Painel de agentes ${VERSAO} em ${s.url}\n`);
  if (!fs.existsSync(path.join(webDir, 'index.html'))) {
    process.stdout.write('Interface não compilada: rode "npm run build" (ou "npm run dev:web").\n');
  }
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
  await s.fechar();
  return 0;
}

export async function executar(argv: readonly string[]): Promise<number> {
  try {
    const cmd = parsearArgs(argv);
    switch (cmd.tipo) {
      case 'ajuda':
        process.stdout.write(AJUDA);
        return 0;
      case 'versao':
        process.stdout.write(`${VERSAO}\n`);
        return 0;
      case 'servidor':
        return await servidor(cmd);
      case 'mcp':
        return await rodarMcp();
      case 'init': {
        const r = await iniciarProjeto(cmd.args);
        process.stdout.write(`${r.linhas.map((l) => `• ${l}`).join('\n')}\n`);
        return 0;
      }
      case 'instalar': {
        const r = await instalar(cmd.args);
        process.stdout.write(formatarLinhas(r.linhas));
        return r.ok ? 0 : 1;
      }
      case 'doctor': {
        const r = await doctor(cmd.args);
        process.stdout.write(formatarLinhas(r.linhas));
        return r.ok ? 0 : 1;
      }
    }
  } catch (err) {
    if (err instanceof ErroUso) {
      process.stderr.write(`${err.message}\n\n${AJUDA}`);
      return 2;
    }
    throw err;
  }
}

const ehPrincipal = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (ehPrincipal) {
  executar(process.argv.slice(2)).then(
    (codigo) => process.exit(codigo),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  );
}
