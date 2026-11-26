import path from 'node:path';

import { ErroDominio } from './erros.js';

/** Resolve a pasta e tira a barra final (preservando a raiz do drive). Exige caminho absoluto. */
export function normalizarRaiz(raiz: string): string {
  const bruto = raiz.trim();
  if (!bruto || !path.isAbsolute(bruto)) {
    throw new ErroDominio('VALIDACAO', 'A pasta raiz do projeto precisa ser um caminho absoluto.');
  }
  let r = path.resolve(bruto);
  const { root } = path.parse(r);
  while (r.length > root.length && /[\\/]$/.test(r)) r = r.slice(0, -1);
  return r;
}
