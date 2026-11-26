import type { Env } from './provedores/executavel.js';

/**
 * Quem pode falar com a API. Por padrão só a própria máquina. Para acessar de outro aparelho (por exemplo
 * pelo Tailscale), libere o nome ou IP exato: `PAINEL_HOSTS_PERMITIDOS=pc.tail1234.ts.net,100.101.102.103`
 * ou `painel servidor --permitir pc.tail1234.ts.net`. `*.dominio` libera os subdomínios de `dominio`.
 *
 * O painel não tem login: libere só endereços que apenas você alcança (a sua tailnet, não a internet).
 */

const LOCAIS = ['127.0.0.1', 'localhost', '[::1]', '::1'];

/** Normaliza uma entrada: minúsculas, sem esquema, porta ou barra. */
export function normalizarHost(bruto: string): string | null {
  let h = bruto.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (h.startsWith('[')) return h.replace(/\]:\d+$/, ']');
  if ((h.match(/:/g) ?? []).length === 1) h = h.replace(/:\d+$/, '');
  return h || null;
}

export function lerHostsPermitidos(env: Env = process.env, extras: readonly string[] = []): string[] {
  const doAmbiente = (env.PAINEL_HOSTS_PERMITIDOS ?? '').split(/[,;\s]+/);
  const lista = [...doAmbiente, ...extras].map(normalizarHost).filter((h): h is string => !!h);
  return [...new Set(lista)];
}

export function hostAceito(hostname: string, permitidos: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  if (LOCAIS.includes(h)) return true;
  return permitidos.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p));
}

/** Header Host (com porta) aceito? */
export function headerHostAceito(valor: string | undefined | null, permitidos: readonly string[]): boolean {
  if (!valor) return false;
  try {
    return hostAceito(new URL(`http://${valor}`).hostname, permitidos);
  } catch {
    return false;
  }
}

/** Origin (página que fez a requisição) aceita para escrita? */
export function origemAceita(origem: string, permitidos: readonly string[]): boolean {
  try {
    const u = new URL(origem);
    return (u.protocol === 'http:' || u.protocol === 'https:') && hostAceito(u.hostname, permitidos);
  } catch {
    return false;
  }
}
