import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const portaApi = process.env.PAINEL_PORTA ?? '4710';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/web'),
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${portaApi}` },
  },
});
