import type { DecisaoItem, ItemParecer, Parecer } from '../../shared/problemas.js';
import type { IdProvedor } from '../../shared/provedores.js';
import type { PontoCota, QualidadeExecutor, QualidadeProblema, QualidadeRevisor, RelatorioQualidade } from '../../shared/qualidade.js';
import { ErroDominio } from '../erros.js';
import type { Banco } from './banco.js';

type Valor = string | number | null;

// ---------- Itens de parecer ----------

export function gravarItensParecer(db: Banco, execucaoId: number, p: Parecer) {
  db.prepare('DELETE FROM parecer_itens WHERE execucao_id = ?').run(execucaoId);
  const ins = db.prepare(
    'INSERT INTO parecer_itens (execucao_id, indice, arquivo, linha, severidade, descricao, sugestao) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  p.problemas.forEach((x, i) => ins.run(execucaoId, i, x.arquivo, x.linha, x.severidade, x.descricao, x.sugestao));
}

interface LinhaItem {
  id: number;
  execucao_id: number;
  indice: number;
  arquivo: string;
  linha: number | null;
  severidade: ItemParecer['severidade'];
  descricao: string;
  sugestao: string;
  decisao: DecisaoItem | null;
  decidido_em: string | null;
}

const paraItem = (l: LinhaItem): ItemParecer => ({
  id: l.id,
  execucaoId: l.execucao_id,
  indice: l.indice,
  arquivo: l.arquivo,
  linha: l.linha,
  severidade: l.severidade,
  descricao: l.descricao,
  sugestao: l.sugestao,
  decisao: l.decisao,
  decididoEm: l.decidido_em,
});

export function itensDoProblema(db: Banco, problema: string): ItemParecer[] {
  return (
    db
      .prepare(
        `SELECT i.* FROM parecer_itens i JOIN execucoes e ON e.id = i.execucao_id WHERE e.problema = ? ORDER BY i.execucao_id, i.indice`
      )
      .all(problema) as unknown as LinhaItem[]
  ).map(paraItem);
}

export function decidirItem(db: Banco, id: number, decisao: DecisaoItem | null): ItemParecer & { problema: string } {
  const r = db
    .prepare('UPDATE parecer_itens SET decisao = ?, decidido_em = ? WHERE id = ?')
    .run(decisao, decisao ? new Date().toISOString() : null, id);
  if (!r.changes) throw new ErroDominio('NAO_ENCONTRADO', `Item de parecer ${id} não encontrado.`);
  const l = db
    .prepare('SELECT i.*, e.problema AS problema FROM parecer_itens i JOIN execucoes e ON e.id = i.execucao_id WHERE i.id = ?')
    .get(id) as unknown as LinhaItem & { problema: string };
  return { ...paraItem(l), problema: l.problema };
}

/** Precisão de cada modelo como revisor: procede / (procede + não procede). */
export function precisaoRevisores(db: Banco, modeloIds: readonly number[], projeto: string | null): Map<number, { valor: number | null; amostras: number }> {
  const saida = new Map<number, { valor: number | null; amostras: number }>();
  if (!modeloIds.length) return saida;
  const marcas = modeloIds.map(() => '?').join(',');
  const filtro = projeto ? 'AND e.problema IN (SELECT id FROM problemas WHERE projeto = ?)' : '';
  const linhas = db
    .prepare(
      `SELECT e.modelo_id AS m, SUM(i.decisao = 'procede') AS ok, COUNT(i.decisao) AS n
       FROM parecer_itens i JOIN execucoes e ON e.id = i.execucao_id
       WHERE e.modelo_id IN (${marcas}) ${filtro} GROUP BY e.modelo_id`
    )
    .all(...modeloIds, ...(projeto ? [projeto] : [])) as { m: number; ok: number | null; n: number }[];
  for (const l of linhas) saida.set(l.m, { valor: l.n ? (l.ok ?? 0) / l.n : null, amostras: l.n });
  return saida;
}

// ---------- Relatório de qualidade ----------

export interface FiltroQualidade {
  desde: string | null;
  projeto?: string | null;
}

function filtroProblemas(f: FiltroQualidade, alias = 'p'): { where: string; vals: Valor[] } {
  const c: string[] = [];
  const v: Valor[] = [];
  if (f.desde) (c.push(`${alias}.criado_em >= ?`), v.push(f.desde));
  if (f.projeto) (c.push(`${alias}.projeto = ?`), v.push(f.projeto));
  return { where: c.length ? `AND ${c.join(' AND ')}` : '', vals: v };
}

export function relatorioQualidade(db: Banco, f: FiltroQualidade): RelatorioQualidade {
  const { where, vals } = filtroProblemas(f);

  // Executor: o modelo da primeira execução de cada tarefa responde pela tarefa.
  const executores = db
    .prepare(
      `WITH primeira AS (
         SELECT ex.tarefa_id, ex.modelo_id, ex.id AS exec_id
         FROM execucoes ex JOIN problemas p ON p.id = ex.problema
         WHERE ex.tipo = 'executar' AND ex.tarefa_id IS NOT NULL AND ex.modelo_id IS NOT NULL ${where}
           AND ex.id = (SELECT MIN(x.id) FROM execucoes x WHERE x.tarefa_id = ex.tarefa_id AND x.tipo = 'executar')
       ),
       primeira_rev AS (
         SELECT pr.tarefa_id, (SELECT r.estado FROM execucoes r WHERE r.tarefa_id = pr.tarefa_id AND r.tipo = 'revisar'
                  AND r.estado IN ('concluida', 'reprovada') ORDER BY r.id LIMIT 1) AS estado
         FROM primeira pr
       )
       SELECT m.id AS modeloId, m.nome, m.provedor, m.familia,
         COUNT(*) AS tarefas,
         SUM(t.estado = 'concluida') AS tarefasConcluidas,
         SUM(rv.estado = 'concluida') AS aprovadasDePrimeira,
         SUM(rv.estado IS NOT NULL) AS tarefasRevisadas,
         AVG((SELECT COUNT(*) FROM execucoes x WHERE x.tarefa_id = pr.tarefa_id AND x.tipo = 'executar')) AS tentativasMedias,
         AVG((SELECT SUM(r.custo_usd) FROM execucoes x JOIN runs r ON r.id = x.run_id WHERE x.tarefa_id = pr.tarefa_id)) AS custoMedioTarefa
       FROM primeira pr
       JOIN modelos m ON m.id = pr.modelo_id
       JOIN tarefas t ON t.id = pr.tarefa_id
       LEFT JOIN primeira_rev rv ON rv.tarefa_id = pr.tarefa_id
       GROUP BY m.id ORDER BY tarefas DESC`
    )
    .all(...vals) as unknown as Omit<QualidadeExecutor, 'apontados'>[];

  const apontados = db
    .prepare(
      `SELECT pr.modelo_id AS m, i.severidade AS s, COUNT(*) AS n
       FROM parecer_itens i
       JOIN execucoes rv ON rv.id = i.execucao_id AND rv.tipo = 'revisar'
       JOIN execucoes pr ON pr.id = (SELECT MAX(x.id) FROM execucoes x WHERE x.tarefa_id = rv.tarefa_id AND x.tipo = 'executar' AND x.id < rv.id)
       JOIN problemas p ON p.id = rv.problema
       WHERE 1 = 1 ${where}
       GROUP BY pr.modelo_id, i.severidade`
    )
    .all(...vals) as { m: number; s: 'alta' | 'media' | 'baixa'; n: number }[];

  const revisores = db
    .prepare(
      `SELECT m.id AS modeloId, m.nome, m.provedor, m.familia,
         COUNT(*) AS pareceres,
         SUM(e.estado = 'reprovada') AS reprovacoes,
         COALESCE(SUM((SELECT COUNT(*) FROM parecer_itens i WHERE i.execucao_id = e.id AND i.decisao = 'procede')), 0) AS procede,
         COALESCE(SUM((SELECT COUNT(*) FROM parecer_itens i WHERE i.execucao_id = e.id AND i.decisao = 'nao_procede')), 0) AS naoProcede,
         COALESCE(SUM((SELECT COUNT(*) FROM parecer_itens i WHERE i.execucao_id = e.id AND i.decisao IS NULL)), 0) AS semAvaliacao
       FROM execucoes e JOIN problemas p ON p.id = e.problema JOIN modelos m ON m.id = e.modelo_id
       WHERE e.tipo IN ('revisar', 'criticar_plano') AND e.estado IN ('concluida', 'reprovada') ${where}
       GROUP BY m.id ORDER BY pareceres DESC`
    )
    .all(...vals) as unknown as Omit<QualidadeRevisor, 'itens' | 'precisao'>[];

  const itensRev = db
    .prepare(
      `SELECT e.modelo_id AS m, i.severidade AS s, COUNT(*) AS n
       FROM parecer_itens i JOIN execucoes e ON e.id = i.execucao_id JOIN problemas p ON p.id = e.problema
       WHERE e.tipo IN ('revisar', 'criticar_plano') ${where} GROUP BY e.modelo_id, i.severidade`
    )
    .all(...vals) as { m: number; s: 'alta' | 'media' | 'baixa'; n: number }[];

  const contar = (lista: { m: number; s: 'alta' | 'media' | 'baixa'; n: number }[], id: number) => {
    const r = { alta: 0, media: 0, baixa: 0 };
    for (const x of lista) if (x.m === id) r[x.s] += x.n;
    return r;
  };

  const problemas = db
    .prepare(
      `SELECT p.id, p.projeto, p.numero, p.titulo, p.estado,
         (SELECT COUNT(*) FROM tarefas t WHERE t.problema = p.id AND t.estado <> 'cancelada') AS tarefas,
         (SELECT COUNT(*) FROM execucoes e WHERE e.problema = p.id AND e.estado NOT IN ('respondida', 'pulada')) AS execucoes,
         (SELECT COUNT(*) FROM execucoes e WHERE e.problema = p.id AND e.tipo = 'executar' AND e.tentativa > 1) AS retrabalhos,
         COALESCE((SELECT SUM(custo_usd) FROM runs r WHERE r.problema = p.id), 0) AS custoUsd,
         CASE WHEN p.concluido_em IS NOT NULL THEN CAST((julianday(p.concluido_em) - julianday(p.criado_em)) * 86400000 AS INTEGER) END AS duracaoMs
       FROM problemas p WHERE 1 = 1 ${where}
       ORDER BY p.criado_em DESC LIMIT 50`
    )
    .all(...vals) as unknown as QualidadeProblema[];

  return {
    executores: executores.map((e) => ({ ...e, apontados: contar(apontados, e.modeloId) })),
    revisores: revisores.map((r) => ({
      ...r,
      itens: contar(itensRev, r.modeloId),
      precisao: r.procede + r.naoProcede ? r.procede / (r.procede + r.naoProcede) : null,
    })),
    problemas,
  };
}

// ---------- Cotas ----------

export function historicoCotas(db: Banco, desde: string): PontoCota[] {
  return db
    .prepare(
      `SELECT provedor, janela, utilizacao, capturado_em AS capturadoEm FROM limites_snapshots
       WHERE capturado_em >= ? AND utilizacao IS NOT NULL ORDER BY capturado_em`
    )
    .all(desde) as unknown as PontoCota[];
}

/** Último snapshot de cada janela de um provedor, só os que ainda não reiniciaram. */
export function cotasVigentes(db: Banco, agora = new Date()): { provedor: IdProvedor; janela: string; utilizacao: number; reiniciaEm: string | null }[] {
  const linhas = db
    .prepare(
      `SELECT provedor, janela, utilizacao, reinicia_em AS reiniciaEm FROM limites_snapshots s
       WHERE id = (SELECT id FROM limites_snapshots x WHERE x.provedor = s.provedor AND x.janela = s.janela
                   ORDER BY capturado_em DESC, id DESC LIMIT 1) AND utilizacao IS NOT NULL`
    )
    .all() as { provedor: IdProvedor; janela: string; utilizacao: number; reiniciaEm: string | null }[];
  return linhas.filter((l) => !l.reiniciaEm || new Date(l.reiniciaEm) > agora);
}
