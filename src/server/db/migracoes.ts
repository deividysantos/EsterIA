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
  {
    versao: 3,
    nome: 'runs, eventos e limites',
    aplicar(db) {
      db.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          projeto TEXT REFERENCES projetos(id) ON DELETE SET NULL,
          provedor TEXT NOT NULL REFERENCES provedores(id),
          modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
          modelo_codigo TEXT NOT NULL,
          modelo_nome TEXT NOT NULL,
          familia TEXT NOT NULL,
          papel TEXT NOT NULL DEFAULT 'avulso',
          modo TEXT NOT NULL CHECK (modo IN ('leitura', 'escrita')),
          cwd TEXT NOT NULL,
          prompt TEXT NOT NULL,
          comando_json TEXT NOT NULL DEFAULT '[]',
          sessao_retomada TEXT,
          sessao TEXT,
          modelo_reportado TEXT,
          pid INTEGER,
          estado TEXT NOT NULL CHECK (estado IN ('rodando', 'concluido', 'falhou', 'cancelado', 'interrompido')),
          codigo_saida INTEGER,
          erro TEXT,
          inicio TEXT NOT NULL,
          fim TEXT,
          duracao_ms INTEGER,
          tokens_entrada INTEGER,
          tokens_saida INTEGER,
          tokens_cache_leitura INTEGER,
          tokens_cache_escrita INTEGER,
          tokens_raciocinio INTEGER,
          num_turnos INTEGER,
          custo_usd REAL,
          custo_origem TEXT CHECK (custo_origem IN ('cli', 'estimado')),
          resultado_texto TEXT,
          saida_estruturada_json TEXT,
          contagem_mensagens INTEGER NOT NULL DEFAULT 0,
          contagem_ferramentas INTEGER NOT NULL DEFAULT 0,
          arquivos_json TEXT NOT NULL DEFAULT '[]',
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL
        ) STRICT;

        CREATE INDEX idx_runs_inicio ON runs(inicio DESC);
        CREATE INDEX idx_runs_projeto ON runs(projeto, inicio DESC);
        CREATE INDEX idx_runs_modelo ON runs(provedor, modelo_codigo, inicio);
        CREATE INDEX idx_runs_estado ON runs(estado);

        CREATE TABLE eventos (
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          ts TEXT NOT NULL,
          tipo TEXT NOT NULL,
          resumo TEXT NOT NULL,
          texto TEXT,
          bruto_json TEXT,
          PRIMARY KEY (run_id, seq)
        ) STRICT;

        CREATE TABLE run_stderr (
          run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
          texto TEXT NOT NULL,
          truncado INTEGER NOT NULL DEFAULT 0
        ) STRICT;

        CREATE TABLE limites_snapshots (
          id INTEGER PRIMARY KEY,
          provedor TEXT NOT NULL REFERENCES provedores(id),
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          janela TEXT NOT NULL,
          utilizacao REAL,
          status TEXT,
          reinicia_em TEXT,
          capturado_em TEXT NOT NULL
        ) STRICT;

        CREATE INDEX idx_limites ON limites_snapshots(provedor, janela, capturado_em DESC);
      `);
    },
  },
  {
    versao: 4,
    nome: 'esteiras versionadas',
    aplicar(db) {
      db.exec(`
        CREATE TABLE esteiras (
          projeto TEXT PRIMARY KEY REFERENCES projetos(id) ON DELETE CASCADE,
          versao_atual INTEGER NOT NULL,
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL
        ) STRICT;

        -- Versões são imutáveis: cada problema guarda a versão com que começou.
        CREATE TABLE esteira_versoes (
          id INTEGER PRIMARY KEY,
          projeto TEXT NOT NULL REFERENCES esteiras(projeto) ON DELETE CASCADE,
          n INTEGER NOT NULL,
          definicao_json TEXT NOT NULL,
          nota TEXT NOT NULL DEFAULT '',
          criado_em TEXT NOT NULL,
          UNIQUE (projeto, n)
        ) STRICT;
      `);
    },
  },
  {
    versao: 5,
    nome: 'problemas, tarefas, execuções e configurações',
    aplicar(db) {
      db.exec(`
        CREATE TABLE problemas (
          id TEXT PRIMARY KEY,
          projeto TEXT NOT NULL REFERENCES projetos(id),
          numero INTEGER NOT NULL,
          titulo TEXT NOT NULL,
          descricao TEXT NOT NULL,
          estado TEXT NOT NULL CHECK (estado IN ('em_andamento', 'aguardando', 'bloqueado', 'pausado', 'concluido', 'cancelado')),
          esteira_versao INTEGER NOT NULL,
          fase TEXT NOT NULL DEFAULT 'antes' CHECK (fase IN ('antes', 'tarefas', 'depois', 'fim')),
          indice INTEGER NOT NULL DEFAULT 0,
          plano_json TEXT,
          respostas_json TEXT NOT NULL DEFAULT '[]',
          contadores_json TEXT NOT NULL DEFAULT '{}',
          feedback TEXT,
          motivo TEXT,
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL,
          concluido_em TEXT,
          UNIQUE (projeto, numero),
          FOREIGN KEY (projeto, esteira_versao) REFERENCES esteira_versoes(projeto, n)
        ) STRICT;

        CREATE INDEX idx_problemas_estado ON problemas(estado);

        CREATE TABLE tarefas (
          id INTEGER PRIMARY KEY,
          problema TEXT NOT NULL REFERENCES problemas(id) ON DELETE CASCADE,
          codigo TEXT NOT NULL,
          titulo TEXT NOT NULL,
          descricao TEXT NOT NULL,
          revisao_independente INTEGER NOT NULL DEFAULT 1,
          depende_de_json TEXT NOT NULL DEFAULT '[]',
          modelos_json TEXT NOT NULL DEFAULT '{}',
          justificativa TEXT NOT NULL DEFAULT '',
          ordem INTEGER NOT NULL,
          estado TEXT NOT NULL CHECK (estado IN ('pendente', 'em_andamento', 'bloqueada', 'concluida', 'cancelada')),
          indice_etapa INTEGER NOT NULL DEFAULT 0,
          contadores_json TEXT NOT NULL DEFAULT '{}',
          feedback TEXT,
          base_git_json TEXT,
          arquivos_json TEXT NOT NULL DEFAULT '[]',
          commit_hash TEXT,
          motivo TEXT,
          criado_em TEXT NOT NULL,
          atualizado_em TEXT NOT NULL,
          UNIQUE (problema, codigo)
        ) STRICT;

        CREATE TABLE execucoes (
          id INTEGER PRIMARY KEY,
          problema TEXT NOT NULL REFERENCES problemas(id) ON DELETE CASCADE,
          tarefa_id INTEGER REFERENCES tarefas(id) ON DELETE CASCADE,
          etapa_id TEXT NOT NULL,
          etapa_nome TEXT NOT NULL,
          tipo TEXT NOT NULL,
          tentativa INTEGER NOT NULL,
          estado TEXT NOT NULL CHECK (estado IN ('rodando', 'aguardando', 'concluida', 'reprovada', 'falhou', 'pulada', 'cancelada', 'respondida')),
          espera TEXT CHECK (espera IN ('aprovacao', 'perguntas')),
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
          modelo_nome TEXT,
          motivo_escolha TEXT,
          feedback TEXT,
          saida_texto TEXT,
          saida_json TEXT,
          erro TEXT,
          inicio TEXT NOT NULL,
          fim TEXT
        ) STRICT;

        CREATE INDEX idx_execucoes_problema ON execucoes(problema, id);
        CREATE INDEX idx_execucoes_estado ON execucoes(estado);

        ALTER TABLE runs ADD COLUMN problema TEXT REFERENCES problemas(id) ON DELETE SET NULL;
        ALTER TABLE runs ADD COLUMN execucao_id INTEGER REFERENCES execucoes(id) ON DELETE SET NULL;

        CREATE TABLE configuracoes (
          chave TEXT PRIMARY KEY,
          valor_json TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    versao: 6,
    nome: 'critérios de escolha e decisões',
    aplicar(db) {
      db.exec(`
        CREATE TABLE criterios (
          projeto TEXT PRIMARY KEY REFERENCES projetos(id) ON DELETE CASCADE,
          criterios_json TEXT NOT NULL,
          atualizado_em TEXT NOT NULL
        ) STRICT;

        -- Uma linha por escolha de modelo: candidatos, pontuação de cada um e por que o escolhido venceu.
        CREATE TABLE decisoes (
          id INTEGER PRIMARY KEY,
          execucao_id INTEGER NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
          etapa_id TEXT NOT NULL,
          papel TEXT,
          origem TEXT NOT NULL CHECK (origem IN ('plano', 'pontuacao', 'fixo', 'escalada')),
          pedido_pelo_plano TEXT,
          escolhido_id INTEGER NOT NULL,
          motivo TEXT NOT NULL,
          candidatos_json TEXT NOT NULL,
          criterios_json TEXT NOT NULL,
          criado_em TEXT NOT NULL
        ) STRICT;

        CREATE INDEX idx_decisoes_execucao ON decisoes(execucao_id);
      `);
    },
  },
  {
    versao: 7,
    nome: 'itens de parecer',
    aplicar(db) {
      db.exec(`
        CREATE TABLE parecer_itens (
          id INTEGER PRIMARY KEY,
          execucao_id INTEGER NOT NULL REFERENCES execucoes(id) ON DELETE CASCADE,
          indice INTEGER NOT NULL,
          arquivo TEXT NOT NULL DEFAULT '',
          linha INTEGER,
          severidade TEXT NOT NULL CHECK (severidade IN ('alta', 'media', 'baixa')),
          descricao TEXT NOT NULL DEFAULT '',
          sugestao TEXT NOT NULL DEFAULT '',
          decisao TEXT CHECK (decisao IN ('procede', 'nao_procede')),
          decidido_em TEXT,
          UNIQUE (execucao_id, indice)
        ) STRICT;
      `);
      // Pareceres gravados antes desta versão viram itens (sem avaliação).
      const ins = db.prepare(
        'INSERT INTO parecer_itens (execucao_id, indice, arquivo, linha, severidade, descricao, sugestao) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const linhas = db
        .prepare("SELECT id, saida_json FROM execucoes WHERE tipo IN ('revisar', 'criticar_plano', 'prompt_livre') AND saida_json IS NOT NULL")
        .all() as { id: number; saida_json: string }[];
      for (const l of linhas) {
        let p: { aprovado?: unknown; problemas?: unknown };
        try {
          p = JSON.parse(l.saida_json);
        } catch {
          continue;
        }
        if (typeof p?.aprovado !== 'boolean' || !Array.isArray(p.problemas)) continue;
        p.problemas.forEach((x: Record<string, unknown>, i: number) => {
          const sev = ['alta', 'media', 'baixa'].includes(String(x?.severidade)) ? String(x.severidade) : 'media';
          ins.run(l.id, i, String(x?.arquivo ?? ''), typeof x?.linha === 'number' ? x.linha : null, sev, String(x?.descricao ?? ''), String(x?.sugestao ?? ''));
        });
      }
    },
  },
];

export const VERSAO_ESQUEMA = MIGRACOES.at(-1)?.versao ?? 0;
