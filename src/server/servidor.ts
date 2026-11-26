import type { AddressInfo } from 'node:net';

import { serve, type ServerType } from '@hono/node-server';

import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './db/banco.js';
import { HOST_PADRAO } from './config.js';

export interface OpcoesServidor {
  caminhoBanco: string;
  porta: number;
  host?: string;
  webDir?: string | null;
}

export interface ServidorAtivo {
  url: string;
  porta: number;
  db: Banco;
  fechar(): Promise<void>;
}

/** Abre o banco, sobe o HTTP e devolve um handle para encerrar tudo. */
export async function iniciarServidor(opcoes: OpcoesServidor): Promise<ServidorAtivo> {
  const host = opcoes.host ?? HOST_PADRAO;
  const db = abrirBanco(opcoes.caminhoBanco);
  const app = criarApp({ db, caminhoBanco: opcoes.caminhoBanco, webDir: opcoes.webDir ?? null });

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

  const porta = (server.address() as AddressInfo).port;
  const hostUrl = host.includes(':') ? `[${host}]` : host;

  let fechado = false;
  return {
    url: `http://${hostUrl}:${porta}`,
    porta,
    db,
    async fechar() {
      if (fechado) return;
      fechado = true;
      await new Promise<void>((resolve) => {
        if ('closeAllConnections' in server) server.closeAllConnections();
        server.close(() => resolve());
      });
      db.close();
    },
  };
}
