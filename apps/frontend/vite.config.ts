import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Antes havia um alias apontando 'react' e 'react-dom' para
    // ../../node_modules. Isso só existe no layout do npm workspaces, que
    // içava tudo para a raiz. Este repo é instalado com pnpm, onde o react
    // fica em apps/frontend/node_modules e a raiz não tem react nenhum, então
    // o alias apontava para um caminho inexistente e o esbuild quebrava com
    // "Cannot read file: .../node_modules/react".
    // dedupe resolve o mesmo problema (uma única cópia do React) sem depender
    // de caminho fixo, e funciona nos dois layouts.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
