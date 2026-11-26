import { ID_PROVEDORES, type IdProvedor, type Provedor } from '../../shared/provedores.js';
import type { Banco } from '../db/banco.js';
import {
  listarProvedores,
  obterCaminhoEmUso,
  obterProvedor,
  registrarDeteccao,
  registrarVerificacao,
} from '../db/provedores.js';
import { detectarCaminho, verificarCaminho } from './deteccao.js';
import type { Env } from './executavel.js';

export interface OpcoesVerificacao {
  env?: Env;
  timeoutMs?: number;
}

/** Atualiza o caminho detectado e roda `--version` no caminho em uso (manual ou detectado). */
export async function verificarProvedor(db: Banco, id: IdProvedor, opcoes: OpcoesVerificacao = {}): Promise<Provedor> {
  const env = opcoes.env ?? process.env;
  registrarDeteccao(db, id, detectarCaminho(id, env));
  const caminho = obterCaminhoEmUso(db, id);
  if (!caminho) {
    registrarVerificacao(db, id, null, null);
    return obterProvedor(db, id);
  }
  const r = await verificarCaminho(caminho, { env, timeoutMs: opcoes.timeoutMs ?? 15_000 });
  // O caminho pode ter mudado enquanto o --version rodava; nesse caso o resultado é descartado.
  if (obterCaminhoEmUso(db, id) === caminho) registrarVerificacao(db, id, caminho, r);
  return obterProvedor(db, id);
}

export async function verificarTodos(db: Banco, opcoes: OpcoesVerificacao = {}): Promise<Provedor[]> {
  await Promise.all(ID_PROVEDORES.map((id) => verificarProvedor(db, id, opcoes)));
  return listarProvedores(db);
}
