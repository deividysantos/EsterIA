import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import type { Evento, Run as TipoRun, TipoEvento } from '../../shared/runs';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { dataHora, dolar, duracao, inteiro } from '../formatar';
import { EtiquetaRun } from './Runs';

const ROTULO_EVENTO: Record<TipoEvento, string> = {
  inicio: 'Início',
  mensagem: 'Mensagem',
  raciocinio: 'Raciocínio',
  ferramenta: 'Ferramenta',
  resultado_ferramenta: 'Retorno',
  resultado: 'Resultado',
  erro: 'Erro',
  limite: 'Cota',
  outro: 'Outro',
};

function LinhaEvento({ e, runId, inicio }: { e: Evento; runId: string; inicio: string }) {
  const [aberto, setAberto] = useState(false);
  const [bruto, setBruto] = useState<string | null>(null);
  const segundos = Math.max(0, Math.round((new Date(e.ts).getTime() - new Date(inicio).getTime()) / 1000));

  async function verBruto() {
    const b = await api.brutoEvento(runId, e.seq);
    setBruto(b === null ? '(sem bruto)' : JSON.stringify(b, null, 2));
  }

  return (
    <li className={`evento evento-${e.tipo}`}>
      <button className="evento-cabeca" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span className="evento-tempo mono">+{segundos}s</span>
        <span className="evento-tipo">{ROTULO_EVENTO[e.tipo]}</span>
        <span className="evento-resumo">{e.resumo}</span>
      </button>
      {aberto && (
        <div className="evento-corpo">
          {e.texto && <pre>{e.texto}</pre>}
          {bruto ? (
            <pre className="mudo">{bruto}</pre>
          ) : (
            <button className="secundario pequeno" onClick={verBruto}>
              Ver JSON bruto
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return agora;
}

function linkRetomar(r: TipoRun) {
  const q = new URLSearchParams({ novo: '1', modelo: String(r.modeloId ?? ''), modo: r.modo, sessao: r.sessao ?? '' });
  if (r.projeto) q.set('projeto', r.projeto);
  else q.set('cwd', r.cwd);
  return `/runs?${q}`;
}

export function Run() {
  useAoVivo();
  const { id = '' } = useParams();
  const det = useQuery({ queryKey: ['run', id], queryFn: () => api.run(id) });
  const cancelar = useMutation({ mutationFn: () => api.cancelarRun(id) });
  const r = det.data?.run;
  const agora = useAgora(r?.estado === 'rodando');

  if (det.isLoading) return <p className="mudo">Carregando…</p>;
  if (det.isError || !r || !det.data) return <p className="erro">{(det.error as Error | null)?.message ?? 'Run não encontrado.'}</p>;
  const { eventos, stderr, stderrTruncado } = det.data;
  const dur = r.estado === 'rodando' ? agora - new Date(r.inicio).getTime() : r.duracaoMs;

  return (
    <section>
      <header className="cabecalho">
        <div>
          <div className="trilha">
            <Link to="/runs" className="link">
              Runs
            </Link>{' '}
            / <span className="mono pequeno">{r.id.slice(0, 8)}</span>
          </div>
          <h1 className="titulo-run">
            {r.modeloNome} <EtiquetaRun estado={r.estado} />
          </h1>
        </div>
        <div className="cabecalho-acoes">
          {r.estado === 'rodando' ? (
            <button className="secundario perigo" onClick={() => cancelar.mutate()} disabled={cancelar.isPending}>
              {cancelar.isPending ? 'Cancelando…' : 'Cancelar'}
            </button>
          ) : (
            r.sessao &&
            r.modeloId && (
              <Link to={linkRetomar(r)} className="botao-link">
                Retomar sessão
              </Link>
            )
          )}
        </div>
      </header>
      {cancelar.isError && <p className="erro">{(cancelar.error as Error).message}</p>}
      {r.erro && <p className="erro caixa-erro">{r.erro}</p>}

      <div className="grade-cartoes grade-kpi">
        <div className="cartao">
          <div className="cartao-rotulo">Duração</div>
          <div className="cartao-valor pequeno">{duracao(dur)}</div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Custo</div>
          <div className="cartao-valor pequeno">{dolar(r.custoUsd)}</div>
          <div className="mudo pequeno">
            {r.custoOrigem === 'cli' ? 'informado pelo CLI' : r.custoOrigem === 'estimado' ? 'estimado pela tabela de preços' : 'sem preço'}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Tokens entrada / saída</div>
          <div className="cartao-valor pequeno">
            {inteiro(r.usage.entrada)} / {inteiro(r.usage.saida)}
          </div>
          <div className="mudo pequeno">raciocínio {inteiro(r.usage.raciocinio)} (incluído na saída)</div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Cache leitura / escrita</div>
          <div className="cartao-valor pequeno">
            {inteiro(r.usage.cacheLeitura)} / {inteiro(r.usage.cacheEscrita)}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Mensagens · ferramentas · turnos</div>
          <div className="cartao-valor pequeno">
            {r.contagemMensagens} · {r.contagemFerramentas} · {r.numTurnos ?? '—'}
          </div>
        </div>
      </div>

      <dl className="campos campos-run">
        <dt>Projeto</dt>
        <dd>{r.projeto ?? '—'}</dd>
        <dt>Pasta</dt>
        <dd className="mono quebra">{r.cwd}</dd>
        <dt>Modo</dt>
        <dd>{r.modo === 'leitura' ? 'Leitura' : 'Escrita'}</dd>
        <dt>Modelo</dt>
        <dd className="mono">
          {r.modeloCodigo}
          {r.modeloReportado && r.modeloReportado !== r.modeloCodigo && <span className="mudo"> (CLI: {r.modeloReportado})</span>}
        </dd>
        <dt>Sessão</dt>
        <dd className="mono quebra">
          {r.sessao ?? '—'}
          {r.sessaoRetomada && <span className="mudo"> (retomou {r.sessaoRetomada})</span>}
        </dd>
        <dt>Início · fim</dt>
        <dd>
          {dataHora(r.inicio)} · {dataHora(r.fim)}
        </dd>
        {r.arquivos.length > 0 && (
          <>
            <dt>Arquivos</dt>
            <dd className="mono quebra">{r.arquivos.join(', ')}</dd>
          </>
        )}
        <dt>Comando</dt>
        <dd className="mono quebra pequeno">{r.comando.join(' ')}</dd>
      </dl>

      <details className="bloco">
        <summary>Prompt</summary>
        <pre>{r.prompt}</pre>
      </details>

      {r.resultadoTexto && (
        <div className="bloco">
          <h2>Resultado</h2>
          <pre>{r.resultadoTexto}</pre>
        </div>
      )}

      <div className="bloco">
        <h2>
          Eventos <span className="mudo pequeno">({eventos.length})</span>
        </h2>
        {eventos.length === 0 ? (
          <p className="mudo">{r.estado === 'rodando' ? 'Aguardando o primeiro evento…' : 'Nenhum evento.'}</p>
        ) : (
          <ol className="eventos">
            {eventos.map((e) => (
              <LinhaEvento key={e.seq} e={e} runId={r.id} inicio={r.inicio} />
            ))}
          </ol>
        )}
      </div>

      {stderr && (
        <details className="bloco">
          <summary>
            stderr{stderrTruncado ? ' (truncado)' : ''} <span className="mudo pequeno">{inteiro(stderr.length)} caracteres</span>
          </summary>
          <pre>{stderr}</pre>
        </details>
      )}
    </section>
  );
}
