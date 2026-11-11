/**
 * Bouton « Se connecter avec Google » (Google Identity Services), affiché seulement si le serveur
 * a un identifiant client (SAM_GOOGLE_CLIENT_ID). Sert à retrouver son musée sur un autre appareil.
 */
interface Gis {
  accounts: { id: { initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void; renderButton(el: HTMLElement, o: Record<string, unknown>): void } };
}

let clientId: string | null | undefined;
let script: Promise<void> | null = null;
let handler: (credential: string) => void = () => undefined;

export async function googleClientId(): Promise<string | null> {
  if (clientId !== undefined) return clientId;
  try {
    clientId = ((await (await fetch('/api/config')).json()) as { googleClientId: string | null }).googleClientId;
  } catch {
    clientId = null;
  }
  return clientId;
}

function loadScript(): Promise<void> {
  script ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Google indisponible'));
    document.head.appendChild(s);
  });
  return script;
}

/** Affiche le bouton Google dans `el` ; `onCredential` reçoit le jeton à envoyer au serveur. Renvoie false si indisponible. */
export async function mountGoogleButton(el: HTMLElement, onCredential: (credential: string) => void, text: 'signin_with' | 'continue_with' = 'continue_with'): Promise<boolean> {
  const id = await googleClientId();
  if (!id) return false;
  handler = onCredential;
  try {
    await loadScript();
  } catch {
    return false;
  }
  const g = (window as unknown as { google?: Gis }).google;
  if (!g) return false;
  g.accounts.id.initialize({ client_id: id, callback: (r) => handler(r.credential) });
  el.innerHTML = '';
  g.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', text, shape: 'pill', locale: 'fr' });
  return true;
}
