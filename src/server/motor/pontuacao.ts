import {
  META_METRICAS,
  METRICAS,
  type CandidatoPontuado,
  type Componente,
  type Criterios,
  type MetricaId,
} from '../../shared/criterios.js';
import type { Modelo } from '../../shared/provedores.js';
import type { Medidas } from '../db/criterios.js';

const NEUTRO = 0.5;

function declarado(m: Modelo, id: MetricaId): number | null {
  if (id === 'qualidade') return m.notaQualidade;
  if (id === 'custo') return m.notaCusto;
  if (id === 'velocidade') return m.notaVelocidade;
  return null;
}

/** Regras rígidas do projeto: devolve o motivo da exclusão ou null. */
export function violaRegras(m: Modelo, c: Criterios): string | null {
  if (c.excluidos.includes(m.id)) return 'excluído nos critérios do projeto';
  if (c.qualidadeMinima !== null) {
    if (m.notaQualidade === null) return `sem nota de qualidade (mínimo ${c.qualidadeMinima})`;
    if (m.notaQualidade < c.qualidadeMinima) return `qualidade ${m.notaQualidade} abaixo do mínimo ${c.qualidadeMinima}`;
  }
  return null;
}

/**
 * Pontua os candidatos com os pesos do projeto. `exclusoes` traz motivos já conhecidos (provedor
 * indisponível, revisão cruzada); as regras rígidas dos critérios são aplicadas aqui.
 * Resultado: elegíveis primeiro, da maior para a menor pontuação (empate mantém a ordem de entrada).
 */
export function pontuar(
  modelos: readonly Modelo[],
  c: Criterios,
  medidas: Map<number, Partial<Record<MetricaId, Medidas>>>,
  exclusoes: ReadonlyMap<number, string> = new Map()
): CandidatoPontuado[] {
  const ativos = METRICAS.filter((id) => (c.pesos[id] ?? 0) > 0);
  const motivo = new Map(modelos.map((m) => [m.id, exclusoes.get(m.id) ?? violaRegras(m, c)]));
  const elegiveis = modelos.filter((m) => motivo.get(m.id) === null);

  const bruto = (m: Modelo, id: MetricaId): { valor: number | null; amostras: number | null } => {
    if (META_METRICAS[id].origem === 'declarada') return { valor: declarado(m, id), amostras: null };
    const med = medidas.get(m.id)?.[id];
    if (!med || med.amostras < c.amostrasMinimas) return { valor: null, amostras: med?.amostras ?? 0 };
    return { valor: med.valor, amostras: med.amostras };
  };

  // Faixa de cada métrica medida entre os elegíveis, para normalizar.
  const faixa = new Map<MetricaId, [number, number]>();
  for (const id of ativos) {
    if (META_METRICAS[id].origem !== 'medida') continue;
    const vs = elegiveis.map((m) => bruto(m, id).valor).filter((v): v is number => v !== null);
    if (vs.length) faixa.set(id, [Math.min(...vs), Math.max(...vs)]);
  }

  const normalizar = (id: MetricaId, v: number | null): number => {
    if (v === null) return NEUTRO;
    if (META_METRICAS[id].origem === 'declarada') return Math.min(Math.max((v - 1) / 4, 0), 1);
    const f = faixa.get(id);
    if (!f || f[1] === f[0]) return NEUTRO;
    const n = (v - f[0]) / (f[1] - f[0]);
    return META_METRICAS[id].maiorMelhor ? n : 1 - n;
  };

  const somaPesos = ativos.reduce((t, id) => t + c.pesos[id]!, 0);
  const lista = modelos.map((m, ordem) => {
    const componentes: Componente[] = ativos.map((id) => {
      const b = bruto(m, id);
      return { metrica: id, peso: c.pesos[id]!, valor: b.valor, normal: normalizar(id, b.valor), amostras: b.amostras };
    });
    const pontuacao = somaPesos ? componentes.reduce((t, x) => t + x.peso * x.normal, 0) / somaPesos : NEUTRO;
    const cand: CandidatoPontuado = {
      modeloId: m.id,
      codigo: m.codigo,
      nome: m.nome,
      familia: m.familia,
      elegivel: motivo.get(m.id) === null,
      excluidoPor: motivo.get(m.id) ?? null,
      pontuacao: Math.round(pontuacao * 1000) / 1000,
      componentes,
    };
    return { cand, ordem };
  });
  lista.sort((a, b) => Number(b.cand.elegivel) - Number(a.cand.elegivel) || b.cand.pontuacao - a.cand.pontuacao || a.ordem - b.ordem);
  return lista.map((x) => x.cand);
}

function fmt(c: Componente): string {
  const meta = META_METRICAS[c.metrica];
  if (c.valor === null) return `${meta.rotulo.toLowerCase()}: sem dado`;
  if (meta.origem === 'declarada') return `${meta.rotulo.toLowerCase()} ${c.valor}/5`;
  if (c.metrica === 'custo_medido') return `custo médio US$ ${c.valor.toFixed(4)}`;
  if (c.metrica === 'duracao_medida') return `duração média ${Math.round(c.valor / 1000)} s`;
  return `${meta.rotulo.toLowerCase()} ${Math.round(c.valor * 100)}% (${c.amostras})`;
}

/** Linha do catálogo do planejador para um candidato pontuado. */
export function descreverCandidato(c: CandidatoPontuado): string {
  return `pontuação ${c.pontuacao.toFixed(2)}${c.componentes.length ? ` (${c.componentes.map(fmt).join(', ')})` : ''}`;
}

export function descreverCriterios(c: Criterios): string {
  const pesos = METRICAS.filter((id) => (c.pesos[id] ?? 0) > 0).map((id) => `${META_METRICAS[id].rotulo.toLowerCase()} ${c.pesos[id]}`);
  const partes = [
    pesos.length ? `Pesos da pontuação: ${pesos.join(', ')}.` : 'Sem pesos definidos: todos os candidatos empatam.',
    c.modo === 'pontuacao'
      ? 'Neste projeto o painel usa sempre o candidato de maior pontuação; sua escolha de modelo é só informativa.'
      : 'Escolha o modelo de cada papel; a pontuação é orientação. Se você não escolher, vale o de maior pontuação.',
  ];
  if (c.instrucoes.trim()) partes.push(`Orientações do projeto:\n${c.instrucoes.trim()}`);
  return partes.join('\n');
}
