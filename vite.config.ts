import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Application multi-pages : le jeu 3D + l'admin des ventes.
export default defineConfig({
  base: './',
  // En dev, l'API tourne sur le serveur Node (npm run server).
  server: {
    fs: {
      strict: false,
    },
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game/index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
});
