import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { DiaUsage, LimiteAtual } from '../../shared/runs';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { dataHora, dolar, duracao, inteiro, tokensCompacto } from '../formatar';

const PERIODOS = [
  { dias: 1, rotulo: '24 h' },
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 0, rotulo: 'Tudo' },
];

const NOME_PROVEDOR: Record<string, string> = {
  claude: 'Claude Code',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  codex: 'Codex',
};

const NOME_JANELA: Record<string, string> = {
  five_hour: 'Janela de 5 h',
  seven_day: 'Semana',
  seven_day_opus: 'Semana (Opus)',
};

function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dias do período (no fuso local, como o servidor agrupa) sem lacunas, para o eixo não pular datas. */
function preencherDias(dias: DiaUsage[], periodo: number): DiaUsage[] {
  if (!dias.length) return [];
  const mapa = new Map(dias.map((d) => [d.dia, d]));
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  const ini = new Date(hoje);
  if (periodo > 0) ini.setDate(ini.getDate() - (periodo - 1));
  else {
    const [a, m, d] = dias[0]!.dia.split('-').map(Number);
    ini.setFullYear(a!, m! - 1, d!);
  }
  const saida: DiaUsage[] = [];
  for (const c = new Date(ini); c <= hoje; c.setDate(c.getDate() + 1)) {
    const dia = diaLocal(c);
    saida.push(mapa.get(dia) ?? { dia, runs: 0, custoUsd: 0, tokens: 0 });
  }
  return saida.slice(-60);
}

function GraficoDias({ dias }: { dias: DiaUsage[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(...dias.map((d) => d.custoUsd), 0);
  if (!dias.length) return <p className="mudo">Sem runs no período.</p>;
  const d = foco !== null ? dias[foco] : null;
  const rotulo = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return (
    <div className="grafico" onMouseLeave={() => setFoco(null)}>
      <div className="grafico-dica" aria-live="polite">
        {d ? (
          <>
            <span className="forte">{rotulo(d.dia)}</span> · {dolar(d.custoUsd)} · {d.runs} run{d.runs === 1 ? '' : 's'} ·{' '}
            {tokensCompacto(d.tokens)} tokens
          </>
        ) : (
          <span className="mudo">Passe o mouse sobre um dia. Máximo no período: {dolar(max)}</span>
        )}
      </div>
      <div className="grafico-area" role="img" aria-label="Custo por dia">
        {dias.map((x, i) => (
          <div
            key={x.dia}
            className={`grafico-coluna${foco === i ? ' em-foco' : ''}`}
            onMouseEnter={() => setFoco(i)}
            onFocus={() => setFoco(i)}
            tabIndex={0}
          >
            <div className="grafico-barra" style={{ height: max > 0 ? `${Math.max((x.custoUsd / max) * 100, x.custoUsd > 0 ? 2 : 0)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="grafico-eixo">
        <span>{rotulo(dias[0]!.dia)}</span>
        <span>{rotulo(dias.at(-1)!.dia)}</span>
      </div>
    </div>
  );
}

function Medidor({ l }: { l: LimiteAtual }) {
  const pct = l.utilizacao === null ? null : Math.round(l.utilizacao * 100);
  const alto = pct !== null && pct >= 90;
  return (
    <li className="medidor">
      <div className="medidor-nome">
        <span className="forte">{NOME_PROVEDOR[l.provedor] ?? l.provedor}</span> · {NOME_JANELA[l.janela] ?? l.janela}
      </div>
      <div className="medidor-trilho" aria-hidden>
        <div className={`medidor-barra${alto ? ' critico' : ''}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
      </div>
      <div className="medidor-valor">
        <span className="forte">{pct === null ? '—' : `${pct}%`}</span>
        {alto && <span className="aviso-texto"> ⚠ perto do limite</span>}
        <div className="mudo pequeno">
          {l.reiniciaEm ? `reinicia ${dataHora(l.reiniciaEm)}` : ''} · lido {dataHora(l.capturadoEm)}
        </div>
      </div>
    </li>
  );
}

export function Usage() {
  useAoVivo();
  const [dias, setDias] = useState(30);
  const [projeto, setProjeto] = useState('');
  const projetos = useQuery({ queryKey: ['projetos', false], queryFn: () => api.projetos(false) });
  const rel = useQuery({ queryKey: ['usage', dias, projeto], queryFn: () => api.usage(dias, projeto || undefined) });

  const totais = useMemo(() => {
    const l = rel.data?.porModelo ?? [];
    const soma = (k: 'runs' | 'concluidos' | 'falhos' | 'custoUsd' | 'entrada' | 'saida' | 'cacheLeitura' | 'cacheEscrita' | 'semCusto') =>
      l.reduce((t, x) => t + (x[k] ?? 0), 0);
    return {
      runs: soma('runs'),
      concluidos: soma('concluidos'),
      falhos: soma('falhos'),
      custo: soma('custoUsd'),
      tokens: soma('entrada') + soma('saida') + soma('cacheLeitura') + soma('cacheEscrita'),
      semCusto: soma('semCusto'),
    };
  }, [rel.data]);

  const serie = useMemo(() => preencherDias(rel.data?.porDia ?? [], dias), [rel.data, dias]);

  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Usage</h1>
          <p className="mudo subtitulo">Tokens e custo por modelo. Métricas de qualidade entram na F6.</p>
        </div>
        <div className="cabecalho-acoes filtros">
          <div className="segmentado" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.dias} className={dias === p.dias ? 'ativo' : 'secundario'} onClick={() => setDias(p.dias)} aria-pressed={dias === p.dias}>
                {p.rotulo}
              </button>
            ))}
          </div>
          <select value={projeto} onChange={(e) => setProjeto(e.target.value)} aria-label="Projeto">
            <option value="">Todos os projetos</option>
            {projetos.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
      </header>

      {rel.isError && <p className="erro">{(rel.error as Error).message}</p>}

      <div className="grade-cartoes grade-kpi">
        <div className="cartao">
          <div className="cartao-rotulo">Custo</div>
          <div className="cartao-valor">{dolar(totais.custo)}</div>
          {totais.semCusto > 0 && <div className="mudo pequeno">{totais.semCusto} run(s) sem preço, fora da soma</div>}
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Runs</div>
          <div className="cartao-valor">{inteiro(totais.runs)}</div>
          <div className="mudo pequeno">
            {totais.concluidos} concluídos · {totais.falhos} com falha
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Tokens (com cache)</div>
          <div className="cartao-valor">{tokensCompacto(totais.tokens)}</div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Taxa de conclusão</div>
          <div className="cartao-valor">{totais.runs ? `${Math.round((totais.concluidos / totais.runs) * 100)}%` : '—'}</div>
        </div>
      </div>

      <div className="bloco">
        <h2>Custo por dia</h2>
        <GraficoDias dias={serie} />
      </div>

      <div className="bloco">
        <h2>Cotas das assinaturas</h2>
        <p className="mudo pequeno">
          Último valor informado pelo próprio CLI durante um run (hoje só o Claude Code envia). Dado não oficial: pode mudar
          com atualizações do CLI.
        </p>
        {rel.data && rel.data.limites.length === 0 ? (
          <p className="mudo">Nenhuma leitura de cota ainda.</p>
        ) : (
          <ul className="medidores">{rel.data?.limites.map((l) => <Medidor key={`${l.provedor}-${l.janela}`} l={l} />)}</ul>
        )}
      </div>

      <div className="bloco">
        <h2>Por modelo</h2>
        {rel.data && rel.data.porModelo.length === 0 ? (
          <p className="mudo">Sem runs no período.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-numeros">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Runs</th>
                  <th>Concl. / falha</th>
                  <th>Entrada</th>
                  <th>Saída</th>
                  <th>Cache leit.</th>
                  <th>Cache escr.</th>
                  <th>Duração média</th>
                  <th>Custo</th>
                </tr>
              </thead>
              <tbody>
                {rel.data?.porModelo.map((m) => (
                  <tr key={`${m.provedor}-${m.modeloCodigo}`}>
                    <td>
                      <div className="forte">{m.modeloNome}</div>
                      <div className="mudo pequeno">
                        {NOME_PROVEDOR[m.provedor]} · {m.familia}
                      </div>
                    </td>
                    <td>{inteiro(m.runs)}</td>
                    <td>
                      {m.concluidos} / {m.falhos}
                    </td>
                    <td>{tokensCompacto(m.entrada)}</td>
                    <td>{tokensCompacto(m.saida)}</td>
                    <td>{tokensCompacto(m.cacheLeitura)}</td>
                    <td>{tokensCompacto(m.cacheEscrita)}</td>
                    <td>{duracao(m.duracaoMediaMs)}</td>
                    <td>
                      {dolar(m.custoUsd)}
                      {m.semCusto > 0 && <span className="mudo" title={`${m.semCusto} run(s) sem preço`}> *</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
