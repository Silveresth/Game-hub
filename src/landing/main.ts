// Page d'accueil : barre live, joueurs en ligne, planning des ventes, cartels de la collection, installation PWA.
import { API_BASE, formatCountdown, mountLiveBar, parisTime, setupPwa, type LiveStats } from '../shared/live';
import { CATALOG, incomeOf, money, perSec, work, type FrameId } from '../game/catalog';

// Page hébergée à part (Vercel) : les boutons « Jouer » mènent au jeu sur son propre domaine (Render)
const GAME_URL = `${API_BASE}/game/`;
if (API_BASE) for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href="/game/"]')) a.href = GAME_URL;
setupPwa('/sw.js');
const live = mountLiveBar({ gameHref: GAME_URL });

const $ = (id: string) => document.getElementById(id);
const nf = new Intl.NumberFormat('fr-FR');

// ---------------------------------------------------------------- collection : valeur et revenu tirés du catalogue du jeu

for (const el of document.querySelectorAll<HTMLElement>('[data-work]')) {
  const w = work(el.dataset.work!);
  if (!w) continue;
  const r = CATALOG.rarities[w.rarity];
  const rarity = el.querySelector<HTMLElement>('.rarity');
  if (rarity) rarity.style.color = darkRarity(w.rarity);
  const line = document.createElement('span');
  line.textContent = `${money(w.price)} pièces, +${perSec(incomeOf(w.id, 'normal' as FrameId))} par seconde`;
  el.querySelector('.cartel')?.append(document.createElement('br'), line);
  el.title = `${w.title}, ${w.artist} (${r.label})`;
}
const intro = document.querySelector('#collection .intro');
if (intro) intro.textContent = intro.textContent!.replace(/^\d+/, String(CATALOG.works.length));

/** Couleurs de rareté assombries : lisibles sur le cartel ivoire. */
function darkRarity(id: string): string {
  return ({ commun: '#5b6270', rare: '#1f6fc4', epique: '#7a35c8', legendaire: '#a8650a', mythique: '#c0102f' } as Record<string, string>)[id] ?? '#2b1d12';
}

// ---------------------------------------------------------------- en direct : joueurs en ligne et ventes

let latest: LiveStats | null = null;
let offset = 0;

function renderSales(): void {
  const list = $('salesList');
  if (!latest || !list) return;
  const now = Date.now() + offset;
  const items = latest.sales.filter((s) => s.live || s.at > now - 1000).slice(0, 3);
  if (latest.nextMajor && !items.some((s) => s.id === latest!.nextMajor!.id)) items.push(latest.nextMajor);
  list.replaceChildren(
    ...items.map((s) => {
      const card = document.createElement('article');
      card.className = `sale${s.kind === 'express' ? '' : ' major'}${s.live ? ' live' : ''}`;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = s.label;
      const when = document.createElement('div');
      when.className = 'when';
      when.textContent = parisTime.format(s.at);
      const left = document.createElement('div');
      left.className = 'left';
      left.textContent = s.live ? 'En direct : entrez dans la salle !' : `Dans ${formatCountdown(s.at - now)}`;
      card.append(kind, when, left);
      return card;
    }),
  );
}

live.onStats((s) => {
  latest = s;
  offset = s.serverTime - Date.now();
  const online = $('onlineNow');
  if (online) online.textContent = s.online > 1 ? `${nf.format(s.online)} joueurs en ligne en ce moment.` : '';
  renderSales();
});
setInterval(renderSales, 1000);
