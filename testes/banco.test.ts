import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { abrirBanco, aplicarMigracoes, versaoEsquema, VERSAO_ESQUEMA } from '../src/server/db/banco.ts';
import type { Migracao } from '../src/server/db/migracoes.ts';

describe('banco e migrações', () => {
  it('cria o banco em disco no esquema atual, com WAL e foreign keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-banco-'));
    const arquivo = path.join(dir, 'sub', 'painel.db');
    const db = abrirBanco(arquivo);
    try {
      assert.equal(versaoEsquema(db), VERSAO_ESQUEMA);
      assert.ok(fs.existsSync(arquivo));
      const wal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      assert.equal(wal.journal_mode, 'wal');
      const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      assert.equal(fk.foreign_keys, 1);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reabrir não reaplica migrações', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-banco-'));
    const arquivo = path.join(dir, 'painel.db');
    try {
      abrirBanco(arquivo).close();
      const db = abrirBanco(arquivo);
      assert.equal(versaoEsquema(db), VERSAO_ESQUEMA);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migração com erro é desfeita por inteiro e não avança a versão', () => {
    const quebrada: Migracao[] = [
      { versao: 1, nome: 'ok', aplicar: (db) => db.exec('CREATE TABLE a (x INTEGER)') },
      {
        versao: 2,
        nome: 'falha',
        aplicar: (db) => {
          db.exec('CREATE TABLE b (x INTEGER)');
          throw new Error('boom');
        },
      },
    ];
    const db = abrirBanco(':memory:', []);
    assert.throws(() => aplicarMigracoes(db, quebrada), /boom/);
    assert.equal(versaoEsquema(db), 1);
    const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    assert.deepEqual(tabelas.map((t) => t.name).sort(), ['a']);
    db.close();
  });

  it('recusa banco de esquema mais novo que o código', () => {
    const db = abrirBanco(':memory:');
    db.exec(`PRAGMA user_version = ${VERSAO_ESQUEMA + 1}`);
    assert.throws(() => aplicarMigracoes(db), /mais novo que este código/);
    db.close();
  });
});
