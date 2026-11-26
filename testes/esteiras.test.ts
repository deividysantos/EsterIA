import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { etapaNova, validarEsteira, type Definicao, type EsteiraProjeto, type ModeloRef } from '../src/shared/esteiras.ts';
import { criarApp } from '../src/server/app.ts';
import { abrirBanco, type Banco } from '../src/server/db/banco.ts';
import { referenciasModelos } from '../src/server/db/esteiras.ts';
import { editarModelo, listarModelos } from '../src/server/db/modelos.ts';
import { esteiraPadrao } from '../src/server/esteiras/padrao.ts';

let db: Banco;
let app: ReturnType<typeof criarApp>;

const pedir = (caminho: string, init: RequestInit = {}) =>
  app.request(`http://127.0.0.1${caminho}`, { ...init, headers: { host: '127.0.0.1', 'content-type': 'application/json' } });
const enviar = (metodo: string, caminho: string, corpo: unknown) => pedir(caminho, { method: metodo, body: JSON.stringify(corpo) });

function padrao(): Definicao {
  return esteiraPadrao(listarModelos(db));
}

function mensagens(def: Definicao, refs: ModeloRef[] = referenciasModelos(db)) {
  const r = validarEsteira(def, refs);
  return { erros: r.erros.map((e) => e.mensagem), avisos: r.avisos.map((e) => e.mensagem) };
}

beforeEach(() => {
  db = abrirBanco(':memory:');
  app = criarApp({ db, caminhoBanco: ':memory:' });
});
afterEach(() => db.close());

describe('esteira padrão', () => {
  it('reproduz o fluxo do v1 e passa na validação', () => {
    const def = padrao();
    assert.deepEqual(
      def.etapas.map((e) => `${e.id}:${e.escopo}:${e.ativa ? 'on' : 'off'}`),
      ['planejar:problema:on', 'criticar-plano:problema:off', 'aprovar-plano:problema:on', 'executar:tarefa:on', 'testes:tarefa:off', 'revisar:tarefa:on', 'commit:tarefa:on']
    );
    const porCod = new Map(listarModelos(db).map((m) => [m.id, m.codigo]));
    const planejar = def.etapas[0]!;
    assert.equal(planejar.agente?.modo === 'fixo' && porCod.get(planejar.agente.modeloId), 'claude-opus-5-5');
    const revisar = def.etapas.find((e) => e.id === 'revisar')!;
    assert.ok(revisar.agente?.modo === 'orquestrador' && revisar.agente.familiaDiferenteDe === 'executar');
    assert.equal(revisar.condicao, 'se_revisao_independente');
    // Nenhum provedor habilitado no banco novo: só avisos, nenhum erro.
    const m = mensagens(def);
    assert.deepEqual(m.erros, []);
    assert.ok(m.avisos.every((a) => /não está habilitado/.test(a)));
  });

  it('sem modelos ativos não dá para criar', () => {
    for (const m of listarModelos(db)) editarModelo(db, m.id, { ativo: false });
    assert.throws(() => padrao(), /Cadastre ao menos um modelo/);
  });
});

describe('validação', () => {
  it('etapas por tarefa precisam ser contíguas e vir depois do planejamento', () => {
    const def = padrao();
    const build = etapaNova('comando', new Set(def.etapas.map((e) => e.id)), 'problema');
    build.comando = 'npm run build';
    // Etapa do problema no meio do bloco por tarefa (entre executar e testes).
    def.etapas.splice(4, 0, build);
    assert.ok(mensagens(def).erros.some((e) => /precisam ficar juntas/.test(e)));
    // No fim, depois do bloco, é válida.
    def.etapas.splice(4, 1);
    def.etapas.push(build);
    assert.deepEqual(mensagens(def).erros, []);

    const sóTarefa: Definicao = { etapas: padrao().etapas.filter((e) => e.escopo === 'tarefa') };
    assert.ok(mensagens(sóTarefa).erros.some((e) => /etapa de planejamento antes/.test(e)));
  });

  it('volta só para trás, no mesmo escopo e para etapa ativa', () => {
    const def = padrao();
    const revisar = def.etapas.find((e) => e.id === 'revisar')!;
    revisar.falha.voltarPara = 'commit';
    assert.ok(mensagens(def).erros.some((e) => /esta etapa ou uma anterior/.test(e)));
    revisar.falha.voltarPara = 'planejar';
    assert.ok(mensagens(def).erros.some((e) => /mesmo escopo/.test(e)));
    revisar.falha.voltarPara = 'testes';
    assert.ok(mensagens(def).erros.some((e) => /está desativada/.test(e)));
    revisar.falha.voltarPara = null;
    assert.ok(mensagens(def).erros.some((e) => /escolha para qual etapa voltar/.test(e)));
  });

  it('revisor só leitura, revisão cruzada para etapa anterior, ids únicos', () => {
    const def = padrao();
    const revisar = def.etapas.find((e) => e.id === 'revisar')!;
    revisar.acesso = 'escrita';
    if (revisar.agente?.modo === 'orquestrador') revisar.agente.familiaDiferenteDe = 'commit';
    def.etapas.find((e) => e.id === 'commit')!.id = 'revisar';
    const m = mensagens(def).erros;
    assert.ok(m.some((e) => /só roda em modo leitura/.test(e)));
    assert.ok(m.some((e) => /Id "revisar" repetido/.test(e)));
  });

  it('comando vazio, agente faltando, prompt vazio e modelo inexistente', () => {
    const def = padrao();
    def.etapas.find((e) => e.id === 'testes')!.comando = ' ';
    const exec = def.etapas.find((e) => e.id === 'executar')!;
    exec.agente = null;
    def.etapas[0]!.prompt = '';
    def.etapas[0]!.agente = { modo: 'fixo', modeloId: 9999 };
    const m = mensagens(def).erros;
    assert.ok(m.some((e) => /informe o comando/.test(e)));
    assert.ok(m.some((e) => /escolha quem roda/.test(e)));
    assert.ok(m.some((e) => /prompt está vazio/.test(e)));
    assert.ok(m.some((e) => /modelo 9999 não existe/.test(e)));
  });

  it('avisa sobre variáveis desconhecidas ou fora do escopo', () => {
    const def = padrao();
    def.etapas[0]!.prompt += '\n{{tarefa.titulo}} {{inventada}}';
    const { avisos } = mensagens(def);
    assert.ok(avisos.some((a) => /\{\{inventada\}\} desconhecida/.test(a)));
    assert.ok(avisos.some((a) => /\{\{tarefa\.titulo\}\} não existe em etapa por problema/.test(a)));
  });

  it('etapaNova gera id livre e valores coerentes', () => {
    const e = etapaNova('revisar', new Set(['revisar', 'revisar-2']));
    assert.equal(e.id, 'revisar-3');
    assert.equal(e.acesso, 'leitura');
    assert.equal(e.saida, 'parecer');
    assert.equal(e.escopo, 'tarefa');
    assert.equal(etapaNova('aprovacao_humana', new Set()).agente, null);
  });
});

describe('API de esteiras', () => {
  const raiz = (n: string) => path.join(os.tmpdir(), `proj-esteira-${n}`);
  async function projeto(id: string) {
    assert.equal((await enviar('POST', '/api/projetos', { id, nome: id, raiz: raiz(id) })).status, 201);
  }

  it('cria a partir do padrão, versiona e não duplica versão sem mudança', async () => {
    await projeto('a');
    assert.equal((await pedir('/api/projetos/a/esteira')).status, 404);
    const criada = await enviar('POST', '/api/projetos/a/esteira', { origem: 'padrao' });
    assert.equal(criada.status, 201);
    const e1 = (await criada.json()) as EsteiraProjeto;
    assert.equal(e1.versaoAtual, 1);
    assert.equal((await enviar('POST', '/api/projetos/a/esteira', { origem: 'padrao' })).status, 409);

    const igual = await enviar('PUT', '/api/projetos/a/esteira', { definicao: e1.definicao, versaoBase: 1 });
    assert.equal(igual.status, 200);
    assert.equal(((await igual.json()) as EsteiraProjeto).versaoAtual, 1);

    const def = structuredClone(e1.definicao);
    def.etapas.find((x) => x.id === 'testes')!.ativa = true;
    const salva = await enviar('PUT', '/api/projetos/a/esteira', { definicao: def, nota: 'liga testes', versaoBase: 1 });
    assert.equal(salva.status, 201);
    const e2 = (await salva.json()) as EsteiraProjeto;
    assert.equal(e2.versaoAtual, 2);
    assert.deepEqual(e2.versoes.map((v) => v.n), [2, 1]);
    assert.equal(e2.versoes[0]!.nota, 'liga testes');

    // A versão 1 continua intacta.
    const v1 = (await (await pedir('/api/projetos/a/esteira/versoes/1')).json()) as Definicao;
    assert.equal(v1.etapas.find((x) => x.id === 'testes')!.ativa, false);

    // Edição partindo de versão antiga é recusada.
    const conflito = await enviar('PUT', '/api/projetos/a/esteira', { definicao: e1.definicao, versaoBase: 1 });
    assert.equal(conflito.status, 409);
  });

  it('recusa definição inválida com 400 e devolve os erros', async () => {
    await projeto('b');
    const e = (await (await enviar('POST', '/api/projetos/b/esteira', { origem: 'padrao' })).json()) as EsteiraProjeto;
    const def = structuredClone(e.definicao);
    def.etapas.find((x) => x.id === 'revisar')!.falha.voltarPara = 'nao-existe';
    const r = await enviar('PUT', '/api/projetos/b/esteira', { definicao: def, versaoBase: 1 });
    assert.equal(r.status, 400);
    const corpo = (await r.json()) as { detalhes: { erros: { etapa: string }[] } };
    assert.equal(corpo.detalhes.erros[0]!.etapa, 'revisar');
    const r2 = await enviar('PUT', '/api/projetos/b/esteira', { definicao: { etapas: [] }, versaoBase: 1 });
    assert.equal(r2.status, 400);
  });

  it('copia a esteira de outro projeto', async () => {
    await projeto('c');
    await projeto('d');
    await enviar('POST', '/api/projetos/c/esteira', { origem: 'padrao' });
    const r = await enviar('POST', '/api/projetos/d/esteira', { origem: { copiarDe: 'c' } });
    assert.equal(r.status, 201);
    const d = (await r.json()) as EsteiraProjeto;
    assert.match(d.versoes[0]!.nota, /Copiada da versão 1 de "c"/);
    assert.equal((await enviar('POST', '/api/projetos/c/esteira', { origem: { copiarDe: 'zzz' } })).status, 409);
    await projeto('e');
    assert.equal((await enviar('POST', '/api/projetos/e/esteira', { origem: { copiarDe: 'zzz' } })).status, 404);
  });
});
