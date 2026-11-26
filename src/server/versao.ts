import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Raiz do pacote (dois níveis acima, tanto em src/ quanto em dist/). */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Versão do pacote (package.json). */
export const VERSAO: string = (require('../../package.json') as { version: string }).version;

/** Commit do código na hora em que o processo subiu (null fora de um repositório git). */
export function commitAtual(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export const COMMIT: string | null = commitAtual();
