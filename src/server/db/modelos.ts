import type { EdicaoModelo, IdProvedor, Modelo, NovoModeloValidado } from '../../shared/provedores.js';
import { ErroDominio } from '../erros.js';
import type { Banco } from './banco.js';

interface Linha {
  id: number;
  provedor: IdProvedor;
  codigo: string;
  nome: string;
  familia: string;
  nota_custo: number | null;
  nota_velocidade: number | null;
  nota_qualidade: number | null;
  contexto_tokens: number | null;
  tags_json: string;
  observacao: string;
  preco_entrada: number | null;
  preco_saida: number | null;
  preco_cache_leitura: number | null;
  preco_cache_escrita: number | null;
  ativo: number;
  criado_em: string;
  atualizado_em: string;
}

function paraModelo(l: Linha): Modelo {
  return {
    id: l.id,
    provedor: l.provedor,
    codigo: l.codigo,
    nome: l.nome,
    familia: l.familia,
    notaCusto: l.nota_custo,
    notaVelocidade: l.nota_velocidade,
    notaQualidade: l.nota_qualidade,
    contextoTokens: l.contexto_tokens,
    tags: JSON.parse(l.tags_json) as string[],
    observacao: l.observacao,
    precoEntrada: l.preco_entrada,
    precoSaida: l.preco_saida,
    precoCacheLeitura: l.preco_cache_leitura,
    precoCacheEscrita: l.preco_cache_escrita,
    ativo: l.ativo === 1,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}

const ORDEM =
  "ORDER BY CASE provedor WHEN 'claude' THEN 1 WHEN 'cursor' THEN 2 WHEN 'antigravity' THEN 3 ELSE 4 END, nome COLLATE NOCASE";

export function listarModelos(db: Banco, filtro: { provedor?: IdProvedor } = {}): Modelo[] {
  const linhas = filtro.provedor
    ? db.prepare(`SELECT * FROM modelos WHERE provedor = ? ${ORDEM}`).all(filtro.provedor)
    : db.prepare(`SELECT * FROM modelos ${ORDEM}`).all();
  return (linhas as unknown as Linha[]).map(paraModelo);
}

export function obterModelo(db: Banco, id: number): Modelo {
  const l = db.prepare('SELECT * FROM modelos WHERE id = ?').get(id) as unknown as Linha | undefined;
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', `Modelo ${id} não encontrado.`);
  return paraModelo(l);
}

function garantirCodigoLivre(db: Banco, provedor: string, codigo: string, ignorarId?: number) {
  const outro = db
    .prepare('SELECT id FROM modelos WHERE provedor = ? AND codigo = ?')
    .get(provedor, codigo) as { id: number } | undefined;
  if (outro && outro.id !== ignorarId) {
    throw new ErroDominio('CONFLITO', `Já existe o modelo "${codigo}" neste provedor.`);
  }
}

function valores(m: Omit<Modelo, 'id' | 'criadoEm' | 'atualizadoEm'>) {
  return [
    m.provedor,
    m.codigo,
    m.nome,
    m.familia,
    m.notaCusto,
    m.notaVelocidade,
    m.notaQualidade,
    m.contextoTokens,
    JSON.stringify([...new Set(m.tags)]),
    m.observacao,
    m.precoEntrada,
    m.precoSaida,
    m.precoCacheLeitura,
    m.precoCacheEscrita,
    m.ativo ? 1 : 0,
  ] as const;
}

export function criarModelo(db: Banco, dados: NovoModeloValidado, agora = new Date()): Modelo {
  garantirCodigoLivre(db, dados.provedor, dados.codigo);
  const ts = agora.toISOString();
  const r = db
    .prepare(
      `INSERT INTO modelos (provedor, codigo, nome, familia, nota_custo, nota_velocidade, nota_qualidade,
         contexto_tokens, tags_json, observacao, preco_entrada, preco_saida, preco_cache_leitura,
         preco_cache_escrita, ativo, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(...valores(dados), ts, ts);
  return obterModelo(db, Number(r.lastInsertRowid));
}

export function editarModelo(db: Banco, id: number, dados: EdicaoModelo, agora = new Date()): Modelo {
  const atual = obterModelo(db, id);
  const novo = { ...atual, ...dados };
  garantirCodigoLivre(db, novo.provedor, novo.codigo, id);
  db.prepare(
    `UPDATE modelos SET provedor = ?, codigo = ?, nome = ?, familia = ?, nota_custo = ?, nota_velocidade = ?,
       nota_qualidade = ?, contexto_tokens = ?, tags_json = ?, observacao = ?, preco_entrada = ?, preco_saida = ?,
       preco_cache_leitura = ?, preco_cache_escrita = ?, ativo = ?, atualizado_em = ?
     WHERE id = ?`
  ).run(...valores(novo), agora.toISOString(), id);
  return obterModelo(db, id);
}

export function excluirModelo(db: Banco, id: number) {
  obterModelo(db, id);
  db.prepare('DELETE FROM modelos WHERE id = ?').run(id);
}
