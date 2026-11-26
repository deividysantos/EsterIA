import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { atualizar, copiarBanco } from '../src/cli/atualizar.ts';
import { parsearArgs } from '../src/cli/painel.ts';
import { criarApp } from '../src/server/app.ts';
import { abrirBanco } from '../src/server/db/banco.ts';
import { headerHostAceito, hostAceito, lerHostsPermitidos, normalizarHost, origemAceita } from '../src/server/hosts.ts';
import { iniciarServidor, separarHosts } from '../src/server/servidor.ts';

let tmp: string;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-atu-'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('hosts permitidos', () => {
  it('normaliza entradas e lê do ambiente com extras', () => {
    assert.equal(normalizarHost(' https://PC.tail1234.ts.net:443/ '), 'pc.tail1234.ts.net');
    assert.equal(normalizarHost('100.64.1.2:4710'), '100.64.1.2');
    assert.equal(normalizarHost('[fd7a::1]:4710'), '[fd7a::1]');
    assert.equal(normalizarHost('   '), null);
    assert.deepEqual(lerHostsPermitidos({ PAINEL_HOSTS_PERMITIDOS: 'a.ts.net, 100.1.1.1;a.ts.net' }, ['b.ts.net']), ['a.ts.net', '100.1.1.1', 'b.ts.net']);
  });

  it('aceita a máquina, os nomes liberados e curingas de subdomínio', () => {
    const lista = ['pc.tail1234.ts.net', '100.64.1.2', '*.casa.lan'];
    assert.ok(hostAceito('localhost', []));
    assert.ok(hostAceito('PC.tail1234.ts.net', lista));
    assert.ok(hostAceito('100.64.1.2', lista));
    assert.ok(hostAceito('nas.casa.lan', lista));
    assert.ok(!hostAceito('casa.lan', lista), 'o curinga não cobre o próprio domínio');
    assert.ok(!hostAceito('outro.ts.net', lista));
    assert.ok(headerHostAceito('pc.tail1234.ts.net:443', lista));
    assert.ok(!headerHostAceito(undefined, lista));
    assert.ok(origemAceita('https://pc.tail1234.ts.net', lista));
    assert.ok(!origemAceita('https://evil.example', lista));
    assert.ok(!origemAceita('file:///x', lista));
  });

  it('a API recusa hosts fora da lista e aceita os liberados (inclusive para escrita)', async () => {
    const db = abrirBanco(':memory:');
    try {
      const pedir = (app: ReturnType<typeof criarApp>, host: string, init: RequestInit = {}) =>
        app.request(`http://${host}/api/projetos`, { ...init, headers: { host, 'content-type': 'application/json', ...(init.headers ?? {}) } });
      const fechada = criarApp({ db, caminhoBanco: ':memory:', hostsPermitidos: [] });
      assert.equal((await pedir(fechada, 'pc.tail1234.ts.net')).status, 403);

      const aberta = criarApp({ db, caminhoBanco: ':memory:', hostsPermitidos: ['pc.tail1234.ts.net'] });
      assert.equal((await pedir(aberta, 'pc.tail1234.ts.net')).status, 200);
      const corpo = JSON.stringify({ id: 'cel', nome: 'Cel', raiz: path.join(tmp, 'cel') });
      const doCelular = await pedir(aberta, 'pc.tail1234.ts.net', { method: 'POST', body: corpo, headers: { origin: 'https://pc.tail1234.ts.net' } });
      assert.equal(doCelular.status, 201);
      const deFora = await pedir(aberta, 'pc.tail1234.ts.net', { method: 'POST', body: corpo, headers: { origin: 'https://evil.example' } });
      assert.equal(deFora.status, 403);
      assert.equal((await pedir(aberta, 'evil.example')).status, 403);
    } finally {
      db.close();
    }
  });

  it('servidor: --permitir vira lista e escutar num IP específico libera esse IP', async () => {
    assert.deepEqual(parsearArgs(['servidor', '--permitir', 'a.ts.net,b.ts.net', '--permitir=c']), { tipo: 'servidor', permitir: ['a.ts.net', 'b.ts.net', 'c'] });
    const s = await iniciarServidor({ caminhoBanco: path.join(tmp, 's.db'), porta: 0, verificarProvedores: false, iniciarMotor: false, permitir: ['pc.ts.net'] });
    try {
      assert.deepEqual(s.hostsPermitidos, ['pc.ts.net']);
      const saude = (await (await fetch(`${s.url}/api/saude`)).json()) as { commit: string | null; versao: string };
      assert.match(saude.versao, /^2\./);
      assert.ok(saude.commit === null || /^[0-9a-f]{4,}$/.test(saude.commit));
    } finally {
      await s.fechar();
    }
  });
});

describe('servidor em vários endereços', () => {
  it('separa a lista de hosts', () => {
    assert.deepEqual(separarHosts(undefined), ['127.0.0.1']);
    assert.deepEqual(separarHosts(' 127.0.0.1 , 100.1.2.3,127.0.0.1'), ['127.0.0.1', '100.1.2.3']);
    assert.deepEqual(separarHosts(['[::1]']), ['::1']);
    assert.deepEqual(separarHosts(''), ['127.0.0.1']);
  });

  it('escuta em todos na mesma porta, libera os IPs e fecha tudo', async () => {
    const s = await iniciarServidor({
      caminhoBanco: path.join(tmp, 'multi.db'),
      porta: 0,
      host: '127.0.0.1,127.0.0.2',
      verificarProvedores: false,
      iniciarMotor: false,
    });
    try {
      assert.equal(s.urls.length, 2);
      assert.equal(s.urls[1], s.urls[0]!.replace('127.0.0.1', '127.0.0.2'));
      assert.ok(s.hostsPermitidos.includes('127.0.0.2'));
      for (const u of s.urls) assert.equal((await fetch(`${u}/api/saude`)).status, 200);
    } finally {
      await s.fechar();
    }
    await assert.rejects(fetch(`${s.urls[1]}/api/saude`));
  });

  it('endereço que não existe na máquina dá erro claro e não deixa nada aberto', async () => {
    await assert.rejects(
      iniciarServidor({ caminhoBanco: path.join(tmp, 'ruim.db'), porta: 0, host: '127.0.0.1,203.0.113.77', verificarProvedores: false, iniciarMotor: false }),
      /203\.0\.113\.77 não existe nesta máquina/
    );
  });
});

describe('painel atualizar', () => {
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

  /** Remoto + clone de trabalho, com package.json e lock iniciais. */
  function repos(nome: string) {
    const base = path.join(tmp, nome);
    const remoto = path.join(base, 'remoto.git');
    const autor = path.join(base, 'autor');
    const clone = path.join(base, 'painel');
    fs.mkdirSync(autor, { recursive: true });
    git(base, 'init', '-q', '--bare', '-b', 'main', remoto);
    git(autor, 'init', '-q', '-b', 'main');
    for (const d of [autor]) {
      git(d, 'config', 'user.email', 't@exemplo.invalid');
      git(d, 'config', 'user.name', 'T');
      git(d, 'config', 'commit.gpgsign', 'false');
    }
    fs.writeFileSync(path.join(autor, 'package.json'), JSON.stringify({ name: 'x', version: '2.1.0' }));
    fs.writeFileSync(path.join(autor, 'package-lock.json'), '{"v":1}');
    fs.writeFileSync(path.join(autor, 'a.txt'), '1');
    git(autor, 'add', '.');
    git(autor, 'commit', '-q', '-m', 'inicial');
    git(autor, 'remote', 'add', 'origin', remoto);
    git(autor, 'push', '-q', 'origin', 'main');
    git(base, 'clone', '-q', remoto, clone);
    // Como se já estivesse instalado: dependências e build presentes.
    fs.mkdirSync(path.join(clone, 'node_modules'));
    fs.mkdirSync(path.join(clone, 'dist', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(clone, 'dist', 'cli', 'painel.js'), '');
    const publicar = (arquivos: Record<string, string>, msg: string) => {
      for (const [a, c] of Object.entries(arquivos)) fs.writeFileSync(path.join(autor, a), c);
      git(autor, 'add', '.');
      git(autor, 'commit', '-q', '-m', msg);
      git(autor, 'push', '-q', 'origin', 'main');
    };
    const dados = path.join(base, 'dados');
    fs.mkdirSync(dados);
    const env = { ...process.env, PAINEL_DADOS_DIR: dados, PAINEL_URL: 'http://127.0.0.1:9' };
    return { clone, publicar, env, dados };
  }

  function npmFalso() {
    const chamadas: string[] = [];
    return { chamadas, npm: async (args: readonly string[]) => (chamadas.push(args.join(' ')), { codigo: 0, saida: '' }) };
  }

  it('sem novidade: não roda npm, mas copia o banco', async () => {
    const r = repos('nada');
    abrirBanco(path.join(r.dados, 'painel.db')).close();
    const n = npmFalso();
    const res = await atualizar([], { env: r.env, raiz: r.clone, npm: n.npm });
    assert.equal(res.ok, true, res.linhas.map((l) => l.texto).join('\n'));
    assert.deepEqual(n.chamadas, []);
    assert.ok(res.linhas.some((l) => /já estava na versão mais recente/.test(l.texto)));
    const copias = fs.readdirSync(path.join(r.dados, 'backups'));
    assert.equal(copias.length, 1);
    assert.match(copias[0]!, /^painel-\d{8}-\d{6}\.db$/);
  });

  it('código novo: pull, build; npm ci só quando o lock muda', async () => {
    const r = repos('novo');
    r.publicar({ 'a.txt': '2' }, 'muda a');
    const n1 = npmFalso();
    const res1 = await atualizar(['--sem-backup'], { env: r.env, raiz: r.clone, npm: n1.npm });
    assert.equal(res1.ok, true, res1.linhas.map((l) => l.texto).join('\n'));
    assert.deepEqual(n1.chamadas, ['run build']);
    assert.ok(res1.linhas.some((l) => /Código atualizado: \w+ → \w+/.test(l.texto)));
    assert.ok(res1.linhas.some((l) => /muda a/.test(l.texto)));
    assert.equal(fs.readFileSync(path.join(r.clone, 'a.txt'), 'utf8'), '2');

    r.publicar({ 'package-lock.json': '{"v":2}', 'package.json': JSON.stringify({ name: 'x', version: '2.2.0' }) }, 'deps');
    const n2 = npmFalso();
    const res2 = await atualizar(['--sem-backup'], { env: r.env, raiz: r.clone, npm: n2.npm });
    assert.deepEqual(n2.chamadas, ['ci', 'run build']);
    assert.ok(res2.linhas.some((l) => /Versão 2\.2\.0/.test(l.texto)));
  });

  it('para com mudança local no código (a não ser com --forcar)', async () => {
    const r = repos('sujo');
    fs.writeFileSync(path.join(r.clone, 'a.txt'), 'mexido');
    const n = npmFalso();
    const res = await atualizar([], { env: r.env, raiz: r.clone, npm: n.npm });
    assert.equal(res.ok, false);
    assert.match(res.linhas.at(-1)!.texto, /mudanças locais/);
    assert.match(res.linhas.at(-1)!.dica!, /a\.txt/);
    assert.deepEqual(n.chamadas, []);
  });

  it('para se houver etapa rodando na fila', async () => {
    const r = repos('fila');
    const falso = await import('node:http');
    const srv = falso.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/saude') res.end(JSON.stringify({ ok: true, versao: '2.1.0', commit: 'abc' }));
      else res.end(JSON.stringify({ rodando: [{}], aguardandoVoce: [], bloqueados: [], cotas: [], naFila: 0, limites: {} }));
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    try {
      const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
      const res = await atualizar([], { env: r.env, raiz: r.clone, url, npm: npmFalso().npm });
      assert.equal(res.ok, false);
      assert.match(res.linhas.at(-1)!.texto, /1 etapa\(s\) rodando/);
      const forcado = await atualizar(['--forcar', '--sem-backup'], { env: r.env, raiz: r.clone, url, npm: npmFalso().npm });
      assert.equal(forcado.ok, true);
      assert.ok(forcado.linhas.some((l) => l.estado === 'aviso' && /ainda roda abc/.test(l.texto)), 'avisa para reiniciar');
    } finally {
      srv.close();
    }
  });

  it('cópias do banco: mantém só as 10 mais recentes', () => {
    const dir = path.join(tmp, 'copias');
    const banco = path.join(tmp, 'copias-banco.db');
    abrirBanco(banco).close();
    for (let i = 0; i < 12; i++) copiarBanco(banco, dir, new Date(Date.UTC(2026, 0, 1, 0, 0, i)));
    const lista = fs.readdirSync(dir).sort();
    assert.equal(lista.length, 10);
    assert.equal(lista[0], 'painel-20260101-000002.db');
    assert.equal(copiarBanco(path.join(tmp, 'nao-existe.db'), dir), null);
  });
});
