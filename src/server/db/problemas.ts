import { randomBytes } from 'node:crypto';

import type { TipoEtapa } from '../../shared/esteiras.js';
import type {
  EstadoExecucao,
  EstadoProblema,
  EstadoTarefa,
  Espera,
  Execucao,
  Fase,
  LimitesFila,
  Plano,
  Problema,
  Resposta,
  ResumoProblema,
  Tarefa,
} from '../../shared/problemas.js';
import { ErroDominio } from '../erros.js';
import type { Banco } from './banco.js';

type Valor = string | number | null;
const agoraIso = () => new Date().toISOString();

// ---------- Problemas ----------

interface LinhaProblema {
  id: string;
  projeto: string;
  numero: number;
  titulo: string;
  descricao: string;
  estado: EstadoProblema;
  esteira_versao: number;
  fase: Fase;
  indice: number;
  plano_json: string | null;
  respostas_json: string;
  contadores_json: string;
  feedback: string | null;
  motivo: string | null;
  criado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}

/** Estado interno do problema (inclui o que a interface não precisa ver). */
export interface ProblemaInterno extends Problema {
  contadores: Record<string, number>;
  feedback: string | null;
}

function paraProblema(l: LinhaProblema): ProblemaInterno {
  return {
    id: l.id,
    projeto: l.projeto,
    numero: l.numero,
    titulo: l.titulo,
    descricao: l.descricao,
    estado: l.estado,
    esteiraVersao: l.esteira_versao,
    fase: l.fase,
    indice: l.indice,
    plano: l.plano_json ? (JSON.parse(l.plano_json) as Plano) : null,
    respostas: JSON.parse(l.respostas_json) as Resposta[],
    contadores: JSON.parse(l.contadores_json) as Record<string, number>,
    feedback: l.feedback,
    motivo: l.motivo,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    concluidoEm: l.concluido_em,
  };
}

export function inserirProblema(
  db: Banco,
  d: { projeto: string; titulo: string; descricao: string; esteiraVersao: number }
): ProblemaInterno {
  const id = `p_${randomBytes(5).toString('hex')}`;
  const numero =
    ((db.prepare('SELECT MAX(numero) AS n FROM problemas WHERE projeto = ?').get(d.projeto) as { n: number | null }).n ?? 0) + 1;
  const ts = agoraIso();
  db.prepare(
    `INSERT INTO problemas (id, projeto, numero, titulo, descricao, estado, esteira_versao, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, 'em_andamento', ?, ?, ?)`
  ).run(id, d.projeto, numero, d.titulo, d.descricao, d.esteiraVersao, ts, ts);
  return obterProblema(db, id);
}

export function obterProblema(db: Banco, id: string): ProblemaInterno {
  const l = db.prepare('SELECT * FROM problemas WHERE id = ?').get(id) as unknown as LinhaProblema | undefined;
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', `Problema "${id}" não encontrado.`);
  return paraProblema(l);
}

export interface AtualizacaoProblema {
  estado?: EstadoProblema;
  fase?: Fase;
  indice?: number;
  plano?: Plano | null;
  respostas?: Resposta[];
  contadores?: Record<string, number>;
  feedback?: string | null;
  motivo?: string | null;
  concluidoEm?: string | null;
}

export function atualizarProblema(db: Banco, id: string, a: AtualizacaoProblema): ProblemaInterno {
  const sets: string[] = [];
  const vals: Valor[] = [];
  const col = (c: string, v: Valor) => (sets.push(`${c} = ?`), vals.push(v));
  if (a.estado !== undefined) col('estado', a.estado);
  if (a.fase !== undefined) col('fase', a.fase);
  if (a.indice !== undefined) col('indice', a.indice);
  if (a.plano !== undefined) col('plano_json', a.plano === null ? null : JSON.stringify(a.plano));
  if (a.respostas !== undefined) col('respostas_json', JSON.stringify(a.respostas));
  if (a.contadores !== undefined) col('contadores_json', JSON.stringify(a.contadores));
  if (a.feedback !== undefined) col('feedback', a.feedback);
  if (a.motivo !== undefined) col('motivo', a.motivo);
  if (a.concluidoEm !== undefined) col('concluido_em', a.concluidoEm);
  col('atualizado_em', agoraIso());
  db.prepare(`UPDATE problemas SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return obterProblema(db, id);
}

export function listarProblemasAtivos(db: Banco): ProblemaInterno[] {
  return (
    db.prepare("SELECT * FROM problemas WHERE estado = 'em_andamento' ORDER BY criado_em").all() as unknown as LinhaProblema[]
  ).map(paraProblema);
}

function resumir(db: Banco, p: ProblemaInterno): ResumoProblema {
  const t = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(estado = 'concluida') AS concluidas FROM tarefas WHERE problema = ? AND estado <> 'cancelada'`
    )
    .get(p.id) as { total: number; concluidas: number | null };
  const c = db.prepare('SELECT COALESCE(SUM(custo_usd), 0) AS c FROM runs WHERE problema = ?').get(p.id) as { c: number };
  const e = db
    .prepare("SELECT id, espera, etapa_nome FROM execucoes WHERE problema = ? AND estado = 'aguardando' ORDER BY id DESC LIMIT 1")
    .get(p.id) as { id: number; espera: Espera; etapa_nome: string } | undefined;
  const { contadores: _c, feedback: _f, ...publico } = p;
  return {
    ...publico,
    tarefasTotal: t.total,
    tarefasConcluidas: t.concluidas ?? 0,
    custoUsd: c.c,
    esperando: e ? { execucaoId: e.id, espera: e.espera, etapaNome: e.etapa_nome } : null,
  };
}

export function resumoProblema(db: Banco, id: string): ResumoProblema {
  return resumir(db, obterProblema(db, id));
}

export function listarProblemas(db: Banco, f: { projeto?: string; estado?: EstadoProblema } = {}): ResumoProblema[] {
  const conds: string[] = [];
  const vals: Valor[] = [];
  if (f.projeto) (conds.push('projeto = ?'), vals.push(f.projeto));
  if (f.estado) (conds.push('estado = ?'), vals.push(f.estado));
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const linhas = db.prepare(`SELECT * FROM problemas ${where} ORDER BY criado_em DESC LIMIT 200`).all(...vals);
  return (linhas as unknown as LinhaProblema[]).map((l) => resumir(db, paraProblema(l)));
}

// ---------- Tarefas ----------

interface LinhaTarefa {
  id: number;
  problema: string;
  codigo: string;
  titulo: string;
  descricao: string;
  revisao_independente: number;
  depende_de_json: string;
  modelos_json: string;
  justificativa: string;
  ordem: number;
  estado: EstadoTarefa;
  indice_etapa: number;
  contadores_json: string;
  feedback: string | null;
  base_git_json: string | null;
  arquivos_json: string;
  commit_hash: string | null;
  motivo: string | null;
}

export interface TarefaInterna extends Tarefa {
  contadores: Record<string, number>;
  feedback: string | null;
  /** Arquivos já alterados no git antes da tarefa começar (não entram no commit dela). */
  baseGit: string[] | null;
}

function paraTarefa(l: LinhaTarefa): TarefaInterna {
  return {
    id: l.id,
    problema: l.problema,
    codigo: l.codigo,
    titulo: l.titulo,
    descricao: l.descricao,
    revisaoIndependente: l.revisao_independente === 1,
    dependeDe: JSON.parse(l.depende_de_json) as string[],
    modelos: JSON.parse(l.modelos_json) as Record<string, string>,
    justificativa: l.justificativa,
    ordem: l.ordem,
    estado: l.estado,
    indiceEtapa: l.indice_etapa,
    contadores: JSON.parse(l.contadores_json) as Record<string, number>,
    feedback: l.feedback,
    baseGit: l.base_git_json ? (JSON.parse(l.base_git_json) as string[]) : null,
    arquivos: JSON.parse(l.arquivos_json) as string[],
    commit: l.commit_hash,
    motivo: l.motivo,
  };
}

export function listarTarefas(db: Banco, problema: string): TarefaInterna[] {
  return (
    db.prepare('SELECT * FROM tarefas WHERE problema = ? ORDER BY ordem').all(problema) as unknown as LinhaTarefa[]
  ).map(paraTarefa);
}

export function obterTarefa(db: Banco, id: number): TarefaInterna {
  const l = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id) as unknown as LinhaTarefa | undefined;
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', `Tarefa ${id} não encontrada.`);
  return paraTarefa(l);
}

/** Troca as tarefas do problema pelas do plano (só antes de qualquer tarefa começar). */
export function substituirTarefas(db: Banco, problema: string, plano: Plano, indiceInicial: number) {
  const ts = agoraIso();
  db.prepare('DELETE FROM tarefas WHERE problema = ?').run(problema);
  const ins = db.prepare(
    `INSERT INTO tarefas (problema, codigo, titulo, descricao, revisao_independente, depende_de_json, modelos_json,
       justificativa, ordem, estado, indice_etapa, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?, ?, ?)`
  );
  plano.tarefas.forEach((t, i) =>
    ins.run(
      problema,
      t.codigo,
      t.titulo,
      t.descricao,
      t.revisao_independente ? 1 : 0,
      JSON.stringify(t.depende_de),
      JSON.stringify(t.modelos),
      t.justificativa,
      i,
      indiceInicial,
      ts,
      ts
    )
  );
}

export interface AtualizacaoTarefa {
  estado?: EstadoTarefa;
  indiceEtapa?: number;
  contadores?: Record<string, number>;
  feedback?: string | null;
  baseGit?: string[] | null;
  arquivos?: string[];
  commit?: string | null;
  motivo?: string | null;
}

export function atualizarTarefa(db: Banco, id: number, a: AtualizacaoTarefa): TarefaInterna {
  const sets: string[] = [];
  const vals: Valor[] = [];
  const col = (c: string, v: Valor) => (sets.push(`${c} = ?`), vals.push(v));
  if (a.estado !== undefined) col('estado', a.estado);
  if (a.indiceEtapa !== undefined) col('indice_etapa', a.indiceEtapa);
  if (a.contadores !== undefined) col('contadores_json', JSON.stringify(a.contadores));
  if (a.feedback !== undefined) col('feedback', a.feedback);
  if (a.baseGit !== undefined) col('base_git_json', a.baseGit === null ? null : JSON.stringify(a.baseGit));
  if (a.arquivos !== undefined) col('arquivos_json', JSON.stringify(a.arquivos));
  if (a.commit !== undefined) col('commit_hash', a.commit);
  if (a.motivo !== undefined) col('motivo', a.motivo);
  col('atualizado_em', agoraIso());
  db.prepare(`UPDATE tarefas SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return obterTarefa(db, id);
}

// ---------- Execuções ----------

interface LinhaExecucao {
  id: number;
  problema: string;
  tarefa_id: number | null;
  etapa_id: string;
  etapa_nome: string;
  tipo: TipoEtapa;
  tentativa: number;
  estado: EstadoExecucao;
  espera: Espera | null;
  run_id: string | null;
  modelo_id: number | null;
  modelo_nome: string | null;
  motivo_escolha: string | null;
  feedback: string | null;
  saida_texto: string | null;
  saida_json: string | null;
  erro: string | null;
  inicio: string;
  fim: string | null;
  tarefa_codigo?: string | null;
  custo_usd?: number | null;
}

function paraExecucao(l: LinhaExecucao): Execucao {
  return {
    id: l.id,
    problema: l.problema,
    tarefaId: l.tarefa_id,
    tarefaCodigo: l.tarefa_codigo ?? null,
    etapaId: l.etapa_id,
    etapaNome: l.etapa_nome,
    tipo: l.tipo,
    tentativa: l.tentativa,
    estado: l.estado,
    espera: l.espera,
    runId: l.run_id,
    modeloId: l.modelo_id,
    modeloNome: l.modelo_nome,
    motivoEscolha: l.motivo_escolha,
    feedback: l.feedback,
    saidaTexto: l.saida_texto,
    saida: l.saida_json === null ? null : (JSON.parse(l.saida_json) as unknown),
    erro: l.erro,
    custoUsd: l.custo_usd ?? null,
    inicio: l.inicio,
    fim: l.fim,
  };
}

const SELECT_EXEC = `SELECT e.*, t.codigo AS tarefa_codigo, r.custo_usd AS custo_usd
  FROM execucoes e LEFT JOIN tarefas t ON t.id = e.tarefa_id LEFT JOIN runs r ON r.id = e.run_id`;

export function inserirExecucao(
  db: Banco,
  d: {
    problema: string;
    tarefaId: number | null;
    etapaId: string;
    etapaNome: string;
    tipo: TipoEtapa;
    tentativa: number;
    estado: EstadoExecucao;
    espera?: Espera | null;
    modeloId?: number | null;
    modeloNome?: string | null;
    motivoEscolha?: string | null;
    feedback?: string | null;
  }
): Execucao {
  const r = db
    .prepare(
      `INSERT INTO execucoes (problema, tarefa_id, etapa_id, etapa_nome, tipo, tentativa, estado, espera, modelo_id, modelo_nome,
         motivo_escolha, feedback, inicio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      d.problema,
      d.tarefaId,
      d.etapaId,
      d.etapaNome,
      d.tipo,
      d.tentativa,
      d.estado,
      d.espera ?? null,
      d.modeloId ?? null,
      d.modeloNome ?? null,
      d.motivoEscolha ?? null,
      d.feedback ?? null,
      agoraIso()
    );
  return obterExecucao(db, Number(r.lastInsertRowid));
}

export function obterExecucao(db: Banco, id: number): Execucao {
  const l = db.prepare(`${SELECT_EXEC} WHERE e.id = ?`).get(id) as unknown as LinhaExecucao | undefined;
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', `Execução ${id} não encontrada.`);
  return paraExecucao(l);
}

export interface AtualizacaoExecucao {
  estado?: EstadoExecucao;
  espera?: Espera | null;
  runId?: string | null;
  saidaTexto?: string | null;
  saida?: unknown;
  erro?: string | null;
  fim?: string | null;
}

export function atualizarExecucao(db: Banco, id: number, a: AtualizacaoExecucao): Execucao {
  const sets: string[] = [];
  const vals: Valor[] = [];
  const col = (c: string, v: Valor) => (sets.push(`${c} = ?`), vals.push(v));
  if (a.estado !== undefined) col('estado', a.estado);
  if (a.espera !== undefined) col('espera', a.espera);
  if (a.runId !== undefined) col('run_id', a.runId);
  if (a.saidaTexto !== undefined) col('saida_texto', a.saidaTexto);
  if (a.saida !== undefined) col('saida_json', a.saida === null ? null : JSON.stringify(a.saida));
  if (a.erro !== undefined) col('erro', a.erro);
  if (a.fim !== undefined) col('fim', a.fim);
  if (!sets.length) return obterExecucao(db, id);
  db.prepare(`UPDATE execucoes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return obterExecucao(db, id);
}

export function listarExecucoes(db: Banco, problema: string): Execucao[] {
  return (db.prepare(`${SELECT_EXEC} WHERE e.problema = ? ORDER BY e.id`).all(problema) as unknown as LinhaExecucao[]).map(
    paraExecucao
  );
}

export function execucoesEmCurso(db: Banco, problema?: string): Execucao[] {
  const linhas = problema
    ? db.prepare(`${SELECT_EXEC} WHERE e.estado IN ('rodando', 'aguardando') AND e.problema = ? ORDER BY e.id`).all(problema)
    : db.prepare(`${SELECT_EXEC} WHERE e.estado IN ('rodando', 'aguardando') ORDER BY e.id`).all();
  return (linhas as unknown as LinhaExecucao[]).map(paraExecucao);
}

/** Última execução de uma etapa para o problema/tarefa (para retomada de sessão e revisão cruzada). */
export function ultimaExecucao(db: Banco, problema: string, tarefaId: number | null, etapaId: string): Execucao | null {
  const l = db
    .prepare(`${SELECT_EXEC} WHERE e.problema = ? AND e.etapa_id = ? AND e.tarefa_id IS ? ORDER BY e.id DESC LIMIT 1`)
    .get(problema, etapaId, tarefaId) as unknown as LinhaExecucao | undefined;
  return l ? paraExecucao(l) : null;
}

export function contarExecucoes(db: Banco, problema: string, tarefaId: number | null, etapaId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM execucoes WHERE problema = ? AND etapa_id = ? AND tarefa_id IS ? AND estado NOT IN ('respondida', 'pulada')`
      )
      .get(problema, etapaId, tarefaId) as { n: number }
  ).n;
}

/** Execuções que estavam rodando quando o serviço caiu. */
export function execucoesOrfas(db: Banco): Execucao[] {
  return (db.prepare(`${SELECT_EXEC} WHERE e.estado = 'rodando'`).all() as unknown as LinhaExecucao[]).map(paraExecucao);
}

// ---------- Configurações ----------

export const LIMITES_PADRAO: LimitesFila = { global: 3, porProvedor: 2 };

export function lerConfig<T>(db: Banco, chave: string, padrao: T): T {
  const r = db.prepare('SELECT valor_json FROM configuracoes WHERE chave = ?').get(chave) as { valor_json: string } | undefined;
  return r ? (JSON.parse(r.valor_json) as T) : padrao;
}

export function gravarConfig(db: Banco, chave: string, valor: unknown) {
  db.prepare(
    `INSERT INTO configuracoes (chave, valor_json) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json`
  ).run(chave, JSON.stringify(valor));
}
