import type { CandidatoPontuado } from '../../shared/criterios.js';
import type { Etapa, Saida } from '../../shared/esteiras.js';
import { descreverCandidato } from './pontuacao.js';
import type { Plano, Resposta } from '../../shared/problemas.js';
import type { Modelo } from '../../shared/provedores.js';
import type { Projeto } from '../../shared/projetos.js';
import type { ProblemaInterno, TarefaInterna } from '../db/problemas.js';

/** Instruções de formato acrescentadas ao prompt conforme a saída da etapa. */
export const INSTRUCOES_SAIDA: Record<Saida, string> = {
  texto: '',
  plano: `## Formato da resposta
Termine com UM bloco \`\`\`json\`\`\` neste formato (sem texto depois dele):
{
  "perguntas": ["pergunta para o usuário, só se faltar informação essencial; com perguntas, deixe tarefas vazio"],
  "resumo": "parágrafo curto do que será feito",
  "tarefas": [
    {
      "codigo": "T1",
      "titulo": "título curto",
      "descricao": "o que fazer, o que NÃO mexer e critério de aceite",
      "modelos": { "<papel>": "<código do modelo>" },
      "justificativa": "por que esses modelos",
      "revisao_independente": true,
      "depende_de": []
    }
  ]
}
Em "modelos", use os papéis e os códigos listados em "Modelos disponíveis".`,
  parecer: `## Formato da resposta
Não crie plano nem use ferramenta de plano. Termine com UM bloco \`\`\`json\`\`\` neste formato:
{"aprovado": true, "problemas": [{"arquivo": "", "linha": 0, "severidade": "alta|media|baixa", "descricao": "", "sugestao": ""}]}
"aprovado" é false se houver qualquer problema de severidade alta ou requisito não atendido.`,
  resumo_execucao: `## Formato da resposta
Ao terminar, responda com UM bloco \`\`\`json\`\`\`:
{"arquivos_alterados": [], "o_que_foi_feito": "", "duvidas": []}`,
};

/** JSON Schemas para os CLIs com saída estruturada nativa (agy --json-schema, codex --output-schema). */
export const SCHEMAS_JSON: Partial<Record<Saida, object>> = {
  parecer: {
    type: 'object',
    properties: {
      aprovado: { type: 'boolean' },
      problemas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            arquivo: { type: 'string' },
            linha: { type: 'integer' },
            severidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
            descricao: { type: 'string' },
            sugestao: { type: 'string' },
          },
          required: ['arquivo', 'linha', 'severidade', 'descricao', 'sugestao'],
        },
      },
    },
    required: ['aprovado', 'problemas'],
  },
};

/**
 * Catálogo que o planejador recebe em {{modelos}}: os critérios do projeto e, por papel, os candidatos
 * que podem ser usados, do mais bem pontuado para o menos, com atributos e observações.
 */
export function catalogoModelos(
  papeis: { papel: string; etapa: string; candidatos: CandidatoPontuado[]; regra: string | null }[],
  criterios: string,
  modelos: readonly Modelo[] = []
): string {
  if (!papeis.length) return '(nenhuma etapa da esteira pede escolha de modelo)';
  const porId = new Map(modelos.map((m) => [m.id, m]));
  const blocos = papeis.map((p) => {
    const elegiveis = p.candidatos.filter((c) => c.elegivel);
    const linhas = elegiveis.length
      ? elegiveis.map((c) => {
          const m = porId.get(c.modeloId);
          const extra = [m?.tags.length ? `tags: ${m.tags.join(', ')}` : '', m?.observacao ?? ''].filter(Boolean).join(' · ');
          return `- \`${c.codigo}\` — ${c.nome} (família ${c.familia}) · ${descreverCandidato(c)}${extra ? ` · ${extra}` : ''}`;
        })
      : ['- (nenhum candidato disponível agora)'];
    return [`### Papel "${p.papel}" (etapa ${p.etapa})${p.regra ? ` — ${p.regra}` : ''}`, ...linhas].join('\n');
  });
  return [criterios, ...blocos].join('\n\n');
}

export function planoMarkdown(plano: Plano | null): string {
  if (!plano) return '(ainda sem plano)';
  const tarefas = plano.tarefas.map((t) => {
    const mods = Object.entries(t.modelos)
      .map(([p, c]) => `${p}: ${c}`)
      .join(', ');
    return [
      `### ${t.codigo} — ${t.titulo}`,
      t.descricao,
      `- Modelos: ${mods || '—'}${t.justificativa ? ` (${t.justificativa})` : ''}`,
      `- Revisão independente: ${t.revisao_independente ? 'sim' : 'não'}`,
      `- Depende de: ${t.depende_de.join(', ') || '—'}`,
    ].join('\n');
  });
  return [plano.resumo, ...tarefas].filter(Boolean).join('\n\n');
}

export function respostasMarkdown(r: Resposta[]): string {
  if (!r.length) return '';
  return ['## Respostas do usuário', ...r.map((x) => `- **${x.pergunta}**\n  ${x.resposta}`)].join('\n');
}

export interface Contexto {
  projeto: Projeto;
  problema: ProblemaInterno;
  tarefas: TarefaInterna[];
  tarefa: TarefaInterna | null;
  tentativa: number;
  feedback: string | null;
  diff: string;
  saidaAnterior: string;
  modelos: string;
}

export function valoresVariaveis(c: Contexto): Record<string, string> {
  return {
    'projeto.nome': c.projeto.nome,
    'projeto.raiz': c.projeto.raiz,
    'problema.titulo': c.problema.titulo,
    'problema.descricao': c.problema.descricao,
    'problema.respostas': respostasMarkdown(c.problema.respostas),
    plano: planoMarkdown(c.problema.plano),
    tarefas: c.tarefas.map((t) => `- ${t.codigo} — ${t.titulo} [${t.estado}]`).join('\n') || '(sem tarefas)',
    modelos: c.modelos,
    'tarefa.codigo': c.tarefa?.codigo ?? '',
    'tarefa.titulo': c.tarefa?.titulo ?? '',
    'tarefa.descricao': c.tarefa?.descricao ?? '',
    tentativa: String(c.tentativa),
    feedback: c.feedback ? `## Retorno da tentativa anterior (corrija isto)\n${c.feedback}` : '',
    diff: c.diff || '(sem alterações detectadas)',
    saida_anterior: c.saidaAnterior,
  };
}

/** Troca as {{variáveis}}; as desconhecidas ficam como estão. Linhas em branco repetidas são compactadas. */
export function renderizar(modelo: string, valores: Record<string, string>): string {
  const t = modelo.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (inteiro, nome: string) => (nome in valores ? valores[nome]! : inteiro));
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

export function promptCompleto(etapa: Etapa, valores: Record<string, string>): string {
  const corpo = renderizar(etapa.prompt, valores);
  const formato = INSTRUCOES_SAIDA[etapa.saida];
  return formato ? `${corpo}\n\n${formato}` : corpo;
}

/** Prompt curto para retomar a sessão do mesmo agente: só o retorno e o formato. */
export function promptRetomada(etapa: Etapa, valores: Record<string, string>, extra: string): string {
  const partes = [`Tentativa ${valores.tentativa}.`, extra.trim()];
  const formato = INSTRUCOES_SAIDA[etapa.saida];
  if (formato) partes.push(formato);
  return partes.filter(Boolean).join('\n\n');
}
