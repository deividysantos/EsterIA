import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { aplicarBloco, blocoClaude, FIM_BLOCO, iniciarProjeto, INICIO_BLOCO } from '../src/cli/init.ts';
import { lerOpcoes, projetoDaPasta, slug, ErroUso } from '../src/cli/comum.ts';
import { caminhosInstalacao, conteudoAtalho, instalar, NOME_MCP, type Rodar } from '../src/cli/instalar.ts';
import { doctor } from '../src/cli/doctor.ts';
import { criarServidorMcp, FERRAMENTAS } from '../src/cli/mcp.ts';
import { abrirBanco } from '../src/server/db/banco.ts';
import { obterEsteira } from '../src/server/db/esteiras.ts';
import { listarProjetos } from '../src/server/db/projetos.ts';
import { iniciarServidor, type ServidorAtivo } from '../src/server/servidor.ts';

const WIN = process.platform === 'win32';
let tmp: string;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-inst-'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function pasta(nome: string): string {
  const p = path.join(tmp, nome);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** URL de uma porta sem ninguém ouvindo: força o init a gravar direto no banco. */
const SEM_SERVICO = 'http://127.0.0.1:9';

describe('utilitários do comando', () => {
  it('lê opções, flags e posicionais', () => {
    assert.deepEqual(lerOpcoes(['x', '--id', 'a', '--nome=B C', '--sem-claude-md'], { id: 'valor', nome: 'valor', 'sem-claude-md': 'flag' }), {
      opcoes: { id: 'a', nome: 'B C', 'sem-claude-md': true },
      posicionais: ['x'],
    });
    assert.throws(() => lerOpcoes(['--zz'], {}), ErroUso);
    assert.throws(() => lerOpcoes(['--id'], { id: 'valor' }), /Valor ausente/);
  });

  it('gera id a partir do nome', () => {
    assert.equal(slug('Meu Projeto Ótimo!'), 'meu-projeto-otimo');
    assert.equal(slug('***'), 'projeto');
  });

  it('acha o projeto pelo marcador ou pela raiz mais específica', () => {
    const raiz = pasta('achar/app');
    const sub = pasta('achar/app/src/modulo');
    const projetos = [
      { id: 'pai', raiz: path.join(tmp, 'achar') },
      { id: 'app', raiz },
    ];
    assert.equal(projetoDaPasta(sub, projetos), 'app');
    fs.mkdirSync(path.join(raiz, '.agentes'), { recursive: true });
    fs.writeFileSync(path.join(raiz, '.agentes', 'projeto.json'), JSON.stringify({ id: 'pai' }));
    assert.equal(projetoDaPasta(sub, projetos), 'pai', 'o marcador vence');
    assert.equal(projetoDaPasta(os.tmpdir(), projetos), null);
  });

  it('bloco do CLAUDE.md: cria, acrescenta, atualiza no lugar e preserva CRLF', () => {
    const b1 = blocoClaude('a', 'http://x');
    assert.equal(aplicarBloco('', b1).texto, `${b1}\n`);
    const r = aplicarBloco('# Projeto\r\nregras\r\n', b1);
    assert.ok(r.texto.startsWith('# Projeto\r\nregras\r\n\r\n<!-- painel-agentes:inicio -->\r\n'));
    assert.equal(aplicarBloco(r.texto, b1).mudou, false);
    const b2 = blocoClaude('b', 'http://y');
    const r2 = aplicarBloco(`${r.texto}depois\r\n`, b2);
    assert.equal(r2.texto.split(INICIO_BLOCO).length, 2);
    assert.match(r2.texto, /projeto `b`/);
    assert.ok(r2.texto.endsWith(`${FIM_BLOCO}\r\ndepois\r\n`) || r2.texto.includes(`${FIM_BLOCO}\r\n\r\ndepois`) || r2.texto.includes(`${FIM_BLOCO}\r\ndepois`));
  });
});

describe('painel init', () => {
  let env: NodeJS.ProcessEnv;
  beforeEach(() => {
    env = { ...process.env, PAINEL_DADOS_DIR: fs.mkdtempSync(path.join(tmp, 'dados-')) };
  });

  it('sem serviço: grava no banco, cria esteira, marcador e CLAUDE.md; repetir não duplica', async () => {
    const raiz = pasta('init-a/Minha API');
    fs.writeFileSync(path.join(raiz, 'CLAUDE.md'), '# Regras\n');
    const r1 = await iniciarProjeto([], { cwd: raiz, env, url: SEM_SERVICO });
    assert.equal(r1.id, 'minha-api');
    assert.match(r1.linhas[0]!, /serviço fora do ar/);
    assert.ok(r1.linhas.some((l) => /Esteira: criada \(v1, modelo padrão\)/.test(l)));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(raiz, '.agentes', 'projeto.json'), 'utf8')), { id: 'minha-api', nome: 'Minha API' });
    const md = fs.readFileSync(path.join(raiz, 'CLAUDE.md'), 'utf8');
    assert.ok(md.startsWith('# Regras\n\n<!-- painel-agentes:inicio -->'));

    const r2 = await iniciarProjeto([raiz], { cwd: tmp, env, url: SEM_SERVICO });
    assert.ok(r2.linhas.some((l) => /já cadastrado: minha-api/.test(l)));
    assert.ok(r2.linhas.some((l) => /Esteira: já existe/.test(l)));
    assert.ok(r2.linhas.some((l) => /projeto\.json: sem mudança/.test(l)));
    assert.ok(r2.linhas.some((l) => /CLAUDE\.md: sem mudança/.test(l)));

    const db = abrirBanco(path.join(env.PAINEL_DADOS_DIR!, 'painel.db'));
    try {
      assert.equal(listarProjetos(db).length, 1);
      assert.ok(obterEsteira(db, 'minha-api'));
    } finally {
      db.close();
    }
  });

  it('opções: id e nome, sem esteira, sem CLAUDE.md e cópia de outro projeto', async () => {
    const a = pasta('init-b/a');
    const b = pasta('init-b/b');
    const r = await iniciarProjeto(['--id', 'proj-a', '--nome', 'Projeto A', '--esteira', 'nenhuma', '--sem-claude-md'], { cwd: a, env, url: SEM_SERVICO });
    assert.equal(r.id, 'proj-a');
    assert.ok(!fs.existsSync(path.join(a, 'CLAUDE.md')));
    assert.ok(r.linhas.some((l) => /não criada/.test(l)));
    await assert.rejects(iniciarProjeto(['--esteira', 'copiar:proj-a'], { cwd: b, env, url: SEM_SERVICO }), /não tem esteira para copiar/);
    await iniciarProjeto(['--esteira', 'padrao'], { cwd: a, env, url: SEM_SERVICO });
    const rb = await iniciarProjeto(['--id', 'proj-b', '--esteira', 'copiar:proj-a', '--sem-claude-md'], { cwd: b, env, url: SEM_SERVICO });
    assert.ok(rb.linhas.some((l) => /cópia de proj-a/.test(l)));
    await assert.rejects(iniciarProjeto(['--esteira', 'outra'], { cwd: b, env, url: SEM_SERVICO }), /--esteira aceita/);
    await assert.rejects(iniciarProjeto([path.join(tmp, 'nao-existe')], { cwd: b, env, url: SEM_SERVICO }), /Pasta não encontrada/);
  });

  it('com o serviço no ar: usa a API', async () => {
    const s = await iniciarServidor({ caminhoBanco: path.join(env.PAINEL_DADOS_DIR!, 'svc.db'), porta: 0, verificarProvedores: false, iniciarMotor: false });
    try {
      const raiz = pasta('init-c/web');
      const r = await iniciarProjeto(['--sem-claude-md'], { cwd: raiz, env, url: s.url });
      assert.match(r.linhas[0]!, /Usando o serviço em/);
      assert.equal(listarProjetos(s.db)[0]!.id, 'web');
      assert.ok(obterEsteira(s.db, 'web'));
    } finally {
      await s.fechar();
    }
  });
});

describe('painel mcp', () => {
  let s: ServidorAtivo;
  let raiz: string;
  let mcp: ReturnType<typeof criarServidorMcp>;
  const chamar = async (name: string, args: object = {}) => {
    const r = (await mcp.tratar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    return r.result;
  };

  beforeEach(async () => {
    const dados = fs.mkdtempSync(path.join(tmp, 'mcp-'));
    s = await iniciarServidor({ caminhoBanco: path.join(dados, 'painel.db'), porta: 0, verificarProvedores: false, iniciarMotor: false });
    raiz = pasta(`mcp-proj-${path.basename(dados)}`);
    await iniciarProjeto(['--sem-claude-md'], { cwd: raiz, env: { ...process.env, PAINEL_DADOS_DIR: dados }, url: s.url });
    mcp = criarServidorMcp({ url: s.url, cwd: path.join(raiz) });
  });
  afterEach(async () => s.fechar());

  it('responde ao protocolo: initialize, ping, tools/list, notificações e erros', async () => {
    const ini = (await mcp.tratar({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    assert.equal(ini.result.protocolVersion, '2025-03-26');
    assert.equal(ini.result.serverInfo.name, 'painel-agentes');
    assert.deepEqual(await mcp.tratar({ jsonrpc: '2.0', id: 2, method: 'ping' }), { jsonrpc: '2.0', id: 2, result: {} });
    assert.equal(await mcp.tratar({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const lista = (await mcp.tratar({ jsonrpc: '2.0', id: 3, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
    assert.deepEqual(lista.result.tools.map((t) => t.name), FERRAMENTAS.map((t) => t.name));
    assert.equal(((await mcp.tratar({ jsonrpc: '2.0', id: 4, method: 'xyz' })) as { error: { code: number } }).error.code, -32601);
    assert.equal(((await mcp.tratar({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nada' } })) as { error: { code: number } }).error.code, -32602);
  });

  it('cria problema no projeto da pasta, lista e mostra o estado', async () => {
    const projetos = await chamar('listar_projetos');
    assert.match(projetos.content[0]!.text, /\(pasta atual\)/);
    const criado = await chamar('criar_problema', { titulo: 'Corrigir bug', descricao: 'O botão não salva.' });
    assert.ok(!criado.isError, criado.content[0]!.text);
    const id = /Problema criado: (p_[0-9a-f]+)/.exec(criado.content[0]!.text)![1]!;
    await new Promise((r) => setTimeout(r, 100));
    const lista = await chamar('listar_problemas', { projeto: path.basename(raiz).toLowerCase() });
    assert.match(lista.content[0]!.text, new RegExp(id));
    // Sem CLI habilitado neste banco, o motor bloqueia no planejamento e o MCP mostra o motivo.
    const ver = await chamar('ver_problema', { id });
    assert.match(ver.content[0]!.text, /#1 "Corrigir bug" — bloqueado \(esteira v1\)/);
    assert.match(ver.content[0]!.text, /Bloqueado: Planejar: Claude Opus 5\.5 não está disponível/);
    const pausa = await chamar('acao_problema', { id, acao: 'pausar' });
    assert.match(pausa.content[0]!.text, /pausado/);
    const fila = await chamar('estado_fila');
    assert.match(fila.content[0]!.text, /Rodando \(0\/3\)/);
  });

  it('erros viram resultado com isError, sem derrubar o servidor', async () => {
    const fora = criarServidorMcp({ url: s.url, cwd: os.tmpdir() });
    const r = (await fora.tratar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'criar_problema', arguments: { titulo: 'x', descricao: 'y' } } })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0]!.text, /não pertence a nenhum projeto/);
    assert.equal((await chamar('ver_problema', { id: 'p_nada' })).isError, true);
    assert.match((await chamar('decidir', { execucao_id: 'x', acao: 'aprovar' })).content[0]!.text, /execucao_id/);
    const semServico = criarServidorMcp({ url: SEM_SERVICO, cwd: raiz });
    const r2 = (await semServico.tratar({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'estado_fila' } })) as { result: { isError: boolean; content: { text: string }[] } };
    assert.match(r2.result.content[0]!.text, /não respondeu/);
  });
});

describe('painel instalar e doctor', () => {
  function ambiente() {
    const dados = fs.mkdtempSync(path.join(tmp, 'inst-'));
    const bin = path.join(dados, 'cli');
    fs.mkdirSync(bin);
    // Claude falso só para o --version (o resto é interceptado por `rodar`).
    const claude = WIN ? path.join(bin, 'claude.cmd') : path.join(bin, 'claude');
    fs.writeFileSync(claude, WIN ? '@echo 9.9.9 (Claude Code)\r\n' : '#!/bin/sh\necho "9.9.9 (Claude Code)"\n', { mode: 0o755 });
    const env = { ...process.env, PAINEL_DADOS_DIR: dados, PATH: bin, Path: undefined, USERPROFILE: dados, HOME: dados, LOCALAPPDATA: dados, APPDATA: dados, PAINEL_URL: SEM_SERVICO };
    const chamadas: string[][] = [];
    const rodar: Rodar = async (arquivo, args) => {
      chamadas.push([path.basename(arquivo), ...args]);
      const c = caminhosInstalacao(env);
      return { codigo: 0, stdout: args[1] === 'get' ? `painel-agentes:\n  Command: ${c.node}\n  Args: ${c.entrada} mcp\n` : '', stderr: '', erro: null };
    };
    return { env, chamadas, rodar, claude };
  }

  it('instalar: cria o atalho, detecta o Claude e registra o MCP (de novo, sem duplicar)', async () => {
    const { env, chamadas, rodar } = ambiente();
    const r = await instalar([], { env, rodar });
    assert.equal(r.ok, true, r.linhas.map((l) => l.texto).join('\n'));
    const c = caminhosInstalacao(env);
    assert.equal(fs.readFileSync(c.atalho, 'utf8'), conteudoAtalho(c.node, c.entrada));
    assert.ok(r.linhas.some((l) => l.estado === 'aviso' && /não está no PATH/.test(l.texto)), 'avisa sem mexer no PATH');
    assert.ok(r.linhas.some((l) => l.estado === 'ok' && /Claude Code 9\.9\.9/.test(l.texto)));
    assert.deepEqual(chamadas.map((x) => x.slice(1, 3)), [['mcp', 'remove'], ['mcp', 'add']]);
    assert.deepEqual(chamadas[1]!.slice(-4), ['--', c.node, c.entrada, 'mcp']);
    assert.ok(chamadas[1]!.includes(NOME_MCP) && chamadas[1]!.includes('user'));

    const r2 = await instalar(['--sem-mcp'], { env, rodar });
    assert.ok(r2.linhas.some((l) => /Atalho já existia/.test(l.texto)));
    assert.ok(r2.linhas.some((l) => /--sem-mcp/.test(l.texto)));
    assert.equal(chamadas.length, 2);
  });

  it('doctor: aponta serviço fora do ar e projeto ausente, e confirma o MCP', async () => {
    const { env, rodar } = ambiente();
    await instalar(['--sem-mcp'], { env, rodar });
    const r = await doctor([], { env, rodar, cwd: os.tmpdir() });
    const por = (re: RegExp) => r.linhas.find((l) => re.test(l.texto));
    assert.equal(por(/Serviço fora do ar/)!.estado, 'aviso');
    assert.equal(por(/MCP "painel-agentes" registrado/)!.estado, 'ok');
    assert.equal(por(/não é de nenhum projeto/)!.estado, 'info');
    assert.equal(r.ok, true);

    const raiz = pasta(`doctor-${path.basename(env.PAINEL_DADOS_DIR!)}`);
    await iniciarProjeto([], { cwd: raiz, env, url: SEM_SERVICO });
    const r2 = await doctor([], { env, rodar, cwd: raiz });
    assert.ok(r2.linhas.some((l) => l.estado === 'ok' && /Projeto da pasta/.test(l.texto)));
    assert.ok(r2.linhas.some((l) => l.estado === 'ok' && /Esteira configurada/.test(l.texto)));
    assert.ok(r2.linhas.some((l) => l.estado === 'ok' && /CLAUDE\.md com o bloco/.test(l.texto)));
  });
});
