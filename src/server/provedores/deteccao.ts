import fs from 'node:fs';
import path from 'node:path';

import type { IdProvedor } from '../../shared/provedores.js';
import { procurarNoPath, rodarCurto, type Env } from './executavel.js';

interface Regra {
  /** Nomes procurados no PATH, em ordem. */
  comandos: string[];
  /** Locais de instalação conhecidos (fora do PATH). */
  locais(env: Env): (string | null)[];
}

function junta(base: string | undefined, ...partes: string[]): string | null {
  return base ? path.join(base, ...partes) : null;
}

const REGRAS: Record<IdProvedor, Regra> = {
  claude: {
    comandos: ['claude'],
    locais: (env) => [
      junta(env.USERPROFILE ?? env.HOME, '.local', 'bin', 'claude.exe'),
      junta(env.USERPROFILE ?? env.HOME, '.local', 'bin', 'claude'),
      junta(env.APPDATA, 'npm', 'claude.cmd'),
    ],
  },
  cursor: {
    comandos: ['cursor-agent'],
    locais: (env) => [
      junta(env.LOCALAPPDATA, 'cursor-agent', 'cursor-agent.ps1'),
      junta(env.LOCALAPPDATA, 'cursor-agent', 'cursor-agent.cmd'),
      junta(env.USERPROFILE ?? env.HOME, '.local', 'bin', 'cursor-agent'),
    ],
  },
  antigravity: {
    comandos: ['agy'],
    locais: (env) => [junta(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')],
  },
  codex: {
    comandos: ['codex'],
    locais: (env) => [junta(env.APPDATA, 'npm', 'codex.cmd'), junta(env.USERPROFILE ?? env.HOME, '.local', 'bin', 'codex')],
  },
};

function existeArquivo(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Procura o CLI no PATH e nos locais de instalação conhecidos. */
export function detectarCaminho(id: IdProvedor, env: Env = process.env, plataforma = process.platform): string | null {
  const regra = REGRAS[id];
  for (const c of regra.comandos) {
    const achado = procurarNoPath(c, env, plataforma);
    if (achado) return achado;
  }
  for (const local of regra.locais(env)) {
    if (local && existeArquivo(local)) return local;
  }
  return null;
}

export interface ResultadoVerificacao {
  ok: boolean;
  versao: string | null;
  saida: string | null;
  erro: string | null;
}

/** Extrai algo com cara de versão (`1.2.3`, `2026.05.01-abc`) da saída do `--version`. */
export function extrairVersao(saida: string): string | null {
  const m = /\d+\.\d+(?:\.\d+)?(?:[-+.][0-9A-Za-z.-]+)?/.exec(saida);
  return m ? m[0] : null;
}

/** Confere se o arquivo existe e se `--version` responde com código 0. */
export async function verificarCaminho(
  caminho: string,
  { env = process.env, timeoutMs = 15_000 }: { env?: Env; timeoutMs?: number } = {}
): Promise<ResultadoVerificacao> {
  if (!path.isAbsolute(caminho)) {
    return { ok: false, versao: null, saida: null, erro: 'Informe o caminho absoluto do executável.' };
  }
  if (!existeArquivo(caminho)) {
    return { ok: false, versao: null, saida: null, erro: 'Arquivo não encontrado.' };
  }
  const r = await rodarCurto(caminho, ['--version'], { env, timeoutMs });
  const saida = `${r.stdout}\n${r.stderr}`.trim().slice(0, 2000) || null;
  if (r.erro) return { ok: false, versao: null, saida, erro: r.erro };
  if (r.codigo !== 0) {
    return { ok: false, versao: null, saida, erro: `--version terminou com código ${r.codigo}.` };
  }
  const primeira = r.stdout.trim().split(/\r?\n/)[0] ?? '';
  return { ok: true, versao: extrairVersao(primeira) ?? (primeira.slice(0, 80) || null), saida, erro: null };
}
