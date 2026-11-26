import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import type { AcaoProblema, DetalheProblema, EstadoExecucao, EstadoTarefa, Execucao, Plano } from '../../shared/problemas';
import type { DecisaoModelo } from '../../shared/criterios';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { TabelaCandidatos } from '../componentes/TabelaCandidatos';
import { dataHora, dolar, duracao } from '../formatar';
import { EtiquetaProblema, Progresso } from './Problemas';

const ROTULO_EXEC: Record<EstadoExecucao, string> = {
  rodando: 'Rodando',
  aguardando: 'Esperando você',
  concluida: 'Concluída',
  reprovada: 'Reprovada',
  falhou: 'Falhou',
  pulada: 'Pulada',
  cancelada: 'Cancelada',
  respondida: 'Respondida',
};

const ROTULO_TAREFA: Record<EstadoTarefa, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  bloqueada: 'Bloqueada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

function useAcao(id: string) {
  return useMutation({ mutationFn: (acao: AcaoProblema) => api.acaoProblema(id, acao) });
}

function PainelEspera({ d }: { d: DetalheProblema }) {
  const esp = d.problema.esperando!;
  const exec = d.execucoes.find((e) => e.id === esp.execucaoId);
  const etapa = d.definicao.etapas.find((e) => e.id === exec?.etapaId);
  const [comentario, setComentario] = useState('');
  const perguntas = esp.espera === 'perguntas' ? ((exec?.saida as Plano | null)?.perguntas ?? []) : [];
  const [respostas, setRespostas] = useState<string[]>(() => perguntas.map(() => ''));
  const decidir = useMutation({ mutationFn: (dados: Parameters<typeof api.decidir>[1]) => api.decidir(esp.execucaoId, dados) });

  if (esp.espera === 'perguntas') {
    return (
      <div className="painel-acao">
        <h2>O orquestrador tem perguntas antes de planejar</h2>
        {perguntas.map((q, i) => (
          <label key={i} className="campo-resposta">
            <span className="forte">{q}</span>
            <textarea
              value={respostas[i] ?? ''}
              rows={2}
              onChange={(e) => setRespostas((r) => r.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </label>
        ))}
        <div className="acoes-linha">
          <button disabled={decidir.isPending} onClick={() => decidir.mutate({ acao: 'responder', respostas })}>
            Enviar respostas
          </button>
        </div>
        {decidir.isError && <p className="erro">{(decidir.error as Error).message}</p>}
      </div>
    );
  }

  return (
    <div className="painel-acao">
      <h2>{esp.etapaNome}: aprove ou devolva</h2>
      {etapa?.prompt && <p className="mudo">{etapa.prompt}</p>}
      {exec?.feedback && (
        <details>
          <summary className="pequeno">Retorno da etapa anterior</summary>
          <pre>{exec.feedback}</pre>
        </details>
      )}
      <label className="campo-resposta">
        Comentário (obrigatório para devolver; vai para a etapa de destino)
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} />
      </label>
      <div className="acoes-linha">
        <button disabled={decidir.isPending} onClick={() => decidir.mutate({ acao: 'aprovar', comentario })}>
          Aprovar
        </button>
        <button
          className="secundario"
          disabled={decidir.isPending || !comentario.trim()}
          onClick={() => decidir.mutate({ acao: 'devolver', comentario })}
        >
          Devolver
        </button>
      </div>
      {decidir.isError && <p className="erro">{(decidir.error as Error).message}</p>}
    </div>
  );
}

function PainelBloqueio({ d }: { d: DetalheProblema }) {
  const acao = useAcao(d.problema.id);
  const tarefaBloq = d.tarefas.find((t) => t.estado === 'bloqueada');
  return (
    <div className="painel-acao painel-bloqueio">
      <h2>Bloqueado{tarefaBloq ? ` na tarefa ${tarefaBloq.codigo}` : ''}</h2>
      <p className="quebra">{d.problema.motivo}</p>
      <div className="acoes-linha">
        <button disabled={acao.isPending} onClick={() => acao.mutate('tentar_de_novo')} title="Zera as tentativas e repete a partir do ponto da falha">
          Tentar de novo
        </button>
        <button className="secundario" disabled={acao.isPending} onClick={() => acao.mutate('pular_etapa')} title="Considera a etapa que falhou como feita">
          Pular a etapa
        </button>
        {tarefaBloq && (
          <>
            <button className="secundario" disabled={acao.isPending} onClick={() => acao.mutate('concluir_tarefa')}>
              Dar a tarefa por concluída
            </button>
            <button className="secundario perigo" disabled={acao.isPending} onClick={() => acao.mutate('cancelar_tarefa')}>
              Cancelar a tarefa
            </button>
          </>
        )}
      </div>
      {acao.isError && <p className="erro">{(acao.error as Error).message}</p>}
    </div>
  );
}

const ROTULO_ORIGEM: Record<DecisaoModelo['origem'], string> = {
  plano: 'escolha do plano',
  pontuacao: 'maior pontuação',
  fixo: 'modelo fixo da etapa',
  escalada: 'troca de modelo por tentativa',
};

function LinhaExecucao({ e, decisao }: { e: Execucao; decisao: DecisaoModelo | undefined }) {
  const [aberta, setAberta] = useState(false);
  const fim = e.fim ? new Date(e.fim).getTime() : Date.now();
  return (
    <>
      <tr className={`exec-${e.estado}`}>
        <td>
          <button className="link-botao" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
            {aberta ? '▾' : '▸'} {e.etapaNome}
          </button>
        </td>
        <td>{e.tarefaCodigo ?? <span className="mudo">problema</span>}</td>
        <td>{e.tentativa}</td>
        <td>{e.modeloNome ?? <span className="mudo">—</span>}</td>
        <td>
          <span className={`etiqueta etiqueta-exec-${e.estado}`}>{ROTULO_EXEC[e.estado]}</span>
        </td>
        <td className="nowrap">{duracao(fim - new Date(e.inicio).getTime())}</td>
        <td className="nowrap">{dolar(e.custoUsd)}</td>
        <td>
          {e.runId && (
            <Link to={`/runs/${e.runId}`} className="link">
              run
            </Link>
          )}
        </td>
      </tr>
      {aberta && (
        <tr className="exec-detalhe">
          <td colSpan={8}>
            {e.motivoEscolha && (
              <p className="pequeno">
                <span className="forte">Escolha do modelo{decisao ? ` (${ROTULO_ORIGEM[decisao.origem]})` : ''}:</span> {e.motivoEscolha}
                {decisao?.pedidoPeloPlano && <span className="mudo"> · o plano pediu {decisao.pedidoPeloPlano}</span>}
              </p>
            )}
            {decisao && decisao.candidatos.length > 0 && (
              <details className="decisao">
                <summary className="pequeno">Candidatos e pontuação no momento da escolha</summary>
                <TabelaCandidatos candidatos={decisao.candidatos} escolhidoId={decisao.escolhidoId} />
              </details>
            )}
            {e.erro && <p className="erro pequeno">{e.erro}</p>}
            {e.feedback && (
              <>
                <div className="pequeno forte">Retorno recebido</div>
                <pre>{e.feedback}</pre>
              </>
            )}
            {e.saidaTexto && (
              <>
                <div className="pequeno forte">Saída</div>
                <pre>{e.saidaTexto}</pre>
              </>
            )}
            <div className="mudo pequeno">
              {dataHora(e.inicio)} · {dataHora(e.fim)}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function Problema() {
  useAoVivo();
  const { id = '' } = useParams();
  const det = useQuery({ queryKey: ['problema', id], queryFn: () => api.problema(id), refetchInterval: 10_000 });
  const acao = useAcao(id);
  if (det.isLoading) return <p className="mudo">Carregando…</p>;
  if (det.isError || !det.data) return <p className="erro">{(det.error as Error | null)?.message ?? 'Não encontrado.'}</p>;
  const d = det.data;
  const p = d.problema;
  const ativo = ['em_andamento', 'aguardando', 'bloqueado'].includes(p.estado);

  return (
    <section>
      <header className="cabecalho">
        <div>
          <div className="trilha">
            <Link to="/problemas" className="link">
              Problemas
            </Link>{' '}
            / {p.projeto} #{p.numero}
          </div>
          <h1 className="titulo-run">
            {p.titulo} <EtiquetaProblema estado={p.estado} />
          </h1>
          <div className="mudo pequeno">
            <Link to={`/esteiras/${p.projeto}`} className="link">
              Esteira v{p.esteiraVersao}
            </Link>{' '}
            · criado {dataHora(p.criadoEm)} · custo {dolar(p.custoUsd)}
          </div>
        </div>
        <div className="cabecalho-acoes">
          {ativo && (
            <button className="secundario" disabled={acao.isPending} onClick={() => acao.mutate('pausar')}>
              Pausar
            </button>
          )}
          {p.estado === 'pausado' && (
            <button disabled={acao.isPending} onClick={() => acao.mutate('retomar')}>
              Retomar
            </button>
          )}
          {!['concluido', 'cancelado'].includes(p.estado) && (
            <button
              className="secundario perigo"
              disabled={acao.isPending}
              onClick={() => confirm('Cancelar o problema? Agentes em execução serão encerrados.') && acao.mutate('cancelar')}
            >
              Cancelar
            </button>
          )}
        </div>
      </header>
      {acao.isError && <p className="erro">{(acao.error as Error).message}</p>}

      {p.esperando && p.estado !== 'pausado' && <PainelEspera key={p.esperando.execucaoId} d={d} />}
      {p.estado === 'bloqueado' && <PainelBloqueio d={d} />}

      <details className="bloco" open={!p.plano}>
        <summary>Descrição</summary>
        <pre>{p.descricao}</pre>
        {p.respostas.length > 0 && (
          <>
            <h2>Perguntas e respostas</h2>
            <ul>
              {p.respostas.map((r, i) => (
                <li key={i}>
                  <span className="forte">{r.pergunta}</span> — {r.resposta}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>

      <div className="bloco">
        <h2 className="titulo-run">
          Plano <Progresso p={p} />
        </h2>
        {p.plano?.resumo && <p>{p.plano.resumo}</p>}
        {d.tarefas.length === 0 ? (
          <p className="mudo">{p.plano ? 'O plano não tem tarefas.' : 'Ainda sem plano.'}</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Tarefa</th>
                  <th>Estado</th>
                  <th>Modelos</th>
                  <th>Revisão</th>
                  <th>Depende de</th>
                  <th>Commit</th>
                </tr>
              </thead>
              <tbody>
                {d.tarefas.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <details>
                        <summary>
                          <span className="forte">{t.codigo}</span> {t.titulo}
                        </summary>
                        <pre>{t.descricao}</pre>
                        {t.justificativa && <p className="mudo pequeno">{t.justificativa}</p>}
                        {t.motivo && <p className="erro pequeno">{t.motivo}</p>}
                      </details>
                    </td>
                    <td>
                      <span className={`etiqueta etiqueta-tarefa-${t.estado}`}>{ROTULO_TAREFA[t.estado]}</span>
                    </td>
                    <td className="pequeno mono">
                      {Object.entries(t.modelos).map(([papel, cod]) => (
                        <div key={papel}>
                          {papel}: {cod}
                        </div>
                      ))}
                    </td>
                    <td>{t.revisaoIndependente ? 'sim' : 'não'}</td>
                    <td>{t.dependeDe.join(', ') || '—'}</td>
                    <td className="mono pequeno">{t.commit ? t.commit.slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bloco">
        <h2>
          Linha do tempo <span className="mudo pequeno">({d.execucoes.length} execuções)</span>
        </h2>
        {d.execucoes.length === 0 ? (
          <p className="mudo">{p.estado === 'em_andamento' ? 'Esperando vaga na fila…' : 'Nada executado ainda.'}</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Tarefa</th>
                  <th>Tent.</th>
                  <th>Modelo</th>
                  <th>Estado</th>
                  <th>Duração</th>
                  <th>Custo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.execucoes.map((e) => (
                  <LinhaExecucao key={e.id} e={e} decisao={d.decisoes.find((x) => x.execucaoId === e.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
