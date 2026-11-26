import { z } from 'zod';

/**
 * Esteira: a sequência de etapas que um problema percorre. As etapas de escopo `tarefa` formam um bloco
 * contíguo que roda uma vez para cada tarefa do plano; as de escopo `problema` rodam uma vez, antes ou
 * depois desse bloco. O motor (F4) executa exatamente esta definição.
 */

export const TIPOS_ETAPA = [
  'planejar',
  'criticar_plano',
  'aprovacao_humana',
  'executar',
  'revisar',
  'comando',
  'commit',
  'prompt_livre',
] as const;
export type TipoEtapa = (typeof TIPOS_ETAPA)[number];

export const ESCOPOS = ['problema', 'tarefa'] as const;
export type Escopo = (typeof ESCOPOS)[number];

export const SAIDAS = ['texto', 'plano', 'parecer', 'resumo_execucao'] as const;
export type Saida = (typeof SAIDAS)[number];

export const ACOES_FALHA = ['bloquear', 'voltar', 'continuar'] as const;
export type AcaoFalha = (typeof ACOES_FALHA)[number];

export const CONDICOES = ['sempre', 'se_revisao_independente'] as const;
export type Condicao = (typeof CONDICOES)[number];

export interface MetaTipo {
  rotulo: string;
  descricao: string;
  usaAgente: boolean;
  escopos: readonly Escopo[];
  /** Acesso obrigatório (leitura para quem só opina). */
  acessoFixo?: 'leitura' | 'escrita';
  saidas: readonly Saida[];
  /** O que conta como falha desta etapa. */
  falhaQuando: string;
}

export const META_TIPOS: Record<TipoEtapa, MetaTipo> = {
  planejar: {
    rotulo: 'Planejar',
    descricao: 'O orquestrador lê o problema, pode fazer perguntas e devolve o plano com as tarefas e o executor de cada uma.',
    usaAgente: true,
    escopos: ['problema'],
    acessoFixo: 'leitura',
    saidas: ['plano'],
    falhaQuando: 'o agente falha ou não devolve um plano válido',
  },
  criticar_plano: {
    rotulo: 'Criticar o plano',
    descricao: 'Outro modelo procura furos, dependências erradas e critérios vagos no plano.',
    usaAgente: true,
    escopos: ['problema'],
    acessoFixo: 'leitura',
    saidas: ['parecer'],
    falhaQuando: 'o parecer reprova o plano',
  },
  aprovacao_humana: {
    rotulo: 'Aprovação humana',
    descricao: 'A esteira para e espera você aprovar ou devolver no painel.',
    usaAgente: false,
    escopos: ['problema', 'tarefa'],
    saidas: ['texto'],
    falhaQuando: 'você devolve em vez de aprovar',
  },
  executar: {
    rotulo: 'Executar',
    descricao: 'Um executor implementa a tarefa.',
    usaAgente: true,
    escopos: ['tarefa', 'problema'],
    saidas: ['resumo_execucao'],
    falhaQuando: 'o CLI falha',
  },
  revisar: {
    rotulo: 'Revisar',
    descricao: 'Um revisor lê requisitos e diff e devolve um parecer. Sempre só leitura.',
    usaAgente: true,
    escopos: ['tarefa', 'problema'],
    acessoFixo: 'leitura',
    saidas: ['parecer'],
    falhaQuando: 'o parecer reprova',
  },
  comando: {
    rotulo: 'Comando',
    descricao: 'Roda um comando na pasta do projeto (testes, lint, build).',
    usaAgente: false,
    escopos: ['tarefa', 'problema'],
    saidas: ['texto'],
    falhaQuando: 'o comando termina com código diferente de 0',
  },
  commit: {
    rotulo: 'Commit',
    descricao: 'Faz o commit só dos arquivos da tarefa. Em pasta sem git, guarda uma cópia dos arquivos aprovados.',
    usaAgente: false,
    escopos: ['tarefa', 'problema'],
    saidas: ['texto'],
    falhaQuando: 'o git recusa o commit',
  },
  prompt_livre: {
    rotulo: 'Etapa livre',
    descricao: 'Qualquer etapa nova: um agente com o prompt que você escrever (ex.: QA de segurança, documentação).',
    usaAgente: true,
    escopos: ['tarefa', 'problema'],
    saidas: ['texto', 'parecer'],
    falhaQuando: 'o CLI falha ou, com saída parecer, o parecer reprova',
  },
};

export const ROTULO_SAIDA: Record<Saida, string> = {
  texto: 'Texto livre',
  plano: 'Plano (problema + tarefas)',
  parecer: 'Parecer (aprovado + problemas)',
  resumo_execucao: 'Resumo da execução (arquivos, o que foi feito, dúvidas)',
};

/** Variáveis aceitas nos prompts, com o escopo em que existem. */
export const VARIAVEIS: readonly { nome: string; descricao: string; escopo: Escopo | 'ambos' }[] = [
  { nome: 'projeto.nome', descricao: 'Nome do projeto', escopo: 'ambos' },
  { nome: 'projeto.raiz', descricao: 'Pasta raiz do projeto', escopo: 'ambos' },
  { nome: 'problema.titulo', descricao: 'Título do problema', escopo: 'ambos' },
  { nome: 'problema.descricao', descricao: 'Descrição escrita por você', escopo: 'ambos' },
  { nome: 'problema.respostas', descricao: 'Perguntas do orquestrador e suas respostas', escopo: 'ambos' },
  { nome: 'plano', descricao: 'Plano aprovado (markdown)', escopo: 'ambos' },
  { nome: 'tarefas', descricao: 'Lista de tarefas com status', escopo: 'ambos' },
  { nome: 'modelos', descricao: 'Catálogo de modelos disponíveis com atributos e métricas', escopo: 'problema' },
  { nome: 'tarefa.codigo', descricao: 'Código da tarefa (ex.: T1)', escopo: 'tarefa' },
  { nome: 'tarefa.titulo', descricao: 'Título da tarefa', escopo: 'tarefa' },
  { nome: 'tarefa.descricao', descricao: 'O que fazer, o que não mexer e critério de aceite', escopo: 'tarefa' },
  { nome: 'tentativa', descricao: 'Número da tentativa atual', escopo: 'ambos' },
  { nome: 'feedback', descricao: 'Motivo da volta: parecer reprovado, testes falhando ou devolução sua', escopo: 'ambos' },
  { nome: 'diff', descricao: 'Diff dos arquivos alterados na tarefa', escopo: 'tarefa' },
  { nome: 'saida_anterior', descricao: 'Saída da etapa anterior', escopo: 'ambos' },
];

const idEtapaSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'id: minúsculas, dígitos, hífen ou sublinhado');

export const agenteSchema = z.discriminatedUnion('modo', [
  z.object({ modo: z.literal('fixo'), modeloId: z.number().int().positive() }),
  z.object({
    modo: z.literal('orquestrador'),
    /** Papel na escolha do orquestrador (executor, revisor…); aparece para ele no plano. */
    papel: z.string().trim().min(1).max(40),
    /** Modelos que podem ser escolhidos; vazio = todos os ativos de provedores habilitados. */
    candidatos: z.array(z.number().int().positive()).max(100),
    /** O modelo escolhido precisa ser de família diferente do que rodou esta etapa (revisão cruzada). */
    familiaDiferenteDe: idEtapaSchema.nullable(),
  }),
]);
export type Agente = z.infer<typeof agenteSchema>;

export const etapaSchema = z.object({
  id: idEtapaSchema,
  nome: z.string().trim().min(1, 'informe o nome').max(80),
  tipo: z.enum(TIPOS_ETAPA),
  escopo: z.enum(ESCOPOS),
  ativa: z.boolean(),
  condicao: z.enum(CONDICOES),
  agente: agenteSchema.nullable(),
  /** A partir da tentativa N, usa outro modelo (ex.: high → xhigh). */
  escalar: z.object({ aPartirDaTentativa: z.number().int().min(2).max(10), modeloId: z.number().int().positive() }).nullable(),
  acesso: z.enum(['leitura', 'escrita']),
  prompt: z.string().max(50_000),
  saida: z.enum(SAIDAS),
  comando: z.string().max(2000),
  falha: z.object({
    acao: z.enum(ACOES_FALHA),
    voltarPara: idEtapaSchema.nullable(),
    /** Quantas vezes o ciclo pode rodar antes de bloquear e chamar você. */
    maxTentativas: z.number().int().min(1).max(10),
  }),
  timeoutMin: z.number().int().min(1).max(24 * 60).nullable(),
});
export type Etapa = z.infer<typeof etapaSchema>;

export const definicaoSchema = z.object({
  etapas: z.array(etapaSchema).min(1, 'a esteira precisa de ao menos uma etapa').max(40),
});
export type Definicao = z.infer<typeof definicaoSchema>;

export interface Problema {
  etapa: string | null;
  campo: string | null;
  mensagem: string;
}

export interface ResultadoValidacao {
  erros: Problema[];
  avisos: Problema[];
}

export interface ModeloRef {
  id: number;
  nome: string;
  familia: string;
  ativo: boolean;
  /** Provedor habilitado agora; só gera aviso (o CLI pode ser instalado depois). */
  disponivel: boolean;
}

const RE_VAR = /\{\{\s*([a-z_.]+)\s*\}\}/g;

export function variaveisDoPrompt(prompt: string): string[] {
  return [...prompt.matchAll(RE_VAR)].map((m) => m[1]!);
}

/**
 * Regras que o schema sozinho não expressa. Roda igual no servidor (ao salvar) e no editor (ao vivo).
 */
export function validarEsteira(def: Definicao, modelos: readonly ModeloRef[]): ResultadoValidacao {
  const erros: Problema[] = [];
  const avisos: Problema[] = [];
  const erro = (etapa: string | null, campo: string | null, mensagem: string) => erros.push({ etapa, campo, mensagem });
  const aviso = (etapa: string | null, campo: string | null, mensagem: string) => avisos.push({ etapa, campo, mensagem });
  const porId = new Map<string, number>();
  const modelosPorId = new Map(modelos.map((m) => [m.id, m]));

  def.etapas.forEach((e, i) => {
    if (porId.has(e.id)) erro(e.id, 'id', `Id "${e.id}" repetido.`);
    porId.set(e.id, i);
  });

  // Etapas de tarefa formam um bloco só, para o "para cada tarefa" ter começo e fim claros.
  const idxTarefa = def.etapas.flatMap((e, i) => (e.escopo === 'tarefa' ? [i] : []));
  if (idxTarefa.length && idxTarefa.at(-1)! - idxTarefa[0]! + 1 !== idxTarefa.length) {
    erro(null, null, 'As etapas por tarefa precisam ficar juntas, sem etapas do problema no meio.');
  }

  const ativas = def.etapas.filter((e) => e.ativa);
  if (!ativas.length) erro(null, null, 'Nenhuma etapa ativa.');
  const planejar = ativas.filter((e) => e.tipo === 'planejar');
  if (planejar.length > 1) erro(null, null, 'Só pode haver uma etapa ativa de planejamento.');
  if (idxTarefa.some((i) => def.etapas[i]!.ativa)) {
    const primeiraTarefa = idxTarefa[0]!;
    const planoAntes = planejar.some((p) => porId.get(p.id)! < primeiraTarefa);
    if (!planoAntes) erro(null, null, 'As etapas por tarefa precisam de uma etapa de planejamento antes delas (é ela que cria as tarefas).');
  }

  def.etapas.forEach((e, i) => {
    const meta = META_TIPOS[e.tipo];
    const rot = e.nome || e.id;
    if (!meta.escopos.includes(e.escopo)) erro(e.id, 'escopo', `${rot}: o tipo ${meta.rotulo} não roda por ${e.escopo}.`);
    if (meta.acessoFixo && e.acesso !== meta.acessoFixo) erro(e.id, 'acesso', `${rot}: ${meta.rotulo} só roda em modo ${meta.acessoFixo}.`);
    if (!meta.saidas.includes(e.saida)) erro(e.id, 'saida', `${rot}: saída "${ROTULO_SAIDA[e.saida]}" não vale para ${meta.rotulo}.`);
    if (e.condicao === 'se_revisao_independente' && e.escopo !== 'tarefa') {
      erro(e.id, 'condicao', `${rot}: a condição "se a tarefa pedir revisão" só vale por tarefa.`);
    }

    if (meta.usaAgente) {
      if (!e.agente) erro(e.id, 'agente', `${rot}: escolha quem roda esta etapa.`);
      if (!e.prompt.trim()) erro(e.id, 'prompt', `${rot}: o prompt está vazio.`);
    } else if (e.agente) {
      erro(e.id, 'agente', `${rot}: ${meta.rotulo} não usa agente.`);
    }

    const conferirModelo = (id: number, campo: string) => {
      const m = modelosPorId.get(id);
      if (!m) erro(e.id, campo, `${rot}: modelo ${id} não existe mais.`);
      else if (!m.ativo) aviso(e.id, campo, `${rot}: o modelo ${m.nome} está desativado.`);
      else if (!m.disponivel) aviso(e.id, campo, `${rot}: o provedor do modelo ${m.nome} não está habilitado nesta máquina.`);
      return m;
    };

    if (e.agente?.modo === 'fixo') conferirModelo(e.agente.modeloId, 'agente');
    if (e.agente?.modo === 'orquestrador') {
      e.agente.candidatos.forEach((c) => conferirModelo(c, 'agente'));
      const ref = e.agente.familiaDiferenteDe;
      if (ref !== null) {
        const j = porId.get(ref);
        if (j === undefined) erro(e.id, 'agente', `${rot}: a etapa "${ref}" da revisão cruzada não existe.`);
        else if (j >= i) erro(e.id, 'agente', `${rot}: a revisão cruzada precisa apontar para uma etapa anterior.`);
        else if (!META_TIPOS[def.etapas[j]!.tipo].usaAgente) erro(e.id, 'agente', `${rot}: "${ref}" não usa agente.`);
      }
      if (planejar.length === 0) erro(e.id, 'agente', `${rot}: a escolha pelo orquestrador precisa de uma etapa de planejamento.`);
    }
    if (e.escalar) {
      if (!meta.usaAgente) erro(e.id, 'escalar', `${rot}: só etapas com agente podem trocar de modelo.`);
      conferirModelo(e.escalar.modeloId, 'escalar');
      if (e.escalar.aPartirDaTentativa > e.falha.maxTentativas) {
        aviso(e.id, 'escalar', `${rot}: a troca de modelo na tentativa ${e.escalar.aPartirDaTentativa} nunca acontece (máximo ${e.falha.maxTentativas}).`);
      }
    }

    if (e.tipo === 'comando' && !e.comando.trim()) erro(e.id, 'comando', `${rot}: informe o comando.`);

    if (e.falha.acao === 'voltar') {
      const alvo = e.falha.voltarPara;
      const j = alvo === null ? undefined : porId.get(alvo);
      if (alvo === null) erro(e.id, 'falha', `${rot}: escolha para qual etapa voltar.`);
      else if (j === undefined) erro(e.id, 'falha', `${rot}: a etapa "${alvo}" não existe.`);
      else if (j > i) erro(e.id, 'falha', `${rot}: só dá para voltar para esta etapa ou uma anterior.`);
      else if (def.etapas[j]!.escopo !== e.escopo) erro(e.id, 'falha', `${rot}: a volta precisa ficar no mesmo escopo (${e.escopo}).`);
      else if (!def.etapas[j]!.ativa) erro(e.id, 'falha', `${rot}: a etapa "${alvo}" está desativada.`);
    }

    const permitidas = new Set(VARIAVEIS.filter((v) => v.escopo === 'ambos' || v.escopo === e.escopo).map((v) => v.nome));
    const todas = new Set(VARIAVEIS.map((v) => v.nome));
    for (const v of new Set(variaveisDoPrompt(e.prompt))) {
      if (!todas.has(v)) aviso(e.id, 'prompt', `${rot}: variável {{${v}}} desconhecida; fica como está no prompt.`);
      else if (!permitidas.has(v)) aviso(e.id, 'prompt', `${rot}: {{${v}}} não existe em etapa por ${e.escopo}; vira texto vazio.`);
    }
  });

  return { erros, avisos };
}

/** Etapa nova com valores coerentes para o tipo. */
export function etapaNova(tipo: TipoEtapa, idsUsados: ReadonlySet<string>, escopo?: Escopo): Etapa {
  const meta = META_TIPOS[tipo];
  let id: string = tipo.replace(/_/g, '-');
  for (let n = 2; idsUsados.has(id); n++) id = `${tipo.replace(/_/g, '-')}-${n}`;
  return {
    id,
    nome: meta.rotulo,
    tipo,
    escopo: escopo && meta.escopos.includes(escopo) ? escopo : meta.escopos[0]!,
    ativa: true,
    condicao: 'sempre',
    agente: meta.usaAgente ? { modo: 'orquestrador', papel: tipo === 'revisar' ? 'revisor' : 'executor', candidatos: [], familiaDiferenteDe: null } : null,
    escalar: null,
    acesso: meta.acessoFixo ?? (tipo === 'executar' ? 'escrita' : 'leitura'),
    prompt: '',
    saida: meta.saidas[0]!,
    comando: '',
    falha: { acao: 'bloquear', voltarPara: null, maxTentativas: 3 },
    timeoutMin: null,
  };
}

export interface VersaoResumo {
  n: number;
  nota: string;
  criadoEm: string;
}

export interface EsteiraProjeto {
  projeto: string;
  versaoAtual: number;
  definicao: Definicao;
  versoes: VersaoResumo[];
  atualizadoEm: string;
}

export const salvarEsteiraSchema = z.object({
  definicao: definicaoSchema,
  nota: z.string().trim().max(500).default(''),
  /** Versão em que a edição começou; se outra versão foi salva no meio, o servidor recusa. */
  versaoBase: z.number().int().min(1),
});
export type SalvarEsteira = z.input<typeof salvarEsteiraSchema>;

export const criarEsteiraSchema = z.object({
  origem: z.union([z.literal('padrao'), z.object({ copiarDe: z.string() })]),
});
