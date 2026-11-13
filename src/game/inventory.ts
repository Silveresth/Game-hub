// Inventaire du joueur : coffres à ouvrir, œuvres exposées, réserve, outils du marché noir, album de la collection.
// Chaque action passe par le serveur (ranger, exposer, remplacer, vendre, ouvrir un coffre).
import * as api from './api';
import type { ChestId, OwnedArtwork, PlayerState, ToolId } from './api';
import { CATALOG, artUrl, incomeOf, money, perSec, work, type RarityId } from './catalog';
import { CHEST_IDS, RARITY_IDS, chestSvg, oddsHtml } from './premium';
import type { Sfx } from './sfx';

export type InvTab = 'chests' | 'shown' | 'reserve' | 'tools' | 'album';

export interface InventoryCtx {
  state: () => PlayerState | null;
  apply: (s: PlayerState) => void;
  guarded: <T>(fn: () => Promise<T>) => Promise<T | null>;
  toast: (m: string) => void;
  sfx: Sfx;
  /** « dans la salle #3 (1er étage) » */
  slotWhere: (slot: number) => string;
  openChest: (id: ChestId) => void;
  openShop: (tab: 'chests' | 'sth') => void;
}

/** Emplacements muraux 0 à 213, socles de statues du toit-terrasse à partir de 214 (même règle que le serveur). */
const STATUE_SLOT_FROM = 214;
const TOOL_IDS = Object.keys(CATALOG.tools) as ToolId[];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const valueOf = (a: OwnedArtwork) => (a.repro ? 0 : work(a.workId).price * CATALOG.frames[a.frame].mult);
const incomeOfArt = (a: OwnedArtwork) => (a.repro ? 0 : incomeOf(a.workId, a.frame));

export class Inventory {
  tab: InvTab = 'chests';
  /** Œuvre de la réserve à exposer à la place d'une autre (choix en cours). */
  private replacing: string | null = null;
  private sellArmed: { uid: string; until: number } | null = null;
  private oddsOpen: ChestId | null = null;

  constructor(private ctx: InventoryCtx, private tabsEl: HTMLElement, private body: HTMLElement) {
    tabsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab as InvTab;
      this.replacing = null;
      this.render();
    });
    body.addEventListener('click', (e) => this.onClick(e));
  }

  /** Nombre de coffres non ouverts (pastille du bouton 🎒). */
  static chestCount(s: PlayerState | null): number {
    return s ? CHEST_IDS.reduce((n, id) => n + (s.chests?.[id] ?? 0), 0) : 0;
  }

  render(): void {
    const s = this.ctx.state();
    if (!s) return;
    const shown = s.artworks.filter((a) => a.slot !== null);
    const reserve = s.artworks.filter((a) => a.slot === null);
    const chests = Inventory.chestCount(s);
    const tools = TOOL_IDS.reduce((n, id) => n + (s.tools[id] ?? 0), 0);
    const owned = new Set(s.artworks.filter((a) => !a.repro).map((a) => a.workId));
    const tabs: Array<[InvTab, string, number | string]> = [
      ['chests', '🎁 Coffres', chests],
      ['shown', '🖼 Exposées', `${shown.length}/${s.slots}`],
      ['reserve', '📦 Réserve', reserve.length],
      ['tools', '🧰 Outils', tools],
      ['album', '📚 Album', `${owned.size}/${CATALOG.works.length}`],
    ];
    this.tabsEl.innerHTML = tabs.map(([id, label, n]) => `<button data-tab="${id}" class="${id === this.tab ? 'on' : ''}">${label} <small>${n}</small></button>`).join('');
    switch (this.tab) {
      case 'chests': this.body.innerHTML = this.chestsHtml(s); break;
      case 'shown': this.body.innerHTML = this.replacing ? this.replaceHtml(s) : this.shownHtml(s, shown); break;
      case 'reserve': this.body.innerHTML = this.replacing ? this.replaceHtml(s) : this.reserveHtml(s, reserve); break;
      case 'tools': this.body.innerHTML = this.toolsHtml(s); break;
      case 'album': this.body.innerHTML = this.albumHtml(s, owned); break;
    }
  }

  // ------------------------------------------------------------ onglets

  private chestsHtml(s: PlayerState): string {
    const list = CHEST_IDS.filter((id) => (s.chests[id] ?? 0) > 0);
    let html = `<p class="pane-intro">Vos Lucky coffres attendent ici. Ouvrez-les quand vous voulez : chacun contient une œuvre d’art, exposée tout de suite si une place est libre (sinon, elle part en réserve).</p>`;
    if (!list.length) {
      return `${html}<div class="empty-state"><div class="big">🎁</div><p>Aucun coffre pour l’instant.</p><button class="go" data-shop="chests">Acheter des Lucky coffres</button>
        <p class="d">Vous avez <b>💎 ${s.sth.toLocaleString('fr-FR')} STH</b>.</p></div>`;
    }
    html += '<div class="inv-chests">';
    for (const id of list) {
      const c = CATALOG.chests[id];
      html += `<article class="inv-chest" style="--cc:${c.color}">
        <div class="chest-pic">${chestSvg(id, 'idle')}<span class="own">×${s.chests[id]}</span></div>
        <div class="ic-txt"><b>${c.label}</b><small>${c.desc}</small>
          <button class="linkbtn" data-odds="${id}">${this.oddsOpen === id ? 'Masquer' : 'Voir'} les probabilités</button></div>
        <button class="go" data-openchest="${id}">Ouvrir</button>
        ${this.oddsOpen === id ? `<div class="ic-odds">${oddsHtml(id, s)}</div>` : ''}
      </article>`;
    }
    return `${html}</div><button class="linkbtn" data-shop="chests">Acheter d’autres coffres →</button>`;
  }

  private card(a: OwnedArtwork, actions: string, where = ''): string {
    const w = work(a.workId);
    const r = CATALOG.rarities[w.rarity];
    const frame = a.frame !== 'normal' ? `<span class="fr f-${a.frame}">${CATALOG.frames[a.frame].label}</span>` : '';
    return `<article class="art-card r-${w.rarity}${a.carried ? ' carried' : ''}" style="--rc:${r.color}">
      <div class="thumb f-${a.frame}"><img src="${artUrl(w.id)}" alt="" loading="lazy" /></div>
      <div class="ac-txt">
        <b title="${esc(w.title)}">${esc(w.title)}</b>
        <small>${esc(w.artist)}</small>
        <span class="tags"><span class="rar">${r.label}</span>${frame}${a.repro ? '<span class="fr">Reproduction</span>' : ''}${w.kind === 'statue' ? '<span class="fr">Statue</span>' : ''}</span>
        <span class="num">${a.repro ? 'Décorative' : `+${perSec(incomeOfArt(a))}/s · ${money(valueOf(a))}`}</span>
        ${where ? `<span class="where">${where}</span>` : ''}
      </div>
      <div class="ac-actions">${a.carried ? '<span class="warn">En cours de vol !</span>' : actions}</div>
    </article>`;
  }

  private sellBtn(a: OwnedArtwork): string {
    const armed = this.sellArmed?.uid === a.uid && performance.now() < this.sellArmed.until;
    const gain = Math.floor(valueOf(a) * 0.5);
    return `<button class="mini danger" data-sell="${a.uid}">${armed ? 'Confirmer ?' : a.repro ? 'Retirer' : `Vendre +${money(gain)}`}</button>`;
  }

  private shownHtml(s: PlayerState, shown: OwnedArtwork[]): string {
    if (!shown.length) return '<div class="empty-state"><div class="big">🖼</div><p>Aucune œuvre exposée. Achetez-en au convoi, ou ouvrez un Lucky coffre.</p></div>';
    const total = shown.reduce((n, a) => n + (a.carried ? 0 : incomeOfArt(a)), 0);
    let html = `<p class="pane-intro">${shown.length} œuvre${shown.length > 1 ? 's' : ''} au mur sur ${s.slots} emplacements · elles rapportent <b>+${perSec(total * s.incomeMult)}/s</b>. Rangez-en une pour libérer sa place.</p><div class="art-list">`;
    for (const a of [...shown].sort((x, y) => incomeOfArt(y) - incomeOfArt(x))) {
      html += this.card(a, `<button class="mini" data-store="${a.uid}">Ranger</button>${this.sellBtn(a)}`, this.ctx.slotWhere(a.slot!));
    }
    return `${html}</div>`;
  }

  private freeSlots(s: PlayerState): { walls: number; pedestals: number } {
    const used = new Set(s.artworks.map((a) => a.slot).filter((x): x is number => x !== null));
    let walls = 0;
    let pedestals = 0;
    for (let i = 0; i < s.slots; i++) {
      if (used.has(i)) continue;
      if (i >= STATUE_SLOT_FROM) pedestals++;
      else walls++;
    }
    return { walls, pedestals };
  }

  private reserveHtml(s: PlayerState, reserve: OwnedArtwork[]): string {
    const free = this.freeSlots(s);
    let html = `<p class="pane-intro">La réserve garde les œuvres qui ne sont pas au mur : elles ne rapportent rien. Emplacements libres : <b>${free.walls}</b>${free.pedestals ? ` · socles de statues : <b>${free.pedestals}</b>` : ''}.</p>`;
    if (!reserve.length) return `${html}<div class="empty-state"><div class="big">📦</div><p>Réserve vide.</p></div>`;
    html += '<div class="art-list">';
    for (const a of [...reserve].sort((x, y) => incomeOfArt(y) - incomeOfArt(x))) {
      html += this.card(a, `<button class="mini ok" data-place="${a.uid}">Exposer</button>${this.sellBtn(a)}`);
    }
    return `${html}</div>`;
  }

  /** Choix de l'œuvre à remplacer par celle de la réserve. */
  private replaceHtml(s: PlayerState): string {
    const a = s.artworks.find((x) => x.uid === this.replacing);
    if (!a) {
      this.replacing = null;
      return '';
    }
    const statue = work(a.workId).kind === 'statue';
    const candidates = s.artworks
      .filter((x) => x.slot !== null && !x.carried && (statue || x.slot < STATUE_SLOT_FROM))
      .sort((x, y) => incomeOfArt(x) - incomeOfArt(y));
    let html = `<button class="linkbtn back" data-cancel>← Annuler</button>
      <p class="pane-intro">Votre musée est plein. Quelle œuvre remplacer par <b>« ${esc(work(a.workId).title)} »</b> (+${perSec(incomeOfArt(a))}/s) ? Elle partira dans la réserve.</p><div class="art-list">`;
    for (const c of candidates) {
      const better = incomeOfArt(a) - incomeOfArt(c);
      html += this.card(c, `<button class="mini ok" data-swap="${c.slot}">Remplacer${better > 0 ? ` (+${perSec(better)}/s)` : ''}</button>`, this.ctx.slotWhere(c.slot!));
    }
    return `${html}</div>`;
  }

  private toolsHtml(s: PlayerState): string {
    let html = '<p class="pane-intro">Outils du marché noir (tente violette sur la place). Utilisez-les près d’un musée rival avec les touches 1 à 6, ou la barre d’outils en bas à gauche.</p><div class="tool-list">';
    TOOL_IDS.forEach((id, i) => {
      const t = CATALOG.tools[id];
      const n = s.tools[id] ?? 0;
      html += `<div class="tool-row ${n ? '' : 'none'}"><span class="ti">${t.icon}</span><div><b>${t.label}</b><small>${t.desc}</small></div><span class="tn">×${n}<small>touche ${i + 1}</small></span></div>`;
    });
    return `${html}</div>`;
  }

  private albumHtml(s: PlayerState, owned: Set<string>): string {
    const counts = new Map<string, number>();
    for (const a of s.artworks) if (!a.repro) counts.set(a.workId, (counts.get(a.workId) ?? 0) + 1);
    const pctDone = Math.round((owned.size / CATALOG.works.length) * 100);
    let html = `<div class="album-head"><b>${owned.size} / ${CATALOG.works.length} œuvres découvertes</b><div class="bar"><i style="width:${pctDone}%"></i></div></div>`;
    for (const r of RARITY_IDS) {
      const list = CATALOG.works.filter((w) => w.rarity === (r as RarityId));
      html += `<h3 class="album-r" style="color:${CATALOG.rarities[r].color}">${CATALOG.rarities[r].label} <small>${list.filter((w) => owned.has(w.id)).length}/${list.length}</small></h3><div class="album">`;
      for (const w of list) {
        const n = counts.get(w.id) ?? 0;
        html += `<figure class="${n ? 'got' : 'missing'}" title="${esc(w.title)}, ${esc(w.artist)}"><img src="${artUrl(w.id)}" alt="" loading="lazy" />${n > 1 ? `<span>×${n}</span>` : ''}<figcaption>${n ? esc(w.title) : '???'}</figcaption></figure>`;
      }
      html += '</div>';
    }
    return html;
  }

  // ------------------------------------------------------------ actions

  private onClick(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    if (d.shop) return this.ctx.openShop(d.shop as 'chests' | 'sth');
    if (d.openchest) return this.ctx.openChest(d.openchest as ChestId);
    if (d.odds) {
      this.oddsOpen = this.oddsOpen === d.odds ? null : (d.odds as ChestId);
      return this.render();
    }
    if (d.cancel !== undefined) {
      this.replacing = null;
      return this.render();
    }
    if (d.store) return void this.act(() => api.storeArtwork(d.store!), 'Œuvre rangée dans la réserve');
    if (d.place) {
      const uid = d.place;
      void (async () => {
        const s = this.ctx.state();
        const a = s?.artworks.find((x) => x.uid === uid);
        if (!s || !a) return;
        const free = this.freeSlots(s);
        const statue = work(a.workId).kind === 'statue';
        if (free.walls === 0 && !(statue && free.pedestals > 0)) {
          // pas de place libre : choisir une œuvre à remplacer
          this.replacing = uid;
          return this.render();
        }
        await this.act(() => api.placeArtwork(uid), `« ${work(a.workId).title} » exposée`);
      })();
      return;
    }
    if (d.swap && this.replacing) {
      const uid = this.replacing;
      const slot = Number(d.swap);
      this.replacing = null;
      return void this.act(() => api.moveArtwork(uid, slot), 'Œuvre remplacée : l’ancienne est dans la réserve');
    }
    if (d.sell) {
      const uid = d.sell;
      if (!this.sellArmed || this.sellArmed.uid !== uid || performance.now() > this.sellArmed.until) {
        this.sellArmed = { uid, until: performance.now() + 3000 };
        return this.render();
      }
      this.sellArmed = null;
      void (async () => {
        const r = await this.ctx.guarded(() => api.sell(uid));
        if (!r) return;
        this.ctx.apply(r.state);
        this.ctx.sfx.coin(3);
        this.ctx.toast(`Œuvre revendue : +${money(r.gain)} pièces`);
        this.render();
      })();
    }
  }

  private async act(fn: () => Promise<{ state: PlayerState }>, msg: string): Promise<void> {
    const r = await this.ctx.guarded(fn);
    if (!r) return;
    this.ctx.apply(r.state);
    this.ctx.sfx.whoosh();
    this.ctx.toast(msg);
    this.render();
  }
}
