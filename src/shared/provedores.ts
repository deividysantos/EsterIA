import { z } from 'zod';

/** Os CLIs suportados. A lista é fixa: cada um tem um adaptador próprio no servidor. */
export const ID_PROVEDORES = ['claude', 'cursor', 'antigravity', 'codex'] as const;
export const idProvedorSchema = z.enum(ID_PROVEDORES);
export type IdProvedor = z.infer<typeof idProvedorSchema>;

/**
 * - `habilitado`: caminho válido, `--version` respondeu e o provedor está ativo.
 * - `desativado`: funciona, mas o usuário desligou.
 * - `nao_encontrado`: nenhum caminho configurado nem detectado.
 * - `erro`: há caminho, mas o arquivo não existe ou `--version` falhou.
 * - `nao_verificado`: ainda não rodou a verificação.
 */
export type EstadoProvedor = 'habilitado' | 'desativado' | 'nao_encontrado' | 'erro' | 'nao_verificado';

export interface Provedor {
  id: IdProvedor;
  nome: string;
  /** Caminho informado manualmente; tem prioridade sobre o detectado. */
  caminho: string | null;
  caminhoDetectado: string | null;
  /** Caminho efetivamente usado (manual ou detectado). */
  caminhoEmUso: string | null;
  ativo: boolean;
  versao: string | null;
  saidaVersao: string | null;
  erro: string | null;
  verificadoEm: string | null;
  estado: EstadoProvedor;
  habilitado: boolean;
}

export const edicaoProvedorSchema = z
  .object({
    caminho: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : v))
      .nullable(),
    ativo: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'informe ao menos um campo');
export type EdicaoProvedor = z.infer<typeof edicaoProvedorSchema>;

/** Nota de 1 (pior) a 5 (melhor) para custo, velocidade e qualidade. Custo 5 = mais barato. */
const notaSchema = z.number().int().min(1).max(5).nullable();
const precoSchema = z.number().min(0).max(10_000).nullable();

export const modeloBaseSchema = z.object({
  provedor: idProvedorSchema,
  /** Valor passado ao `--model` do CLI. */
  codigo: z.string().trim().min(1, 'informe o código do modelo').max(120),
  nome: z.string().trim().min(1, 'informe o nome').max(120),
  /** Família do modelo (claude, gpt, gemini, grok…), usada na regra de revisão cruzada. */
  familia: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'família: minúsculas, dígitos e hífen'),
  notaCusto: notaSchema,
  notaVelocidade: notaSchema,
  notaQualidade: notaSchema,
  contextoTokens: z.number().int().positive().nullable(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
  observacao: z.string().trim().max(2000),
  /** Preços em USD por milhão de tokens; usados para estimar custo quando o CLI não informa. */
  precoEntrada: precoSchema,
  precoSaida: precoSchema,
  precoCacheLeitura: precoSchema,
  precoCacheEscrita: precoSchema,
  ativo: z.boolean(),
});

export const novoModeloSchema = modeloBaseSchema.extend({
  notaCusto: notaSchema.default(null),
  notaVelocidade: notaSchema.default(null),
  notaQualidade: notaSchema.default(null),
  contextoTokens: z.number().int().positive().nullable().default(null),
  tags: modeloBaseSchema.shape.tags.default([]),
  observacao: modeloBaseSchema.shape.observacao.default(''),
  precoEntrada: precoSchema.default(null),
  precoSaida: precoSchema.default(null),
  precoCacheLeitura: precoSchema.default(null),
  precoCacheEscrita: precoSchema.default(null),
  ativo: z.boolean().default(true),
});
export type NovoModelo = z.input<typeof novoModeloSchema>;
export type NovoModeloValidado = z.output<typeof novoModeloSchema>;

export const edicaoModeloSchema = modeloBaseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'informe ao menos um campo');
export type EdicaoModelo = z.infer<typeof edicaoModeloSchema>;

export interface Modelo extends z.output<typeof modeloBaseSchema> {
  id: number;
  criadoEm: string;
  atualizadoEm: string;
}
