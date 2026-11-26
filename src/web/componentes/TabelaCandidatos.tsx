import { META_METRICAS, type CandidatoPontuado, type Componente } from '../../shared/criterios';

function valor(c: Componente): string {
  const meta = META_METRICAS[c.metrica];
  if (c.valor === null) return c.amostras ? `sem dado (${c.amostras} amostra${c.amostras === 1 ? '' : 's'})` : 'sem dado';
  if (meta.origem === 'declarada') return `${c.valor}/5`;
  if (c.metrica === 'custo_medido') return `US$ ${c.valor.toFixed(4)}`;
  if (c.metrica === 'duracao_medida') return `${Math.round(c.valor / 1000)} s`;
  return `${Math.round(c.valor * 100)}% (${c.amostras})`;
}

/** Candidatos pontuados: posição, barra da pontuação, valor de cada métrica e se pode ser usado. */
export function TabelaCandidatos({ candidatos, escolhidoId }: { candidatos: CandidatoPontuado[]; escolhidoId?: number }) {
  if (!candidatos.length) return <p className="mudo pequeno">Sem candidatos.</p>;
  const metricas = candidatos[0]!.componentes.map((c) => c.metrica);
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela-candidatos">
        <thead>
          <tr>
            <th>#</th>
            <th>Modelo</th>
            <th>Pontuação</th>
            {metricas.map((m) => (
              <th key={m} title={META_METRICAS[m].descricao}>
                {META_METRICAS[m].rotulo}
              </th>
            ))}
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {candidatos.map((c, i) => (
            <tr key={c.modeloId} className={`${c.elegivel ? '' : 'arquivado'}${c.modeloId === escolhidoId ? ' escolhido' : ''}`}>
              <td>{c.elegivel ? i + 1 : '—'}</td>
              <td>
                <div className="forte">
                  {c.nome}
                  {c.modeloId === escolhidoId && <span className="selo selo-escolhido">escolhido</span>}
                </div>
                <div className="mudo pequeno mono">
                  {c.codigo} · {c.familia}
                </div>
              </td>
              <td>
                <span className="barra-pontuacao" title={`${c.pontuacao.toFixed(3)}`}>
                  <span className="barra-pontuacao-trilho" aria-hidden>
                    <span className="barra-pontuacao-valor" style={{ width: `${Math.round(c.pontuacao * 100)}%` }} />
                  </span>
                  <span className="pequeno">{c.pontuacao.toFixed(2)}</span>
                </span>
              </td>
              {c.componentes.map((x) => (
                <td key={x.metrica} className="pequeno nowrap" title={`normalizado ${x.normal.toFixed(2)} · peso ${x.peso}`}>
                  {valor(x)}
                </td>
              ))}
              <td className="pequeno">{c.elegivel ? <span className="ok-texto">pode ser usado</span> : <span className="mudo">{c.excluidoPor}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
