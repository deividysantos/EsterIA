import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';

import { api } from '../api';

const ITENS = [
  { para: '/', rotulo: 'Início', fim: true },
  { para: '/projetos', rotulo: 'Projetos' },
  { para: '/provedores', rotulo: 'Provedores' },
  { para: '/modelos', rotulo: 'Modelos' },
  { para: '/runs', rotulo: 'Runs' },
  { para: '/esteiras', rotulo: 'Esteiras' },
  { para: '/usage', rotulo: 'Usage' },
];

export function Layout() {
  const saude = useQuery({ queryKey: ['saude'], queryFn: api.saude, refetchInterval: 15_000 });

  return (
    <div className="casca">
      <aside className="lateral">
        <div className="marca">
          <span className="marca-ponto" aria-hidden />
          Painel de agentes
        </div>
        <nav>
          {ITENS.map((i) => (
            <NavLink key={i.para} to={i.para} end={i.fim} className="nav-item">
              {i.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="lateral-rodape">
          {saude.isSuccess ? (
            <span className="status status-ok">Serviço no ar · v{saude.data.versao}</span>
          ) : saude.isError ? (
            <span className="status status-erro">Serviço fora do ar</span>
          ) : (
            <span className="status">Conectando…</span>
          )}
        </div>
      </aside>
      <main className="conteudo">
        <Outlet />
      </main>
    </div>
  );
}
