import type { Definicao, Etapa } from '../../shared/esteiras.js';
import type { Fase } from '../../shared/problemas.js';
import type { AtualizacaoTarefa, ProblemaInterno, TarefaInterna } from '../db/problemas.js';

export type Passo =
  | { tipo: 'rodar'; etapaIndice: number; tarefaId: number | null }
  | { tipo: 'concluir' }
  | { tipo: 'bloquear'; motivo: string };

export interface Decisao {
  passo: Passo;
  /** Mudanças de ponteiro a gravar antes de executar o passo. */
  problema: { fase: Fase; indice: number };
  tarefas: { id: number; mudancas: AtualizacaoTarefa }[];
  /** Tarefas que começam agora (o motor fotografa o git delas). */
  iniciadas: number[];
}

export interface Bloco {
  inicio: number;
  fim: number;
}

export function blocoTarefas(def: Definicao): Bloco | null {
  const idx = def.etapas.flatMap((e, i) => (e.escopo === 'tarefa' ? [i] : []));
  return idx.length ? { inicio: idx[0]!, fim: idx.at(-1)! } : null;
}

export function pular(e: Etapa, tarefa: TarefaInterna | null): boolean {
  if (!e.ativa) return true;
  return e.condicao === 'se_revisao_independente' && tarefa !== null && !tarefa.revisaoIndependente;
}

const FINAL = new Set(['concluida', 'cancelada']);

/**
 * Dado o estado atual, decide o próximo passo do problema: pula etapas desativadas, troca de fase,
 * conclui e inicia tarefas. Pura: não grava nada, devolve as mudanças.
 */
export function decidir(def: Definicao, p: Pick<ProblemaInterno, 'fase' | 'indice'>, tarefasOrig: readonly TarefaInterna[]): Decisao {
  const bloco = blocoTarefas(def);
  const n = def.etapas.length;
  const tarefas = tarefasOrig.map((t) => ({ ...t }));
  const mudTarefas = new Map<number, AtualizacaoTarefa>();
  const iniciadas: number[] = [];
  let fase: Fase = p.fase;
  let indice = p.indice;

  const mudar = (t: TarefaInterna, m: AtualizacaoTarefa) => {
    Object.assign(t, m);
    mudTarefas.set(t.id, { ...(mudTarefas.get(t.id) ?? {}), ...m });
  };
  const fim = (passo: Passo): Decisao => ({
    passo,
    problema: { fase, indice },
    tarefas: [...mudTarefas].map(([id, mudancas]) => ({ id, mudancas })),
    iniciadas,
  });

  for (let guarda = 0; guarda < 10_000; guarda++) {
    if (fase === 'antes') {
      const limite = bloco ? bloco.inicio : n;
      while (indice < limite && pular(def.etapas[indice]!, null)) indice++;
      if (indice < limite) return fim({ tipo: 'rodar', etapaIndice: indice, tarefaId: null });
      if (bloco) fase = 'tarefas';
      else fase = 'depois';
      continue;
    }

    if (fase === 'tarefas') {
      const b = bloco!;
      const atual = tarefas.find((t) => t.estado === 'em_andamento');
      if (atual) {
        let j = Math.max(atual.indiceEtapa, b.inicio);
        while (j <= b.fim && pular(def.etapas[j]!, atual)) j++;
        if (j !== atual.indiceEtapa) mudar(atual, { indiceEtapa: j });
        if (j <= b.fim) return fim({ tipo: 'rodar', etapaIndice: j, tarefaId: atual.id });
        mudar(atual, { estado: 'concluida' });
        continue;
      }
      const bloqueada = tarefas.find((t) => t.estado === 'bloqueada');
      if (bloqueada) return fim({ tipo: 'bloquear', motivo: `Tarefa ${bloqueada.codigo} bloqueada: ${bloqueada.motivo ?? 'sem motivo'}` });

      const estado = new Map(tarefas.map((t) => [t.codigo, t.estado]));
      const pendentes = tarefas.filter((t) => t.estado === 'pendente');
      const pronta = pendentes.find((t) => t.dependeDe.every((d) => !estado.has(d) || FINAL.has(estado.get(d)!)));
      if (pronta) {
        mudar(pronta, { estado: 'em_andamento', indiceEtapa: b.inicio, contadores: {}, feedback: null });
        iniciadas.push(pronta.id);
        continue;
      }
      if (pendentes.length) {
        const lista = pendentes.map((t) => `${t.codigo} (espera ${t.dependeDe.join(', ')})`).join('; ');
        return fim({ tipo: 'bloquear', motivo: `Dependências que não se resolvem: ${lista}.` });
      }
      fase = 'depois';
      indice = b.fim + 1;
      continue;
    }

    if (fase === 'depois') {
      while (indice < n && (def.etapas[indice]!.escopo === 'tarefa' || pular(def.etapas[indice]!, null))) indice++;
      if (indice < n) return fim({ tipo: 'rodar', etapaIndice: indice, tarefaId: null });
      fase = 'fim';
      continue;
    }

    return fim({ tipo: 'concluir' });
  }
  throw new Error('decidir: laço sem fim (definição inconsistente).');
}

export type Resultado =
  | { tipo: 'ok' }
  | { tipo: 'falha'; feedback: string }
  | { tipo: 'aguardar' };

/**
 * Para onde vai o ponteiro depois de uma falha da etapa `indice`, segundo a regra de falha dela.
 * `contagem` é quantas vezes esta etapa já falhou neste ciclo (incluindo a atual).
 */
export function aposFalha(
  def: Definicao,
  indice: number,
  contagem: number
): { tipo: 'seguir' } | { tipo: 'repetir'; indice: number } | { tipo: 'bloquear'; motivo: string } {
  const e = def.etapas[indice]!;
  if (e.falha.acao === 'continuar') return { tipo: 'seguir' };
  if (contagem >= e.falha.maxTentativas) {
    return { tipo: 'bloquear', motivo: `${e.nome} falhou ${contagem} vez(es) (máximo ${e.falha.maxTentativas}).` };
  }
  if (e.falha.acao === 'voltar') {
    const alvo = def.etapas.findIndex((x) => x.id === e.falha.voltarPara);
    return { tipo: 'repetir', indice: alvo >= 0 ? alvo : indice };
  }
  return { tipo: 'repetir', indice };
}
