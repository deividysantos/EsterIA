import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ResumoProblema } from '../shared/problemas';
import type { DetalheRun, MensagemAoVivo, Run } from '../shared/runs';

let fonte: EventSource | null = null;
let assinantes = 0;
let temporizadorLista: ReturnType<typeof setTimeout> | null = null;

function aplicar(qc: QueryClient, m: MensagemAoVivo) {
  if (m.tipo === 'run') {
    qc.setQueryData<DetalheRun>(['run', m.run.id], (d) => (d ? { ...d, run: m.run } : d));
    qc.setQueryData<Run[]>(['runs'], (lista) => {
      if (!lista) return lista;
      const i = lista.findIndex((r) => r.id === m.run.id);
      if (i < 0) return [m.run, ...lista];
      const nova = [...lista];
      nova[i] = m.run;
      return nova;
    });
    // Usage e listas filtradas: recarrega com folga para não martelar a API a cada linha do stream.
    if (m.run.estado !== 'rodando' && !temporizadorLista) {
      temporizadorLista = setTimeout(() => {
        temporizadorLista = null;
        qc.invalidateQueries({ queryKey: ['usage'] });
        qc.invalidateQueries({ queryKey: ['runs-filtro'] });
      }, 500);
    }
  } else if (m.tipo === 'problema') {
    const p = m.problema;
    qc.setQueryData<ResumoProblema[]>(['problemas'], (lista) => {
      if (!lista) return lista;
      const i = lista.findIndex((x) => x.id === p.id);
      if (i < 0) return [p, ...lista];
      const nova = [...lista];
      nova[i] = p;
      return nova;
    });
    // O detalhe tem tarefas e execuções: recarrega (barato, é local).
    qc.invalidateQueries({ queryKey: ['problema', p.id] });
    qc.invalidateQueries({ queryKey: ['fila'] });
  } else {
    qc.setQueryData<DetalheRun>(['run', m.evento.runId], (d) => {
      if (!d || d.eventos.some((e) => e.seq === m.evento.seq)) return d;
      return { ...d, eventos: [...d.eventos, m.evento].sort((a, b) => a.seq - b.seq) };
    });
  }
}

/** Mantém uma conexão SSE com `/api/ao-vivo` enquanto houver componente montado que a use. */
export function useAoVivo() {
  const qc = useQueryClient();
  useEffect(() => {
    assinantes++;
    if (!fonte) {
      fonte = new EventSource('/api/ao-vivo');
      const ouvir = (ev: MessageEvent<string>) => {
        try {
          aplicar(qc, JSON.parse(ev.data) as MensagemAoVivo);
        } catch {
          /* mensagem malformada: ignora */
        }
      };
      fonte.addEventListener('run', ouvir as EventListener);
      fonte.addEventListener('evento', ouvir as EventListener);
      fonte.addEventListener('problema', ouvir as EventListener);
      // Ao reconectar, o que passou durante a queda é recarregado.
      fonte.addEventListener('pronto', () => {
        qc.invalidateQueries({ queryKey: ['run'] });
        qc.invalidateQueries({ queryKey: ['runs'] });
      });
    }
    return () => {
      assinantes--;
      if (assinantes === 0 && fonte) {
        fonte.close();
        fonte = null;
      }
    };
  }, [qc]);
}
