import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { EstadoFila } from '../shared/problemas.js';
import type { Saude } from '../shared/projetos.js';
import { obterCaminhoBanco, obterDadosDir } from '../server/config.js';
import type { Env } from '../server/provedores/executavel.js';
import { api, ErroConexao, lerOpcoes, RAIZ_PACOTE, urlPainel } from './comum.js';
import type { Linha } from './instalar.js';

export interface ResultadoProcesso {
  codigo: number | null;
  saida: string;
}

/** Roda um processo e captura a saída (git). */
export function capturar(arquivo: string, args: readonly string[], cwd: string): Promise<ResultadoProcesso> {
  return new Promise((resolve) => {
    execFile(arquivo, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const codigo = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ codigo, saida: `${stdout}${stderr}`.trim() || (err ? err.message : '') });
    });
  });
}

/** npm do mesmo Node deste processo (o `npm-cli.js` que vem junto), para o build sair com o Node certo. */
export function comandoNpm(): { arquivo: string; prefixo: string[] } {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) return { arquivo: process.execPath, prefixo: [cli] };
  return { arquivo: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixo: [] };
}

/** Roda o npm mostrando a saída no terminal (npm ci e o build demoram). */
export function rodarNpm(args: readonly string[], cwd: string, env: Env): Promise<ResultadoProcesso> {
  const { arquivo, prefixo } = comandoNpm();
  return new Promise((resolve) => {
    // O Node deste processo vai na frente do PATH: scripts do npm (vite, tsc) usam o mesmo Node.
    const sep = process.platform === 'win32' ? ';' : ':';
    const PATH = `${path.dirname(process.execPath)}${sep}${env.PATH ?? env.Path ?? ''}`;
    const p = spawn(arquivo, [...prefixo, ...args], {
      cwd,
      stdio: 'inherit',
      env: { ...env, PATH, Path: undefined } as NodeJS.ProcessEnv,
      shell: arquivo.endsWith('.cmd'),
      windowsHide: true,
    });
    p.once('error', (err) => resolve({ codigo: null, saida: err.message }));
    p.once('close', (codigo) => resolve({ codigo, saida: '' }));
  });
}

const MAX_COPIAS = 10;

/** Cópia consistente do banco (funciona com o serviço no ar). Mantém as 10 mais recentes. */
export function copiarBanco(caminho: string, pastaCopias: string, agora = new Date()): string | null {
  if (!fs.existsSync(caminho)) return null;
  fs.mkdirSync(pastaCopias, { recursive: true });
  const carimbo = agora.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let destino = path.join(pastaCopias, `painel-${carimbo}.db`);
  for (let n = 2; fs.existsSync(destino); n++) destino = path.join(pastaCopias, `painel-${carimbo}-${n}.db`);
  const db = new DatabaseSync(caminho);
  try {
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const copias = fs
    .readdirSync(pastaCopias)
    .filter((f) => /^painel-\d{8}-\d{6}(-\d+)?\.db$/.test(f))
    .sort();
  for (const velha of copias.slice(0, Math.max(0, copias.length - MAX_COPIAS))) fs.rmSync(path.join(pastaCopias, velha), { force: true });
  return destino;
}

export interface OpcoesAtualizar {
  env?: Env;
  raiz?: string;
  url?: string;
  npm?: (args: readonly string[], cwd: string) => Promise<ResultadoProcesso>;
}

export async function atualizar(args: readonly string[], o: OpcoesAtualizar = {}): Promise<{ linhas: Linha[]; ok: boolean }> {
  const { opcoes } = lerOpcoes(args, { forcar: 'flag', 'sem-backup': 'flag', 'sem-git': 'flag' });
  const env = o.env ?? process.env;
  const raiz = o.raiz ?? RAIZ_PACOTE;
  const url = o.url ?? urlPainel(env);
  const npm = o.npm ?? ((a, cwd) => rodarNpm(a, cwd, env));
  const linhas: Linha[] = [];
  const add = (estado: Linha['estado'], texto: string, dica?: string) => linhas.push({ estado, texto, ...(dica ? { dica } : {}) });
  const falhar = (texto: string, dica?: string) => {
    add('erro', texto, dica);
    return { linhas, ok: false };
  };
  const git = (...a: string[]) => capturar('git', a, raiz);

  // 1. É um clone git e não tem mudança local no código.
  if ((await git('rev-parse', '--show-toplevel')).codigo !== 0) {
    return falhar(`${raiz} não é um repositório git.`, 'Atualize copiando a versão nova e rode "npm ci" e "npm run build".');
  }
  const pendentes = (await git('status', '--porcelain', '--untracked-files=no')).saida;
  if (pendentes && !opcoes.forcar) {
    return falhar('Há mudanças locais no código do painel.', `Faça commit ou descarte antes (ou use --forcar):\n    ${pendentes.split('\n').join('\n    ')}`);
  }

  // 2. Nada rodando na fila (reiniciar no meio de uma etapa deixa o problema bloqueado).
  let servicoNoAr = false;
  let commitServico: string | null = null;
  try {
    const s = await api<Saude>('GET', '/api/saude', undefined, { url, timeoutMs: 3000 });
    servicoNoAr = s.status === 200;
    commitServico = s.corpo?.commit ?? null;
    const f = await api<EstadoFila>('GET', '/api/fila', undefined, { url });
    const rodando = f.status === 200 ? f.corpo.rodando.length : 0;
    if (rodando && !opcoes.forcar) {
      return falhar(`${rodando} etapa(s) rodando na fila.`, 'Espere terminar (ou pause os problemas) antes de atualizar, ou use --forcar.');
    }
    add('ok', rodando ? `${rodando} etapa(s) rodando (seguindo por --forcar).` : 'Fila sem etapas rodando.');
  } catch (err) {
    if (!(err instanceof ErroConexao)) throw err;
    add('info', 'Serviço fora do ar: nada para conferir na fila.');
  }

  // 3. Cópia do banco antes de qualquer coisa.
  if (opcoes['sem-backup']) add('info', 'Cópia do banco: pulada (--sem-backup).');
  else {
    const copia = copiarBanco(obterCaminhoBanco(env), path.join(obterDadosDir(env), 'backups'));
    add(copia ? 'ok' : 'info', copia ? `Cópia do banco: ${copia}` : 'Cópia do banco: ainda não existe banco.');
  }

  // 4. Código novo.
  const antes = (await git('rev-parse', '--short', 'HEAD')).saida;
  if (opcoes['sem-git']) add('info', 'git pull: pulado (--sem-git).');
  else {
    const pull = await git('pull', '--ff-only');
    if (pull.codigo !== 0) return falhar('git pull falhou.', pull.saida.split('\n').slice(-4).join('\n    '));
  }
  const depois = (await git('rev-parse', '--short', 'HEAD')).saida;
  const mudou = antes !== depois;
  add(mudou ? 'ok' : 'info', mudou ? `Código atualizado: ${antes} → ${depois}` : `Código já estava na versão mais recente (${depois}).`);
  if (mudou) {
    const log = (await git('log', '--format=%h %s', `${antes}..${depois}`)).saida;
    if (log) add('info', `Mudanças:\n    ${log.split('\n').slice(0, 15).join('\n    ')}`);
  }

  // 5. Dependências (só se mudaram ou faltam) e build.
  const depsMudaram = mudou && (await git('diff', '--name-only', antes, depois, '--', 'package.json', 'package-lock.json')).saida !== '';
  const semDeps = !fs.existsSync(path.join(raiz, 'node_modules'));
  if (depsMudaram || semDeps) {
    const r = await npm(['ci'], raiz);
    if (r.codigo !== 0) return falhar('npm ci falhou.', r.saida || 'Veja a saída acima.');
    add('ok', `Dependências reinstaladas (${semDeps ? 'faltava node_modules' : 'package-lock mudou'}).`);
  } else add('info', 'Dependências sem mudança.');

  const semBuild = !fs.existsSync(path.join(raiz, 'dist', 'cli', 'painel.js'));
  if (mudou || semBuild || opcoes.forcar) {
    const r = await npm(['run', 'build'], raiz);
    if (r.codigo !== 0) return falhar('Build falhou.', r.saida || 'Veja a saída acima.');
    add('ok', 'Build pronto.');
  } else add('info', 'Build já atualizado.');

  // 6. Versão nova e o que falta.
  const versao = (JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as { version: string }).version;
  add('ok', `Versão ${versao} (${depois}).`);
  if (servicoNoAr && commitServico !== depois) {
    add('aviso', `O serviço no ar ainda roda ${commitServico ?? 'código antigo'}.`, 'Reinicie: Ctrl+C no terminal do "painel servidor" e suba de novo. As migrações do banco rodam na subida.');
  } else if (!servicoNoAr) add('info', 'Suba o serviço com "painel servidor"; as migrações do banco rodam na subida.');
  add('info', 'Sessões do Claude Code já abertas continuam com o MCP antigo até serem reiniciadas.');
  return { linhas, ok: true };
}
