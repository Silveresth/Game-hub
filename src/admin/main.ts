// Panneau admin : planning des ventes, création d'une vente « admin abuse », annonce, annulation, derniers résultats.
// Toutes les actions passent par /api/admin/* avec le jeton admin (gardé seulement le temps de l'onglet).
import catalog from '../shared/catalog.json';

interface Work { id: string; title: string; rarity: string; price: number; unique: boolean; owner: string | null }
interface Sale { id: string; kind: string; label: string; at: number; live: boolean; admin: boolean; announced: boolean | null; lots: Array<{ workId: string; frame: string }> | null }
interface Overview {
  now: number;
  dev: boolean;
  stats: { players: number; online: number; districts: number };
  live: { sale: Sale; lot: { index: number; count: number; workId: string; price: number; phase: string } | null; hall: number } | null;
  upcoming: Sale[];
  results: Array<{ at: number; sale: string; workId: string; frame: string; price: number; winner: string; npc: boolean }>;
  works: Work[];
  push: Array<{ at: number; player: string; category: string; title: string; body: string }>;
  liveEvent: { kind: string; label: string; icon: string; endsAt: number; admin?: boolean } | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nf = new Intl.NumberFormat('fr-FR');
const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const title = (id: string) => catalog.works.find((w) => w.id === id)?.title ?? id;
const FRAMES: Record<string, string> = { normal: 'Cadre normal', dore: 'Cadre doré (×2)', diamant: 'Cadre diamant (×5)', arcenciel: 'Cadre arc-en-ciel (×10)' };
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
}

function render(): void {
  if (!data) return;
  $('sPlayers').textContent = nf.format(data.stats.players);
  $('sOnline').textContent = nf.format(data.stats.online);
  $('sDistricts').textContent = nf.format(data.stats.districts);
  $('sLive').textContent = data.live ? `${data.live.sale.label} · lot ${(data.live.lot?.index ?? 0) + 1}/${data.live.lot?.count ?? 0}` : 'aucune';
  const ev = data.liveEvent;
  $('liveState').textContent = ev
    ? `${ev.icon} ${ev.label} en cours (${ev.admin ? 'admin abuse' : 'événement du convoi'}), fin à ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(ev.endsAt)}.`
    : 'Aucun événement en cours.';
  $('atHint').textContent = data.dev ? 'Mode test : la vente peut être programmée tout de suite, et lancée avec « Lancer ».' : 'Au moins 1 h à l’avance, pour laisser le temps de prévenir les joueurs.';

  $('sales').innerHTML = data.upcoming.map((s) => {
    const lots = s.lots ? s.lots.map((l) => `${esc(title(l.workId))}${l.frame !== 'normal' ? ` (${FRAMES[l.frame].split(' ')[1]})` : ''}`).join(', ') : '<span class="muted">tirés au sort</span>';
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

// « admin abuse » en direct
document.querySelectorAll<HTMLButtonElement>('[data-live]').forEach((b) => {
  b.onclick = async () => {
    try {
      const r = await call<{ event: { label: string } }>('POST', 'live', { kind: b.dataset.live });
      say(`${r.event.label} lancé pour tous les joueurs en ligne.`);
      await refresh();
    } catch (err) {
      say((err as Error).message, false);
    }
  };
});
$('liveStop').onclick = async () => {
  try {
    await call('DELETE', 'live');
    say('Événement arrêté.');
    await refresh();
  } catch (err) {
    say((err as Error).message, false);
  }
};

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

// valeurs par défaut : dans 1 h 05, un lot
const d = new Date(Date.now() + 65 * 60_000);
d.setSeconds(0, 0);
$<HTMLInputElement>('at').value = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
addLot();
if (token) void refresh();
setInterval(() => token && !$('panel').hidden && void refresh(), 5000);
