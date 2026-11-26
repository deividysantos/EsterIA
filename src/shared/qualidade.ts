import type { IdProvedor } from './provedores.js';

/** Desempenho de um modelo como executor. */
export interface QualidadeExecutor {
  modeloId: number;
  nome: string;
  provedor: IdProvedor;
  familia: string;
  /** Tarefas em que o modelo fez a primeira execução. */
  tarefas: number;
  tarefasConcluidas: number;
  /** Tarefas com revisão que passaram de primeira. */
  aprovadasDePrimeira: number;
  tarefasRevisadas: number;
  /** Execuções por tarefa (1 = sem retrabalho). */
  tentativasMedias: number | null;
  /** Pontos apontados por revisores no código dele, por severidade. */
  apontados: { alta: number; media: number; baixa: number };
  custoMedioTarefa: number | null;
}

/** Desempenho de um modelo como revisor ou crítico. */
export interface QualidadeRevisor {
  modeloId: number;
  nome: string;
  provedor: IdProvedor;
  familia: string;
  pareceres: number;
  reprovacoes: number;
  itens: { alta: number; media: number; baixa: number };
  procede: number;
  naoProcede: number;
  /** procede / (procede + não procede); null sem avaliações. */
  precisao: number | null;
  semAvaliacao: number;
}

export interface QualidadeProblema {
  id: string;
  projeto: string;
  numero: number;
  titulo: string;
  estado: string;
  tarefas: number;
  execucoes: number;
  retrabalhos: number;
  custoUsd: number;
  duracaoMs: number | null;
}

export interface RelatorioQualidade {
  executores: QualidadeExecutor[];
  revisores: QualidadeRevisor[];
  problemas: QualidadeProblema[];
}

export interface PontoCota {
  provedor: IdProvedor;
  janela: string;
  utilizacao: number;
  capturadoEm: string;
}

/** O que cada CLI informa de cota, para a tela deixar claro o que é medido. */
export const FONTE_COTA: Record<IdProvedor, string> = {
  claude: 'Lido dos eventos rate_limit_event que o Claude Code envia durante cada run.',
  codex: 'Lido das sessões locais do Codex (~/.codex/sessions), quando existem. Formato não oficial.',
  cursor: 'O Cursor não informa cota pelo CLI: só o consumo medido aparece aqui.',
  antigravity: 'O Antigravity não informa cota pelo CLI: só o consumo medido aparece aqui.',
};
