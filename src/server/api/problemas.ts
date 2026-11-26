import { Hono } from 'hono';
import { z } from 'zod';

import { acaoProblemaSchema, decisaoSchema, limitesSchema, novoProblemaSchema, type DetalheProblema, type EstadoProblema } from '../../shared/problemas.js';
import { idProjetoSchema } from '../../shared/projetos.js';
import type { Variaveis } from '../app.js';
import { listarExecucoes, listarProblemas, listarTarefas, obterProblema, resumoProblema } from '../db/problemas.js';
import { decisoesDoProblema } from '../db/criterios.js';
import { lerJson } from './util.js';

const estadoSchema = z.enum(['em_andamento', 'aguardando', 'bloqueado', 'pausado', 'concluido', 'cancelado']);

export function rotasProblemas() {
  const r = new Hono<Variaveis>();

  r.get('/', (c) => {
    const projeto = c.req.query('projeto');
    const estado = c.req.query('estado');
    return c.json(
      listarProblemas(c.get('db'), {
        ...(projeto ? { projeto: idProjetoSchema.parse(projeto) } : {}),
        ...(estado ? { estado: estadoSchema.parse(estado) as EstadoProblema } : {}),
      })
    );
  });

  r.post('/', async (c) => c.json(c.get('motor').criarProblema(novoProblemaSchema.parse(await lerJson(c.req.raw))), 201));

  r.get('/:id', (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const p = obterProblema(db, id);
    const corpo: DetalheProblema = {
      problema: resumoProblema(db, id),
      definicao: c.get('motor').definicao(p),
      tarefas: listarTarefas(db, id).map(({ contadores: _c, feedback: _f, baseGit: _b, ...t }) => t),
      execucoes: listarExecucoes(db, id),
      decisoes: decisoesDoProblema(db, id),
    };
    return c.json(corpo);
  });

  r.post('/:id/acoes', async (c) => {
    const { acao } = acaoProblemaSchema.parse(await lerJson(c.req.raw));
    return c.json(c.get('motor').acao(c.req.param('id'), acao));
  });

  return r;
}

export function rotasExecucoes() {
  const r = new Hono<Variaveis>();
  r.post('/:id/decisao', async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param('id'));
    const d = decisaoSchema.parse(await lerJson(c.req.raw));
    return c.json(await c.get('motor').decidirExecucao(id, d));
  });
  return r;
}

export function rotasFila() {
  const r = new Hono<Variaveis>();
  r.get('/', (c) => c.json(c.get('motor').estadoFila()));
  r.put('/limites', async (c) => c.json(c.get('motor').definirLimites(limitesSchema.parse(await lerJson(c.req.raw)))));
  return r;
}
