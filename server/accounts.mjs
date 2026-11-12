// Comptes joueurs : mots de passe (scrypt), validation des e-mails, e-mail de réinitialisation (Brevo).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Empreinte d'un mot de passe : « scrypt$N$r$p$sel$clé » (sel aléatoire, jamais le mot de passe lui-même). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [algo, n, r, p, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Adresse e-mail normalisée (minuscules, sans espaces) ou null. */
export function cleanEmail(raw) {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(e) ? e : null;
}

/** Raison pour laquelle un mot de passe est refusé, ou null. */
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Mot de passe : 8 caractères au moins';
  if (pw.length > 200) return 'Mot de passe trop long (200 caractères au plus)';
  return null;
}

/**
 * Envoie l'e-mail « mot de passe oublié » par l'API de Brevo.
 * Variables : BREVO_API_KEY, SAM_MAIL_FROM (expéditeur validé dans Brevo), SAM_MAIL_FROM_NAME (facultatif).
 * @returns 'sent' | 'not-configured' (lève une erreur si Brevo refuse)
 */
export async function sendResetEmail({ to, name, link }) {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.SAM_MAIL_FROM;
  if (!key || !from) return 'not-configured';
  const safeName = String(name).replace(/[<>&"]/g, '');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: process.env.SAM_MAIL_FROM_NAME || 'Steal a Masterpiece' },
      to: [{ email: to, name: safeName }],
      subject: 'Nouveau mot de passe pour votre musée',
      textContent: `Bonjour ${safeName},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.\n\nSteal a Masterpiece`,
      htmlContent: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#2b1d12">
        <h2 style="color:#8f5d18">Steal a Masterpiece</h2>
        <p>Bonjour ${safeName},</p>
        <p>Pour choisir un nouveau mot de passe, cliquez sur le bouton ci-dessous. Le lien est valable 1 heure.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 22px;background:#d8a64a;color:#2a1606;text-decoration:none;border-radius:4px;font-weight:bold">Choisir un nouveau mot de passe</a></p>
        <p style="color:#6b5a48;font-size:13px">Si vous n'avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.</p>
      </div>`,
    }),
  });
  if (!res.ok) throw new Error(`Brevo a refusé l'envoi (${res.status}) : ${(await res.text()).slice(0, 200)}`);
  return 'sent';
}

/** Jeton aléatoire (session, réinitialisation). */
export const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
