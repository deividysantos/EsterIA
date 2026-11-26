import readline from 'node:readline';

import type { DetalheProblema, EstadoFila, ResumoProblema } from '../shared/problemas.js';
import type { Projeto } from '../shared/projetos.js';
import type { DetalheRun } from '../shared/runs.js';
import { VERSAO } from '../server/versao.js';
import { api, erroDaApi, projetoDaPasta, urlPainel } from './comum.js';

/**
 * Servidor MCP (JSON-RPC 2.0 por stdio, uma mensagem por linha) para uma sessão de agente criar e
 * acompanhar problemas no painel. Cliente fino da API: o serviço precisa estar no ar.
 */

const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Ferramenta {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export const FERRAMENTAS: Ferramenta[] = [
  { name: 'listar_projetos', description: 'Lista os projetos cadastrados no painel.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'criar_problema',
    description:
      'Cria um problema na esteira de agentes do projeto (planejamento, execução, revisão e commit feitos pelo painel). Sem "projeto", usa o projeto da pasta atual.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto.' },
        descricao: { type: 'string', description: 'O que precisa ser feito, com contexto, restrições e critério de aceite.' },
        projeto: { type: 'string', description: 'Id do projeto (opcional).' },
      },
      required: ['titulo', 'descricao'],
    },
  },
  {
    name: 'listar_problemas',
    description: 'Lista problemas, opcionalmente de um projeto e/ou estado (em_andamento, aguardando, bloqueado, pausado, concluido, cancelado).',
    inputSchema: { type: 'object', properties: { projeto: { type: 'string' }, estado: { type: 'string' } } },
  },
  {
    name: 'ver_problema',
    description: 'Mostra o estado de um problema: o que espera de você (perguntas ou aprovação), motivo de bloqueio, tarefas e últimas execuções.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'decidir',
    description:
      'Responde a uma etapa que espera o usuário: "responder" (perguntas do planejador, uma resposta por pergunta), "aprovar" ou "devolver" (com comentário). Só faça isso com o aval do usuário.',
    inputSchema: {
      type: 'object',
      properties: {
        execucao_id: { type: 'number' },
        acao: { type: 'string', enum: ['aprovar', 'devolver', 'responder'] },
        comentario: { type: 'string' },
        respostas: { type: 'array', items: { type: 'string' } },
      },
      required: ['execucao_id', 'acao'],
    },
  },
  {
    name: 'acao_problema',
    description: 'Pausar, retomar, cancelar ou desbloquear (tentar_de_novo, pular_etapa, cancelar_tarefa, concluir_tarefa) um problema.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        acao: { type: 'string', enum: ['pausar', 'retomar', 'cancelar', 'tentar_de_novo', 'pular_etapa', 'cancelar_tarefa', 'concluir_tarefa'] },
      },
      required: ['id', 'acao'],
    },
  },
  { name: 'estado_fila', description: 'O que está rodando, o que espera o usuário e o que travou, em todos os projetos.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'ver_run',
    description: 'Detalhe de um run de agente: estado, modelo, tokens, custo, resultado e últimos eventos.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

class ErroFerramenta extends Error {}

function linhaProblema(p: ResumoProblema): string {
  const espera = p.esperando ? ` · esperando: ${p.esperando.etapaNome} (execucao_id ${p.esperando.execucaoId})` : '';
  return `- ${p.id} · ${p.projeto} #${p.numero} "${p.titulo}" · ${p.estado} · tarefas ${p.tarefasConcluidas}/${p.tarefasTotal} · US$ ${p.custoUsd.toFixed(4)}${espera}`;
}

function textoProblema(d: DetalheProblema, url: string): string {
  const p = d.problema;
  const partes = [`${p.projeto} #${p.numero} "${p.titulo}" — ${p.estado} (esteira v${p.esteiraVersao})`, `Painel: ${url}/problemas/${p.id}`];
  if (p.motivo && p.estado === 'bloqueado') partes.push(`Bloqueado: ${p.motivo}`);
  if (p.esperando) {
    const exec = d.execucoes.find((e) => e.id === p.esperando!.execucaoId);
    if (p.esperando.espera === 'perguntas') {
      const perguntas = ((exec?.saida as { perguntas?: string[] } | null)?.perguntas ?? []).map((q, i) => `  ${i + 1}. ${q}`);
      partes.push(`Esperando respostas (execucao_id ${p.esperando.execucaoId}):`, ...perguntas);
    } else partes.push(`Esperando aprovação de "${p.esperando.etapaNome}" (execucao_id ${p.esperando.execucaoId}).`);
  }
  if (p.plano?.resumo) partes.push(`Plano: ${p.plano.resumo}`);
  if (d.tarefas.length) {
    partes.push('Tarefas:', ...d.tarefas.map((t) => `  - ${t.codigo} ${t.titulo} · ${t.estado}${t.commit ? ` · commit ${t.commit.slice(0, 10)}` : ''}${t.motivo ? ` · ${t.motivo}` : ''}`));
  }
  const ultimas = d.execucoes.slice(-8);
  if (ultimas.length) {
    partes.push(
      'Últimas execuções:',
      ...ultimas.map(
        (e) => `  - ${e.etapaNome}${e.tarefaCodigo ? ` ${e.tarefaCodigo}` : ''} #${e.tentativa} · ${e.estado}${e.modeloNome ? ` · ${e.modeloNome}` : ''}${e.erro ? ` · ${e.erro}` : ''}`
      )
    );
  }
  return partes.join('\n');
}

export interface OpcoesMcp {
  url?: string;
  cwd?: string;
  fetchImpl?: typeof fetch;
}

export function criarServidorMcp(o: OpcoesMcp = {}) {
  const url = o.url ?? urlPainel();
  const cwd = o.cwd ?? process.cwd();
  const chamar = async <T>(metodo: string, caminho: string, corpo?: unknown, ok = [200, 201]) => {
    const r = await api<T>(metodo, caminho, corpo, { url, fetchImpl: o.fetchImpl ?? fetch });
    if (!ok.includes(r.status)) throw new ErroFerramenta(erroDaApi(r));
    return r.corpo;
  };
  const str = (v: unknown, nome: string) => {
    if (typeof v !== 'string' || !v.trim()) throw new ErroFerramenta(`Parâmetro "${nome}" é obrigatório.`);
    return v.trim();
  };

  const executores: Record<string, (a: Record<string, unknown>) => Promise<string>> = {
    async listar_projetos() {
      const ps = await chamar<Projeto[]>('GET', '/api/projetos');
      const daPasta = projetoDaPasta(cwd, ps);
      return ps.length ? ps.map((p) => `- ${p.id} · ${p.nome} · ${p.raiz}${p.id === daPasta ? ' (pasta atual)' : ''}`).join('\n') : 'Nenhum projeto cadastrado.';
    },
    async criar_problema(a) {
      let projeto = typeof a.projeto === 'string' && a.projeto.trim() ? a.projeto.trim() : null;
      if (!projeto) {
        projeto = projetoDaPasta(cwd, await chamar<Projeto[]>('GET', '/api/projetos'));
        if (!projeto) throw new ErroFerramenta(`A pasta ${cwd} não pertence a nenhum projeto do painel. Rode "painel init" nela ou informe "projeto".`);
      }
      const p = await chamar<ResumoProblema>('POST', '/api/problemas', { projeto, titulo: str(a.titulo, 'titulo'), descricao: str(a.descricao, 'descricao') });
      return `Problema criado: ${p.id} (${p.projeto} #${p.numero}). A esteira já começou.\nAcompanhe com ver_problema ou em ${url}/problemas/${p.id}`;
    },
    async listar_problemas(a) {
      const q = new URLSearchParams();
      if (typeof a.projeto === 'string' && a.projeto) q.set('projeto', a.projeto);
      if (typeof a.estado === 'string' && a.estado) q.set('estado', a.estado);
      const ps = await chamar<ResumoProblema[]>('GET', `/api/problemas${q.size ? `?${q}` : ''}`);
      return ps.length ? ps.map(linhaProblema).join('\n') : 'Nenhum problema.';
    },
    async ver_problema(a) {
      return textoProblema(await chamar<DetalheProblema>('GET', `/api/problemas/${encodeURIComponent(str(a.id, 'id'))}`), url);
    },
    async decidir(a) {
      const id = Number(a.execucao_id);
      if (!Number.isInteger(id) || id <= 0) throw new ErroFerramenta('Parâmetro "execucao_id" inválido.');
      const corpo =
        a.acao === 'responder'
          ? { acao: 'responder', respostas: Array.isArray(a.respostas) ? a.respostas.map(String) : [] }
          : { acao: a.acao, comentario: typeof a.comentario === 'string' ? a.comentario : '' };
      const p = await chamar<ResumoProblema>('POST', `/api/execucoes/${id}/decisao`, corpo);
      return `Feito. Problema agora: ${p.estado}.`;
    },
    async acao_problema(a) {
      const p = await chamar<ResumoProblema>('POST', `/api/problemas/${encodeURIComponent(str(a.id, 'id'))}/acoes`, { acao: a.acao });
      return `Feito. Problema agora: ${p.estado}${p.motivo ? ` (${p.motivo})` : ''}.`;
    },
    async estado_fila() {
      const f = await chamar<EstadoFila>('GET', '/api/fila');
      const item = (i: EstadoFila['rodando'][number]) =>
        `  - ${i.projeto} #${i.problemaNumero} "${i.problemaTitulo}" · ${i.execucao.etapaNome}${i.execucao.tarefaCodigo ? ` ${i.execucao.tarefaCodigo}` : ''} (execucao_id ${i.execucao.id})`;
      return [
        `Rodando (${f.rodando.length}/${f.limites.global}):`,
        ...f.rodando.map(item),
        `Esperando o usuário (${f.aguardandoVoce.length}):`,
        ...f.aguardandoVoce.map(item),
        `Bloqueados (${f.bloqueados.length}):`,
        ...f.bloqueados.map((p) => `  - ${p.id} · ${p.projeto} #${p.numero} "${p.titulo}": ${p.motivo ?? ''}`),
        ...(f.cotas.length ? ['Provedores parados por cota:', ...f.cotas.map((c) => `  - ${c.provedor} ${c.janela} ${Math.round(c.utilizacao * 100)}%`)] : []),
        `Na fila sem vaga: ${f.naFila}`,
      ].join('\n');
    },
    async ver_run(a) {
      const d = await chamar<DetalheRun>('GET', `/api/runs/${encodeURIComponent(str(a.id, 'id'))}`);
      const r = d.run;
      return [
        `${r.modeloNome} · ${r.estado} · ${r.modo} · ${r.cwd}`,
        `Tokens: entrada ${r.usage.entrada ?? '—'}, saída ${r.usage.saida ?? '—'}, cache ${r.usage.cacheLeitura ?? '—'} · custo ${r.custoUsd === null ? '—' : `US$ ${r.custoUsd.toFixed(4)}`}`,
        ...(r.erro ? [`Erro: ${r.erro}`] : []),
        ...(r.resultadoTexto ? [`Resultado:\n${r.resultadoTexto.slice(0, 4000)}`] : []),
        'Últimos eventos:',
        ...d.eventos.slice(-10).map((e) => `  - [${e.tipo}] ${e.resumo}`),
      ].join('\n');
    },
  };

  /** Trata uma mensagem JSON-RPC; devolve a resposta (ou null para notificações). */
  async function tratar(msg: unknown): Promise<object | null> {
    const m = (msg ?? {}) as { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
    const temId = m.id !== undefined && m.id !== null;
    const responder = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
    const erro = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return temId ? erro(-32600, 'Requisição inválida.') : null;
    if (!temId) return null; // notificações (initialized, cancelled…)

    switch (m.method) {
      case 'initialize': {
        const pedido = String(m.params?.protocolVersion ?? '');
        return responder({
          protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'painel-agentes', version: VERSAO },
          instructions:
            'Use criar_problema para delegar trabalho à esteira de agentes do projeto e ver_problema para acompanhar. Responda perguntas ou aprove etapas (decidir) só com o aval do usuário.',
        });
      }
      case 'ping':
        return responder({});
      case 'tools/list':
        return responder({ tools: FERRAMENTAS });
      case 'tools/call': {
        const nome = String(m.params?.name ?? '');
        const exec = executores[nome];
        if (!exec) return erro(-32602, `Ferramenta desconhecida: ${nome}`);
        try {
          const texto = await exec((m.params?.arguments as Record<string, unknown>) ?? {});
          return responder({ content: [{ type: 'text', text: texto }] });
        } catch (err) {
          return responder({ content: [{ type: 'text', text: (err as Error).message }], isError: true });
        }
      }
      default:
        return erro(-32601, `Método não suportado: ${m.method}`);
    }
  }

  return { tratar };
}

/** Laço de stdio: lê uma mensagem por linha e escreve as respostas no stdout (logs só no stderr). */
export async function rodarMcp(o: OpcoesMcp = {}): Promise<number> {
  const { tratar } = criarServidorMcp(o);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pendentes: Promise<void>[] = [];
  for await (const linha of rl) {
    if (!linha.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(linha);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido.' } })}\n`);
      continue;
    }
    pendentes.push(
      tratar(msg).then((r) => {
        if (r) process.stdout.write(`${JSON.stringify(r)}\n`);
      })
    );
  }
  await Promise.allSettled(pendentes);
  return 0;
}
