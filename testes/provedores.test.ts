import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, afterEach, describe, it } from 'node:test';

import type { Modelo, Provedor } from '../src/shared/provedores.ts';
import { criarApp } from '../src/server/app.ts';
import { abrirBanco, type Banco } from '../src/server/db/banco.ts';
import { detectarCaminho, extrairVersao, verificarCaminho } from '../src/server/provedores/deteccao.ts';
import { procurarNoPath, resolverExecucao, type Env } from '../src/server/provedores/executavel.ts';

const WIN = process.platform === 'win32';

let tmp: string;
let binDir: string;
let envFalso: Env;

/** Cria um CLI falso que imprime `saida` e termina com `codigo`. */
function criarCli(dir: string, nome: string, saida: string, codigo = 0): string {
  fs.mkdirSync(dir, { recursive: true });
  if (WIN) {
    const p = path.join(dir, `${nome}.cmd`);
    fs.writeFileSync(p, `@echo off\r\necho ${saida}\r\nexit /b ${codigo}\r\n`);
    return p;
  }
  const p = path.join(dir, nome);
  fs.writeFileSync(p, `#!/bin/sh\necho "${saida}"\nexit ${codigo}\n`, { mode: 0o755 });
  return p;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-prov-'));
  binDir = path.join(tmp, 'bin');
  fs.mkdirSync(binDir);
  // Ambiente isolado: PATH e pastas de usuário apontam para o temporário, então nenhum CLI real é achado.
  envFalso = {
    ...process.env,
    PATH: binDir,
    Path: undefined,
    USERPROFILE: tmp,
    HOME: tmp,
    LOCALAPPDATA: path.join(tmp, 'local'),
    APPDATA: path.join(tmp, 'roaming'),
  };
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('executável', () => {
  it('procura no PATH respeitando a ordem das extensões', () => {
    const dir = path.join(tmp, 'ordem');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'ferramenta.cmd'), '');
    fs.writeFileSync(path.join(dir, 'ferramenta.exe'), '');
    assert.equal(procurarNoPath('ferramenta', { PATH: dir }, 'win32'), path.join(dir, 'ferramenta.exe'));
    assert.equal(procurarNoPath('inexistente', { PATH: dir }, 'win32'), null);
  });

  it('resolve .cmd via cmd.exe, .ps1 via PowerShell e .exe direto', () => {
    const cmd = resolverExecucao('C:\\x\\a b\\tool.cmd', ['--model', 'x y'], { ComSpec: 'C:\\W\\cmd.exe' });
    assert.equal(cmd.arquivo, 'C:\\W\\cmd.exe');
    assert.equal(cmd.verbatim, true);
    assert.deepEqual(cmd.args, ['/d', '/s', '/c', '""C:\\x\\a b\\tool.cmd" --model "x y""']);
    assert.throws(() => resolverExecucao('C:\\t.cmd', ['a"b'], {}), /aspas/);

    const ps = resolverExecucao('C:\\x\\tool.ps1', ['--version'], {});
    assert.equal(ps.arquivo, 'powershell.exe');
    assert.deepEqual(ps.args.slice(-3), ['-File', 'C:\\x\\tool.ps1', '--version']);

    const exe = resolverExecucao('C:\\x\\agy.exe', ['-p', 'oi'], {});
    assert.deepEqual([exe.arquivo, exe.args, exe.verbatim], ['C:\\x\\agy.exe', ['-p', 'oi'], false]);
  });

  it('cursor-agent.ps1 vira node.exe + index.js da versão mais nova', () => {
    const dir = path.join(tmp, 'cursor-agent');
    for (const v of ['2026.01.02-aaa111', '2026.03.04-10-00-00-bbb222', 'lixo']) {
      fs.mkdirSync(path.join(dir, 'versions', v), { recursive: true });
      if (v !== 'lixo') {
        fs.writeFileSync(path.join(dir, 'versions', v, 'node.exe'), '');
        fs.writeFileSync(path.join(dir, 'versions', v, 'index.js'), '');
      }
    }
    const script = path.join(dir, 'cursor-agent.ps1');
    fs.writeFileSync(script, '');
    const r = resolverExecucao(script, ['-p', 'x'], { LOCALAPPDATA: 'C:\\L' });
    const nova = path.join(dir, 'versions', '2026.03.04-10-00-00-bbb222');
    assert.equal(r.arquivo, path.join(nova, 'node.exe'));
    assert.deepEqual(r.args, [path.join(nova, 'index.js'), '-p', 'x']);
    assert.equal(r.envExtra.CURSOR_INVOKED_AS, 'cursor-agent.ps1');
  });
});

describe('detecção e verificação', () => {
  it('extrai versão da saída', () => {
    assert.equal(extrairVersao('2.1.4 (Claude Code)'), '2.1.4');
    assert.equal(extrairVersao('codex-cli 0.98.0'), '0.98.0');
    assert.equal(extrairVersao('2026.03.04-10-00-00-bbb222'), '2026.03.04-10-00-00-bbb222');
    assert.equal(extrairVersao('sem versão'), null);
  });

  it('acha o CLI no PATH e em local conhecido', () => {
    assert.equal(detectarCaminho('codex', envFalso), null);
    const codex = criarCli(binDir, 'codex', 'codex-cli 0.98.0');
    assert.equal(detectarCaminho('codex', envFalso), codex);
    fs.rmSync(codex);

    const agy = path.join(envFalso.LOCALAPPDATA!, 'agy', 'bin', 'agy.exe');
    fs.mkdirSync(path.dirname(agy), { recursive: true });
    fs.writeFileSync(agy, '');
    assert.equal(detectarCaminho('antigravity', envFalso), agy);
    fs.rmSync(path.join(envFalso.LOCALAPPDATA!, 'agy'), { recursive: true });
  });

  it('verifica com --version e relata falhas', async () => {
    const ok = criarCli(path.join(tmp, 'v'), 'bom', 'fake-cli 1.2.3');
    const r = await verificarCaminho(ok, { env: envFalso });
    assert.equal(r.ok, true, r.erro ?? '');
    assert.equal(r.versao, '1.2.3');

    const ruim = criarCli(path.join(tmp, 'v'), 'ruim', 'quebrou', 3);
    const r2 = await verificarCaminho(ruim, { env: envFalso });
    assert.equal(r2.ok, false);
    assert.match(r2.erro!, /código 3/);

    assert.match((await verificarCaminho(path.join(tmp, 'nada.exe'))).erro!, /não encontrado/);
    assert.match((await verificarCaminho('relativo.exe')).erro!, /absoluto/);
  });
});

describe('API de provedores', () => {
  let db: Banco;
  let app: ReturnType<typeof criarApp>;
  const pedir = (caminho: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1${caminho}`, {
      ...init,
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    });
  const patch = (caminho: string, corpo: unknown) => pedir(caminho, { method: 'PATCH', body: JSON.stringify(corpo) });

  beforeEach(() => {
    db = abrirBanco(':memory:');
    app = criarApp({ db, caminhoBanco: ':memory:', env: envFalso });
  });
  afterEach(() => db.close());

  it('lista os 4 provedores, nenhum habilitado antes de verificar', async () => {
    const lista = (await (await pedir('/api/provedores')).json()) as Provedor[];
    assert.deepEqual(lista.map((p) => p.id), ['claude', 'cursor', 'antigravity', 'codex']);
    assert.ok(lista.every((p) => p.estado === 'nao_encontrado' && !p.habilitado));
  });

  it('caminho manual válido habilita; desativar e limpar mudam o estado', async () => {
    const cli = criarCli(path.join(tmp, 'manual'), 'claude-falso', 'claude 9.9.9');
    let p = (await (await patch('/api/provedores/claude', { caminho: cli })).json()) as Provedor;
    assert.equal(p.estado, 'habilitado', p.erro ?? '');
    assert.equal(p.versao, '9.9.9');
    assert.equal(p.caminhoEmUso, cli);

    p = (await (await patch('/api/provedores/claude', { ativo: false })).json()) as Provedor;
    assert.equal(p.estado, 'desativado');
    assert.equal(p.habilitado, false);

    p = (await (await patch('/api/provedores/claude', { caminho: '', ativo: true })).json()) as Provedor;
    assert.equal(p.caminho, null);
    assert.equal(p.estado, 'nao_encontrado');
  });

  it('caminho inexistente fica em erro', async () => {
    const p = (await (await patch('/api/provedores/cursor', { caminho: path.join(tmp, 'x.exe') })).json()) as Provedor;
    assert.equal(p.estado, 'erro');
    assert.match(p.erro!, /não encontrado/);
  });

  it('verificar todos usa o caminho detectado no PATH', async () => {
    const cli = criarCli(binDir, 'agy', 'agy 1.0.0');
    try {
      const lista = (await (await pedir('/api/provedores/verificar', { method: 'POST' })).json()) as Provedor[];
      const agy = lista.find((p) => p.id === 'antigravity')!;
      assert.equal(agy.caminhoDetectado, cli);
      assert.equal(agy.estado, 'habilitado', agy.erro ?? '');
      assert.equal(lista.find((p) => p.id === 'codex')!.estado, 'nao_encontrado');
    } finally {
      fs.rmSync(cli);
    }
  });

  it('id de provedor inválido dá 400', async () => {
    assert.equal((await pedir('/api/provedores/gemini')).status, 400);
  });
});

describe('API de modelos', () => {
  let db: Banco;
  let app: ReturnType<typeof criarApp>;
  const pedir = (caminho: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1${caminho}`, {
      ...init,
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    });
  const enviar = (metodo: string, caminho: string, corpo: unknown) =>
    pedir(caminho, { method: metodo, body: JSON.stringify(corpo) });

  beforeEach(() => {
    db = abrirBanco(':memory:');
    app = criarApp({ db, caminhoBanco: ':memory:', env: envFalso });
  });
  afterEach(() => db.close());

  it('vem com o catálogo inicial, sem notas inventadas', async () => {
    const todos = (await (await pedir('/api/modelos')).json()) as Modelo[];
    assert.equal(todos.length, 10);
    assert.ok(todos.every((m) => m.notaCusto === null && m.notaQualidade === null));
    const cursor = (await (await pedir('/api/modelos?provedor=cursor')).json()) as Modelo[];
    assert.ok(cursor.length === 3 && cursor.every((m) => m.familia === 'grok'));
  });

  it('cria, edita e exclui', async () => {
    const res = await enviar('POST', '/api/modelos', {
      provedor: 'codex',
      codigo: 'gpt-teste',
      nome: 'GPT teste',
      familia: 'GPT',
      notaQualidade: 4,
      tags: ['Execucao', 'execucao'],
      precoEntrada: 1.25,
    });
    assert.equal(res.status, 201);
    const m = (await res.json()) as Modelo;
    assert.equal(m.familia, 'gpt');
    assert.deepEqual(m.tags, ['execucao']);
    assert.equal(m.precoEntrada, 1.25);
    assert.equal(m.ativo, true);

    const ed = (await (await enviar('PATCH', `/api/modelos/${m.id}`, { notaCusto: 2, ativo: false })).json()) as Modelo;
    assert.equal(ed.notaCusto, 2);
    assert.equal(ed.notaQualidade, 4);
    assert.equal(ed.ativo, false);

    assert.equal((await pedir(`/api/modelos/${m.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await pedir(`/api/modelos/${m.id}`, { method: 'DELETE' })).status, 404);
  });

  it('valida e recusa código repetido no mesmo provedor', async () => {
    const base = { provedor: 'cursor', codigo: 'cursor-grok-4.6-high', nome: 'x', familia: 'grok' };
    assert.equal((await enviar('POST', '/api/modelos', base)).status, 409);
    assert.equal((await enviar('POST', '/api/modelos', { ...base, codigo: 'novo', notaCusto: 7 })).status, 400);
    assert.equal((await enviar('POST', '/api/modelos', { ...base, codigo: 'novo', familia: 'a b' })).status, 400);
    assert.equal((await enviar('POST', '/api/modelos', { ...base, provedor: 'gemini' })).status, 400);
  });
});
