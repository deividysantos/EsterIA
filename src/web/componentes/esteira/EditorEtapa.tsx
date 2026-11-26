import { useRef } from 'react';

import {
  META_TIPOS,
  ROTULO_SAIDA,
  VARIAVEIS,
  type Agente,
  type Definicao,
  type Etapa,
  type Problema,
} from '../../../shared/esteiras';
import { ID_PROVEDORES, type Modelo, type Provedor } from '../../../shared/provedores';

interface Props {
  etapa: Etapa;
  definicao: Definicao;
  modelos: Modelo[];
  provedores: Provedor[];
  problemas: Problema[];
  aoMudar: (e: Etapa) => void;
  aoRenomear: (antigo: string, novo: string) => void;
  aoRemover: () => void;
}

function rotuloPrompt(e: Etapa): string {
  if (e.tipo === 'commit') return 'Mensagem do commit';
  if (e.tipo === 'aprovacao_humana') return 'Instrução para você';
  return 'Prompt';
}

function SeletorModelo({
  valor,
  modelos,
  provedores,
  onChange,
  rotulo,
}: {
  valor: number | null;
  modelos: Modelo[];
  provedores: Provedor[];
  onChange: (id: number) => void;
  rotulo: string;
}) {
  return (
    <select value={valor ?? ''} onChange={(ev) => onChange(Number(ev.target.value))} aria-label={rotulo}>
      <option value="" disabled>
        Escolha um modelo…
      </option>
      {ID_PROVEDORES.map((pid) => {
        const p = provedores.find((x) => x.id === pid);
        const itens = modelos.filter((m) => m.provedor === pid);
        if (!itens.length) return null;
        return (
          <optgroup key={pid} label={`${p?.nome ?? pid}${p?.habilitado ? '' : ' (indisponível nesta máquina)'}`}>
            {itens.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} · {m.familia}
                {m.ativo ? '' : ' (inativo)'}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function EditorEtapa({ etapa: e, definicao, modelos, provedores, problemas, aoMudar, aoRenomear, aoRemover }: Props) {
  const meta = META_TIPOS[e.tipo];
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Etapa>(k: K, v: Etapa[K]) => aoMudar({ ...e, [k]: v });
  const idx = definicao.etapas.findIndex((x) => x.id === e.id);
  const anteriores = definicao.etapas.slice(0, idx + 1);
  const problemasCampo = (campo: string) => problemas.filter((p) => p.campo === campo);

  function inserirVariavel(nome: string) {
    const t = promptRef.current;
    const marca = `{{${nome}}}`;
    if (!t) return set('prompt', e.prompt + marca);
    const ini = t.selectionStart;
    const fim = t.selectionEnd;
    set('prompt', e.prompt.slice(0, ini) + marca + e.prompt.slice(fim));
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  }

  function mudarAgente(a: Agente) {
    set('agente', a);
  }

  const Avisos = ({ campo }: { campo: string }) => (
    <>
      {problemasCampo(campo).map((p, i) => (
        <span key={i} className="erro pequeno">
          {p.mensagem}
        </span>
      ))}
    </>
  );

  return (
    <div className="editor-etapa">
      <header className="editor-etapa-topo">
        <div>
          <div className="mudo pequeno">{meta.rotulo}</div>
          <h2>{e.nome || e.id}</h2>
        </div>
        <button className="secundario perigo pequeno" onClick={aoRemover}>
          Remover etapa
        </button>
      </header>
      <p className="mudo pequeno">{meta.descricao}</p>

      <div className="formulario formulario-plano">
        <label>
          Nome
          <input value={e.nome} onChange={(ev) => set('nome', ev.target.value)} />
        </label>
        <label>
          Id (usado nas referências)
          <input
            value={e.id}
            className="mono"
            onChange={(ev) => aoRenomear(e.id, ev.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          />
          <Avisos campo="id" />
        </label>

        <label>
          Roda
          <select value={e.escopo} onChange={(ev) => set('escopo', ev.target.value as Etapa['escopo'])} disabled={meta.escopos.length === 1}>
            {meta.escopos.map((s) => (
              <option key={s} value={s}>
                {s === 'tarefa' ? 'Para cada tarefa' : 'Uma vez por problema'}
              </option>
            ))}
          </select>
          <Avisos campo="escopo" />
        </label>
        <label>
          Quando
          <select
            value={e.condicao}
            onChange={(ev) => set('condicao', ev.target.value as Etapa['condicao'])}
            disabled={e.escopo !== 'tarefa'}
          >
            <option value="sempre">Sempre</option>
            <option value="se_revisao_independente">Só se a tarefa pedir revisão independente</option>
          </select>
          <Avisos campo="condicao" />
        </label>

        <label className="alternador largo">
          <input type="checkbox" checked={e.ativa} onChange={(ev) => set('ativa', ev.target.checked)} />
          Etapa ativa (desligada, a esteira pula)
        </label>

        {meta.usaAgente && (
          <fieldset className="largo grupo grupo-coluna">
            <legend>Quem roda</legend>
            <div className="linha-opcoes">
              <label className="alternador">
                <input
                  type="radio"
                  checked={e.agente?.modo === 'fixo'}
                  onChange={() => mudarAgente({ modo: 'fixo', modeloId: modelos.find((m) => m.ativo)?.id ?? modelos[0]?.id ?? 0 })}
                />
                Modelo fixo
              </label>
              <label className="alternador">
                <input
                  type="radio"
                  checked={e.agente?.modo === 'orquestrador'}
                  onChange={() =>
                    mudarAgente({ modo: 'orquestrador', papel: e.tipo === 'revisar' ? 'revisor' : 'executor', candidatos: [], familiaDiferenteDe: null })
                  }
                />
                O orquestrador escolhe
              </label>
            </div>
            {e.agente?.modo === 'fixo' && (
              <SeletorModelo
                rotulo="Modelo da etapa"
                valor={e.agente.modeloId}
                modelos={modelos}
                provedores={provedores}
                onChange={(id) => mudarAgente({ modo: 'fixo', modeloId: id })}
              />
            )}
            {e.agente?.modo === 'orquestrador' && (
              <OrquestradorEscolhe
                agente={e.agente}
                modelos={modelos}
                provedores={provedores}
                anteriores={anteriores.filter((x) => x.id !== e.id && META_TIPOS[x.tipo].usaAgente)}
                onChange={mudarAgente}
              />
            )}
            <Avisos campo="agente" />

            <label className="alternador">
              <input
                type="checkbox"
                checked={e.escalar !== null}
                onChange={(ev) =>
                  set('escalar', ev.target.checked ? { aPartirDaTentativa: 2, modeloId: modelos.find((m) => m.ativo)?.id ?? 0 } : null)
                }
              />
              Trocar de modelo nas tentativas seguintes
            </label>
            {e.escalar && (
              <div className="linha-opcoes">
                <label>
                  A partir da tentativa
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={e.escalar.aPartirDaTentativa}
                    onChange={(ev) => set('escalar', { ...e.escalar!, aPartirDaTentativa: Number(ev.target.value) })}
                  />
                </label>
                <label className="crescer">
                  Usar
                  <SeletorModelo
                    rotulo="Modelo das tentativas seguintes"
                    valor={e.escalar.modeloId}
                    modelos={modelos}
                    provedores={provedores}
                    onChange={(id) => set('escalar', { ...e.escalar!, modeloId: id })}
                  />
                </label>
              </div>
            )}
            <Avisos campo="escalar" />
          </fieldset>
        )}

        {meta.usaAgente && (
          <label>
            Acesso
            <select value={e.acesso} onChange={(ev) => set('acesso', ev.target.value as Etapa['acesso'])} disabled={!!meta.acessoFixo}>
              <option value="leitura">Leitura (não edita)</option>
              <option value="escrita">Escrita (edita e roda comandos)</option>
            </select>
            <Avisos campo="acesso" />
          </label>
        )}
        {meta.usaAgente && (
          <label>
            Saída esperada
            <select value={e.saida} onChange={(ev) => set('saida', ev.target.value as Etapa['saida'])} disabled={meta.saidas.length === 1}>
              {meta.saidas.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_SAIDA[s]}
                </option>
              ))}
            </select>
            <Avisos campo="saida" />
          </label>
        )}

        {e.tipo === 'comando' && (
          <label className="largo">
            Comando (roda na pasta do projeto)
            <input value={e.comando} onChange={(ev) => set('comando', ev.target.value)} className="mono" placeholder="npm test" />
            <Avisos campo="comando" />
          </label>
        )}

        {e.tipo !== 'comando' && (
          <div className="largo campo-prompt">
            <label htmlFor={`prompt-${e.id}`}>{rotuloPrompt(e)}</label>
            <textarea
              id={`prompt-${e.id}`}
              ref={promptRef}
              value={e.prompt}
              onChange={(ev) => set('prompt', ev.target.value)}
              rows={e.tipo === 'commit' || e.tipo === 'aprovacao_humana' ? 3 : 12}
              className="mono"
              spellCheck={false}
            />
            <div className="variaveis" aria-label="Inserir variável">
              {VARIAVEIS.filter((v) => v.escopo === 'ambos' || v.escopo === e.escopo).map((v) => (
                <button key={v.nome} type="button" className="variavel" title={v.descricao} onClick={() => inserirVariavel(v.nome)}>
                  {`{{${v.nome}}}`}
                </button>
              ))}
            </div>
            {meta.usaAgente && e.saida !== 'texto' && (
              <span className="mudo pequeno">O painel acrescenta ao prompt as instruções de formato de “{ROTULO_SAIDA[e.saida]}”.</span>
            )}
            <Avisos campo="prompt" />
          </div>
        )}

        <fieldset className="largo grupo grupo-coluna">
          <legend>Se falhar ({meta.falhaQuando})</legend>
          <div className="linha-opcoes">
            <label>
              Ação
              <select
                value={e.falha.acao}
                onChange={(ev) =>
                  set('falha', {
                    ...e.falha,
                    acao: ev.target.value as Etapa['falha']['acao'],
                    voltarPara: ev.target.value === 'voltar' ? (e.falha.voltarPara ?? e.id) : null,
                  })
                }
              >
                <option value="voltar">Voltar para uma etapa</option>
                <option value="bloquear">Repetir esta etapa</option>
                <option value="continuar">Registrar e seguir</option>
              </select>
            </label>
            {e.falha.acao === 'voltar' && (
              <label className="crescer">
                Voltar para
                <select value={e.falha.voltarPara ?? ''} onChange={(ev) => set('falha', { ...e.falha, voltarPara: ev.target.value })}>
                  {anteriores
                    .filter((x) => x.escopo === e.escopo)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome} ({x.id})
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Máx. de tentativas
              <input
                type="number"
                min={1}
                max={10}
                value={e.falha.maxTentativas}
                onChange={(ev) => set('falha', { ...e.falha, maxTentativas: Number(ev.target.value) })}
              />
            </label>
          </div>
          <span className="mudo pequeno">Passou do máximo, a esteira para e chama você.</span>
          <Avisos campo="falha" />
        </fieldset>

        <label>
          Tempo máximo (min)
          <input
            type="number"
            min={1}
            value={e.timeoutMin ?? ''}
            placeholder="sem limite"
            onChange={(ev) => set('timeoutMin', ev.target.value ? Number(ev.target.value) : null)}
          />
        </label>
      </div>
    </div>
  );
}

function OrquestradorEscolhe({
  agente,
  modelos,
  provedores,
  anteriores,
  onChange,
}: {
  agente: Extract<Agente, { modo: 'orquestrador' }>;
  modelos: Modelo[];
  provedores: Provedor[];
  anteriores: Etapa[];
  onChange: (a: Agente) => void;
}) {
  const sel = new Set(agente.candidatos);
  const alternar = (id: number) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange({ ...agente, candidatos: [...n] });
  };
  return (
    <div className="orquestrador-escolhe">
      <div className="linha-opcoes">
        <label>
          Papel
          <input value={agente.papel} onChange={(ev) => onChange({ ...agente, papel: ev.target.value })} />
        </label>
        <label className="crescer">
          Revisão cruzada: família diferente de
          <select
            value={agente.familiaDiferenteDe ?? ''}
            onChange={(ev) => onChange({ ...agente, familiaDiferenteDe: ev.target.value || null })}
          >
            <option value="">— sem restrição —</option>
            {anteriores.map((x) => (
              <option key={x.id} value={x.id}>
                quem rodou {x.nome} ({x.id})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mudo pequeno">
        Candidatos {sel.size === 0 ? '(nenhum marcado = todos os modelos ativos de provedores habilitados)' : `(${sel.size})`}
      </div>
      <div className="candidatos">
        {ID_PROVEDORES.map((pid) => {
          const itens = modelos.filter((m) => m.provedor === pid);
          if (!itens.length) return null;
          const p = provedores.find((x) => x.id === pid);
          return (
            <div key={pid} className="candidatos-grupo">
              <div className="pequeno forte">
                {p?.nome ?? pid}
                {!p?.habilitado && <span className="mudo"> · indisponível</span>}
              </div>
              {itens.map((m) => (
                <label key={m.id} className="alternador pequeno">
                  <input type="checkbox" checked={sel.has(m.id)} onChange={() => alternar(m.id)} />
                  {m.nome} <span className="mudo">· {m.familia}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
