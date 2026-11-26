export type CodigoErro = 'VALIDACAO' | 'NAO_ENCONTRADO' | 'CONFLITO' | 'ORIGEM_PROIBIDA' | 'INTERNO';

export const STATUS_POR_CODIGO: Record<CodigoErro, 400 | 403 | 404 | 409 | 500> = {
  VALIDACAO: 400,
  ORIGEM_PROIBIDA: 403,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  INTERNO: 500,
};

/** Erro de regra de negócio, convertido pela API no status HTTP correspondente. */
export class ErroDominio extends Error {
  constructor(
    readonly codigo: CodigoErro,
    mensagem: string,
    readonly detalhes?: unknown
  ) {
    super(mensagem);
    this.name = 'ErroDominio';
  }
}
