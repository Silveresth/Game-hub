/**
 * Adresse du client, pour les limites anti-abus.
 * Derrière un proxy HTTPS (Caddy, Nginx…), toutes les requêtes viennent du proxy : avec SAM_TRUST_PROXY=1,
 * on lit la première adresse de X-Forwarded-For. À n'activer que si le serveur n'est joignable que par ce proxy.
 */
const TRUST = process.env.SAM_TRUST_PROXY === '1';

export function clientIp(req) {
  if (TRUST) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd.slice(0, 64);
  }
  return req.socket.remoteAddress ?? '?';
}
