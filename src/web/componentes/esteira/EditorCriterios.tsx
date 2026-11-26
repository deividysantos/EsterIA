import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { META_METRICAS, METRICAS, type Criterios, type CriteriosProjeto } from '../../../shared/criterios';
import { ID_PROVEDORES, type Modelo } from '../../../shared/provedores';
import { api } from '../../api';
import { TabelaCandidatos } from '../TabelaCandidatos';

function useAtrasado<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function EditorCriterios({ projeto, salvo, modelos }: { projeto: string; salvo: CriteriosProjeto; modelos: Modelo[] }) {
  const qc = useQueryClient();
  const [c, setC] = useState<Criterios>(() => structuredClone(salvo.criterios));
  const set = <K extends keyof Criterios>(k: K, v: Criterios[K]) => setC((x) => ({ ...x, [k]: v }));
  const sujo = JSON.stringify(c) !== JSON.stringify(salvo.criterios);

  const atrasado = useAtrasado(c, 300);
  const chave = useMemo(() => JSON.stringify(atrasado), [atrasado]);
  const previa = useQuery({
    queryKey: ['previa-criterios', projeto, chave],
    queryFn: () => api.previaCriterios(projeto, atrasado),
    placeholderData: (anterior) => anterior,
  });

  const salvar = useMutation({
    mutationFn: () => api.salvarCriterios(projeto, c),
    onSuccess: (r) => qc.setQueryData(['criterios', projeto], r),
  });

  const alternarExcluido = (id: number) =>
    set('excluidos', c.excluidos.includes(id) ? c.excluidos.filter((x) => x !== id) : [...c.excluidos, id]);

  return (
    <div className="editor-criterios">
      <div className="barra-esteira">
        <div className="barra-versao">
          <span className="mudo pequeno">
            {salvo.padrao ? 'Usando os critérios padrão (ainda não salvos para este projeto).' : 'Critérios salvos para este projeto.'}
          </span>
          {sujo && <span className="selo selo-sujo">mudanças não salvas</span>}
        </div>
        <div className="barra-acoes">
          <button className="secundario" disabled={!sujo || salvar.isPending} onClick={() => setC(structuredClone(salvo.criterios))}>
            Descartar
          </button>
          <button disabled={!sujo || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? 'Salvando…' : 'Salvar critérios'}
          </button>
        </div>
      </div>
      {salvar.isError && <p className="erro caixa-erro">{(salvar.error as Error).message}</p>}

      <div className="esteira-colunas colunas-criterios">
        <div className="esteira-detalhe">
          <div className="formulario formulario-plano">
            <fieldset className="largo grupo grupo-coluna">
              <legend>Quem decide</legend>
              <label className="alternador">
                <input type="radio" checked={c.modo === 'orquestrador'} onChange={() => set('modo', 'orquestrador')} />
                O orquestrador escolhe; a pontuação orienta e decide quando ele não escolhe
              </label>
              <label className="alternador">
                <input type="radio" checked={c.modo === 'pontuacao'} onChange={() => set('modo', 'pontuacao')} />
                Sempre o candidato de maior pontuação
              </label>
            </fieldset>

            <fieldset className="largo grupo grupo-coluna">
              <legend>Métricas e pesos (0 = não conta)</legend>
              {METRICAS.map((id) => {
                const meta = META_METRICAS[id];
                return (
                  <div key={id} className="linha-peso">
                    <div>
                      <div className="forte">
                        {meta.rotulo} <span className="selo">{meta.origem === 'declarada' ? 'cadastrada' : 'medida'}</span>
                      </div>
                      <div className="mudo pequeno">{meta.descricao}</div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={c.pesos[id]}
                      aria-label={`Peso de ${meta.rotulo}`}
                      onChange={(e) => set('pesos', { ...c.pesos, [id]: Number(e.target.value) })}
                    />
                    <span className="peso-valor">{c.pesos[id]}</span>
                  </div>
                );
              })}
              <div className="linha-opcoes">
                <label>
                  Histórico das métricas medidas
                  <select value={c.historico} onChange={(e) => set('historico', e.target.value as Criterios['historico'])}>
                    <option value="todos">Todos os projetos</option>
                    <option value="projeto">Só este projeto</option>
                  </select>
                </label>
                <label>
                  Mínimo de amostras
                  <input type="number" min={1} max={100} value={c.amostrasMinimas} onChange={(e) => set('amostrasMinimas', Number(e.target.value) || 1)} />
                </label>
              </div>
            </fieldset>

            <fieldset className="largo grupo grupo-coluna">
              <legend>Regras rígidas (quem não cumpre nunca é escolhido)</legend>
              <label>
                Qualidade mínima
                <select
                  value={c.qualidadeMinima ?? ''}
                  onChange={(e) => set('qualidadeMinima', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sem mínimo</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} (modelos sem nota ficam de fora)
                    </option>
                  ))}
                </select>
              </label>
              <div className="mudo pequeno">Modelos proibidos neste projeto</div>
              <div className="candidatos">
                {ID_PROVEDORES.map((pid) => {
                  const itens = modelos.filter((m) => m.provedor === pid);
                  if (!itens.length) return null;
                  return (
                    <div key={pid} className="candidatos-grupo">
                      {itens.map((m) => (
                        <label key={m.id} className="alternador pequeno">
                          <input type="checkbox" checked={c.excluidos.includes(m.id)} onChange={() => alternarExcluido(m.id)} />
                          {m.nome}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <label className="largo">
              Orientações para o orquestrador (vão no prompt de planejamento)
              <textarea
                value={c.instrucoes}
                rows={4}
                onChange={(e) => set('instrucoes', e.target.value)}
                placeholder="Ex.: tarefas com regra de negócio vão para o Hydrogen; mecânicas, para o Grok."
              />
            </label>
          </div>
        </div>

        <div className="esteira-detalhe">
          <h2>Prévia da escolha {previa.isFetching && <span className="mudo pequeno">· atualizando…</span>}</h2>
          <p className="mudo pequeno">
            Como os candidatos de cada papel ficam com estes critérios agora (antes da revisão cruzada, que depende de quem
            executou).
          </p>
          {previa.isError && <p className="erro">{(previa.error as Error).message}</p>}
          {previa.data?.length === 0 && <p className="mudo">A esteira deste projeto não tem etapas em que o orquestrador escolhe.</p>}
          {previa.data?.map((p) => (
            <div key={p.etapaId} className="previa-papel">
              <h3>
                {p.etapaNome} <span className="mudo pequeno">· papel “{p.papel}”{p.regraCruzada ? ` · ${p.regraCruzada}` : ''}</span>
              </h3>
              <TabelaCandidatos candidatos={p.candidatos} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
