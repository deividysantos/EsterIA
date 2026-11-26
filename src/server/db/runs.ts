import type { IdProvedor } from '../../shared/provedores.js';
import type { DetalheRun, EstadoRun, Evento, Modo, Run, TipoEvento, Usage } from '../../shared/runs.js';
import type { LimiteLido } from '../adaptadores/tipos.js';
import { ErroDominio } from '../erros.js';
import type { Banco } from './banco.js';

interface Linha {
  id: string;
  projeto: string | null;
  provedor: IdProvedor;
  modelo_id: number | null;
  modelo_codigo: string;
  modelo_nome: string;
  familia: string;
  papel: string;
  modo: Modo;
  cwd: string;
  prompt: string;
  comando_json: string;
  sessao_retomada: string | null;
  sessao: string | null;
  modelo_reportado: string | null;
  pid: number | null;
  estado: EstadoRun;
  codigo_saida: number | null;
  erro: string | null;
  inicio: string;
  fim: string | null;
  duracao_ms: number | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  tokens_cache_leitura: number | null;
  tokens_cache_escrita: number | null;
  tokens_raciocinio: number | null;
  num_turnos: number | null;
  custo_usd: number | null;
  custo_origem: 'cli' | 'estimado' | null;
  resultado_texto: string | null;
  saida_estruturada_json: string | null;
  contagem_mensagens: number;
  contagem_ferramentas: number;
  arquivos_json: string;
}

function paraRun(l: Linha): Run {
  return {
    id: l.id,
    projeto: l.projeto,
    provedor: l.provedor,
    modeloId: l.modelo_id,
    modeloCodigo: l.modelo_codigo,
    modeloNome: l.modelo_nome,
    familia: l.familia,
    papel: l.papel,
    modo: l.modo,
    cwd: l.cwd,
    prompt: l.prompt,
    comando: JSON.parse(l.comando_json) as string[],
    sessaoRetomada: l.sessao_retomada,
    sessao: l.sessao,
    modeloReportado: l.modelo_reportado,
    pid: l.pid,
    estado: l.estado,
    codigoSaida: l.codigo_saida,
    erro: l.erro,
    inicio: l.inicio,
    fim: l.fim,
    duracaoMs: l.duracao_ms,
    usage: {
      entrada: l.tokens_entrada,
      saida: l.tokens_saida,
      cacheLeitura: l.tokens_cache_leitura,
      cacheEscrita: l.tokens_cache_escrita,
      raciocinio: l.tokens_raciocinio,
    },
    numTurnos: l.num_turnos,
    custoUsd: l.custo_usd,
    custoOrigem: l.custo_origem,
    resultadoTexto: l.resultado_texto,
    saidaEstruturada: l.saida_estruturada_json === null ? null : (JSON.parse(l.saida_estruturada_json) as unknown),
    contagemMensagens: l.contagem_mensagens,
    contagemFerramentas: l.contagem_ferramentas,
    arquivos: JSON.parse(l.arquivos_json) as string[],
  };
}

export interface NovoRegistroRun {
  id: string;
  projeto: string | null;
  provedor: IdProvedor;
  modeloId: number;
  modeloCodigo: string;
  modeloNome: string;
  familia: string;
  papel: string;
  modo: Modo;
  cwd: string;
  prompt: string;
  comando: string[];
  sessaoRetomada: string | null;
  inicio: Date;
}

export function inserirRun(db: Banco, r: NovoRegistroRun): Run {
  const ts = r.inicio.toISOString();
  db.prepare(
    `INSERT INTO runs (id, projeto, provedor, modelo_id, modelo_codigo, modelo_nome, familia, papel, modo, cwd, prompt,
       comando_json, sessao_retomada, estado, inicio, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rodando', ?, ?, ?)`
  ).run(
    r.id,
    r.projeto,
    r.provedor,
    r.modeloId,
    r.modeloCodigo,
    r.modeloNome,
    r.familia,
    r.papel,
    r.modo,
    r.cwd,
    r.prompt,
    JSON.stringify(r.comando),
    r.sessaoRetomada,
    ts,
    ts,
    ts
  );
  return obterRun(db, r.id);
}

export interface AtualizacaoRun {
  pid?: number | null;
  sessao?: string | null;
  modeloReportado?: string | null;
  estado?: EstadoRun;
  codigoSaida?: number | null;
  erro?: string | null;
  fim?: string | null;
  duracaoMs?: number | null;
  usage?: Usage;
  numTurnos?: number | null;
  custoUsd?: number | null;
  custoOrigem?: 'cli' | 'estimado' | null;
  resultadoTexto?: string | null;
  saidaEstruturada?: unknown;
  contagemMensagens?: number;
  contagemFerramentas?: number;
  arquivos?: string[];
}

const COLUNAS: Record<Exclude<keyof AtualizacaoRun, 'usage'>, string> = {
  pid: 'pid',
  sessao: 'sessao',
  modeloReportado: 'modelo_reportado',
  estado: 'estado',
  codigoSaida: 'codigo_saida',
  erro: 'erro',
  fim: 'fim',
  duracaoMs: 'duracao_ms',
  numTurnos: 'num_turnos',
  custoUsd: 'custo_usd',
  custoOrigem: 'custo_origem',
  resultadoTexto: 'resultado_texto',
  saidaEstruturada: 'saida_estruturada_json',
  contagemMensagens: 'contagem_mensagens',
  contagemFerramentas: 'contagem_ferramentas',
  arquivos: 'arquivos_json',
};

type Valor = string | number | null;

export function atualizarRun(db: Banco, id: string, a: AtualizacaoRun, agora = new Date()): Run {
  const sets: string[] = [];
  const vals: Valor[] = [];
  for (const [k, col] of Object.entries(COLUNAS) as [Exclude<keyof AtualizacaoRun, 'usage'>, string][]) {
    if (!(k in a)) continue;
    let v = a[k] as unknown;
    if (k === 'arquivos') v = JSON.stringify(v);
    else if (k === 'saidaEstruturada') v = v === undefined || v === null ? null : JSON.stringify(v);
    sets.push(`${col} = ?`);
    vals.push(v as Valor);
  }
  if (a.usage) {
    sets.push(
      'tokens_entrada = ?',
      'tokens_saida = ?',
      'tokens_cache_leitura = ?',
      'tokens_cache_escrita = ?',
      'tokens_raciocinio = ?'
    );
    vals.push(a.usage.entrada, a.usage.saida, a.usage.cacheLeitura, a.usage.cacheEscrita, a.usage.raciocinio);
  }
  sets.push('atualizado_em = ?');
  vals.push(agora.toISOString());
  db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return obterRun(db, id);
}

export function obterRun(db: Banco, id: string): Run {
  const l = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as Linha | undefined;
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', `Run "${id}" não encontrado.`);
  return paraRun(l);
}

export interface FiltroRuns {
  projeto?: string;
  provedor?: IdProvedor;
  estado?: EstadoRun;
  limite?: number;
}

export function listarRuns(db: Banco, f: FiltroRuns = {}): Run[] {
  const conds: string[] = [];
  const vals: Valor[] = [];
  if (f.projeto) (conds.push('projeto = ?'), vals.push(f.projeto));
  if (f.provedor) (conds.push('provedor = ?'), vals.push(f.provedor));
  if (f.estado) (conds.push('estado = ?'), vals.push(f.estado));
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limite = Math.min(Math.max(f.limite ?? 100, 1), 500);
  const linhas = db.prepare(`SELECT * FROM runs ${where} ORDER BY inicio DESC LIMIT ${limite}`).all(...vals);
  return (linhas as unknown as Linha[]).map(paraRun);
}

export function inserirEvento(
  db: Banco,
  e: { runId: string; seq: number; ts: Date; tipo: TipoEvento; resumo: string; texto: string | null; bruto: unknown }
): Evento {
  const ts = e.ts.toISOString();
  const bruto = e.bruto === undefined ? null : JSON.stringify(e.bruto);
  db.prepare('INSERT INTO eventos (run_id, seq, ts, tipo, resumo, texto, bruto_json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    e.runId,
    e.seq,
    ts,
    e.tipo,
    e.resumo,
    e.texto,
    bruto
  );
  return { runId: e.runId, seq: e.seq, ts, tipo: e.tipo, resumo: e.resumo, texto: e.texto };
}

export function gravarStderr(db: Banco, runId: string, texto: string, truncado: boolean) {
  db.prepare(
    `INSERT INTO run_stderr (run_id, texto, truncado) VALUES (?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET texto = excluded.texto, truncado = excluded.truncado`
  ).run(runId, texto, truncado ? 1 : 0);
}

export function gravarLimites(db: Banco, provedor: IdProvedor, runId: string | null, limites: LimiteLido[], agora = new Date()) {
  const ins = db.prepare(
    'INSERT INTO limites_snapshots (provedor, run_id, janela, utilizacao, status, reinicia_em, capturado_em) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const l of limites) ins.run(provedor, runId, l.janela, l.utilizacao, l.status, l.reiniciaEm, agora.toISOString());
}

export function detalharRun(db: Banco, id: string, aposSeq = 0): DetalheRun {
  const run = obterRun(db, id);
  const eventos = (
    db
      .prepare('SELECT run_id, seq, ts, tipo, resumo, texto FROM eventos WHERE run_id = ? AND seq > ? ORDER BY seq')
      .all(id, aposSeq) as unknown as { run_id: string; seq: number; ts: string; tipo: TipoEvento; resumo: string; texto: string | null }[]
  ).map((e) => ({ runId: e.run_id, seq: e.seq, ts: e.ts, tipo: e.tipo, resumo: e.resumo, texto: e.texto }));
  const se = db.prepare('SELECT texto, truncado FROM run_stderr WHERE run_id = ?').get(id) as
    | { texto: string; truncado: number }
    | undefined;
  return { run, eventos, stderr: se?.texto ?? '', stderrTruncado: se?.truncado === 1 };
}

/** Bruto de um evento, para depuração. */
export function brutoEvento(db: Banco, runId: string, seq: number): unknown {
  const r = db.prepare('SELECT bruto_json FROM eventos WHERE run_id = ? AND seq = ?').get(runId, seq) as
    | { bruto_json: string | null }
    | undefined;
  if (!r) throw new ErroDominio('NAO_ENCONTRADO', 'Evento não encontrado.');
  return r.bruto_json === null ? null : JSON.parse(r.bruto_json);
}

/** Runs que estavam rodando quando o serviço caiu: o processo não é mais nosso. */
export function marcarInterrompidos(db: Banco, agora = new Date()): number {
  const ts = agora.toISOString();
  const r = db
    .prepare(
      `UPDATE runs SET estado = 'interrompido', fim = ?, erro = COALESCE(erro, 'O serviço reiniciou durante o run.'),
         atualizado_em = ? WHERE estado = 'rodando'`
    )
    .run(ts, ts);
  return Number(r.changes);
}
