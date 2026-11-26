import fs from 'node:fs';
import path from 'node:path';

import type { Projeto } from '../shared/projetos.js';
import { abrirBanco } from '../server/db/banco.js';
import { criarEsteira, obterEsteira } from '../server/db/esteiras.js';
import { listarModelos } from '../server/db/modelos.js';
import { criarProjeto, listarProjetos } from '../server/db/projetos.js';
import { obterCaminhoBanco } from '../server/config.js';
import { esteiraPadrao } from '../server/esteiras/padrao.js';
import type { Env } from '../server/provedores/executavel.js';
import { api, ARQUIVO_MARCADOR, ErroConexao, erroDaApi, ErroUso, lerOpcoes, slug, urlPainel } from './comum.js';

export const INICIO_BLOCO = '<!-- painel-agentes:inicio -->';
export const FIM_BLOCO = '<!-- painel-agentes:fim -->';

export function blocoClaude(id: string, url: string): string {
  return [
    INICIO_BLOCO,
    '## Painel de agentes',
    `Este repositório é o projeto \`${id}\` no painel de agentes (serviço local em ${url}).`,
    '- Para delegar um problema à esteira de agentes, use a ferramenta MCP `painel-agentes` → `criar_problema`',
    '  (ou a tela Problemas do painel). Não implemente você mesmo o que foi delegado.',
    '- Acompanhe com `ver_problema`; perguntas e aprovações da esteira podem ser respondidas com `decidir`.',
    '- Etapas, modelos, revisão cruzada e critérios de escolha ficam no painel, em Esteiras.',
    FIM_BLOCO,
  ].join('\n');
}

/** Insere ou atualiza o bloco do painel no CLAUDE.md, preservando o resto. */
export function aplicarBloco(texto: string, bloco: string): { texto: string; mudou: boolean } {
  const nl = texto.includes('\r\n') ? '\r\n' : '\n';
  const blocoNl = bloco.split('\n').join(nl);
  const ini = texto.indexOf(INICIO_BLOCO);
  const fim = texto.indexOf(FIM_BLOCO);
  let novo: string;
  if (ini >= 0 && fim > ini) novo = texto.slice(0, ini) + blocoNl + texto.slice(fim + FIM_BLOCO.length);
  else if (!texto.trim()) novo = `${blocoNl}${nl}`;
  else novo = `${texto.replace(/\s*$/, '')}${nl}${nl}${blocoNl}${nl}`;
  return { texto: novo, mudou: novo !== texto };
}

type Origem = 'padrao' | { copiarDe: string } | null;

interface Backend {
  descricao: string;
  listarProjetos(): Promise<Projeto[]>;
  criarProjeto(d: { id: string; nome: string; raiz: string }): Promise<Projeto>;
  temEsteira(id: string): Promise<boolean>;
  criarEsteira(id: string, origem: Exclude<Origem, null>): Promise<number>;
  fechar(): void;
}

function backendApi(url: string): Backend {
  const ok = <T>(r: { status: number; corpo: T }, esperado: number[]) => {
    if (!esperado.includes(r.status)) throw new Error(erroDaApi(r as { status: number; corpo: unknown }));
    return r.corpo;
  };
  return {
    descricao: `serviço em ${url}`,
    listarProjetos: async () => ok(await api<Projeto[]>('GET', '/api/projetos?arquivados=1', undefined, { url }), [200]),
    criarProjeto: async (d) => ok(await api<Projeto>('POST', '/api/projetos', d, { url }), [201]),
    temEsteira: async (id) => (await api('GET', `/api/projetos/${id}/esteira`, undefined, { url })).status === 200,
    criarEsteira: async (id, origem) =>
      ok(await api<{ versaoAtual: number }>('POST', `/api/projetos/${id}/esteira`, { origem }, { url }), [201]).versaoAtual,
    fechar: () => undefined,
  };
}

function backendBanco(caminho: string): Backend {
  const db = abrirBanco(caminho);
  return {
    descricao: `banco ${caminho} (serviço fora do ar)`,
    listarProjetos: async () => listarProjetos(db, { incluirArquivados: true }),
    criarProjeto: async (d) => criarProjeto(db, d),
    temEsteira: async (id) => obterEsteira(db, id) !== null,
    criarEsteira: async (id, origem) => {
      const def =
        origem === 'padrao'
          ? esteiraPadrao(listarModelos(db))
          : (obterEsteira(db, origem.copiarDe)?.definicao ??
            (() => {
              throw new Error(`O projeto "${origem.copiarDe}" não tem esteira para copiar.`);
            })());
      return criarEsteira(db, id, def, origem === 'padrao' ? 'Criada pelo painel init.' : `Copiada de "${origem.copiarDe}" pelo painel init.`).versaoAtual;
    },
    fechar: () => db.close(),
  };
}

export interface ResultadoInit {
  id: string;
  raiz: string;
  linhas: string[];
}

export async function iniciarProjeto(
  args: readonly string[],
  { cwd = process.cwd(), env = process.env, url = urlPainel(env) }: { cwd?: string; env?: Env; url?: string } = {}
): Promise<ResultadoInit> {
  const { opcoes, posicionais } = lerOpcoes(args, { id: 'valor', nome: 'valor', esteira: 'valor', 'sem-claude-md': 'flag' });
  if (posicionais.length > 1) throw new ErroUso('Informe no máximo uma pasta.');
  const raiz = path.resolve(cwd, posicionais[0] ?? '.');
  if (!fs.existsSync(raiz) || !fs.statSync(raiz).isDirectory()) throw new ErroUso(`Pasta não encontrada: ${raiz}`);

  const esteiraOpc = typeof opcoes.esteira === 'string' ? opcoes.esteira : 'padrao';
  let origem: Origem;
  if (esteiraOpc === 'padrao') origem = 'padrao';
  else if (esteiraOpc === 'nenhuma') origem = null;
  else if (esteiraOpc.startsWith('copiar:')) origem = { copiarDe: esteiraOpc.slice('copiar:'.length) };
  else throw new ErroUso('--esteira aceita padrao, nenhuma ou copiar:<id-do-projeto>.');

  const linhas: string[] = [];
  let backend: Backend;
  try {
    await api('GET', '/api/saude', undefined, { url, timeoutMs: 3000 });
    backend = backendApi(url);
  } catch (err) {
    if (!(err instanceof ErroConexao)) throw err;
    backend = backendBanco(obterCaminhoBanco(env));
  }
  linhas.push(`Usando o ${backend.descricao}.`);

  try {
    const projetos = await backend.listarProjetos();
    const existente = projetos.find((p) => path.resolve(p.raiz).toLowerCase() === raiz.toLowerCase());
    let id: string;
    let nome: string;
    if (existente) {
      ({ id, nome } = existente);
      linhas.push(`Projeto já cadastrado: ${id} (${nome}).`);
      if (typeof opcoes.id === 'string' && opcoes.id !== id) linhas.push(`Aviso: --id ${opcoes.id} ignorado; a pasta já pertence a "${id}".`);
    } else {
      nome = typeof opcoes.nome === 'string' ? opcoes.nome : path.basename(raiz);
      id = typeof opcoes.id === 'string' ? opcoes.id : slug(nome);
      await backend.criarProjeto({ id, nome, raiz });
      linhas.push(`Projeto cadastrado: ${id} (${nome}) em ${raiz}.`);
    }

    if (origem === null) linhas.push('Esteira: não criada (--esteira nenhuma).');
    else if (await backend.temEsteira(id)) linhas.push('Esteira: já existe (mantida).');
    else {
      const v = await backend.criarEsteira(id, origem);
      linhas.push(`Esteira: criada (v${v}, ${origem === 'padrao' ? 'modelo padrão' : `cópia de ${origem.copiarDe}`}).`);
    }

    const marcador = path.join(raiz, ARQUIVO_MARCADOR);
    const conteudo = `${JSON.stringify({ id, nome }, null, 2)}\n`;
    const atual = fs.existsSync(marcador) ? fs.readFileSync(marcador, 'utf8') : null;
    if (atual !== conteudo) {
      fs.mkdirSync(path.dirname(marcador), { recursive: true });
      fs.writeFileSync(marcador, conteudo);
      linhas.push(`${ARQUIVO_MARCADOR}: ${atual === null ? 'criado' : 'atualizado'}.`);
    } else linhas.push(`${ARQUIVO_MARCADOR}: sem mudança.`);

    if (opcoes['sem-claude-md']) linhas.push('CLAUDE.md: não alterado (--sem-claude-md).');
    else {
      const arq = path.join(raiz, 'CLAUDE.md');
      const antes = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
      const r = aplicarBloco(antes, blocoClaude(id, url));
      if (r.mudou) fs.writeFileSync(arq, r.texto);
      linhas.push(`CLAUDE.md: ${!r.mudou ? 'sem mudança' : antes ? 'bloco do painel atualizado' : 'criado com o bloco do painel'}.`);
    }
    return { id, raiz, linhas };
  } finally {
    backend.fechar();
  }
}
