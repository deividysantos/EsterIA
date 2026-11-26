import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRACOES, VERSAO_ESQUEMA, type Migracao } from './migracoes.js';

export type Banco = DatabaseSync;

/**
 * Abre (ou cria) o banco, liga as pragmas e aplica as migrações pendentes.
 * `:memory:` é aceito para testes.
 */
export function abrirBanco(caminho: string, migracoes: readonly Migracao[] = MIGRACOES): Banco {
  if (caminho !== ':memory:') {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
  }
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (caminho !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  aplicarMigracoes(db, migracoes);
  return db;
}

export function versaoEsquema(db: Banco): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return Number(row?.user_version ?? 0);
}

export function aplicarMigracoes(db: Banco, migracoes: readonly Migracao[] = MIGRACOES): number {
  const atual = versaoEsquema(db);
  const maxima = migracoes.at(-1)?.versao ?? 0;
  if (atual > maxima) {
    throw new Error(
      `O banco está no esquema ${atual}, mais novo que este código (${maxima}). Atualize o painel.`
    );
  }
  for (const m of migracoes) {
    if (m.versao <= atual) continue;
    transacao(db, () => {
      m.aplicar(db);
      db.exec(`PRAGMA user_version = ${m.versao}`);
    });
  }
  return versaoEsquema(db);
}

/** Executa `fn` numa transação `BEGIN IMMEDIATE`; desfaz em caso de erro. */
export function transacao<T>(db: Banco, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export { VERSAO_ESQUEMA };
