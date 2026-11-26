import {
  CRITERIOS_PADRAO,
  criteriosSchema,
  type CandidatoPontuado,
  type Criterios,
  type CriteriosProjeto,
  type DecisaoModelo,
  type MetricaId,
  type OrigemDecisao,
} from '../../shared/criterios.js';
import type { Banco } from './banco.js';

export function obterCriterios(db: Banco, projeto: string): CriteriosProjeto {
  const r = db.prepare('SELECT criterios_json, atualizado_em FROM criterios WHERE projeto = ?').get(projeto) as
    | { criterios_json: string; atualizado_em: string }
    | undefined;
  if (!r) return { projeto, criterios: structuredClone(CRITERIOS_PADRAO), padrao: true, atualizadoEm: null };
  // Critério salvo numa versão anterior pode não ter métricas novas: completa com o padrão.
  const salvo = JSON.parse(r.criterios_json) as Partial<Criterios>;
  const criterios = criteriosSchema.parse({
    ...CRITERIOS_PADRAO,
    ...salvo,
    pesos: { ...CRITERIOS_PADRAO.pesos, ...(salvo.pesos ?? {}) },
  });
  return { projeto, criterios, padrao: false, atualizadoEm: r.atualizado_em };
}

export function salvarCriterios(db: Banco, projeto: string, c: Criterios): CriteriosProjeto {
  db.prepare(
    `INSERT INTO criterios (projeto, criterios_json, atualizado_em) VALUES (?, ?, ?)
     ON CONFLICT(projeto) DO UPDATE SET criterios_json = excluded.criterios_json, atualizado_em = excluded.atualizado_em`
  ).run(projeto, JSON.stringify(c), new Date().toISOString());
  return obterCriterios(db, projeto);
}

export interface Medidas {
  valor: number | null;
  amostras: number;
}

/** Métricas medidas por modelo, a partir dos runs e execuções já terminados. */
export function metricasMedidas(
  db: Banco,
  modeloIds: readonly number[],
  projeto: string | null
): Map<number, Partial<Record<MetricaId, Medidas>>> {
  const saida = new Map<number, Partial<Record<MetricaId, Medidas>>>();
  if (!modeloIds.length) return saida;
  const marcas = modeloIds.map(() => '?').join(',');
  const filtroProj = projeto ? 'AND projeto = ?' : '';
  const vals = projeto ? [...modeloIds, projeto] : [...modeloIds];

  const runs = db
    .prepare(
      `SELECT modelo_id AS m, COUNT(*) AS n, SUM(estado = 'concluido') AS ok,
         AVG(custo_usd) AS custo, COUNT(custo_usd) AS nCusto, AVG(duracao_ms) AS dur, COUNT(duracao_ms) AS nDur
       FROM runs WHERE estado IN ('concluido', 'falhou', 'interrompido') AND modelo_id IN (${marcas}) ${filtroProj}
       GROUP BY modelo_id`
    )
    .all(...vals) as { m: number; n: number; ok: number; custo: number | null; nCusto: number; dur: number | null; nDur: number }[];
  for (const r of runs) {
    saida.set(r.m, {
      conclusao: { valor: r.n ? r.ok / r.n : null, amostras: r.n },
      custo_medido: { valor: r.custo, amostras: r.nCusto },
      duracao_medida: { valor: r.dur, amostras: r.nDur },
    });
  }

  // Primeira execução de cada tarefa e a primeira revisão que veio depois dela.
  const filtroProb = projeto ? 'AND ex.problema IN (SELECT id FROM problemas WHERE projeto = ?)' : '';
  const aprov = db
    .prepare(
      `SELECT ex.modelo_id AS m, COUNT(*) AS n, SUM(rv.estado = 'concluida') AS ok
       FROM execucoes ex
       JOIN execucoes rv ON rv.id = (
         SELECT MIN(r.id) FROM execucoes r
         WHERE r.tarefa_id = ex.tarefa_id AND r.tipo = 'revisar' AND r.id > ex.id AND r.estado IN ('concluida', 'reprovada'))
       WHERE ex.tipo = 'executar' AND ex.tentativa = 1 AND ex.modelo_id IN (${marcas}) ${filtroProb}
       GROUP BY ex.modelo_id`
    )
    .all(...vals) as { m: number; n: number; ok: number }[];
  for (const a of aprov) {
    const atual = saida.get(a.m) ?? {};
    atual.aprovacao_primeira = { valor: a.n ? a.ok / a.n : null, amostras: a.n };
    saida.set(a.m, atual);
  }
  return saida;
}

export function registrarDecisao(
  db: Banco,
  d: {
    execucaoId: number;
    etapaId: string;
    papel: string | null;
    origem: OrigemDecisao;
    pedidoPeloPlano: string | null;
    escolhidoId: number;
    motivo: string;
    candidatos: CandidatoPontuado[];
    criterios: Criterios;
  }
) {
  db.prepare(
    `INSERT INTO decisoes (execucao_id, etapa_id, papel, origem, pedido_pelo_plano, escolhido_id, motivo, candidatos_json,
       criterios_json, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    d.execucaoId,
    d.etapaId,
    d.papel,
    d.origem,
    d.pedidoPeloPlano,
    d.escolhidoId,
    d.motivo,
    JSON.stringify(d.candidatos),
    JSON.stringify(d.criterios),
    new Date().toISOString()
  );
}

interface LinhaDecisao {
  id: number;
  execucao_id: number;
  etapa_id: string;
  papel: string | null;
  origem: OrigemDecisao;
  pedido_pelo_plano: string | null;
  escolhido_id: number;
  motivo: string;
  candidatos_json: string;
  criterios_json: string;
  criado_em: string;
}

export function decisoesDoProblema(db: Banco, problema: string): DecisaoModelo[] {
  const linhas = db
    .prepare(
      `SELECT d.* FROM decisoes d JOIN execucoes e ON e.id = d.execucao_id WHERE e.problema = ? ORDER BY d.id`
    )
    .all(problema) as unknown as LinhaDecisao[];
  return linhas.map((l) => ({
    id: l.id,
    execucaoId: l.execucao_id,
    etapaId: l.etapa_id,
    papel: l.papel,
    origem: l.origem,
    pedidoPeloPlano: l.pedido_pelo_plano,
    escolhidoId: l.escolhido_id,
    motivo: l.motivo,
    candidatos: JSON.parse(l.candidatos_json) as CandidatoPontuado[],
    criterios: JSON.parse(l.criterios_json) as Criterios,
    criadoEm: l.criado_em,
  }));
}
