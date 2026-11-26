import fs from 'node:fs';
import path from 'node:path';

import type { Definicao, Etapa } from '../../shared/esteiras.js';
import {
  parecerSchema,
  planoSchema,
  resumoExecucaoSchema,
  type AcaoProblema,
  type Decisao,
  type EstadoFila,
  type Execucao,
  type ItemFila,
  type LimitesFila,
  type NovoProblema,
  type Parecer,
  type ResumoProblema,
} from '../../shared/problemas.js';
import type { IdProvedor, Modelo } from '../../shared/provedores.js';
import type { Run } from '../../shared/runs.js';
import type { AoVivo } from '../aoVivo.js';
import type { Banco } from '../db/banco.js';
import { obterEsteira, obterVersao } from '../db/esteiras.js';
import { listarModelos, obterModelo } from '../db/modelos.js';
import {
  atualizarExecucao,
  atualizarProblema,
  atualizarTarefa,
  contarExecucoes,
  execucoesEmCurso,
  execucoesOrfas,
  gravarConfig,
  inserirExecucao,
  inserirProblema,
  lerConfig,
  LIMITES_PADRAO,
  listarProblemas,
  listarExecucoes,
  listarProblemasAtivos,
  listarTarefas,
  obterExecucao,
  obterProblema,
  obterTarefa,
  resumoProblema,
  substituirTarefas,
  ultimaExecucao,
  type ProblemaInterno,
  type TarefaInterna,
} from '../db/problemas.js';
import { obterProjeto } from '../db/projetos.js';
import { listarProvedores } from '../db/provedores.js';
import { obterRun } from '../db/runs.js';
import { ErroDominio } from '../erros.js';
import type { Env } from '../provedores/executavel.js';
import type { Executor } from '../runs/executor.js';
import { rodarComando } from './comando.js';
import { arquivosDaTarefa, arquivosAlterados, commitar, diffDosArquivos, raizGit, relativosARaiz } from './git.js';
import { catalogoModelos, promptCompleto, promptRetomada, respostasMarkdown, SCHEMAS_JSON, valoresVariaveis } from './prompts.js';
import { descreverCriterios, pontuar } from './pontuacao.js';
import { aposFalha, blocoTarefas, decidir, type Resultado } from './proximo.js';
import type { CandidatoPontuado, Criterios, OrigemDecisao, PreviaPapel } from '../../shared/criterios.js';
import { metricasMedidas, obterCriterios, registrarDecisao } from '../db/criterios.js';
import { cotasVigentes, gravarItensParecer } from '../db/qualidade.js';

interface Escolha {
  modelo: Modelo;
  motivo: string;
  origem: OrigemDecisao;
  papel: string | null;
  pedido: string | null;
  candidatos: CandidatoPontuado[];
  criterios: Criterios;
}

export interface OpcoesMotor {
  env?: Env;
  /** Pasta onde o motor grava arquivos auxiliares (JSON Schemas). */
  dadosDir: string;
  /** Intervalo do laço de segurança da fila (padrão 5 s). */
  intervaloMs?: number;
}

interface Ativo {
  problema: string;
  projeto: string;
  provedor: IdProvedor | null;
  escrita: boolean;
  cancelar(): void;
}

const RETOMAVEIS = new Set(['planejar', 'executar', 'prompt_livre']);
const CHAVE_LIMITES = 'fila.limites';

function textoParecer(p: Parecer): string {
  if (!p.problemas.length) return 'O parecer reprovou sem listar problemas.';
  return p.problemas
    .map((x) => `- [${x.severidade}] ${x.arquivo}${x.linha ? `:${x.linha}` : ''} — ${x.descricao}${x.sugestao ? ` (sugestão: ${x.sugestao})` : ''}`)
    .join('\n');
}

function cauda(texto: string, n = 4000): string {
  return texto.length > n ? `…\n${texto.slice(-n)}` : texto;
}

export class Motor {
  private readonly ativos = new Map<number, Ativo>();
  private readonly env: Env;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rodandoTick = false;
  private tickDeNovo = false;
  private agendamento: ReturnType<typeof setImmediate> | null = null;
  private parado = false;
  /** Promessas das etapas em andamento (para testes e encerramento). */
  private readonly pendentes = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Banco,
    private readonly executor: Executor,
    private readonly aoVivo: AoVivo,
    private readonly opcoes: OpcoesMotor
  ) {
    this.env = opcoes.env ?? process.env;
  }

  // ---------- ciclo de vida ----------

  /** Recupera o que o serviço deixou pela metade e liga o laço da fila. */
  iniciar() {
    for (const e of execucoesOrfas(this.db)) {
      atualizarExecucao(this.db, e.id, { estado: 'falhou', erro: 'O serviço reiniciou durante a execução.', fim: new Date().toISOString() });
      const p = obterProblema(this.db, e.problema);
      if (p.estado === 'em_andamento' || p.estado === 'aguardando') {
        if (e.tarefaId) atualizarTarefa(this.db, e.tarefaId, { estado: 'bloqueada', motivo: `${e.etapaNome} foi interrompida pelo reinício do serviço.` });
        atualizarProblema(this.db, p.id, { estado: 'bloqueado', motivo: `${e.etapaNome} foi interrompida pelo reinício do serviço. Use “Tentar de novo”.` });
      }
    }
    this.timer = setInterval(() => this.agendar(), this.opcoes.intervaloMs ?? 5000);
    this.timer.unref();
    this.agendar();
  }

  async parar() {
    this.parado = true;
    if (this.timer) clearInterval(this.timer);
    if (this.agendamento) clearImmediate(this.agendamento);
    for (const a of this.ativos.values()) a.cancelar();
    await this.ocioso();
  }

  /** Espera todas as etapas em andamento terminarem (e o que elas dispararem). */
  async ocioso(): Promise<void> {
    for (let i = 0; i < 1000; i++) {
      if (this.rodandoTick || this.agendamento) {
        await new Promise((r) => setTimeout(r, 10));
        continue;
      }
      if (!this.pendentes.size) return;
      await Promise.allSettled([...this.pendentes]);
    }
  }

  agendar() {
    if (this.parado || this.agendamento) return;
    this.agendamento = setImmediate(() => {
      this.agendamento = null;
      void this.tick();
    });
  }

  private rastrear<T>(p: Promise<T>): Promise<T> {
    this.pendentes.add(p);
    void p.finally(() => this.pendentes.delete(p));
    return p;
  }

  private publicar(problema: string) {
    try {
      this.aoVivo.publicar({ tipo: 'problema', problema: resumoProblema(this.db, problema) });
    } catch {
      /* problema removido */
    }
  }

  // ---------- configuração ----------

  limites(): LimitesFila {
    return lerConfig(this.db, CHAVE_LIMITES, LIMITES_PADRAO);
  }

  definirLimites(l: LimitesFila): LimitesFila {
    gravarConfig(this.db, CHAVE_LIMITES, l);
    this.agendar();
    return l;
  }

  // ---------- problemas ----------

  criarProblema(d: NovoProblema): ResumoProblema {
    const projeto = obterProjeto(this.db, d.projeto);
    if (!projeto) throw new ErroDominio('VALIDACAO', `Projeto "${d.projeto}" não encontrado.`);
    if (projeto.arquivadoEm) throw new ErroDominio('VALIDACAO', 'O projeto está arquivado.');
    const esteira = obterEsteira(this.db, d.projeto);
    if (!esteira) throw new ErroDominio('VALIDACAO', 'Configure a esteira do projeto antes de criar problemas.');
    const p = inserirProblema(this.db, { ...d, esteiraVersao: esteira.versaoAtual });
    this.publicar(p.id);
    this.agendar();
    return resumoProblema(this.db, p.id);
  }

  definicao(p: ProblemaInterno): Definicao {
    return obterVersao(this.db, p.projeto, p.esteiraVersao);
  }

  estadoFila(): EstadoFila {
    const item = (e: Execucao): ItemFila => {
      const p = obterProblema(this.db, e.problema);
      return { execucao: e, projeto: p.projeto, problemaTitulo: p.titulo, problemaNumero: p.numero };
    };
    const emCurso = execucoesEmCurso(this.db);
    const comExec = new Set(emCurso.map((e) => e.problema));
    return {
      limites: this.limites(),
      rodando: emCurso.filter((e) => e.estado === 'rodando').map(item),
      aguardandoVoce: emCurso.filter((e) => e.estado === 'aguardando').map(item),
      bloqueados: listarProblemas(this.db, { estado: 'bloqueado' }),
      cotas: (() => {
        const limite = this.limites().cotaMaxima;
        return limite === null ? [] : cotasVigentes(this.db).filter((c) => c.utilizacao * 100 >= limite);
      })(),
      naFila: listarProblemasAtivos(this.db).filter((p) => !comExec.has(p.id)).length,
    };
  }

  // ---------- laço da fila ----------

  async tick() {
    if (this.rodandoTick) {
      this.tickDeNovo = true;
      return;
    }
    this.rodandoTick = true;
    try {
      do {
        this.tickDeNovo = false;
        for (const p of listarProblemasAtivos(this.db)) {
          if (this.parado) return;
          try {
            await this.avancar(p.id);
          } catch (err) {
            console.error(`[motor] problema ${p.id}:`, err);
            atualizarProblema(this.db, p.id, { estado: 'bloqueado', motivo: `Erro interno do motor: ${(err as Error).message}` });
            this.publicar(p.id);
          }
        }
      } while (this.tickDeNovo && !this.parado);
    } finally {
      this.rodandoTick = false;
    }
  }

  private async avancar(id: string) {
    const p = obterProblema(this.db, id);
    if (p.estado !== 'em_andamento') return;
    if (execucoesEmCurso(this.db, id).length) return;

    const def = this.definicao(p);
    const d = decidir(def, p, listarTarefas(this.db, id));
    if (d.problema.fase !== p.fase || d.problema.indice !== p.indice) atualizarProblema(this.db, id, d.problema);
    for (const t of d.tarefas) atualizarTarefa(this.db, t.id, t.mudancas);

    if (d.passo.tipo === 'concluir') {
      atualizarProblema(this.db, id, { estado: 'concluido', fase: 'fim', concluidoEm: new Date().toISOString(), motivo: null });
      this.publicar(id);
      return;
    }
    if (d.passo.tipo === 'bloquear') {
      atualizarProblema(this.db, id, { estado: 'bloqueado', motivo: d.passo.motivo });
      this.publicar(id);
      return;
    }
    if (d.tarefas.length || d.problema.fase !== p.fase || d.problema.indice !== p.indice) this.publicar(id);
    await this.iniciarEtapa(obterProblema(this.db, id), def, d.passo.etapaIndice, d.passo.tarefaId);
  }

  // ---------- escolha de modelo ----------

  private disponiveis(): Modelo[] {
    const hab = new Set(listarProvedores(this.db).filter((p) => p.habilitado).map((p) => p.id));
    return listarModelos(this.db).filter((m) => m.ativo && hab.has(m.provedor));
  }

  private regraDe(etapa: Etapa): string | null {
    const ref = etapa.agente?.modo === 'orquestrador' ? etapa.agente.familiaDiferenteDe : null;
    return ref ? `família diferente de quem rodou "${ref}"` : null;
  }

  /**
   * Todos os candidatos da etapa, pontuados com os critérios do projeto. Os que não podem ser usados
   * (inativos, provedor fora, regra rígida, revisão cruzada) ficam na lista com o motivo, para o registro.
   * Sem `p`, é a prévia: não aplica a revisão cruzada (ainda não há quem executou).
   */
  pontuarCandidatos(
    projeto: string,
    etapa: Etapa,
    p: ProblemaInterno | null,
    tarefa: TarefaInterna | null,
    criteriosOverride?: Criterios
  ): CandidatoPontuado[] {
    const todos = listarModelos(this.db);
    const hab = new Set(listarProvedores(this.db).filter((x) => x.habilitado).map((x) => x.id));
    const ids = etapa.agente?.modo === 'orquestrador' && etapa.agente.candidatos.length ? etapa.agente.candidatos : null;
    const base = ids ? ids.map((i) => todos.find((m) => m.id === i)).filter((m): m is Modelo => !!m) : todos.filter((m) => m.ativo);

    const exclusoes = new Map<number, string>();
    const cotas = this.cotasEstouradas();
    for (const m of base) {
      if (!m.ativo) exclusoes.set(m.id, 'modelo desativado');
      else if (!hab.has(m.provedor)) exclusoes.set(m.id, 'provedor não habilitado nesta máquina');
      else if (cotas.has(m.provedor)) exclusoes.set(m.id, cotas.get(m.provedor)!);
    }
    const ref = etapa.agente?.modo === 'orquestrador' ? etapa.agente.familiaDiferenteDe : null;
    if (ref && p) {
      const anterior = ultimaExecucao(this.db, p.id, tarefa?.id ?? null, ref);
      const fam = anterior?.modeloId ? todos.find((m) => m.id === anterior.modeloId)?.familia : null;
      if (fam) for (const m of base) if (m.familia === fam && !exclusoes.has(m.id)) exclusoes.set(m.id, `mesma família (${fam}) de quem rodou "${ref}"`);
    }
    const criterios = criteriosOverride ?? obterCriterios(this.db, projeto).criterios;
    const medidas = metricasMedidas(this.db, base.map((m) => m.id), criterios.historico === 'projeto' ? projeto : null);
    return pontuar(base, criterios, medidas, exclusoes);
  }

  /** Prévia da pontuação para cada etapa em que o orquestrador escolhe, na esteira atual do projeto. */
  previa(projeto: string, criterios?: Criterios): PreviaPapel[] {
    const esteira = obterEsteira(this.db, projeto);
    if (!esteira) return [];
    return esteira.definicao.etapas.flatMap((e) =>
      e.agente?.modo === 'orquestrador'
        ? [
            {
              etapaId: e.id,
              etapaNome: e.nome,
              papel: e.agente.papel,
              regraCruzada: this.regraDe(e),
              candidatos: this.pontuarCandidatos(projeto, e, null, null, criterios),
            },
          ]
        : []
    );
  }

  private escolherModelo(
    etapa: Etapa,
    p: ProblemaInterno,
    tarefa: TarefaInterna | null,
    tentativa: number
  ): Escolha | { erro: string } | { esperar: string } {
    const todos = listarModelos(this.db);
    const hab = new Set(listarProvedores(this.db).filter((x) => x.habilitado).map((x) => x.id));
    const disponivel = (m: Modelo | undefined): m is Modelo => !!m && m.ativo && hab.has(m.provedor);
    const { criterios } = obterCriterios(this.db, p.projeto);
    const papel = etapa.agente?.modo === 'orquestrador' ? etapa.agente.papel : null;

    if (etapa.escalar && tentativa >= etapa.escalar.aPartirDaTentativa) {
      const m = todos.find((x) => x.id === etapa.escalar!.modeloId);
      if (disponivel(m)) {
        return { modelo: m, motivo: `troca de modelo a partir da tentativa ${etapa.escalar.aPartirDaTentativa}`, origem: 'escalada', papel, pedido: null, candidatos: [], criterios };
      }
    }
    if (etapa.agente?.modo === 'fixo') {
      const id = etapa.agente.modeloId;
      const m = todos.find((x) => x.id === id);
      if (disponivel(m)) {
        const cota = this.cotasEstouradas().get(m.provedor);
        if (cota) return { esperar: cota };
        return { modelo: m, motivo: 'modelo fixo da etapa', origem: 'fixo', papel, pedido: null, candidatos: [], criterios };
      }
      const nome = todos.find((x) => x.id === id)?.nome ?? `modelo ${id}`;
      return { erro: `${etapa.nome}: ${nome} não está disponível (inativo ou provedor não habilitado).` };
    }
    if (etapa.agente?.modo === 'orquestrador') {
      const candidatos = this.pontuarCandidatos(p.projeto, etapa, p, tarefa);
      const elegiveis = candidatos.filter((c) => c.elegivel);
      if (!elegiveis.length) {
        const porCota = candidatos.filter((c) => c.excluidoPor?.startsWith('cota '));
        if (porCota.length) return { esperar: porCota[0]!.excluidoPor! };
        const motivos = candidatos.map((c) => `${c.nome}: ${c.excluidoPor}`).join('; ');
        return { erro: `${etapa.nome}: nenhum candidato pode ser usado${motivos ? ` (${motivos})` : ''}.` };
      }
      const pedido = tarefa?.modelos[etapa.agente.papel] ?? null;
      const doPlano = pedido ? candidatos.find((c) => c.codigo === pedido) : undefined;
      const melhor = elegiveis[0]!;
      const pegar = (c: CandidatoPontuado) => todos.find((m) => m.id === c.modeloId)!;
      const comum = { papel, pedido, candidatos, criterios };

      if (criterios.modo === 'orquestrador' && doPlano?.elegivel) {
        return { ...comum, modelo: pegar(doPlano), origem: 'plano', motivo: `escolhido no plano${tarefa?.justificativa ? `: ${tarefa.justificativa}` : ''}` };
      }
      let motivo: string;
      if (criterios.modo === 'pontuacao') motivo = `maior pontuação (${melhor.pontuacao.toFixed(2)}); o projeto escolhe por pontuação`;
      else if (!pedido) motivo = `o plano não indicou modelo para "${etapa.agente.papel}"; usado o de maior pontuação (${melhor.pontuacao.toFixed(2)})`;
      else if (!doPlano) motivo = `o plano pediu ${pedido}, que não é candidato desta etapa; usado o de maior pontuação`;
      else motivo = `o plano pediu ${pedido}, que não pode ser usado (${doPlano.excluidoPor}); usado o de maior pontuação`;
      return { ...comum, modelo: pegar(melhor), origem: 'pontuacao', motivo };
    }
    return { erro: `${etapa.nome}: etapa sem agente configurado.` };
  }

  /** Provedores com alguma janela de cota acima do limite configurado → motivo. */
  cotasEstouradas(): Map<IdProvedor, string> {
    const limite = this.limites().cotaMaxima;
    const saida = new Map<IdProvedor, string>();
    if (limite === null) return saida;
    for (const c of cotasVigentes(this.db)) {
      if (c.utilizacao * 100 < limite || saida.has(c.provedor)) continue;
      const reinicio = c.reiniciaEm ? `, reinicia ${new Date(c.reiniciaEm).toLocaleString('pt-BR')}` : '';
      saida.set(c.provedor, `cota ${c.janela} em ${Math.round(c.utilizacao * 100)}% (limite ${limite}%${reinicio})`);
    }
    return saida;
  }

  // ---------- capacidade ----------

  private temVaga(projeto: string, provedor: IdProvedor | null, escrita: boolean): boolean {
    const l = this.limites();
    const ativos = [...this.ativos.values()];
    if (ativos.length >= l.global) return false;
    if (provedor && ativos.filter((a) => a.provedor === provedor).length >= l.porProvedor) return false;
    if (escrita && ativos.some((a) => a.projeto === projeto && a.escrita)) return false;
    return true;
  }

  // ---------- execução de etapas ----------

  private async iniciarEtapa(p: ProblemaInterno, def: Definicao, idx: number, tarefaId: number | null) {
    const etapa = def.etapas[idx]!;
    let tarefa = tarefaId ? obterTarefa(this.db, tarefaId) : null;
    const tentativa = contarExecucoes(this.db, p.id, tarefaId, etapa.id) + 1;
    const projeto = obterProjeto(this.db, p.projeto)!;
    const base = { problema: p.id, tarefaId, etapaId: etapa.id, etapaNome: etapa.nome, tipo: etapa.tipo, tentativa };

    if (etapa.tipo === 'aprovacao_humana') {
      inserirExecucao(this.db, { ...base, estado: 'aguardando', espera: 'aprovacao', feedback: (tarefa ?? p).feedback });
      atualizarProblema(this.db, p.id, { estado: 'aguardando' });
      this.publicar(p.id);
      return;
    }

    const usaAgente = etapa.agente !== null;
    let escolha: Escolha | null = null;
    if (usaAgente) {
      const r = this.escolherModelo(etapa, p, tarefa, tentativa);
      if ('esperar' in r) return; // fica na fila até a cota reiniciar
      if ('erro' in r) {
        this.bloquear(p.id, tarefa, idx, r.erro);
        return;
      }
      escolha = r;
    }
    const escrita = etapa.tipo === 'comando' || etapa.tipo === 'commit' || (usaAgente && etapa.acesso === 'escrita');
    if (!this.temVaga(p.projeto, escolha?.modelo.provedor ?? null, escrita)) return; // fica na fila

    // Tarefa começando: fotografa o git para separar os arquivos dela dos que já estavam alterados.
    const raiz = await raizGit(projeto.raiz);
    if (tarefa && tarefa.baseGit === null) {
      tarefa = atualizarTarefa(this.db, tarefa.id, { baseGit: raiz ? await arquivosAlterados(raiz) : [] });
    }

    const feedback = (tarefa ?? p).feedback;
    // Antes de criar a execução nova: a anterior desta etapa decide se dá para retomar a sessão.
    const anteriorEtapa = ultimaExecucao(this.db, p.id, tarefaId, etapa.id);
    const exec = inserirExecucao(this.db, {
      ...base,
      estado: 'rodando',
      modeloId: escolha?.modelo.id ?? null,
      modeloNome: escolha?.modelo.nome ?? null,
      motivoEscolha: escolha?.motivo ?? null,
      feedback,
    });
    if (escolha) {
      registrarDecisao(this.db, {
        execucaoId: exec.id,
        etapaId: etapa.id,
        papel: escolha.papel,
        origem: escolha.origem,
        pedidoPeloPlano: escolha.pedido,
        escolhidoId: escolha.modelo.id,
        motivo: escolha.motivo,
        candidatos: escolha.candidatos,
        criterios: escolha.criterios,
      });
    }
    this.publicar(p.id);

    if (etapa.tipo === 'comando') {
      const c = rodarComando(etapa.comando, projeto.raiz, { timeoutMin: etapa.timeoutMin, env: this.env });
      this.ativos.set(exec.id, { problema: p.id, projeto: p.projeto, provedor: null, escrita, cancelar: c.cancelar });
      void this.rastrear(
        c.fim.then((r) => {
          this.ativos.delete(exec.id);
          const texto = `$ ${etapa.comando}\n${r.saida}`;
          if (r.cancelado) return this.finalizar(exec.id, { tipo: 'falha', feedback: 'cancelado' }, { saidaTexto: texto, cancelada: true });
          if (r.codigo === 0 && !r.tempoEsgotado) return this.finalizar(exec.id, { tipo: 'ok' }, { saidaTexto: texto });
          const motivo = r.tempoEsgotado ? `tempo esgotado (${etapa.timeoutMin} min)` : `terminou com código ${r.codigo}`;
          return this.finalizar(
            exec.id,
            { tipo: 'falha', feedback: `O comando \`${etapa.comando}\` ${motivo}. Saída:\n${cauda(r.saida)}` },
            { saidaTexto: texto, erro: `Comando ${motivo}.` }
          );
        })
      );
      return;
    }

    if (etapa.tipo === 'commit') {
      this.ativos.set(exec.id, { problema: p.id, projeto: p.projeto, provedor: null, escrita, cancelar: () => undefined });
      void this.rastrear(
        this.fazerCommit(p, etapa, tarefa, raiz, projeto.raiz).then((r) => {
          this.ativos.delete(exec.id);
          return this.finalizar(exec.id, r.resultado, { saidaTexto: r.texto, pulada: r.pulada, erro: r.erro ?? null });
        })
      );
      return;
    }

    // Etapas com agente.
    const modelo = escolha!.modelo;
    const tarefas = listarTarefas(this.db, p.id);
    // Catálogo para o planejador: candidatos elegíveis de cada papel, já pontuados, e os critérios do projeto.
    const papeis =
      etapa.saida === 'plano' || /\{\{\s*modelos\s*\}\}/.test(etapa.prompt)
        ? def.etapas.flatMap((e) =>
            e.ativa && e.agente?.modo === 'orquestrador'
              ? [{ papel: e.agente.papel, etapa: e.nome, candidatos: this.pontuarCandidatos(p.projeto, e, null, null), regra: this.regraDe(e) }]
              : []
          )
        : [];
    const criteriosTexto = descreverCriterios(obterCriterios(this.db, p.projeto).criterios);
    let diff = '';
    if (tarefa && /\{\{\s*diff\s*\}\}/.test(etapa.prompt)) {
      if (raiz) {
        const arquivos = await arquivosDaTarefa(raiz, tarefa.baseGit ?? [], relativosARaiz(raiz, projeto.raiz, tarefa.arquivos));
        diff = await diffDosArquivos(raiz, arquivos);
      } else diff = '(pasta sem git: diff indisponível)';
    }
    const ultimaGeral = [...listarExecucoesDe(this.db, p.id, tarefaId)].reverse().find((e) => e.saidaTexto && e.id !== exec.id);
    const valores = valoresVariaveis({
      projeto,
      problema: p,
      tarefas,
      tarefa,
      tentativa,
      feedback,
      diff,
      saidaAnterior: ultimaGeral?.saidaTexto ?? '',
      modelos: catalogoModelos(papeis, criteriosTexto, listarModelos(this.db)),
    });

    // Mesmo agente e mesmo modelo de novo: retoma a sessão e manda só o retorno.
    let sessao: string | null = null;
    let prompt = promptCompleto(etapa, valores);
    if (anteriorEtapa?.runId && RETOMAVEIS.has(etapa.tipo)) {
      const runAnt = obterRun(this.db, anteriorEtapa.runId);
      if (runAnt.sessao && runAnt.modeloId === modelo.id) {
        const extra =
          anteriorEtapa.estado === 'respondida'
            ? respostasMarkdown(p.respostas)
            : feedback
              ? `Corrija com base neste retorno:\n\n${feedback}`
              : '';
        if (extra) {
          sessao = runAnt.sessao;
          prompt = promptRetomada(etapa, valores, extra);
        }
      }
    }
    // O retorno foi entregue a esta execução.
    if (tarefa) atualizarTarefa(this.db, tarefa.id, { feedback: null });
    else atualizarProblema(this.db, p.id, { feedback: null });

    let schema: string | null = null;
    const esquema = SCHEMAS_JSON[etapa.saida];
    if (esquema && (modelo.provedor === 'antigravity' || modelo.provedor === 'codex')) {
      const dir = path.join(this.opcoes.dadosDir, 'esquemas');
      fs.mkdirSync(dir, { recursive: true });
      schema = path.join(dir, `${etapa.saida}.json`);
      fs.writeFileSync(schema, JSON.stringify(esquema, null, 2));
    }

    let run: Run;
    try {
      run = this.executor.iniciar({
        modeloId: modelo.id,
        projeto: p.projeto,
        cwd: projeto.raiz,
        modo: etapa.acesso,
        prompt,
        sessao,
        timeoutMin: etapa.timeoutMin,
        papel: etapa.tipo,
        jsonSchemaArquivo: schema,
        problema: p.id,
        execucaoId: exec.id,
      });
    } catch (err) {
      await this.finalizar(exec.id, { tipo: 'falha', feedback: (err as Error).message }, { erro: (err as Error).message });
      return;
    }
    atualizarExecucao(this.db, exec.id, { runId: run.id });
    this.ativos.set(exec.id, {
      problema: p.id,
      projeto: p.projeto,
      provedor: modelo.provedor,
      escrita,
      cancelar: () => {
        try {
          this.executor.cancelar(run.id);
        } catch {
          /* já terminou */
        }
      },
    });
    void this.rastrear(
      this.executor.aguardar(run.id).then((fim) => {
        this.ativos.delete(exec.id);
        return this.interpretar(exec.id, etapa, fim, p.id, tarefaId, idx);
      })
    );
  }

  private async fazerCommit(
    p: ProblemaInterno,
    etapa: Etapa,
    tarefa: TarefaInterna | null,
    raiz: string | null,
    cwd: string
  ): Promise<{ resultado: Resultado; texto: string; pulada?: boolean; erro?: string }> {
    if (!raiz) return { resultado: { tipo: 'ok' }, texto: 'Pasta sem git: commit pulado.', pulada: true };
    const tarefas = tarefa ? [tarefa] : listarTarefas(this.db, p.id);
    const informados = tarefas.flatMap((t) => relativosARaiz(raiz, cwd, t.arquivos));
    const base = tarefa?.baseGit ?? [];
    const arquivos = await arquivosDaTarefa(raiz, base, informados);
    if (!arquivos.length) return { resultado: { tipo: 'ok' }, texto: 'Nenhum arquivo alterado: nada para commitar.', pulada: true };
    const projeto = obterProjeto(this.db, p.projeto)!;
    const valores = valoresVariaveis({
      projeto,
      problema: p,
      tarefas: listarTarefas(this.db, p.id),
      tarefa,
      tentativa: 1,
      feedback: null,
      diff: '',
      saidaAnterior: '',
      modelos: '',
    });
    const mensagem = promptCompleto({ ...etapa, saida: 'texto' }, valores) || `${p.titulo}`;
    const r = await commitar(raiz, arquivos, mensagem);
    if ('erro' in r) return { resultado: { tipo: 'falha', feedback: r.erro }, texto: r.erro, erro: r.erro };
    if (tarefa) atualizarTarefa(this.db, tarefa.id, { commit: r.hash, arquivos });
    return { resultado: { tipo: 'ok' }, texto: `Commit ${r.hash.slice(0, 10)}: ${arquivos.join(', ')}` };
  }

  /** Lê o fim do run conforme a saída esperada da etapa. */
  private async interpretar(execId: number, etapa: Etapa, run: Run, problema: string, tarefaId: number | null, idx: number) {
    if (tarefaId && run.arquivos.length) {
      const t = obterTarefa(this.db, tarefaId);
      atualizarTarefa(this.db, tarefaId, { arquivos: [...new Set([...t.arquivos, ...run.arquivos])] });
    }
    const texto = run.resultadoTexto;
    if (run.estado === 'cancelado') return this.finalizar(execId, { tipo: 'falha', feedback: 'cancelado' }, { saidaTexto: texto, cancelada: true });
    if (run.estado !== 'concluido') {
      const msg = run.erro ?? `O run terminou como ${run.estado}.`;
      return this.finalizar(execId, { tipo: 'falha', feedback: `A execução anterior falhou: ${msg}` }, { saidaTexto: texto, erro: msg });
    }

    if (etapa.saida === 'plano') {
      const r = planoSchema.safeParse(run.saidaEstruturada);
      if (!r.success) {
        const msg = `Plano em formato inválido: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') || 'JSON não encontrado na resposta'}.`;
        return this.finalizar(execId, { tipo: 'falha', feedback: msg }, { saidaTexto: texto, erro: msg, formatoInvalido: true });
      }
      const plano = r.data;
      if (plano.perguntas.length) {
        atualizarExecucao(this.db, execId, { estado: 'aguardando', espera: 'perguntas', saida: plano, saidaTexto: texto });
        atualizarProblema(this.db, problema, { estado: 'aguardando' });
        this.publicar(problema);
        return;
      }
      const codigos = plano.tarefas.map((t) => t.codigo);
      const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i);
      const msgErro = !plano.tarefas.length && blocoTarefas(this.definicao(obterProblema(this.db, problema)))
        ? 'O plano não trouxe tarefas.'
        : repetido
          ? `Código de tarefa repetido: ${repetido}.`
          : null;
      if (msgErro) return this.finalizar(execId, { tipo: 'falha', feedback: msgErro }, { saidaTexto: texto, erro: msgErro, saida: plano });
      const def = this.definicao(obterProblema(this.db, problema));
      substituirTarefas(this.db, problema, plano, blocoTarefas(def)?.inicio ?? 0);
      atualizarProblema(this.db, problema, { plano });
      return this.finalizar(execId, { tipo: 'ok' }, { saidaTexto: texto, saida: plano });
    }

    if (etapa.saida === 'parecer') {
      const r = parecerSchema.safeParse(run.saidaEstruturada);
      if (!r.success) {
        const msg = 'Parecer em formato inválido (esperado {"aprovado": bool, "problemas": [...]}).';
        return this.finalizar(execId, { tipo: 'falha', feedback: msg }, { saidaTexto: texto, erro: msg, formatoInvalido: true });
      }
      gravarItensParecer(this.db, execId, r.data);
      if (r.data.aprovado) return this.finalizar(execId, { tipo: 'ok' }, { saidaTexto: texto, saida: r.data });
      return this.finalizar(
        execId,
        { tipo: 'falha', feedback: `${etapa.nome} reprovou:\n${textoParecer(r.data)}` },
        { saidaTexto: texto, saida: r.data, reprovada: true }
      );
    }

    if (etapa.saida === 'resumo_execucao') {
      const r = resumoExecucaoSchema.safeParse(run.saidaEstruturada);
      if (r.success && tarefaId && r.data.arquivos_alterados.length) {
        const t = obterTarefa(this.db, tarefaId);
        atualizarTarefa(this.db, tarefaId, { arquivos: [...new Set([...t.arquivos, ...r.data.arquivos_alterados])] });
      }
      return this.finalizar(execId, { tipo: 'ok' }, { saidaTexto: texto, saida: r.success ? r.data : null });
    }

    void idx;
    return this.finalizar(execId, { tipo: 'ok' }, { saidaTexto: texto });
  }

  /** Grava o fim da execução e move o ponteiro conforme o resultado e a regra de falha da etapa. */
  private async finalizar(
    execId: number,
    resultado: Resultado,
    extra: {
      saidaTexto?: string | null;
      saida?: unknown;
      erro?: string | null;
      pulada?: boolean;
      cancelada?: boolean;
      reprovada?: boolean;
      /** A etapa não entregou o formato pedido: é culpa dela, então ela mesma repete (não volta para outra). */
      formatoInvalido?: boolean;
    } = {}
  ) {
    const exec = obterExecucao(this.db, execId);
    const fim = new Date().toISOString();
    const estado = extra.cancelada
      ? 'cancelada'
      : extra.pulada
        ? 'pulada'
        : resultado.tipo === 'ok'
          ? 'concluida'
          : extra.reprovada
            ? 'reprovada'
            : 'falhou';
    atualizarExecucao(this.db, execId, {
      estado,
      espera: null,
      fim,
      ...(extra.saidaTexto !== undefined ? { saidaTexto: extra.saidaTexto } : {}),
      ...(extra.saida !== undefined ? { saida: extra.saida } : {}),
      ...(extra.erro !== undefined ? { erro: extra.erro } : {}),
    });

    const p = obterProblema(this.db, exec.problema);
    if (p.estado === 'cancelado' || extra.cancelada) {
      this.publicar(p.id);
      this.agendar();
      return;
    }
    const def = this.definicao(p);
    const idx = def.etapas.findIndex((e) => e.id === exec.etapaId);
    const tarefa = exec.tarefaId ? obterTarefa(this.db, exec.tarefaId) : null;
    const proximoEstado = p.estado === 'pausado' ? 'pausado' : 'em_andamento';

    const avancarPonteiro = () => {
      if (tarefa) atualizarTarefa(this.db, tarefa.id, { indiceEtapa: idx + 1 });
      else atualizarProblema(this.db, p.id, { indice: idx + 1 });
    };

    if (resultado.tipo === 'ok') {
      avancarPonteiro();
      atualizarProblema(this.db, p.id, { estado: proximoEstado, motivo: null });
    } else if (resultado.tipo === 'falha') {
      const dono = tarefa ?? p;
      const contadores = { ...dono.contadores, [exec.etapaId]: (dono.contadores[exec.etapaId] ?? 0) + 1 };
      if (tarefa) atualizarTarefa(this.db, tarefa.id, { contadores });
      else atualizarProblema(this.db, p.id, { contadores });
      let r = aposFalha(def, idx, contadores[exec.etapaId]!);
      if (extra.formatoInvalido && r.tipo === 'repetir') r = { tipo: 'repetir', indice: idx };
      if (r.tipo === 'seguir') {
        avancarPonteiro();
        atualizarProblema(this.db, p.id, { estado: proximoEstado });
      } else if (r.tipo === 'repetir') {
        if (tarefa) atualizarTarefa(this.db, tarefa.id, { indiceEtapa: r.indice, feedback: resultado.feedback });
        else atualizarProblema(this.db, p.id, { indice: r.indice, feedback: resultado.feedback });
        atualizarProblema(this.db, p.id, { estado: proximoEstado });
      } else {
        // Mantém o retorno para o “Tentar de novo” e deixa o ponteiro onde a volta levaria.
        const etapa = def.etapas[idx]!;
        const alvo = etapa.falha.acao === 'voltar' ? def.etapas.findIndex((e) => e.id === etapa.falha.voltarPara) : idx;
        if (tarefa) atualizarTarefa(this.db, tarefa.id, { indiceEtapa: alvo >= 0 ? alvo : idx, feedback: resultado.feedback });
        else atualizarProblema(this.db, p.id, { indice: alvo >= 0 ? alvo : idx, feedback: resultado.feedback });
        this.bloquear(p.id, tarefa, idx, `${r.motivo} Último retorno: ${resultado.feedback.slice(0, 500)}`);
      }
    }
    this.publicar(p.id);
    this.agendar();
  }

  private bloquear(problema: string, tarefa: TarefaInterna | null, _idx: number, motivo: string) {
    if (tarefa) atualizarTarefa(this.db, tarefa.id, { estado: 'bloqueada', motivo });
    const p = obterProblema(this.db, problema);
    atualizarProblema(this.db, problema, { estado: p.estado === 'pausado' ? 'pausado' : 'bloqueado', motivo });
    this.publicar(problema);
  }

  // ---------- ações humanas ----------

  async decidirExecucao(execId: number, d: Decisao): Promise<ResumoProblema> {
    const exec = obterExecucao(this.db, execId);
    if (exec.estado !== 'aguardando') throw new ErroDominio('CONFLITO', 'Esta etapa não está esperando você.');
    const p = obterProblema(this.db, exec.problema);
    if (p.estado === 'cancelado') throw new ErroDominio('CONFLITO', 'O problema foi cancelado.');

    if (exec.espera === 'perguntas') {
      if (d.acao !== 'responder') throw new ErroDominio('VALIDACAO', 'Esta etapa espera respostas.');
      const perguntas = (planoSchema.safeParse(exec.saida).data?.perguntas ?? []) as string[];
      const respostas = perguntas.map((pergunta, i) => ({ pergunta, resposta: (d.respostas[i] ?? '').trim() || '(sem resposta)' }));
      atualizarExecucao(this.db, execId, { estado: 'respondida', espera: null, fim: new Date().toISOString() });
      atualizarProblema(this.db, p.id, {
        respostas: [...p.respostas, ...respostas],
        estado: p.estado === 'pausado' ? 'pausado' : 'em_andamento',
      });
      this.publicar(p.id);
      this.agendar();
      return resumoProblema(this.db, p.id);
    }

    if (d.acao === 'responder') throw new ErroDominio('VALIDACAO', 'Esta etapa espera aprovação.');
    const comentario = (d.comentario ?? '').trim();
    if (d.acao === 'aprovar') await this.finalizar(execId, { tipo: 'ok' }, { saidaTexto: comentario || 'Aprovado.' });
    else await this.finalizar(execId, { tipo: 'falha', feedback: `Devolvido pelo usuário: ${comentario}` }, { saidaTexto: comentario, reprovada: true });
    return resumoProblema(this.db, p.id);
  }

  acao(problema: string, acao: AcaoProblema): ResumoProblema {
    const p = obterProblema(this.db, problema);
    const tarefas = listarTarefas(this.db, problema);
    const bloqueada = tarefas.find((t) => t.estado === 'bloqueada') ?? null;
    const exigir = (cond: boolean, msg: string) => {
      if (!cond) throw new ErroDominio('CONFLITO', msg);
    };
    const temEspera = () => execucoesEmCurso(this.db, problema).some((e) => e.estado === 'aguardando');

    switch (acao) {
      case 'pausar':
        exigir(['em_andamento', 'aguardando', 'bloqueado'].includes(p.estado), `Não dá para pausar um problema ${p.estado}.`);
        atualizarProblema(this.db, problema, { estado: 'pausado' });
        break;
      case 'retomar':
        exigir(p.estado === 'pausado', 'O problema não está pausado.');
        atualizarProblema(this.db, problema, {
          estado: bloqueada ? 'bloqueado' : temEspera() ? 'aguardando' : p.motivo && p.motivo.startsWith('Dependências') ? 'bloqueado' : 'em_andamento',
        });
        break;
      case 'cancelar':
        exigir(!['concluido', 'cancelado'].includes(p.estado), `O problema já está ${p.estado}.`);
        atualizarProblema(this.db, problema, { estado: 'cancelado', motivo: 'Cancelado pelo usuário.' });
        for (const t of tarefas) if (!['concluida', 'cancelada'].includes(t.estado)) atualizarTarefa(this.db, t.id, { estado: 'cancelada' });
        for (const e of execucoesEmCurso(this.db, problema)) {
          if (e.estado === 'aguardando') atualizarExecucao(this.db, e.id, { estado: 'cancelada', espera: null, fim: new Date().toISOString() });
          else this.ativos.get(e.id)?.cancelar();
        }
        break;
      case 'tentar_de_novo':
        exigir(p.estado === 'bloqueado', 'O problema não está bloqueado.');
        if (bloqueada) atualizarTarefa(this.db, bloqueada.id, { estado: 'em_andamento', contadores: {}, motivo: null });
        else atualizarProblema(this.db, problema, { contadores: {} });
        atualizarProblema(this.db, problema, { estado: 'em_andamento', motivo: null });
        break;
      case 'pular_etapa':
        exigir(p.estado === 'bloqueado', 'O problema não está bloqueado.');
        if (bloqueada) atualizarTarefa(this.db, bloqueada.id, { estado: 'em_andamento', indiceEtapa: this.indiceFalho(p, bloqueada) + 1, contadores: {}, motivo: null, feedback: null });
        else atualizarProblema(this.db, problema, { indice: this.indiceFalho(p, null) + 1, contadores: {}, feedback: null });
        atualizarProblema(this.db, problema, { estado: 'em_andamento', motivo: null });
        break;
      case 'cancelar_tarefa':
      case 'concluir_tarefa':
        exigir(p.estado === 'bloqueado' && !!bloqueada, 'Não há tarefa bloqueada.');
        atualizarTarefa(this.db, bloqueada!.id, { estado: acao === 'cancelar_tarefa' ? 'cancelada' : 'concluida', motivo: null });
        atualizarProblema(this.db, problema, { estado: 'em_andamento', motivo: null });
        break;
    }
    this.publicar(problema);
    this.agendar();
    return resumoProblema(this.db, problema);
  }

  /** Índice da etapa que causou o bloqueio: a última execução que falhou ou foi reprovada. */
  private indiceFalho(p: ProblemaInterno, tarefa: TarefaInterna | null): number {
    const def = this.definicao(p);
    const falha = [...listarExecucoesDe(this.db, p.id, tarefa?.id ?? null)].reverse().find((e) => e.estado === 'falhou' || e.estado === 'reprovada');
    const idx = falha ? def.etapas.findIndex((e) => e.id === falha.etapaId) : -1;
    return idx >= 0 ? idx : tarefa ? tarefa.indiceEtapa : p.indice;
  }
}

function listarExecucoesDe(db: Banco, problema: string, tarefaId: number | null): Execucao[] {
  return listarExecucoes(db, problema).filter((e) => e.tarefaId === tarefaId);
}
