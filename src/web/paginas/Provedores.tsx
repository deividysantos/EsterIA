import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import type { EstadoProvedor, Provedor } from '../../shared/provedores';
import { api } from '../api';

const ROTULO_ESTADO: Record<EstadoProvedor, string> = {
  habilitado: 'Habilitado',
  desativado: 'Desativado',
  nao_encontrado: 'Não encontrado',
  erro: 'Com erro',
  nao_verificado: 'Não verificado',
};

const DICA: Record<string, string> = {
  claude: 'Ex.: C:\\Users\\voce\\.local\\bin\\claude.exe',
  cursor: 'Ex.: C:\\Users\\voce\\AppData\\Local\\cursor-agent\\cursor-agent.ps1',
  antigravity: 'Ex.: C:\\Users\\voce\\AppData\\Local\\agy\\bin\\agy.exe',
  codex: 'Ex.: C:\\Users\\voce\\AppData\\Roaming\\npm\\codex.cmd',
};

export function Etiqueta({ estado }: { estado: EstadoProvedor }) {
  return <span className={`etiqueta etiqueta-${estado}`}>{ROTULO_ESTADO[estado]}</span>;
}

function CartaoProvedor({ p }: { p: Provedor }) {
  const qc = useQueryClient();
  const [caminho, setCaminho] = useState(p.caminho ?? '');
  useEffect(() => setCaminho(p.caminho ?? ''), [p.caminho]);

  const atualizar = (novo: Provedor) => {
    qc.setQueryData<Provedor[]>(['provedores'], (lista) => lista?.map((x) => (x.id === novo.id ? novo : x)));
  };
  const salvar = useMutation({
    mutationFn: (dados: { caminho?: string | null; ativo?: boolean }) => api.editarProvedor(p.id, dados),
    onSuccess: atualizar,
  });
  const verificar = useMutation({ mutationFn: () => api.verificarProvedor(p.id), onSuccess: atualizar });
  const ocupado = salvar.isPending || verificar.isPending;
  const mudou = caminho.trim() !== (p.caminho ?? '');

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate({ caminho: caminho.trim() || null });
  }

  return (
    <article className="cartao provedor">
      <header className="provedor-topo">
        <div>
          <h2>{p.nome}</h2>
          <div className="mudo mono">{p.id}</div>
        </div>
        <Etiqueta estado={p.estado} />
      </header>

      <dl className="campos">
        <dt>Em uso</dt>
        <dd className="mono quebra">
          {p.caminhoEmUso ?? <span className="mudo">nenhum</span>}
          {p.caminhoEmUso && <span className="mudo"> ({p.caminho ? 'manual' : 'detectado'})</span>}
        </dd>
        <dt>Versão</dt>
        <dd>{p.versao ?? <span className="mudo">—</span>}</dd>
        {p.caminho && p.caminhoDetectado && p.caminhoDetectado !== p.caminho && (
          <>
            <dt>Detectado</dt>
            <dd className="mono quebra">{p.caminhoDetectado}</dd>
          </>
        )}
        <dt>Verificado</dt>
        <dd>{p.verificadoEm ? new Date(p.verificadoEm).toLocaleString('pt-BR') : <span className="mudo">nunca</span>}</dd>
      </dl>

      {p.erro && <p className="erro">{p.erro}</p>}

      <form className="linha-form" onSubmit={enviar}>
        <input
          value={caminho}
          onChange={(e) => setCaminho(e.target.value)}
          placeholder={p.caminhoDetectado ? `Detectado: ${p.caminhoDetectado}` : DICA[p.id]}
          aria-label={`Caminho manual do ${p.nome}`}
        />
        <button type="submit" disabled={ocupado || !mudou}>
          Salvar
        </button>
      </form>

      <footer className="provedor-acoes">
        <label className="alternador">
          <input
            type="checkbox"
            checked={p.ativo}
            disabled={ocupado}
            onChange={(e) => salvar.mutate({ ativo: e.target.checked })}
          />
          Ativo
        </label>
        <button className="secundario" onClick={() => verificar.mutate()} disabled={ocupado}>
          {verificar.isPending ? 'Verificando…' : 'Verificar'}
        </button>
      </footer>
      {(salvar.error || verificar.error) && (
        <p className="erro">{((salvar.error ?? verificar.error) as Error).message}</p>
      )}
    </article>
  );
}

export function Provedores() {
  const qc = useQueryClient();
  const provedores = useQuery({ queryKey: ['provedores'], queryFn: api.provedores });
  const todos = useMutation({
    mutationFn: api.verificarProvedores,
    onSuccess: (lista) => qc.setQueryData(['provedores'], lista),
  });

  const habilitados = provedores.data?.filter((p) => p.habilitado).length ?? 0;

  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Provedores</h1>
          <p className="mudo subtitulo">
            Um CLI só entra na estrutura de agentes quando o caminho é válido e o <code>--version</code> responde.
            {provedores.data && ` ${habilitados} de ${provedores.data.length} habilitados.`}
          </p>
        </div>
        <button onClick={() => todos.mutate()} disabled={todos.isPending}>
          {todos.isPending ? 'Detectando…' : 'Detectar todos'}
        </button>
      </header>
      {provedores.isError && <p className="erro">{(provedores.error as Error).message}</p>}
      {todos.isError && <p className="erro">{(todos.error as Error).message}</p>}
      <div className="grade-provedores">
        {provedores.data?.map((p) => <CartaoProvedor key={p.id} p={p} />)}
      </div>
    </section>
  );
}
