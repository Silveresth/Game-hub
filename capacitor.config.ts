// Application mobile (Capacitor) : une coque native plein écran qui ouvre le jeu en ligne (Render).
// Le jeu se met à jour sans republier l'application. Voir docs/MOBILE.md.
// Adresse du jeu : SAM_GAME_URL (la même que pour la page d'accueil Vercel), lue à chaque « npx cap sync ».
import type { CapacitorConfig } from '@capacitor/cli';

const gameUrl = (process.env.SAM_GAME_URL ?? 'https://jouer.mondomaine.fr').trim().replace(/\/+$/, '');

const config: CapacitorConfig = {
  appId: 'fr.stealamasterpiece.app',
  appName: 'Steal a Masterpiece',
  // petite page locale : affichée seulement si le serveur du jeu est injoignable
  webDir: 'mobile/www',
  backgroundColor: '#2c0b14',
  server: {
    url: `${gameUrl}/game/?source=app`,
    cleartext: false,
    androidScheme: 'https',
    errorPath: 'error.html',
  },
  android: {
    backgroundColor: '#2c0b14',
    allowMixedContent: false,
  },
};

export default config;
