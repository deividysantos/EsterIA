import { execFile } from 'node:child_process';
import path from 'node:path';

function git(cwd: string, args: string[], { maxBuffer = 20 * 1024 * 1024 } = {}): Promise<{ codigo: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer, encoding: 'utf8' }, (err, stdout, stderr) => {
      const codigo = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ codigo, stdout: String(stdout), stderr: String(stderr) || (err && !stderr ? err.message : '') });
    });
  });
}

/** Raiz do repositório ou null se a pasta não está num repositório git. */
export async function raizGit(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--show-toplevel']);
  return r.codigo === 0 ? path.resolve(r.stdout.trim()) : null;
}

/** Arquivos com mudança (rastreados ou novos), relativos à raiz do repositório. */
export async function arquivosAlterados(raiz: string): Promise<string[]> {
  const r = await git(raiz, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.codigo !== 0) return [];
  const partes = r.stdout.split('\0').filter(Boolean);
  const arquivos: string[] = [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]!;
    const status = p.slice(0, 2);
    arquivos.push(p.slice(3));
    // Renomeação: o próximo item é o nome antigo.
    if (status.startsWith('R') || status.startsWith('C')) i++;
  }
  return [...new Set(arquivos)].sort();
}

/** Normaliza caminhos informados por agentes (absolutos ou relativos ao cwd) para relativos à raiz do git. */
export function relativosARaiz(raiz: string, cwd: string, arquivos: readonly string[]): string[] {
  const saida = new Set<string>();
  for (const a of arquivos) {
    const abs = path.resolve(cwd, a);
    const rel = path.relative(raiz, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) saida.add(rel.split(path.sep).join('/'));
  }
  return [...saida];
}

/**
 * Arquivos da tarefa: os que mudaram desde que ela começou (fora os que já estavam alterados antes)
 * mais os que os agentes disseram ter tocado e ainda estão alterados.
 */
export async function arquivosDaTarefa(raiz: string, base: readonly string[], informados: readonly string[]): Promise<string[]> {
  const agora = await arquivosAlterados(raiz);
  const antes = new Set(base);
  const inf = new Set(informados);
  return agora.filter((a) => !antes.has(a) || inf.has(a));
}

export async function diffDosArquivos(raiz: string, arquivos: readonly string[], limite = 120_000): Promise<string> {
  if (!arquivos.length) return '';
  const rastreados = await git(raiz, ['diff', 'HEAD', '-U12', '--', ...arquivos]);
  let texto = rastreados.codigo === 0 ? rastreados.stdout : '';
  // Arquivos novos não aparecem no diff contra HEAD.
  const novos = await git(raiz, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...arquivos]);
  for (const a of novos.stdout.split('\0').filter(Boolean)) {
    const d = await git(raiz, ['diff', '--no-index', '-U12', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', a]);
    texto += d.stdout;
    if (texto.length > limite) break;
  }
  return texto.length > limite ? `${texto.slice(0, limite)}\n… (diff cortado em ${limite} caracteres)` : texto;
}

export async function commitar(raiz: string, arquivos: readonly string[], mensagem: string): Promise<{ hash: string } | { erro: string }> {
  const add = await git(raiz, ['add', '--', ...arquivos]);
  if (add.codigo !== 0) return { erro: `git add falhou: ${add.stderr.trim()}` };
  const c = await git(raiz, ['commit', '-m', mensagem, '--', ...arquivos]);
  if (c.codigo !== 0) return { erro: `git commit falhou: ${(c.stderr || c.stdout).trim()}` };
  const h = await git(raiz, ['rev-parse', 'HEAD']);
  return { hash: h.stdout.trim() };
}
