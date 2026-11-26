import { Hono } from 'hono';

import { criteriosSchema } from '../../shared/criterios.js';
import { idProjetoSchema } from '../../shared/projetos.js';
import type { Variaveis } from '../app.js';
import { obterCriterios, salvarCriterios } from '../db/criterios.js';
import { obterProjeto } from '../db/projetos.js';
import { ErroDominio } from '../erros.js';
import { lerJson } from './util.js';

/** Montado em /api/projetos. */
export function rotasCriterios() {
  const r = new Hono<Variaveis>();

  const projeto = (bruto: string, db: Parameters<typeof obterProjeto>[0]) => {
    const id = idProjetoSchema.parse(bruto);
    if (!obterProjeto(db, id)) throw new ErroDominio('NAO_ENCONTRADO', `Projeto "${id}" não encontrado.`);
    return id;
  };

  r.get('/:id/criterios', (c) => c.json(obterCriterios(c.get('db'), projeto(c.req.param('id'), c.get('db')))));

  r.put('/:id/criterios', async (c) => {
    const id = projeto(c.req.param('id'), c.get('db'));
    return c.json(salvarCriterios(c.get('db'), id, criteriosSchema.parse(await lerJson(c.req.raw))));
  });

  /** Pontuação dos candidatos com os critérios salvos (GET) ou com os do corpo, sem salvar (POST). */
  r.get('/:id/criterios/previa', (c) => c.json(c.get('motor').previa(projeto(c.req.param('id'), c.get('db')))));
  r.post('/:id/criterios/previa', async (c) => {
    const id = projeto(c.req.param('id'), c.get('db'));
    return c.json(c.get('motor').previa(id, criteriosSchema.parse(await lerJson(c.req.raw))));
  });

  return r;
}
