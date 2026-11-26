import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { abrirBanco, aplicarMigracoes } from '../src/server/db/banco.ts';
import { MIGRACOES } from '../src/server/db/migracoes.ts';
import { importarCotasCodex, leiturasDeEvento, lerCotasCodex } from '../src/server/provedores/cotaCodex.ts';

/** Linha no formato das sessões do Codex (sintético; o formato real não é oficial). */
const linha = (ts: string, p5h: number, psem: number) =>
  JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { input_tokens: 10 } },
      rate_limits: {
        primary: { used_percent: p5h, window_minutes: 300, resets_in_seconds: 3600 },
        secondary: { used_percent: psem, window_minutes: 10080, resets_at: 1_900_000_000 },
      },
    },
  });

describe('cota do Codex (sessões locais)', () => {
  it('interpreta primary/secondary e calcula o reinício', () => {
    const [p, s] = leiturasDeEvento(JSON.parse(linha('2026-11-25T10:00:00.000Z', 42.5, 10)));
    assert.deepEqual(p, { janela: 'five_hour', utilizacao: 0.425, status: null, reiniciaEm: '2026-11-25T11:00:00.000Z', capturadoEm: '2026-11-25T10:00:00.000Z' });
    assert.equal(s!.janela, 'seven_day');
    assert.equal(s!.reiniciaEm, new Date(1_900_000_000 * 1000).toISOString());
    assert.deepEqual(leiturasDeEvento({ type: 'event_msg', payload: { type: 'agent_message' } }), []);
    assert.deepEqual(leiturasDeEvento('lixo'), []);
  });

  it('lê a sessão mais recente e só grava leituras novas', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    const dir = path.join(home, 'sessions', '2026', '11', '25');
    fs.mkdirSync(dir, { recursive: true });
    const agora = Date.now();
    const t1 = new Date(agora - 60_000).toISOString();
    const t2 = new Date(agora - 30_000).toISOString();
    fs.writeFileSync(path.join(dir, 'rollout-a.jsonl'), [linha(t1, 20, 5), '{quebrado', linha(t2, 35, 6)].join('\n'));
    const env = { CODEX_HOME: home };

    const leituras = lerCotasCodex(env);
    assert.equal(leituras.find((l) => l.janela === 'five_hour')!.utilizacao, 0.35);

    const db = abrirBanco(':memory:');
    try {
      assert.equal(importarCotasCodex(db, env), 2);
      assert.equal(importarCotasCodex(db, env), 0, 'mesma leitura não duplica');
      assert.equal(lerCotasCodex({ CODEX_HOME: path.join(home, 'nada') }).length, 0);
    } finally {
      db.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('migração 7', () => {
  it('transforma pareceres antigos em itens sem avaliação', () => {
    const db = abrirBanco(':memory:', MIGRACOES.filter((m) => m.versao <= 6));
    try {
      const ts = new Date().toISOString();
      db.exec(`INSERT INTO projetos (id, nome, raiz, criado_em, atualizado_em) VALUES ('p', 'P', '/p', '${ts}', '${ts}')`);
      db.exec(`INSERT INTO esteiras (projeto, versao_atual, criado_em, atualizado_em) VALUES ('p', 1, '${ts}', '${ts}')`);
      db.exec(`INSERT INTO esteira_versoes (projeto, n, definicao_json, criado_em) VALUES ('p', 1, '{"etapas":[]}', '${ts}')`);
      db.exec(
        `INSERT INTO problemas (id, projeto, numero, titulo, descricao, estado, esteira_versao, criado_em, atualizado_em)
         VALUES ('x', 'p', 1, 't', 'd', 'concluido', 1, '${ts}', '${ts}')`
      );
      const parecer = JSON.stringify({ aprovado: false, problemas: [{ arquivo: 'a', linha: 3, severidade: 'baixa', descricao: 'd', sugestao: 's' }, { severidade: '??' }] });
      db.prepare(
        `INSERT INTO execucoes (problema, etapa_id, etapa_nome, tipo, tentativa, estado, saida_json, inicio) VALUES ('x', 'r', 'R', 'revisar', 1, 'reprovada', ?, ?)`
      ).run(parecer, ts);
      aplicarMigracoes(db);
      const itens = db.prepare('SELECT indice, arquivo, linha, severidade, decisao FROM parecer_itens ORDER BY indice').all();
      assert.deepEqual(
        itens.map((i) => ({ ...i })),
        [
          { indice: 0, arquivo: 'a', linha: 3, severidade: 'baixa', decisao: null },
          { indice: 1, arquivo: '', linha: null, severidade: 'media', decisao: null },
        ]
      );
    } finally {
      db.close();
    }
  });
});
