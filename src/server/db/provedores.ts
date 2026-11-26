import type { EdicaoProvedor, EstadoProvedor, IdProvedor, Provedor } from '../../shared/provedores.js';
import { ErroDominio } from '../erros.js';
import type { ResultadoVerificacao } from '../provedores/deteccao.js';
import type { Banco } from './banco.js';

interface Linha {
  id: IdProvedor;
  nome: string;
  caminho: string | null;
  caminho_detectado: string | null;
  ativo: number;
  versao: string | null;
  saida_versao: string | null;
  erro: string | null;
  verificado_em: string | null;
  caminho_verificado: string | null;
  ok: number;
}

export function caminhoEmUso(l: Pick<Linha, 'caminho' | 'caminho_detectado'>): string | null {
  return l.caminho ?? l.caminho_detectado;
}

function estado(l: Linha): EstadoProvedor {
  const emUso = caminhoEmUso(l);
  if (!emUso) return 'nao_encontrado';
  if (!l.verificado_em || l.caminho_verificado !== emUso) return 'nao_verificado';
  if (!l.ok) return 'erro';
  return l.ativo ? 'habilitado' : 'desativado';
}

function paraProvedor(l: Linha): Provedor {
  const e = estado(l);
  const verificadoAtual = e !== 'nao_verificado' && e !== 'nao_encontrado';
  return {
    id: l.id,
    nome: l.nome,
    caminho: l.caminho,
    caminhoDetectado: l.caminho_detectado,
    caminhoEmUso: caminhoEmUso(l),
    ativo: l.ativo === 1,
    versao: verificadoAtual ? l.versao : null,
    saidaVersao: verificadoAtual ? l.saida_versao : null,
    erro: verificadoAtual ? l.erro : null,
    verificadoEm: l.verificado_em,
    estado: e,
    habilitado: e === 'habilitado',
  };
}

const ORDEM = "CASE id WHEN 'claude' THEN 1 WHEN 'cursor' THEN 2 WHEN 'antigravity' THEN 3 ELSE 4 END";

export function listarProvedores(db: Banco): Provedor[] {
  return (db.prepare(`SELECT * FROM provedores ORDER BY ${ORDEM}`).all() as unknown as Linha[]).map(paraProvedor);
}

function linha(db: Banco, id: string): Linha {
  const l = db.prepare('SELECT * FROM provedores WHERE id = ?').get(id) as unknown as Linha | undefined;
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', `Provedor "${id}" não encontrado.`);
  return l;
}

export function obterProvedor(db: Banco, id: string): Provedor {
  return paraProvedor(linha(db, id));
}

export function obterCaminhoEmUso(db: Banco, id: string): string | null {
  return caminhoEmUso(linha(db, id));
}

export function editarProvedor(db: Banco, id: string, dados: EdicaoProvedor, agora = new Date()): Provedor {
  const atual = linha(db, id);
  const caminho = dados.caminho !== undefined ? dados.caminho : atual.caminho;
  const ativo = dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo;
  db.prepare('UPDATE provedores SET caminho = ?, ativo = ?, atualizado_em = ? WHERE id = ?').run(
    caminho,
    ativo,
    agora.toISOString(),
    id
  );
  return obterProvedor(db, id);
}

export function registrarDeteccao(db: Banco, id: string, caminhoDetectado: string | null, agora = new Date()) {
  db.prepare('UPDATE provedores SET caminho_detectado = ?, atualizado_em = ? WHERE id = ?').run(
    caminhoDetectado,
    agora.toISOString(),
    id
  );
}

export function registrarVerificacao(
  db: Banco,
  id: string,
  caminhoVerificado: string | null,
  r: ResultadoVerificacao | null,
  agora = new Date()
) {
  const ts = agora.toISOString();
  db.prepare(
    `UPDATE provedores SET versao = ?, saida_versao = ?, erro = ?, ok = ?, verificado_em = ?,
       caminho_verificado = ?, atualizado_em = ? WHERE id = ?`
  ).run(r?.versao ?? null, r?.saida ?? null, r?.erro ?? null, r?.ok ? 1 : 0, ts, caminhoVerificado, ts, id);
}
