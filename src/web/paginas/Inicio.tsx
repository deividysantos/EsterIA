import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { EtiquetaProblema, Progresso } from './Problemas';

export function Inicio() {
  useAoVivo();
  const saude = useQuery({ queryKey: ['saude'], queryFn: api.saude });
  const fila = useQuery({ queryKey: ['fila'], queryFn: api.fila, refetchInterval: 10_000 });
  const problemas = useQuery({ queryKey: ['problemas'], queryFn: () => api.problemas() });
  const atencao = (problemas.data ?? []).filter((p) => p.esperando || p.estado === 'bloqueado');
  const andamento = (problemas.data ?? []).filter((p) => p.estado === 'em_andamento');

  return (
    <section>
      <header className="cabecalho">
        <h1>Início</h1>
        <Link to="/problemas?novo=1" className="botao-link">
          Novo problema
        </Link>
      </header>

      <div className="grade-cartoes grade-kpi">
        <Link to="/fila" className="cartao cartao-link">
          <div className="cartao-rotulo">Esperando você</div>
          <div className="cartao-valor">{fila.data ? fila.data.aguardandoVoce.length + fila.data.bloqueados.length : '—'}</div>
          <div className="mudo pequeno">aprovações, perguntas e bloqueios</div>
        </Link>
        <Link to="/fila" className="cartao cartao-link">
          <div className="cartao-rotulo">Agentes rodando</div>
          <div className="cartao-valor">{fila.data?.rodando.length ?? '—'}</div>
          {fila.data && <div className="mudo pequeno">limite {fila.data.limites.global}</div>}
        </Link>
        <div className="cartao">
          <div className="cartao-rotulo">Problemas em andamento</div>
          <div className="cartao-valor">{problemas.data ? andamento.length : '—'}</div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Serviço</div>
          <div className="cartao-valor pequeno">{saude.data ? `v${saude.data.versao} · esquema ${saude.data.esquema}` : '—'}</div>
          <div className="mudo pequeno quebra" title={saude.data?.banco}>
            {saude.data?.banco ?? ''}
          </div>
        </div>
      </div>

      {atencao.length > 0 && (
        <div className="bloco">
          <h2>Precisa de você</h2>
          <ul className="lista-fila">
            {atencao.map((p) => (
              <li key={p.id} className="item-fila">
                <Link to={`/problemas/${p.id}`} className="link forte">
                  {p.projeto} #{p.numero} {p.titulo}
                </Link>{' '}
                <EtiquetaProblema estado={p.estado} />
                <div className="mudo pequeno quebra">{p.esperando ? `Esperando: ${p.esperando.etapaNome}` : p.motivo}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {andamento.length > 0 && (
        <div className="bloco">
          <h2>Em andamento</h2>
          <ul className="lista-fila">
            {andamento.map((p) => (
              <li key={p.id} className="item-fila">
                <Link to={`/problemas/${p.id}`} className="link forte">
                  {p.projeto} #{p.numero} {p.titulo}
                </Link>{' '}
                <Progresso p={p} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {saude.isError && <p className="erro">Não foi possível falar com o serviço: {(saude.error as Error).message}</p>}
    </section>
  );
}
