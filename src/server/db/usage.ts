import type { DiaUsage, LimiteAtual, LinhaUsage, RelatorioUsage } from '../../shared/runs.js';
import type { Banco } from './banco.js';

export interface FiltroUsage {
  /** ISO; null = todo o histórico. */
  desde: string | null;
  projeto?: string | null;
}

type Valor = string | number | null;

function filtro(f: FiltroUsage): { where: string; vals: Valor[] } {
  const conds = ["estado <> 'rodando'"];
  const vals: Valor[] = [];
  if (f.desde) (conds.push('inicio >= ?'), vals.push(f.desde));
  if (f.projeto) (conds.push('projeto = ?'), vals.push(f.projeto));
  return { where: `WHERE ${conds.join(' AND ')}`, vals };
}

export function relatorioUsage(db: Banco, f: FiltroUsage): RelatorioUsage {
  const { where, vals } = filtro(f);

  const porModelo = db
    .prepare(
      `SELECT provedor, modelo_codigo AS modeloCodigo, MAX(modelo_nome) AS modeloNome, MAX(familia) AS familia,
         COUNT(*) AS runs,
         SUM(estado = 'concluido') AS concluidos,
         SUM(estado IN ('falhou', 'interrompido')) AS falhos,
         COALESCE(SUM(tokens_entrada), 0) AS entrada,
         COALESCE(SUM(tokens_saida), 0) AS saida,
         COALESCE(SUM(tokens_cache_leitura), 0) AS cacheLeitura,
         COALESCE(SUM(tokens_cache_escrita), 0) AS cacheEscrita,
         COALESCE(SUM(tokens_raciocinio), 0) AS raciocinio,
         COALESCE(SUM(custo_usd), 0) AS custoUsd,
         SUM(custo_usd IS NULL) AS semCusto,
         AVG(duracao_ms) AS duracaoMediaMs
       FROM runs ${where}
       GROUP BY provedor, modelo_codigo
       ORDER BY custoUsd DESC, runs DESC`
    )
    .all(...vals) as unknown as LinhaUsage[];

  // O serviço roda na máquina do usuário: o dia é o do fuso local, não o UTC.
  const porDia = db
    .prepare(
      `SELECT date(inicio, 'localtime') AS dia, COUNT(*) AS runs, COALESCE(SUM(custo_usd), 0) AS custoUsd,
         COALESCE(SUM(COALESCE(tokens_entrada, 0) + COALESCE(tokens_saida, 0) + COALESCE(tokens_cache_leitura, 0)
           + COALESCE(tokens_cache_escrita, 0)), 0) AS tokens
       FROM runs ${where}
       GROUP BY dia ORDER BY dia`
    )
    .all(...vals) as unknown as DiaUsage[];

  // Último snapshot de cada janela de cada provedor (independe do filtro: é o estado atual).
  const limites = db
    .prepare(
      `SELECT provedor, janela, utilizacao, status, reinicia_em AS reiniciaEm, capturado_em AS capturadoEm
       FROM limites_snapshots s
       WHERE id = (SELECT id FROM limites_snapshots x WHERE x.provedor = s.provedor AND x.janela = s.janela
                   ORDER BY capturado_em DESC, id DESC LIMIT 1)
       ORDER BY provedor, janela`
    )
    .all() as unknown as LimiteAtual[];

  return { desde: f.desde, porModelo, porDia, limites };
}
