import type { EdicaoProjeto, ErroApi, NovoProjeto, Projeto, Saude } from '../shared/projetos';
import type { EdicaoModelo, IdProvedor, Modelo, NovoModelo, Provedor } from '../shared/provedores';
import type { DetalheRun, NovoRun, RelatorioUsage, Run } from '../shared/runs';
import type { Criterios, CriteriosProjeto, PreviaPapel } from '../shared/criterios';
import type { PontoCota, RelatorioQualidade } from '../shared/qualidade';
import type { Definicao, EsteiraProjeto, SalvarEsteira } from '../shared/esteiras';
import type {
  AcaoProblema,
  Decisao,
  DecisaoItem,
  ItemParecer,
  DetalheProblema,
  EstadoFila,
  LimitesFila,
  NovoProblema,
  ResumoProblema,
} from '../shared/problemas';

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

  runs: (filtro: { projeto?: string; estado?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as [string, string][]);
    return pedir<Run[]>(`/api/runs${q.size ? `?${q}` : ''}`);
  },
  run: (id: string) => pedir<DetalheRun>(`/api/runs/${encodeURIComponent(id)}`),
  criarRun: (dados: NovoRun) => pedir<Run>('/api/runs', { method: 'POST', body: JSON.stringify(dados) }),
  cancelarRun: (id: string) => pedir<Run>(`/api/runs/${encodeURIComponent(id)}/cancelar`, { method: 'POST' }),
  brutoEvento: (id: string, seq: number) => pedir<unknown>(`/api/runs/${encodeURIComponent(id)}/eventos/${seq}/bruto`),
  usage: (dias: number, projeto?: string) =>
    pedir<RelatorioUsage>(`/api/usage?dias=${dias}${projeto ? `&projeto=${encodeURIComponent(projeto)}` : ''}`),

  esteira: (projeto: string) => pedir<EsteiraProjeto>(`/api/projetos/${encodeURIComponent(projeto)}/esteira`),
  criarEsteira: (projeto: string, origem: 'padrao' | { copiarDe: string }) =>
    pedir<EsteiraProjeto>(`/api/projetos/${encodeURIComponent(projeto)}/esteira`, {
      method: 'POST',
      body: JSON.stringify({ origem }),
    }),
  salvarEsteira: (projeto: string, dados: SalvarEsteira) =>
    pedir<EsteiraProjeto>(`/api/projetos/${encodeURIComponent(projeto)}/esteira`, {
      method: 'PUT',
      body: JSON.stringify(dados),
    }),
  versaoEsteira: (projeto: string, n: number) =>
    pedir<Definicao>(`/api/projetos/${encodeURIComponent(projeto)}/esteira/versoes/${n}`),

  problemas: (filtro: { projeto?: string; estado?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as [string, string][]);
    return pedir<ResumoProblema[]>(`/api/problemas${q.size ? `?${q}` : ''}`);
  },
  problema: (id: string) => pedir<DetalheProblema>(`/api/problemas/${encodeURIComponent(id)}`),
  criarProblema: (dados: NovoProblema) =>
    pedir<ResumoProblema>('/api/problemas', { method: 'POST', body: JSON.stringify(dados) }),
  acaoProblema: (id: string, acao: AcaoProblema) =>
    pedir<ResumoProblema>(`/api/problemas/${encodeURIComponent(id)}/acoes`, { method: 'POST', body: JSON.stringify({ acao }) }),
  decidir: (execucaoId: number, d: Decisao) =>
    pedir<ResumoProblema>(`/api/execucoes/${execucaoId}/decisao`, { method: 'POST', body: JSON.stringify(d) }),
  criterios: (projeto: string) => pedir<CriteriosProjeto>(`/api/projetos/${encodeURIComponent(projeto)}/criterios`),
  salvarCriterios: (projeto: string, c: Criterios) =>
    pedir<CriteriosProjeto>(`/api/projetos/${encodeURIComponent(projeto)}/criterios`, { method: 'PUT', body: JSON.stringify(c) }),
  previaCriterios: (projeto: string, c: Criterios) =>
    pedir<PreviaPapel[]>(`/api/projetos/${encodeURIComponent(projeto)}/criterios/previa`, { method: 'POST', body: JSON.stringify(c) }),
  qualidade: (dias: number, projeto?: string) =>
    pedir<RelatorioQualidade>(`/api/usage/qualidade?dias=${dias}${projeto ? `&projeto=${encodeURIComponent(projeto)}` : ''}`),
  historicoCotas: (dias: number) => pedir<PontoCota[]>(`/api/usage/cotas?dias=${dias}`),
  decidirItem: (id: number, decisao: DecisaoItem | null) =>
    pedir<ItemParecer>(`/api/itens-parecer/${id}`, { method: 'PATCH', body: JSON.stringify({ decisao }) }),
  fila: () => pedir<EstadoFila>('/api/fila'),
  definirLimites: (l: LimitesFila) => pedir<LimitesFila>('/api/fila/limites', { method: 'PUT', body: JSON.stringify(l) }),
};
