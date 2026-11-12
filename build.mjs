// Build de production (npm run build) : vérification TypeScript, bundles esbuild, copie des fichiers statiques → dist/.
// Le serveur de développement (npm run dev) utilise Vite ; la production n'utilise QUE ce script.
import { execSync } from 'node:child_process';
import { mkdir, copyFile, cp, readFile, rm, writeFile } from 'node:fs/promises';
import esbuild from 'esbuild';

console.log('Compiling TypeScript...');
execSync('npx tsc --noEmit', { stdio: 'inherit' });

// dist/ repart de zéro : sinon d'anciennes pages (ex. le prototype /museum/) restent servies en production
await rm('dist', { recursive: true, force: true });

console.log('Bundling with esbuild API...');
await mkdir('dist/game', { recursive: true });
await mkdir('dist/admin', { recursive: true });

// Variables d'environnement Vite, fixées à la compilation : esbuild élimine le code réservé au développement
// (par exemple l'accès de test window.__game), au lieu d'un rechercher-remplacer dans le bundle.
const common = {
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: 'es2022',
  define: {
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
    'import.meta.env.MODE': '"production"',
    // le jeu et sa page d'accueil sont servis par le même serveur : adresses relatives
    'import.meta.env.VITE_API_BASE': '""',
  },
};

await esbuild.build({ ...common, entryPoints: ['src/game/main.ts'], outfile: 'dist/game.bundle.js' });
await esbuild.build({ ...common, entryPoints: ['src/admin/main.ts'], outfile: 'dist/admin.bundle.js' });
await esbuild.build({ ...common, entryPoints: ['src/landing/main.ts'], outfile: 'dist/landing.bundle.js' });

console.log('Copying static assets...');
// Copie public/ SANS écraser les bundles qu'on vient de générer (d'anciens bundles périmés dans public/ les remplaçaient).
await cp('public', 'dist', {
  recursive: true,
  filter: (src) => !/(^|[\\/])public[\\/](game|admin|landing)\.bundle\.js(\.map)?$/.test(src),
});
await copyFile('src/shared/theme.css', 'dist/theme.css');

// page d'accueil
const landingHtml = (await readFile('index.html', 'utf8'))
  .replace('/src/shared/theme.css', '/theme.css')
  .replace('/src/landing/main.ts', '/landing.bundle.js');
await writeFile('dist/index.html', landingHtml);

const gameHtml = (await readFile('game/index.html', 'utf8'))
  .replace('/src/shared/theme.css', '/theme.css')
  .replace('/src/game/main.ts', '/game.bundle.js');
await writeFile('dist/game/index.html', gameHtml);

const adminHtml = (await readFile('admin/index.html', 'utf8'))
  .replace('/src/shared/theme.css', '/theme.css')
  .replace('/src/admin/main.ts', '/admin.bundle.js');
await writeFile('dist/admin/index.html', adminHtml);

console.log('Build complete -> dist/');
