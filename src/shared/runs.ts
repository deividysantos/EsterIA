import { z } from 'zod';

import { idProjetoSchema } from './projetos.js';
import type { IdProvedor } from './provedores.js';

export const MODOS = ['leitura', 'escrita'] as const;
export type Modo = (typeof MODOS)[number];

export type EstadoRun = 'rodando' | 'concluido' | 'falhou' | 'cancelado' | 'interrompido';

/** Tipos de evento normalizados, iguais para todos os CLIs. */
export type TipoEvento =
  | 'inicio'
  | 'mensagem'
  | 'raciocinio'
  | 'ferramenta'
  | 'resultado_ferramenta'
  | 'resultado'
  | 'erro'
  | 'limite'
  | 'outro';

export interface Usage {
  entrada: number | null;
  saida: number | null;
  cacheLeitura: number | null;
  cacheEscrita: number | null;
  /** Já incluído em `saida` nos CLIs que conhecemos; informativo. */
  raciocinio: number | null;
}

export interface Run {
  id: string;
  projeto: string | null;
  provedor: IdProvedor;
  modeloId: number | null;
  modeloCodigo: string;
  modeloNome: string;
  familia: string;
  papel: string;
  modo: Modo;
  cwd: string;
  prompt: string;
  comando: string[];
  sessaoRetomada: string | null;
  sessao: string | null;
  modeloReportado: string | null;
  pid: number | null;
  estado: EstadoRun;
  codigoSaida: number | null;
  erro: string | null;
  inicio: string;
  fim: string | null;
  duracaoMs: number | null;
  usage: Usage;
  numTurnos: number | null;
  custoUsd: number | null;
  custoOrigem: 'cli' | 'estimado' | null;
  resultadoTexto: string | null;
  saidaEstruturada: unknown;
  contagemMensagens: number;
  contagemFerramentas: number;
  arquivos: string[];
}

export interface Evento {
  runId: string;
  seq: number;
  ts: string;
  tipo: TipoEvento;
  resumo: string;
  texto: string | null;
}

export interface DetalheRun {
  run: Run;
  eventos: Evento[];
  stderr: string;
  stderrTruncado: boolean;
}

export const novoRunSchema = z
  .object({
    modeloId: z.number().int().positive(),
    projeto: idProjetoSchema.nullable().default(null),
    /** Pasta de trabalho; obrigatória quando não há projeto (com projeto, o padrão é a raiz dele). */
    cwd: z.string().trim().min(1).nullable().default(null),
    modo: z.enum(MODOS),
    prompt: z.string().min(1, 'escreva o prompt').max(500_000),
    sessao: z.string().trim().min(1).max(200).nullable().default(null),
    timeoutMin: z.number().int().min(1).max(24 * 60).nullable().default(null),
  })
  .refine((v) => v.projeto !== null || v.cwd !== null, { message: 'informe o projeto ou a pasta', path: ['cwd'] });
export type NovoRun = z.input<typeof novoRunSchema>;
export type NovoRunValidado = z.output<typeof novoRunSchema>;

export interface LinhaUsage {
  provedor: IdProvedor;
  modeloCodigo: string;
  modeloNome: string;
  familia: string;
  runs: number;
  concluidos: number;
  falhos: number;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  raciocinio: number;
  custoUsd: number;
  /** Runs sem custo (CLI não informou e o modelo não tem preço). */
  semCusto: number;
  duracaoMediaMs: number | null;
}

export interface DiaUsage {
  dia: string;
  runs: number;
  custoUsd: number;
  tokens: number;
}

export interface LimiteAtual {
  provedor: IdProvedor;
  janela: string;
  utilizacao: number | null;
  status: string | null;
  reiniciaEm: string | null;
  capturadoEm: string;
}

export interface RelatorioUsage {
  desde: string | null;
  porModelo: LinhaUsage[];
  porDia: DiaUsage[];
  limites: LimiteAtual[];
}

/** Mensagens do canal ao vivo (`/api/ao-vivo`). */
export type MensagemAoVivo =
  | { tipo: 'run'; run: Run }
  | { tipo: 'evento'; evento: Evento };
