import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1', strictPort: true },
  build: { outDir: 'dist', sourcemap: true },
});
