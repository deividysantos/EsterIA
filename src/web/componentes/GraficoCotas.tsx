import { useMemo, useRef, useState, type MouseEvent } from 'react';

import type { PontoCota } from '../../shared/qualidade';
import { dataHora } from '../formatar';

const NOME_PROVEDOR: Record<string, string> = { claude: 'Claude', cursor: 'Cursor', antigravity: 'Antigravity', codex: 'Codex' };
const NOME_JANELA: Record<string, string> = { five_hour: '5 h', seven_day: 'semana', seven_day_opus: 'semana Opus' };
const rotuloSerie = (provedor: string, janela: string) => `${NOME_PROVEDOR[provedor] ?? provedor} · ${NOME_JANELA[janela] ?? janela}`;

/** Cores categóricas em ordem fixa (slot 1, 2, 3, 4); a 5ª série em diante não é desenhada. */
const SLOTS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)'];

const L = 600;
const A = 200;
const M = { esq: 36, dir: 96, topo: 10, base: 24 };

interface Serie {
  chave: string;
  rotulo: string;
  cor: string;
  pontos: { t: number; v: number }[];
}

/** Valor vigente da série no instante t (o último ponto até t). */
function valorEm(s: Serie, t: number): number | null {
  let v: number | null = null;
  for (const p of s.pontos) {
    if (p.t > t) break;
    v = p.v;
  }
  return v;
}

export function GraficoCotas({ pontos, limite }: { pontos: PontoCota[]; limite: number | null }) {
  const [foco, setFoco] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const { series, t0, t1, omitidas } = useMemo(() => {
    const mapa = new Map<string, Serie>();
    for (const p of pontos) {
      const chave = `${p.provedor}|${p.janela}`;
      if (!mapa.has(chave)) mapa.set(chave, { chave, rotulo: rotuloSerie(p.provedor, p.janela), cor: '', pontos: [] });
      mapa.get(chave)!.pontos.push({ t: Date.parse(p.capturadoEm), v: p.utilizacao * 100 });
    }
    const todas = [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave));
    const series = todas.slice(0, SLOTS.length).map((s, i) => ({ ...s, cor: SLOTS[i]! }));
    const ts = pontos.map((p) => Date.parse(p.capturadoEm));
    const t0 = Math.min(...ts);
    const t1 = Math.max(Math.max(...ts), t0 + 60_000);
    return { series, t0, t1, omitidas: todas.length - series.length };
  }, [pontos]);

  if (!pontos.length) return <p className="mudo">Nenhuma leitura de cota no período.</p>;

  const x = (t: number) => M.esq + ((t - t0) / (t1 - t0)) * (L - M.esq - M.dir);
  const y = (v: number) => M.topo + (1 - v / 100) * (A - M.topo - M.base);
  const caminho = (s: Serie) => {
    // Degrau: o valor vale até a próxima leitura.
    let d = '';
    s.pontos.forEach((p, i) => {
      d += i === 0 ? `M${x(p.t)},${y(p.v)}` : `H${x(p.t)}V${y(p.v)}`;
    });
    return `${d}H${x(t1)}`;
  };

  // Rótulos diretos no fim de cada linha, afastados para não se sobrepor.
  const finais = series
    .map((s) => ({ s, y: y(s.pontos.at(-1)!.v) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < finais.length; i++) if (finais[i]!.y - finais[i - 1]!.y < 13) finais[i]!.y = finais[i - 1]!.y + 13;

  function mover(ev: MouseEvent<SVGSVGElement>) {
    const r = svg.current!.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * L;
    const t = t0 + ((px - M.esq) / (L - M.esq - M.dir)) * (t1 - t0);
    setFoco(Math.min(Math.max(t, t0), t1));
  }

  return (
    <div className="grafico-cotas">
      <div className="legenda" aria-hidden>
        {series.map((s) => (
          <span key={s.chave} className="legenda-item">
            <span className="legenda-amostra" style={{ background: s.cor }} />
            {s.rotulo}
          </span>
        ))}
        {limite !== null && (
          <span className="legenda-item">
            <span className="legenda-limite" /> limite {limite}%
          </span>
        )}
      </div>
      <div className="grafico-dica pequeno" aria-live="polite">
        {foco !== null ? (
          <>
            <span className="forte">{dataHora(new Date(foco).toISOString())}</span>
            {series.map((s) => {
              const v = valorEm(s, foco);
              return (
                <span key={s.chave}>
                  {' · '}
                  {s.rotulo}: {v === null ? '—' : `${Math.round(v)}%`}
                </span>
              );
            })}
          </>
        ) : (
          <span className="mudo">Passe o mouse sobre o gráfico para ler os valores.</span>
        )}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${L} ${A}`}
        className="grafico-svg"
        role="img"
        aria-label="Uso da cota ao longo do tempo, em porcentagem"
        onMouseMove={mover}
        onMouseLeave={() => setFoco(null)}
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={L - M.dir} y1={y(v)} y2={y(v)} className="grade" />
            <text x={M.esq - 6} y={y(v) + 4} className="eixo" textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {limite !== null && <line x1={M.esq} x2={L - M.dir} y1={y(limite)} y2={y(limite)} className="linha-limite" />}
        {series.map((s) => (
          <path key={s.chave} d={caminho(s)} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {series.map((s) =>
          s.pontos.map((p, i) => <circle key={`${s.chave}${i}`} cx={x(p.t)} cy={y(p.v)} r={3} fill={s.cor} stroke="var(--superficie)" strokeWidth={2} />)
        )}
        {finais.map(({ s, y: yy }) => (
          <text key={s.chave} x={L - M.dir + 6} y={yy + 4} className="rotulo-serie">
            {s.rotulo} {Math.round(s.pontos.at(-1)!.v)}%
          </text>
        ))}
        <text x={M.esq} y={A - 6} className="eixo">
          {dataHora(new Date(t0).toISOString())}
        </text>
        <text x={L - M.dir} y={A - 6} className="eixo" textAnchor="end">
          {dataHora(new Date(t1).toISOString())}
        </text>
        {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.topo} y2={A - M.base} className="cruz" />}
      </svg>
      {omitidas > 0 && <p className="mudo pequeno">{omitidas} série(s) a mais não desenhada(s); veja os valores na lista abaixo.</p>}
    </div>
  );
}
