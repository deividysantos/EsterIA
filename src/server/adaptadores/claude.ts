import { argumentoPrincipal, evento, num, obj, str } from './util.js';
import { EstadoLeitura, type Adaptador, type EventoLido, type Leitor } from './tipos.js';

const FERRAMENTAS_ESCRITA = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function textoDoResultado(conteudo: unknown): string {
  if (typeof conteudo === 'string') return conteudo;
  if (Array.isArray(conteudo)) {
    return conteudo
      .map((c) => (typeof c === 'string' ? c : str(obj(c)?.text) ?? ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function criarLeitor(): Leitor {
  const estado = new EstadoLeitura();

  function linha(o: Record<string, unknown>): EventoLido[] {
    const tipo = str(o.type);
    if (tipo === 'system') {
      if (o.subtype !== 'init') return [];
      estado.sessao = str(o.session_id) ?? estado.sessao;
      estado.modelo = str(o.model) ?? estado.modelo;
      return [evento('inicio', `Sessão ${estado.sessao ?? '?'} · ${estado.modelo ?? 'modelo?'}`, { bruto: o })];
    }

    if (tipo === 'assistant') {
      const conteudo = obj(o.message)?.content;
      const saida: EventoLido[] = [];
      for (const bloco of Array.isArray(conteudo) ? conteudo : []) {
        const b = obj(bloco);
        if (!b) continue;
        if (b.type === 'text' && str(b.text)) {
          estado.mensagens++;
          estado.ultimaMensagem = b.text as string;
          saida.push(evento('mensagem', b.text as string, { bruto: b }));
        } else if (b.type === 'thinking' && str(b.thinking)) {
          saida.push(evento('raciocinio', b.thinking as string));
        } else if (b.type === 'tool_use') {
          estado.ferramentas++;
          const nome = str(b.name) ?? 'ferramenta';
          const arg = argumentoPrincipal(b.input);
          if (FERRAMENTAS_ESCRITA.has(nome) && arg) estado.arquivos.add(arg);
          saida.push(evento('ferramenta', arg ? `${nome} ${arg}` : nome, { bruto: b }));
        }
      }
      return saida;
    }

    if (tipo === 'user') {
      const conteudo = obj(o.message)?.content;
      const saida: EventoLido[] = [];
      for (const bloco of Array.isArray(conteudo) ? conteudo : []) {
        const b = obj(bloco);
        if (b?.type !== 'tool_result') continue;
        const t = textoDoResultado(b.content);
        saida.push(evento('resultado_ferramenta', b.is_error ? `Erro: ${t}` : t || '(sem saída)'));
      }
      return saida;
    }

    if (tipo === 'rate_limit_event') {
      const info = obj(o.rate_limit_info);
      const janelas = obj(info?.unifiedWindows);
      const lidos = janelas
        ? Object.entries(janelas).map(([janela, v]) => {
            const j = obj(v);
            const reset = num(j?.resetsAt);
            return {
              janela,
              utilizacao: num(j?.utilization),
              status: str(j?.status),
              reiniciaEm: reset ? new Date(reset * 1000).toISOString() : null,
            };
          })
        : info
          ? [
              {
                janela: str(info.rateLimitType) ?? 'desconhecida',
                utilizacao: num(info.utilization),
                status: str(info.status),
                reiniciaEm: num(info.resetsAt) ? new Date(num(info.resetsAt)! * 1000).toISOString() : null,
              },
            ]
          : [];
      estado.limites.push(...lidos);
      const txt = lidos
        .map((l) => `${l.janela}: ${l.utilizacao === null ? '?' : `${Math.round(l.utilizacao * 100)}%`}`)
        .join(' · ');
      return lidos.length ? [evento('limite', `Cota ${txt}`, { bruto: o })] : [];
    }

    if (tipo === 'result') {
      estado.sessao = str(o.session_id) ?? estado.sessao;
      estado.custoUsd = num(o.total_cost_usd);
      estado.numTurnos = num(o.num_turns);
      const u = obj(o.usage);
      if (u) {
        estado.definirUsage({
          entrada: num(u.input_tokens),
          saida: num(u.output_tokens),
          cacheLeitura: num(u.cache_read_input_tokens),
          cacheEscrita: num(u.cache_creation_input_tokens),
          raciocinio: num(obj(u.output_tokens_details)?.thinking_tokens),
        });
      }
      estado.resultado = str(o.result) ?? estado.ultimaMensagem;
      if (o.structured_output !== undefined) estado.estruturada = o.structured_output;
      const ok = o.is_error !== true && o.subtype === 'success';
      estado.sucesso = ok;
      if (!ok) estado.erro = str(o.result) ?? `Terminou com ${String(o.subtype ?? 'erro')}.`;
      return [evento(ok ? 'resultado' : 'erro', estado.resultado ?? estado.erro ?? '(sem texto)', { bruto: { ...o, usage: undefined } })];
    }

    return [];
  }

  return {
    estado,
    linha,
    texto: (l) => [evento('outro', l)],
    finalizar: () => [],
  };
}

export const claude: Adaptador = {
  id: 'claude',
  montarComando(o) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', o.modelo];
    // Sem interação: leitura usa o modo plano (não edita); escrita libera as ferramentas.
    args.push('--permission-mode', o.modo === 'leitura' ? 'plan' : 'bypassPermissions');
    if (o.sessao) args.push('--resume', o.sessao);
    return { args, stdin: o.prompt };
  },
  criarLeitor,
};
