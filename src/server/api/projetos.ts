import { Hono } from 'hono';

import { edicaoProjetoSchema, idProjetoSchema, novoProjetoSchema } from '../../shared/projetos.js';
import type { Variaveis } from '../app.js';
import { criarProjeto, editarProjeto, listarProjetos, obterProjeto } from '../db/projetos.js';
import { ErroDominio } from '../erros.js';

async function lerJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ErroDominio('VALIDACAO', 'Corpo da requisição não é um JSON válido.');
  }
}

export function rotasProjetos() {
  const r = new Hono<Variaveis>();

  r.get('/', (c) => {
    const incluirArquivados = c.req.query('arquivados') === '1';
    return c.json(listarProjetos(c.get('db'), { incluirArquivados }));
  });

  r.post('/', async (c) => {
    const dados = novoProjetoSchema.parse(await lerJson(c.req.raw));
    return c.json(criarProjeto(c.get('db'), dados), 201);
  });

  r.get('/:id', (c) => {
    const id = idProjetoSchema.parse(c.req.param('id'));
    const p = obterProjeto(c.get('db'), id);
    if (!p) throw new ErroDominio('NAO_ENCONTRADO', `Projeto "${id}" não encontrado.`);
    return c.json(p);
  });

  r.patch('/:id', async (c) => {
    const id = idProjetoSchema.parse(c.req.param('id'));
    const dados = edicaoProjetoSchema.parse(await lerJson(c.req.raw));
    return c.json(editarProjeto(c.get('db'), id, dados));
  });

  return r;
}
