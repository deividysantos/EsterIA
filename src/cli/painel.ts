import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { obterCaminhoBanco, obterPorta, validarPorta, HOST_PADRAO } from '../server/config.js';
import { iniciarServidor } from '../server/servidor.js';
import { VERSAO } from '../server/versao.js';

/** Raiz do pacote: tanto `src/cli` quanto `dist/cli` ficam dois níveis abaixo dela. */
export const RAIZ_PACOTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const AJUDA = `painel ${VERSAO}

Uso:
  painel servidor [--porta <n>] [--host <h>] [--banco <arquivo>]
  painel --version | --help

Ambiente:
  PAINEL_PORTA       porta do serviço (padrão 4710)
  PAINEL_DADOS_DIR   pasta de dados (padrão ~/.painel-agentes)
  PAINEL_BANCO       arquivo do banco (padrão <dados>/painel.db)
`;

export class ErroUso extends Error {}

export type Comando =
  | { tipo: 'ajuda' }
  | { tipo: 'versao' }
  | { tipo: 'servidor'; porta?: number; host?: string; banco?: string };

export function parsearArgs(argv: readonly string[]): Comando {
  const [cmd, ...resto] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'ajuda') return { tipo: 'ajuda' };
  if (cmd === '--version' || cmd === '-v') return { tipo: 'versao' };
  if (cmd !== 'servidor') throw new ErroUso(`Comando desconhecido: "${cmd}".`);

  const r: Extract<Comando, { tipo: 'servidor' }> = { tipo: 'servidor' };
  for (let i = 0; i < resto.length; i++) {
    const bruto = resto[i]!;
    const [nome, valorInline] = bruto.startsWith('--') && bruto.includes('=')
      ? [bruto.slice(0, bruto.indexOf('=')), bruto.slice(bruto.indexOf('=') + 1)]
      : [bruto, undefined];
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

export async function executar(argv: readonly string[]): Promise<number> {
  let cmd: Comando;
  try {
    cmd = parsearArgs(argv);
  } catch (err) {
    if (err instanceof ErroUso) {
      process.stderr.write(`${err.message}\n\n${AJUDA}`);
      return 2;
    }
    throw err;
  }

  if (cmd.tipo === 'ajuda') {
    process.stdout.write(AJUDA);
    return 0;
  }
  if (cmd.tipo === 'versao') {
    process.stdout.write(`${VERSAO}\n`);
    return 0;
  }

  const webDir = path.join(RAIZ_PACOTE, 'dist', 'web');
  const servidor = await iniciarServidor({
    caminhoBanco: cmd.banco ?? obterCaminhoBanco(),
    porta: cmd.porta ?? obterPorta(),
    host: cmd.host ?? HOST_PADRAO,
    webDir,
  });
  process.stdout.write(`Painel de agentes ${VERSAO} em ${servidor.url}\n`);
  if (!fs.existsSync(path.join(webDir, 'index.html'))) {
    process.stdout.write('Interface não compilada: rode "npm run build" (ou "npm run dev:web").\n');
  }

  await new Promise<void>((resolve) => {
    const encerrar = () => resolve();
    process.once('SIGINT', encerrar);
    process.once('SIGTERM', encerrar);
  });
  await servidor.fechar();
  return 0;
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
