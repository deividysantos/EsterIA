import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import { idProjetoSchema } from '../../shared/projetos.js';
import { idProvedorSchema } from '../../shared/provedores.js';
import { novoRunSchema, type MensagemAoVivo } from '../../shared/runs.js';
import type { Variaveis } from '../app.js';
import { brutoEvento, detalharRun, listarRuns } from '../db/runs.js';
import { relatorioUsage } from '../db/usage.js';
import { lerJson } from './util.js';

const estadoSchema = z.enum(['rodando', 'concluido', 'falhou', 'cancelado', 'interrompido']);

export function rotasRuns() {
  const r = new Hono<Variaveis>();

  r.get('/', (c) => {
    const q = c.req.query();
    return c.json(
      listarRuns(c.get('db'), {
        ...(q.projeto ? { projeto: idProjetoSchema.parse(q.projeto) } : {}),
        ...(q.provedor ? { provedor: idProvedorSchema.parse(q.provedor) } : {}),
        ...(q.estado ? { estado: estadoSchema.parse(q.estado) } : {}),
        ...(q.limite ? { limite: z.coerce.number().int().parse(q.limite) } : {}),
      })
    );
  });

  r.post('/', async (c) => {
    const dados = novoRunSchema.parse(await lerJson(c.req.raw));
    return c.json(c.get('executor').iniciar(dados), 201);
  });

  r.get('/:id', (c) => {
    const apos = z.coerce.number().int().min(0).default(0).parse(c.req.query('apos') ?? 0);
    return c.json(detalharRun(c.get('db'), c.req.param('id'), apos));
  });

  r.get('/:id/eventos/:seq/bruto', (c) =>
    c.json(brutoEvento(c.get('db'), c.req.param('id'), z.coerce.number().int().parse(c.req.param('seq'))) ?? null)
  );

  r.post('/:id/cancelar', (c) => c.json(c.get('executor').cancelar(c.req.param('id'))));

  return r;
}

export function rotasUsage() {
  const r = new Hono<Variaveis>();
  r.get('/', (c) => {
    const dias = z.coerce.number().int().min(0).max(3650).default(30).parse(c.req.query('dias') ?? 30);
    const projeto = c.req.query('projeto');
    const desde = dias === 0 ? null : new Date(Date.now() - dias * 86_400_000).toISOString();
    return c.json(relatorioUsage(c.get('db'), { desde, projeto: projeto ? idProjetoSchema.parse(projeto) : null }));
  });
  return r;
}

/** Server-Sent Events com as mudanças de runs e os eventos novos. */
export function rotaAoVivo() {
  const r = new Hono<Variaveis>();
  r.get('/', (c) =>
    streamSSE(c, async (stream) => {
      const fila: MensagemAoVivo[] = [];
      let acordar: (() => void) | null = null;
      const cancelar = c.get('aoVivo').assinar((m) => {
        fila.push(m);
        acordar?.();
      });
      let aberto = true;
      stream.onAbort(() => {
        aberto = false;
        acordar?.();
      });
      try {
        await stream.writeSSE({ event: 'pronto', data: '{}' });
        while (aberto) {
          while (fila.length && aberto) {
            const m = fila.shift()!;
            await stream.writeSSE({ event: m.tipo, data: JSON.stringify(m) });
          }
          if (!aberto) break;
          // Espera mensagem nova ou 20 s para o ping que mantém a conexão viva.
          await new Promise<void>((res) => {
            const t = setTimeout(res, 20_000);
            acordar = () => {
              clearTimeout(t);
              res();
            };
          });
          acordar = null;
          if (aberto && !fila.length) await stream.writeSSE({ event: 'ping', data: '{}' });
        }
      } finally {
        cancelar();
      }
    })
  );
  return r;
}
