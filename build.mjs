import { execSync } from 'node:child_process';
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import esbuild from 'esbuild';

console.log('Compiling TypeScript...');
execSync('npx tsc --noEmit', { stdio: 'inherit' });

console.log('Bundling with esbuild API...');
await mkdir('dist/game', { recursive: true });
await mkdir('dist/admin', { recursive: true });

await esbuild.build({
  entryPoints: ['src/game/main.ts'],
  bundle: true,
  outfile: 'dist/game.bundle.js',
  format: 'esm',
});

// Patch direct des variables d'environnement Vite non définies dans le navigateur
let bundle = await readFile('dist/game.bundle.js', 'utf8');
bundle = bundle.replaceAll('import.meta.env.PROD', 'true').replaceAll('import.meta.env.DEV', 'false');
await writeFile('dist/game.bundle.js', bundle);

await esbuild.build({
  entryPoints: ['src/admin/main.ts'],
  bundle: true,
  outfile: 'dist/admin.bundle.js',
  format: 'esm',
});

let adminBundle = await readFile('dist/admin.bundle.js', 'utf8');
adminBundle = adminBundle.replaceAll('import.meta.env.PROD', 'true').replaceAll('import.meta.env.DEV', 'false');
await writeFile('dist/admin.bundle.js', adminBundle);

console.log('Copying static assets...');
// Copie public/ SANS écraser les bundles qu'on vient de générer (d'anciens bundles périmés dans public/ les remplaçaient).
await cp('public', 'dist', {
  recursive: true,
  filter: (src) => !/(^|[\\/])public[\\/](game|admin)\.bundle\.js$/.test(src),
});
await copyFile('src/shared/theme.css', 'dist/theme.css');
await copyFile('index.html', 'dist/index.html');

const gameHtml = (await readFile('game/index.html', 'utf8'))
  .replace('/src/shared/theme.css', '/theme.css')
  .replace('/src/game/main.ts', '/game.bundle.js');
await writeFile('dist/game/index.html', gameHtml);

const adminHtml = (await readFile('admin/index.html', 'utf8'))
  .replace('/src/shared/theme.css', '/theme.css')
  .replace('/src/admin/main.ts', '/admin.bundle.js');
await writeFile('dist/admin/index.html', adminHtml);

console.log('Build complete -> dist/');
