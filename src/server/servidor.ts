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
  /**
   * Endereço(s) em que o serviço escuta. Aceita vários, para continuar na própria máquina e também
   * no IP do Tailscale: `127.0.0.1,100.x.y.z`. Padrão: só 127.0.0.1.
   */
  host?: string | readonly string[];
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
  /** Um endereço por host em que o serviço escuta (o primeiro é o `url`). */
  urls: string[];
  porta: number;
  /** Hosts além da própria máquina que a API aceita. */
  hostsPermitidos: string[];
  db: Banco;
  executor: Executor;
  fechar(): Promise<void>;
}

/** `"127.0.0.1, 100.1.2.3"` ou lista → lista sem repetição; vazio vira 127.0.0.1. */
export function separarHosts(host: string | readonly string[] | undefined): string[] {
  const lista = (typeof host === 'string' ? host.split(',') : (host ?? [])).map((h) => h.trim().replace(/^\[|\]$/g, '')).filter(Boolean);
  return lista.length ? [...new Set(lista)] : [HOST_PADRAO];
}

/** Abre o banco, sobe o HTTP e devolve um handle para encerrar tudo. */
export async function iniciarServidor(opcoes: OpcoesServidor): Promise<ServidorAtivo> {
  const hosts = separarHosts(opcoes.host);
  const db = abrirBanco(opcoes.caminhoBanco);
  const interrompidos = marcarInterrompidos(db);
  if (interrompidos) console.warn(`[painel] ${interrompidos} run(s) marcados como interrompidos (o serviço caiu durante a execução).`);
  const aoVivo = new AoVivo();
  const executor = new Executor(db, aoVivo);
  const motor = new Motor(db, executor, aoVivo, { dadosDir: path.dirname(path.resolve(opcoes.caminhoBanco)) });
  // Escutando num IP específico (ex.: o do Tailscale), esse IP também precisa ser aceito.
  const extras = [...(opcoes.permitir ?? []), ...hosts.filter((h) => !['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(h))];
  const hostsPermitidos = lerHostsPermitidos(process.env, extras);
  const app = criarApp({ db, caminhoBanco: opcoes.caminhoBanco, webDir: opcoes.webDir ?? null, aoVivo, executor, motor, hostsPermitidos });

  // Um servidor HTTP por endereço, todos na mesma porta (com porta 0, a do primeiro vale para os outros).
  const servidores: ServerType[] = [];
  const fecharServidores = () =>
    Promise.all(
      servidores.map(
        (s) =>
          new Promise<void>((resolve) => {
            if ('closeAllConnections' in s) s.closeAllConnections();
            s.close(() => resolve());
          })
      )
    );
  let porta = opcoes.porta;
  try {
    for (const h of hosts) {
      const s = await new Promise<ServerType>((resolve, reject) => {
        const novo = serve({ fetch: app.fetch, port: porta, hostname: h }, () => resolve(novo));
        novo.once('error', (err: NodeJS.ErrnoException) =>
          reject(err.code === 'EADDRNOTAVAIL' ? new Error(`O endereço ${h} não existe nesta máquina (${err.code}).`) : err)
        );
      });
      servidores.push(s);
      porta = (s.address() as AddressInfo).port;
    }
  } catch (err) {
    await fecharServidores();
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

  const urls = hosts.map((h) => `http://${h.includes(':') ? `[${h}]` : h}:${porta}`);

  let fechado = false;
  return {
    url: urls[0]!,
    urls,
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
      await fecharServidores();
      await verificacao;
      db.close();
    },
  };
}
