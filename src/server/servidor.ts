import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { serve, type ServerType } from '@hono/node-server';

import { criarApp } from './app.js';
import { abrirBanco, type Banco } from './db/banco.js';
import { HOST_PADRAO } from './config.js';
import { verificarTodos } from './provedores/servico.js';
import { AoVivo } from './aoVivo.js';
import { marcarInterrompidos } from './db/runs.js';
import { Executor } from './runs/executor.js';
import { Motor } from './motor/motor.js';
import { lerHostsPermitidos } from './hosts.js';
import { importarCotasCodex } from './provedores/cotaCodex.js';

export interface OpcoesServidor {
  caminhoBanco: string;
  porta: number;
  host?: string;
  webDir?: string | null;
  /** Detecta e verifica os CLIs logo depois de subir (padrão: sim). */
  verificarProvedores?: boolean;
  /** Liga o motor da esteira (padrão: sim). */
  iniciarMotor?: boolean;
  /** Hosts extras aceitos pela API (além de PAINEL_HOSTS_PERMITIDOS). */
  permitir?: readonly string[];
}

export interface ServidorAtivo {
  url: string;
  porta: number;
  /** Hosts além da própria máquina que a API aceita. */
  hostsPermitidos: string[];
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
  const motor = new Motor(db, executor, aoVivo, { dadosDir: path.dirname(path.resolve(opcoes.caminhoBanco)) });
  // Escutando num IP específico (ex.: o do Tailscale), esse IP também precisa ser aceito.
  const extras = [...(opcoes.permitir ?? []), ...(host !== HOST_PADRAO && host !== '0.0.0.0' && host !== '::' ? [host] : [])];
  const hostsPermitidos = lerHostsPermitidos(process.env, extras);
  const app = criarApp({ db, caminhoBanco: opcoes.caminhoBanco, webDir: opcoes.webDir ?? null, aoVivo, executor, motor, hostsPermitidos });

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
  // O motor só começa depois da verificação, para não bloquear problemas por um provedor ainda não verificado.
  const motorPronto = opcoes.iniciarMotor === false ? Promise.resolve() : verificacao.then(() => motor.iniciar());

  // Cota do Codex pelas sessões locais (melhor esforço), agora e a cada 5 min.
  const lerCodex = () => {
    try {
      importarCotasCodex(db);
    } catch (err) {
      console.error('[painel] falha ao ler cota do Codex:', err);
    }
  };
  lerCodex();
  const timerCodex = setInterval(lerCodex, 5 * 60_000);
  timerCodex.unref();

  const porta = (server.address() as AddressInfo).port;
  const hostUrl = host.includes(':') ? `[${host}]` : host;

  let fechado = false;
  return {
    url: `http://${hostUrl}:${porta}`,
    porta,
    hostsPermitidos,
    db,
    executor,
    async fechar() {
      if (fechado) return;
      fechado = true;
      clearInterval(timerCodex);
      await motorPronto;
      await motor.parar();
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
