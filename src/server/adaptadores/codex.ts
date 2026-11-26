import { evento, num, obj, resumir, str } from './util.js';
import { EstadoLeitura, type Adaptador, type EventoLido, type Leitor } from './tipos.js';

/**
 * Codex (`codex exec --json`). Ainda não validado com o CLI real nesta máquina:
 * baseado no formato documentado (thread.started, item.*, turn.completed).
 */
function criarLeitor(): Leitor {
  const estado = new EstadoLeitura();
  let falhou = false;
  let turnos = 0;

  function item(i: Record<string, unknown>): EventoLido[] {
    const tipo = str(i.type) ?? str(i.item_type);
    if (tipo === 'agent_message' || tipo === 'assistant_message') {
      const t = str(i.text) ?? '';
      if (!t) return [];
      estado.mensagens++;
      estado.ultimaMensagem = t;
      return [evento('mensagem', t)];
    }
    if (tipo === 'reasoning') {
      const t = str(i.text) ?? '';
      return t ? [evento('raciocinio', t)] : [];
    }
    if (tipo === 'command_execution') {
      estado.ferramentas++;
      const cmd = str(i.command) ?? 'comando';
      const saida = str(i.aggregated_output) ?? '';
      const codigo = num(i.exit_code);
      return [
        evento('ferramenta', `shell ${cmd}`),
        evento('resultado_ferramenta', `${codigo === null ? '' : `[código ${codigo}] `}${saida || '(sem saída)'}`),
      ];
    }
    if (tipo === 'file_change') {
      estado.ferramentas++;
      const mudancas = Array.isArray(i.changes) ? i.changes.map((c) => obj(c)) : [];
      const caminhos = mudancas.map((c) => str(c?.path)).filter((p): p is string => !!p);
      caminhos.forEach((p) => estado.arquivos.add(p));
      return [evento('ferramenta', `Arquivos alterados: ${caminhos.join(', ') || '?'}`)];
    }
    if (tipo === 'mcp_tool_call' || tipo === 'web_search') {
      estado.ferramentas++;
      return [evento('ferramenta', `${tipo} ${str(i.tool) ?? str(i.query) ?? ''}`.trim())];
    }
    if (tipo === 'error') {
      return [evento('erro', str(i.message) ?? 'Erro')];
    }
    return [];
  }

  function linha(o: Record<string, unknown>): EventoLido[] {
    const tipo = str(o.type);
    if (tipo === 'thread.started') {
      estado.sessao = str(o.thread_id) ?? estado.sessao;
      return [evento('inicio', `Sessão ${estado.sessao ?? '?'}`)];
    }
    if (tipo === 'item.completed') {
      const i = obj(o.item);
      return i ? item(i) : [];
    }
    if (tipo === 'turn.completed') {
      turnos++;
      const u = obj(o.usage);
      if (u) {
        // No Codex, input_tokens inclui os tokens vindos do cache.
        const entrada = num(u.input_tokens);
        const cache = num(u.cached_input_tokens) ?? 0;
        estado.somarUsage({
          entrada: entrada === null ? null : Math.max(0, entrada - cache),
          cacheLeitura: cache,
          saida: num(u.output_tokens),
          raciocinio: num(u.reasoning_output_tokens),
        });
      }
      return [];
    }
    if (tipo === 'turn.failed' || tipo === 'error') {
      falhou = true;
      estado.erro = str(obj(o.error)?.message) ?? str(o.message) ?? 'O Codex falhou.';
      return [evento('erro', estado.erro, { bruto: o })];
    }
    if (tipo === 'turn.started' || tipo === 'item.started' || tipo === 'item.updated') return [];
    return [evento('outro', resumir(o, 2000), { bruto: o })];
  }

  function finalizar(): EventoLido[] {
    estado.numTurnos = turnos || null;
    estado.resultado = estado.ultimaMensagem;
    if (falhou) estado.sucesso = false;
    else if (turnos > 0) estado.sucesso = true;
    return estado.resultado && !falhou ? [evento('resultado', estado.resultado)] : [];
  }

  return { estado, linha, texto: (l) => [evento('outro', l)], finalizar };
}

export const codex: Adaptador = {
  id: 'codex',
  montarComando(o) {
    const args = ['exec', '--json', '--skip-git-repo-check', '-m', o.modelo];
    args.push('-s', o.modo === 'leitura' ? 'read-only' : 'workspace-write');
    if (o.jsonSchemaArquivo) args.push('--output-schema', o.jsonSchemaArquivo);
    if (o.sessao) args.push('resume', o.sessao);
    args.push('-');
    return { args, stdin: o.prompt };
  },
  criarLeitor,
};
