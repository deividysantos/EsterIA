import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Versão do pacote (lida do package.json, que fica dois níveis acima tanto em src/ quanto em dist/). */
export const VERSAO: string = (require('../../package.json') as { version: string }).version;
