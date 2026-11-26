import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api';

export function Inicio() {
  const saude = useQuery({ queryKey: ['saude'], queryFn: api.saude });
  const projetos = useQuery({ queryKey: ['projetos', false], queryFn: () => api.projetos(false) });

  return (
    <section>
      <header className="cabecalho">
        <h1>Início</h1>
      </header>

      <div className="grade-cartoes">
        <div className="cartao">
          <div className="cartao-rotulo">Projetos ativos</div>
          <div className="cartao-valor">{projetos.data?.length ?? '—'}</div>
          <Link to="/projetos" className="link">
            Gerenciar projetos
          </Link>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Esquema do banco</div>
          <div className="cartao-valor">{saude.data ? `v${saude.data.esquema}` : '—'}</div>
          <div className="mudo quebra" title={saude.data?.banco}>
            {saude.data?.banco ?? ''}
          </div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">No ar desde</div>
          <div className="cartao-valor pequeno">
            {saude.data ? new Date(saude.data.iniciadoEm).toLocaleString('pt-BR') : '—'}
          </div>
        </div>
      </div>

      {saude.isError && (
        <p className="erro">Não foi possível falar com o serviço: {(saude.error as Error).message}</p>
      )}
    </section>
  );
}
