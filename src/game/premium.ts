// Monnaie premium (STH coins), Lucky coffres et paiement en argent réel : rendu de la boutique, animation d'ouverture.
// Le serveur décide de tout (prix, tirage, crédit des paiements) ; ce module ne fait qu'afficher et demander.
import * as api from './api';
import type { ChestId, PayMethod, PayOrder, PayPack, PlayerState } from './api';
import { CATALOG, artUrl, incomeOf, money, perSec, work, type FrameId, type RarityId } from './catalog';
import type { Sfx } from './sfx';

export interface PremiumCtx {
  state: () => PlayerState | null;
  apply: (s: PlayerState) => void;
  guarded: <T>(fn: () => Promise<T>) => Promise<T | null>;
  toast: (m: string) => void;
  banner: (t: string, sub?: string) => void;
  sfx: Sfx;
  celebrate: (n: number) => void;
  /** Ouvre l'inventaire (onglet coffres). */
  openInventory: (tab?: string) => void;
  /** Rafraîchit l'état depuis le serveur. */
  refresh: () => Promise<void>;
  inNativeApp: boolean;
}

export const CHEST_IDS = Object.keys(CATALOG.chests) as ChestId[];
export const RARITY_IDS: RarityId[] = ['commun', 'rare', 'epique', 'legendaire', 'mythique'];
const nf = new Intl.NumberFormat('fr-FR');
const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')} %`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------- dessins

let svgSeq = 0;
/** Apparence de chaque coffre : corps, ferrures, pierre de la serrure. */
const CHEST_LOOK: Record<ChestId, { body: string; metal: string; gem: string; planks: boolean; crown?: boolean; stars: number }> = {
  simple: { body: '#b8733a', metal: '#868c99', gem: '#ff5e62', planks: true, stars: 0 },
  rare: { body: '#3d8bff', metal: '#e6eef8', gem: '#7fe3ff', planks: false, stars: 2 },
  epique: { body: '#9b5cff', metal: '#ffd36b', gem: '#ff6fd8', planks: false, stars: 3 },
  legendaire: { body: '#ffae1f', metal: '#fff1b8', gem: '#ff2d4d', planks: false, crown: true, stars: 4 },
};

/** Coffre en SVG (le couvercle est un groupe à part, animé à l'ouverture), avec reflet qui passe et étincelles. */
export function chestSvg(id: ChestId, cls = ''): string {
  const L = CHEST_LOOK[id];
  const dark = shade(L.body, -0.55);
  const metalDark = shade(L.metal, -0.45);
  // identifiants uniques : un dégradé référencé dans un élément masqué (display:none) n'est pas dessiné par le navigateur
  const u = `${id}-${++svgSeq}`;
  const planks = L.planks
    ? [96, 114, 132].map((y) => `<path d="M24 ${y} H176" stroke="${dark}" stroke-width="2.5" opacity=".55"/>`).join('') +
      '<path d="M30 50 Q100 38 170 50" stroke="#6b3d1a" stroke-width="2.5" fill="none" opacity=".5"/><path d="M24 66 Q100 56 176 66" stroke="#6b3d1a" stroke-width="2.5" fill="none" opacity=".5"/>'
    : `<path d="M30 100 Q100 92 170 100" stroke="${shade(L.body, 0.35)}" stroke-width="3" fill="none" opacity=".45"/>`;
  const corner = (x: number, y: number, sx: number, sy: number) =>
    `<path d="M${x} ${y} h${sx * 22} l${-sx * 8} ${sy * 8} h${-sx * 6} v${sy * 6} l${-sx * 8} ${sy * 8} Z" fill="${L.metal}" stroke="${metalDark}" stroke-width="2"/>`;
  const rivets = [[46, 92], [46, 140], [154, 92], [154, 140], [46, 60], [154, 60]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${shade(L.metal, 0.3)}" stroke="${metalDark}" stroke-width="1.2"/>`).join('');
  const star = (x: number, y: number, r: number) => `<path class="twinkle" d="M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z" fill="#fff"/>`;
  const stars = [[22, 30, 9], [182, 46, 7], [170, 8, 6], [8, 100, 6]].slice(0, L.stars).map(([x, y, r]) => star(x, y, r)).join('');
  const crown = L.crown
    ? `<path d="M72 30 L76 8 L89 22 L100 2 L111 22 L124 8 L128 30 Z" fill="#ffe27a" stroke="#b07a12" stroke-width="2.5" stroke-linejoin="round"/>
       <circle cx="100" cy="18" r="4" fill="${L.gem}"/><circle cx="80" cy="22" r="3" fill="#7fe3ff"/><circle cx="120" cy="22" r="3" fill="#7fe3ff"/>`
    : '';
  return `<svg class="chest-svg ${cls}" viewBox="0 -6 200 176" aria-hidden="true">
    <defs>
      <linearGradient id="cb-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.body}"/><stop offset="1" stop-color="${shade(L.body, -0.4)}"/></linearGradient>
      <linearGradient id="cl-${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(L.body, 0.35)}"/><stop offset="1" stop-color="${L.body}"/></linearGradient>
      <linearGradient id="cm-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(L.metal, 0.4)}"/><stop offset="1" stop-color="${L.metal}"/></linearGradient>
      <clipPath id="cc-${u}"><path d="M18 82 Q18 24 100 24 Q182 24 182 82 V150 Q182 156 176 156 H24 Q18 156 18 150 Z"/></clipPath>
    </defs>
    <ellipse cx="100" cy="160" rx="78" ry="8" fill="#000" opacity=".25"/>
    <ellipse class="glow" cx="100" cy="80" rx="70" ry="16" fill="#fff" opacity="0"/>
    <g class="body">
      <rect x="18" y="78" width="164" height="78" rx="9" fill="url(#cb-${u})" stroke="${dark}" stroke-width="3"/>
      ${planks}
      <rect x="38" y="78" width="16" height="78" fill="url(#cm-${u})" stroke="${metalDark}" stroke-width="1.5"/><rect x="146" y="78" width="16" height="78" fill="url(#cm-${u})" stroke="${metalDark}" stroke-width="1.5"/>
      ${corner(18, 156, 1, -1)}${corner(182, 156, -1, -1)}
      ${rivets}
    </g>
    <g class="lid">
      <path d="M18 82 Q18 24 100 24 Q182 24 182 82 Z" fill="url(#cl-${u})" stroke="${dark}" stroke-width="3"/>
      ${L.planks ? '' : `<path d="M30 70 Q34 38 70 30" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".35"/>`}
      <path d="M38 82 Q38 36 54 29 L54 82 Z" fill="url(#cm-${u})" stroke="${metalDark}" stroke-width="1.5"/><path d="M146 29 Q162 36 162 82 L146 82 Z" fill="url(#cm-${u})" stroke="${metalDark}" stroke-width="1.5"/>
      <rect x="18" y="76" width="164" height="9" rx="3" fill="url(#cm-${u})" stroke="${metalDark}" stroke-width="1.5"/>
      ${crown}
      <path d="M82 62 h36 v26 q0 14 -18 18 q-18 -4 -18 -18 Z" fill="url(#cm-${u})" stroke="${metalDark}" stroke-width="2"/>
      <path d="M100 66 l9 9 l-9 9 l-9 -9 Z" fill="${L.gem}" stroke="#fff" stroke-width="2"/>
      <path d="M97 88 h6 v8 h-6 Z" fill="${metalDark}" rx="2"/>
    </g>
    <g clip-path="url(#cc-${u})" pointer-events="none"><g class="shine"><rect x="0" y="0" width="34" height="170" fill="#fff" opacity=".28" transform="skewX(-18)"/></g></g>
    ${stars}
  </svg>`;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Barre des probabilités (une couleur par rareté). */
function oddsBar(id: ChestId): string {
  const odds = CATALOG.chests[id].odds;
  return `<div class="odds-bar">${RARITY_IDS.filter((r) => (odds[r] ?? 0) > 0).map((r) => `<i style="flex:${Math.max(odds[r]!, 1.5)};background:${CATALOG.rarities[r].color}" title="${CATALOG.rarities[r].label} ${pct(odds[r]!)}"></i>`).join('')}</div>`;
}

/** Tableau complet des probabilités d'un coffre : raretés, œuvres possibles, cadres, garantie. */
export function oddsHtml(id: ChestId, s: PlayerState | null): string {
  const c = CATALOG.chests[id];
  let html = '<div class="odds">';
  for (const r of RARITY_IDS) {
    const p = c.odds[r] ?? 0;
    if (!p) continue;
    const pool = r === 'mythique' ? CATALOG.works.filter((w) => w.unique) : CATALOG.works.filter((w) => w.rarity === r && !w.unique);
    const free = s?.freeMythics ?? [];
    const names = pool.map((w) => (r === 'mythique' && !free.includes(w.id) ? `<s>${esc(w.title)}</s>` : esc(w.title))).join(' · ');
    const each = r === 'mythique' ? '' : ` · ${pct(p / pool.length)} chacune`;
    html += `<div class="odd"><b style="color:${CATALOG.rarities[r].color}">${CATALOG.rarities[r].label}</b><span class="p">${pct(p)}</span>
      <small>${pool.length} œuvre${pool.length > 1 ? 's' : ''}${each}${r === 'mythique' ? ' · seulement si elle est encore libre (unique sur le serveur), sinon une Légendaire' : ''}<br/>${names}</small></div>`;
  }
  const fr = c.frames;
  html += `<div class="odd frames"><b>Cadres spéciaux</b><small>${(['dore', 'diamant', 'arcenciel'] as FrameId[]).filter((f) => fr[f]).map((f) => `${CATALOG.frames[f].icon} ${CATALOG.frames[f].label} (valeur ×${CATALOG.frames[f].mult}) : <b>${pct(fr[f]!)}</b>`).join(' · ')} · les Mythiques gardent leur cadre d’origine</small></div>`;
  const season = s?.season ? CATALOG.seasons[s.season.id] : null;
  if (season?.mutation) {
    const m = CATALOG.frames[season.mutation];
    html += `<div class="odd frames"><b>${m.icon} Mutation de saison (${season.label})</b><small>${m.label} (valeur ×${m.mult}) : <b>${pct(CATALOG.seasonRules.chestMutationChance * 100)}</b> sur une œuvre sans cadre spécial, pendant la saison seulement</small></div>`;
  }
  if (c.pity) {
    const left = s?.pity?.[id] ? c.pity.every - s.pity[id]!.count : c.pity.every;
    html += `<div class="odd pity">🎯 <span>Garantie : une ${CATALOG.rarities[c.pity.rarity].label} (ou mieux) au plus tard au ${c.pity.every}<sup>e</sup> coffre.${s ? ` Encore <b>${left}</b> coffre${left > 1 ? 's' : ''} au maximum.` : ''}</span></div>`;
  }
  html += '<p class="legal">Tirage aléatoire fait par le serveur avec un générateur cryptographique. Les probabilités affichées sont exactement celles utilisées.</p></div>';
  return html;
}

// ---------------------------------------------------------------- prix

type Cur = 'XOF' | 'EUR' | 'USD';
const fmtCur = (n: number, cur: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'XOF' ? 0 : 2 }).format(n);
const packPrice = (p: PayPack, cur: Cur) => (cur === 'XOF' ? p.xof : cur === 'EUR' ? p.eur : p.usd);

function defaultCurrency(country: string | undefined): Cur {
  try {
    const saved = localStorage.getItem('sam-cur') as Cur | null;
    if (saved === 'XOF' || saved === 'EUR' || saved === 'USD') return saved;
  } catch {
    /* stockage indisponible */
  }
  const c = country ?? '';
  if (CATALOG.premium.xofCountries.includes(c)) return 'XOF';
  if (CATALOG.premium.eurCountries.includes(c)) return 'EUR';
  return 'USD';
}

// ---------------------------------------------------------------- boutique : Lucky coffres et STH coins

export class Premium {
  private cur: Cur = 'XOF';
  private curSet = false;
  private openOdds = new Set<ChestId>();
  private cfg: { methods: PayMethod[]; packs: PayPack[]; test: boolean } | null = null;
  private checkout: { pack: PayPack; order?: PayOrder; url?: string | null; push?: boolean; test?: boolean; error?: string; method?: PayMethod } | null = null;
  private poll: number | undefined;
  private pollUntil = 0;
  readonly opener: ChestOpener;

  constructor(private ctx: PremiumCtx, private chestsEl: HTMLElement, private sthEl: HTMLElement) {
    this.opener = new ChestOpener(ctx);
    chestsEl.addEventListener('click', (e) => this.onChestsClick(e));
    sthEl.addEventListener('click', (e) => this.onSthClick(e));
    sthEl.addEventListener('input', (e) => {
      if ((e.target as HTMLElement).id === 'exAmount') this.renderExchangeCost();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.pendingId()) void this.checkOrder();
    });
  }

  private currency(): Cur {
    if (!this.curSet) {
      this.cur = defaultCurrency(this.ctx.state()?.country);
      this.curSet = true;
    }
    return this.cur;
  }

  // ------------------------------------------------------------ onglet coffres

  renderChests(): void {
    const s = this.ctx.state();
    if (!s) return;
    let html = `<p class="pane-intro">Achetez des coffres avec vos 💎 STH coins : ils se rangent dans votre <b>inventaire 🎒</b> et s’ouvrent quand vous voulez. Chaque coffre contient une œuvre d’art.</p>`;
    // saison en cours : chance de mutation saisonnière dans les coffres
    const season = CATALOG.seasons[s.season?.id ?? 'classique'];
    const mut = season?.mutation ? CATALOG.frames[season.mutation] : null;
    if (mut) html += `<div class="mut-note"><span style="font-size:24px">${mut.icon}</span><span><b>${season.icon} ${season.label}</b> : chaque coffre a ${pct(CATALOG.seasonRules.chestMutationChance * 100)} de chance de donner une œuvre <b style="color:${mut.color}">${mut.short} (valeur ×${mut.mult})</b>. Seulement pendant la saison !</span></div>`;
    html += '<div class="chest-grid">';
    for (const id of CHEST_IDS) {
      const c = CATALOG.chests[id];
      const bulk = CATALOG.chestBulk;
      const bulkCost = Math.round(c.price * bulk.qty * (1 - bulk.discount));
      const owned = s.chests[id] ?? 0;
      const poor1 = s.sth < c.price;
      const poorN = s.sth < bulkCost;
      html += `<article class="chest-card" style="--cc:${c.color}">
        <span class="tier">${c.short}</span>
        <div class="chest-pic"><span class="rays"></span>${chestSvg(id, 'idle')}${owned ? `<span class="own">×${owned}</span>` : ''}</div>
        <h3>${c.label}</h3>
        <p class="d">${c.desc}</p>
        ${oddsBar(id)}
        <div class="buy-row">
          <button data-buy="${id}" data-qty="1" class="${poor1 ? 'poor' : ''}"><i class="gem"></i>${nf.format(c.price)}</button>
          <button data-buy="${id}" data-qty="${bulk.qty}" class="alt ${poorN ? 'poor' : ''}">×${bulk.qty} · <i class="gem"></i>${nf.format(bulkCost)}</button>
        </div>
        <div class="card-foot">
          <button class="linkbtn" data-odds="${id}">${this.openOdds.has(id) ? 'Masquer' : 'Voir'} les probabilités</button>
          ${owned ? `<button class="linkbtn strong" data-open="${id}">Ouvrir (${owned})</button>` : ''}
        </div>
        ${this.openOdds.has(id) ? oddsHtml(id, s) : ''}
      </article>`;
    }
    html += '</div>';
    this.chestsEl.innerHTML = html;
  }

  private onChestsClick(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.odds) {
      const id = b.dataset.odds as ChestId;
      if (this.openOdds.has(id)) this.openOdds.delete(id);
      else this.openOdds.add(id);
      this.renderChests();
    } else if (b.dataset.open) {
      void this.openChest(b.dataset.open as ChestId);
    } else if (b.dataset.buy) {
      const id = b.dataset.buy as ChestId;
      const qty = Number(b.dataset.qty);
      const s = this.ctx.state();
      if (!s) return;
      const c = CATALOG.chests[id];
      const cost = Math.round(c.price * qty * (qty >= CATALOG.chestBulk.qty ? 1 - CATALOG.chestBulk.discount : 1));
      if (s.sth < cost) {
        this.ctx.sfx.error();
        this.ctx.toast(`Il vous manque ${nf.format(cost - s.sth)} STH coins : rechargez dans l’onglet 💎`);
        this.onNeedSth?.();
        return;
      }
      void (async () => {
        const r = await this.ctx.guarded(() => api.buyChest(id, qty));
        if (!r) return;
        this.ctx.apply(r.state);
        this.ctx.sfx.buy();
        this.ctx.toast(`${qty > 1 ? `${qty} coffres ajoutés` : `${c.label} ajouté`} à votre inventaire 🎒 (−${nf.format(r.cost)} STH)`);
        this.renderChests();
      })();
    }
  }

  /** L'onglet STH doit s'afficher (STH insuffisants). */
  onNeedSth: (() => void) | null = null;

  /** Ouvre un coffre de l'inventaire, avec l'animation. */
  async openChest(id: ChestId): Promise<void> {
    if (this.opener.busy) return;
    const r = await this.ctx.guarded(() => api.openChest(id));
    if (!r) return;
    this.opener.play(r, () => {
      this.ctx.apply(r.state);
    });
  }

  // ------------------------------------------------------------ onglet STH coins

  async loadConfig(): Promise<void> {
    try {
      this.cfg = await api.payConfig();
    } catch {
      this.cfg = { methods: [], packs: CATALOG.premium.packs, test: false };
    }
  }

  renderSth(): void {
    const s = this.ctx.state();
    if (!s) return;
    if (!this.cfg) {
      this.sthEl.innerHTML = '<p class="pane-intro">Chargement des offres…</p>';
      void this.loadConfig().then(() => this.renderSth());
      return;
    }
    if (this.checkout) return this.renderCheckout();
    const cur = this.currency();
    const rate = CATALOG.premium.coinsPerSth;
    let html = `<div class="cur-row"><span>Monnaie :</span>${(['XOF', 'EUR', 'USD'] as Cur[]).map((c) => `<button data-cur="${c}" class="${c === cur ? 'on' : ''}">${c === 'XOF' ? 'FCFA' : c === 'EUR' ? '€ Euro' : '$ Dollar'}</button>`).join('')}</div>`;
    html += '<div class="pack-grid">';
    for (const p of this.cfg.packs) {
      html += `<button class="pack" data-pack="${p.id}">
        ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
        <span class="gems">${'💎'.repeat(Math.min(5, 1 + Math.floor(Math.log10(p.sth))))}</span>
        <b>${nf.format(p.sth + p.bonus)} STH</b>
        ${p.bonus ? `<small>dont ${nf.format(p.bonus)} offerts</small>` : '<small>&nbsp;</small>'}
        <span class="price">${fmtCur(packPrice(p, cur), cur)}</span>
      </button>`;
    }
    html += '</div>';
    if (!this.cfg.methods.length) html += '<p class="faille">Le paiement en ligne n’est pas encore activé sur ce serveur. En attendant, échangez vos pièces ci-dessous.</p>';
    else html += `<p class="pay-logos">Paiement : ${this.cfg.methods.map((m) => `<span>${m.icon} ${m.label}</span>`).join('')}</p>`;
    // échange plafonné chaque mois (montant et nombre d'échanges) : les STH coins s'achètent surtout
    const ex = s.exchange;
    const max = this.exchangeMax();
    const resets = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(ex.resetsAt);
    const locked = ex.left < ex.min || ex.count >= ex.maxCount;
    html += `<div class="exchange ${locked ? 'locked' : ''}">
      <h3>Échanger mes pièces <small style="font:700 12px 'Segoe UI'">(limité chaque mois)</small></h3>
      <p class="d">Taux : <b>1 STH = ${money(rate)} pièces</b> (100 STH = ${money(rate * 100)} pièces).</p>
      <div class="ex-gauge" title="${ex.used} / ${ex.cap} STH échangés ce mois-ci"><i style="width:${Math.min(100, (ex.used / ex.cap) * 100)}%"></i></div>
      <div class="ex-meta"><span>Ce mois-ci : <b>${nf.format(ex.used)} / ${nf.format(ex.cap)} STH</b></span><span>Échanges : <b>${ex.count} / ${ex.maxCount}</b></span><span>Remise à zéro le <b>${resets}</b></span></div>
      ${locked
        ? `<div class="ex-cta">🔒 <b>Limite du mois atteinte.</b> Prochain échange le ${resets}. Pour ouvrir des coffres dès maintenant, choisissez un pack de STH coins ci-dessus 💎</div>`
        : `<div class="ex-row"><input id="exAmount" type="number" inputmode="numeric" min="${ex.min}" max="${max}" step="5" value="${Math.max(ex.min, Math.min(ex.left, max - (max % 5)))}" />
        <button data-ex="1">Échanger</button></div>
      <div class="ex-quick">${[5, 25, 50].filter((n) => n <= ex.left).map((n) => `<button data-exq="${n}">${nf.format(n)}</button>`).join('')}<button data-exq="max">Max</button></div>
      <p class="d" id="exCost"></p>`}
    </div>
    <p class="legal">Les STH coins sont une monnaie virtuelle, utilisable seulement dans Steal a Masterpiece, sans valeur en dehors du jeu ; ils ne sont ni remboursables ni échangeables contre de l’argent. Les probabilités de chaque coffre sont affichées avant l’achat.</p>`;
    this.sthEl.innerHTML = html;
    this.renderExchangeCost();
  }

  /** Le plus grand échange possible maintenant : plafond du mois, plafond par échange et pièces disponibles. */
  private exchangeMax(): number {
    const s = this.ctx.state();
    if (!s) return 0;
    return Math.max(0, Math.min(CATALOG.premium.maxExchange, s.exchange.left, Math.floor(s.coins / CATALOG.premium.coinsPerSth)));
  }

  private renderExchangeCost(): void {
    const s = this.ctx.state();
    const input = this.sthEl.querySelector<HTMLInputElement>('#exAmount');
    const out = this.sthEl.querySelector<HTMLElement>('#exCost');
    if (!s || !input || !out) return;
    const n = Math.floor(Number(input.value) || 0);
    const cost = n * CATALOG.premium.coinsPerSth;
    out.textContent = n ? `${nf.format(n)} STH = ${money(cost)} pièces${cost > s.coins ? ` · il vous manque ${money(cost - s.coins)}` : ''}` : '';
    out.classList.toggle('bad', cost > s.coins);
  }

  private onSthClick(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button, a');
    if (!b) return;
    const s = this.ctx.state();
    if (b.dataset.cur) {
      this.cur = b.dataset.cur as Cur;
      try {
        localStorage.setItem('sam-cur', this.cur);
      } catch {
        /* stockage indisponible */
      }
      this.renderSth();
    } else if (b.dataset.exq && s) {
      const input = this.sthEl.querySelector<HTMLInputElement>('#exAmount')!;
      // « Max » : ce que permettent le plafond du mois et les pièces (au moins le minimum, pour voir le prix)
      const max = this.exchangeMax();
      input.value = String(b.dataset.exq === 'max' ? Math.max(s.exchange.min, max) : b.dataset.exq);
      this.renderExchangeCost();
    } else if (b.dataset.ex) {
      const n = Math.floor(Number(this.sthEl.querySelector<HTMLInputElement>('#exAmount')?.value) || 0);
      void (async () => {
        const r = await this.ctx.guarded(() => api.exchangeSth(n));
        if (!r) return;
        this.ctx.apply(r.state);
        this.ctx.sfx.rare();
        this.ctx.banner(`+${nf.format(r.sth)} STH coins 💎`, `−${money(r.cost)} pièces`);
        this.renderSth();
      })();
    } else if (b.dataset.pack && this.cfg) {
      const pack = this.cfg.packs.find((p) => p.id === b.dataset.pack)!;
      this.checkout = { pack };
      this.renderCheckout();
    } else if (b.dataset.back !== undefined) {
      this.checkout = null;
      this.renderSth();
    } else if (b.dataset.method && this.checkout && this.cfg) {
      this.checkout.method = this.cfg.methods.find((m) => m.id === b.dataset.method);
      this.checkout.error = undefined;
      this.renderCheckout();
    } else if (b.dataset.pay !== undefined) {
      void this.startPayment();
    } else if (b.dataset.testpay !== undefined && this.checkout?.order) {
      void (async () => {
        const r = await this.ctx.guarded(() => api.payTestComplete(this.checkout!.order!.id));
        if (r) this.onOrder(r.order);
      })();
    } else if (b.dataset.check !== undefined) {
      void this.checkOrder(true);
    }
  }

  /** Prix d'une offre avec ce moyen de paiement (mobile money et cartes en FCFA, PayPal en euros ou dollars). */
  private methodPrice(m: PayMethod, pack: PayPack): { amount: number; cur: Cur } {
    const want = this.currency();
    const cur = (m.currencies.includes(want) ? want : m.currencies[0]) as Cur;
    return { amount: packPrice(pack, cur), cur };
  }

  private renderCheckout(): void {
    const co = this.checkout!;
    const methods = this.cfg?.methods ?? [];
    const p = co.pack;
    let html = `<button class="linkbtn back" data-back>← Toutes les offres</button>
      <div class="co-head"><span class="gems">💎</span><div><b>${nf.format(p.sth + p.bonus)} STH coins</b>${p.bonus ? `<small>dont ${nf.format(p.bonus)} offerts</small>` : ''}</div></div>`;
    if (co.order) {
      const o = co.order;
      const price = fmtCur(o.amount, o.currency);
      if (o.status === 'paid') html += `<div class="co-state ok">✅ Paiement reçu : <b>+${nf.format(o.sth)} STH</b> ajoutés à votre compte.</div><button class="go" data-back>Continuer</button>`;
      else if (o.status === 'pending') {
        html += `<div class="co-state wait"><span class="spin"></span><div>`;
        if (co.test) html += `<b>Mode test</b> : aucun vrai paiement. Simulez la réussite du paiement de ${price}.</div></div><button class="go" data-testpay>Simuler le paiement réussi</button>`;
        else if (co.push) html += `<b>Validez sur votre téléphone</b> : une demande de paiement de ${price} vient d’être envoyée. Composez votre code secret pour confirmer. Cette page se met à jour toute seule.</div></div>`;
        else html += `<b>Terminez le paiement</b> (${price}) dans la page qui s’est ouverte, puis revenez ici : vos STH arrivent dès que le paiement est confirmé.</div></div>
          ${co.url ? `<a class="go" href="${esc(co.url)}" target="_blank" rel="noopener">Rouvrir la page de paiement</a>` : ''}`;
        if (!co.test) html += `<button class="linkbtn" data-check>J’ai payé : vérifier maintenant</button>`;
        if (o.hint) html += `<p class="faille">${esc(o.hint)}</p>`;
        html += `<p class="legal">Commande ${o.id.slice(4, 14)} · vous pouvez fermer cette fenêtre, le paiement sera crédité automatiquement.</p>`;
      } else html += `<div class="co-state bad">${o.status === 'expired' ? '⌛ Paiement expiré.' : o.status === 'error' ? `⚠ ${esc(o.hint ?? 'Problème avec ce paiement.')}` : '✖ Paiement refusé ou annulé.'}</div><button class="go" data-back>Réessayer</button>`;
      this.sthEl.innerHTML = html;
      return;
    }
    if (!methods.length) {
      html += '<p class="faille">Le paiement en ligne n’est pas encore activé sur ce serveur.</p>';
      this.sthEl.innerHTML = html;
      return;
    }
    html += '<div class="lbl">Moyen de paiement</div><div class="methods">';
    for (const m of methods) {
      const { amount, cur } = this.methodPrice(m, p);
      html += `<button data-method="${m.id}" class="${co.method?.id === m.id ? 'on' : ''}"><span class="mi">${m.icon}</span><span>${m.label}</span><b>${fmtCur(amount, cur)}</b></button>`;
    }
    html += '</div>';
    if (co.method?.needsPhone) {
      html += `<label class="field">Numéro ${esc(co.method.label)} (8 chiffres)<input id="payPhone" type="tel" inputmode="tel" maxlength="16" placeholder="90 12 34 56" autocomplete="tel" /></label>`;
    }
    if (co.error) html += `<p class="auth-msg err">${esc(co.error)}</p>`;
    if (co.method) {
      const { amount, cur } = this.methodPrice(co.method, p);
      html += `<button class="go" data-pay>Payer ${fmtCur(amount, cur)}</button>`;
    }
    html += '<p class="legal">Paiement sécurisé chez le prestataire. Nous ne voyons jamais votre code secret ni votre numéro de carte.</p>';
    this.sthEl.innerHTML = html;
  }

  private async startPayment(): Promise<void> {
    const co = this.checkout;
    if (!co?.method) return;
    const m = co.method;
    const { cur } = this.methodPrice(m, co.pack);
    const phone = this.sthEl.querySelector<HTMLInputElement>('#payPhone')?.value;
    // page de paiement : fenêtre ouverte tout de suite (sinon le navigateur la bloque après l'appel au serveur)
    const win = !this.ctx.inNativeApp && !m.needsPhone && !(this.cfg?.test) ? window.open('', '_blank') : null;
    try {
      const r = await api.payCreate(co.pack.id, m.id, cur, phone);
      co.order = r.order;
      co.url = r.url;
      co.push = r.push;
      co.test = r.test;
      this.remember(r.order.id);
      if (r.url) {
        if (win) win.location.href = r.url;
        else if (this.ctx.inNativeApp) location.href = r.url; // l'application l'ouvre dans le navigateur du téléphone
        else window.open(r.url, '_blank');
      } else win?.close();
      this.startPolling();
      this.renderCheckout();
    } catch (e) {
      win?.close();
      this.ctx.sfx.error();
      co.error = (e as Error).message;
      this.renderCheckout();
    }
  }

  // ------------------------------------------------------------ suivi d'une commande (même après rechargement)

  private pendingId(): string | null {
    try {
      return localStorage.getItem('sam-pay-pending');
    } catch {
      return null;
    }
  }

  private remember(id: string | null): void {
    try {
      if (id) localStorage.setItem('sam-pay-pending', id);
      else localStorage.removeItem('sam-pay-pending');
    } catch {
      /* stockage indisponible */
    }
  }

  /** Au lancement : commande en cours (retour de la page de paiement : /game/?pay=…). */
  resume(fromUrl: string | null): void {
    const id = fromUrl ?? this.pendingId();
    if (!id) return;
    this.remember(id);
    this.startPolling();
    void this.checkOrder();
  }

  private startPolling(): void {
    clearInterval(this.poll);
    this.pollUntil = Date.now() + 20 * 60_000;
    this.poll = window.setInterval(() => {
      if (Date.now() > this.pollUntil) {
        clearInterval(this.poll);
        return;
      }
      void this.checkOrder();
    }, 3500);
  }

  private async checkOrder(manual = false): Promise<void> {
    const id = this.pendingId();
    if (!id) return;
    try {
      const r = await api.payOrder(id);
      this.onOrder(r.order);
      if (manual && r.order.status === 'pending') this.ctx.toast('Paiement pas encore confirmé : patientez quelques secondes');
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        this.remember(null);
        clearInterval(this.poll);
      }
    }
  }

  private onOrder(o: PayOrder): void {
    const shown = this.checkout?.order?.id === o.id ? this.checkout.order : null;
    // rien de neuf : on ne redessine pas (le joueur est peut-être en train de taper ou de cliquer)
    if (shown && shown.status === o.status && shown.hint === o.hint) return;
    if (shown) this.checkout!.order = o;
    if (o.status !== 'pending') {
      this.remember(null);
      clearInterval(this.poll);
    }
    if (o.status === 'paid') {
      this.ctx.sfx.fanfare();
      this.ctx.celebrate(120);
      this.ctx.banner(`+${nf.format(o.sth)} STH coins 💎`, 'Paiement reçu, merci ! Vos coffres vous attendent dans la boutique.');
      void this.ctx.refresh();
    }
    if (this.checkout) this.renderCheckout();
  }
}

// ---------------------------------------------------------------- animation d'ouverture d'un coffre

type OpenResult = Awaited<ReturnType<typeof api.openChest>>;

export class ChestOpener {
  busy = false;
  private el: HTMLElement;
  private sparks: HTMLCanvasElement;
  private timers: number[] = [];
  private parts: Array<{ x: number; y: number; vx: number; vy: number; life: number; c: string; s: number }> = [];
  private raf = 0;
  private revealNow: (() => void) | null = null;
  private done: (() => void) | null = null;
  /** Appelé quand le joueur veut ouvrir le coffre suivant du même type. */
  onAgain: ((id: ChestId) => void) | null = null;
  onInventory: (() => void) | null = null;

  constructor(private ctx: PremiumCtx) {
    this.el = document.getElementById('chestOpen')!;
    this.sparks = this.el.querySelector('canvas')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (b?.dataset.again) {
        const id = b.dataset.again as ChestId;
        this.close();
        this.onAgain?.(id);
      } else if (b?.dataset.inv !== undefined) {
        this.close();
        this.onInventory?.();
      } else if (b?.dataset.close !== undefined) this.close();
      else if (this.revealNow) this.revealNow(); // toucher : passer l'animation
    });
  }

  play(r: OpenResult, apply: () => void): void {
    this.busy = true;
    this.done = apply;
    const rar = r.rarity;
    const rank = RARITY_IDS.indexOf(rar);
    const base = Math.min(...Object.keys(CATALOG.chests[r.chest].odds).map((k) => RARITY_IDS.indexOf(k as RarityId)));
    const color = CATALOG.rarities[rar].color;
    const wk = work(r.artwork.workId);
    const frame = CATALOG.frames[r.frame];
    const value = wk.price * frame.mult;
    this.el.className = `chest-open r-${rar}`;
    this.el.hidden = false;
    this.el.style.setProperty('--rc', CATALOG.chests[r.chest].color);
    this.el.innerHTML = `<canvas class="co-sparks"></canvas><div class="co-rays"></div><div class="co-flash"></div>
      <div class="co-stage">
        <div class="co-chest">${chestSvg(r.chest)}</div>
        <div class="co-card f-${r.frame}">
          <div class="co-frame"><img src="${artUrl(wk.id)}" alt="" /></div>
          <div class="co-info">
            <span class="co-rar" style="color:${color}">${CATALOG.rarities[rar].label}${r.frame !== 'normal' ? ` · ${frame.label} ×${frame.mult}` : ''}</span>
            <b>${esc(wk.title)}</b>
            <small>${esc(wk.artist)}, ${wk.year < 0 ? `${-wk.year} av. J.-C.` : wk.year}</small>
            <span class="co-val">Valeur ${money(value)} · +${perSec(incomeOf(wk.id, r.frame))}/s</span>
            ${r.pityUsed ? '<span class="co-pity">🎯 Garantie déclenchée</span>' : ''}
          </div>
        </div>
      </div>
      <div class="co-title"></div>
      <div class="co-actions"></div>
      <div class="co-skip">Toucher pour révéler</div>`;
    this.sparks = this.el.querySelector('canvas')!;
    this.resize();
    const chestEl = this.el.querySelector<HTMLElement>('.co-chest')!;
    const title = this.el.querySelector<HTMLElement>('.co-title')!;
    // suspense : la lueur passe d'une rareté à la suivante jusqu'à la vraie
    const steps = RARITY_IDS.slice(base, rank + 1);
    const T = (ms: number, fn: () => void) => this.timers.push(window.setTimeout(fn, ms));
    this.el.style.setProperty('--glow', CATALOG.rarities[steps[0]].color);
    T(450, () => chestEl.classList.add('shake'));
    steps.forEach((s, i) => T(700 + i * 520, () => {
      this.el.style.setProperty('--glow', CATALOG.rarities[s].color);
      chestEl.classList.add('pulse');
      setTimeout(() => chestEl.classList.remove('pulse'), 260);
      this.ctx.sfx.coin(1 + i);
    }));
    const openAt = 900 + steps.length * 520;
    const reveal = () => {
      this.revealNow = null;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      this.el.style.setProperty('--glow', color);
      chestEl.classList.remove('shake');
      this.el.classList.add('opened');
      const big = rank >= 3;
      this.burst(color, 40 + rank * 45);
      if (big) this.el.classList.add('flash');
      if (rank >= 3) this.ctx.sfx.fanfare();
      else this.ctx.sfx.rare();
      if (rank >= 2) this.ctx.celebrate(40 + rank * 30);
      title.textContent = rar === 'mythique' ? 'MYTHIQUE !!!' : rar === 'legendaire' ? 'LÉGENDAIRE !' : rar === 'epique' ? 'ÉPIQUE !' : rar === 'rare' ? 'Rare !' : 'Nouvelle œuvre';
      title.style.color = color;
      setTimeout(() => this.el.classList.add('revealed'), 380);
      setTimeout(() => {
        apply();
        this.done = null;
        const left = (this.ctx.state()?.chests[r.chest] ?? 0);
        const where = r.artwork.slot === null ? 'Partie en réserve (musée plein)' : 'Exposée dans votre musée';
        this.el.querySelector('.co-actions')!.innerHTML = `<p>${where}</p><div>
          ${left > 0 ? `<button class="go" data-again="${r.chest}">Ouvrir le suivant (${left})</button>` : ''}
          <button class="go alt" data-inv>Voir l’inventaire</button>
          <button class="go ghost" data-close>Continuer</button></div>`;
        this.busy = false;
      }, 900);
    };
    this.revealNow = reveal;
    T(openAt, reveal);
    this.loop();
  }

  close(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.done) {
      this.done();
      this.done = null;
    }
    cancelAnimationFrame(this.raf);
    this.parts = [];
    this.el.hidden = true;
    this.el.className = 'chest-open';
    this.busy = false;
    this.revealNow = null;
  }

  private resize(): void {
    this.sparks.width = innerWidth * Math.min(devicePixelRatio, 2);
    this.sparks.height = innerHeight * Math.min(devicePixelRatio, 2);
  }

  private burst(color: string, n: number): void {
    const k = Math.min(devicePixelRatio, 2);
    const cx = this.sparks.width / 2;
    const cy = this.sparks.height * 0.48;
    const cols = [color, '#ffffff', '#ffd36b'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (3 + Math.random() * 9) * k;
      this.parts.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4 * k, life: 1, c: cols[i % cols.length], s: (2 + Math.random() * 4) * k });
    }
  }

  private loop(): void {
    const g = this.sparks.getContext('2d')!;
    const k = Math.min(devicePixelRatio, 2);
    const step = () => {
      g.clearRect(0, 0, this.sparks.width, this.sparks.height);
      for (const p of this.parts) {
        p.vy += 0.25 * k;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.012;
        g.globalAlpha = Math.max(0, p.life);
        g.fillStyle = p.c;
        g.beginPath();
        g.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        g.fill();
      }
      this.parts = this.parts.filter((p) => p.life > 0);
      if (!this.el.hidden) this.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(step);
  }
}
