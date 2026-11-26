import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Definicao, Etapa } from '../src/shared/esteiras.ts';
import { novoModeloSchema } from '../src/shared/provedores.ts';
import { AoVivo } from '../src/server/aoVivo.ts';
import { abrirBanco, type Banco } from '../src/server/db/banco.ts';
import { criarEsteira } from '../src/server/db/esteiras.ts';
import { CRITERIOS_PADRAO } from '../src/shared/criterios.ts';
import { decisoesDoProblema, metricasMedidas, salvarCriterios } from '../src/server/db/criterios.ts';
import { criarModelo, editarModelo, listarModelos } from '../src/server/db/modelos.ts';
import {
  atualizarExecucao,
  inserirExecucao,
  listarExecucoes,
  listarTarefas,
  obterProblema,
  type TarefaInterna,
} from '../src/server/db/problemas.ts';
import { criarProjeto } from '../src/server/db/projetos.ts';
import { editarProvedor } from '../src/server/db/provedores.ts';
import { obterRun } from '../src/server/db/runs.ts';
import { esteiraPadrao } from '../src/server/esteiras/padrao.ts';
import { Motor } from '../src/server/motor/motor.ts';
import { aposFalha, decidir } from '../src/server/motor/proximo.ts';
import { verificarProvedor } from '../src/server/provedores/servico.ts';
import { Executor } from '../src/server/runs/executor.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const AGENTE = path.join(AQUI, 'apoio', 'agente-falso.mjs');
const WIN = process.platform === 'win32';
const NODE = process.execPath;

const PLANO = (tarefas: object[], perguntas: string[] = []) =>
  `Plano pronto.\n\`\`\`json\n${JSON.stringify({ perguntas, resumo: 'Fazer a e b.', tarefas })}\n\`\`\``;
const PARECER = (aprovado: boolean) =>
  `\`\`\`json\n${JSON.stringify({ aprovado, problemas: aprovado ? [] : [{ arquivo: 'a.txt', linha: 1, severidade: 'alta', descricao: 'falta a linha 2', sugestao: 'acrescente' }] })}\n\`\`\``;
const RESUMO = (arquivos: string[]) => `\`\`\`json\n${JSON.stringify({ arquivos_alterados: arquivos, o_que_foi_feito: 'feito', duvidas: [] })}\n\`\`\``;

// Trechos que só aparecem nas instruções de formato de cada saída.
const SE_PLANO = '"perguntas"';
const SE_PARECER = '"aprovado"';
const SE_EXEC = 'arquivos_alterados';

interface Ambiente {
  tmp: string;
  repo: string;
  db: Banco;
  motor: Motor;
  executor: Executor;
  roteiro: string;
  registro: string;
  ids: { opus: number; sonnet: number; revisor: number };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

let amb: Ambiente;

function roteiro(regras: object[]) {
  fs.writeFileSync(amb.roteiro, JSON.stringify({ regras }));
  fs.rmSync(path.join(amb.tmp, 'estado.json'), { force: true });
}

function chamadas(): { argv: string[]; prompt: string; regra: number }[] {
  if (!fs.existsSync(amb.registro)) return [];
  return fs.readFileSync(amb.registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function montar(ajustar: (def: Definicao, ids: Ambiente['ids']) => void = () => undefined): Promise<Ambiente> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-motor-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'teste@exemplo.invalid');
  git(repo, 'config', 'user.name', 'Teste');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'leia.txt'), 'inicial\n');
  fs.writeFileSync(path.join(repo, 'sujo.txt'), 'antes\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'inicial');
  // Arquivo já alterado antes do problema: não pode entrar no commit das tarefas.
  fs.writeFileSync(path.join(repo, 'sujo.txt'), 'alterado fora do painel\n');

  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const wrapper = WIN ? path.join(bin, 'claude-falso.cmd') : path.join(bin, 'claude-falso');
  fs.writeFileSync(wrapper, WIN ? `@"${NODE}" "${AGENTE}" %*\r\n` : `#!/bin/sh\nexec "${NODE}" "${AGENTE}" "$@"\n`, { mode: 0o755 });

  const db = abrirBanco(':memory:');
  const roteiroArq = path.join(tmp, 'roteiro.json');
  const registro = path.join(tmp, 'registro.ndjson');
  fs.writeFileSync(roteiroArq, JSON.stringify({ regras: [] }));
  const env = { ...process.env, FAKE_ROTEIRO: roteiroArq, FAKE_ESTADO: path.join(tmp, 'estado.json'), FAKE_REGISTRO: registro };

  editarProvedor(db, 'claude', { caminho: wrapper });
  const p = await verificarProvedor(db, 'claude', { env });
  assert.equal(p.estado, 'habilitado', p.erro ?? '');
  const revisor = criarModelo(db, novoModeloSchema.parse({ provedor: 'claude', codigo: 'falso-revisor', nome: 'Revisor falso', familia: 'gpt' }));
  const porCod = (c: string) => listarModelos(db).find((m) => m.codigo === c)!.id;
  const ids = { opus: porCod('claude-opus-5-5'), sonnet: porCod('claude-sonnet-5-5'), revisor: revisor.id };

  criarProjeto(db, { id: 'proj', nome: 'Projeto', raiz: repo });
  const def = esteiraPadrao(listarModelos(db));
  const etapa = (id: string) => def.etapas.find((e) => e.id === id)!;
  const exec = etapa('executar');
  if (exec.agente?.modo === 'orquestrador') exec.agente.candidatos = [ids.sonnet, ids.opus];
  const rev = etapa('revisar');
  if (rev.agente?.modo === 'orquestrador') rev.agente.candidatos = [ids.sonnet, ids.revisor];
  const testes = etapa('testes');
  testes.ativa = true;
  testes.comando = `"${NODE}" -e "process.exit(0)"`;
  ajustar(def, ids);
  criarEsteira(db, 'proj', def, 'teste');

  const aoVivo = new AoVivo();
  const executor = new Executor(db, aoVivo, env);
  const motor = new Motor(db, executor, aoVivo, { env, dadosDir: tmp, intervaloMs: 3_600_000 });
  motor.iniciar();
  amb = { tmp, repo, db, motor, executor, roteiro: roteiroArq, registro, ids };
  return amb;
}

async function rodar() {
  amb.motor.agendar();
  await amb.motor.ocioso();
}

function tarefa(codigo: string): TarefaInterna {
  return listarTarefas(amb.db, problemaId).find((t) => t.codigo === codigo)!;
}

let problemaId: string;

function criar() {
  problemaId = amb.motor.criarProblema({ projeto: 'proj', titulo: 'Escrever arquivos', descricao: 'Criar a.txt e b.txt.' }).id;
}

const DUAS_TAREFAS = [
  { codigo: 'T1', titulo: 'Criar a', descricao: 'cria a.txt', modelos: { executor: 'claude-sonnet-5-5', revisor: 'falso-revisor' }, justificativa: 'simples', revisao_independente: true, depende_de: [] },
  { codigo: 'T2', titulo: 'Criar b', descricao: 'cria b.txt', modelos: { executor: 'claude-sonnet-5-5' }, revisao_independente: false, depende_de: ['T1'] },
];

afterEach(async () => {
  if (!amb) return;
  await amb.motor.parar();
  await amb.executor.encerrar();
  amb.db.close();
  fs.rmSync(amb.tmp, { recursive: true, force: true });
  amb = undefined as unknown as Ambiente;
});

describe('motor: fluxo completo', () => {
  beforeEach(async () => {
    await montar();
  });

  it('planeja, espera aprovação, executa, testa, revisa (cruzado) e commita só os arquivos de cada tarefa', async () => {
    roteiro([
      { se: SE_PLANO, resposta: PLANO(DUAS_TAREFAS) },
      { se: SE_PARECER, resposta: PARECER(true) },
      { se: 'cria a.txt', resposta: RESUMO(['a.txt']), escrever: { 'a.txt': 'a\n' } },
      { se: 'cria b.txt', resposta: RESUMO(['b.txt']), escrever: { 'b.txt': 'b\n' } },
    ]);
    criar();
    await rodar();

    let p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'aguardando', p.motivo ?? '');
    assert.equal(listarTarefas(amb.db, problemaId).length, 2);
    const espera = listarExecucoes(amb.db, problemaId).find((e) => e.estado === 'aguardando')!;
    assert.equal(espera.etapaId, 'aprovar-plano');

    // O planejador recebeu o catálogo com os candidatos e a regra de revisão cruzada.
    const pPlano = chamadas()[0]!.prompt;
    assert.match(pPlano, /Papel "executor"/);
    assert.match(pPlano, /`claude-sonnet-5-5`/);
    assert.match(pPlano, /família diferente de quem rodou "executar"/);

    await amb.motor.decidirExecucao(espera.id, { acao: 'aprovar', comentario: '' });
    await rodar();

    p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'concluido', p.motivo ?? '');
    const execs = listarExecucoes(amb.db, problemaId);
    assert.deepEqual(
      execs.map((e) => `${e.tarefaCodigo ?? '-'}:${e.etapaId}:${e.estado}`),
      [
        '-:planejar:concluida',
        '-:aprovar-plano:concluida',
        'T1:executar:concluida',
        'T1:testes:concluida',
        'T1:revisar:concluida',
        'T1:commit:concluida',
        'T2:executar:concluida',
        'T2:testes:concluida',
        'T2:commit:concluida',
      ]
    );
    const execT1 = execs.find((e) => e.tarefaCodigo === 'T1' && e.etapaId === 'executar')!;
    assert.equal(execT1.modeloNome, 'Claude Sonnet 5.5');
    assert.match(execT1.motivoEscolha!, /escolhido no plano/);
    const revT1 = execs.find((e) => e.etapaId === 'revisar')!;
    assert.equal(revT1.modeloNome, 'Revisor falso', 'revisor de família diferente do executor');

    // Runs ligados ao problema e à execução.
    const run = obterRun(amb.db, execT1.runId!);
    assert.equal(run.problema, problemaId);
    assert.equal(run.execucaoId, execT1.id);
    assert.equal(run.papel, 'executar');
    assert.equal(run.modo, 'escrita');

    // O revisor recebeu o diff da tarefa.
    const pRev = chamadas().find((c) => c.prompt.includes(SE_PARECER))!.prompt;
    assert.match(pRev, /\+a/);

    const log = git(amb.repo, 'log', '--format=%s', '--name-only');
    assert.match(log, /T1: Criar a\s+a\.txt/);
    assert.match(log, /T2: Criar b\s+b\.txt/);
    assert.ok(!/sujo\.txt/.test(log.split('inicial')[0]!), 'arquivo sujo de antes não entra em commit de tarefa');
    assert.equal(git(amb.repo, 'status', '--porcelain'), 'M sujo.txt');
    assert.ok(tarefa('T1').commit && tarefa('T2').commit);
  });

  it('perguntas do planejador: espera respostas e retoma a mesma sessão', async () => {
    roteiro([
      { se: SE_PLANO, resposta: PLANO([], ['Qual o nome do arquivo?']), vezes: 1 },
      { se: 'nome.txt', resposta: PLANO([DUAS_TAREFAS[0]!]) },
    ]);
    criar();
    await rodar();
    const espera = listarExecucoes(amb.db, problemaId).find((e) => e.estado === 'aguardando')!;
    assert.equal(espera.espera, 'perguntas');
    await amb.motor.decidirExecucao(espera.id, { acao: 'responder', respostas: ['nome.txt'] });
    await rodar();

    const c = chamadas();
    assert.equal(c.length, 2);
    const sessao1 = obterRun(amb.db, listarExecucoes(amb.db, problemaId)[0]!.runId!).sessao!;
    assert.deepEqual(c[1]!.argv.slice(c[1]!.argv.indexOf('--resume'), c[1]!.argv.indexOf('--resume') + 2), ['--resume', sessao1]);
    assert.match(c[1]!.prompt, /Qual o nome do arquivo\?\*\*\n\s+nome\.txt/);
    assert.equal(obterProblema(amb.db, problemaId).respostas.length, 1);
    assert.equal(listarTarefas(amb.db, problemaId).length, 1);
    assert.equal(obterProblema(amb.db, problemaId).estado, 'aguardando');
  });

  it('devolver na aprovação volta ao planejamento com o comentário', async () => {
    roteiro([{ se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) }]);
    criar();
    await rodar();
    const espera = listarExecucoes(amb.db, problemaId).find((e) => e.estado === 'aguardando')!;
    await amb.motor.decidirExecucao(espera.id, { acao: 'devolver', comentario: 'divida em mais tarefas' });
    await rodar();
    const c = chamadas();
    assert.equal(c.length, 2);
    assert.match(c[1]!.prompt, /Devolvido pelo usuário: divida em mais tarefas/);
    assert.ok(c[1]!.argv.includes('--resume'), 'replaneja na mesma sessão');
    const execs = listarExecucoes(amb.db, problemaId);
    assert.equal(execs[1]!.estado, 'reprovada');
    assert.equal(execs.at(-1)!.estado, 'aguardando');
  });
});

describe('motor: falhas e retentativas', () => {
  it('revisão reprova, volta ao executor com o retorno na mesma sessão e aprova na 2ª', async () => {
    await montar((def) => {
      def.etapas.find((e) => e.id === 'aprovar-plano')!.ativa = false;
    });
    roteiro([
      { se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) },
      { se: SE_EXEC, resposta: RESUMO(['a.txt']), escrever: { 'a.txt': 'a\n' } },
      { se: SE_PARECER, resposta: PARECER(false), vezes: 1 },
      { se: SE_PARECER, resposta: PARECER(true) },
    ]);
    criar();
    await rodar();
    const p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'concluido', p.motivo ?? '');
    const execs = listarExecucoes(amb.db, problemaId).filter((e) => e.tarefaCodigo === 'T1');
    assert.deepEqual(
      execs.map((e) => `${e.etapaId}#${e.tentativa}:${e.estado}`),
      ['executar#1:concluida', 'testes#1:concluida', 'revisar#1:reprovada', 'executar#2:concluida', 'testes#2:concluida', 'revisar#2:concluida', 'commit#1:concluida']
    );
    const segunda = chamadas().filter((c) => c.prompt.includes(SE_EXEC))[1]!;
    assert.match(segunda.prompt, /Revisão cruzada reprovou:\n- \[alta\] a\.txt:1 — falta a linha 2/);
    assert.ok(segunda.argv.includes('--resume'));
    assert.match(execs[3]!.feedback!, /falta a linha 2/);
  });

  it('passa do máximo: bloqueia; tentar de novo zera; cancelar a tarefa segue para a próxima', async () => {
    await montar((def) => {
      def.etapas.find((e) => e.id === 'aprovar-plano')!.ativa = false;
      def.etapas.find((e) => e.id === 'revisar')!.falha.maxTentativas = 2;
      def.etapas.find((e) => e.id === 'revisar')!.condicao = 'sempre';
    });
    roteiro([
      { se: SE_PLANO, resposta: PLANO(DUAS_TAREFAS.map((t) => ({ ...t, depende_de: [] }))) },
      { se: 'Revise a implementação da tarefa T1', resposta: PARECER(false) },
      { se: SE_PARECER, resposta: PARECER(true) },
      { se: 'cria a.txt', resposta: RESUMO([]), escrever: { 'a.txt': 'a\n' } },
      { se: 'cria b.txt', resposta: RESUMO([]), escrever: { 'b.txt': 'b\n' } },
    ]);
    criar();
    await rodar();
    let p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'bloqueado');
    assert.match(p.motivo!, /Revisão cruzada falhou 2 vez\(es\) \(máximo 2\)/);
    assert.equal(tarefa('T1').estado, 'bloqueada');
    assert.equal(tarefa('T1').indiceEtapa, 3, 'ponteiro no executor (destino da volta)');

    amb.motor.acao(problemaId, 'tentar_de_novo');
    await rodar();
    p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'bloqueado');
    assert.equal(listarExecucoes(amb.db, problemaId).filter((e) => e.etapaId === 'revisar' && e.tarefaCodigo === 'T1').length, 4);

    amb.motor.acao(problemaId, 'cancelar_tarefa');
    await rodar();
    p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'concluido', p.motivo ?? '');
    assert.equal(tarefa('T1').estado, 'cancelada');
    assert.equal(tarefa('T2').estado, 'concluida');
  });

  it('comando de testes falhando volta ao executor com a saída', async () => {
    await montar((def) => {
      def.etapas.find((e) => e.id === 'aprovar-plano')!.ativa = false;
      def.etapas.find((e) => e.id === 'revisar')!.ativa = false;
      const t = def.etapas.find((e) => e.id === 'testes')!;
      t.comando = `"${NODE}" -e "const fs=require('fs');if(!fs.existsSync('ok.txt')){console.log('FALTA ok.txt');process.exit(3)}"`;
    });
    roteiro([
      { se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) },
      { se: 'FALTA ok.txt', resposta: RESUMO([]), escrever: { 'ok.txt': 'ok\n' } },
      { se: SE_EXEC, resposta: RESUMO([]), escrever: { 'a.txt': 'a\n' } },
    ]);
    criar();
    await rodar();
    assert.equal(obterProblema(amb.db, problemaId).estado, 'concluido');
    const testes = listarExecucoes(amb.db, problemaId).filter((e) => e.etapaId === 'testes');
    assert.deepEqual(testes.map((e) => e.estado), ['falhou', 'concluida']);
    assert.match(testes[0]!.saidaTexto!, /FALTA ok\.txt/);
    assert.match(git(amb.repo, 'show', '--name-only', '--format=', 'HEAD'), /a\.txt\s+ok\.txt|ok\.txt\s+a\.txt/);
  });

  it('parecer em formato inválido repete só a revisão, sem refazer a execução', async () => {
    await montar((def) => {
      def.etapas.find((e) => e.id === 'aprovar-plano')!.ativa = false;
    });
    roteiro([
      { se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) },
      { se: SE_PARECER, resposta: 'acho que está bom', vezes: 1 },
      { se: SE_PARECER, resposta: PARECER(true) },
      { se: SE_EXEC, resposta: RESUMO(['a.txt']), escrever: { 'a.txt': 'a\n' } },
    ]);
    criar();
    await rodar();
    assert.equal(obterProblema(amb.db, problemaId).estado, 'concluido');
    const t1 = listarExecucoes(amb.db, problemaId).filter((e) => e.tarefaCodigo === 'T1');
    assert.deepEqual(t1.map((e) => `${e.etapaId}:${e.estado}`), ['executar:concluida', 'testes:concluida', 'revisar:falhou', 'revisar:concluida', 'commit:concluida']);
  });

  it('plano inválido conta como falha e repete o planejamento até o máximo', async () => {
    await montar();
    roteiro([{ se: SE_PLANO, resposta: 'não tenho JSON' }]);
    criar();
    await rodar();
    const p = obterProblema(amb.db, problemaId);
    assert.equal(p.estado, 'bloqueado');
    assert.equal(listarExecucoes(amb.db, problemaId).length, 2);
    assert.match(p.motivo!, /Plano em formato inválido/);
  });
});

describe('motor: controle', () => {
  it('cancelar o problema encerra o agente em execução', async () => {
    await montar();
    roteiro([{ se: SE_PLANO, resposta: '', dormir: true }]);
    criar();
    amb.motor.agendar();
    for (let i = 0; i < 200; i++) {
      const e = listarExecucoes(amb.db, problemaId)[0];
      if (e?.runId && obterRun(amb.db, e.runId).sessao) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    amb.motor.acao(problemaId, 'cancelar');
    await amb.motor.ocioso();
    const e = listarExecucoes(amb.db, problemaId)[0]!;
    assert.equal(e.estado, 'cancelada');
    assert.equal(obterRun(amb.db, e.runId!).estado, 'cancelado');
    assert.equal(obterProblema(amb.db, problemaId).estado, 'cancelado');
  });

  it('limite global de 1: o segundo problema espera vaga', async () => {
    await montar();
    amb.motor.definirLimites({ global: 1, porProvedor: 1 });
    roteiro([{ se: SE_PLANO, resposta: '', dormir: true }]);
    criar();
    const primeiro = problemaId;
    amb.motor.criarProblema({ projeto: 'proj', titulo: 'Outro', descricao: 'x' });
    amb.motor.agendar();
    await new Promise((r) => setTimeout(r, 300));
    const fila = amb.motor.estadoFila();
    assert.equal(fila.rodando.length, 1);
    assert.equal(fila.rodando[0]!.execucao.problema, primeiro);
    assert.equal(fila.naFila, 1);
    amb.motor.acao(primeiro, 'cancelar');
  });

  it('pausar não inicia etapas novas; retomar continua', async () => {
    await montar();
    roteiro([{ se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) }]);
    criar();
    amb.motor.acao(problemaId, 'pausar');
    await rodar();
    assert.equal(listarExecucoes(amb.db, problemaId).length, 0);
    amb.motor.acao(problemaId, 'retomar');
    await rodar();
    assert.equal(obterProblema(amb.db, problemaId).estado, 'aguardando');
  });

  it('execução órfã (serviço caiu) bloqueia o problema ao reiniciar', async () => {
    await montar();
    criar();
    amb.motor.acao(problemaId, 'pausar');
    amb.motor.acao(problemaId, 'retomar');
    const e = inserirExecucao(amb.db, { problema: problemaId, tarefaId: null, etapaId: 'planejar', etapaNome: 'Planejar', tipo: 'planejar', tentativa: 1, estado: 'rodando' });
    const motor2 = new Motor(amb.db, amb.executor, new AoVivo(), { dadosDir: amb.tmp, intervaloMs: 3_600_000 });
    motor2.iniciar();
    await motor2.parar();
    assert.equal(listarExecucoes(amb.db, problemaId).find((x) => x.id === e.id)!.estado, 'falhou');
    assert.equal(obterProblema(amb.db, problemaId).estado, 'bloqueado');
    void atualizarExecucao;
  });

  it('sem esteira não cria problema', async () => {
    await montar();
    criarProjeto(amb.db, { id: 'sem', nome: 'Sem', raiz: path.join(amb.tmp, 'outra') });
    assert.throws(() => amb.motor.criarProblema({ projeto: 'sem', titulo: 't', descricao: 'd' }), /Configure a esteira/);
  });
});

describe('motor: critérios de escolha', () => {
  it('modo pontuação ignora a escolha do plano, registra a decisão e o catálogo leva os pesos', async () => {
    await montar((def) => {
      def.etapas.find((e) => e.id === 'aprovar-plano')!.ativa = false;
      def.etapas.find((e) => e.id === 'revisar')!.ativa = false;
    });
    editarModelo(amb.db, amb.ids.opus, { notaQualidade: 5 });
    editarModelo(amb.db, amb.ids.sonnet, { notaQualidade: 3 });
    salvarCriterios(amb.db, 'proj', {
      ...CRITERIOS_PADRAO,
      modo: 'pontuacao',
      pesos: { ...CRITERIOS_PADRAO.pesos, qualidade: 10, custo: 0, velocidade: 0 },
      instrucoes: 'Use sempre o melhor modelo.',
    });
    roteiro([
      { se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) },
      { se: SE_EXEC, resposta: RESUMO(['a.txt']), escrever: { 'a.txt': 'a\n' } },
    ]);
    criar();
    await rodar();
    assert.equal(obterProblema(amb.db, problemaId).estado, 'concluido');

    const pPlano = chamadas()[0]!.prompt;
    assert.match(pPlano, /Pesos da pontuação: qualidade 10/);
    assert.match(pPlano, /Use sempre o melhor modelo/);
    assert.match(pPlano, /`claude-opus-5-5` — Claude Opus 5\.5 \(família claude\) · pontuação 1\.00/);

    const exec = listarExecucoes(amb.db, problemaId).find((e) => e.etapaId === 'executar')!;
    assert.equal(exec.modeloNome, 'Claude Opus 5.5', 'o plano pediu Sonnet, mas o projeto escolhe por pontuação');
    const [dec] = decisoesDoProblema(amb.db, problemaId).filter((d) => d.etapaId === 'executar');
    assert.equal(dec!.origem, 'pontuacao');
    assert.equal(dec!.pedidoPeloPlano, 'claude-sonnet-5-5');
    assert.equal(dec!.escolhidoId, amb.ids.opus);
    assert.deepEqual(dec!.candidatos.map((c) => [c.codigo, c.pontuacao]), [['claude-opus-5-5', 1], ['claude-sonnet-5-5', 0.5]]);
    const planejar = decisoesDoProblema(amb.db, problemaId).find((d) => d.etapaId === 'planejar')!;
    assert.equal(planejar.origem, 'fixo');
  });

  it('regra rígida barra o modelo pedido pelo plano; métricas medidas saem do histórico', async () => {
    await montar((def) => {
      def.etapas.find((e) => e.id === 'aprovar-plano')!.ativa = false;
    });
    salvarCriterios(amb.db, 'proj', { ...CRITERIOS_PADRAO, excluidos: [amb.ids.sonnet] });
    roteiro([
      { se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) },
      { se: SE_PARECER, resposta: PARECER(true) },
      { se: SE_EXEC, resposta: RESUMO(['a.txt']), escrever: { 'a.txt': 'a\n' } },
    ]);
    criar();
    await rodar();
    const exec = listarExecucoes(amb.db, problemaId).find((e) => e.etapaId === 'executar')!;
    assert.equal(exec.modeloNome, 'Claude Opus 5.5');
    assert.match(exec.motivoEscolha!, /não pode ser usado \(excluído nos critérios do projeto\)/);

    const med = metricasMedidas(amb.db, [amb.ids.opus], null).get(amb.ids.opus)!;
    assert.deepEqual(med.aprovacao_primeira, { valor: 1, amostras: 1 });
    assert.equal(med.conclusao!.amostras, 2, 'o Opus planejou e executou');
    assert.equal(med.custo_medido!.valor, 0.001);
    const porProjeto = metricasMedidas(amb.db, [amb.ids.opus], 'outro');
    assert.equal(porProjeto.size, 0);
  });
});

describe('API de problemas e fila', () => {
  it('cria, detalha, decide, age e configura limites', async () => {
    await montar();
    roteiro([{ se: SE_PLANO, resposta: PLANO([DUAS_TAREFAS[0]!]) }]);
    const { criarApp } = await import('../src/server/app.ts');
    const app = criarApp({ db: amb.db, caminhoBanco: ':memory:', executor: amb.executor, motor: amb.motor });
    const pedir = (c: string, init: RequestInit = {}) =>
      app.request(`http://127.0.0.1${c}`, { ...init, headers: { host: '127.0.0.1', 'content-type': 'application/json' } });
    const postar = (c: string, corpo: unknown) => pedir(c, { method: 'POST', body: JSON.stringify(corpo) });

    assert.equal((await postar('/api/problemas', { projeto: 'proj', titulo: '', descricao: 'x' })).status, 400);
    const r = await postar('/api/problemas', { projeto: 'proj', titulo: 'Pela API', descricao: 'cria a.txt' });
    assert.equal(r.status, 201);
    const { id } = (await r.json()) as { id: string };
    await amb.motor.ocioso();

    const d = (await (await pedir(`/api/problemas/${id}`)).json()) as import('../src/shared/problemas.ts').DetalheProblema;
    assert.equal(d.problema.estado, 'aguardando');
    assert.equal(d.tarefas.length, 1);
    assert.ok(!('baseGit' in d.tarefas[0]!), 'campos internos não vazam');
    assert.equal(d.definicao.etapas[0]!.id, 'planejar');

    const planejar = d.execucoes[0]!;
    assert.equal((await postar(`/api/execucoes/${planejar.id}/decisao`, { acao: 'aprovar' })).status, 409);
    const espera = d.problema.esperando!;
    assert.equal((await postar(`/api/execucoes/${espera.execucaoId}/decisao`, { acao: 'devolver', comentario: '' })).status, 400);
    assert.equal((await postar(`/api/problemas/${id}/acoes`, { acao: 'retomar' })).status, 409);
    assert.equal((await postar(`/api/problemas/${id}/acoes`, { acao: 'pausar' })).status, 200);

    const fila = (await (await pedir('/api/fila')).json()) as import('../src/shared/problemas.ts').EstadoFila;
    assert.deepEqual(fila.limites, { global: 3, porProvedor: 2 });
    assert.equal(fila.aguardandoVoce.length, 1);
    assert.equal((await pedir('/api/fila/limites', { method: 'PUT', body: JSON.stringify({ global: 0, porProvedor: 1 }) })).status, 400);
    assert.equal((await pedir('/api/fila/limites', { method: 'PUT', body: JSON.stringify({ global: 2, porProvedor: 1 }) })).status, 200);
    assert.equal((await pedir('/api/problemas?estado=pausado')).status, 200);
  });
});

describe('decidir (função pura)', () => {
  const etapa = (id: string, escopo: 'problema' | 'tarefa', extra: Partial<Etapa> = {}): Etapa => ({
    id,
    nome: id,
    tipo: escopo === 'tarefa' ? 'executar' : 'planejar',
    escopo,
    ativa: true,
    condicao: 'sempre',
    agente: null,
    escalar: null,
    acesso: 'leitura',
    prompt: 'x',
    saida: 'texto',
    comando: '',
    falha: { acao: 'bloquear', voltarPara: null, maxTentativas: 2 },
    timeoutMin: null,
    ...extra,
  });
  const def: Definicao = {
    etapas: [
      etapa('a', 'problema'),
      etapa('b', 'problema', { ativa: false }),
      etapa('x', 'tarefa'),
      etapa('rev', 'tarefa', { condicao: 'se_revisao_independente' }),
      etapa('z', 'problema'),
    ],
  };
  const t = (id: number, codigo: string, extra: Partial<TarefaInterna> = {}): TarefaInterna => ({
    id, problema: 'p', codigo, titulo: codigo, descricao: '', revisaoIndependente: true, dependeDe: [], modelos: {}, justificativa: '',
    ordem: id, estado: 'pendente', indiceEtapa: 2, arquivos: [], commit: null, motivo: null, contadores: {}, feedback: null, baseGit: null, ...extra,
  });

  it('pula desativadas e entra no bloco de tarefas na ordem das dependências', () => {
    assert.deepEqual(decidir(def, { fase: 'antes', indice: 0 }, []).passo, { tipo: 'rodar', etapaIndice: 0, tarefaId: null });
    const d = decidir(def, { fase: 'antes', indice: 1 }, [t(1, 'T1', { dependeDe: ['T2'] }), t(2, 'T2')]);
    assert.deepEqual(d.passo, { tipo: 'rodar', etapaIndice: 2, tarefaId: 2 });
    assert.deepEqual(d.iniciadas, [2]);
    assert.equal(d.problema.fase, 'tarefas');
  });

  it('condição de revisão independente e conclusão da tarefa', () => {
    const d = decidir(def, { fase: 'tarefas', indice: 2 }, [t(1, 'T1', { estado: 'em_andamento', indiceEtapa: 3, revisaoIndependente: false })]);
    assert.deepEqual(d.passo, { tipo: 'rodar', etapaIndice: 4, tarefaId: null });
    assert.deepEqual(d.tarefas.find((x) => x.id === 1)!.mudancas.estado, 'concluida');
    assert.equal(d.problema.fase, 'depois');
  });

  it('dependência impossível e tarefa bloqueada bloqueiam o problema', () => {
    assert.equal(decidir(def, { fase: 'tarefas', indice: 2 }, [t(1, 'T1', { dependeDe: ['T1'] })]).passo.tipo, 'bloquear');
    const b = decidir(def, { fase: 'tarefas', indice: 2 }, [t(1, 'T1', { estado: 'bloqueada', motivo: 'x' })]).passo;
    assert.equal(b.tipo === 'bloquear' && b.motivo, 'Tarefa T1 bloqueada: x');
  });

  it('fim da esteira conclui', () => {
    assert.deepEqual(decidir(def, { fase: 'depois', indice: 5 }, []).passo, { tipo: 'concluir' });
  });

  it('aposFalha respeita ação e máximo', () => {
    const d2: Definicao = {
      etapas: [etapa('e', 'tarefa'), etapa('r', 'tarefa', { falha: { acao: 'voltar', voltarPara: 'e', maxTentativas: 3 } }), etapa('c', 'tarefa', { falha: { acao: 'continuar', voltarPara: null, maxTentativas: 1 } })],
    };
    assert.deepEqual(aposFalha(d2, 1, 1), { tipo: 'repetir', indice: 0 });
    assert.equal(aposFalha(d2, 1, 3).tipo, 'bloquear');
    assert.deepEqual(aposFalha(d2, 0, 1), { tipo: 'repetir', indice: 0 });
    assert.equal(aposFalha(d2, 0, 2).tipo, 'bloquear');
    assert.deepEqual(aposFalha(d2, 2, 5), { tipo: 'seguir' });
  });
});
