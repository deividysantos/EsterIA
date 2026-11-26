import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { IdProvedor } from '../src/shared/provedores.ts';
import type { DetalheRun, MensagemAoVivo, RelatorioUsage, Run } from '../src/shared/runs.ts';
import { criarApp } from '../src/server/app.ts';
import { AoVivo } from '../src/server/aoVivo.ts';
import { abrirBanco, type Banco } from '../src/server/db/banco.ts';
import { listarModelos, editarModelo } from '../src/server/db/modelos.ts';
import { editarProvedor } from '../src/server/db/provedores.ts';
import { detalharRun, inserirRun, marcarInterrompidos, obterRun } from '../src/server/db/runs.ts';
import { verificarProvedor } from '../src/server/provedores/servico.ts';
import { estimarCusto, Executor } from '../src/server/runs/executor.ts';
import type { Env } from '../src/server/provedores/executavel.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const AMOSTRAS = path.join(AQUI, 'amostras');
const CLI_FALSO = path.join(AQUI, 'apoio', 'cli-falso.mjs');
const WIN = process.platform === 'win32';

let tmp: string;
let trabalho: string;

/** Wrapper que chama o CLI falso com o Node atual (`.cmd` no Windows). */
function criarWrapper(nome: string): string {
  const dir = path.join(tmp, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  if (WIN) {
    const p = path.join(dir, `${nome}.cmd`);
    fs.writeFileSync(p, `@echo off\r\nif "%1"=="--version" (echo ${nome} 1.0.0 & exit /b 0)\r\n"${process.execPath}" "${CLI_FALSO}" %*\r\n`);
    return p;
  }
  const p = path.join(dir, nome);
  fs.writeFileSync(p, `#!/bin/sh\n[ "$1" = "--version" ] && echo "${nome} 1.0.0" && exit 0\nexec "${process.execPath}" "${CLI_FALSO}" "$@"\n`, { mode: 0o755 });
  return p;
}

/** Estrutura de instalação do cursor-agent: script + versions/<v>/{node.exe,index.js}. */
function criarCursorFalso(): string {
  const dir = path.join(tmp, 'cursor-agent');
  const versao = path.join(dir, 'versions', '2026.01.01-abc123');
  fs.mkdirSync(versao, { recursive: true });
  const node = path.join(versao, 'node.exe');
  try {
    fs.linkSync(process.execPath, node);
  } catch {
    fs.copyFileSync(process.execPath, node);
  }
  fs.writeFileSync(path.join(versao, 'index.js'), `import(${JSON.stringify(new URL(`file:///${CLI_FALSO.replace(/\\/g, '/')}`).href)});\n`);
  // index.js é CommonJS por padrão; o import dinâmico carrega o falso (ESM).
  const script = path.join(dir, 'cursor-agent.ps1');
  fs.writeFileSync(script, '# falso\n');
  return script;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-exec-'));
  trabalho = path.join(tmp, 'trabalho com espaço');
  fs.mkdirSync(trabalho);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('executor', () => {
  let db: Banco;
  let aoVivo: AoVivo;
  let executor: Executor;
  let mensagens: MensagemAoVivo[];
  let env: Env;

  async function habilitar(provedor: IdProvedor, caminho: string) {
    editarProvedor(db, provedor, { caminho });
    const p = await verificarProvedor(db, provedor, { env });
    assert.equal(p.estado, 'habilitado', `${provedor}: ${p.erro ?? p.estado}`);
  }

  const modelo = (provedor: IdProvedor) => listarModelos(db, { provedor })[0]!;

  beforeEach(() => {
    db = abrirBanco(':memory:');
    aoVivo = new AoVivo();
    mensagens = [];
    aoVivo.assinar((m) => mensagens.push(m));
    env = { ...process.env, FAKE_MODO: 'replay', FAKE_ATRASO_MS: '0' };
    executor = new Executor(db, aoVivo, env);
  });
  afterEach(async () => {
    await executor.encerrar();
    db.close();
  });

  it('roda o Claude falso, grava eventos, usage, custo do CLI e publica ao vivo', async () => {
    await habilitar('claude', criarWrapper('claude-falso'));
    const registro = path.join(tmp, 'reg-claude.json');
    executor = new Executor(db, aoVivo, { ...env, FAKE_ARQUIVO: path.join(AMOSTRAS, 'claude.ndjson'), FAKE_REGISTRO: registro });
    const m = modelo('claude');
    const inicial = executor.iniciar({ modeloId: m.id, projeto: null, cwd: trabalho, modo: 'leitura', prompt: 'Leia "a.txt"\ne responda', sessao: null, timeoutMin: null });
    assert.equal(inicial.estado, 'rodando');
    assert.ok(inicial.pid);

    const r = await executor.aguardar(inicial.id);
    assert.equal(r.estado, 'concluido', r.erro ?? '');
    assert.equal(r.codigoSaida, 0);
    assert.equal(r.sessao, 'bfe965d7-e356-4e14-83e5-a31b94fa00e0');
    assert.equal(r.custoUsd, 0.00451262);
    assert.equal(r.custoOrigem, 'cli');
    assert.equal(r.usage.cacheLeitura, 70142);
    assert.equal(r.resultadoTexto, 'conteudo-secreto-42');
    assert.equal(r.modo, 'leitura');
    assert.ok(r.duracaoMs !== null && r.duracaoMs >= 0);

    const reg = JSON.parse(fs.readFileSync(registro, 'utf8')) as { argv: string[]; stdin: string; cwd: string };
    assert.equal(reg.stdin, 'Leia "a.txt"\ne responda', 'prompt com aspas e quebra de linha chega intacto pela entrada padrão');
    assert.equal(path.resolve(reg.cwd), path.resolve(trabalho));
    assert.ok(reg.argv.includes('claude-haiku-5-5') || reg.argv.includes(m.codigo));

    const d = detalharRun(db, r.id);
    assert.equal(d.eventos.length, 6);
    assert.deepEqual(d.eventos.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
    const lim = db.prepare('SELECT COUNT(*) AS n FROM limites_snapshots WHERE run_id = ?').get(r.id) as { n: number };
    assert.equal(lim.n, 2);

    assert.ok(mensagens.some((x) => x.tipo === 'evento'));
    const ultimo = mensagens.filter((x): x is Extract<MensagemAoVivo, { tipo: 'run' }> => x.tipo === 'run').at(-1)!;
    assert.equal(ultimo.run.estado, 'concluido');
  });

  it('Cursor via node.exe + index.js, sem shell, com prompt na linha de comando', async () => {
    await habilitar('cursor', criarCursorFalso());
    const registro = path.join(tmp, 'reg-cursor.json');
    executor = new Executor(db, aoVivo, { ...env, FAKE_ARQUIVO: path.join(AMOSTRAS, 'cursor.ndjson'), FAKE_REGISTRO: registro });
    const m = modelo('cursor');
    // Sem preço no modelo e sem custo do CLI: custo fica vazio. Com preço, estimado.
    editarModelo(db, m.id, { precoEntrada: 2, precoSaida: 10, precoCacheLeitura: 0.5 });
    const r = await executor.aguardar(
      executor.iniciar({ modeloId: m.id, projeto: null, cwd: trabalho, modo: 'escrita', prompt: 'faça "x" & y', sessao: 'retomar-1', timeoutMin: null }).id
    );
    assert.equal(r.estado, 'concluido', r.erro ?? '');
    const reg = JSON.parse(fs.readFileSync(registro, 'utf8')) as { argv: string[] };
    assert.deepEqual(reg.argv.slice(0, 2), ['-p', 'faça "x" & y']);
    assert.ok(reg.argv.includes('--force') && reg.argv.includes('--resume') && reg.argv.includes('retomar-1'));
    assert.equal(r.sessaoRetomada, 'retomar-1');
    assert.equal(r.custoOrigem, 'estimado');
    const esperado = (9970 * 2 + 256 * 10 + 17152 * 0.5) / 1e6;
    assert.ok(Math.abs(r.custoUsd! - esperado) < 1e-12);
    assert.ok(r.comando.includes('<prompt>') && !r.comando.includes('faça "x" & y'));
  });

  it('CLI que falha: estado falhou, código e stderr guardados', async () => {
    await habilitar('codex', criarWrapper('codex-falso'));
    executor = new Executor(db, aoVivo, { ...env, FAKE_MODO: 'falhar' });
    const r = await executor.aguardar(
      executor.iniciar({ modeloId: (await criarModeloCodex()).id, projeto: null, cwd: trabalho, modo: 'leitura', prompt: 'p', sessao: null, timeoutMin: null }).id
    );
    assert.equal(r.estado, 'falhou');
    assert.equal(r.codigoSaida, 2);
    assert.match(r.erro!, /código 2.*credencial ausente/);
    const d = detalharRun(db, r.id);
    assert.match(d.stderr, /falha simulada/);
    assert.equal(d.eventos[0]!.tipo, 'outro');
  });

  async function criarModeloCodex() {
    const { criarModelo } = await import('../src/server/db/modelos.ts');
    const { novoModeloSchema } = await import('../src/shared/provedores.ts');
    return criarModelo(db, novoModeloSchema.parse({ provedor: 'codex', codigo: 'gpt-falso', nome: 'GPT falso', familia: 'gpt' }));
  }

  it('cancelar encerra a árvore de processos', async () => {
    await habilitar('claude', criarWrapper('claude-dorme'));
    executor = new Executor(db, aoVivo, { ...env, FAKE_MODO: 'dormir' });
    const run = executor.iniciar({ modeloId: modelo('claude').id, projeto: null, cwd: trabalho, modo: 'leitura', prompt: 'p', sessao: null, timeoutMin: null });
    // Espera o init chegar antes de cancelar.
    for (let i = 0; i < 100 && obterRun(db, run.id).sessao === null; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(obterRun(db, run.id).sessao, 'sessao-dormindo');
    executor.cancelar(run.id);
    const r = await executor.aguardar(run.id);
    assert.equal(r.estado, 'cancelado');
    assert.throws(() => executor.cancelar(run.id), /já terminou/);
  });

  it('recusa provedor desabilitado, modelo inativo e pasta inválida', async () => {
    const m = modelo('antigravity');
    assert.throws(
      () => executor.iniciar({ modeloId: m.id, projeto: null, cwd: trabalho, modo: 'leitura', prompt: 'p', sessao: null, timeoutMin: null }),
      /não está habilitado/
    );
    await habilitar('antigravity', criarWrapper('agy-falso'));
    assert.throws(
      () => executor.iniciar({ modeloId: m.id, projeto: null, cwd: path.join(tmp, 'nao-existe'), modo: 'leitura', prompt: 'p', sessao: null, timeoutMin: null }),
      /Pasta de trabalho inválida/
    );
    editarModelo(db, m.id, { ativo: false });
    assert.throws(
      () => executor.iniciar({ modeloId: m.id, projeto: null, cwd: trabalho, modo: 'leitura', prompt: 'p', sessao: null, timeoutMin: null }),
      /desativado/
    );
  });

  it('runs órfãos viram interrompidos ao reabrir', () => {
    const m = modelo('claude');
    inserirRun(db, {
      id: 'orfao', projeto: null, provedor: 'claude', modeloId: m.id, modeloCodigo: m.codigo, modeloNome: m.nome,
      familia: m.familia, papel: 'avulso', modo: 'leitura', cwd: trabalho, prompt: 'p', comando: [], sessaoRetomada: null, inicio: new Date(),
    });
    assert.equal(marcarInterrompidos(db), 1);
    assert.equal(obterRun(db, 'orfao').estado, 'interrompido');
  });
});

describe('estimarCusto', () => {
  const precos = { precoEntrada: 3, precoSaida: 15, precoCacheLeitura: null, precoCacheEscrita: 3.75 };
  it('usa o preço de entrada quando falta o de cache', () => {
    const u = { entrada: 1000, saida: 100, cacheLeitura: 2000, cacheEscrita: 400, raciocinio: 50 };
    assert.equal(estimarCusto(u, precos), (1000 * 3 + 100 * 15 + 2000 * 3 + 400 * 3.75) / 1e6);
  });
  it('sem preço de entrada ou saída não estima', () => {
    assert.equal(estimarCusto({ entrada: 1, saida: 1, cacheLeitura: null, cacheEscrita: null, raciocinio: null }, { ...precos, precoSaida: null }), null);
  });
});

describe('API de runs e usage', () => {
  let db: Banco;
  let app: ReturnType<typeof criarApp>;
  let executor: Executor;
  const pedir = (caminho: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1${caminho}`, { ...init, headers: { host: '127.0.0.1', 'content-type': 'application/json' } });

  beforeEach(() => {
    db = abrirBanco(':memory:');
    const env = { ...process.env, FAKE_MODO: 'replay', FAKE_ARQUIVO: path.join(AMOSTRAS, 'claude.ndjson') };
    const aoVivo = new AoVivo();
    executor = new Executor(db, aoVivo, env);
    app = criarApp({ db, caminhoBanco: ':memory:', env, aoVivo, executor });
  });
  afterEach(async () => {
    await executor.encerrar();
    db.close();
  });

  it('cria run no projeto (cwd = raiz), detalha, lista e agrega usage', async () => {
    const env = { ...process.env };
    editarProvedor(db, 'claude', { caminho: criarWrapper('claude-api') });
    await verificarProvedor(db, 'claude', { env });
    await pedir('/api/projetos', { method: 'POST', body: JSON.stringify({ id: 'p1', nome: 'P1', raiz: trabalho }) });
    const m = listarModelos(db, { provedor: 'claude' })[0]!;

    const res = await pedir('/api/runs', { method: 'POST', body: JSON.stringify({ modeloId: m.id, projeto: 'p1', modo: 'leitura', prompt: 'oi' }) });
    assert.equal(res.status, 201);
    const criado = (await res.json()) as Run;
    assert.equal(path.resolve(criado.cwd), path.resolve(trabalho));
    await executor.aguardar(criado.id);

    const d = (await (await pedir(`/api/runs/${criado.id}?apos=4`)).json()) as DetalheRun;
    assert.equal(d.run.estado, 'concluido');
    assert.deepEqual(d.eventos.map((e) => e.seq), [5, 6]);

    const lista = (await (await pedir('/api/runs?projeto=p1')).json()) as Run[];
    assert.equal(lista.length, 1);

    const u = (await (await pedir('/api/usage?dias=7')).json()) as RelatorioUsage;
    assert.equal(u.porModelo.length, 1);
    assert.equal(u.porModelo[0]!.runs, 1);
    assert.equal(u.porModelo[0]!.concluidos, 1);
    assert.equal(u.porModelo[0]!.custoUsd, 0.00451262);
    assert.equal(u.porDia.length, 1);
    assert.deepEqual(u.limites.map((l) => l.janela).sort(), ['five_hour', 'seven_day']);

    const bruto = await pedir(`/api/runs/${criado.id}/eventos/1/bruto`);
    assert.equal(bruto.status, 200);
  });

  it('valida o corpo e responde 404/409', async () => {
    assert.equal((await pedir('/api/runs', { method: 'POST', body: JSON.stringify({ modeloId: 1, modo: 'leitura', prompt: 'x' }) })).status, 400);
    assert.equal((await pedir('/api/runs', { method: 'POST', body: JSON.stringify({ modeloId: 1, cwd: trabalho, modo: 'x', prompt: 'x' }) })).status, 400);
    assert.equal((await pedir('/api/runs/nada')).status, 404);
    assert.equal((await pedir('/api/runs/nada/cancelar', { method: 'POST' })).status, 404);
  });
});
