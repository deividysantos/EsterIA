import type { IdProvedor } from '../../shared/provedores.js';
import type { Modo, TipoEvento, Usage } from '../../shared/runs.js';

export interface OpcoesComando {
  prompt: string;
  modelo: string;
  modo: Modo;
  /** Id da sessão/conversa a retomar. */
  sessao: string | null;
  /** Arquivo com JSON Schema da resposta (só nos CLIs que aceitam). */
  jsonSchemaArquivo?: string | null;
}

export interface ComandoMontado {
  args: string[];
  /** Texto enviado pela entrada padrão (null = fecha a entrada sem enviar nada). */
  stdin: string | null;
}

export interface EventoLido {
  tipo: TipoEvento;
  resumo: string;
  texto?: string | null;
  bruto?: unknown;
}

export interface LimiteLido {
  janela: string;
  utilizacao: number | null;
  status: string | null;
  reiniciaEm: string | null;
}

/** Estado acumulado durante a leitura do stream de um run. */
export class EstadoLeitura {
  sessao: string | null = null;
  modelo: string | null = null;
  usage: Usage = { entrada: null, saida: null, cacheLeitura: null, cacheEscrita: null, raciocinio: null };
  custoUsd: number | null = null;
  resultado: string | null = null;
  ultimaMensagem: string | null = null;
  estruturada: unknown = undefined;
  /** null = o CLI não disse; o executor decide pelo código de saída. */
  sucesso: boolean | null = null;
  erro: string | null = null;
  numTurnos: number | null = null;
  mensagens = 0;
  ferramentas = 0;
  arquivos = new Set<string>();
  /** Limites lidos desde a última vez que o executor esvaziou a lista. */
  limites: LimiteLido[] = [];

  somarUsage(parcial: Partial<Usage>) {
    for (const k of Object.keys(parcial) as (keyof Usage)[]) {
      const v = parcial[k];
      if (typeof v === 'number' && Number.isFinite(v)) this.usage[k] = (this.usage[k] ?? 0) + v;
    }
  }

  definirUsage(total: Partial<Usage>) {
    for (const k of Object.keys(total) as (keyof Usage)[]) {
      const v = total[k];
      this.usage[k] = typeof v === 'number' && Number.isFinite(v) ? v : this.usage[k];
    }
  }
}

export interface Leitor {
  estado: EstadoLeitura;
  /** Uma linha JSON do stdout. */
  linha(obj: Record<string, unknown>): EventoLido[];
  /** Linha de stdout que não é JSON. */
  texto(linha: string): EventoLido[];
  /** Fim do processo: esvazia buffers (texto em montagem etc.). */
  finalizar(): EventoLido[];
}

export interface Adaptador {
  id: IdProvedor;
  montarComando(o: OpcoesComando): ComandoMontado;
  criarLeitor(): Leitor;
}
