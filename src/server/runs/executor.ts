import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { NovoRunValidado, Run, Usage } from '../../shared/runs.js';
import type { Modelo } from '../../shared/provedores.js';
import { ADAPTADORES } from '../adaptadores/index.js';
import type { EventoLido, Leitor } from '../adaptadores/tipos.js';
import { extrairJson } from '../adaptadores/util.js';
import type { AoVivo } from '../aoVivo.js';
import type { Banco } from '../db/banco.js';
import { obterModelo } from '../db/modelos.js';
import { obterProjeto } from '../db/projetos.js';
import { obterCaminhoEmUso, obterProvedor } from '../db/provedores.js';
import {
  atualizarRun,
  gravarLimites,
  gravarStderr,
  inserirEvento,
  inserirRun,
  obterRun,
  type AtualizacaoRun,
} from '../db/runs.js';
import { ErroDominio } from '../erros.js';
import { resolverExecucao, type Env } from '../provedores/executavel.js';

const LIMITE_STDERR = 256 * 1024;

export interface OpcoesInicio extends NovoRunValidado {
  papel?: string;
  jsonSchemaArquivo?: string | null;
  problema?: string | null;
  execucaoId?: number | null;
}

interface Ativo {
  proc: ChildProcess;
  motivoParada: 'cancelado' | 'tempo' | null;
  fim: Promise<Run>;
}

/** Custo estimado pela tabela do modelo; null se faltar preço de entrada ou saída. */
export function estimarCusto(u: Usage, m: Pick<Modelo, 'precoEntrada' | 'precoSaida' | 'precoCacheLeitura' | 'precoCacheEscrita'>): number | null {
  if (m.precoEntrada === null || m.precoSaida === null) return null;
  if (u.entrada === null && u.saida === null) return null;
  const parte = (tokens: number | null, preco: number | null) => ((tokens ?? 0) * (preco ?? 0)) / 1_000_000;
  return (
    parte(u.entrada, m.precoEntrada) +
    parte(u.saida, m.precoSaida) +
    parte(u.cacheLeitura, m.precoCacheLeitura ?? m.precoEntrada) +
    parte(u.cacheEscrita, m.precoCacheEscrita ?? m.precoEntrada)
  );
}

/** Encerra o processo e os filhos (o CLI costuma abrir node, shells, servidores…). */
export function matarArvore(proc: ChildProcess): void {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  } else {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill('SIGTERM');
    }
  }
}

export class Executor {
  private readonly ativos = new Map<string, Ativo>();

  constructor(
    private readonly db: Banco,
    private readonly aoVivo: AoVivo,
    private readonly env: Env = process.env
  ) {}

  /** Valida, grava o run como `rodando`, dispara o processo e devolve o run sem esperar o fim. */
  iniciar(o: OpcoesInicio): Run {
    const modelo = obterModelo(this.db, o.modeloId);
    if (!modelo.ativo) throw new ErroDominio('VALIDACAO', `O modelo ${modelo.nome} está desativado.`);
    const provedor = obterProvedor(this.db, modelo.provedor);
    if (!provedor.habilitado) {
      throw new ErroDominio('VALIDACAO', `O provedor ${provedor.nome} não está habilitado (${provedor.estado}).`);
    }
    const caminho = obterCaminhoEmUso(this.db, modelo.provedor)!;

    let cwd = o.cwd;
    if (o.projeto) {
      const p = obterProjeto(this.db, o.projeto);
      if (!p) throw new ErroDominio('VALIDACAO', `Projeto "${o.projeto}" não encontrado.`);
      cwd ??= p.raiz;
    }
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new ErroDominio('VALIDACAO', `Pasta de trabalho inválida: ${cwd ?? '(vazia)'}.`);
    }

    const adaptador = ADAPTADORES[modelo.provedor];
    const comando = adaptador.montarComando({
      prompt: o.prompt,
      modelo: modelo.codigo,
      modo: o.modo,
      sessao: o.sessao,
      jsonSchemaArquivo: o.jsonSchemaArquivo ?? null,
    });
    const exec = resolverExecucao(caminho, comando.args, this.env);

    const id = randomUUID();
    const inicio = new Date();
    // O prompt já fica no run; no comando gravado ele aparece como marcador.
    const comandoGravado = [caminho, ...comando.args.map((a) => (a === o.prompt ? '<prompt>' : a))];
    const run = inserirRun(this.db, {
      id,
      projeto: o.projeto,
      provedor: modelo.provedor,
      modeloId: modelo.id,
      modeloCodigo: modelo.codigo,
      modeloNome: modelo.nome,
      familia: modelo.familia,
      papel: o.papel ?? 'avulso',
      modo: o.modo,
      cwd,
      prompt: o.prompt,
      comando: comandoGravado,
      sessaoRetomada: o.sessao,
      inicio,
      problema: o.problema ?? null,
      execucaoId: o.execucaoId ?? null,
    });

    let proc: ChildProcess;
    try {
      proc = spawn(exec.arquivo, exec.args, {
        cwd,
        env: { ...this.env, ...exec.envExtra } as NodeJS.ProcessEnv,
        windowsHide: true,
        windowsVerbatimArguments: exec.verbatim,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const r = atualizarRun(this.db, id, {
        estado: 'falhou',
        erro: `Não foi possível iniciar: ${(err as Error).message}`,
        fim: new Date().toISOString(),
        duracaoMs: 0,
      });
      this.aoVivo.publicar({ tipo: 'run', run: r });
      return r;
    }

    const ativo: Ativo = { proc, motivoParada: null, fim: Promise.resolve(run) };
    ativo.fim = this.acompanhar(id, proc, adaptador.criarLeitor(), modelo, inicio, ativo, o.timeoutMin);
    this.ativos.set(id, ativo);

    proc.stdin?.on('error', () => undefined);
    proc.stdin?.end(comando.stdin ?? undefined, 'utf8');

    const comPid = atualizarRun(this.db, id, { pid: proc.pid ?? null });
    this.aoVivo.publicar({ tipo: 'run', run: comPid });
    return comPid;
  }

  private acompanhar(
    id: string,
    proc: ChildProcess,
    leitor: Leitor,
    modelo: Modelo,
    inicio: Date,
    ativo: Ativo,
    timeoutMin: number | null
  ): Promise<Run> {
    const est = leitor.estado;
    let seq = 0;
    let resto = '';
    let stderr = '';
    let stderrTruncado = false;
    let erroSpawn: string | null = null;

    const gravar = (eventos: EventoLido[]) => {
      for (const e of eventos) {
        const ev = inserirEvento(this.db, {
          runId: id,
          seq: ++seq,
          ts: new Date(),
          tipo: e.tipo,
          resumo: e.resumo,
          texto: e.texto ?? null,
          bruto: e.bruto,
        });
        this.aoVivo.publicar({ tipo: 'evento', evento: ev });
      }
    };

    const parcial = (): AtualizacaoRun => ({
      sessao: est.sessao,
      modeloReportado: est.modelo,
      usage: { ...est.usage },
      contagemMensagens: est.mensagens,
      contagemFerramentas: est.ferramentas,
      arquivos: [...est.arquivos],
    });

    const processarLinha = (bruta: string) => {
      const l = bruta.replace(/\r$/, '');
      if (!l.trim()) return;
      let o: unknown;
      try {
        o = JSON.parse(l);
      } catch {
        gravar(leitor.texto(l));
        return;
      }
      if (o && typeof o === 'object' && !Array.isArray(o)) gravar(leitor.linha(o as Record<string, unknown>));
      else gravar(leitor.texto(l));
    };

    const descarregarLimites = () => {
      if (est.limites.length) {
        gravarLimites(this.db, modelo.provedor, id, est.limites);
        est.limites = [];
      }
    };

    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (pedaco: string) => {
      const partes = (resto + pedaco).split('\n');
      resto = partes.pop() ?? '';
      try {
        for (const p of partes) processarLinha(p);
        descarregarLimites();
        this.aoVivo.publicar({ tipo: 'run', run: atualizarRun(this.db, id, parcial()) });
      } catch (err) {
        console.error(`[painel] run ${id}: erro ao processar saída:`, err);
      }
    });

    proc.stderr!.setEncoding('utf8');
    proc.stderr!.on('data', (pedaco: string) => {
      if (stderr.length >= LIMITE_STDERR) {
        stderrTruncado = true;
        return;
      }
      stderr += pedaco;
      if (stderr.length > LIMITE_STDERR) {
        stderr = stderr.slice(0, LIMITE_STDERR);
        stderrTruncado = true;
      }
    });

    const timer =
      timeoutMin !== null
        ? setTimeout(() => {
            ativo.motivoParada = 'tempo';
            matarArvore(proc);
          }, timeoutMin * 60_000)
        : null;
    timer?.unref();

    return new Promise<Run>((resolve) => {
      proc.once('error', (err) => {
        erroSpawn = err.message;
      });
      proc.once('close', (codigo) => {
        if (timer) clearTimeout(timer);
        this.ativos.delete(id);
        let r: Run;
        try {
          if (resto) processarLinha(resto);
          gravar(leitor.finalizar());
          descarregarLimites();
          gravarStderr(this.db, id, stderr, stderrTruncado);

          const fim = new Date();
          let estado: Run['estado'];
          let erro: string | null = null;
          if (ativo.motivoParada === 'cancelado') {
            estado = 'cancelado';
            erro = 'Cancelado pelo usuário.';
          } else if (ativo.motivoParada === 'tempo') {
            estado = 'falhou';
            erro = `Tempo esgotado (${timeoutMin} min).`;
          } else if (erroSpawn) {
            estado = 'falhou';
            erro = `Não foi possível executar: ${erroSpawn}`;
          } else if (codigo === 0 && est.sucesso !== false) {
            estado = 'concluido';
          } else {
            estado = 'falhou';
            erro =
              est.erro ??
              (codigo !== 0 ? `O CLI terminou com código ${codigo}.` : 'O CLI informou falha.') +
                (stderr.trim() ? ` ${stderr.trim().split(/\r?\n/).slice(-1)[0]}` : '');
          }

          const custoCli = est.custoUsd;
          const custoEst = custoCli === null ? estimarCusto(est.usage, modelo) : null;
          const resultado = est.resultado ?? est.ultimaMensagem;
          const estruturada = est.estruturada !== undefined ? est.estruturada : extrairJson(est.ultimaMensagem ?? resultado);

          r = atualizarRun(this.db, id, {
            ...parcial(),
            estado,
            erro,
            codigoSaida: codigo,
            fim: fim.toISOString(),
            duracaoMs: fim.getTime() - inicio.getTime(),
            numTurnos: est.numTurnos,
            custoUsd: custoCli ?? custoEst,
            custoOrigem: custoCli !== null ? 'cli' : custoEst !== null ? 'estimado' : null,
            resultadoTexto: resultado,
            saidaEstruturada: estruturada,
          });
        } catch (err) {
          console.error(`[painel] run ${id}: erro ao finalizar:`, err);
          r = atualizarRun(this.db, id, { estado: 'falhou', erro: `Erro interno: ${(err as Error).message}`, fim: new Date().toISOString() });
        }
        this.aoVivo.publicar({ tipo: 'run', run: r });
        resolve(r);
      });
    });
  }

  cancelar(id: string): Run {
    const run = obterRun(this.db, id);
    const ativo = this.ativos.get(id);
    if (!ativo) {
      if (run.estado === 'rodando') throw new ErroDominio('CONFLITO', 'Este run não pertence a este processo do serviço.');
      throw new ErroDominio('CONFLITO', `O run já terminou (${run.estado}).`);
    }
    ativo.motivoParada = 'cancelado';
    matarArvore(ativo.proc);
    return run;
  }

  /** Promessa do fim do run (útil para o motor e para testes). */
  aguardar(id: string): Promise<Run> {
    return this.ativos.get(id)?.fim ?? Promise.resolve(obterRun(this.db, id));
  }

  emAndamento(): number {
    return this.ativos.size;
  }

  /** Encerramento do serviço: cancela tudo e espera os processos fecharem. */
  async encerrar(): Promise<void> {
    const fins = [...this.ativos.values()].map((a) => {
      a.motivoParada = 'cancelado';
      matarArvore(a.proc);
      return a.fim;
    });
    await Promise.allSettled(fins);
  }
}
