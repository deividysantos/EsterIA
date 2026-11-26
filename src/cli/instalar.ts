import fs from 'node:fs';
import path from 'node:path';

import { abrirBanco, versaoEsquema } from '../server/db/banco.js';
import { listarProvedores, obterCaminhoEmUso } from '../server/db/provedores.js';
import { obterCaminhoBanco, obterDadosDir } from '../server/config.js';
import { rodarCurto, type Env, type ResultadoComando } from '../server/provedores/executavel.js';
import { verificarTodos } from '../server/provedores/servico.js';
import { VERSAO } from '../server/versao.js';
import { lerOpcoes, RAIZ_PACOTE, urlPainel } from './comum.js';

export const NOME_MCP = 'painel-agentes';
const NODE_MINIMO: [number, number] = [22, 13];

export type Rodar = (arquivo: string, args: string[]) => Promise<ResultadoComando>;

export interface Linha {
  estado: 'ok' | 'aviso' | 'erro' | 'info';
  texto: string;
  dica?: string;
}

export function nodeAtende(versao = process.versions.node): boolean {
  const [a = 0, b = 0] = versao.split('.').map(Number);
  return a > NODE_MINIMO[0] || (a === NODE_MINIMO[0] && b >= NODE_MINIMO[1]);
}

export function caminhosInstalacao(env: Env = process.env) {
  const dados = obterDadosDir(env);
  const win = process.platform === 'win32';
  return {
    dados,
    bin: path.join(dados, 'bin'),
    atalho: path.join(dados, 'bin', win ? 'painel.cmd' : 'painel'),
    entrada: path.join(RAIZ_PACOTE, 'bin', 'painel.mjs'),
    node: process.execPath,
    build: path.join(RAIZ_PACOTE, 'dist', 'cli', 'painel.js'),
    web: path.join(RAIZ_PACOTE, 'dist', 'web', 'index.html'),
  };
}

export function conteudoAtalho(node: string, entrada: string): string {
  return process.platform === 'win32' ? `@"${node}" "${entrada}" %*\r\n` : `#!/bin/sh\nexec "${node}" "${entrada}" "$@"\n`;
}

export function estaNoPath(dir: string, env: Env = process.env): boolean {
  const sep = process.platform === 'win32' ? ';' : ':';
  const alvo = path.resolve(dir).toLowerCase();
  return (env.PATH ?? env.Path ?? '').split(sep).some((d) => d && path.resolve(d).toLowerCase() === alvo);
}

/** Caminho do CLI do Claude Code habilitado no painel (para registrar o MCP). */
export function caminhoClaude(env: Env): string | null {
  const db = abrirBanco(obterCaminhoBanco(env));
  try {
    const p = listarProvedores(db).find((x) => x.id === 'claude');
    return p?.habilitado ? obterCaminhoEmUso(db, 'claude') : null;
  } finally {
    db.close();
  }
}

export async function instalar(
  args: readonly string[],
  { env = process.env, rodar = (a, b) => rodarCurto(a, b, { env, timeoutMs: 60_000 }) }: { env?: Env; rodar?: Rodar } = {}
): Promise<{ linhas: Linha[]; ok: boolean }> {
  const { opcoes } = lerOpcoes(args, { 'sem-mcp': 'flag', 'adicionar-ao-path': 'flag' });
  const c = caminhosInstalacao(env);
  const linhas: Linha[] = [];
  const add = (estado: Linha['estado'], texto: string, dica?: string) => linhas.push({ estado, texto, ...(dica ? { dica } : {}) });

  if (!nodeAtende()) {
    add('erro', `Node ${process.versions.node}: o painel precisa do ${NODE_MINIMO.join('.')} ou mais novo.`, 'Instale o Node 22 LTS e rode de novo.');
    return { linhas, ok: false };
  }
  add('ok', `Node ${process.versions.node} (${c.node})`);

  if (!fs.existsSync(c.build) || !fs.existsSync(c.web)) {
    add('erro', 'Build não encontrado.', `Na pasta ${RAIZ_PACOTE}, rode "npm ci" e "npm run build".`);
    return { linhas, ok: false };
  }
  add('ok', `Painel ${VERSAO} em ${RAIZ_PACOTE}`);

  fs.mkdirSync(c.bin, { recursive: true });
  const db = abrirBanco(obterCaminhoBanco(env));
  try {
    add('ok', `Dados em ${c.dados} (banco no esquema ${versaoEsquema(db)})`);

    const atalho = conteudoAtalho(c.node, c.entrada);
    const antes = fs.existsSync(c.atalho) ? fs.readFileSync(c.atalho, 'utf8') : null;
    if (antes !== atalho) fs.writeFileSync(c.atalho, atalho, { mode: 0o755 });
    add('ok', `Atalho ${antes === null ? 'criado' : antes === atalho ? 'já existia' : 'atualizado'}: ${c.atalho}`);

    if (estaNoPath(c.bin, env)) add('ok', 'A pasta do atalho está no PATH: o comando "painel" funciona em qualquer terminal novo.');
    else if (opcoes['adicionar-ao-path'] && process.platform === 'win32') {
      const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not (($p -split ';') -contains '${c.bin}')) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${c.bin}'), 'User') }`;
      const r = await rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
      if (r.codigo === 0) add('ok', `Pasta ${c.bin} adicionada ao PATH do usuário. Abra um terminal novo para usar "painel".`);
      else add('aviso', 'Não consegui adicionar ao PATH.', `${r.erro ?? r.stderr}`.trim());
    } else {
      add(
        'aviso',
        `A pasta ${c.bin} não está no PATH.`,
        process.platform === 'win32'
          ? 'Rode "painel instalar --adicionar-ao-path" ou adicione a pasta ao PATH do usuário.'
          : `Acrescente ao seu shell: export PATH="${c.bin}:$PATH"`
      );
    }

    const provedores = await verificarTodos(db, { env });
    const hab = provedores.filter((p) => p.habilitado);
    for (const p of provedores) {
      if (p.habilitado) add('ok', `${p.nome} ${p.versao ?? ''} (${p.caminhoEmUso})`);
      else add('info', `${p.nome}: ${p.estado === 'nao_encontrado' ? 'não encontrado' : (p.erro ?? p.estado)}`);
    }
    if (!hab.length) add('aviso', 'Nenhum CLI de agente habilitado.', 'Instale um (claude, cursor-agent, agy, codex) ou informe o caminho na tela Provedores.');

    if (opcoes['sem-mcp']) add('info', 'MCP: não registrado (--sem-mcp).');
    else {
      const claude = hab.find((p) => p.id === 'claude') ? obterCaminhoEmUso(db, 'claude') : null;
      if (!claude) add('info', 'MCP: Claude Code não habilitado; nada para registrar.');
      else {
        // Remove o registro anterior (pode apontar para outra instalação) e registra de novo.
        await rodar(claude, ['mcp', 'remove', '--scope', 'user', NOME_MCP]);
        const r = await rodar(claude, ['mcp', 'add', '--scope', 'user', NOME_MCP, '--', c.node, c.entrada, 'mcp']);
        if (r.codigo === 0) add('ok', `MCP "${NOME_MCP}" registrado no Claude Code (escopo do usuário).`);
        else add('aviso', 'Não consegui registrar o MCP no Claude Code.', `${(r.stderr || r.stdout || r.erro || '').trim().slice(0, 300)}`);
      }
    }
  } finally {
    db.close();
  }

  add('info', `Próximos passos: "painel servidor" (abre ${urlPainel(env)}) e, na pasta de cada projeto, "painel init".`);
  return { linhas, ok: !linhas.some((l) => l.estado === 'erro') };
}

export function formatarLinhas(linhas: readonly Linha[]): string {
  const marca = { ok: '✓', aviso: '!', erro: '✗', info: '•' } as const;
  return linhas.map((l) => `${marca[l.estado]} ${l.texto}${l.dica ? `\n    ${l.dica}` : ''}`).join('\n') + '\n';
}
