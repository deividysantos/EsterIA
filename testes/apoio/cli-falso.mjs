// CLI falso usado nos testes do executor. Comportamento controlado por variáveis de ambiente:
//   FAKE_MODO      replay (padrão) | dormir | falhar
//   FAKE_ARQUIVO   NDJSON reproduzido no modo replay
//   FAKE_ATRASO_MS atraso entre linhas no replay
//   FAKE_REGISTRO  arquivo onde grava { argv, stdin, cwd } para conferência
import fs from 'node:fs';

if (process.argv.includes('--version')) {
  process.stdout.write('cli-falso 1.0.0\n');
  process.exit(0);
}

const modo = process.env.FAKE_MODO ?? 'replay';
const atraso = Number(process.env.FAKE_ATRASO_MS ?? 0);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function lerStdin() {
  if (process.stdin.isTTY) return '';
  let t = '';
  process.stdin.setEncoding('utf8');
  for await (const p of process.stdin) t += p;
  return t;
}

const stdin = await lerStdin();
if (process.env.FAKE_REGISTRO) {
  fs.writeFileSync(process.env.FAKE_REGISTRO, JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
}

if (modo === 'falhar') {
  process.stdout.write('isto não é json\n');
  process.stderr.write('falha simulada: credencial ausente\n');
  process.exit(2);
}

if (modo === 'dormir') {
  process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sessao-dormindo', model: 'falso' })}\n`);
  setInterval(() => undefined, 1000);
  await dormir(10 * 60_000);
  process.exit(0);
}

const linhas = fs.readFileSync(process.env.FAKE_ARQUIVO, 'utf8').split(/\r?\n/).filter(Boolean);
for (const l of linhas) {
  process.stdout.write(`${l}\n`);
  if (atraso) await dormir(atraso);
}
process.exit(Number(process.env.FAKE_CODIGO ?? 0));
