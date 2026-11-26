import type { DatabaseSync } from 'node:sqlite';

export interface Migracao {
  versao: number;
  nome: string;
  aplicar(db: DatabaseSync): void;
}

/**
 * Migrações em ordem. Cada uma roda numa transação e avança `PRAGMA user_version`.
 * Nunca altere uma migração já publicada: crie a próxima.
 */
export const MIGRACOES: readonly Migracao[] = [
  {
    versao: 1,
    nome: 'projetos',
    aplicar(db) {
      db.exec(`
        CREATE TABLE projetos (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          raiz TEXT NOT NULL,
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL,
          arquivado_em TEXT
        ) STRICT;

        CREATE UNIQUE INDEX idx_projetos_raiz ON projetos(raiz COLLATE NOCASE);
      `);
    },
  },
];

export const VERSAO_ESQUEMA = MIGRACOES.at(-1)?.versao ?? 0;
