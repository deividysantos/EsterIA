import fs from 'node:fs';
import path from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { ErroApi, Saude } from '../shared/projetos.js';
import { rotasProjetos } from './api/projetos.js';
import { versaoEsquema, type Banco } from './db/banco.js';
import { ErroDominio, STATUS_POR_CODIGO } from './erros.js';
import { VERSAO } from './versao.js';

export interface OpcoesApp {
  db: Banco;
  caminhoBanco: string;
  /** Pasta com o build da interface (`dist/web`). Sem ela, só a API responde. */
  webDir?: string | null;
  iniciadoEm?: Date;
}

export type Variaveis = { Variables: { db: Banco } };

const HOSTS_LOCAIS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostLocal(valor: string | undefined | null): boolean {
  if (!valor) return false;
  try {
    return HOSTS_LOCAIS.has(new URL(`http://${valor}`).hostname);
  } catch {
    return false;
  }
}

function origemLocal(origem: string): boolean {
  try {
    const u = new URL(origem);
    return (u.protocol === 'http:' || u.protocol === 'https:') && HOSTS_LOCAIS.has(u.hostname);
  } catch {
    return false;
  }
}

export function responderErro(c: Context, err: unknown) {
  if (err instanceof ErroDominio) {
    const corpo: ErroApi = { erro: err.message, codigo: err.codigo };
    if (err.detalhes !== undefined) corpo.detalhes = err.detalhes;
    return c.json(corpo, STATUS_POR_CODIGO[err.codigo]);
  }
  if (err instanceof z.ZodError) {
    const corpo: ErroApi = {
      erro: err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; '),
      codigo: 'VALIDACAO',
      detalhes: err.issues,
    };
    return c.json(corpo, 400);
  }
  console.error('[painel] erro interno:', err);
  return c.json({ erro: 'Erro interno do servidor.', codigo: 'INTERNO' } satisfies ErroApi, 500);
}

export function criarApp(opcoes: OpcoesApp): Hono<Variaveis> {
  const { db, caminhoBanco } = opcoes;
  const iniciadoEm = (opcoes.iniciadoEm ?? new Date()).toISOString();
  const app = new Hono<Variaveis>();

  app.onError((err, c) => responderErro(c, err));

  // A API só atende pelo host local (contra DNS rebinding) e só aceita escrita de páginas locais.
  app.use('/api/*', async (c, next) => {
    if (!hostLocal(c.req.header('host'))) {
      throw new ErroDominio('ORIGEM_PROIBIDA', 'Host não permitido.');
    }
    const origem = c.req.header('origin');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origem && !origemLocal(origem)) {
      throw new ErroDominio('ORIGEM_PROIBIDA', 'Origem não permitida.');
    }
    c.set('db', db);
    await next();
  });

  app.get('/api/saude', (c) => {
    const corpo: Saude = {
      ok: true,
      versao: VERSAO,
      esquema: versaoEsquema(db),
      banco: caminhoBanco,
      iniciadoEm,
    };
    return c.json(corpo);
  });

  app.route('/api/projetos', rotasProjetos());

  app.all('/api/*', (c) =>
    c.json({ erro: 'Rota não encontrada.', codigo: 'NAO_ENCONTRADO' } satisfies ErroApi, 404)
  );

  const webDir = opcoes.webDir;
  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    const indexHtml = path.join(webDir, 'index.html');
    app.use('/*', serveStatic({ root: webDir }));
    // Rotas da SPA: qualquer GET que não seja arquivo devolve o index.html.
    app.get('*', (c) => c.html(fs.readFileSync(indexHtml, 'utf8')));
  } else {
    app.get('/', (c) =>
      c.text('Interface não compilada. Rode "npm run build" ou use "npm run dev:web".', 503)
    );
  }

  return app;
}
