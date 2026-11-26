import { z } from 'zod';

/** Id de projeto: minúsculas, dígitos e hífen, começando por letra ou dígito, até 40 caracteres. */
export const idProjetoSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'use apenas [a-z0-9-], começando por letra ou dígito, até 40 caracteres');

export const novoProjetoSchema = z.object({
  id: idProjetoSchema,
  nome: z.string().trim().min(1, 'informe o nome').max(120),
  raiz: z.string().trim().min(1, 'informe a pasta raiz do projeto'),
});

export const edicaoProjetoSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    raiz: z.string().trim().min(1),
    arquivado: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'informe ao menos um campo');

export type NovoProjeto = z.infer<typeof novoProjetoSchema>;
export type EdicaoProjeto = z.infer<typeof edicaoProjetoSchema>;

export interface Projeto {
  id: string;
  nome: string;
  raiz: string;
  criadoEm: string;
  atualizadoEm: string;
  arquivadoEm: string | null;
}

export interface Saude {
  ok: true;
  versao: string;
  /** Commit com que o serviço subiu (null fora do git). */
  commit: string | null;
  esquema: number;
  banco: string;
  iniciadoEm: string;
}

export interface ErroApi {
  erro: string;
  codigo: string;
  detalhes?: unknown;
}
