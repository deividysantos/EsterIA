import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import type { EstadoProblema, ResumoProblema } from '../../shared/problemas';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { dataHora, dolar } from '../formatar';

export const ROTULO_PROBLEMA: Record<EstadoProblema, string> = {
  em_andamento: 'Em andamento',
  aguardando: 'Aguardando você',
  bloqueado: 'Bloqueado',
  pausado: 'Pausado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export function EtiquetaProblema({ estado }: { estado: EstadoProblema }) {
  return <span className={`etiqueta etiqueta-prob-${estado}`}>{ROTULO_PROBLEMA[estado]}</span>;
}

export function Progresso({ p }: { p: ResumoProblema }) {
  if (!p.tarefasTotal) return <span className="mudo">—</span>;
  const pct = Math.round((p.tarefasConcluidas / p.tarefasTotal) * 100);
  return (
    <span className="progresso" title={`${p.tarefasConcluidas} de ${p.tarefasTotal} tarefas`}>
      <span className="progresso-trilho" aria-hidden>
        <span className="progresso-barra" style={{ width: `${pct}%` }} />
      </span>
      <span className="pequeno">
        {p.tarefasConcluidas}/{p.tarefasTotal}
      </span>
    </span>
  );
}

function FormNovoProblema() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const projetos = useQuery({ queryKey: ['projetos', false], queryFn: () => api.projetos(false) });
  const [projeto, setProjeto] = useState(params.get('projeto') ?? '');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const criar = useMutation({ mutationFn: api.criarProblema, onSuccess: (p) => navegar(`/problemas/${p.id}`) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    criar.mutate({ projeto, titulo, descricao });
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <h2 className="largo">Novo problema</h2>
      <label>
        Projeto
        <select value={projeto} onChange={(e) => setProjeto(e.target.value)} required>
          <option value="">Escolha…</option>
          {projetos.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        Título
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required placeholder="Ex.: validar CPF no cadastro" />
      </label>
      <label className="largo">
        Descrição (o orquestrador lê isto e pode fazer perguntas antes de planejar)
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={7} required />
      </label>
      <p className="mudo pequeno largo">
        O problema começa na hora, na versão atual da esteira do projeto.{' '}
        {projeto && (
          <Link to={`/esteiras/${projeto}`} className="link">
            Ver a esteira
          </Link>
        )}
      </p>
      <div className="acoes">
        <button type="submit" disabled={criar.isPending}>
          {criar.isPending ? 'Criando…' : 'Criar e iniciar'}
        </button>
      </div>
      {criar.isError && <p className="erro largo">{(criar.error as Error).message}</p>}
    </form>
  );
}

export function Problemas() {
  useAoVivo();
  const [params, setParams] = useSearchParams();
  const mostrarForm = params.get('novo') === '1';
  const [estado, setEstado] = useState('');
  const lista = useQuery({ queryKey: ['problemas'], queryFn: () => api.problemas() });
  const itens = (lista.data ?? []).filter((p) => !estado || p.estado === estado);

  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Problemas</h1>
          <p className="mudo subtitulo">Cada problema percorre a esteira do projeto: plano, tarefas, execução, revisão e commit.</p>
        </div>
        <div className="cabecalho-acoes">
          <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos os estados</option>
            {Object.entries(ROTULO_PROBLEMA).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button onClick={() => setParams(mostrarForm ? {} : { novo: '1' })}>{mostrarForm ? 'Fechar' : 'Novo problema'}</button>
        </div>
      </header>

      {mostrarForm && <FormNovoProblema />}
      {lista.isError && <p className="erro">{(lista.error as Error).message}</p>}
      {lista.data && itens.length === 0 && <p className="vazio">Nenhum problema por aqui. Comece por “Novo problema”.</p>}
      {itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Problema</th>
                <th>Estado</th>
                <th>Tarefas</th>
                <th>Custo</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((p) => (
                <tr key={p.id} className={`linha-clicavel${p.esperando || p.estado === 'bloqueado' ? ' linha-atencao' : ''}`}>
                  <td>
                    <Link to={`/problemas/${p.id}`} className="link-linha forte">
                      #{p.numero} {p.titulo}
                    </Link>
                    <div className="mudo pequeno">
                      {p.projeto}
                      {p.esperando && ` · esperando: ${p.esperando.etapaNome}`}
                    </div>
                  </td>
                  <td>
                    <EtiquetaProblema estado={p.estado} />
                  </td>
                  <td>
                    <Progresso p={p} />
                  </td>
                  <td className="nowrap">{dolar(p.custoUsd)}</td>
                  <td className="nowrap">{dataHora(p.atualizadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
