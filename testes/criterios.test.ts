import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { CRITERIOS_PADRAO, type Criterios, type CriteriosProjeto, type PreviaPapel } from '../src/shared/criterios.ts';
import type { Modelo } from '../src/shared/provedores.ts';
import { criarApp } from '../src/server/app.ts';
import { abrirBanco, type Banco } from '../src/server/db/banco.ts';
import { obterCriterios } from '../src/server/db/criterios.ts';
import { descreverCriterios, pontuar } from '../src/server/motor/pontuacao.ts';

function modelo(id: number, extra: Partial<Modelo> = {}): Modelo {
  return {
    id,
    provedor: 'claude',
    codigo: `m${id}`,
    nome: `Modelo ${id}`,
    familia: 'f',
    notaCusto: null,
    notaVelocidade: null,
    notaQualidade: null,
    contextoTokens: null,
    tags: [],
    observacao: '',
    precoEntrada: null,
    precoSaida: null,
    precoCacheLeitura: null,
    precoCacheEscrita: null,
    ativo: true,
    criadoEm: '',
    atualizadoEm: '',
    ...extra,
  };
}

const crit = (extra: Partial<Criterios> = {}, pesos: Partial<Criterios['pesos']> = {}): Criterios => ({
  ...structuredClone(CRITERIOS_PADRAO),
  ...extra,
  pesos: { qualidade: 0, custo: 0, velocidade: 0, aprovacao_primeira: 0, conclusao: 0, custo_medido: 0, duracao_medida: 0, ...pesos },
});

describe('pontuação', () => {
  it('pondera notas declaradas e ordena da maior para a menor', () => {
    const ms = [modelo(1, { notaQualidade: 3, notaCusto: 5 }), modelo(2, { notaQualidade: 5, notaCusto: 1 }), modelo(3, { notaQualidade: 4, notaCusto: 4 })];
    const r = pontuar(ms, crit({}, { qualidade: 1, custo: 1 }), new Map());
    // 1: (0,5 + 1)/2 = 0,75 · 3: (0,75 + 0,75)/2 = 0,75 · 2: (1 + 0)/2 = 0,5. Empate mantém a ordem.
    assert.deepEqual(r.map((c) => [c.modeloId, c.pontuacao]), [[1, 0.75], [3, 0.75], [2, 0.5]]);
    const custoPesaMais = pontuar(ms, crit({}, { qualidade: 1, custo: 3 }), new Map());
    assert.equal(custoPesaMais[0]!.modeloId, 1);
    const soQualidade = pontuar(ms, crit({}, { qualidade: 1 }), new Map());
    assert.equal(soQualidade[0]!.modeloId, 2);
  });

  it('nota ausente e medida com poucas amostras contam como neutras', () => {
    const ms = [modelo(1, { notaQualidade: 1 }), modelo(2)];
    const r = pontuar(ms, crit({}, { qualidade: 1 }), new Map());
    assert.deepEqual(r.map((c) => [c.modeloId, c.pontuacao]), [[2, 0.5], [1, 0]]);

    const medidas = new Map([
      [1, { conclusao: { valor: 1, amostras: 2 } }],
      [2, { conclusao: { valor: 0.5, amostras: 10 } }],
    ]);
    const r2 = pontuar(ms, crit({ amostrasMinimas: 3 }, { conclusao: 1 }), medidas);
    const c1 = r2.find((c) => c.modeloId === 1)!.componentes[0]!;
    assert.equal(c1.valor, null, 'só 2 amostras com mínimo 3');
    assert.equal(c1.amostras, 2);
  });

  it('métricas medidas: normaliza na faixa e inverte quando menor é melhor', () => {
    const ms = [modelo(1), modelo(2), modelo(3)];
    const medidas = new Map([
      [1, { custo_medido: { valor: 0.1, amostras: 5 } }],
      [2, { custo_medido: { valor: 0.3, amostras: 5 } }],
      [3, { custo_medido: { valor: 0.2, amostras: 5 } }],
    ]);
    const r = pontuar(ms, crit({}, { custo_medido: 2 }), medidas);
    assert.deepEqual(r.map((c) => [c.modeloId, c.pontuacao]), [[1, 1], [3, 0.5], [2, 0]]);
  });

  it('regras rígidas e exclusões externas tiram o candidato, com motivo', () => {
    const ms = [modelo(1, { notaQualidade: 5 }), modelo(2, { notaQualidade: 2 }), modelo(3), modelo(4, { notaQualidade: 4 })];
    const r = pontuar(ms, crit({ excluidos: [1], qualidadeMinima: 3 }, { qualidade: 1 }), new Map(), new Map([[4, 'mesma família']]));
    const por = new Map(r.map((c) => [c.modeloId, c]));
    assert.equal(por.get(1)!.excluidoPor, 'excluído nos critérios do projeto');
    assert.match(por.get(2)!.excluidoPor!, /qualidade 2 abaixo do mínimo 3/);
    assert.match(por.get(3)!.excluidoPor!, /sem nota de qualidade/);
    assert.equal(por.get(4)!.excluidoPor, 'mesma família');
    assert.ok(r.every((c) => !c.elegivel));
  });

  it('sem pesos: todos empatam e a ordem dos candidatos é mantida', () => {
    const r = pontuar([modelo(9), modelo(3), modelo(5)], crit(), new Map());
    assert.deepEqual(r.map((c) => c.modeloId), [9, 3, 5]);
    assert.ok(r.every((c) => c.pontuacao === 0.5));
  });

  it('descreve os critérios para o planejador', () => {
    const t = descreverCriterios(crit({ modo: 'pontuacao', instrucoes: 'Prefira o Hydrogen em regra de negócio.' }, { qualidade: 5 }));
    assert.match(t, /qualidade 5/);
    assert.match(t, /usa sempre o candidato de maior pontuação/);
    assert.match(t, /Prefira o Hydrogen/);
  });
});

describe('API de critérios', () => {
  let db: Banco;
  let app: ReturnType<typeof criarApp>;
  const pedir = (c: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1${c}`, { ...init, headers: { host: '127.0.0.1', 'content-type': 'application/json' } });

  beforeEach(async () => {
    db = abrirBanco(':memory:');
    app = criarApp({ db, caminhoBanco: ':memory:' });
    await pedir('/api/projetos', { method: 'POST', body: JSON.stringify({ id: 'p', nome: 'P', raiz: path.join(os.tmpdir(), 'crit-p') }) });
  });
  afterEach(() => db.close());

  it('devolve o padrão, salva, completa campos novos e valida', async () => {
    const r0 = (await (await pedir('/api/projetos/p/criterios')).json()) as CriteriosProjeto;
    assert.equal(r0.padrao, true);
    assert.equal(r0.criterios.pesos.qualidade, 5);

    const novo = { ...r0.criterios, modo: 'pontuacao', pesos: { ...r0.criterios.pesos, custo_medido: 4 } };
    const r1 = await pedir('/api/projetos/p/criterios', { method: 'PUT', body: JSON.stringify(novo) });
    assert.equal(r1.status, 200);
    const salvo = (await r1.json()) as CriteriosProjeto;
    assert.equal(salvo.padrao, false);
    assert.equal(salvo.criterios.modo, 'pontuacao');

    // Critério antigo sem uma métrica nova: completa com o padrão ao ler.
    db.prepare('UPDATE criterios SET criterios_json = ? WHERE projeto = ?').run(JSON.stringify({ ...novo, pesos: { qualidade: 1 } }), 'p');
    assert.equal(obterCriterios(db, 'p').criterios.pesos.custo, CRITERIOS_PADRAO.pesos.custo);

    assert.equal((await pedir('/api/projetos/p/criterios', { method: 'PUT', body: JSON.stringify({ ...novo, amostrasMinimas: 0 }) })).status, 400);
    assert.equal((await pedir('/api/projetos/nao/criterios')).status, 404);
  });

  it('prévia pontua os candidatos de cada papel, com critérios não salvos', async () => {
    assert.deepEqual(await (await pedir('/api/projetos/p/criterios/previa')).json(), []);
    await pedir('/api/projetos/p/esteira', { method: 'POST', body: JSON.stringify({ origem: 'padrao' }) });
    const previa = (await (await pedir('/api/projetos/p/criterios/previa')).json()) as PreviaPapel[];
    assert.deepEqual(previa.map((x) => x.etapaId), ['executar', 'revisar']);
    assert.equal(previa[1]!.regraCruzada, 'família diferente de quem rodou "executar"');
    // Banco novo: nenhum provedor habilitado, então ninguém é elegível e o motivo diz por quê.
    assert.ok(previa[0]!.candidatos.every((c) => !c.elegivel && c.excluidoPor === 'provedor não habilitado nesta máquina'));

    const comRegra = { ...CRITERIOS_PADRAO, excluidos: [previa[0]!.candidatos[0]!.modeloId] };
    const p2 = (await (await pedir('/api/projetos/p/criterios/previa', { method: 'POST', body: JSON.stringify(comRegra) })).json()) as PreviaPapel[];
    assert.equal(p2[0]!.candidatos.find((c) => c.modeloId === comRegra.excluidos[0])!.excluidoPor, 'provedor não habilitado nesta máquina');
  });
});
