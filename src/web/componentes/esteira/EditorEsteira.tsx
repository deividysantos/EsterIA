import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useBlocker } from 'react-router';

import {
  etapaNova,
  META_TIPOS,
  TIPOS_ETAPA,
  validarEsteira,
  type Definicao,
  type Escopo,
  type EsteiraProjeto,
  type Etapa,
  type ModeloRef,
  type TipoEtapa,
} from '../../../shared/esteiras';
import type { Modelo, Provedor } from '../../../shared/provedores';
import { api } from '../../api';
import { dataHora } from '../../formatar';
import { EditorEtapa } from './EditorEtapa';

interface Props {
  projeto: string;
  esteira: EsteiraProjeto;
  modelos: Modelo[];
  provedores: Provedor[];
}

function resumoAgente(e: Etapa, modelos: Modelo[]): string {
  if (!e.agente) return META_TIPOS[e.tipo].rotulo;
  if (e.agente.modo === 'fixo') {
    const id = e.agente.modeloId;
    return modelos.find((m) => m.id === id)?.nome ?? `modelo ${id}`;
  }
  const n = e.agente.candidatos.length;
  return `orquestrador escolhe o ${e.agente.papel}${n ? ` entre ${n}` : ''}`;
}

/** Agrupa a lista em trechos contíguos: o bloco de tarefa vira uma caixa “para cada tarefa”. */
function trechos(etapas: Etapa[]): { escopo: Escopo; itens: { etapa: Etapa; indice: number }[] }[] {
  const saida: { escopo: Escopo; itens: { etapa: Etapa; indice: number }[] }[] = [];
  etapas.forEach((etapa, indice) => {
    const ultimo = saida.at(-1);
    if (ultimo && ultimo.escopo === etapa.escopo) ultimo.itens.push({ etapa, indice });
    else saida.push({ escopo: etapa.escopo, itens: [{ etapa, indice }] });
  });
  return saida;
}

export function EditorEsteira({ projeto, esteira, modelos, provedores }: Props) {
  const qc = useQueryClient();
  const [rascunho, setRascunho] = useState<Definicao>(() => structuredClone(esteira.definicao));
  const [base, setBase] = useState(esteira.versaoAtual);
  const [selecionada, setSelecionada] = useState<string | null>(esteira.definicao.etapas[0]?.id ?? null);
  const [nota, setNota] = useState('');
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);
  const [novoTipo, setNovoTipo] = useState<TipoEtapa>('prompt_livre');
  const [carregada, setCarregada] = useState<number | null>(null);
  const [todosAvisos, setTodosAvisos] = useState(false);

  const original = useMemo(() => JSON.stringify(esteira.definicao), [esteira.definicao]);
  const sujo = JSON.stringify(rascunho) !== original;

  // Bloqueia sair da página com mudança não salva.
  const bloqueio = useBlocker(({ currentLocation, nextLocation }) => sujo && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (bloqueio.state !== 'blocked') return;
    if (confirm('Há mudanças não salvas na esteira. Sair e descartar?')) bloqueio.proceed();
    else bloqueio.reset();
  }, [bloqueio]);
  useEffect(() => {
    if (!sujo) return;
    const f = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [sujo]);

  const refs: ModeloRef[] = useMemo(() => {
    const hab = new Set(provedores.filter((p) => p.habilitado).map((p) => p.id));
    return modelos.map((m) => ({ id: m.id, nome: m.nome, familia: m.familia, ativo: m.ativo, disponivel: hab.has(m.provedor) }));
  }, [modelos, provedores]);
  const validacao = useMemo(() => validarEsteira(rascunho, refs), [rascunho, refs]);
  const errosPorEtapa = new Map<string, number>();
  validacao.erros.forEach((p) => p.etapa && errosPorEtapa.set(p.etapa, (errosPorEtapa.get(p.etapa) ?? 0) + 1));

  const salvar = useMutation({
    mutationFn: () => api.salvarEsteira(projeto, { definicao: rascunho, nota, versaoBase: base }),
    onSuccess: (e) => {
      qc.setQueryData(['esteira', projeto], e);
      setRascunho(structuredClone(e.definicao));
      setBase(e.versaoAtual);
      setNota('');
      setCarregada(null);
    },
  });

  const etapaSel = rascunho.etapas.find((e) => e.id === selecionada) ?? null;

  function mudarEtapa(nova: Etapa) {
    setRascunho((d) => ({ etapas: d.etapas.map((e) => (e.id === nova.id ? nova : e)) }));
  }

  function renomear(antigo: string, novo: string) {
    if (!novo) return;
    setRascunho((d) => ({
      etapas: d.etapas.map((e) => ({
        ...(e.id === antigo ? { ...e, id: novo } : e),
        falha: e.falha.voltarPara === antigo ? { ...e.falha, voltarPara: novo } : e.falha,
        agente:
          e.agente?.modo === 'orquestrador' && e.agente.familiaDiferenteDe === antigo
            ? { ...e.agente, familiaDiferenteDe: novo }
            : e.agente,
      })),
    }));
    setSelecionada(novo);
  }

  function remover(id: string) {
    const e = rascunho.etapas.find((x) => x.id === id);
    if (!e || !confirm(`Remover a etapa ${e.nome}?`)) return;
    setRascunho((d) => ({ etapas: d.etapas.filter((x) => x.id !== id) }));
    setSelecionada(null);
  }

  function mover(de: number, para: number) {
    if (de === para || para < 0 || para >= rascunho.etapas.length) return;
    setRascunho((d) => {
      const etapas = [...d.etapas];
      const [item] = etapas.splice(de, 1);
      etapas.splice(para, 0, item!);
      return { etapas };
    });
  }

  function adicionar() {
    const usados = new Set(rascunho.etapas.map((e) => e.id));
    const escopoPadrao = META_TIPOS[novoTipo].escopos[0]!;
    const nova = etapaNova(novoTipo, usados, escopoPadrao);
    setRascunho((d) => {
      const etapas = [...d.etapas];
      // Etapa por tarefa entra no fim do bloco de tarefas; do problema, no fim da esteira.
      const ultimaTarefa = etapas.map((e) => e.escopo).lastIndexOf('tarefa');
      if (nova.escopo === 'tarefa' && ultimaTarefa >= 0) etapas.splice(ultimaTarefa + 1, 0, nova);
      else etapas.push(nova);
      return { etapas };
    });
    setSelecionada(nova.id);
  }

  async function carregarVersao(n: number) {
    if (sujo && !confirm('Descartar as mudanças atuais e carregar a versão antiga no editor?')) return;
    const def = n === esteira.versaoAtual ? esteira.definicao : await api.versaoEsteira(projeto, n);
    setRascunho(structuredClone(def));
    setCarregada(n === esteira.versaoAtual ? null : n);
    setSelecionada(def.etapas[0]?.id ?? null);
  }

  const soltar = (ev: DragEvent, indice: number) => {
    ev.preventDefault();
    if (arrastando !== null) mover(arrastando, indice);
    setArrastando(null);
    setAlvo(null);
  };

  return (
    <div className="editor-esteira">
      <div className="barra-esteira">
        <div className="barra-versao">
          <label>
            Versão
            <select value={carregada ?? esteira.versaoAtual} onChange={(ev) => carregarVersao(Number(ev.target.value))}>
              {esteira.versoes.map((v) => (
                <option key={v.n} value={v.n}>
                  v{v.n}
                  {v.n === esteira.versaoAtual ? ' (atual)' : ''} · {dataHora(v.criadoEm)}
                  {v.nota ? ` · ${v.nota}` : ''}
                </option>
              ))}
            </select>
          </label>
          {carregada !== null && <span className="selo">editando a partir da v{carregada}: salvar cria a v{esteira.versaoAtual + 1}</span>}
          {sujo && carregada === null && <span className="selo selo-sujo">mudanças não salvas</span>}
        </div>
        <div className="barra-acoes">
          <input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Nota da versão (opcional)" aria-label="Nota da versão" />
          <button
            className="secundario"
            disabled={!sujo || salvar.isPending}
            onClick={() => {
              setRascunho(structuredClone(esteira.definicao));
              setCarregada(null);
            }}
          >
            Descartar
          </button>
          <button disabled={!sujo || validacao.erros.length > 0 || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? 'Salvando…' : `Salvar como v${esteira.versaoAtual + 1}`}
          </button>
        </div>
      </div>

      {salvar.isError && <p className="erro caixa-erro">{(salvar.error as Error).message}</p>}
      {(validacao.erros.length > 0 || validacao.avisos.length > 0) && (
        <div className="validacao">
          {validacao.erros.map((p, i) => (
            <button key={`e${i}`} className="validacao-item erro" onClick={() => p.etapa && setSelecionada(p.etapa)}>
              ✕ {p.mensagem}
            </button>
          ))}
          {(todosAvisos ? validacao.avisos : validacao.avisos.slice(0, 3)).map((p, i) => (
            <button key={`a${i}`} className="validacao-item aviso" onClick={() => p.etapa && setSelecionada(p.etapa)}>
              ⚠ {p.mensagem}
            </button>
          ))}
          {validacao.avisos.length > 3 && (
            <button className="validacao-mais" onClick={() => setTodosAvisos((v) => !v)}>
              {todosAvisos ? 'Mostrar menos avisos' : `Mostrar mais ${validacao.avisos.length - 3} aviso(s)`}
            </button>
          )}
        </div>
      )}

      <div className="esteira-colunas">
        <div className="esteira-lista">
          {trechos(rascunho.etapas).map((t, ti) => (
            <div key={ti} className={t.escopo === 'tarefa' ? 'trecho-tarefa' : 'trecho-problema'}>
              {t.escopo === 'tarefa' && <div className="trecho-rotulo">Para cada tarefa do plano</div>}
              {t.itens.map(({ etapa: e, indice }) => (
                <div
                  key={e.id}
                  className={[
                    'cartao-etapa',
                    e.id === selecionada ? 'selecionada' : '',
                    e.ativa ? '' : 'inativa',
                    alvo === indice && arrastando !== indice ? 'alvo' : '',
                  ].join(' ')}
                  draggable
                  onDragStart={(ev) => {
                    setArrastando(indice);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    setAlvo(indice);
                  }}
                  onDragLeave={() => setAlvo((a) => (a === indice ? null : a))}
                  onDrop={(ev) => soltar(ev, indice)}
                  onDragEnd={() => {
                    setArrastando(null);
                    setAlvo(null);
                  }}
                >
                  <span className="alca" aria-hidden title="Arraste para reordenar">
                    ⋮⋮
                  </span>
                  <button className="cartao-etapa-corpo" onClick={() => setSelecionada(e.id)}>
                    <span className="cartao-etapa-num">{indice + 1}</span>
                    <span className="cartao-etapa-texto">
                      <span className="forte">
                        {e.nome}
                        {errosPorEtapa.get(e.id) ? <span className="erro"> · {errosPorEtapa.get(e.id)} erro(s)</span> : null}
                      </span>
                      <span className="mudo pequeno">
                        {META_TIPOS[e.tipo].rotulo} · {resumoAgente(e, modelos)}
                      </span>
                      <span className="selos-etapa">
                        {!e.ativa && <span className="selo">desativada</span>}
                        {e.condicao === 'se_revisao_independente' && <span className="selo">se pedir revisão</span>}
                        {e.agente?.modo === 'orquestrador' && e.agente.familiaDiferenteDe && (
                          <span className="selo">família ≠ {e.agente.familiaDiferenteDe}</span>
                        )}
                        {e.falha.acao === 'voltar' && (
                          <span className="selo">
                            ↺ {e.falha.voltarPara} ×{e.falha.maxTentativas}
                          </span>
                        )}
                        {e.escalar && <span className="selo">troca na {e.escalar.aPartirDaTentativa}ª</span>}
                      </span>
                    </span>
                  </button>
                  <span className="cartao-etapa-mover">
                    <button className="secundario pequeno" aria-label={`Subir ${e.nome}`} disabled={indice === 0} onClick={() => mover(indice, indice - 1)}>
                      ↑
                    </button>
                    <button
                      className="secundario pequeno"
                      aria-label={`Descer ${e.nome}`}
                      disabled={indice === rascunho.etapas.length - 1}
                      onClick={() => mover(indice, indice + 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}

          <div className="adicionar-etapa">
            <select value={novoTipo} onChange={(ev) => setNovoTipo(ev.target.value as TipoEtapa)} aria-label="Tipo da nova etapa">
              {TIPOS_ETAPA.map((t) => (
                <option key={t} value={t}>
                  {META_TIPOS[t].rotulo}
                </option>
              ))}
            </select>
            <button className="secundario" onClick={adicionar}>
              Adicionar etapa
            </button>
          </div>
          <p className="mudo pequeno">{META_TIPOS[novoTipo].descricao}</p>
        </div>

        <div className="esteira-detalhe">
          {etapaSel ? (
            <EditorEtapa
              key={rascunho.etapas.indexOf(etapaSel)}
              etapa={etapaSel}
              definicao={rascunho}
              modelos={modelos}
              provedores={provedores}
              problemas={[...validacao.erros, ...validacao.avisos].filter((p) => p.etapa === etapaSel.id)}
              aoMudar={mudarEtapa}
              aoRenomear={renomear}
              aoRemover={() => remover(etapaSel.id)}
            />
          ) : (
            <p className="mudo">Escolha uma etapa para editar.</p>
          )}
        </div>
      </div>
    </div>
  );
}
