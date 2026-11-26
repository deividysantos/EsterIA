import { Hono } from 'hono';
import { z } from 'zod';

import { criarEsteiraSchema, salvarEsteiraSchema } from '../../shared/esteiras.js';
import { idProjetoSchema } from '../../shared/projetos.js';
import type { Variaveis } from '../app.js';
import { criarEsteira, obterEsteira, obterVersao, salvarVersao, validarParaSalvar } from '../db/esteiras.js';
import { listarModelos } from '../db/modelos.js';
import { ErroDominio } from '../erros.js';
import { esteiraPadrao } from '../esteiras/padrao.js';
import { lerJson } from './util.js';

/** Montado em /api/projetos: a esteira é sempre de um projeto. */
export function rotasEsteiras() {
  const r = new Hono<Variaveis>();

  r.get('/:id/esteira', (c) => {
    const id = idProjetoSchema.parse(c.req.param('id'));
    const e = obterEsteira(c.get('db'), id);
    if (!e) throw new ErroDominio('NAO_ENCONTRADO', `O projeto "${id}" ainda não tem esteira.`);
    return c.json(e);
  });

  r.post('/:id/esteira', async (c) => {
    const id = idProjetoSchema.parse(c.req.param('id'));
    const { origem } = criarEsteiraSchema.parse(await lerJson(c.req.raw));
    const db = c.get('db');
    if (obterEsteira(db, id)) throw new ErroDominio('CONFLITO', `O projeto "${id}" já tem esteira.`);
    let def;
    let nota: string;
    if (origem === 'padrao') {
      def = esteiraPadrao(listarModelos(db));
      nota = 'Criada a partir do modelo padrão.';
    } else {
      const outra = obterEsteira(db, idProjetoSchema.parse(origem.copiarDe));
      if (!outra) throw new ErroDominio('VALIDACAO', `O projeto "${origem.copiarDe}" não tem esteira para copiar.`);
      def = outra.definicao;
      nota = `Copiada da versão ${outra.versaoAtual} de "${origem.copiarDe}".`;
    }
    return c.json(criarEsteira(db, id, validarParaSalvar(db, def), nota), 201);
  });

  r.put('/:id/esteira', async (c) => {
    const id = idProjetoSchema.parse(c.req.param('id'));
    const corpo = salvarEsteiraSchema.parse(await lerJson(c.req.raw));
    const db = c.get('db');
    const def = validarParaSalvar(db, corpo.definicao);
    const r2 = salvarVersao(db, id, def, corpo.nota, corpo.versaoBase);
    return c.json(r2.esteira, r2.criouVersao ? 201 : 200);
  });

  r.get('/:id/esteira/versoes/:n', (c) => {
    const id = idProjetoSchema.parse(c.req.param('id'));
    const n = z.coerce.number().int().min(1).parse(c.req.param('n'));
    return c.json(obterVersao(c.get('db'), id, n));
  });

  return r;
}
