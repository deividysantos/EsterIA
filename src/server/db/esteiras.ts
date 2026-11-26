import {
  definicaoSchema,
  validarEsteira,
  type Definicao,
  type EsteiraProjeto,
  type ModeloRef,
  type VersaoResumo,
} from '../../shared/esteiras.js';
import { ErroDominio } from '../erros.js';
import { transacao, type Banco } from './banco.js';
import { listarModelos } from './modelos.js';
import { listarProvedores } from './provedores.js';
import { obterProjeto } from './projetos.js';

export function referenciasModelos(db: Banco): ModeloRef[] {
  const habilitados = new Set(listarProvedores(db).filter((p) => p.habilitado).map((p) => p.id));
  return listarModelos(db).map((m) => ({
    id: m.id,
    nome: m.nome,
    familia: m.familia,
    ativo: m.ativo,
    disponivel: habilitados.has(m.provedor),
  }));
}

function garantirProjeto(db: Banco, projeto: string) {
  if (!obterProjeto(db, projeto)) throw new ErroDominio('NAO_ENCONTRADO', `Projeto "${projeto}" não encontrado.`);
}

/** Valida schema + regras; lança 400 com a lista de erros. */
export function validarParaSalvar(db: Banco, bruto: unknown): Definicao {
  const def = definicaoSchema.parse(bruto);
  const r = validarEsteira(def, referenciasModelos(db));
  if (r.erros.length) {
    throw new ErroDominio('VALIDACAO', r.erros.map((e) => e.mensagem).join(' '), r);
  }
  return def;
}

export function obterEsteira(db: Banco, projeto: string): EsteiraProjeto | null {
  garantirProjeto(db, projeto);
  const e = db.prepare('SELECT versao_atual, atualizado_em FROM esteiras WHERE projeto = ?').get(projeto) as
    | { versao_atual: number; atualizado_em: string }
    | undefined;
  if (!e) return null;
  const versoes = (
    db
      .prepare('SELECT n, nota, criado_em FROM esteira_versoes WHERE projeto = ? ORDER BY n DESC')
      .all(projeto) as unknown as { n: number; nota: string; criado_em: string }[]
  ).map<VersaoResumo>((v) => ({ n: v.n, nota: v.nota, criadoEm: v.criado_em }));
  return {
    projeto,
    versaoAtual: e.versao_atual,
    definicao: obterVersao(db, projeto, e.versao_atual),
    versoes,
    atualizadoEm: e.atualizado_em,
  };
}

export function obterVersao(db: Banco, projeto: string, n: number): Definicao {
  const v = db.prepare('SELECT definicao_json FROM esteira_versoes WHERE projeto = ? AND n = ?').get(projeto, n) as
    | { definicao_json: string }
    | undefined;
  if (!v) throw new ErroDominio('NAO_ENCONTRADO', `Versão ${n} da esteira de "${projeto}" não encontrada.`);
  return JSON.parse(v.definicao_json) as Definicao;
}

export function criarEsteira(db: Banco, projeto: string, def: Definicao, nota: string, agora = new Date()): EsteiraProjeto {
  garantirProjeto(db, projeto);
  if (obterEsteira(db, projeto)) throw new ErroDominio('CONFLITO', `O projeto "${projeto}" já tem esteira.`);
  const ts = agora.toISOString();
  transacao(db, () => {
    db.prepare('INSERT INTO esteiras (projeto, versao_atual, criado_em, atualizado_em) VALUES (?, 1, ?, ?)').run(projeto, ts, ts);
    db.prepare('INSERT INTO esteira_versoes (projeto, n, definicao_json, nota, criado_em) VALUES (?, 1, ?, ?, ?)').run(
      projeto,
      JSON.stringify(def),
      nota,
      ts
    );
  });
  return obterEsteira(db, projeto)!;
}

/**
 * Salva nova versão. Sem mudança na definição, devolve a atual sem criar versão.
 * Se outra versão foi salva depois de `versaoBase`, recusa (edição concorrente).
 */
export function salvarVersao(
  db: Banco,
  projeto: string,
  def: Definicao,
  nota: string,
  versaoBase: number,
  agora = new Date()
): { esteira: EsteiraProjeto; criouVersao: boolean } {
  const atual = obterEsteira(db, projeto);
  if (!atual) throw new ErroDominio('NAO_ENCONTRADO', `O projeto "${projeto}" ainda não tem esteira.`);
  if (versaoBase !== atual.versaoAtual) {
    throw new ErroDominio(
      'CONFLITO',
      `A esteira mudou enquanto você editava (você partiu da versão ${versaoBase}, a atual é ${atual.versaoAtual}). Recarregue e refaça a mudança.`
    );
  }
  if (JSON.stringify(def) === JSON.stringify(atual.definicao)) return { esteira: atual, criouVersao: false };
  const n = atual.versaoAtual + 1;
  const ts = agora.toISOString();
  transacao(db, () => {
    db.prepare('INSERT INTO esteira_versoes (projeto, n, definicao_json, nota, criado_em) VALUES (?, ?, ?, ?, ?)').run(
      projeto,
      n,
      JSON.stringify(def),
      nota,
      ts
    );
    db.prepare('UPDATE esteiras SET versao_atual = ?, atualizado_em = ? WHERE projeto = ?').run(n, ts, projeto);
  });
  return { esteira: obterEsteira(db, projeto)!, criouVersao: true };
}
