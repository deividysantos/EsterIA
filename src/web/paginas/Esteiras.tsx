import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { api, ErroRequisicao } from '../api';
import { EditorCriterios } from '../componentes/esteira/EditorCriterios';
import { EditorEsteira } from '../componentes/esteira/EditorEsteira';

function CriarEsteira({ projeto }: { projeto: string }) {
  const qc = useQueryClient();
  const projetos = useQuery({ queryKey: ['projetos', false], queryFn: () => api.projetos(false) });
  const [copiarDe, setCopiarDe] = useState('');
  const criar = useMutation({
    mutationFn: (origem: 'padrao' | { copiarDe: string }) => api.criarEsteira(projeto, origem),
    onSuccess: (e) => qc.setQueryData(['esteira', projeto], e),
  });
  const outros = projetos.data?.filter((p) => p.id !== projeto) ?? [];

  return (
    <div className="vazio criar-esteira">
      <p>Este projeto ainda não tem esteira.</p>
      <div className="linha-opcoes">
        <button onClick={() => criar.mutate('padrao')} disabled={criar.isPending}>
          Criar a partir do modelo padrão
        </button>
        {outros.length > 0 && (
          <>
            <span className="mudo">ou copiar de</span>
            <select value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)} aria-label="Projeto de origem">
              <option value="">Escolha um projeto…</option>
              {outros.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <button className="secundario" disabled={!copiarDe || criar.isPending} onClick={() => criar.mutate({ copiarDe })}>
              Copiar
            </button>
          </>
        )}
      </div>
      <p className="mudo pequeno">
        O modelo padrão segue o fluxo atual: planejar → (crítica do plano) → aprovação → para cada tarefa: executar → (testes) →
        revisão cruzada → commit. Tudo editável depois.
      </p>
      {criar.isError && <p className="erro">{(criar.error as Error).message}</p>}
    </div>
  );
}

export function Esteiras() {
  const { projeto } = useParams();
  const navegar = useNavigate();
  const projetos = useQuery({ queryKey: ['projetos', false], queryFn: () => api.projetos(false) });
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: api.modelos });
  const provedores = useQuery({ queryKey: ['provedores'], queryFn: api.provedores });
  const esteira = useQuery({
    queryKey: ['esteira', projeto],
    queryFn: () => api.esteira(projeto!),
    enabled: !!projeto,
    retry: (n, err) => !(err instanceof ErroRequisicao && err.status === 404) && n < 1,
  });
  const semEsteira = esteira.error instanceof ErroRequisicao && esteira.error.status === 404;
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') === 'criterios' ? 'criterios' : 'etapas';
  const criterios = useQuery({ queryKey: ['criterios', projeto], queryFn: () => api.criterios(projeto!), enabled: !!projeto && aba === 'criterios' });

  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Esteiras</h1>
          <p className="mudo subtitulo">
            As etapas que cada problema percorre neste projeto. Salvar cria uma versão nova; problemas em andamento seguem na versão
            com que começaram.
          </p>
        </div>
        <select value={projeto ?? ''} onChange={(e) => navegar(e.target.value ? `/esteiras/${e.target.value}` : '/esteiras')} aria-label="Projeto">
          <option value="">Escolha um projeto…</option>
          {projetos.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </header>

      {projetos.data?.length === 0 && (
        <p className="vazio">
          Nenhum projeto cadastrado. <Link to="/projetos" className="link">Cadastre um projeto</Link> para configurar a esteira dele.
        </p>
      )}
      {!projeto && !!projetos.data?.length && <p className="vazio">Escolha um projeto para ver ou editar a esteira dele.</p>}

      {projeto && (
        <div className="abas" role="tablist">
          <button role="tab" aria-selected={aba === 'etapas'} className={aba === 'etapas' ? 'aba ativa' : 'aba'} onClick={() => setParams({})}>
            Etapas
          </button>
          <button
            role="tab"
            aria-selected={aba === 'criterios'}
            className={aba === 'criterios' ? 'aba ativa' : 'aba'}
            onClick={() => setParams({ aba: 'criterios' })}
          >
            Critérios de escolha do modelo
          </button>
        </div>
      )}

      {projeto && aba === 'criterios' && criterios.data && modelos.data && (
        <EditorCriterios key={`${projeto}-${criterios.data.atualizadoEm}`} projeto={projeto} salvo={criterios.data} modelos={modelos.data} />
      )}
      {projeto && aba === 'criterios' && criterios.isError && <p className="erro">{(criterios.error as Error).message}</p>}

      {projeto && aba === 'etapas' && esteira.isLoading && <p className="mudo">Carregando…</p>}
      {projeto && aba === 'etapas' && semEsteira && <CriarEsteira projeto={projeto} />}
      {projeto && aba === 'etapas' && esteira.isError && !semEsteira && <p className="erro">{(esteira.error as Error).message}</p>}
      {projeto && aba === 'etapas' && esteira.data && modelos.data && provedores.data && (
        <EditorEsteira
          key={`${projeto}-${esteira.data.versaoAtual}`}
          projeto={projeto}
          esteira={esteira.data}
          modelos={modelos.data}
          provedores={provedores.data}
        />
      )}
    </section>
  );
}
