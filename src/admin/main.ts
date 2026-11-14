// Panneau admin : planning des ventes, création d'une vente « admin abuse », annonce, annulation, derniers résultats.
// Toutes les actions passent par /api/admin/* avec le jeton admin (gardé seulement le temps de l'onglet).
import catalog from '../shared/catalog.json';

interface Work { id: string; title: string; rarity: string; price: number; unique: boolean; owner: string | null }
interface Sale { id: string; kind: string; label: string; at: number; live: boolean; admin: boolean; announced: boolean | null; lots: Array<{ workId: string; frame: string }> | null }
interface Overview {
  now: number;
  dev: boolean;
  stats: { players: number; online: number; districts: number; private?: number };
  live: { sale: Sale; lot: { index: number; count: number; workId: string; price: number; phase: string } | null; hall: number } | null;
  upcoming: Sale[];
  results: Array<{ at: number; sale: string; workId: string; frame: string; price: number; winner: string; npc: boolean }>;
  works: Work[];
  push: Array<{ at: number; player: string; category: string; title: string; body: string }>;
  liveEvent: { kind: string; label: string; icon: string; endsAt: number; admin?: boolean } | null;
  season?: { id: string; mode: 'auto' | 'manual'; custom: { skyTop?: string; skyHorizon?: string; grass?: string } | null };
  payments?: {
    providers: string[];
    health?: Record<string, { sandbox: boolean; keyOk?: boolean | null; checkedAt?: number; lastError?: { at: number; status: number | null; message: string; auth: boolean } }>;
    totals: Record<string, number>;
    recent: Array<{ id: string; player: string; sth: number; amount: number; currency: string; status: string; method: string; provider: string; createdAt: number }>;
  };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nf = new Intl.NumberFormat('fr-FR');
const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const title = (id: string) => catalog.works.find((w) => w.id === id)?.title ?? id;
type FrameDef = { label: string; short?: string; icon?: string; mult: number; season?: string };
type SeasonDef = { label: string; icon: string; desc: string; sky: [string, string]; grass: string; flags: string[]; event?: string };
type EventDef = { label: string; icon: string; desc: string; admin?: boolean; season?: string };
const FRAME_DEFS = catalog.frames as unknown as Record<string, FrameDef>;
const SEASONS = (catalog as unknown as { seasons: Record<string, SeasonDef> }).seasons;
const EVENTS = (catalog as unknown as { events: { kinds: Record<string, EventDef> }; liveEvents: { minutes: Record<string, number> } });
/** Cadres et mutations proposés pour les lots (les mutations saisonnières aussi). */
const FRAMES: Record<string, string> = Object.fromEntries(
  Object.entries(FRAME_DEFS).map(([k, f]) => [k, k === 'normal' ? 'Cadre normal' : `${f.icon ?? ''} ${f.label} (×${f.mult})`.trim()]),
);
const RAR: Record<string, string> = { commun: 'Commun', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique' };

let token = '';
try {
  token = sessionStorage.getItem('sam-admin') ?? '';
} catch {
  /* stockage indisponible */
}
let data: Overview | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function say(text: string, ok = true): void {
  $('msg').textContent = text;
  $('msg').className = ok ? 'ok' : 'err';
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { 'x-admin-token': token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Erreur ${res.status}`), { status: res.status });
  return json;
}

async function refresh(): Promise<void> {
  try {
    data = await call<Overview>('GET', 'overview');
  } catch (e) {
    if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 503) {
      $('panel').hidden = true;
      $('login').hidden = false;
      say((e as Error).message, false);
      $('login').prepend($('msg'));
    }
    return;
  }
  $('login').hidden = true;
  $('panel').hidden = false;
  $('panel').prepend($('msg'));
  render();
  if (!playersLoaded) void loadPlayers();
}

function render(): void {
  if (!data) return;
  $('sPlayers').textContent = nf.format(data.stats.players);
  $('sOnline').textContent = nf.format(data.stats.online);
  $('sDistricts').textContent = `${nf.format(data.stats.districts)}${data.stats.private ? ` (${data.stats.private} privé${data.stats.private > 1 ? 's' : ''})` : ''}`;
  $('sLive').textContent = data.live ? `${data.live.sale.label} · lot ${(data.live.lot?.index ?? 0) + 1}/${data.live.lot?.count ?? 0}` : 'aucune';
  const ev = data.liveEvent;
  $('liveState').textContent = ev
    ? `${ev.icon} ${ev.label} en cours (${ev.admin ? 'admin abuse' : 'événement du convoi'}), fin à ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(ev.endsAt)}.`
    : 'Aucun événement en cours.';
  renderSeason();
  $('atHint').textContent = data.dev ? 'Mode test : la vente peut être programmée tout de suite, et lancée avec « Lancer ».' : 'Au moins 1 h à l’avance, pour laisser le temps de prévenir les joueurs.';

  $('sales').innerHTML = data.upcoming.map((s) => {
    const lots = s.lots ? s.lots.map((l) => `${esc(title(l.workId))}${l.frame !== 'normal' ? ` (${FRAME_DEFS[l.frame]?.short ?? l.frame})` : ''}`).join(', ') : '<span class="muted">tirés au sort</span>';
    const actions = s.admin
      ? `${s.announced ? '<span class="tag">annoncée</span>' : `<button class="ghost" data-act="announce" data-id="${s.id}">Annoncer</button>`}
         ${data!.dev ? `<button class="ghost" data-act="start" data-id="${s.id}">Lancer</button>` : ''}
         <button class="danger" data-act="cancel" data-id="${s.id}">Annuler</button>`
      : '';
    return `<tr><td>${when.format(s.at)}</td><td><span class="tag ${s.live ? 'live' : s.kind}">${esc(s.label)}</span></td><td>${lots}</td><td style="white-space:nowrap">${actions}</td></tr>`;
  }).join('');

  $('results').innerHTML = data.results.length
    ? data.results.map((r) => `<tr><td>${esc(title(r.workId))}</td><td>${nf.format(r.price)}</td><td>${esc(r.winner)}${r.npc ? ' <span class="muted">(PNJ)</span>' : ''}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">Aucune vente pour l’instant</td></tr>';
  $('pushes').innerHTML = data.push.length
    ? data.push.map((p) => `<tr><td>${esc(p.player)}</td><td>${esc(p.title)}<div class="muted">${esc(p.body)}</div></td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">Aucune notification envoyée</td></tr>';
  // achats de STH coins : prestataires actifs, total encaissé, dernières commandes
  const pay = data.payments;
  const STATUS: Record<string, string> = { paid: '✅ payée', pending: '⏳ en attente', failed: '✖ refusée', expired: '⌛ expirée', error: '⚠ à vérifier' };
  // prestataires : mode (test / réel), clé acceptée ou refusée au démarrage, dernière erreur
  const provText = (id: string) => {
    const h = pay?.health?.[id];
    if (!h) return id;
    const key = h.keyOk === true ? 'clé acceptée ✅' : h.keyOk === false ? 'CLÉ REFUSÉE ❌' : '';
    const err = h.lastError ? ` · dernière erreur ${when.format(h.lastError.at)} : ${h.lastError.message}` : '';
    return `${id} (${h.sandbox ? 'sandbox' : 'live'}${key ? `, ${key}` : ''})${err}`;
  };
  $('payInfo').textContent = pay
    ? `Prestataires actifs : ${pay.providers.length ? pay.providers.map(provText).join(' · ') : 'aucun (voir docs/PAIEMENTS.md)'} · encaissé : ${Object.entries(pay.totals).map(([c, n]) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c }).format(n)).join(' + ') || '0'}`
    : '';
  $('payments').innerHTML = pay?.recent.length
    ? pay.recent.map((o) => `<tr><td>${esc(o.player)}<div class="muted">${when.format(o.createdAt)}</div></td><td>${nf.format(o.sth)} STH<div class="muted">${esc(o.method)} · ${esc(o.provider)}</div></td><td>${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: o.currency }).format(o.amount)}</td><td>${STATUS[o.status] ?? esc(o.status)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">Aucun achat pour l’instant</td></tr>';

  // listes d'œuvres des lots (les Mythiques déjà possédées ne peuvent pas être vendues)
  document.querySelectorAll<HTMLSelectElement>('select.work').forEach((sel) => {
    const v = sel.value;
    sel.innerHTML = data!.works
      .slice()
      .sort((a, b) => b.price - a.price)
      .map((w) => `<option value="${w.id}" ${w.owner ? 'disabled' : ''}>${esc(w.title)} — ${RAR[w.rarity]}${w.unique ? ' (unique)' : ''}${w.owner ? ` · à ${esc(w.owner)}` : ''}</option>`)
      .join('');
    if (v) sel.value = v;
  });
  fillGiftWorks();
}

function addLot(): void {
  if ($('lots').children.length >= 8) return;
  const row = document.createElement('div');
  row.className = 'lot';
  row.innerHTML = `<select class="work"></select><select class="frame">${Object.entries(FRAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button type="button" class="ghost" title="Retirer">✕</button>`;
  row.querySelector('button')!.onclick = () => row.remove();
  $('lots').appendChild(row);
  render();
}

$('addLot').onclick = addLot;

$('loginForm').onsubmit = (e) => {
  e.preventDefault();
  token = $<HTMLInputElement>('token').value.trim();
  try {
    sessionStorage.setItem('sam-admin', token);
  } catch {
    /* stockage indisponible */
  }
  void refresh();
};

$('saleForm').onsubmit = async (e) => {
  e.preventDefault();
  const at = new Date($<HTMLInputElement>('at').value).getTime();
  const lots = [...document.querySelectorAll<HTMLElement>('#lots .lot')].map((r) => ({
    workId: r.querySelector<HTMLSelectElement>('select.work')!.value,
    frame: r.querySelector<HTMLSelectElement>('select.frame')!.value,
  }));
  try {
    const r = await call<{ sale: Sale }>('POST', 'sales', { title: $<HTMLInputElement>('title').value, at, lots, announce: $<HTMLInputElement>('announce').checked });
    say(`Vente « ${r.sale.label} » programmée le ${when.format(r.sale.at)}${r.sale.announced ? ' et annoncée' : ''}.`);
    await refresh();
  } catch (err) {
    say((err as Error).message, false);
  }
};

// ---------------------------------------------------------------- thème du monde (saisons)

let colorsTouched = false;
function renderSeason(): void {
  const s = data?.season;
  if (!s) return;
  const def = SEASONS[s.id];
  $('seasonState').textContent = `${def?.icon ?? ''} ${def?.label ?? s.id} · ${s.mode === 'auto' ? 'automatique (selon la date)' : 'imposé par l’admin'}${s.custom ? ' · couleurs personnalisées' : ''}`;
  const btn = (id: string, label: string, sub: string, colors: string[], on: boolean) =>
    `<button type="button" data-season="${id}" class="${on ? 'on' : ''}"><span class="sw">${colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${label}</b><small>${esc(sub)}</small></button>`;
  $('seasonBtns').innerHTML =
    btn('auto', '📅 Automatique', 'Suit le calendrier', ['#1d6fd8', '#eef5ff', '#2b1650', '#ff9ecb', '#0b86ff'], s.mode === 'auto') +
    Object.entries(SEASONS).map(([id, d]) => btn(id, `${d.icon} ${d.label}`, d.desc.split(',')[0], [d.sky[0], d.sky[1], d.grass, ...d.flags.slice(0, 2)], s.mode === 'manual' && s.id === id)).join('');
  // couleurs affichées : celles en vigueur (personnalisées, sinon celles du thème) tant que l'admin n'y a pas touché
  if (!colorsTouched) {
    $<HTMLInputElement>('cSkyTop').value = s.custom?.skyTop ?? def?.sky[0] ?? '#1d6fd8';
    $<HTMLInputElement>('cSkyHorizon').value = s.custom?.skyHorizon ?? def?.sky[1] ?? '#8fc8ff';
    $<HTMLInputElement>('cGrass').value = s.custom?.grass ?? def?.grass ?? '#4fa63f';
  }
}
['cSkyTop', 'cSkyHorizon', 'cGrass'].forEach((id) => $(id).addEventListener('input', () => (colorsTouched = true)));

async function setSeason(body: Record<string, unknown>, done: string): Promise<void> {
  try {
    const r = await call<{ season: Overview['season'] }>('POST', 'season', body);
    if (data) data.season = r.season;
    colorsTouched = false;
    say(done);
    renderSeason();
  } catch (err) {
    say((err as Error).message, false);
  }
}
$('seasonBtns').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-season]');
  if (!b) return;
  const id = b.dataset.season!;
  const custom = data?.season?.custom ?? null;
  void setSeason(id === 'auto' ? { mode: 'auto', custom } : { mode: 'manual', id, custom }, id === 'auto' ? 'Saison automatique (selon la date) : appliquée chez tous les joueurs.' : `${SEASONS[id].icon} ${SEASONS[id].label} : appliqué chez tous les joueurs en ligne.`);
});
$('seasonColors').onclick = () => {
  const s = data?.season;
  void setSeason(
    { mode: s?.mode ?? 'auto', id: s?.id, custom: { skyTop: $<HTMLInputElement>('cSkyTop').value, skyHorizon: $<HTMLInputElement>('cSkyHorizon').value, grass: $<HTMLInputElement>('cGrass').value } },
    'Couleurs du ciel et du sol appliquées.',
  );
};
$('seasonColorsReset').onclick = () => {
  const s = data?.season;
  void setSeason({ mode: s?.mode ?? 'auto', id: s?.id, custom: null }, 'Couleurs d’origine du thème rétablies.');
};

// ---------------------------------------------------------------- « admin abuse » en direct

$('liveBtns').innerHTML =
  Object.entries(EVENTS.events.kinds)
    .filter(([, e]) => e.admin)
    .map(([k, e]) => `<button type="button" data-live="${k}">${e.icon} ${esc(e.label)} · ${EVENTS.liveEvents.minutes[k] ?? 5} min${e.season ? ` <span class="tag">${SEASONS[e.season]?.icon ?? ''} ${esc(SEASONS[e.season]?.label ?? e.season)}</span>` : ''}</button>`)
    .join('') + '<button type="button" class="danger" id="liveStop">Arrêter</button>';
$('liveBtns').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  try {
    if (b.id === 'liveStop') {
      await call('DELETE', 'live');
      say('Événement arrêté.');
    } else {
      const r = await call<{ event: { label: string } }>('POST', 'live', { kind: b.dataset.live });
      say(`${r.event.label} lancé pour tous les joueurs en ligne.`);
    }
    await refresh();
  } catch (err) {
    say((err as Error).message, false);
  }
});

$('sales').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'cancel' && !confirm('Annuler cette vente ?')) return;
  try {
    if (act === 'cancel') await call('DELETE', `sales/${id}`);
    else await call('POST', `sales/${id}/${act}`);
    say(act === 'cancel' ? 'Vente annulée.' : act === 'announce' ? 'Vente annoncée aux joueurs.' : 'Vente lancée.');
    await refresh();
  } catch (err) {
    say((err as Error).message, false);
  }
});

// ---------------------------------------------------------------- joueurs : liste, fiche, création, modification, suppression

interface PlayerRow {
  id: string; name: string; email: string | null; google: boolean; password: boolean; registered: boolean;
  country: string; color: string; level: number; maxLevel: number; coins: number; sth: number; value: number;
  artworks: number; chestCount: number; rebirths: number; createdAt: number; lastSeen: number; online: boolean; escrow: number;
}
interface PlayerDetail extends Omit<PlayerRow, 'artworks'> {
  cash: number; income: number; inviteCode: string; devices: number; pushDevices: number;
  chests: Record<string, number>; privateUntil: number;
  artworks: Array<{ uid: string; workId: string; frame: string; slot: number | null; repro: boolean; carried: boolean; value: number }>;
  purchases: Array<{ order: string; sth: number; at: number; provider?: string; amount?: number; currency?: string }>;
}
interface PlayerList {
  total: number; page: number; pages: number; size: number;
  counts: { all: number; registered: number; guests: number; online: number };
  players: PlayerRow[];
}

type Country = { code: string; name: string; flag: string };
const COUNTRIES = (catalog as unknown as { countries?: Country[] }).countries ?? [];
const CHESTS = (catalog as unknown as { chests: Record<string, { label: string; price: number }> }).chests;
const LEVELS = (catalog as unknown as { levels: Array<{ level: number; rooms: number; slots: number }> }).levels;
const flagOf = (code: string) => COUNTRIES.find((c) => c.code === code)?.flag ?? code;
const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const dayText = (ms: number) => (ms ? day.format(ms) : '—');
function priceText(amount: number | undefined, currency: string | undefined): string {
  if (amount == null || !currency) return '';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
/** « à l’instant », « il y a 5 min », « il y a 3 j »… */
function ago(ms: number): string {
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 30 * 86400) return `il y a ${Math.round(s / 86400)} j`;
  return `le ${day.format(ms)}`;
}

const pq = { q: '', filter: 'all', sort: 'recent', page: 0 };
let plist: PlayerList | null = null;
let playersLoaded = false;
/** Joueurs cochés, gardés d'une page et d'une recherche à l'autre : identifiant → nom. */
const picked = new Map<string, string>();

async function loadPlayers(): Promise<void> {
  const qs = new URLSearchParams({ q: pq.q, filter: pq.filter, sort: pq.sort, page: String(pq.page) });
  try {
    plist = await call<PlayerList>('GET', `players?${qs}`);
  } catch (e) {
    say((e as Error).message, false);
    return;
  }
  playersLoaded = true;
  pq.page = plist.page;
  renderPlayers();
}

function renderPlayers(): void {
  if (!plist) return;
  const c = plist.counts;
  const s = (n: number) => (n > 1 ? 's' : '');
  $('pCounts').textContent =
    `${nf.format(c.all)} joueur${s(c.all)} : ${nf.format(c.registered)} inscrit${s(c.registered)} · ${nf.format(c.guests)} invité${s(c.guests)} · ${nf.format(c.online)} en ligne` +
    (pq.q || pq.filter !== 'all' ? ` — ${nf.format(plist.total)} dans cette liste` : '') +
    (picked.size ? ` — ${picked.size} coché${s(picked.size)}` : '');
  $('players').innerHTML = plist.players.length
    ? plist.players.map((p) => `
      <tr data-id="${esc(p.id)}" class="${picked.has(p.id) ? 'sel' : ''}">
        <td><input type="checkbox" class="pick" ${picked.has(p.id) ? 'checked' : ''} aria-label="Cocher ${esc(p.name)}" /></td>
        <td><b>${esc(p.name)}</b>${p.online ? ' <span class="tag on">en ligne</span>' : ''}${p.registered ? '' : ' <span class="tag guest">invité</span>'}
          <div class="muted">${p.email ? esc(p.email) : p.google ? 'compte Google' : 'sans compte'}${p.email && p.google ? ' · Google' : ''}</div></td>
        <td title="${esc(p.country)}">${flagOf(p.country)}</td>
        <td class="num">${p.level}${p.rebirths ? ` <span class="muted" title="Renaissances">♻${p.rebirths}</span>` : ''}</td>
        <td class="num">${nf.format(p.coins)}</td>
        <td class="num">${nf.format(p.sth)}</td>
        <td class="num">${nf.format(p.value)}</td>
        <td class="muted">${p.online ? 'en jeu' : ago(p.lastSeen)}<div>créé ${dayText(p.createdAt)}</div></td>
        <td class="acts"><button type="button" class="ghost" data-pact="edit">Gérer</button> <button type="button" class="ghost" data-pact="gift" title="Offrir un cadeau à ce joueur" aria-label="Offrir un cadeau à ${esc(p.name)}">🎁</button></td>
      </tr>`).join('')
    : `<tr><td colspan="9" class="muted">${pq.q ? 'Aucun joueur ne correspond à cette recherche' : 'Aucun joueur dans cette liste'}</td></tr>`;
  $<HTMLInputElement>('pAll').checked = plist.players.length > 0 && plist.players.every((p) => picked.has(p.id));
  $('pPage').textContent = `Page ${plist.page + 1} / ${plist.pages}`;
  $<HTMLButtonElement>('pPrev').disabled = plist.page <= 0;
  $<HTMLButtonElement>('pNext').disabled = plist.page >= plist.pages - 1;
  renderGiftSummary();
}

let searchTimer: number | undefined;
$('pSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    pq.q = $<HTMLInputElement>('pSearch').value.trim();
    pq.page = 0;
    void loadPlayers();
  }, 300);
});
$('pFilter').onchange = () => {
  pq.filter = $<HTMLSelectElement>('pFilter').value;
  pq.page = 0;
  void loadPlayers();
};
$('pSort').onchange = () => {
  pq.sort = $<HTMLSelectElement>('pSort').value;
  pq.page = 0;
  void loadPlayers();
};
$('pPrev').onclick = () => {
  pq.page = Math.max(0, pq.page - 1);
  void loadPlayers();
};
$('pNext').onclick = () => {
  pq.page++;
  void loadPlayers();
};
$('pAll').onchange = () => {
  const on = $<HTMLInputElement>('pAll').checked;
  for (const p of plist?.players ?? []) {
    if (on) picked.set(p.id, p.name);
    else picked.delete(p.id);
  }
  renderPlayers();
};
$('players').addEventListener('change', (e) => {
  const cb = (e.target as HTMLElement).closest<HTMLInputElement>('input.pick');
  const id = cb?.closest<HTMLElement>('tr')?.dataset.id;
  const row = plist?.players.find((p) => p.id === id);
  if (!cb || !row) return;
  if (cb.checked) picked.set(row.id, row.name);
  else picked.delete(row.id);
  renderPlayers();
});
$('players').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pact]');
  const id = b?.closest<HTMLElement>('tr')?.dataset.id;
  const row = plist?.players.find((p) => p.id === id);
  if (!b || !row) return;
  if (b.dataset.pact === 'edit') void openPlayer(row.id);
  else giftTo(row.id, row.name);
});

// ---------------------------------------------------------------- cadeaux

type GiftKind = 'coins' | 'sth' | 'chest' | 'artwork';
const GIFT_DEFAULT: Record<GiftKind, number> = { coins: 10_000, sth: 50, chest: 1, artwork: 1 };
let giftKind: GiftKind = 'coins';

$('gChest').innerHTML = Object.entries(CHESTS).map(([id, c]) => `<option value="${id}">${esc(c.label)} (${nf.format(c.price)} STH)</option>`).join('');
$('gFrame').innerHTML = Object.entries(FRAMES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');

/** Liste des œuvres à offrir (les Mythiques déjà possédées sont grisées) : redessinée seulement si un propriétaire change. */
let giftWorksKey = '';
function fillGiftWorks(): void {
  const owners = new Map((data?.works ?? []).map((w) => [w.id, w.owner]));
  const key = JSON.stringify([...owners]);
  if (key === giftWorksKey) return;
  giftWorksKey = key;
  const sel = $<HTMLSelectElement>('gWork');
  const v = sel.value;
  sel.innerHTML = catalog.works
    .slice()
    .sort((a, b) => b.price - a.price)
    .map((w) => {
      const unique = !!(w as { unique?: boolean }).unique;
      const owner = owners.get(w.id);
      return `<option value="${w.id}" ${unique && owner ? 'disabled' : ''}>${esc(w.title)} — ${RAR[w.rarity]}${unique ? ' (unique)' : ''}${owner ? ` · à ${esc(owner)}` : ''}</option>`;
    })
    .join('');
  if (v) sel.value = v;
  renderGiftSummary();
}

function setGiftKind(k: GiftKind): void {
  giftKind = k;
  document.querySelectorAll<HTMLButtonElement>('#gKinds button').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
  $('gChestWrap').hidden = k !== 'chest';
  $('gWorkWrap').hidden = k !== 'artwork';
  $('gFrameWrap').hidden = k !== 'artwork';
  $('gAmountWrap').hidden = k === 'artwork';
  const amount = $<HTMLInputElement>('gAmount');
  amount.required = k !== 'artwork';
  amount.max = k === 'chest' ? '100' : '';
  amount.value = String(GIFT_DEFAULT[k]);
  renderGiftSummary();
}
$('gKinds').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-kind]');
  if (b) setGiftKind(b.dataset.kind as GiftKind);
});
['gTarget', 'gChest', 'gWork', 'gFrame', 'gAmount'].forEach((id) => $(id).addEventListener('input', renderGiftSummary));
['gTarget', 'gChest', 'gWork', 'gFrame'].forEach((id) => $(id).addEventListener('change', renderGiftSummary));

/** Ce qui est offert, en toutes lettres. */
function giftWhat(): string {
  const n = Math.floor(Number($<HTMLInputElement>('gAmount').value)) || 0;
  if (giftKind === 'coins') return `${nf.format(n)} pièces`;
  if (giftKind === 'sth') return `${nf.format(n)} STH coins`;
  if (giftKind === 'chest') return `${n} × ${CHESTS[$<HTMLSelectElement>('gChest').value]?.label ?? 'Lucky coffre'}`;
  const frame = $<HTMLSelectElement>('gFrame').value;
  return `« ${title($<HTMLSelectElement>('gWork').value)} »${frame !== 'normal' ? ` (${FRAME_DEFS[frame]?.label ?? frame})` : ''}`;
}

/** À qui : le nombre de joueurs concernés (null si inconnu) et leur description. */
function giftWho(): { count: number | null; label: string } {
  const t = $<HTMLSelectElement>('gTarget').value;
  const c = plist?.counts;
  if (t === 'selected') return { count: picked.size, label: picked.size === 1 ? `« ${[...picked.values()][0]} »` : `${picked.size} joueurs cochés` };
  if (t === 'registered') return { count: c?.registered ?? null, label: `tous les inscrits${c ? ` (${nf.format(c.registered)})` : ''}` };
  if (t === 'online') return { count: c?.online ?? null, label: `tous les joueurs en ligne${c ? ` (${nf.format(c.online)})` : ''}` };
  return { count: c?.all ?? null, label: `tous les joueurs${c ? ` (${nf.format(c.all)}, invités compris)` : ''}` };
}

function renderGiftSummary(): void {
  const who = giftWho();
  const selected = $<HTMLSelectElement>('gTarget').value === 'selected';
  $('gSummary').textContent = who.count === 0
    ? selected ? 'Cochez un ou plusieurs joueurs dans la liste (ou bouton 🎁 sur une ligne).' : 'Aucun joueur concerné pour l’instant.'
    : `→ ${giftWhat()} pour ${who.label}.`;
}

/** Bouton 🎁 d'une ligne ou de la fiche : ce joueur seul, et le formulaire du cadeau à l'écran. */
function giftTo(id: string, name: string): void {
  picked.clear();
  picked.set(id, name);
  $<HTMLSelectElement>('gTarget').value = 'selected';
  renderPlayers();
  $('giftCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  (giftKind === 'artwork' ? $('gWork') : $('gAmount')).focus({ preventScroll: true });
}

function giftSay(text: string, ok = true): void {
  $('gMsg').textContent = text;
  $('gMsg').style.color = ok ? '#7dff9a' : '#ff8fa0';
}

$('giftForm').onsubmit = async (e) => {
  e.preventDefault();
  const target = $<HTMLSelectElement>('gTarget').value;
  const who = giftWho();
  if (target === 'selected' && !picked.size) return giftSay('Cochez au moins un joueur dans la liste.', false);
  const what = giftWhat();
  if ((target !== 'selected' || picked.size > 1) && !confirm(`Offrir ${what} à ${who.label} ?`)) return;
  const body: Record<string, unknown> = { kind: giftKind, message: $<HTMLInputElement>('gMessage').value };
  if (target === 'selected') body.ids = [...picked.keys()];
  else body.target = target;
  if (giftKind !== 'artwork') body.amount = Math.floor(Number($<HTMLInputElement>('gAmount').value));
  if (giftKind === 'chest') body.chest = $<HTMLSelectElement>('gChest').value;
  if (giftKind === 'artwork') {
    body.workId = $<HTMLSelectElement>('gWork').value;
    body.frame = $<HTMLSelectElement>('gFrame').value;
  }
  try {
    const r = await call<{ count: number; live: number }>('POST', 'gifts', body);
    giftSay(`🎁 Cadeau envoyé à ${nf.format(r.count)} joueur${r.count > 1 ? 's' : ''} : ${what}${r.live ? ` (${r.live} en ligne, prévenu${r.live > 1 ? 's' : ''} à l’écran)` : ''}.`);
    $<HTMLInputElement>('gMessage').value = '';
    await loadPlayers();
    if (giftKind === 'artwork') await refresh(); // une Mythique offerte n'est plus disponible
  } catch (err) {
    giftSay((err as Error).message, false);
  }
};

// ---------------------------------------------------------------- fiche d'un joueur (et création d'un compte)

const dlg = $<HTMLDialogElement>('pDlg');
/** Joueur affiché dans la fiche ; null quand la fiche sert à créer un compte. */
let current: PlayerDetail | null = null;
const field = (id: string) => $<HTMLInputElement>(id);

$('fCountry').innerHTML = COUNTRIES.map((c) => `<option value="${c.code}">${c.flag} ${esc(c.name)}</option>`).join('');
$('fLevel').innerHTML = LEVELS.map((l) => `<option value="${l.level}">${l.level} · ${l.rooms} salle${l.rooms > 1 ? 's' : ''}, ${l.slots} emplacements</option>`).join('');

function dlgSay(text: string, ok = true): void {
  $('pDlgMsg').textContent = text;
  $('pDlgMsg').style.color = ok ? '#7dff9a' : '#ff8fa0';
}

function setEditMode(edit: boolean): void {
  for (const id of ['fLevelWrap', 'fMoneyRow', 'fGift', 'fLogout', 'fDangerZone', 'pDetail']) $(id).hidden = !edit;
  field('fEmail').required = !edit;
  $('fSave').textContent = edit ? 'Enregistrer' : 'Créer le compte';
}

function openCreate(): void {
  current = null;
  setEditMode(false);
  $('pDlgTitle').textContent = 'Créer un compte';
  $('pDlgMeta').textContent = 'Le joueur se connecte avec cet e-mail. Sans mot de passe, il le choisit lui-même avec « Mot de passe oublié ».';
  $('fPwLabel').textContent = 'Mot de passe (facultatif, 8 caractères au moins)';
  field('fName').value = '';
  field('fEmail').value = '';
  field('fPassword').value = '';
  $<HTMLSelectElement>('fCountry').value = COUNTRIES.some((c) => c.code === 'TG') ? 'TG' : 'FR';
  $('pDetail').innerHTML = '';
  dlgSay('');
  dlg.showModal();
  field('fName').focus();
}
$('newPlayer').onclick = openCreate;

async function openPlayer(id: string): Promise<void> {
  try {
    const r = await call<{ player: PlayerDetail }>('GET', `players/${encodeURIComponent(id)}`);
    dlgSay('');
    showPlayer(r.player);
    if (!dlg.open) dlg.showModal();
  } catch (e) {
    say((e as Error).message, false);
  }
}

function showPlayer(p: PlayerDetail): void {
  current = p;
  setEditMode(true);
  $('pDlgTitle').textContent = p.name;
  const kind = p.registered ? `${p.email ? 'Compte e-mail' : 'Compte Google'}${p.email && p.google ? ' + Google' : ''}${p.email && !p.password ? ' (sans mot de passe)' : ''}` : 'Invité (sans compte)';
  $('pDlgMeta').textContent = `${kind} · ${p.online ? '🟢 en ligne' : `vu ${ago(p.lastSeen)}`} · créé le ${dayText(p.createdAt)} · id ${p.id}`;
  $('fPwLabel').textContent = p.password
    ? 'Nouveau mot de passe (facultatif : remplace l’actuel et ferme ses sessions)'
    : 'Mot de passe (facultatif : il n’en a pas encore ; un e-mail est nécessaire)';
  field('fName').value = p.name;
  field('fEmail').value = p.email ?? '';
  field('fPassword').value = '';
  field('fCoins').value = String(p.coins);
  field('fSth').value = String(p.sth);
  $<HTMLSelectElement>('fCountry').value = p.country;
  $<HTMLSelectElement>('fLevel').value = String(p.level);
  $('fLogout').hidden = !p.registered;
  $('pDetail').innerHTML = detailHtml(p);
}

function detailHtml(p: PlayerDetail): string {
  const chests = Object.entries(p.chests).filter(([, n]) => n > 0).map(([id, n]) => `${n} × ${esc(CHESTS[id]?.label ?? id)}`).join(' · ') || 'aucun';
  const arts = p.artworks.slice().sort((a, b) => b.value - a.value);
  const fact = (k: string, v: string) => `<div><span>${k}</span> ${v}</div>`;
  return `
    <h3>Musée</h3>
    <div class="facts">
      ${fact('Valeur', nf.format(p.value))}
      ${fact('Revenu', `${nf.format(Math.round(p.income))} /s`)}
      ${fact('Caisse', nf.format(p.cash))}
      ${fact('Renaissances', String(p.rebirths))}
      ${fact('Coffres', chests)}
      ${fact('Serveur privé', p.privateUntil > Date.now() ? `jusqu’au ${day.format(p.privateUntil)}` : 'non')}
      ${fact('Appareils', String(p.devices))}
      ${fact('Code d’invitation', esc(p.inviteCode))}
      ${p.escrow ? fact('Bloqué en enchère', nf.format(p.escrow)) : ''}
    </div>
    <h3>Œuvres (${arts.length})</h3>
    ${arts.length
      ? `<div class="table-wrap"><table><thead><tr><th>Œuvre</th><th>Cadre</th><th class="num">Valeur</th><th>Où</th><th></th></tr></thead><tbody>${arts.map((a) => `
        <tr>
          <td>${esc(title(a.workId))}${a.repro ? ' <span class="muted">(reproduction)</span>' : ''}</td>
          <td>${a.frame === 'normal' ? '—' : esc(FRAME_DEFS[a.frame]?.label ?? a.frame)}</td>
          <td class="num">${nf.format(a.value)}</td>
          <td class="muted">${a.carried ? 'en cours de vol' : a.slot === null ? 'réserve' : 'exposée'}</td>
          <td><button type="button" class="ghost" data-remove="${esc(a.uid)}" ${a.carried ? 'disabled' : ''}>Retirer</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Aucune œuvre</p>'}
    ${p.purchases.length
      ? `<h3>Derniers achats de STH coins</h3><table><tbody>${p.purchases.map((o) => `<tr><td>${when.format(o.at)}</td><td class="num">${nf.format(o.sth)} STH</td><td class="muted">${priceText(o.amount, o.currency)} ${esc(o.provider ?? '')}</td></tr>`).join('')}</tbody></table>`
      : ''}`;
}

$('pDlgClose').onclick = () => dlg.close();

$('pForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = field('fName').value.trim();
  const email = field('fEmail').value.trim().toLowerCase();
  const password = field('fPassword').value;
  const country = $<HTMLSelectElement>('fCountry').value;
  if (!current) {
    try {
      const r = await call<{ player: PlayerDetail }>('POST', 'players', { name, email, password, country });
      showPlayer(r.player);
      dlgSay(`Compte « ${r.player.name} » créé.`);
      await loadPlayers();
    } catch (err) {
      dlgSay((err as Error).message, false);
    }
    return;
  }
  // seulement les champs modifiés : un solde gagné en jeu pendant que la fiche est ouverte n'est pas écrasé
  const p = current;
  const body: Record<string, unknown> = {};
  if (name !== p.name) body.name = name;
  if (email !== (p.email ?? '')) body.email = email;
  if (country !== p.country) body.country = country;
  if (Number($<HTMLSelectElement>('fLevel').value) !== p.level) body.level = Number($<HTMLSelectElement>('fLevel').value);
  if (field('fCoins').value !== String(p.coins)) body.coins = Number(field('fCoins').value);
  if (field('fSth').value !== String(p.sth)) body.sth = Number(field('fSth').value);
  if (password) body.password = password;
  if (!Object.keys(body).length) return dlgSay('Rien à enregistrer : aucun champ n’a changé.', false);
  try {
    const r = await call<{ player: PlayerDetail; loggedOut: boolean }>('PATCH', `players/${encodeURIComponent(p.id)}`, body);
    showPlayer(r.player);
    dlgSay(`Modifications enregistrées${r.loggedOut ? ' · ses sessions sont fermées' : ''}.`);
    await loadPlayers();
  } catch (err) {
    dlgSay((err as Error).message, false);
  }
};

$('fGift').onclick = () => {
  if (!current) return;
  dlg.close();
  giftTo(current.id, current.name);
};

$('fLogout').onclick = async () => {
  const p = current;
  if (!p || !confirm(`Fermer toutes les sessions de « ${p.name} » ?\n\nIl sera déconnecté sur tous ses appareils et devra se reconnecter avec son compte.`)) return;
  try {
    const r = await call<{ player: PlayerDetail }>('PATCH', `players/${encodeURIComponent(p.id)}`, { logout: true });
    showPlayer(r.player);
    dlgSay('Sessions fermées : il est déconnecté partout.');
  } catch (err) {
    dlgSay((err as Error).message, false);
  }
};

$('fDelete').onclick = async () => {
  const p = current;
  if (!p) return;
  if (!confirm(`Supprimer définitivement « ${p.name} » ?\n\nSon musée, ses ${p.artworks.length} œuvre(s), ${nf.format(p.coins)} pièces et ${nf.format(p.sth)} STH coins seront effacés. Impossible d’annuler.`)) return;
  try {
    await call('DELETE', `players/${encodeURIComponent(p.id)}`);
    picked.delete(p.id);
    dlg.close();
    say(`Joueur « ${p.name} » supprimé.`);
    await loadPlayers();
    await refresh();
  } catch (err) {
    dlgSay((err as Error).message, false);
  }
};

$('pDetail').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-remove]');
  const p = current;
  const art = p?.artworks.find((a) => a.uid === b?.dataset.remove);
  if (!p || !art || !confirm(`Retirer « ${title(art.workId)} » du musée de ${p.name} ?`)) return;
  try {
    const r = await call<{ player: PlayerDetail }>('DELETE', `players/${encodeURIComponent(p.id)}/artworks/${encodeURIComponent(art.uid)}`);
    showPlayer(r.player);
    dlgSay(`« ${title(art.workId)} » retirée.`);
    await loadPlayers();
  } catch (err) {
    dlgSay((err as Error).message, false);
  }
});

setGiftKind('coins');

// valeurs par défaut : dans 1 h 05, un lot
const d = new Date(Date.now() + 65 * 60_000);
d.setSeconds(0, 0);
$<HTMLInputElement>('at').value = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
addLot();
if (token) void refresh();
setInterval(() => token && !$('panel').hidden && void refresh(), 5000);
// liste des joueurs (en ligne, soldes) : relue toutes les 15 s, sauf pendant qu'une fiche est ouverte
setInterval(() => token && !$('panel').hidden && !dlg.open && !document.hidden && void loadPlayers(), 15000);
