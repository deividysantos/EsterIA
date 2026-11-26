import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { ID_PROVEDORES } from '../../shared/provedores';
import type { EstadoRun, Modo, Run } from '../../shared/runs';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { dataHora, dolar, duracao, ROTULO_ESTADO_RUN, tokensCompacto, totalTokens } from '../formatar';

export function EtiquetaRun({ estado }: { estado: EstadoRun }) {
  return <span className={`etiqueta etiqueta-run-${estado}`}>{ROTULO_ESTADO_RUN[estado]}</span>;
}

function FormNovoRun() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: api.modelos });
  const provedores = useQuery({ queryKey: ['provedores'], queryFn: api.provedores });
  const projetos = useQuery({ queryKey: ['projetos', false], queryFn: () => api.projetos(false) });

  const [modeloId, setModeloId] = useState(params.get('modelo') ?? '');
  const [projeto, setProjeto] = useState(params.get('projeto') ?? '');
  const [cwd, setCwd] = useState(params.get('cwd') ?? '');
  const [modo, setModo] = useState<Modo>((params.get('modo') as Modo) === 'escrita' ? 'escrita' : 'leitura');
  const [prompt, setPrompt] = useState('');
  const [sessao, setSessao] = useState(params.get('sessao') ?? '');
  const [timeout, setTimeoutMin] = useState('');

  const habilitado = useMemo(
    () => new Map((provedores.data ?? []).map((p) => [p.id, p])),
    [provedores.data]
  );

  const criar = useMutation({
    mutationFn: api.criarRun,
    onSuccess: (r) => navegar(`/runs/${r.id}`),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    criar.mutate({
      modeloId: Number(modeloId),
      projeto: projeto || null,
      cwd: projeto ? cwd.trim() || null : cwd.trim() || null,
      modo,
      prompt,
      sessao: sessao.trim() || null,
      timeoutMin: timeout ? Number(timeout) : null,
    });
  }

  const raizProjeto = projetos.data?.find((p) => p.id === projeto)?.raiz;

  return (
    <form className="formulario" onSubmit={enviar}>
      <h2 className="largo">{sessao ? 'Retomar sessão' : 'Novo run avulso'}</h2>
      <label>
        Modelo
        <select value={modeloId} onChange={(e) => setModeloId(e.target.value)} required>
          <option value="">Escolha…</option>
          {ID_PROVEDORES.map((pid) => {
            const p = habilitado.get(pid);
            const itens = (modelos.data ?? []).filter((m) => m.provedor === pid);
            if (!itens.length) return null;
            return (
              <optgroup key={pid} label={`${p?.nome ?? pid}${p?.habilitado ? '' : ' (indisponível)'}`}>
                {itens.map((m) => (
                  <option key={m.id} value={m.id} disabled={!p?.habilitado || !m.ativo}>
                    {m.nome}
                    {!m.ativo ? ' (inativo)' : ''}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      <label>
        Projeto
        <select value={projeto} onChange={(e) => setProjeto(e.target.value)}>
          <option value="">Nenhum (informar pasta)</option>
          {projetos.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="largo">
        Pasta de trabalho
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={raizProjeto ? `Raiz do projeto: ${raizProjeto}` : 'C:\\caminho\\da\\pasta'}
          required={!projeto}
        />
      </label>
      <fieldset className="largo grupo grupo-modo">
        <legend>Modo</legend>
        <label className="alternador">
          <input type="radio" name="modo" checked={modo === 'leitura'} onChange={() => setModo('leitura')} />
          Leitura (não edita arquivos)
        </label>
        <label className="alternador">
          <input type="radio" name="modo" checked={modo === 'escrita'} onChange={() => setModo('escrita')} />
          Escrita (edita e roda comandos sem pedir permissão)
        </label>
      </fieldset>
      <label className="largo">
        Prompt
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} required />
      </label>
      <label>
        Sessão a retomar (opcional)
        <input value={sessao} onChange={(e) => setSessao(e.target.value)} className="mono" />
      </label>
      <label>
        Tempo máximo em minutos (opcional)
        <input value={timeout} onChange={(e) => setTimeoutMin(e.target.value)} inputMode="numeric" />
      </label>
      <div className="acoes">
        <button type="submit" disabled={criar.isPending}>
          {criar.isPending ? 'Iniciando…' : 'Iniciar run'}
        </button>
      </div>
      {criar.isError && <p className="erro largo">{(criar.error as Error).message}</p>}
    </form>
  );
}

export function Runs() {
  useAoVivo();
  const [params, setParams] = useSearchParams();
  const mostrarForm = params.get('novo') === '1';
  const [filtroEstado, setFiltroEstado] = useState('');
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api.runs() });
  const lista = (runs.data ?? []).filter((r: Run) => !filtroEstado || r.estado === filtroEstado);

  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Runs</h1>
          <p className="mudo subtitulo">Cada chamada de um CLI de agente, com eventos, tokens e custo.</p>
        </div>
        <div className="cabecalho-acoes">
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} aria-label="Filtrar por estado">
            <option value="">Todos os estados</option>
            {Object.entries(ROTULO_ESTADO_RUN).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button onClick={() => setParams(mostrarForm ? {} : { novo: '1' })}>{mostrarForm ? 'Fechar' : 'Novo run'}</button>
        </div>
      </header>

      {mostrarForm && <FormNovoRun key={params.toString()} />}

      {runs.isError && <p className="erro">{(runs.error as Error).message}</p>}
      {runs.data && lista.length === 0 && <p className="vazio">Nenhum run ainda. Comece por “Novo run”.</p>}
      {lista.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Modelo</th>
                <th>Projeto / pasta</th>
                <th>Início</th>
                <th>Duração</th>
                <th>Tokens</th>
                <th>Custo</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} className="linha-clicavel">
                  <td>
                    <Link to={`/runs/${r.id}`} className="link-linha">
                      <EtiquetaRun estado={r.estado} />
                    </Link>
                  </td>
                  <td>
                    <div className="forte">{r.modeloNome}</div>
                    <div className="mudo pequeno">
                      {r.papel} · {r.modo}
                    </div>
                  </td>
                  <td className="quebra">{r.projeto ?? <span className="mono pequeno">{r.cwd}</span>}</td>
                  <td className="nowrap">{dataHora(r.inicio)}</td>
                  <td className="nowrap">{r.estado === 'rodando' ? '…' : duracao(r.duracaoMs)}</td>
                  <td className="nowrap">{tokensCompacto(totalTokens(r.usage))}</td>
                  <td className="nowrap">
                    {dolar(r.custoUsd)}
                    {r.custoOrigem === 'estimado' && <span className="mudo" title="Estimado pela tabela de preços"> *</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
