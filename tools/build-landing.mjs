// Build de la page d'accueil SEULE, pour un hébergement statique séparé du jeu (Vercel) → dist-landing/
// Le jeu, l'API et le temps réel restent sur le serveur Node (Render) dont l'adresse est SAM_GAME_URL.
// Usage : SAM_GAME_URL=https://jouer.mondomaine.fr npm run build:landing
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import esbuild from 'esbuild';

const GAME_URL = (process.env.SAM_GAME_URL ?? '').trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(GAME_URL)) {
  console.error('SAM_GAME_URL manquant ou invalide : adresse du jeu sur Render, sans chemin (ex. https://jouer.mondomaine.fr)');
  process.exit(1);
}
const OUT = 'dist-landing';
await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/game`, { recursive: true });

// script de la page (barre live, ventes, cartels) : les statistiques sont lues sur le serveur du jeu
await esbuild.build({
  entryPoints: ['src/landing/main.ts'],
  outfile: `${OUT}/landing.bundle.js`,
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: 'es2022',
  define: {
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
    'import.meta.env.MODE': '"production"',
    'import.meta.env.VITE_API_BASE': JSON.stringify(GAME_URL),
  },
});

// page : liens « Jouer » vers le jeu, pas de manifeste (l'application installable vit sur le domaine du jeu)
const html = (await readFile('index.html', 'utf8'))
  .replace('/src/shared/theme.css', '/theme.css')
  .replace('/src/landing/main.ts', '/landing.bundle.js')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replaceAll('href="/game/"', `href="${GAME_URL}/game/"`);
await writeFile(`${OUT}/index.html`, html);

// /game/ sur ce domaine (ancien lien, favori…) : redirection vers le jeu, en gardant ?join=… des invitations
await writeFile(`${OUT}/game/index.html`, `<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Steal a Masterpiece</title><meta http-equiv="refresh" content="0; url=${GAME_URL}/game/" />
<script>location.replace(${JSON.stringify(`${GAME_URL}/game/`)} + location.search);</script></head>
<body><p><a href="${GAME_URL}/game/">Ouvrir le jeu</a></p></body></html>`);

// fichiers statiques utiles à la page
await cp('src/shared/theme.css', `${OUT}/theme.css`);
await cp('public/fonts', `${OUT}/fonts`, { recursive: true });
await cp('public/icons', `${OUT}/icons`, { recursive: true });
await cp('public/logo.svg', `${OUT}/logo.svg`);
await cp('public/confidentialite.html', `${OUT}/confidentialite.html`);
await mkdir(`${OUT}/art`, { recursive: true });
const used = [...html.matchAll(/\/art\/([\w-]+\.(?:jpg|json))/g)].map((m) => m[1]);
for (const f of new Set([...used, 'credits.json'])) await cp(`public/art/${f}`, `${OUT}/art/${f}`);

console.log(`Page d'accueil → ${OUT}/ (jeu : ${GAME_URL}/game/, ${new Set(used).size} œuvres copiées)`);
