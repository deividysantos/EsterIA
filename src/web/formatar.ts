import type { EstadoRun, Usage } from '../shared/runs';

const nf = new Intl.NumberFormat('pt-BR');
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const inteiro = (n: number | null | undefined) => (n === null || n === undefined ? '—' : nf.format(n));
export const tokensCompacto = (n: number | null | undefined) => (n === null || n === undefined ? '—' : compacto.format(n));

export function dolar(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const casas = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2;
  return `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

export function duracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const dataHora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

export function totalTokens(u: Usage): number | null {
  const v = [u.entrada, u.saida, u.cacheLeitura, u.cacheEscrita];
  return v.every((x) => x === null) ? null : v.reduce<number>((t, x) => t + (x ?? 0), 0);
}

export const ROTULO_ESTADO_RUN: Record<EstadoRun, string> = {
  rodando: 'Rodando',
  concluido: 'Concluído',
  falhou: 'Falhou',
  cancelado: 'Cancelado',
  interrompido: 'Interrompido',
};
