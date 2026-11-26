import type { EventoLido } from './tipos.js';

export const LIMITE_RESUMO = 200;
/** Margem segura abaixo dos 32 767 caracteres do CreateProcess no Windows. */
export const LIMITE_LINHA_COMANDO = 30_000;

/** Primeira parte de um texto, numa linha só. */
export function resumir(texto: unknown, limite = LIMITE_RESUMO): string {
  const s = typeof texto === 'string' ? texto : texto == null ? '' : JSON.stringify(texto);
  const uma = s.replace(/\s+/g, ' ').trim();
  return uma.length > limite ? `${uma.slice(0, limite - 1)}…` : uma;
}

/** Evento com resumo curto e o texto completo só quando ele não cabe no resumo. */
export function evento(tipo: EventoLido['tipo'], texto: string, extra: Partial<EventoLido> = {}): EventoLido {
  const resumo = resumir(texto);
  const completo = texto.replace(/\s+/g, ' ').trim().length > resumo.length || texto.includes('\n');
  return { tipo, resumo: resumo || '(vazio)', texto: completo ? texto : null, ...extra };
}

export function tamanhoArgs(args: readonly string[]): number {
  return args.reduce((t, a) => t + a.length + 3, 0);
}

export function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Argumento mais representativo de uma chamada de ferramenta (caminho, comando, padrão…). */
export function argumentoPrincipal(args: unknown): string {
  const a = obj(args);
  if (!a) return '';
  for (const k of ['file_path', 'path', 'Path', 'TargetFile', 'command', 'CommandLine', 'pattern', 'query', 'url', 'description']) {
    const v = a[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

/**
 * Extrai o último objeto JSON de um texto: bloco ```json``` ou o maior trecho `{...}` que faz parse.
 * Usado quando o CLI não tem saída estruturada nativa.
 */
export function extrairJson(texto: string | null): unknown {
  if (!texto) return undefined;
  const blocos = [...texto.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  for (const b of blocos.reverse()) {
    try {
      return JSON.parse(b);
    } catch {
      /* tenta o próximo */
    }
  }
  const t = texto.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* segue */
  }
  for (let fim = t.lastIndexOf('}'); fim >= 0; fim = t.lastIndexOf('}', fim - 1)) {
    for (let ini = t.indexOf('{'); ini >= 0 && ini < fim; ini = t.indexOf('{', ini + 1)) {
      try {
        return JSON.parse(t.slice(ini, fim + 1));
      } catch {
        /* segue */
      }
    }
  }
  return undefined;
}
