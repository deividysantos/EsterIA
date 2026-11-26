import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ADAPTADORES } from '../src/server/adaptadores/index.ts';
import type { EventoLido, Leitor } from '../src/server/adaptadores/tipos.ts';
import { extrairJson, LIMITE_LINHA_COMANDO } from '../src/server/adaptadores/util.ts';
import type { IdProvedor } from '../src/shared/provedores.ts';

const AMOSTRAS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'amostras');

function ler(provedor: IdProvedor, arquivo: string): { leitor: Leitor; eventos: EventoLido[] } {
  const leitor = ADAPTADORES[provedor].criarLeitor();
  const eventos: EventoLido[] = [];
  for (const l of fs.readFileSync(path.join(AMOSTRAS, arquivo), 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    eventos.push(...leitor.linha(JSON.parse(l) as Record<string, unknown>));
  }
  eventos.push(...leitor.finalizar());
  return { leitor, eventos };
}

const tipos = (ev: EventoLido[]) => ev.map((e) => e.tipo);

describe('adaptador Claude (amostra real)', () => {
  it('lê sessão, ferramentas, cota, resultado, custo e usage total', () => {
    const { leitor, eventos } = ler('claude', 'claude.ndjson');
    const e = leitor.estado;
    assert.equal(e.sessao, 'bfe965d7-e356-4e14-83e5-a31b94fa00e0');
    assert.equal(e.modelo, 'claude-haiku-5-5');
    assert.equal(e.sucesso, true);
    assert.equal(e.resultado, 'conteudo-secreto-42');
    assert.equal(e.custoUsd, 0.00451262);
    assert.equal(e.numTurnos, 2);
    assert.deepEqual(e.usage, { entrada: 4, saida: 312, cacheLeitura: 70142, cacheEscrita: 18274, raciocinio: 220 });
    assert.equal(e.ferramentas, 1);
    assert.deepEqual(
      tipos(eventos),
      ['inicio', 'ferramenta', 'limite', 'resultado_ferramenta', 'mensagem', 'resultado']
    );
    assert.match(eventos[1]!.resumo, /^Read C:\\exemplo\\a\.txt$/);
    const janelas = e.limites.map((l) => l.janela).sort();
    assert.deepEqual(janelas, ['five_hour', 'seven_day']);
    assert.equal(e.limites.find((l) => l.janela === 'five_hour')!.utilizacao, 0.49);
  });

  it('monta comando com prompt pela entrada padrão e modo de permissão', () => {
    const c = ADAPTADORES.claude.montarComando({ prompt: 'oi', modelo: 'claude-haiku-5-5', modo: 'leitura', sessao: 's1' });
    assert.equal(c.stdin, 'oi');
    assert.ok(!c.args.includes('oi'));
    assert.deepEqual(c.args.slice(-4), ['--permission-mode', 'plan', '--resume', 's1']);
    const w = ADAPTADORES.claude.montarComando({ prompt: 'oi', modelo: 'm', modo: 'escrita', sessao: null });
    assert.ok(w.args.includes('bypassPermissions'));
  });
});

describe('adaptador Cursor (amostra real)', () => {
  it('junta os deltas de raciocínio e lê usage do resultado', () => {
    const { leitor, eventos } = ler('cursor', 'cursor.ndjson');
    const e = leitor.estado;
    assert.equal(e.sessao, '342ca291-75e6-4e9f-804d-c9adcb448f53');
    assert.equal(e.sucesso, true);
    assert.deepEqual(e.usage, { entrada: 9970, saida: 256, cacheLeitura: 17152, cacheEscrita: 0, raciocinio: 182 });
    assert.equal(e.ultimaMensagem, 'O orquestrador não implementa código: ele planeja, delega e revisa.');
    const raciocinios = eventos.filter((x) => x.tipo === 'raciocinio');
    assert.equal(raciocinios.length, 2, 'um evento por bloco de pensamento, não por delta');
    assert.ok(eventos.some((x) => x.tipo === 'ferramenta' && x.resumo.startsWith('read ')));
    assert.equal(eventos.at(-1)!.tipo, 'resultado');
  });

  it('prompt longo vai pela entrada padrão com -p vazio', () => {
    const curto = ADAPTADORES.cursor.montarComando({ prompt: 'oi', modelo: 'm', modo: 'leitura', sessao: null });
    assert.deepEqual(curto.args.slice(0, 2), ['-p', 'oi']);
    assert.ok(curto.args.includes('plan') && !curto.args.includes('--force'));
    const grande = 'x'.repeat(LIMITE_LINHA_COMANDO + 1);
    const longo = ADAPTADORES.cursor.montarComando({ prompt: grande, modelo: 'm', modo: 'escrita', sessao: 'abc' });
    assert.equal(longo.stdin, grande);
    assert.equal(longo.args[0], '-p');
    assert.ok(!longo.args.includes(grande) && longo.args.includes('--force') && longo.args.includes('--resume'));
  });
});

describe('adaptador Antigravity (amostras reais)', () => {
  it('monta texto por passo, ferramentas e usage total do resultado', () => {
    const { leitor, eventos } = ler('antigravity', 'agy-ferramenta.ndjson');
    const e = leitor.estado;
    assert.equal(e.sessao, '5c0f7a58-fcc8-4029-9256-235d38565de9');
    assert.equal(e.modelo, 'gemini-4-neon-high');
    assert.equal(e.sucesso, true);
    assert.deepEqual(e.usage, { entrada: 12288, saida: 806, cacheLeitura: 8506, cacheEscrita: null, raciocinio: 690 });
    assert.deepEqual(tipos(eventos), ['inicio', 'ferramenta', 'resultado_ferramenta', 'mensagem', 'resultado']);
    assert.match(eventos.find((x) => x.tipo === 'mensagem')!.texto ?? eventos.find((x) => x.tipo === 'mensagem')!.resumo, /orquestrador/);
  });

  it('lê saída estruturada do --json-schema', () => {
    const { leitor } = ler('antigravity', 'agy.ndjson');
    assert.deepEqual(leitor.estado.estruturada, { aprovado: true, problemas: [] });
  });

  it('leitura sempre com --mode plan; prompt longo como evento stream-json', () => {
    const r = ADAPTADORES.antigravity.montarComando({ prompt: 'oi', modelo: 'm', modo: 'leitura', sessao: null, jsonSchemaArquivo: 's.json' });
    assert.ok(r.args.includes('plan') && !r.args.includes('--dangerously-skip-permissions'));
    assert.deepEqual(r.args.slice(-2), ['--json-schema', 's.json']);
    const grande = 'y'.repeat(LIMITE_LINHA_COMANDO + 1);
    const l = ADAPTADORES.antigravity.montarComando({ prompt: grande, modelo: 'm', modo: 'escrita', sessao: 'c1' });
    assert.ok(!l.args.includes('-p') && l.args.includes('--input-format') && l.args.includes('--conversation'));
    const payload = JSON.parse(l.stdin!.trim()) as { message: { content: { text: string }[] } };
    assert.equal(payload.message.content[0]!.text, grande);
  });
});

describe('adaptador Codex (amostra sintética)', () => {
  it('desconta o cache da entrada e coleta comandos e arquivos', () => {
    const { leitor, eventos } = ler('codex', 'codex-sintetico.ndjson');
    const e = leitor.estado;
    assert.equal(e.sessao, '0199a213-81c0-7800-8aa1-bbab2a035a53');
    assert.equal(e.sucesso, true);
    assert.deepEqual(e.usage, { entrada: 315, saida: 122, cacheLeitura: 24448, cacheEscrita: null, raciocinio: null });
    assert.deepEqual([...e.arquivos], ['b.txt']);
    assert.equal(e.resultado, 'conteudo-secreto-42');
    assert.deepEqual(tipos(eventos), ['inicio', 'raciocinio', 'ferramenta', 'resultado_ferramenta', 'ferramenta', 'mensagem', 'resultado']);
  });

  it('monta exec --json com sandbox e prompt por stdin', () => {
    const c = ADAPTADORES.codex.montarComando({ prompt: 'p', modelo: 'gpt-x', modo: 'leitura', sessao: 't1' });
    assert.deepEqual(c.args, ['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-x', '-s', 'read-only', 'resume', 't1', '-']);
    assert.equal(c.stdin, 'p');
  });

  it('falha do turno marca erro', () => {
    const leitor = ADAPTADORES.codex.criarLeitor();
    leitor.linha({ type: 'thread.started', thread_id: 't' });
    leitor.linha({ type: 'turn.failed', error: { message: 'limite atingido' } });
    leitor.finalizar();
    assert.equal(leitor.estado.sucesso, false);
    assert.equal(leitor.estado.erro, 'limite atingido');
  });
});

describe('extrairJson', () => {
  it('acha JSON em bloco, puro ou no meio do texto', () => {
    assert.deepEqual(extrairJson('ok\n```json\n{"a":1}\n```\nfim'), { a: 1 });
    assert.deepEqual(extrairJson('{"b":2}'), { b: 2 });
    assert.deepEqual(extrairJson('Parecer: {"aprovado": false, "problemas": []} pronto.'), { aprovado: false, problemas: [] });
    assert.equal(extrairJson('sem json aqui'), undefined);
    assert.equal(extrairJson(null), undefined);
  });
});
