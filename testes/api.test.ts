import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Projeto } from '../src/shared/projetos.ts';
import { criarApp } from '../src/server/app.ts';
import { abrirBanco, type Banco } from '../src/server/db/banco.ts';
import { iniciarServidor } from '../src/server/servidor.ts';

const RAIZ_A = path.resolve(os.tmpdir(), 'proj-a');
const RAIZ_B = path.resolve(os.tmpdir(), 'proj-b');

let db: Banco;
let app: ReturnType<typeof criarApp>;

function pedir(caminho: string, init: RequestInit & { host?: string } = {}) {
  const { host = '127.0.0.1:4710', ...resto } = init;
  const headers = new Headers(resto.headers);
  headers.set('host', host);
  if (resto.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.request(`http://${host}${caminho}`, { ...resto, headers });
}

function postar(caminho: string, corpo: unknown, headers: Record<string, string> = {}) {
  return pedir(caminho, { method: 'POST', body: JSON.stringify(corpo), headers });
}

describe('API', () => {
  beforeEach(() => {
    db = abrirBanco(':memory:');
    app = criarApp({ db, caminhoBanco: ':memory:' });
  });
  afterEach(() => db.close());

  it('GET /api/saude informa versão e esquema', async () => {
    const res = await pedir('/api/saude');
    assert.equal(res.status, 200);
    const corpo = (await res.json()) as { ok: boolean; esquema: number; versao: string };
    assert.equal(corpo.ok, true);
    assert.equal(corpo.esquema, 1);
    assert.match(corpo.versao, /^2\./);
  });

  it('cria, lista, obtém e edita projeto', async () => {
    const criado = await postar('/api/projetos', { id: 'alfa', nome: 'Alfa', raiz: `${RAIZ_A}${path.sep}` });
    assert.equal(criado.status, 201);
    const p = (await criado.json()) as Projeto;
    assert.equal(p.raiz, RAIZ_A, 'barra final removida');
    assert.equal(p.arquivadoEm, null);

    const lista = (await (await pedir('/api/projetos')).json()) as Projeto[];
    assert.deepEqual(lista.map((x) => x.id), ['alfa']);

    assert.equal((await pedir('/api/projetos/alfa')).status, 200);
    assert.equal((await pedir('/api/projetos/nada')).status, 404);

    const editado = await pedir('/api/projetos/alfa', {
      method: 'PATCH',
      body: JSON.stringify({ nome: 'Alfa 2', arquivado: true }),
    });
    assert.equal(editado.status, 200);
    const e = (await editado.json()) as Projeto;
    assert.equal(e.nome, 'Alfa 2');
    assert.ok(e.arquivadoEm);

    assert.equal(((await (await pedir('/api/projetos')).json()) as Projeto[]).length, 0);
    assert.equal(((await (await pedir('/api/projetos?arquivados=1')).json()) as Projeto[]).length, 1);
  });

  it('valida entrada com 400 e mensagem', async () => {
    const r1 = await postar('/api/projetos', { id: 'Com Espaco', nome: 'x', raiz: RAIZ_A });
    assert.equal(r1.status, 400);
    const c1 = (await r1.json()) as { codigo: string; erro: string };
    assert.equal(c1.codigo, 'VALIDACAO');
    assert.match(c1.erro, /^id:/);

    const r2 = await postar('/api/projetos', { id: 'rel', nome: 'x', raiz: 'pasta/relativa' });
    assert.equal(r2.status, 400);

    const r3 = await pedir('/api/projetos', { method: 'POST', body: '{quebrado' });
    assert.equal(r3.status, 400);

    const r4 = await pedir('/api/projetos/alfa', { method: 'PATCH', body: '{}' });
    assert.equal(r4.status, 400);
  });

  it('recusa id ou pasta repetidos com 409', async () => {
    assert.equal((await postar('/api/projetos', { id: 'a', nome: 'A', raiz: RAIZ_A })).status, 201);
    assert.equal((await postar('/api/projetos', { id: 'a', nome: 'A', raiz: RAIZ_B })).status, 409);
    const mesmaPasta = await postar('/api/projetos', { id: 'b', nome: 'B', raiz: RAIZ_A.toUpperCase() });
    assert.equal(mesmaPasta.status, 409);
  });

  it('bloqueia host externo e escrita vinda de outra origem', async () => {
    assert.equal((await pedir('/api/saude', { host: 'evil.example:4710' })).status, 403);
    const cruzado = await postar('/api/projetos', { id: 'a', nome: 'A', raiz: RAIZ_A }, { origin: 'https://evil.example' });
    assert.equal(cruzado.status, 403);
    const local = await postar('/api/projetos', { id: 'a', nome: 'A', raiz: RAIZ_A }, { origin: 'http://localhost:5173' });
    assert.equal(local.status, 201);
  });

  it('rota de API inexistente devolve 404 em JSON', async () => {
    const res = await pedir('/api/nada');
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { codigo: string }).codigo, 'NAO_ENCONTRADO');
  });
});

describe('interface estática', () => {
  it('serve arquivos e devolve index.html nas rotas da SPA', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-web-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>painel</html>');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'console.log(1)');
    const banco = abrirBanco(':memory:');
    const web = criarApp({ db: banco, caminhoBanco: ':memory:', webDir: dir });
    try {
      const js = await web.request('http://127.0.0.1/assets/a.js');
      assert.equal(js.status, 200);
      assert.equal(await js.text(), 'console.log(1)');
      const spa = await web.request('http://127.0.0.1/projetos');
      assert.equal(spa.status, 200);
      assert.match(await spa.text(), /painel/);
    } finally {
      banco.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('servidor HTTP', () => {
  it('sobe numa porta livre, responde e encerra', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-srv-'));
    const s = await iniciarServidor({ caminhoBanco: path.join(dir, 'painel.db'), porta: 0 });
    try {
      assert.ok(s.porta > 0);
      const res = await fetch(`${s.url}/api/saude`);
      assert.equal(res.status, 200);
    } finally {
      await s.fechar();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falha com erro claro se a porta estiver ocupada', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-srv-'));
    const a = await iniciarServidor({ caminhoBanco: path.join(dir, 'a.db'), porta: 0 });
    try {
      await assert.rejects(
        iniciarServidor({ caminhoBanco: path.join(dir, 'b.db'), porta: a.porta }),
        /EADDRINUSE/
      );
    } finally {
      await a.fechar();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
