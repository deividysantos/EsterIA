#!/usr/bin/env node
// Ponto de entrada instalado. Usa o build em dist/ (rode "npm run build").
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// node:sqlite ainda emite ExperimentalWarning no Node 22; os demais avisos continuam aparecendo.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const entrada = new URL('../dist/cli/painel.js', import.meta.url);
if (!fs.existsSync(fileURLToPath(entrada))) {
  console.error('Build não encontrado. Rode "npm run build" na pasta do painel.');
  process.exit(1);
}

const { executar } = await import(entrada.href);
process.exit(await executar(process.argv.slice(2)));
