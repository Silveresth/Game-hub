import { defineConfig } from 'vite';

// Serveur de DÉVELOPPEMENT uniquement (npm run dev) : le jeu 3D (/game/) et l'admin des ventes (/admin/).
// Le build de production est fait par build.mjs (esbuild), pas par « vite build ».
// SAM_API : adresse du serveur Node à utiliser (par défaut 127.0.0.1:3001), par exemple pour un serveur de test isolé.
const api = process.env.SAM_API || '127.0.0.1:3001';

export default defineConfig({
  base: './',
  // En dev, l'API tourne sur le serveur Node (npm run server).
  server: {
    fs: {
      strict: false,
    },
    proxy: {
      '/api': `http://${api}`,
      '/ws': { target: `ws://${api}`, ws: true },
    },
  },
});
