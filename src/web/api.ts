import type { EdicaoProjeto, ErroApi, NovoProjeto, Projeto, Saude } from '../shared/projetos';
import type { EdicaoModelo, IdProvedor, Modelo, NovoModelo, Provedor } from '../shared/provedores';

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

  provedores: () => pedir<Provedor[]>('/api/provedores'),
  verificarProvedores: () => pedir<Provedor[]>('/api/provedores/verificar', { method: 'POST' }),
  verificarProvedor: (id: IdProvedor) => pedir<Provedor>(`/api/provedores/${id}/verificar`, { method: 'POST' }),
  editarProvedor: (id: IdProvedor, dados: { caminho?: string | null; ativo?: boolean }) =>
    pedir<Provedor>(`/api/provedores/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),

  modelos: () => pedir<Modelo[]>('/api/modelos'),
  criarModelo: (dados: NovoModelo) =>
    pedir<Modelo>('/api/modelos', { method: 'POST', body: JSON.stringify(dados) }),
  editarModelo: (id: number, dados: EdicaoModelo) =>
    pedir<Modelo>(`/api/modelos/${id}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  excluirModelo: (id: number) => pedir<null>(`/api/modelos/${id}`, { method: 'DELETE' }),
};
