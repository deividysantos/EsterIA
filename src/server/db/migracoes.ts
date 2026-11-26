import type { DatabaseSync } from 'node:sqlite';

export interface Migracao {
  versao: number;
  nome: string;
  aplicar(db: DatabaseSync): void;
}

/**
 * Migrações em ordem. Cada uma roda numa transação e avança `PRAGMA user_version`.
 * Nunca altere uma migração já publicada: crie a próxima.
 */
export const MIGRACOES: readonly Migracao[] = [
  {
    versao: 1,
    nome: 'projetos',
    aplicar(db) {
      db.exec(`
        CREATE TABLE projetos (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          raiz TEXT NOT NULL,
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL,
          arquivado_em TEXT
        ) STRICT;

        CREATE UNIQUE INDEX idx_projetos_raiz ON projetos(raiz COLLATE NOCASE);
      `);
    },
  },
  {
    versao: 2,
    nome: 'provedores e modelos',
    aplicar(db) {
      db.exec(`
        CREATE TABLE provedores (
          id TEXT PRIMARY KEY CHECK (id IN ('claude', 'cursor', 'antigravity', 'codex')),
          nome TEXT NOT NULL,
          caminho TEXT,
          caminho_detectado TEXT,
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
          versao TEXT,
          saida_versao TEXT,
          erro TEXT,
          verificado_em TEXT,
          caminho_verificado TEXT,
          ok INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0, 1)),
          atualizado_em TEXT NOT NULL
        ) STRICT;

        CREATE TABLE modelos (
          id INTEGER PRIMARY KEY,
          provedor TEXT NOT NULL REFERENCES provedores(id),
          codigo TEXT NOT NULL,
          nome TEXT NOT NULL,
          familia TEXT NOT NULL,
          nota_custo INTEGER CHECK (nota_custo BETWEEN 1 AND 5),
          nota_velocidade INTEGER CHECK (nota_velocidade BETWEEN 1 AND 5),
          nota_qualidade INTEGER CHECK (nota_qualidade BETWEEN 1 AND 5),
          contexto_tokens INTEGER,
          tags_json TEXT NOT NULL DEFAULT '[]',
          observacao TEXT NOT NULL DEFAULT '',
          preco_entrada REAL,
          preco_saida REAL,
          preco_cache_leitura REAL,
          preco_cache_escrita REAL,
          ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL,
          UNIQUE (provedor, codigo)
        ) STRICT;
      `);

      const agora = new Date().toISOString();
      const insProv = db.prepare('INSERT INTO provedores (id, nome, atualizado_em) VALUES (?, ?, ?)');
      for (const [id, nome] of [
        ['claude', 'Claude Code'],
        ['cursor', 'Cursor'],
        ['antigravity', 'Antigravity'],
        ['codex', 'Codex'],
      ]) {
        insProv.run(id!, nome!, agora);
      }

      // Catálogo inicial: os modelos usados no v1 e os Claude atuais. Tudo editável na interface.
      const insMod = db.prepare(`
        INSERT INTO modelos (provedor, codigo, nome, familia, tags_json, observacao, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Notas (custo, velocidade, qualidade) ficam vazias: são preenchidas por quem conhece os modelos.
      const sementes: [string, string, string, string, string[], string][] = [
        ['claude', 'claude-opus-5-5', 'Claude Opus 5.5', 'claude', ['orquestracao', 'revisao'], ''],
        ['claude', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 'claude', ['execucao'], ''],
        ['claude', 'claude-haiku-5-5', 'Claude Haiku 5.5', 'claude', ['trivial'], ''],
        ['claude', 'claude-fable-5-2', 'Claude Fable 5.2', 'claude', ['orquestracao'], ''],
        ['cursor', 'cursor-grok-4.6-high', 'Grok 4.6 high', 'grok', ['execucao', 'mecanica'], 'Executor padrão para tarefas diretas.'],
        ['cursor', 'cursor-grok-4.6-xhigh', 'Grok 4.6 xhigh', 'grok', ['revisao', 'retentativa'], 'Revisor do código do Hydrogen; 2ª e 3ª tentativas.'],
        ['cursor', 'cursor-grok-4.6-medium-fast', 'Grok 4.6 medium fast', 'grok', ['trivial'], 'Tarefas triviais.'],
        ['antigravity', 'gemini-4-hydrogen-high', 'Gemini 4 Hydrogen high', 'gemini', ['execucao', 'regra-de-negocio'], 'Testa o próprio código; bom com casos de borda.'],
        ['antigravity', 'gemini-4-neon-high', 'Gemini 4 Neon high', 'gemini', ['revisao'], 'Revisor do código do Grok.'],
        ['antigravity', 'gemini-4-argon-high', 'Gemini 4 Argon high', 'gemini', ['critica-de-plano'], 'Crítico do plano.'],
      ];
      for (const [prov, codigo, nome, fam, tags, obs] of sementes) {
        insMod.run(prov, codigo, nome, fam, JSON.stringify(tags), obs, agora, agora);
      }
    },
  },
];

export const VERSAO_ESQUEMA = MIGRACOES.at(-1)?.versao ?? 0;
