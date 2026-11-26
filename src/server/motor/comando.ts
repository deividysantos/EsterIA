import { spawn, type ChildProcess } from 'node:child_process';

import { matarArvore } from '../runs/executor.js';
import type { Env } from '../provedores/executavel.js';

const LIMITE_SAIDA = 200_000;

export interface ResultadoComando {
  codigo: number | null;
  saida: string;
  tempoEsgotado: boolean;
  cancelado: boolean;
}

export interface ComandoAtivo {
  fim: Promise<ResultadoComando>;
  cancelar(): void;
}

/**
 * Roda um comando de shell da esteira (o texto é do usuário: testes, lint, build) na pasta do projeto.
 * Guarda o fim da saída combinada (stdout + stderr), que é onde costuma estar o erro.
 */
export function rodarComando(comando: string, cwd: string, { timeoutMin, env = process.env }: { timeoutMin: number | null; env?: Env }): ComandoAtivo {
  const win = process.platform === 'win32';
  const proc: ChildProcess = win
    ? spawn(env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', `"${comando}"`], {
        cwd,
        env: env as NodeJS.ProcessEnv,
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
    : spawn('/bin/sh', ['-c', comando], { cwd, env: env as NodeJS.ProcessEnv, detached: true });

  let saida = '';
  let tempoEsgotado = false;
  let cancelado = false;
  const juntar = (p: Buffer) => {
    saida += p.toString('utf8');
    if (saida.length > LIMITE_SAIDA * 2) saida = saida.slice(-LIMITE_SAIDA);
  };
  proc.stdout?.on('data', juntar);
  proc.stderr?.on('data', juntar);
  proc.stdin?.end();

  const timer = timeoutMin
    ? setTimeout(() => {
        tempoEsgotado = true;
        matarArvore(proc);
      }, timeoutMin * 60_000)
    : null;
  timer?.unref();

  const fim = new Promise<ResultadoComando>((resolve) => {
    proc.once('error', (err) => {
      saida += `\n${err.message}`;
    });
    proc.once('close', (codigo) => {
      if (timer) clearTimeout(timer);
      const texto = saida.length > LIMITE_SAIDA ? `… (início cortado)\n${saida.slice(-LIMITE_SAIDA)}` : saida;
      resolve({ codigo, saida: texto, tempoEsgotado, cancelado });
    });
  });

  return {
    fim,
    cancelar() {
      cancelado = true;
      matarArvore(proc);
    },
  };
}
