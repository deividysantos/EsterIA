import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type Env = Record<string, string | undefined>;

export interface Execucao {
  /** Programa real a ser chamado (sem shell). */
  arquivo: string;
  args: string[];
  envExtra: Record<string, string>;
  /** Necessário para o `cmd.exe /s /c "..."`, que não aceita a citação padrão do Node. */
  verbatim: boolean;
}

function existeArquivo(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Procura um comando no PATH (com PATHEXT no Windows). Devolve o caminho absoluto ou null. */
export function procurarNoPath(comando: string, env: Env = process.env, plataforma = process.platform): string | null {
  const pathEnv = env.PATH ?? env.Path ?? '';
  const sep = plataforma === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(sep).filter(Boolean);
  const exts =
    plataforma === 'win32' && !path.extname(comando)
      ? ['.exe', '.cmd', '.bat', '.ps1', '']
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const c = path.join(dir, `${comando}${ext}`);
      if (existeArquivo(c)) return c;
    }
  }
  return null;
}

/** Ordena pastas de versão do cursor-agent (`YYYY.MM.DD[-HH-MM-SS]-hash`), mais nova primeiro. */
function pesoVersaoCursor(nome: string): number | null {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/i.exec(nome);
  if (!m) return null;
  const [, a, mes, d, hh = '00', mm = '00', ss = '00'] = m;
  return Number(`${a}${mes!.padStart(2, '0')}${d!.padStart(2, '0')}${hh}${mm}${ss}`);
}

/**
 * O `cursor-agent` no Windows é um `.ps1` que chama `node.exe index.js` da pasta da versão mais nova.
 * Chamamos esse par direto, como o próprio script faz, para não depender do PowerShell.
 */
function resolverCursor(script: string, env: Env): { node: string; index: string; envExtra: Record<string, string> } | null {
  const dir = path.dirname(script);
  const candidatos: string[] = [dir];
  const versoes = path.join(dir, 'versions');
  if (fs.existsSync(versoes)) {
    const lista = fs
      .readdirSync(versoes, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ nome: d.name, peso: pesoVersaoCursor(d.name) }))
      .filter((v): v is { nome: string; peso: number } => v.peso !== null)
      .sort((x, y) => y.peso - x.peso);
    candidatos.push(...lista.map((v) => path.join(versoes, v.nome)));
  }
  for (const c of candidatos) {
    const node = path.join(c, 'node.exe');
    const index = path.join(c, 'index.js');
    if (existeArquivo(node) && existeArquivo(index)) {
      const envExtra: Record<string, string> = {};
      if (!env.CURSOR_INVOKED_AS) envExtra.CURSOR_INVOKED_AS = path.basename(script);
      if (!env.NODE_COMPILE_CACHE && env.LOCALAPPDATA) {
        envExtra.NODE_COMPILE_CACHE = path.join(env.LOCALAPPDATA, 'cursor-compile-cache');
      }
      return { node, index, envExtra };
    }
  }
  return null;
}

function citarCmd(arg: string): string {
  if (/[\r\n"]/.test(arg)) {
    throw new Error('Argumento com aspas ou quebra de linha não pode passar por cmd.exe.');
  }
  return /[\s&|<>^()%!]/.test(arg) ? `"${arg}"` : arg;
}

/**
 * Converte "caminho do executável + argumentos" numa chamada sem shell:
 * `.exe` direto, `cursor-agent.ps1` via node.exe/index.js, `.ps1` via PowerShell e `.cmd`/`.bat` via cmd.exe.
 */
export function resolverExecucao(caminho: string, args: readonly string[], env: Env = process.env): Execucao {
  const ext = path.extname(caminho).toLowerCase();
  const base = path.basename(caminho).toLowerCase();

  if (base.startsWith('cursor-agent') && (ext === '.ps1' || ext === '.cmd')) {
    const c = resolverCursor(caminho, env);
    if (c) return { arquivo: c.node, args: [c.index, ...args], envExtra: c.envExtra, verbatim: false };
  }

  if (ext === '.ps1') {
    return {
      arquivo: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', caminho, ...args],
      envExtra: {},
      verbatim: false,
    };
  }

  if (ext === '.cmd' || ext === '.bat') {
    const linha = [`"${caminho}"`, ...args.map(citarCmd)].join(' ');
    return {
      arquivo: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${linha}"`],
      envExtra: {},
      verbatim: true,
    };
  }

  return { arquivo: caminho, args: [...args], envExtra: {}, verbatim: false };
}

export interface ResultadoComando {
  codigo: number | null;
  stdout: string;
  stderr: string;
  erro: string | null;
}

/** Roda um executável com timeout e devolve a saída, sem lançar exceção. */
export function rodarCurto(
  caminho: string,
  args: readonly string[],
  { timeoutMs = 15_000, env = process.env }: { timeoutMs?: number; env?: Env } = {}
): Promise<ResultadoComando> {
  let exec: Execucao;
  try {
    exec = resolverExecucao(caminho, args, env);
  } catch (err) {
    return Promise.resolve({ codigo: null, stdout: '', stderr: '', erro: (err as Error).message });
  }
  return new Promise((resolve) => {
    execFile(
      exec.arquivo,
      exec.args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        windowsVerbatimArguments: exec.verbatim,
        maxBuffer: 1024 * 1024,
        env: { ...env, ...exec.envExtra } as NodeJS.ProcessEnv,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        let erro: string | null = null;
        let codigo: number | null = 0;
        if (e) {
          if (e.killed) erro = `Tempo esgotado (${Math.round(timeoutMs / 1000)} s).`;
          else if (typeof e.code === 'string') erro = `${e.code}: ${e.message}`;
          codigo = typeof e.code === 'number' ? e.code : null;
        }
        resolve({ codigo, stdout: String(stdout), stderr: String(stderr), erro });
      }
    );
  });
}
