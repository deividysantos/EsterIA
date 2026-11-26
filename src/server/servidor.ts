import type { AddressInfo } from 'node:net';

import { serve, type ServerType } from '@hono/node-server';

import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './db/banco.js';
import { HOST_PADRAO } from './config.js';
import { verificarTodos } from './provedores/servico.js';
import { AoVivo } from './aoVivo.js';
import { marcarInterrompidos } from './db/runs.js';
import { Executor } from './runs/executor.js';

export interface OpcoesServidor {
  caminhoBanco: string;
  porta: number;
  host?: string;
  webDir?: string | null;
  /** Detecta e verifica os CLIs logo depois de subir (padrão: sim). */
  verificarProvedores?: boolean;
}

export interface ServidorAtivo {
  url: string;
  porta: number;
  db: Banco;
  executor: Executor;
  fechar(): Promise<void>;
}

/** Abre o banco, sobe o HTTP e devolve um handle para encerrar tudo. */
export async function iniciarServidor(opcoes: OpcoesServidor): Promise<ServidorAtivo> {
  const host = opcoes.host ?? HOST_PADRAO;
  const db = abrirBanco(opcoes.caminhoBanco);
  const interrompidos = marcarInterrompidos(db);
  if (interrompidos) console.warn(`[painel] ${interrompidos} run(s) marcados como interrompidos (o serviço caiu durante a execução).`);
  const aoVivo = new AoVivo();
  const executor = new Executor(db, aoVivo);
  const app = criarApp({ db, caminhoBanco: opcoes.caminhoBanco, webDir: opcoes.webDir ?? null, aoVivo, executor });

  let server: ServerType;
  try {
    server = await new Promise<ServerType>((resolve, reject) => {
      const s = serve({ fetch: app.fetch, port: opcoes.porta, hostname: host }, () => resolve(s));
      s.once('error', reject);
    });
  } catch (err) {
    db.close();
    throw err;
  }

  // Em segundo plano: a interface já abre enquanto os --version rodam.
  const verificacao =
    opcoes.verificarProvedores === false
      ? Promise.resolve()
      : verificarTodos(db).then(
          () => undefined,
          (err: unknown) => console.error('[painel] falha ao verificar provedores:', err)
        );

  const porta = (server.address() as AddressInfo).port;
  const hostUrl = host.includes(':') ? `[${host}]` : host;

  let fechado = false;
  return {
    url: `http://${hostUrl}:${porta}`,
    porta,
    db,
    executor,
    async fechar() {
      if (fechado) return;
      fechado = true;
      await executor.encerrar();
      await new Promise<void>((resolve) => {
        if ('closeAllConnections' in server) server.closeAllConnections();
        server.close(() => resolve());
      });
      await verificacao;
      db.close();
    },
  };
}
