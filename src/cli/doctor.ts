import fs from 'node:fs';
import path from 'node:path';

import type { Projeto } from '../shared/projetos.js';
import type { Provedor } from '../shared/provedores.js';
import type { Saude } from '../shared/projetos.js';
import { abrirBanco, VERSAO_ESQUEMA } from '../server/db/banco.js';
import { listarProvedores } from '../server/db/provedores.js';
import { listarProjetos } from '../server/db/projetos.js';
import { obterEsteira } from '../server/db/esteiras.js';
import { obterCaminhoBanco } from '../server/config.js';
import { rodarCurto, type Env } from '../server/provedores/executavel.js';
import { VERSAO } from '../server/versao.js';
import { api, ErroConexao, lerMarcador, projetoDaPasta, urlPainel } from './comum.js';
import { INICIO_BLOCO } from './init.js';
import { caminhosInstalacao, estaNoPath, NOME_MCP, nodeAtende, type Linha, type Rodar } from './instalar.js';

export async function doctor(
  _args: readonly string[],
  {
    env = process.env,
    cwd = process.cwd(),
    rodar = (a, b) => rodarCurto(a, b, { env, timeoutMs: 30_000 }),
  }: { env?: Env; cwd?: string; rodar?: Rodar } = {}
): Promise<{ linhas: Linha[]; ok: boolean }> {
  const linhas: Linha[] = [];
  const add = (estado: Linha['estado'], texto: string, dica?: string) => linhas.push({ estado, texto, ...(dica ? { dica } : {}) });
  const c = caminhosInstalacao(env);

  add(nodeAtende() ? 'ok' : 'erro', `Node ${process.versions.node}`, nodeAtende() ? undefined : 'Precisa do 22.13 ou mais novo.');
  add(
    fs.existsSync(c.build) && fs.existsSync(c.web) ? 'ok' : 'erro',
    `Painel ${VERSAO} em ${c.entrada.replace(/[\\/]bin[\\/]painel\.mjs$/, '')}`,
    fs.existsSync(c.build) ? undefined : 'Build ausente: rode "npm run build" na pasta do painel.'
  );

  // Banco
  const caminhoBanco = obterCaminhoBanco(env);
  let projetos: Projeto[] = [];
  let provedores: Provedor[] = [];
  let esteiraDe: (id: string) => boolean = () => false;
  try {
    const db = abrirBanco(caminhoBanco);
    try {
      add('ok', `Banco ${caminhoBanco} (esquema ${VERSAO_ESQUEMA})`);
      projetos = listarProjetos(db, { incluirArquivados: true });
      provedores = listarProvedores(db);
      const comEsteira = new Set(projetos.filter((p) => obterEsteira(db, p.id)).map((p) => p.id));
      esteiraDe = (id) => comEsteira.has(id);
    } finally {
      db.close();
    }
  } catch (err) {
    add('erro', `Banco ${caminhoBanco}: ${(err as Error).message}`);
  }

  // Serviço
  const url = urlPainel(env);
  try {
    const r = await api<Saude>('GET', '/api/saude', undefined, { url, timeoutMs: 3000 });
    if (r.status !== 200) add('erro', `Serviço em ${url} respondeu ${r.status}.`);
    else if (r.corpo.versao !== VERSAO) add('aviso', `Serviço no ar em ${url}, mas na versão ${r.corpo.versao} (esta é ${VERSAO}).`, 'Reinicie o serviço para usar a versão nova.');
    else add('ok', `Serviço no ar em ${url}`);
    const pv = await api<Provedor[]>('GET', '/api/provedores', undefined, { url });
    if (pv.status === 200) provedores = pv.corpo;
  } catch (err) {
    if (!(err instanceof ErroConexao)) throw err;
    add('aviso', `Serviço fora do ar em ${url}.`, 'Suba com "painel servidor". Sem ele a esteira não roda.');
  }

  // Provedores
  const hab = provedores.filter((p) => p.habilitado);
  for (const p of provedores) {
    if (p.habilitado) add('ok', `${p.nome} ${p.versao ?? ''}`.trim());
    else if (p.estado === 'erro') add('aviso', `${p.nome}: ${p.erro ?? 'erro'}`, 'Corrija o caminho na tela Provedores.');
    else add('info', `${p.nome}: ${p.estado.replace('_', ' ')}`);
  }
  if (provedores.length && !hab.length) add('erro', 'Nenhum CLI de agente habilitado.', 'Rode "painel instalar" ou configure na tela Provedores.');

  // Atalho e MCP
  add(
    fs.existsSync(c.atalho) && estaNoPath(c.bin, env) ? 'ok' : 'aviso',
    fs.existsSync(c.atalho) ? (estaNoPath(c.bin, env) ? 'Comando "painel" no PATH' : `Atalho existe, mas ${c.bin} não está no PATH`) : 'Atalho "painel" não instalado',
    fs.existsSync(c.atalho) && estaNoPath(c.bin, env) ? undefined : 'Rode "painel instalar --adicionar-ao-path".'
  );
  const claude = hab.find((p) => p.id === 'claude')?.caminhoEmUso ?? null;
  if (claude) {
    const r = await rodar(claude, ['mcp', 'get', NOME_MCP]);
    const normal = (s: string) => s.toLowerCase().replace(/[\\/]+/g, '/');
    const saida = normal(`${r.stdout}\n${r.stderr}`);
    if (r.codigo !== 0) add('aviso', `MCP "${NOME_MCP}" não registrado no Claude Code.`, 'Rode "painel instalar".');
    else if (!saida.includes(normal(c.entrada)))
      add('aviso', `MCP "${NOME_MCP}" registrado, mas aponta para outra instalação.`, 'Rode "painel instalar" para atualizar.');
    else add('ok', `MCP "${NOME_MCP}" registrado no Claude Code`);
  }

  // Projeto da pasta atual
  const marcador = lerMarcador(cwd);
  const id = projetoDaPasta(cwd, projetos);
  if (!id) add('info', `A pasta ${cwd} não é de nenhum projeto do painel.`, 'Para usar aqui, rode "painel init".');
  else {
    const p = projetos.find((x) => x.id === id);
    if (!p) add('erro', `O marcador aponta para "${id}", que não está cadastrado neste painel.`, 'Rode "painel init" na raiz do projeto.');
    else {
      add('ok', `Projeto da pasta: ${p.id} (${p.raiz})`);
      if (!marcador) add('aviso', 'Sem .agentes/projeto.json na raiz.', 'Rode "painel init" para criar.');
      add(esteiraDe(p.id) ? 'ok' : 'aviso', esteiraDe(p.id) ? 'Esteira configurada' : 'Projeto sem esteira', esteiraDe(p.id) ? undefined : 'Crie em Esteiras ou com "painel init".');
      const claudeMd = path.join(p.raiz, 'CLAUDE.md');
      const temBloco = fs.existsSync(claudeMd) && fs.readFileSync(claudeMd, 'utf8').includes(INICIO_BLOCO);
      add(temBloco ? 'ok' : 'info', temBloco ? 'CLAUDE.md com o bloco do painel' : 'CLAUDE.md sem o bloco do painel (opcional)');
    }
  }

  return { linhas, ok: !linhas.some((l) => l.estado === 'erro') };
}
