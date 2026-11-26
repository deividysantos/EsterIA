import os from 'node:os';
import path from 'node:path';

/**
 * Configuração de ambiente do serviço. A v2 usa pasta e porta próprias para conviver com o v1
 * (`~/.agentes` e porta 4700) enquanto a migração não termina.
 */
export const PORTA_PADRAO = 4710;
export const HOST_PADRAO = '127.0.0.1';

type Env = Record<string, string | undefined>;

function valor(env: Env, nome: string): string | undefined {
  const v = env[nome]?.trim();
  return v ? v : undefined;
}

/** Pasta de dados: `PAINEL_DADOS_DIR` ou `~/.painel-agentes`. */
export function obterDadosDir(env: Env = process.env): string {
  const dir = valor(env, 'PAINEL_DADOS_DIR');
  if (dir) return path.resolve(dir);
  const home = valor(env, 'USERPROFILE') ?? valor(env, 'HOME') ?? os.homedir();
  return path.join(path.resolve(home), '.painel-agentes');
}

/** Arquivo do banco: `PAINEL_BANCO` ou `<dados>/painel.db`. */
export function obterCaminhoBanco(env: Env = process.env): string {
  const banco = valor(env, 'PAINEL_BANCO');
  return banco ? path.resolve(banco) : path.join(obterDadosDir(env), 'painel.db');
}

/** Porta: `PAINEL_PORTA` ou 4710. Lança erro se o valor não for uma porta válida. */
export function obterPorta(env: Env = process.env): number {
  const bruto = valor(env, 'PAINEL_PORTA');
  if (bruto === undefined) return PORTA_PADRAO;
  return validarPorta(bruto);
}

export function validarPorta(bruto: string): number {
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Porta inválida: "${bruto}".`);
  }
  return n;
}
