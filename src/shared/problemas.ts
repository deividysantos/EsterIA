import { z } from 'zod';

import type { DecisaoModelo } from './criterios.js';
import type { Definicao, TipoEtapa } from './esteiras.js';
import { idProjetoSchema } from './projetos.js';

export type EstadoProblema = 'em_andamento' | 'aguardando' | 'bloqueado' | 'pausado' | 'concluido' | 'cancelado';
export type EstadoTarefa = 'pendente' | 'em_andamento' | 'bloqueada' | 'concluida' | 'cancelada';
export type EstadoExecucao =
  | 'rodando'
  | 'aguardando'
  | 'concluida'
  | 'reprovada'
  | 'falhou'
  | 'pulada'
  | 'cancelada'
  | 'respondida';
export type Fase = 'antes' | 'tarefas' | 'depois' | 'fim';
export type Espera = 'aprovacao' | 'perguntas';

// ---------- Formatos de saída que os agentes devolvem ----------

export const tarefaPlanoSchema = z.object({
  codigo: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/, 'código curto, ex.: T1'),
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().min(1).max(20_000),
  /** Papel → código do modelo escolhido (ex.: { executor: "cursor-grok-4.6-high", revisor: "gemini-4-neon-high" }). */
  modelos: z.record(z.string(), z.string()).default({}),
  justificativa: z.string().trim().max(2000).default(''),
  revisao_independente: z.boolean().default(true),
  depende_de: z.array(z.string()).default([]),
});

export const planoSchema = z.object({
  /** Perguntas para o usuário; com perguntas, as tarefas são ignoradas e o plano espera as respostas. */
  perguntas: z.array(z.string().trim().min(1)).default([]),
  resumo: z.string().trim().max(5000).default(''),
  tarefas: z.array(tarefaPlanoSchema).max(50).default([]),
});
export type Plano = z.output<typeof planoSchema>;

export const itemParecerSchema = z.object({
  arquivo: z.string().default(''),
  linha: z.number().int().nullable().default(null),
  severidade: z.enum(['alta', 'media', 'baixa']).catch('media'),
  descricao: z.string().default(''),
  sugestao: z.string().default(''),
});
export const parecerSchema = z.object({
  aprovado: z.boolean(),
  problemas: z.array(itemParecerSchema).default([]),
});
export type Parecer = z.output<typeof parecerSchema>;

export const resumoExecucaoSchema = z.object({
  arquivos_alterados: z.array(z.string()).default([]),
  o_que_foi_feito: z.string().default(''),
  duvidas: z.array(z.string()).default([]),
});

// ---------- Entidades ----------

export interface Resposta {
  pergunta: string;
  resposta: string;
}

export interface Problema {
  id: string;
  projeto: string;
  numero: number;
  titulo: string;
  descricao: string;
  estado: EstadoProblema;
  esteiraVersao: number;
  fase: Fase;
  indice: number;
  plano: Plano | null;
  respostas: Resposta[];
  motivo: string | null;
  criadoEm: string;
  atualizadoEm: string;
  concluidoEm: string | null;
}

export interface Tarefa {
  id: number;
  problema: string;
  codigo: string;
  titulo: string;
  descricao: string;
  revisaoIndependente: boolean;
  dependeDe: string[];
  modelos: Record<string, string>;
  justificativa: string;
  ordem: number;
  estado: EstadoTarefa;
  indiceEtapa: number;
  arquivos: string[];
  commit: string | null;
  motivo: string | null;
}

export interface Execucao {
  id: number;
  problema: string;
  tarefaId: number | null;
  tarefaCodigo: string | null;
  etapaId: string;
  etapaNome: string;
  tipo: TipoEtapa;
  tentativa: number;
  estado: EstadoExecucao;
  espera: Espera | null;
  runId: string | null;
  modeloId: number | null;
  modeloNome: string | null;
  motivoEscolha: string | null;
  feedback: string | null;
  saidaTexto: string | null;
  saida: unknown;
  erro: string | null;
  custoUsd: number | null;
  inicio: string;
  fim: string | null;
}

export interface ResumoProblema extends Problema {
  tarefasTotal: number;
  tarefasConcluidas: number;
  custoUsd: number;
  /** Execução esperando você (aprovação ou perguntas), se houver. */
  esperando: { execucaoId: number; espera: Espera; etapaNome: string } | null;
}

export interface DetalheProblema {
  problema: ResumoProblema;
  definicao: Definicao;
  tarefas: Tarefa[];
  execucoes: Execucao[];
  decisoes: DecisaoModelo[];
  itensParecer: ItemParecer[];
}

export type DecisaoItem = 'procede' | 'nao_procede';

/** Um ponto de um parecer (revisão ou crítica), com a sua avaliação para medir a precisão do revisor. */
export interface ItemParecer {
  id: number;
  execucaoId: number;
  indice: number;
  arquivo: string;
  linha: number | null;
  severidade: 'alta' | 'media' | 'baixa';
  descricao: string;
  sugestao: string;
  decisao: DecisaoItem | null;
  decididoEm: string | null;
}

export const decisaoItemSchema = z.object({ decisao: z.enum(['procede', 'nao_procede']).nullable() });

export interface ItemFila {
  execucao: Execucao;
  projeto: string;
  problemaTitulo: string;
  problemaNumero: number;
}

export interface LimitesFila {
  global: number;
  porProvedor: number;
  /** Acima deste % de uso de qualquer janela de cota, o provedor não recebe etapas novas (null = desligado). */
  cotaMaxima: number | null;
}

export interface CotaBloqueando {
  provedor: string;
  janela: string;
  utilizacao: number;
  reiniciaEm: string | null;
}

export interface EstadoFila {
  limites: LimitesFila;
  rodando: ItemFila[];
  aguardandoVoce: ItemFila[];
  bloqueados: ResumoProblema[];
  /** Provedores parados por cota acima do limite. */
  cotas: CotaBloqueando[];
  /** Problemas com próximo passo pronto, esperando vaga. */
  naFila: number;
}

// ---------- Entradas da API ----------

export const novoProblemaSchema = z.object({
  projeto: idProjetoSchema,
  titulo: z.string().trim().min(1, 'informe o título').max(200),
  descricao: z.string().trim().min(1, 'descreva o problema').max(50_000),
});
export type NovoProblema = z.infer<typeof novoProblemaSchema>;

export const decisaoSchema = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('aprovar'), comentario: z.string().max(10_000).default('') }),
  z.object({ acao: z.literal('devolver'), comentario: z.string().trim().min(1, 'diga o que mudar').max(10_000) }),
  z.object({ acao: z.literal('responder'), respostas: z.array(z.string().max(10_000)).min(1) }),
]);
export type Decisao = z.input<typeof decisaoSchema>;

export const acaoProblemaSchema = z.object({
  acao: z.enum(['pausar', 'retomar', 'cancelar', 'tentar_de_novo', 'pular_etapa', 'cancelar_tarefa', 'concluir_tarefa']),
});
export type AcaoProblema = z.infer<typeof acaoProblemaSchema>['acao'];

export const limitesSchema = z.object({
  global: z.number().int().min(1).max(20),
  porProvedor: z.number().int().min(1).max(20),
  cotaMaxima: z.number().int().min(1).max(100).nullable().default(95),
});
