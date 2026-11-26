import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { obterPorta } from '../server/config.js';
import type { Env } from '../server/provedores/executavel.js';

/** Raiz do pacote: tanto `src/cli` quanto `dist/cli` ficam dois níveis abaixo dela. */
export const RAIZ_PACOTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ErroUso extends Error {}

export type Especificacao = Record<string, 'valor' | 'flag'>;

/** Lê `--opcao valor`, `--opcao=valor` e `--flag`; o que não é opção vira posicional. */
export function lerOpcoes(args: readonly string[], spec: Especificacao): { opcoes: Record<string, string | true>; posicionais: string[] } {
  const opcoes: Record<string, string | true> = {};
  const posicionais: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) {
      posicionais.push(a);
      continue;
    }
    const igual = a.indexOf('=');
    const nome = igual > 0 ? a.slice(2, igual) : a.slice(2);
    const tipo = spec[nome];
    if (!tipo) throw new ErroUso(`Opção desconhecida: --${nome}`);
    if (tipo === 'flag') {
      if (igual > 0) throw new ErroUso(`--${nome} não recebe valor.`);
      opcoes[nome] = true;
    } else {
      const v = igual > 0 ? a.slice(igual + 1) : args[++i];
      if (v === undefined || v === '') throw new ErroUso(`Valor ausente para --${nome}.`);
      opcoes[nome] = v;
    }
  }
  return { opcoes, posicionais };
}

export function urlPainel(env: Env = process.env): string {
  const bruto = env.PAINEL_URL?.trim();
  if (bruto) return bruto.replace(/\/+$/, '');
  return `http://127.0.0.1:${obterPorta(env)}`;
}

export class ErroConexao extends Error {}

export interface RespostaApi<T = unknown> {
  status: number;
  corpo: T;
}

/** Chama a API do serviço. Lança ErroConexao se o serviço não estiver no ar. */
export async function api<T = unknown>(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  { url = urlPainel(), timeoutMs = 15_000, fetchImpl = fetch }: { url?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<RespostaApi<T>> {
  let res: Response;
  try {
    res = await fetchImpl(`${url}${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ErroConexao(`O serviço do painel não respondeu em ${url} (${(err as Error).message}). Suba com "painel servidor".`);
  }
  const texto = await res.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }
  return { status: res.status, corpo: dados as T };
}

/** Mensagem de erro da API (`{ erro }`) ou um texto genérico. */
export function erroDaApi(r: RespostaApi): string {
  const c = r.corpo as { erro?: string } | null;
  return c && typeof c === 'object' && c.erro ? c.erro : `Erro HTTP ${r.status}.`;
}

export const ARQUIVO_MARCADOR = path.join('.agentes', 'projeto.json');

export interface Marcador {
  id: string;
  nome?: string;
}

/** Sobe a partir de `cwd` procurando `.agentes/projeto.json`. */
export function lerMarcador(cwd: string): (Marcador & { raiz: string }) | null {
  let dir = path.resolve(cwd);
  for (;;) {
    const arq = path.join(dir, ARQUIVO_MARCADOR);
    if (fs.existsSync(arq)) {
      try {
        const m = JSON.parse(fs.readFileSync(arq, 'utf8')) as Marcador;
        if (typeof m.id === 'string' && m.id) return { ...m, raiz: dir };
      } catch {
        /* marcador corrompido: ignora e continua subindo */
      }
    }
    const pai = path.dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}

/** Projeto da pasta: pelo marcador ou, sem marcador, pela raiz cadastrada que contém a pasta. */
export function projetoDaPasta(cwd: string, projetos: readonly { id: string; raiz: string }[]): string | null {
  const m = lerMarcador(cwd);
  if (m && projetos.some((p) => p.id === m.id)) return m.id;
  const alvo = path.resolve(cwd).toLowerCase();
  const dono = projetos
    .filter((p) => {
      const r = path.resolve(p.raiz).toLowerCase();
      return alvo === r || alvo.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
    })
    .sort((a, b) => b.raiz.length - a.raiz.length)[0];
  return dono?.id ?? m?.id ?? null;
}

export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'projeto';
}
