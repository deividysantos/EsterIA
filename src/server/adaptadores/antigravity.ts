import { argumentoPrincipal, evento, LIMITE_LINHA_COMANDO, num, obj, resumir, str, tamanhoArgs } from './util.js';
import { EstadoLeitura, type Adaptador, type EventoLido, type Leitor } from './tipos.js';
import type { Usage } from '../../shared/runs.js';

const ESCRITA = /(write|edit|replace|create_file|delete)/i;

function usageAgy(u: unknown): Partial<Usage> | null {
  const x = obj(u);
  if (!x) return null;
  return {
    entrada: num(x.input_tokens),
    saida: num(x.output_tokens),
    cacheLeitura: num(x.cache_read_tokens),
    raciocinio: num(x.thinking_tokens),
  };
}

function criarLeitor(): Leitor {
  const estado = new EstadoLeitura();
  /** Texto das respostas em montagem, por step_index. */
  const textos = new Map<number, string>();
  let usagePassos: Partial<Usage>[] = [];

  function fecharTexto(passo: number): EventoLido[] {
    const t = (textos.get(passo) ?? '').trim();
    textos.delete(passo);
    if (!t) return [];
    estado.mensagens++;
    estado.ultimaMensagem = t;
    return [evento('mensagem', t)];
  }

  function linha(o: Record<string, unknown>): EventoLido[] {
    const ev = str(o.event);

    if (ev === 'init') {
      estado.sessao = str(o.conversation_id) ?? estado.sessao;
      estado.modelo = str(obj(o.init)?.model) ?? estado.modelo;
      return [evento('inicio', `Conversa ${estado.sessao ?? '?'} · ${estado.modelo ?? 'modelo?'}`)];
    }

    if (ev === 'step_update') {
      const s = obj(o.step_update);
      if (!s) return [];
      estado.sessao = str(s.conversation_id) ?? estado.sessao;
      const passo = num(s.step_index) ?? -1;
      const concluido = s.state === 'DONE';

      if (s.step_type === 'agent_response') {
        const delta = str(s.text_delta);
        if (delta) textos.set(passo, (textos.get(passo) ?? '') + delta);
        if (!concluido) return [];
        const u = usageAgy(s.usage);
        if (u) usagePassos.push(u);
        return fecharTexto(passo);
      }

      if (s.step_type === 'tool') {
        const info = obj(s.tool_info);
        const nome = str(s.tool_name) ?? str(info?.name) ?? 'ferramenta';
        const arg = argumentoPrincipal(info?.parameters);
        if (!concluido) {
          estado.ferramentas++;
          if (ESCRITA.test(nome) && arg) estado.arquivos.add(arg);
          return [evento('ferramenta', arg ? `${nome} ${arg}` : nome, { bruto: s })];
        }
        const saida = info?.output;
        return [evento('resultado_ferramenta', typeof saida === 'string' ? saida : saida ? JSON.stringify(saida) : '(sem saída)')];
      }
      return [];
    }

    if (ev === 'result') {
      const r = obj(o.result);
      if (!r) return [];
      estado.sessao = str(r.conversation_id) ?? estado.sessao;
      estado.numTurnos = num(r.num_turns);
      // O usage do resultado já é o total; sem ele, soma-se o de cada passo.
      const u = usageAgy(r.usage);
      if (u) estado.definirUsage(u);
      else for (const p of usagePassos) estado.somarUsage(p);
      usagePassos = [];
      estado.resultado = str(r.response) ?? estado.ultimaMensagem;
      if (r.structured_output !== undefined) estado.estruturada = r.structured_output;
      const ok = r.status === 'SUCCESS';
      estado.sucesso = ok;
      if (!ok) estado.erro = str(r.error) ?? str(r.response) ?? `Status ${String(r.status)}.`;
      return [evento(ok ? 'resultado' : 'erro', estado.resultado ?? estado.erro ?? '(sem texto)')];
    }

    if (ev === 'error') {
      estado.erro = str(o.message) ?? resumir(o, 2000);
      return [evento('erro', estado.erro, { bruto: o })];
    }

    return [evento('outro', resumir(o, 2000), { bruto: o })];
  }

  function finalizar(): EventoLido[] {
    const saida: EventoLido[] = [];
    for (const passo of [...textos.keys()]) saida.push(...fecharTexto(passo));
    if (usagePassos.length) {
      for (const p of usagePassos) estado.somarUsage(p);
      usagePassos = [];
    }
    return saida;
  }

  return { estado, linha, texto: (l) => [evento('outro', l)], finalizar };
}

export const antigravity: Adaptador = {
  id: 'antigravity',
  montarComando(o) {
    const resto = ['--model', o.modelo, '--output-format', 'stream-json'];
    // Sem `--mode plan` o agy edita arquivos mesmo sem a flag de permissão: leitura sempre usa plan.
    resto.push(...(o.modo === 'leitura' ? ['--mode', 'plan'] : ['--dangerously-skip-permissions']));
    if (o.sessao) resto.push('--conversation', o.sessao);
    if (o.jsonSchemaArquivo) resto.push('--json-schema', o.jsonSchemaArquivo);
    const comPrompt = ['-p', o.prompt, ...resto];
    if (tamanhoArgs(comPrompt) <= LIMITE_LINHA_COMANDO) return { args: comPrompt, stdin: null };
    // Prompt grande: vai pela entrada padrão como evento stream-json.
    const payload = JSON.stringify({ event: 'user', message: { role: 'user', content: [{ type: 'text', text: o.prompt }] } });
    return { args: [...resto, '--input-format', 'stream-json'], stdin: `${payload}\n` };
  },
  criarLeitor,
};
