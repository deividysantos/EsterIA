import type { IdProvedor } from '../../shared/provedores.js';
import { antigravity } from './antigravity.js';
import { claude } from './claude.js';
import { codex } from './codex.js';
import { cursor } from './cursor.js';
import type { Adaptador } from './tipos.js';

export const ADAPTADORES: Record<IdProvedor, Adaptador> = { claude, cursor, antigravity, codex };

export type { Adaptador } from './tipos.js';
