import { z } from 'zod';

/**
 * Critérios de escolha de modelo por projeto: quais métricas pesam, quanto, e as regras que nenhum
 * candidato pode violar. Valem para toda etapa em que "o orquestrador escolhe".
 */

export const METRICAS = [
  'qualidade',
  'custo',
  'velocidade',
  'aprovacao_primeira',
  'conclusao',
  'custo_medido',
  'duracao_medida',
  'precisao_revisor',
] as const;
export type MetricaId = (typeof METRICAS)[number];

export interface MetaMetrica {
  rotulo: string;
  descricao: string;
  origem: 'declarada' | 'medida';
  /** Para as medidas: true se valor maior é melhor. */
  maiorMelhor: boolean;
}

export const META_METRICAS: Record<MetricaId, MetaMetrica> = {
  qualidade: { rotulo: 'Qualidade', descricao: 'Nota de qualidade cadastrada no modelo (1 a 5).', origem: 'declarada', maiorMelhor: true },
  custo: { rotulo: 'Custo', descricao: 'Nota de custo cadastrada (5 = mais barato).', origem: 'declarada', maiorMelhor: true },
  velocidade: { rotulo: 'Velocidade', descricao: 'Nota de velocidade cadastrada (5 = mais rápido).', origem: 'declarada', maiorMelhor: true },
  aprovacao_primeira: {
    rotulo: 'Aprovação de primeira',
    descricao: 'Fração das tarefas em que o código do modelo passou na primeira revisão.',
    origem: 'medida',
    maiorMelhor: true,
  },
  conclusao: { rotulo: 'Taxa de conclusão', descricao: 'Fração dos runs do modelo que terminaram sem falha.', origem: 'medida', maiorMelhor: true },
  custo_medido: { rotulo: 'Custo médio medido', descricao: 'Custo médio por run (USD), do histórico.', origem: 'medida', maiorMelhor: false },
  duracao_medida: { rotulo: 'Duração média medida', descricao: 'Tempo médio por run, do histórico.', origem: 'medida', maiorMelhor: false },
  precisao_revisor: {
    rotulo: 'Precisão como revisor',
    descricao: 'Fração dos pontos de parecer do modelo que você marcou como “procede”. Serve para escolher revisores.',
    origem: 'medida',
    maiorMelhor: true,
  },
};

export const criteriosSchema = z.object({
  /**
   * orquestrador: o planejador escolhe (a pontuação vai para ele como orientação e decide quando ele não escolhe);
   * pontuacao: o motor usa sempre o candidato de maior pontuação, ignorando a escolha do plano.
   */
  modo: z.enum(['orquestrador', 'pontuacao']),
  /** Peso de cada métrica (0 = não conta). */
  pesos: z.record(z.enum(METRICAS), z.number().int().min(0).max(10)),
  /** De onde vêm as métricas medidas. */
  historico: z.enum(['projeto', 'todos']),
  /** Abaixo disso, a métrica medida conta como "sem dado" (neutra). */
  amostrasMinimas: z.number().int().min(1).max(100),
  /** Regras rígidas: candidatos fora delas nunca são escolhidos. */
  excluidos: z.array(z.number().int().positive()).max(100),
  qualidadeMinima: z.number().int().min(1).max(5).nullable(),
  /** Texto livre que vai para o planejador junto do catálogo. */
  instrucoes: z.string().max(5000),
});
export type Criterios = z.infer<typeof criteriosSchema>;

export const CRITERIOS_PADRAO: Criterios = {
  modo: 'orquestrador',
  pesos: { qualidade: 5, custo: 3, velocidade: 2, aprovacao_primeira: 0, conclusao: 0, custo_medido: 0, duracao_medida: 0, precisao_revisor: 0 },
  historico: 'todos',
  amostrasMinimas: 3,
  excluidos: [],
  qualidadeMinima: null,
  instrucoes: '',
};

/** Valores brutos de um modelo (null = sem dado). */
export type ValoresMetricas = Record<MetricaId, number | null>;

export interface Componente {
  metrica: MetricaId;
  peso: number;
  /** Valor bruto (nota, fração, USD, ms) ou null sem dado. */
  valor: number | null;
  /** Normalizado de 0 a 1 entre os candidatos (0,5 quando sem dado). */
  normal: number;
  amostras: number | null;
}

export interface CandidatoPontuado {
  modeloId: number;
  codigo: string;
  nome: string;
  familia: string;
  elegivel: boolean;
  /** Por que ficou de fora (regra rígida, revisão cruzada, provedor indisponível). */
  excluidoPor: string | null;
  pontuacao: number;
  componentes: Componente[];
}

export type OrigemDecisao = 'plano' | 'pontuacao' | 'fixo' | 'escalada';

export interface DecisaoModelo {
  id: number;
  execucaoId: number;
  etapaId: string;
  papel: string | null;
  origem: OrigemDecisao;
  pedidoPeloPlano: string | null;
  escolhidoId: number;
  motivo: string;
  candidatos: CandidatoPontuado[];
  criterios: Criterios;
  criadoEm: string;
}

export interface PreviaPapel {
  etapaId: string;
  etapaNome: string;
  papel: string;
  regraCruzada: string | null;
  candidatos: CandidatoPontuado[];
}

export interface CriteriosProjeto {
  projeto: string;
  criterios: Criterios;
  padrao: boolean;
  atualizadoEm: string | null;
}
