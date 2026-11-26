import { ErroDominio } from '../erros.js';

export async function lerJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ErroDominio('VALIDACAO', 'Corpo da requisição não é um JSON válido.');
  }
}
