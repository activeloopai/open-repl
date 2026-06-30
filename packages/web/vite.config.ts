import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@openrepl/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:4317', ws: true },
      '/__preview': 'http://localhost:4317',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
