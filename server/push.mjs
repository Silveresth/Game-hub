// Notifications push (phase 4) — standard Web Push (VAPID), le même mécanisme que FCM utilise dans Chrome,
// sans compte Firebase. Fonctionne sur ordinateur, Android, et iPhone si le jeu est installé (iOS 16.4+).
//
// Règles du cahier des charges :
//  - catégories réglables par le joueur : vol en cours, œuvre volée, gardes sur le départ, ventes, admin abuse, caisse pleine ;
//  - 6 notifications par jour au maximum ;
//  - heures calmes de 22 h à 8 h (heure de Paris), sauf « vol en cours » si le joueur l'a activé.
import webpush from 'web-push';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CATEGORIES = {
  theft: 'Vol en cours',
  stolen: 'Œuvre volée',
  guards: 'Gardes sur le départ',
  sales: 'Ventes aux enchères',
  abuse: 'Admin abuse',
  cash: 'Caisse pleine',
};
const DAILY_MAX = 6;
const MAX_SUBS = 4; // appareils par joueur

const parisParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function paris(ms) {
  const p = Object.fromEntries(parisParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export const defaultPrefs = () => ({ theft: true, stolen: true, guards: true, sales: true, abuse: true, cash: true, theftAtNight: false });

/** Abonnement reçu du navigateur : on ne garde que ce qui sert, avec des limites de taille. */
export function cleanSubscription(s) {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !/^https?:\/\//.test(s.endpoint)) return null;
  const k = s.keys;
  if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return null;
  return { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export async function createPush({ dataDir, devMode = false, subject = process.env.SAM_VAPID_SUBJECT || 'https://steal-a-masterpiece.example' }) {
  const file = join(dataDir, 'vapid.json');
  let keys;
  try {
    keys = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    keys = webpush.generateVAPIDKeys(); // premier lancement : clés propres à ce serveur
    await writeFile(file, JSON.stringify(keys));
  }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  /** Journal des derniers envois (affiché dans l'admin, lu par les tests). */
  const log = [];

  /**
   * Envoie une notification à un joueur si ses réglages, le plafond du jour et les heures calmes le permettent.
   * @returns la raison d'un refus, ou null si envoyé
   */
  async function notify(p, category, { title, body, tag, url = './game/' }, now = Date.now()) {
    const push = p.push;
    if (!push?.subs?.length) return 'aucun appareil';
    if (push.prefs[category] === false) return 'catégorie désactivée';
    const { day, hour } = paris(now);
    const quiet = hour >= 22 || hour < 8;
    if (quiet && !(category === 'theft' && push.prefs.theftAtNight)) return 'heures calmes';
    if (push.day !== day) {
      push.day = day;
      push.sent = 0;
    }
    if (push.sent >= DAILY_MAX) return 'plafond du jour';
    push.sent++;
    const payload = JSON.stringify({ title, body, tag: tag ?? category, url });
    log.push({ at: now, player: p.name, category, title, body });
    if (log.length > 100) log.shift();
    await Promise.all(
      push.subs.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, payload, { TTL: category === 'theft' ? 300 : 3600, urgency: category === 'theft' ? 'high' : 'normal' });
        } catch (e) {
          // abonnement expiré ou révoqué : on l'oublie
          if (e?.statusCode === 404 || e?.statusCode === 410) push.subs = push.subs.filter((s) => s.endpoint !== sub.endpoint);
          else if (!devMode) console.warn('push :', e?.statusCode ?? e?.message);
        }
      }),
    );
    return null;
  }

  function subscribe(p, sub) {
    p.push ??= { subs: [], prefs: defaultPrefs(), day: '', sent: 0 };
    p.push.subs = [...p.push.subs.filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_SUBS);
  }

  function setPrefs(p, prefs) {
    p.push ??= { subs: [], prefs: defaultPrefs(), day: '', sent: 0 };
    for (const k of [...Object.keys(CATEGORIES), 'theftAtNight']) if (typeof prefs?.[k] === 'boolean') p.push.prefs[k] = prefs[k];
  }

  return { publicKey: keys.publicKey, notify, subscribe, setPrefs, log };
}
