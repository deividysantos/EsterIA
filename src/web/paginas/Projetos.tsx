import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import type { Projeto } from '../../shared/projetos';
import { api } from '../api';

function sugerirId(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function FormNovoProjeto({ aoCriar }: { aoCriar: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState('');
  const [id, setId] = useState('');
  const [idEditado, setIdEditado] = useState(false);
  const [raiz, setRaiz] = useState('');

  const criar = useMutation({
    mutationFn: api.criarProjeto,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projetos'] });
      setNome('');
      setId('');
      setIdEditado(false);
      setRaiz('');
      aoCriar();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    criar.mutate({ nome, id, raiz });
  }

  return (
    <form className="formulario" onSubmit={enviar}>
      <label>
        Nome
        <input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            if (!idEditado) setId(sugerirId(e.target.value));
          }}
          placeholder="MeuProjeto"
          required
        />
      </label>
      <label>
        Id
        <input
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setIdEditado(true);
          }}
          placeholder="smartcore"
          pattern="[a-z0-9][a-z0-9\-]{0,39}"
          title="minúsculas, dígitos e hífen"
          required
        />
      </label>
      <label className="largo">
        Pasta raiz
        <input
          value={raiz}
          onChange={(e) => setRaiz(e.target.value)}
          placeholder="C:\Projetos\MeuProjeto"
          required
        />
      </label>
      <div className="acoes">
        <button type="submit" disabled={criar.isPending}>
          {criar.isPending ? 'Criando…' : 'Criar projeto'}
        </button>
      </div>
      {criar.isError && <p className="erro largo">{(criar.error as Error).message}</p>}
    </form>
  );
}

function LinhaProjeto({ p }: { p: Projeto }) {
  const qc = useQueryClient();
  const arquivar = useMutation({
    mutationFn: () => api.editarProjeto(p.id, { arquivado: !p.arquivadoEm }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projetos'] }),
  });

  return (
    <tr className={p.arquivadoEm ? 'arquivado' : undefined}>
      <td>
        <div className="forte">{p.nome}</div>
        <div className="mudo mono">{p.id}</div>
      </td>
      <td className="mono quebra">{p.raiz}</td>
      <td className="mudo">{new Date(p.criadoEm).toLocaleDateString('pt-BR')}</td>
      <td className="direita">
        <button className="secundario" onClick={() => arquivar.mutate()} disabled={arquivar.isPending}>
          {p.arquivadoEm ? 'Reativar' : 'Arquivar'}
        </button>
      </td>
    </tr>
  );
}

export function Projetos() {
  const [verArquivados, setVerArquivados] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const projetos = useQuery({
    queryKey: ['projetos', verArquivados],
    queryFn: () => api.projetos(verArquivados),
  });

  return (
    <section>
      <header className="cabecalho">
        <h1>Projetos</h1>
        <div className="cabecalho-acoes">
          <label className="alternador">
            <input type="checkbox" checked={verArquivados} onChange={(e) => setVerArquivados(e.target.checked)} />
            Mostrar arquivados
          </label>
          <button onClick={() => setMostrarForm((v) => !v)}>{mostrarForm ? 'Fechar' : 'Novo projeto'}</button>
        </div>
      </header>

      {mostrarForm && <FormNovoProjeto aoCriar={() => setMostrarForm(false)} />}

      {projetos.isLoading && <p className="mudo">Carregando…</p>}
      {projetos.isError && <p className="erro">{(projetos.error as Error).message}</p>}
      {projetos.data && projetos.data.length === 0 && (
        <p className="vazio">Nenhum projeto ainda. Cadastre o primeiro em “Novo projeto”.</p>
      )}
      {projetos.data && projetos.data.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Pasta raiz</th>
                <th>Criado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projetos.data.map((p) => (
                <LinhaProjeto key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
