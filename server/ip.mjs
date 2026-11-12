/**
 * Adresse du client, pour les limites anti-abus.
 * Derrière un proxy HTTPS (Caddy, Nginx…), toutes les requêtes viennent du proxy : avec SAM_TRUST_PROXY=1,
 * on lit X-Forwarded-For. À n'activer que si le serveur n'est joignable que par ce proxy.
 *
 * On prend la DERNIÈRE adresse : c'est celle que notre proxy a ajoutée (la vraie adresse du client).
 * Les précédentes viennent du client lui-même et peuvent être inventées pour contourner les limites anti-abus.
 * Avec plusieurs proxys en chaîne (CDN + Caddy…), SAM_PROXY_HOPS indique combien d'adresses ignorer en partant de la fin.
 */
const TRUST = process.env.SAM_TRUST_PROXY === '1';
const HOPS = Math.max(1, Number(process.env.SAM_PROXY_HOPS) || 1);
/** En-tête posé par l'hébergeur avec la vraie adresse du client (ex. « true-client-ip », « cf-connecting-ip »). */
const IP_HEADER = (process.env.SAM_CLIENT_IP_HEADER ?? '').toLowerCase().trim();

export function clientIp(req) {
  if (TRUST && IP_HEADER) {
    const v = String(req.headers[IP_HEADER] ?? '').split(',')[0].trim();
    if (v) return v.slice(0, 64);
  }
  if (TRUST) {
    const list = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const fwd = list[Math.max(0, list.length - HOPS)];
    if (fwd) return fwd.slice(0, 64);
  }
  return req.socket.remoteAddress ?? '?';
}
