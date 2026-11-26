import type { EdicaoProjeto, NovoProjeto, Projeto } from '../../shared/projetos.js';
import { normalizarRaiz } from '../caminhos.js';
import { ErroDominio } from '../erros.js';
import type { Banco } from './banco.js';

interface Linha {
  id: string;
  nome: string;
  raiz: string;
  criado_em: string;
  atualizado_em: string;
  arquivado_em: string | null;
}

function paraProjeto(l: Linha): Projeto {
  return {
    id: l.id,
    nome: l.nome,
    raiz: l.raiz,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    arquivadoEm: l.arquivado_em,
  };
}

export function listarProjetos(db: Banco, { incluirArquivados = false } = {}): Projeto[] {
  const sql = incluirArquivados
    ? 'SELECT * FROM projetos ORDER BY nome COLLATE NOCASE'
    : 'SELECT * FROM projetos WHERE arquivado_em IS NULL ORDER BY nome COLLATE NOCASE';
  return (db.prepare(sql).all() as unknown as Linha[]).map(paraProjeto);
}

export function obterProjeto(db: Banco, id: string): Projeto | null {
  const l = db.prepare('SELECT * FROM projetos WHERE id = ?').get(id) as unknown as Linha | undefined;
  return l ? paraProjeto(l) : null;
}

function projetoPorRaiz(db: Banco, raiz: string): Projeto | null {
  const l = db
    .prepare('SELECT * FROM projetos WHERE raiz = ? COLLATE NOCASE')
    .get(raiz) as unknown as Linha | undefined;
  return l ? paraProjeto(l) : null;
}

export function criarProjeto(db: Banco, dados: NovoProjeto, agora = new Date()): Projeto {
  const raiz = normalizarRaiz(dados.raiz);
  if (obterProjeto(db, dados.id)) {
    throw new ErroDominio('CONFLITO', `Já existe um projeto com o id "${dados.id}".`);
  }
  const outro = projetoPorRaiz(db, raiz);
  if (outro) {
    throw new ErroDominio('CONFLITO', `A pasta já pertence ao projeto "${outro.id}".`);
  }
  const ts = agora.toISOString();
  db.prepare(
    'INSERT INTO projetos (id, nome, raiz, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)'
  ).run(dados.id, dados.nome, raiz, ts, ts);
  return obterProjeto(db, dados.id)!;
}

export function editarProjeto(db: Banco, id: string, dados: EdicaoProjeto, agora = new Date()): Projeto {
  const atual = obterProjeto(db, id);
  if (!atual) throw new ErroDominio('NAO_ENCONTRADO', `Projeto "${id}" não encontrado.`);

  const nome = dados.nome ?? atual.nome;
  const raiz = dados.raiz !== undefined ? normalizarRaiz(dados.raiz) : atual.raiz;
  if (raiz.toLowerCase() !== atual.raiz.toLowerCase()) {
    const outro = projetoPorRaiz(db, raiz);
    if (outro && outro.id !== id) {
      throw new ErroDominio('CONFLITO', `A pasta já pertence ao projeto "${outro.id}".`);
    }
  }
  const ts = agora.toISOString();
  let arquivadoEm = atual.arquivadoEm;
  if (dados.arquivado === true && !arquivadoEm) arquivadoEm = ts;
  if (dados.arquivado === false) arquivadoEm = null;

  db.prepare(
    'UPDATE projetos SET nome = ?, raiz = ?, arquivado_em = ?, atualizado_em = ? WHERE id = ?'
  ).run(nome, raiz, arquivadoEm, ts, id);
  return obterProjeto(db, id)!;
}
