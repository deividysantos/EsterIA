import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { ID_PROVEDORES, type IdProvedor, type Modelo, type NovoModelo, type Provedor } from '../../shared/provedores';
import { api } from '../api';
import { Etiqueta } from './Provedores';

type Rascunho = {
  provedor: IdProvedor;
  codigo: string;
  nome: string;
  familia: string;
  notaCusto: string;
  notaVelocidade: string;
  notaQualidade: string;
  contextoTokens: string;
  tags: string;
  observacao: string;
  precoEntrada: string;
  precoSaida: string;
  precoCacheLeitura: string;
  precoCacheEscrita: string;
  ativo: boolean;
};

const FAMILIA_PADRAO: Record<IdProvedor, string> = {
  claude: 'claude',
  cursor: '',
  antigravity: 'gemini',
  codex: 'gpt',
};

const txt = (v: number | null) => (v === null ? '' : String(v));

function rascunhoDe(m: Modelo | null, provedor: IdProvedor = 'claude'): Rascunho {
  return {
    provedor: m?.provedor ?? provedor,
    codigo: m?.codigo ?? '',
    nome: m?.nome ?? '',
    familia: m?.familia ?? FAMILIA_PADRAO[provedor],
    notaCusto: txt(m?.notaCusto ?? null),
    notaVelocidade: txt(m?.notaVelocidade ?? null),
    notaQualidade: txt(m?.notaQualidade ?? null),
    contextoTokens: txt(m?.contextoTokens ?? null),
    tags: m?.tags.join(', ') ?? '',
    observacao: m?.observacao ?? '',
    precoEntrada: txt(m?.precoEntrada ?? null),
    precoSaida: txt(m?.precoSaida ?? null),
    precoCacheLeitura: txt(m?.precoCacheLeitura ?? null),
    precoCacheEscrita: txt(m?.precoCacheEscrita ?? null),
    ativo: m?.ativo ?? true,
  };
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

function paraEnvio(r: Rascunho): NovoModelo {
  return {
    provedor: r.provedor,
    codigo: r.codigo,
    nome: r.nome,
    familia: r.familia,
    notaCusto: num(r.notaCusto),
    notaVelocidade: num(r.notaVelocidade),
    notaQualidade: num(r.notaQualidade),
    contextoTokens: num(r.contextoTokens),
    tags: r.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    observacao: r.observacao,
    precoEntrada: num(r.precoEntrada),
    precoSaida: num(r.precoSaida),
    precoCacheLeitura: num(r.precoCacheLeitura),
    precoCacheEscrita: num(r.precoCacheEscrita),
    ativo: r.ativo,
  };
}

function SeletorNota({ rotulo, valor, onChange, dica }: { rotulo: string; valor: string; onChange: (v: string) => void; dica: string }) {
  return (
    <label title={dica}>
      {rotulo}
      <select value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormModelo({ modelo, provedores, aoFechar }: { modelo: Modelo | null; provedores: Provedor[]; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(modelo));
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }));

  const salvar = useMutation({
    mutationFn: () => (modelo ? api.editarModelo(modelo.id, paraEnvio(r)) : api.criarModelo(paraEnvio(r))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modelos'] });
      aoFechar();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    salvar.mutate();
  }

  return (
    <form className="formulario formulario-modelo" onSubmit={enviar}>
      <h2 className="largo">{modelo ? `Editar ${modelo.nome}` : 'Novo modelo'}</h2>
      <label>
        Provedor
        <select
          value={r.provedor}
          onChange={(e) => {
            const p = e.target.value as IdProvedor;
            setR((x) => ({ ...x, provedor: p, familia: x.familia || FAMILIA_PADRAO[p] }));
          }}
        >
          {ID_PROVEDORES.map((id) => (
            <option key={id} value={id}>
              {provedores.find((p) => p.id === id)?.nome ?? id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Família
        <input value={r.familia} onChange={(e) => set('familia', e.target.value)} placeholder="claude, gpt, gemini, grok…" required />
      </label>
      <label>
        Código (valor do --model)
        <input value={r.codigo} onChange={(e) => set('codigo', e.target.value)} className="mono" required />
      </label>
      <label>
        Nome
        <input value={r.nome} onChange={(e) => set('nome', e.target.value)} required />
      </label>

      <fieldset className="largo grupo">
        <legend>Atributos declarados (1 a 5)</legend>
        <SeletorNota rotulo="Custo" valor={r.notaCusto} onChange={(v) => set('notaCusto', v)} dica="5 = mais barato" />
        <SeletorNota rotulo="Velocidade" valor={r.notaVelocidade} onChange={(v) => set('notaVelocidade', v)} dica="5 = mais rápido" />
        <SeletorNota rotulo="Qualidade" valor={r.notaQualidade} onChange={(v) => set('notaQualidade', v)} dica="5 = melhor" />
        <label>
          Contexto (tokens)
          <input value={r.contextoTokens} onChange={(e) => set('contextoTokens', e.target.value)} inputMode="numeric" />
        </label>
      </fieldset>

      <fieldset className="largo grupo">
        <legend>Preço (USD por milhão de tokens)</legend>
        <label>
          Entrada
          <input value={r.precoEntrada} onChange={(e) => set('precoEntrada', e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Saída
          <input value={r.precoSaida} onChange={(e) => set('precoSaida', e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Cache leitura
          <input value={r.precoCacheLeitura} onChange={(e) => set('precoCacheLeitura', e.target.value)} inputMode="decimal" />
        </label>
        <label>
          Cache escrita
          <input value={r.precoCacheEscrita} onChange={(e) => set('precoCacheEscrita', e.target.value)} inputMode="decimal" />
        </label>
      </fieldset>

      <label className="largo">
        Tags (separadas por vírgula)
        <input value={r.tags} onChange={(e) => set('tags', e.target.value)} placeholder="execucao, revisao, regra-de-negocio" />
      </label>
      <label className="largo">
        Observação
        <textarea value={r.observacao} onChange={(e) => set('observacao', e.target.value)} rows={2} />
      </label>
      <label className="alternador">
        <input type="checkbox" checked={r.ativo} onChange={(e) => set('ativo', e.target.checked)} />
        Ativo
      </label>
      <div className="acoes">
        <button type="button" className="secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
      {salvar.isError && <p className="erro largo">{(salvar.error as Error).message}</p>}
    </form>
  );
}

function Nota({ v }: { v: number | null }) {
  return v === null ? <span className="mudo">—</span> : <span>{v}</span>;
}

function preco(v: number | null) {
  return v === null ? '—' : `$${v}`;
}

export function Modelos() {
  const qc = useQueryClient();
  const modelos = useQuery({ queryKey: ['modelos'], queryFn: api.modelos });
  const provedores = useQuery({ queryKey: ['provedores'], queryFn: api.provedores });
  const [editando, setEditando] = useState<Modelo | 'novo' | null>(null);
  const excluir = useMutation({
    mutationFn: api.excluirModelo,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos'] }),
  });

  const listaProv = provedores.data ?? [];
  const grupos = ID_PROVEDORES.map((id) => ({
    provedor: listaProv.find((p) => p.id === id),
    id,
    itens: (modelos.data ?? []).filter((m) => m.provedor === id),
  }));

  return (
    <section>
      <header className="cabecalho">
        <div>
          <h1>Modelos</h1>
          <p className="mudo subtitulo">
            Catálogo usado pelo orquestrador para escolher quem executa e quem revisa. A família define a revisão cruzada.
          </p>
        </div>
        <button onClick={() => setEditando(editando ? null : 'novo')}>{editando ? 'Fechar' : 'Novo modelo'}</button>
      </header>

      {editando && (
        <FormModelo
          key={editando === 'novo' ? 'novo' : editando.id}
          modelo={editando === 'novo' ? null : editando}
          provedores={listaProv}
          aoFechar={() => setEditando(null)}
        />
      )}

      {modelos.isError && <p className="erro">{(modelos.error as Error).message}</p>}
      {excluir.isError && <p className="erro">{(excluir.error as Error).message}</p>}

      {grupos.map((g) => (
        <div key={g.id} className="grupo-modelos">
          <h2 className="titulo-grupo">
            {g.provedor?.nome ?? g.id}
            {g.provedor && <Etiqueta estado={g.provedor.estado} />}
          </h2>
          {g.itens.length === 0 ? (
            <p className="mudo">Nenhum modelo cadastrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-modelos">
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th>Família</th>
                    <th title="5 = mais barato">Custo</th>
                    <th title="5 = mais rápido">Veloc.</th>
                    <th title="5 = melhor">Qualid.</th>
                    <th>Preço entrada / saída</th>
                    <th>Tags</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.itens.map((m) => (
                    <tr key={m.id} className={m.ativo ? undefined : 'arquivado'}>
                      <td>
                        <div className="forte">{m.nome}</div>
                        <div className="mudo mono">{m.codigo}</div>
                        {m.observacao && <div className="mudo pequeno">{m.observacao}</div>}
                      </td>
                      <td>{m.familia}</td>
                      <td>
                        <Nota v={m.notaCusto} />
                      </td>
                      <td>
                        <Nota v={m.notaVelocidade} />
                      </td>
                      <td>
                        <Nota v={m.notaQualidade} />
                      </td>
                      <td className="mono">
                        {preco(m.precoEntrada)} / {preco(m.precoSaida)}
                      </td>
                      <td>
                        <div className="tags">
                          {m.tags.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="direita nowrap">
                        <button className="secundario" onClick={() => setEditando(m)}>
                          Editar
                        </button>{' '}
                        <button
                          className="secundario perigo"
                          disabled={excluir.isPending}
                          onClick={() => {
                            if (confirm(`Excluir o modelo ${m.nome}?`)) excluir.mutate(m.id);
                          }}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
