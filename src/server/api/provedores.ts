import { Hono } from 'hono';
import { z } from 'zod';

import { edicaoModeloSchema, edicaoProvedorSchema, idProvedorSchema, novoModeloSchema } from '../../shared/provedores.js';
import type { Variaveis } from '../app.js';
import { criarModelo, editarModelo, excluirModelo, listarModelos } from '../db/modelos.js';
import { editarProvedor, listarProvedores, obterProvedor } from '../db/provedores.js';
import { verificarProvedor, verificarTodos } from '../provedores/servico.js';
import { lerJson } from './util.js';

export function rotasProvedores() {
  const r = new Hono<Variaveis>();

  r.get('/', (c) => c.json(listarProvedores(c.get('db'))));

  r.post('/verificar', async (c) => c.json(await verificarTodos(c.get('db'), { env: c.get('env') })));

  r.get('/:id', (c) => c.json(obterProvedor(c.get('db'), idProvedorSchema.parse(c.req.param('id')))));

  // Salvar caminho ou ativo já dispara a verificação, para a tela mostrar o estado real.
  r.patch('/:id', async (c) => {
    const id = idProvedorSchema.parse(c.req.param('id'));
    const dados = edicaoProvedorSchema.parse(await lerJson(c.req.raw));
    editarProvedor(c.get('db'), id, dados);
    return c.json(await verificarProvedor(c.get('db'), id, { env: c.get('env') }));
  });

  r.post('/:id/verificar', async (c) => {
    const id = idProvedorSchema.parse(c.req.param('id'));
    return c.json(await verificarProvedor(c.get('db'), id, { env: c.get('env') }));
  });

  return r;
}

const idModeloSchema = z.coerce.number().int().positive();

export function rotasModelos() {
  const r = new Hono<Variaveis>();

  r.get('/', (c) => {
    const bruto = c.req.query('provedor');
    const provedor = bruto ? idProvedorSchema.parse(bruto) : undefined;
    return c.json(listarModelos(c.get('db'), provedor ? { provedor } : {}));
  });

  r.post('/', async (c) => {
    const dados = novoModeloSchema.parse(await lerJson(c.req.raw));
    return c.json(criarModelo(c.get('db'), dados), 201);
  });

  r.patch('/:id', async (c) => {
    const id = idModeloSchema.parse(c.req.param('id'));
    const dados = edicaoModeloSchema.parse(await lerJson(c.req.raw));
    return c.json(editarModelo(c.get('db'), id, dados));
  });

  r.delete('/:id', (c) => {
    excluirModelo(c.get('db'), idModeloSchema.parse(c.req.param('id')));
    return c.body(null, 204);
  });

  return r;
}
