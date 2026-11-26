import type { Definicao, Etapa } from '../../shared/esteiras.js';
import type { Modelo } from '../../shared/provedores.js';
import { ErroDominio } from '../erros.js';

/**
 * Esteira padrão: o fluxo do v1 (ORQUESTRADOR.md) como etapas configuráveis.
 * As instruções de formato de cada saída (plano, parecer, resumo) o motor acrescenta sozinho,
 * por isso os prompts aqui falam só do trabalho.
 */

const PROMPT_PLANEJAR = `Você é o orquestrador do projeto {{projeto.nome}} ({{projeto.raiz}}). Você NÃO implementa código: planeja e delega.

## Problema
{{problema.titulo}}

{{problema.descricao}}

{{problema.respostas}}

## O que fazer
1. Leia o código necessário para entender o problema. Se faltar informação que só o usuário tem, devolva perguntas em vez do plano.
2. Divida o trabalho em tarefas pequenas e verificáveis. Em cada tarefa: o que fazer, o que NÃO mexer, critério de aceite e dependências.
3. Escolha o executor de cada tarefa entre os modelos abaixo, com uma justificativa curta. Tarefas com muita regra de negócio e casos de borda vão para quem testa o próprio código; tarefas mecânicas, para os mais rápidos; triviais, para os mais baratos.
4. Diga se cada tarefa precisa de revisão independente (tarefas triviais podem pular).
5. Duas tarefas não podem mexer nos mesmos arquivos ao mesmo tempo: marque a dependência.

## Modelos disponíveis
{{modelos}}

{{feedback}}`;

const PROMPT_CRITICAR = `Critique o plano abaixo para o problema "{{problema.titulo}}". Não edite arquivos nem rode comandos.

Procure: furos (requisito do problema sem tarefa), dependências erradas ou faltando, tarefas grandes demais, critérios de aceite vagos e escolhas de executor sem sentido. Ignore estilo de escrita.

## Problema
{{problema.descricao}}

## Plano
{{plano}}`;

const PROMPT_EXECUTAR = `Você é o executor da tarefa {{tarefa.codigo}} do projeto {{projeto.nome}}.

## Problema (contexto)
{{problema.titulo}}

## Sua tarefa: {{tarefa.codigo}} — {{tarefa.titulo}}
{{tarefa.descricao}}

## Regras
- Mexa só no que a tarefa pede; não altere arquivos de outras tarefas.
- Rode os testes do projeto antes de terminar, se houver.
- Não suba servidores nem encerre processos que você não iniciou.
- Não faça commit: o painel faz depois da revisão.

{{feedback}}`;

const PROMPT_REVISAR = `Revise a implementação da tarefa {{tarefa.codigo}} — {{tarefa.titulo}}. Não edite arquivos nem rode comandos.

## Requisitos da tarefa
{{tarefa.descricao}}

## Diff
{{diff}}

Aponte bugs reais, requisitos não atendidos e riscos. Ignore estilo. Seu parecer é uma sugestão que o orquestrador vai avaliar ponto a ponto.`;

function porCodigo(modelos: readonly Modelo[], codigos: string[]): Modelo[] {
  return codigos.map((c) => modelos.find((m) => m.codigo === c && m.ativo)).filter((m): m is Modelo => !!m);
}

export function esteiraPadrao(modelos: readonly Modelo[]): Definicao {
  const ativos = modelos.filter((m) => m.ativo);
  const planejador = porCodigo(modelos, ['claude-opus-5-5', 'claude-fable-5-2', 'claude-sonnet-5-5'])[0] ?? ativos[0];
  if (!planejador) throw new ErroDominio('VALIDACAO', 'Cadastre ao menos um modelo ativo antes de criar a esteira.');
  const critico = porCodigo(modelos, ['gemini-4-argon-high'])[0] ?? planejador;
  const executores = porCodigo(modelos, ['cursor-grok-4.6-high', 'gemini-4-hydrogen-high', 'cursor-grok-4.6-medium-fast']);
  const revisores = porCodigo(modelos, ['gemini-4-neon-high', 'cursor-grok-4.6-xhigh']);

  const base = {
    ativa: true,
    condicao: 'sempre',
    escalar: null,
    comando: '',
    timeoutMin: null,
  } as const;

  const etapas: Etapa[] = [
    {
      ...base,
      id: 'planejar',
      nome: 'Planejar',
      tipo: 'planejar',
      escopo: 'problema',
      agente: { modo: 'fixo', modeloId: planejador.id },
      acesso: 'leitura',
      prompt: PROMPT_PLANEJAR,
      saida: 'plano',
      falha: { acao: 'bloquear', voltarPara: null, maxTentativas: 2 },
    },
    {
      ...base,
      id: 'criticar-plano',
      nome: 'Crítica do plano',
      tipo: 'criticar_plano',
      escopo: 'problema',
      ativa: false,
      agente: { modo: 'fixo', modeloId: critico.id },
      acesso: 'leitura',
      prompt: PROMPT_CRITICAR,
      saida: 'parecer',
      falha: { acao: 'voltar', voltarPara: 'planejar', maxTentativas: 2 },
    },
    {
      ...base,
      id: 'aprovar-plano',
      nome: 'Aprovar o plano',
      tipo: 'aprovacao_humana',
      escopo: 'problema',
      agente: null,
      acesso: 'leitura',
      prompt: 'Confira o plano e as escolhas de executor. Devolver volta para o planejamento com o seu comentário.',
      saida: 'texto',
      falha: { acao: 'voltar', voltarPara: 'planejar', maxTentativas: 5 },
    },
    {
      ...base,
      id: 'executar',
      nome: 'Executar',
      tipo: 'executar',
      escopo: 'tarefa',
      agente: { modo: 'orquestrador', papel: 'executor', candidatos: executores.map((m) => m.id), familiaDiferenteDe: null },
      acesso: 'escrita',
      prompt: PROMPT_EXECUTAR,
      saida: 'resumo_execucao',
      falha: { acao: 'bloquear', voltarPara: null, maxTentativas: 3 },
    },
    {
      ...base,
      id: 'testes',
      nome: 'Testes',
      tipo: 'comando',
      escopo: 'tarefa',
      ativa: false,
      agente: null,
      acesso: 'leitura',
      prompt: '',
      saida: 'texto',
      comando: 'npm test',
      falha: { acao: 'voltar', voltarPara: 'executar', maxTentativas: 3 },
      timeoutMin: 30,
    },
    {
      ...base,
      id: 'revisar',
      nome: 'Revisão cruzada',
      tipo: 'revisar',
      escopo: 'tarefa',
      condicao: 'se_revisao_independente',
      agente: { modo: 'orquestrador', papel: 'revisor', candidatos: revisores.map((m) => m.id), familiaDiferenteDe: 'executar' },
      acesso: 'leitura',
      prompt: PROMPT_REVISAR,
      saida: 'parecer',
      falha: { acao: 'voltar', voltarPara: 'executar', maxTentativas: 3 },
    },
    {
      ...base,
      id: 'commit',
      nome: 'Commit',
      tipo: 'commit',
      escopo: 'tarefa',
      agente: null,
      acesso: 'escrita',
      prompt: '{{tarefa.codigo}}: {{tarefa.titulo}}',
      saida: 'texto',
      falha: { acao: 'bloquear', voltarPara: null, maxTentativas: 1 },
    },
  ];
  return { etapas };
}
