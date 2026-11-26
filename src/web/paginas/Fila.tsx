import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import type { ItemFila } from '../../shared/problemas';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { duracao } from '../formatar';

function Item({ i }: { i: ItemFila }) {
  const e = i.execucao;
  return (
    <li className="item-fila">
      <Link to={`/problemas/${e.problema}`} className="link forte">
        {i.projeto} #{i.problemaNumero} {i.problemaTitulo}
      </Link>
      <div className="mudo pequeno">
        {e.etapaNome}
        {e.tarefaCodigo ? ` · ${e.tarefaCodigo}` : ''} · tentativa {e.tentativa}
        {e.modeloNome ? ` · ${e.modeloNome}` : ''} · há {duracao(Date.now() - new Date(e.inicio).getTime())}
      </div>
    </li>
  );
}

function Limites() {
  const qc = useQueryClient();
  const fila = useQuery({ queryKey: ['fila'], queryFn: api.fila });
  const [global, setGlobal] = useState('');
  const [porProvedor, setPorProvedor] = useState('');
  const [cota, setCota] = useState('');
  useEffect(() => {
    if (fila.data) {
      setGlobal(String(fila.data.limites.global));
      setPorProvedor(String(fila.data.limites.porProvedor));
      setCota(fila.data.limites.cotaMaxima === null ? '' : String(fila.data.limites.cotaMaxima));
    }
  }, [fila.data?.limites.global, fila.data?.limites.porProvedor, fila.data?.limites.cotaMaxima]); // eslint-disable-line react-hooks/exhaustive-deps
  const salvar = useMutation({
    mutationFn: () =>
      api.definirLimites({ global: Number(global), porProvedor: Number(porProvedor), cotaMaxima: cota.trim() ? Number(cota) : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fila'] }),
  });
  return (
    <div className="bloco">
      <h2>Limites de execução simultânea</h2>
      <p className="mudo pequeno">
        Etapas de escrita (executor, comandos, commit) do mesmo projeto nunca rodam ao mesmo tempo. Tarefas de um mesmo
        problema rodam uma por vez.
      </p>
      <div className="linha-opcoes">
        <label>
          No total
          <input type="number" min={1} max={20} value={global} onChange={(e) => setGlobal(e.target.value)} />
        </label>
        <label>
          Por provedor
          <input type="number" min={1} max={20} value={porProvedor} onChange={(e) => setPorProvedor(e.target.value)} />
        </label>
        <label>
          Parar provedor com cota acima de (%)
          <input type="number" min={1} max={100} value={cota} placeholder="desligado" onChange={(e) => setCota(e.target.value)} />
        </label>
        <button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          Salvar
        </button>
      </div>
      {salvar.isError && <p className="erro">{(salvar.error as Error).message}</p>}
    </div>
  );
}

export function Fila() {
  useAoVivo();
  const fila = useQuery({ queryKey: ['fila'], queryFn: api.fila, refetchInterval: 5000 });
  const f = fila.data;
  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Fila</h1>
          <p className="mudo subtitulo">O que está rodando, o que espera você e o que travou, em todos os projetos.</p>
        </div>
      </header>
      {fila.isError && <p className="erro">{(fila.error as Error).message}</p>}

      <div className="grade-cartoes grade-kpi">
        <div className="cartao">
          <div className="cartao-rotulo">Rodando</div>
          <div className="cartao-valor">{f?.rodando.length ?? '—'}</div>
          {f && <div className="mudo pequeno">limite {f.limites.global}</div>}
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Esperando você</div>
          <div className="cartao-valor">{f?.aguardandoVoce.length ?? '—'}</div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Bloqueados</div>
          <div className="cartao-valor">{f?.bloqueados.length ?? '—'}</div>
        </div>
        <div className="cartao">
          <div className="cartao-rotulo">Na fila (sem vaga)</div>
          <div className="cartao-valor">{f?.naFila ?? '—'}</div>
        </div>
      </div>

      <div className="bloco">
        <h2>Esperando você</h2>
        {f && !f.aguardandoVoce.length ? <p className="mudo">Nada.</p> : <ul className="lista-fila">{f?.aguardandoVoce.map((i) => <Item key={i.execucao.id} i={i} />)}</ul>}
      </div>
      <div className="bloco">
        <h2>Bloqueados</h2>
        {f && !f.bloqueados.length ? (
          <p className="mudo">Nada.</p>
        ) : (
          <ul className="lista-fila">
            {f?.bloqueados.map((p) => (
              <li key={p.id} className="item-fila">
                <Link to={`/problemas/${p.id}`} className="link forte">
                  {p.projeto} #{p.numero} {p.titulo}
                </Link>
                <div className="erro pequeno quebra">{p.motivo}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {f && f.cotas.length > 0 && (
        <div className="bloco">
          <h2>Provedores parados por cota</h2>
          <ul className="lista-fila">
            {f.cotas.map((c) => (
              <li key={`${c.provedor}-${c.janela}`} className="item-fila">
                <span className="forte">{c.provedor}</span> · janela {c.janela} em {Math.round(c.utilizacao * 100)}%
                <div className="mudo pequeno">
                  {c.reiniciaEm
                    ? `Volta a receber etapas quando a cota reiniciar (${new Date(c.reiniciaEm).toLocaleString('pt-BR')}).`
                    : 'Sem horário de reinício informado.'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="bloco">
        <h2>Rodando</h2>
        {f && !f.rodando.length ? <p className="mudo">Nada rodando.</p> : <ul className="lista-fila">{f?.rodando.map((i) => <Item key={i.execucao.id} i={i} />)}</ul>}
      </div>
      <Limites />
    </section>
  );
}
