// Agente falso no formato stream-json do Claude Code, guiado por um roteiro (testes do motor).
//   FAKE_ROTEIRO  JSON: { "regras": [{ "se": "trecho do prompt", "resposta": "texto", "vezes": 1,
//                 "escrever": { "arquivo.txt": "conteúdo" }, "dormir": false, "falhar": false }] }
//                 A primeira regra cujo "se" aparece no prompt e que ainda tem "vezes" é usada.
//   FAKE_ESTADO   arquivo onde guarda quantas vezes cada regra foi usada
//   FAKE_REGISTRO arquivo onde acrescenta uma linha JSON por chamada: { argv, prompt, regra }
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (process.argv.includes('--version')) {
  process.stdout.write('agente-falso 1.0.0\n');
  process.exit(0);
}

let prompt = '';
process.stdin.setEncoding('utf8');
for await (const p of process.stdin) prompt += p;

const roteiro = JSON.parse(fs.readFileSync(process.env.FAKE_ROTEIRO, 'utf8'));
const estadoArq = process.env.FAKE_ESTADO;
const usados = estadoArq && fs.existsSync(estadoArq) ? JSON.parse(fs.readFileSync(estadoArq, 'utf8')) : {};
const idx = roteiro.regras.findIndex((r, i) => prompt.includes(r.se) && (r.vezes === undefined || (usados[i] ?? 0) < r.vezes));
if (idx >= 0) {
  usados[idx] = (usados[idx] ?? 0) + 1;
  if (estadoArq) fs.writeFileSync(estadoArq, JSON.stringify(usados));
}
const argv = process.argv.slice(2);
if (process.env.FAKE_REGISTRO) fs.appendFileSync(process.env.FAKE_REGISTRO, `${JSON.stringify({ argv, prompt, regra: idx })}\n`);

const iResume = argv.indexOf('--resume');
const sessao = iResume >= 0 ? argv[iResume + 1] : randomUUID();
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({ type: 'system', subtype: 'init', session_id: sessao, model: argv[argv.indexOf('--model') + 1] ?? 'falso' });

const regra = idx >= 0 ? roteiro.regras[idx] : { resposta: 'Sem regra para este prompt.' };
if (process.env.FAKE_ATRASO_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ATRASO_MS)));
if (regra.dormir) {
  setInterval(() => undefined, 1000);
  await new Promise((r) => setTimeout(r, 10 * 60_000));
}
for (const [arq, conteudo] of Object.entries(regra.escrever ?? {})) {
  const destino = path.resolve(process.cwd(), arq);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, conteudo);
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: destino } }] }, session_id: sessao });
}
out({ type: 'assistant', message: { content: [{ type: 'text', text: regra.resposta }] }, session_id: sessao });
out({
  type: 'result',
  subtype: regra.falhar ? 'error_during_execution' : 'success',
  is_error: !!regra.falhar,
  result: regra.resposta,
  session_id: sessao,
  num_turns: 1,
  total_cost_usd: 0.001,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
process.exit(regra.falhar ? 1 : 0);
