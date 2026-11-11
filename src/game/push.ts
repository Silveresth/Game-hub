/**
 * Notifications push (phase 4) : abonnement Web Push standard (VAPID) via le service worker du jeu.
 * La permission n'est demandée qu'après un geste du joueur, jamais au chargement de la page.
 */
import * as api from './api';

export const PUSH_CATEGORIES: Array<[keyof api.PushPrefs, string]> = [
  ['theft', '🚨 Vol en cours (caméra, laser)'],
  ['stolen', '🖼 Œuvre volée'],
  ['guards', '👮 Gardes sur le départ'],
  ['sales', '🔨 Grandes ventes et ventes prestige'],
  ['abuse', '🚀 Ventes admin abuse'],
  ['cash', '💰 Caisse pleine'],
  ['theftAtNight', '🌙 Vols en cours aussi la nuit (22 h – 8 h)'],
];

export type PushSupport = 'ok' | 'unsupported' | 'denied' | 'install-ios' | 'no-sw';

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (isIos() && !standalone()) return 'install-ios'; // iOS : seulement depuis l'écran d'accueil (16.4+)
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (!navigator.serviceWorker.controller) return 'no-sw';
  return 'ok';
}

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Demande la permission puis abonne cet appareil. À appeler depuis un clic. */
export async function enablePush(): Promise<api.PlayerState> {
  const support = pushSupport();
  if (support === 'install-ios') throw new Error('Sur iPhone : ajoutez d’abord le jeu à l’écran d’accueil (Partager → Sur l’écran d’accueil)');
  if (support === 'unsupported') throw new Error('Ce navigateur ne gère pas les notifications');
  if (support === 'denied') throw new Error('Notifications bloquées : autorisez-les dans les réglages du navigateur');
  if (support === 'no-sw') throw new Error('Notifications disponibles dans la version installée (npm start), pas en développement');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission refusée');
  const reg = await navigator.serviceWorker.ready;
  const { key } = (await (await fetch('/api/push/key')).json()) as { key: string };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }));
  const r = await api.pushSubscribe(sub.toJSON());
  return r.state;
}
