// Paiements en argent réel : achat de STH coins (monnaie premium du jeu).
//
// Règles :
//  - le montant vient TOUJOURS de l'offre du catalogue (jamais du navigateur) ;
//  - une commande n'est créditée qu'après vérification serveur à serveur auprès du prestataire
//    (les notifications et retours de paiement ne font que déclencher cette vérification : on ne croit jamais leur contenu) ;
//  - une commande n'est créditée qu'une fois (idempotent, voir game.creditSth).
//
// Prestataires (activés seulement si leurs clés sont définies, voir docs/PAIEMENTS.md) :
//  - PayGate Global (Togo) : T-Money et Flooz/Moov, demande de paiement envoyée directement sur le téléphone (XOF) ;
//  - FedaPay : T-Money, Moov (Flooz), cartes Visa / Mastercard, page de paiement hébergée (XOF) ;
//  - CinetPay : mobile money et cartes Visa / Mastercard, page hébergée (XOF) ;
//  - PayPal : compte PayPal ou carte via PayPal (EUR, USD).
// En mode test (SAM_DEV=1) sans prestataire configuré, un faux prestataire « test » permet de tout essayer.
import { randomBytes } from 'node:crypto';

const ORDER_RE = /^sth_[A-Za-z0-9_-]{10,40}$/;
const PENDING_TTL = 48 * 3600_000; // une commande non payée expire au bout de 48 h

/** Moyens de paiement proposés aux joueurs, et prestataires capables de les encaisser (par ordre de préférence). */
const METHODS = {
  tmoney: { label: 'T-Money', icon: '📱', currencies: ['XOF'], providers: ['paygate', 'fedapay', 'cinetpay'] },
  flooz: { label: 'Flooz / Moov Money', icon: '📲', currencies: ['XOF'], providers: ['paygate', 'fedapay', 'cinetpay'] },
  card: { label: 'Carte Visa / Mastercard', icon: '💳', currencies: ['XOF'], providers: ['fedapay', 'cinetpay'] },
  paypal: { label: 'PayPal', icon: '🅿️', currencies: ['EUR', 'USD'], providers: ['paypal'] },
};

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`), { status: res.status, data });
  return data;
}
const postJson = (url, body, headers = {}) => fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body) });

export async function createPayments({ game, db, devMode = false }) {
  const env = process.env;
  const PACKS = game.premium.packs ?? [];
  const packById = new Map(PACKS.map((p) => [p.id, p]));

  // ---------------------------------------------------------------- prestataires

  const paygate = env.PAYGATE_AUTH_TOKEN
    ? {
        id: 'paygate',
        methods: ['tmoney', 'flooz'],
        needsPhone: true,
        /** Paiement direct : PayGate envoie la demande sur le téléphone du joueur, qui confirme avec son code. */
        async create(order, { phone }) {
          const r = await postJson('https://paygateglobal.com/api/v1/pay', {
            auth_token: env.PAYGATE_AUTH_TOKEN,
            phone_number: phone,
            amount: order.amount,
            description: order.description,
            identifier: order.id,
            network: order.method === 'tmoney' ? 'TMONEY' : 'FLOOZ',
          });
          // 0 : demande enregistrée ; 2 : jeton invalide ; 4 : paramètres invalides ; 6 : doublon
          if (Number(r?.status) !== 0) {
            const why = { 2: 'clé PayGate invalide', 4: 'numéro ou montant refusé', 6: 'transaction en double' }[Number(r?.status)] ?? 'refus du prestataire';
            throw Object.assign(new Error(`Paiement refusé (${why})`), { status: 402 });
          }
          order.ref = String(r.tx_reference ?? '');
          return { push: true };
        },
        async verify(order) {
          let r = null;
          try {
            r = await postJson('https://paygateglobal.com/api/v2/status', { auth_token: env.PAYGATE_AUTH_TOKEN, identifier: order.id });
          } catch {
            if (order.ref) r = await postJson('https://paygateglobal.com/api/v1/status', { auth_token: env.PAYGATE_AUTH_TOKEN, tx_reference: order.ref });
          }
          // 0 : paiement réussi ; 2 : en cours ; 4 : expiré ; 6 : annulé
          const s = Number(r?.status);
          if (s === 0) return r.amount !== undefined && Number(r.amount) !== order.amount ? 'mismatch' : 'paid';
          if (s === 4) return 'expired';
          if (s === 6) return 'failed';
          return 'pending';
        },
      }
    : null;

  const fedaBase = (env.FEDAPAY_ENV ?? (String(env.FEDAPAY_SECRET_KEY ?? '').includes('sandbox') ? 'sandbox' : 'live')) === 'sandbox'
    ? 'https://sandbox-api.fedapay.com/v1'
    : 'https://api.fedapay.com/v1';
  const fedaHeaders = () => ({ authorization: `Bearer ${env.FEDAPAY_SECRET_KEY}` });
  /** Selon la version de l'API, la transaction arrive seule ou enveloppée (« v1/transaction »). */
  const unwrapFeda = (r) => r?.['v1/transaction'] ?? r?.transaction ?? r;
  const fedapay = env.FEDAPAY_SECRET_KEY
    ? {
        id: 'fedapay',
        methods: ['tmoney', 'flooz', 'card'],
        async create(order, { returnUrl }) {
          const tx = unwrapFeda(await postJson(`${fedaBase}/transactions`, {
            description: order.description,
            amount: order.amount,
            currency: { iso: 'XOF' },
            callback_url: returnUrl,
            merchant_reference: order.id,
            custom_metadata: { order: order.id },
          }, fedaHeaders()));
          if (!tx?.id) throw new Error('FedaPay : transaction non créée');
          order.ref = String(tx.id);
          const tok = await postJson(`${fedaBase}/transactions/${tx.id}/token`, {}, fedaHeaders());
          if (!tok?.url) throw new Error('FedaPay : lien de paiement absent');
          return { url: tok.url };
        },
        async verify(order) {
          if (!order.ref) return 'pending';
          const tx = unwrapFeda(await fetchJson(`${fedaBase}/transactions/${encodeURIComponent(order.ref)}`, { headers: { accept: 'application/json', ...fedaHeaders() } }));
          if (tx?.status === 'approved' || tx?.status === 'transferred') return Number(tx.amount) === order.amount ? 'paid' : 'mismatch';
          if (tx?.status === 'expired' || tx?.status === 'refunded') return 'expired';
          return tx?.status === 'declined' || tx?.status === 'canceled' ? 'retry' : 'pending'; // pas définitif chez FedaPay
        },
      }
    : null;

  const cinetpay = env.CINETPAY_API_KEY && env.CINETPAY_SITE_ID
    ? {
        id: 'cinetpay',
        methods: ['tmoney', 'flooz', 'card'],
        async create(order, { returnUrl, notifyUrl, player }) {
          const r = await postJson('https://api-checkout.cinetpay.com/v2/payment', {
            apikey: env.CINETPAY_API_KEY,
            site_id: env.CINETPAY_SITE_ID,
            transaction_id: order.id,
            amount: order.amount,
            currency: 'XOF',
            description: order.description,
            notify_url: notifyUrl,
            return_url: returnUrl,
            channels: order.method === 'card' ? 'CREDIT_CARD' : 'MOBILE_MONEY',
            lang: 'fr',
            metadata: order.id,
            customer_id: player.id,
            customer_name: 'Joueur',
            customer_surname: String(player.name ?? 'Musée').slice(0, 40),
            customer_email: player.email ?? 'joueur@stealamasterpiece.app',
            customer_phone_number: '',
            customer_address: 'Lomé',
            customer_city: 'Lomé',
            customer_country: player.country === 'TG' || !player.country ? 'TG' : player.country,
            customer_state: player.country ?? 'TG',
            customer_zip_code: '00000',
          });
          if (String(r?.code) !== '201' || !r?.data?.payment_url) throw new Error(`CinetPay : ${r?.description ?? r?.message ?? 'paiement non créé'}`);
          order.ref = String(r.data.payment_token ?? '');
          return { url: r.data.payment_url };
        },
        async verify(order) {
          const r = await postJson('https://api-checkout.cinetpay.com/v2/payment/check', { apikey: env.CINETPAY_API_KEY, site_id: env.CINETPAY_SITE_ID, transaction_id: order.id });
          const s = r?.data?.status;
          if (s === 'ACCEPTED') return Number(r.data.amount) === order.amount ? 'paid' : 'mismatch';
          if (s === 'REFUSED') return 'failed';
          return 'pending';
        },
      }
    : null;

  const paypalBase = env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  let paypalToken = { value: '', until: 0 };
  async function paypalAuth() {
    if (paypalToken.value && Date.now() < paypalToken.until) return { authorization: `Bearer ${paypalToken.value}` };
    const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`).toString('base64');
    const r = await fetchJson(`${paypalBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    paypalToken = { value: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3000) - 120) * 1000 };
    return { authorization: `Bearer ${paypalToken.value}` };
  }
  const paypalPaid = (o, order) => {
    const pu = o?.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    const amt = cap?.amount ?? pu?.amount;
    return amt && amt.currency_code === order.currency && amt.value === order.amount.toFixed(2) ? 'paid' : 'mismatch';
  };
  const paypal = env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET
    ? {
        id: 'paypal',
        methods: ['paypal'],
        async create(order, { returnUrl }) {
          const r = await postJson(`${paypalBase}/v2/checkout/orders`, {
            intent: 'CAPTURE',
            purchase_units: [{ reference_id: order.id, custom_id: order.id, description: order.description, amount: { currency_code: order.currency, value: order.amount.toFixed(2) } }],
            payment_source: { paypal: { experience_context: { brand_name: 'Steal a Masterpiece', locale: 'fr-FR', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: returnUrl, cancel_url: returnUrl } } },
          }, { ...(await paypalAuth()), 'paypal-request-id': order.id });
          const link = (r?.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
          if (!r?.id || !link) throw new Error('PayPal : commande non créée');
          order.ref = r.id;
          return { url: link.href };
        },
        async verify(order) {
          if (!order.ref) return 'pending';
          const headers = await paypalAuth();
          const o = await fetchJson(`${paypalBase}/v2/checkout/orders/${encodeURIComponent(order.ref)}`, { headers: { accept: 'application/json', ...headers } });
          if (o.status === 'COMPLETED') return paypalPaid(o, order);
          if (o.status === 'APPROVED') {
            // le joueur a validé chez PayPal : on encaisse (une seule fois grâce à l'identifiant de requête)
            const c = await postJson(`${paypalBase}/v2/checkout/orders/${encodeURIComponent(order.ref)}/capture`, {}, { ...headers, 'paypal-request-id': `${order.id}-capture` });
            return c.status === 'COMPLETED' ? paypalPaid(c, order) : 'pending';
          }
          if (o.status === 'VOIDED') return 'failed';
          return 'pending';
        },
      }
    : null;

  /** Faux prestataire du mode test : le paiement est validé par un bouton (jamais en production). */
  const test = devMode
    ? { id: 'test', methods: Object.keys(METHODS), async create() { return { test: true }; }, async verify(order) { return order.testPaid ? 'paid' : 'pending'; } }
    : null;

  const providers = Object.fromEntries([paygate, fedapay, cinetpay, paypal].filter(Boolean).map((p) => [p.id, p]));
  const realProviders = Object.keys(providers).length;
  if (test && !realProviders) providers.test = test;

  /** Prestataire retenu pour un moyen de paiement (le premier configuré), ou null. */
  function providerFor(method) {
    const m = METHODS[method];
    if (!m) return null;
    for (const id of m.providers) if (providers[id]) return providers[id];
    return providers.test ?? null;
  }

  // ---------------------------------------------------------------- commandes (persistées)

  /** @type {Map<string, any>} */
  const orders = new Map();
  for (const o of (await db.kvGet('orders').catch(() => null)) ?? []) if (o?.id) orders.set(o.id, o);
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const list = [...orders.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-5000);
      try {
        await db.kvSet('orders', list);
      } catch (e) {
        console.error('Enregistrement des commandes impossible :', e.message);
      }
    }, 400);
  }

  const publicOrder = (o) => ({ id: o.id, pack: o.pack, sth: o.sth, method: o.method, amount: o.amount, currency: o.currency, status: o.status, hint: o.hint ?? null, createdAt: o.createdAt, test: o.provider === 'test' });

  function fulfil(order) {
    if (order.status === 'paid') return;
    const r = game.creditSth(order.playerId, order.sth, order.id, { provider: order.provider, amount: order.amount, currency: order.currency });
    if (!r) {
      order.status = 'error';
      order.hint = 'Joueur introuvable : contactez le support avec le numéro de commande';
    } else {
      order.status = 'paid';
      order.paidAt = Date.now();
      order.hint = null;
      console.log(`💎 Paiement confirmé ${order.id} : ${order.sth} STH (${order.amount} ${order.currency}, ${order.provider})`);
    }
    order.updatedAt = Date.now();
    save();
  }

  /** Vérifie une commande auprès de son prestataire (au plus toutes les `minGap` ms). */
  async function verify(order, minGap = 3000) {
    if (order.status !== 'pending') return order;
    const now = Date.now();
    if (now - (order.checkedAt ?? 0) < minGap) return order;
    order.checkedAt = now;
    if (now - order.createdAt > PENDING_TTL) {
      order.status = 'expired';
      save();
      return order;
    }
    const prov = providers[order.provider];
    if (!prov) return order;
    try {
      const s = await prov.verify(order);
      if (s === 'paid') fulfil(order);
      else if (s === 'mismatch') {
        order.status = 'error';
        order.hint = 'Montant reçu différent du prix de l’offre : contactez le support';
        console.error(`Paiement ${order.id} : montant différent (${order.provider})`);
      } else if (s === 'failed' || s === 'expired') order.status = s;
      else if (s === 'retry') order.hint = 'Paiement refusé ou annulé : vous pouvez réessayer depuis la page de paiement';
      order.updatedAt = Date.now();
      save();
    } catch (e) {
      // prestataire injoignable : on réessaiera
      order.hint = null;
      if (devMode) console.warn(`Vérification ${order.id} impossible :`, e.message);
    }
    return order;
  }

  // vérification de fond : un joueur qui a fermé le jeu pendant le paiement est quand même crédité
  setInterval(() => {
    const now = Date.now();
    for (const o of orders.values()) {
      if (o.status !== 'pending') continue;
      const age = now - o.createdAt;
      void verify(o, age < 2 * 3600_000 ? 60_000 : 10 * 60_000);
    }
  }, 30_000).unref();

  // ---------------------------------------------------------------- HTTP

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch {
          // notifications envoyées en formulaire (application/x-www-form-urlencoded)
          resolve(Object.fromEntries(new URLSearchParams(text)));
        }
      });
      req.on('error', () => resolve({}));
    });
  }

  /** Adresse publique du jeu (liens de retour et de notification envoyés aux prestataires). */
  function publicBase(req) {
    if (env.SAM_PUBLIC_URL) return env.SAM_PUBLIC_URL.replace(/\/+$/, '');
    const proto = env.SAM_TRUST_PROXY === '1' ? String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0].trim() : 'http';
    return `${proto}://${req.headers.host}`;
  }

  /** Numéro mobile money : chiffres seulement, sans l'indicatif du Togo (228). */
  function cleanPhone(raw) {
    let d = String(raw ?? '').replace(/\D/g, '');
    if (d.startsWith('00228')) d = d.slice(5);
    else if (d.startsWith('228') && d.length === 11) d = d.slice(3);
    return /^\d{8}$/.test(d) ? d : null;
  }

  const creates = new Map(); // anti-abus : commandes créées par joueur
  setInterval(() => {
    const now = Date.now();
    for (const [k, list] of creates) if (!list.some((t) => now - t < 10 * 60_000)) creates.delete(k);
  }, 5 * 60_000).unref();

  /** Valeurs (chaînes et nombres) d'une notification, pour y retrouver le numéro de commande ou la référence du prestataire. */
  function scalars(obj, depth = 0, out = []) {
    if (depth > 4 || obj === null || obj === undefined) return out;
    if (typeof obj === 'string' || typeof obj === 'number') out.push(String(obj));
    else if (typeof obj === 'object') for (const v of Object.values(obj).slice(0, 80)) scalars(v, depth + 1, out);
    return out;
  }

  async function handle(req, res, url) {
    const route = url.pathname.slice('/api/pay/'.length);

    if (route === 'config' && req.method === 'GET') {
      const methods = Object.entries(METHODS)
        .map(([id, m]) => ({ id, label: m.label, icon: m.icon, currencies: m.currencies, provider: providerFor(id)?.id ?? null, needsPhone: !!providerFor(id)?.needsPhone }))
        .filter((m) => m.provider);
      return json(res, 200, { methods, packs: PACKS, test: !!providers.test });
    }

    // notification d'un prestataire : on ne fait que relancer la vérification (le contenu n'est jamais cru)
    if (route.startsWith('notify/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const values = new Set([...scalars(body), ...url.searchParams.values()]);
      for (const o of orders.values()) {
        if (o.status === 'pending' && (values.has(o.id) || (o.ref && values.has(o.ref)))) await verify(o, 0);
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('OK');
    }

    const p = game.authReq(req);
    if (!p) return json(res, 401, { error: 'Session invalide' });

    if (route === 'create' && req.method === 'POST') {
      const body = await readBody(req);
      const pack = packById.get(String(body.pack ?? ''));
      if (!pack) return json(res, 422, { error: 'Offre inconnue' });
      const m = METHODS[String(body.method ?? '')];
      const prov = providerFor(String(body.method ?? ''));
      if (!m || !prov) return json(res, 422, { error: 'Moyen de paiement indisponible pour le moment' });
      const currency = m.currencies.includes(String(body.currency ?? '').toUpperCase()) ? String(body.currency).toUpperCase() : m.currencies[0];
      const amount = currency === 'XOF' ? pack.xof : currency === 'EUR' ? pack.eur : pack.usd;
      if (!Number.isFinite(amount) || amount <= 0) return json(res, 422, { error: 'Prix indisponible dans cette monnaie' });
      let phone = null;
      if (prov.needsPhone) {
        phone = cleanPhone(body.phone);
        if (!phone) return json(res, 422, { error: 'Numéro de téléphone invalide (8 chiffres, ex. 90 12 34 56)' });
      }
      const now = Date.now();
      const recent = (creates.get(p.id) ?? []).filter((t) => now - t < 10 * 60_000);
      if (recent.length >= (devMode ? 500 : 8)) return json(res, 429, { error: 'Trop de paiements commencés : réessayez dans quelques minutes' });
      creates.set(p.id, [...recent, now]);
      const sth = pack.sth + (pack.bonus ?? 0);
      const order = {
        id: `sth_${randomBytes(12).toString('base64url')}`,
        playerId: p.id,
        pack: pack.id,
        sth,
        method: body.method,
        provider: prov.id,
        amount,
        currency,
        status: 'pending',
        description: `${sth.toLocaleString('fr-FR')} STH coins - Steal a Masterpiece`,
        createdAt: now,
        updatedAt: now,
        ...(phone ? { phone: `${phone.slice(0, 2)}••••${phone.slice(-2)}` } : {}),
      };
      const base = publicBase(req);
      try {
        const r = await prov.create(order, { phone, returnUrl: `${base}/game/?pay=${order.id}`, notifyUrl: `${base}/api/pay/notify/${prov.id}`, player: p });
        orders.set(order.id, order);
        save();
        return json(res, 200, { order: publicOrder(order), url: r.url ?? null, push: !!r.push, test: !!r.test });
      } catch (e) {
        console.error(`Paiement ${prov.id} : création impossible :`, e.message);
        return json(res, e.status === 402 ? 402 : 502, { error: e.status === 402 ? e.message : 'Le service de paiement ne répond pas : réessayez dans un instant' });
      }
    }

    if (route === 'order' && req.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const o = ORDER_RE.test(id) ? orders.get(id) : null;
      if (!o || o.playerId !== p.id) return json(res, 404, { error: 'Commande introuvable' });
      await verify(o);
      return json(res, 200, { order: publicOrder(o), sth: Math.floor(p.sth) });
    }

    if (route === 'orders' && req.method === 'GET') {
      const list = [...orders.values()].filter((o) => o.playerId === p.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
      return json(res, 200, { orders: list.map(publicOrder) });
    }

    if (devMode && route === 'test/complete' && req.method === 'POST') {
      const body = await readBody(req);
      const o = orders.get(String(body.id ?? ''));
      if (!o || o.playerId !== p.id || o.provider !== 'test') return json(res, 404, { error: 'Commande de test introuvable' });
      o.testPaid = true;
      await verify(o, 0);
      return json(res, 200, { order: publicOrder(o), sth: Math.floor(p.sth) });
    }

    return json(res, 404, { error: 'Route inconnue' });
  }

  return {
    handle,
    /** Pour le panneau admin : dernières commandes et total encaissé par monnaie. */
    adminSummary() {
      const list = [...orders.values()].sort((a, b) => b.createdAt - a.createdAt);
      const totals = {};
      for (const o of list) if (o.status === 'paid') totals[o.currency] = (totals[o.currency] ?? 0) + o.amount;
      return {
        providers: Object.keys(providers),
        totals,
        recent: list.slice(0, 15).map((o) => ({ ...publicOrder(o), provider: o.provider, player: game.getPlayer(o.playerId)?.name ?? '?' })),
      };
    },
  };
}
