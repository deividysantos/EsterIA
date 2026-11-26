import { argumentoPrincipal, evento, LIMITE_LINHA_COMANDO, num, obj, resumir, str, tamanhoArgs } from './util.js';
import { EstadoLeitura, type Adaptador, type EventoLido, type Leitor } from './tipos.js';

/** `tool_call` do Cursor vem como `{ readToolCall: { args, result } }`; devolve nome e corpo. */
function ferramenta(tc: unknown): { nome: string; corpo: Record<string, unknown> | null } {
  const t = obj(tc);
  if (!t) return { nome: 'ferramenta', corpo: null };
  const chave = Object.keys(t).find((k) => k.endsWith('ToolCall')) ?? Object.keys(t)[0] ?? 'ferramenta';
  return { nome: chave.replace(/ToolCall$/, ''), corpo: obj(t[chave]) };
}

const ESCRITA = /^(edit|write|delete|searchReplace|multiEdit)/i;

function criarLeitor(): Leitor {
  const estado = new EstadoLeitura();
  let pensamento = '';

  function fecharPensamento(): EventoLido[] {
    const t = pensamento.trim();
    pensamento = '';
    return t ? [evento('raciocinio', t)] : [];
  }

  function linha(o: Record<string, unknown>): EventoLido[] {
    const tipo = str(o.type);
    estado.sessao = str(o.session_id) ?? estado.sessao;

    if (tipo === 'thinking') {
      if (o.subtype === 'delta') {
        pensamento += str(o.text) ?? '';
        return [];
      }
      return fecharPensamento();
    }

    const antes = pensamento ? fecharPensamento() : [];

    if (tipo === 'system' && o.subtype === 'init') {
      estado.modelo = str(o.model) ?? estado.modelo;
      return [...antes, evento('inicio', `Sessão ${estado.sessao ?? '?'} · ${estado.modelo ?? 'modelo?'}`, { bruto: o })];
    }

    if (tipo === 'assistant') {
      const conteudo = obj(o.message)?.content;
      const textos = (Array.isArray(conteudo) ? conteudo : [])
        .map((c) => str(obj(c)?.text))
        .filter((t): t is string => !!t);
      if (!textos.length) return antes;
      const t = textos.join('\n');
      estado.mensagens++;
      estado.ultimaMensagem = t;
      return [...antes, evento('mensagem', t)];
    }

    if (tipo === 'tool_call') {
      const { nome, corpo } = ferramenta(o.tool_call);
      const arg = argumentoPrincipal(corpo?.args);
      if (o.subtype === 'started') {
        estado.ferramentas++;
        if (ESCRITA.test(nome) && arg) estado.arquivos.add(arg);
        return [...antes, evento('ferramenta', arg ? `${nome} ${arg}` : nome, { bruto: o })];
      }
      const res = obj(corpo?.result);
      if (res?.error !== undefined) return [...antes, evento('resultado_ferramenta', `Erro: ${resumir(res.error, 2000)}`)];
      const sucesso = obj(res?.success);
      const conteudo = str(sucesso?.content) ?? str(sucesso?.output) ?? (sucesso ? JSON.stringify(sucesso) : '(sem saída)');
      return [...antes, evento('resultado_ferramenta', conteudo)];
    }

    if (tipo === 'result') {
      const u = obj(o.usage);
      if (u) {
        estado.definirUsage({
          entrada: num(u.inputTokens),
          saida: num(u.outputTokens),
          cacheLeitura: num(u.cacheReadTokens),
          cacheEscrita: num(u.cacheWriteTokens),
          raciocinio: num(u.reasoningTokens),
        });
      }
      estado.resultado = str(o.result) ?? estado.ultimaMensagem;
      const ok = o.is_error !== true && o.subtype === 'success';
      estado.sucesso = ok;
      if (!ok) estado.erro = str(o.result) ?? 'O Cursor terminou com erro.';
      // O `result` do Cursor concatena todas as mensagens; o evento mostra só a última.
      return [...antes, evento(ok ? 'resultado' : 'erro', estado.ultimaMensagem ?? estado.resultado ?? '(sem texto)')];
    }

    if (tipo === 'user') return antes;
    return [...antes, evento('outro', resumir(o, 2000), { bruto: o })];
  }

  return { estado, linha, texto: (l) => [evento('outro', l)], finalizar: fecharPensamento };
}

export const cursor: Adaptador = {
  id: 'cursor',
  montarComando(o) {
    const resto = ['--model', o.modelo, '--output-format', 'stream-json', '--trust'];
    resto.push(...(o.modo === 'leitura' ? ['--mode', 'plan'] : ['--force']));
    if (o.sessao) resto.push('--resume', o.sessao);
    const comPrompt = ['-p', o.prompt, ...resto];
    // Prompt grande demais para a linha de comando: `-p` sem texto lê da entrada padrão.
    if (tamanhoArgs(comPrompt) > LIMITE_LINHA_COMANDO) return { args: ['-p', ...resto], stdin: o.prompt };
    return { args: comPrompt, stdin: null };
  },
  criarLeitor,
};
