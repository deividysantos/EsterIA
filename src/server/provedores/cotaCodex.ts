import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LimiteLido } from '../adaptadores/tipos.js';
import type { Banco } from '../db/banco.js';
import type { Env } from './executavel.js';

/**
 * Cota do Codex, melhor esforço: o CLI grava as sessões em ~/.codex/sessions/AAAA/MM/DD/*.jsonl e os
 * eventos token_count trazem rate_limits { primary, secondary } com used_percent e a janela em minutos.
 * Formato não oficial: qualquer coisa fora do esperado é ignorada em silêncio.
 */

export interface LeituraCota extends LimiteLido {
  capturadoEm: string;
}

function pastaSessoes(env: Env): string {
  const home = env.CODEX_HOME?.trim() || path.join(env.USERPROFILE ?? env.HOME ?? os.homedir(), '.codex');
  return path.join(home, 'sessions');
}

function arquivosRecentes(dir: string, desdeMs: number, limite = 30): string[] {
  const achados: { arq: string; mtime: number }[] = [];
  const andar = (d: string, prof: number) => {
    if (prof > 4) return;
    let itens: fs.Dirent[];
    try {
      itens = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of itens) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) andar(p, prof + 1);
      else if (it.name.endsWith('.jsonl')) {
        try {
          const mtime = fs.statSync(p).mtimeMs;
          if (mtime >= desdeMs) achados.push({ arq: p, mtime });
        } catch {
          /* sumiu */
        }
      }
    }
  };
  andar(dir, 0);
  return achados.sort((a, b) => b.mtime - a.mtime).slice(0, limite).map((x) => x.arq);
}

function nomeJanela(minutos: unknown, chave: string): string {
  if (minutos === 300) return 'five_hour';
  if (minutos === 10080) return 'seven_day';
  return typeof minutos === 'number' ? `${minutos}min` : chave;
}

/** Extrai as leituras de uma linha de sessão (ou de um evento do `exec --json`). */
export function leiturasDeEvento(o: unknown): LeituraCota[] {
  if (!o || typeof o !== 'object') return [];
  const raiz = o as Record<string, unknown>;
  const payload = (raiz.payload && typeof raiz.payload === 'object' ? raiz.payload : raiz) as Record<string, unknown>;
  const rl = payload.rate_limits ?? (payload.info as Record<string, unknown> | undefined)?.rate_limits;
  if (!rl || typeof rl !== 'object') return [];
  const ts = typeof raiz.timestamp === 'string' && !Number.isNaN(Date.parse(raiz.timestamp)) ? raiz.timestamp : new Date().toISOString();
  const saida: LeituraCota[] = [];
  for (const chave of ['primary', 'secondary']) {
    const j = (rl as Record<string, unknown>)[chave] as Record<string, unknown> | undefined;
    if (!j || typeof j.used_percent !== 'number') continue;
    let reinicia: string | null = null;
    if (typeof j.resets_at === 'number') reinicia = new Date(j.resets_at * 1000).toISOString();
    else if (typeof j.resets_in_seconds === 'number') reinicia = new Date(Date.parse(ts) + j.resets_in_seconds * 1000).toISOString();
    saida.push({
      janela: nomeJanela(j.window_minutes, chave),
      utilizacao: Math.min(Math.max(j.used_percent / 100, 0), 1),
      status: null,
      reiniciaEm: reinicia,
      capturadoEm: ts,
    });
  }
  return saida;
}

/** Última leitura de cada janela nas sessões recentes do Codex. */
export function lerCotasCodex(env: Env = process.env, dias = 7): LeituraCota[] {
  const ultima = new Map<string, LeituraCota>();
  for (const arq of arquivosRecentes(pastaSessoes(env), Date.now() - dias * 86_400_000)) {
    let texto: string;
    try {
      texto = fs.readFileSync(arq, 'utf8');
    } catch {
      continue;
    }
    for (const linha of texto.split('\n')) {
      if (!linha.includes('rate_limits')) continue;
      let o: unknown;
      try {
        o = JSON.parse(linha);
      } catch {
        continue;
      }
      for (const l of leiturasDeEvento(o)) {
        const atual = ultima.get(l.janela);
        if (!atual || l.capturadoEm > atual.capturadoEm) ultima.set(l.janela, l);
      }
    }
  }
  return [...ultima.values()];
}

/** Grava as leituras novas (mais recentes que a última guardada de cada janela). Devolve quantas gravou. */
export function importarCotasCodex(db: Banco, env: Env = process.env): number {
  let n = 0;
  const ins = db.prepare(
    "INSERT INTO limites_snapshots (provedor, run_id, janela, utilizacao, status, reinicia_em, capturado_em) VALUES ('codex', NULL, ?, ?, ?, ?, ?)"
  );
  for (const l of lerCotasCodex(env)) {
    const ult = db
      .prepare("SELECT MAX(capturado_em) AS t FROM limites_snapshots WHERE provedor = 'codex' AND janela = ?")
      .get(l.janela) as { t: string | null };
    if (ult.t && ult.t >= l.capturadoEm) continue;
    ins.run(l.janela, l.utilizacao, l.status, l.reiniciaEm, l.capturadoEm);
    n++;
  }
  return n;
}
