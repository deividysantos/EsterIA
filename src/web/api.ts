import type { EdicaoProjeto, ErroApi, NovoProjeto, Projeto, Saude } from '../shared/projetos';

export class ErroRequisicao extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string
  ) {
    super(mensagem);
  }
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const texto = await res.text();
  const corpo: unknown = texto ? JSON.parse(texto) : null;
  if (!res.ok) {
    const e = (corpo ?? {}) as Partial<ErroApi>;
    throw new ErroRequisicao(res.status, e.codigo ?? 'HTTP', e.erro ?? `Erro HTTP ${res.status}`);
  }
  return corpo as T;
}

export const api = {
  saude: () => pedir<Saude>('/api/saude'),
  projetos: (incluirArquivados = false) =>
    pedir<Projeto[]>(`/api/projetos${incluirArquivados ? '?arquivados=1' : ''}`),
  criarProjeto: (dados: NovoProjeto) =>
    pedir<Projeto>('/api/projetos', { method: 'POST', body: JSON.stringify(dados) }),
  editarProjeto: (id: string, dados: EdicaoProjeto) =>
    pedir<Projeto>(`/api/projetos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(dados),
    }),
};
