import { EventEmitter } from 'node:events';

import type { MensagemAoVivo } from '../shared/runs.js';

/** Barramento em memória: o executor publica, o SSE (`/api/ao-vivo`) repassa para a interface. */
export class AoVivo {
  private readonly emissor = new EventEmitter();

  constructor() {
    this.emissor.setMaxListeners(0);
  }

  publicar(m: MensagemAoVivo) {
    this.emissor.emit('m', m);
  }

  assinar(fn: (m: MensagemAoVivo) => void): () => void {
    this.emissor.on('m', fn);
    return () => this.emissor.off('m', fn);
  }
}
