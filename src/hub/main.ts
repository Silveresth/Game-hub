// Landing page : barre live, planning des ventes, musées des joueurs, installation PWA.
import { genThumb } from '../museum/art';
import { formatCountdown, mountLiveBar, parisTime, setupPwa, type LiveStats } from '../shared/live';

interface Summary {
  id: string;
  name: string;
  author: string;
  rooms: number;
  artifacts: number;
  likes: number;
  views: number;
  hasThumb: boolean;
}

setupPwa('./sw.js');
const live = mountLiveBar({ gameHref: './game/' });

// ---------------------------------------------------------------- planning des ventes

const salesList = document.getElementById('salesList')!;
let latest: LiveStats | null = null;
let offset = 0;

function renderSales(): void {
  if (!latest) return;
  const now = Date.now() + offset;
  // les 3 prochaines ventes, plus toujours la prochaine grande vente (ou vente prestige)
  const items = latest.sales.filter((x) => x.live || x.at > now - 1000).slice(0, 3);
  if (latest.nextMajor && !items.some((s) => s.id === latest!.nextMajor!.id)) items.push(latest.nextMajor);
  salesList.innerHTML = '';
  for (const s of items) {
    const card = document.createElement('article');
    card.className = `sale${s.kind === 'express' ? '' : ' major'}`;
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = s.label;
    const when = document.createElement('b');
    when.textContent = parisTime.format(s.at);
    const left = document.createElement('span');
    left.textContent = s.live ? '🔴 en direct : rejoignez la salle !' : `dans ${formatCountdown(s.at - now)}`;
    card.append(k, when, left);
    salesList.appendChild(card);
  }
}

live.onStats((s) => {
  latest = s;
  offset = s.serverTime - Date.now();
  renderSales();
});
setInterval(renderSales, 1000);

// ---------------------------------------------------------------- musées des joueurs

async function loadCommunity(): Promise<void> {
  let list: Summary[];
  try {
    const res = await fetch('/api/museums?sort=popular&limit=6');
    if (!res.ok) return;
    list = (await res.json()) as Summary[];
  } catch {
    return;
  }
  if (!list.length) return;
  const grid = document.getElementById('communityList')!;
  for (const m of list) {
    const a = document.createElement('a');
    a.className = 'mini';
    a.href = `./museum/?m=${encodeURIComponent(m.id)}`;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const fallback = `url("${genThumb(m.id)}")`;
    thumb.style.backgroundImage = m.hasThumb ? `url("/api/museums/${encodeURIComponent(m.id)}/thumb"), ${fallback}` : fallback;
    const b = document.createElement('div');
    b.className = 'b';
    const h3 = document.createElement('h3');
    h3.textContent = m.name;
    const p = document.createElement('p');
    p.textContent = `par ${m.author || 'anonyme'} · ${m.rooms} salle(s) · ♥ ${m.likes}`;
    b.append(h3, p);
    a.append(thumb, b);
    grid.appendChild(a);
  }
  document.getElementById('musees')!.hidden = false;
}

void loadCommunity();
