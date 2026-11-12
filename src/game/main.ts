import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mountLiveBar, setupPwa } from '../shared/live';
import * as api from './api';
import type { ConvoyItem, GuardTier, InboxItem, PlayerState, ToolId } from './api';
import { Character, loadCharacterModel } from './character';
import { AUCTION_DOOR, BLACK_MARKET, District, type Box, type Circle } from './district';
import { Guards } from './guards';
import { AuctionHall } from './auction';
import { PUSH_CATEGORIES, enablePush, pushSupport } from './push';
import { mountGoogleButton } from './google';
import { MuseumView } from './museumView';
import { FLOOR_H, PLOTS, spawnOf } from './layout';
import { Net, type PlotInfo, type ServerMsg } from './net';
import { RemotePlayers } from './remote';
import { Convoy, artTexture } from './convoy';
import { Visitors } from './visitors';
import { Input } from './input';
import { Sfx } from './sfx';
import { CATALOG, incomeOf, money, perSec, work } from './catalog';

const liveBar = mountLiveBar();
setupPwa('../sw.js');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ================================================================== rendu

const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#f0dcc4', 90, 260);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x6b5a45, 1.15));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// Qualité graphique : « Éco » (sans ombres, résolution 1×) par défaut sur les téléphones et petites machines
type Quality = 'high' | 'low';
function savedQuality(): Quality | null {
  try {
    return localStorage.getItem('sam-quality') as Quality | null;
  } catch {
    return null;
  }
}
let quality: Quality = savedQuality() ?? (matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high');
function applyQuality(): void {
  const high = quality === 'high';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.75) : 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = high;
  sun.castShadow = high;
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => (x.needsUpdate = true));
  });
  $('qualityBtn').textContent = high ? 'HD' : 'Éco';
  $('qualityBtn').title = high ? 'Qualité haute (cliquer pour le mode économie)' : 'Mode économie (cliquer pour la qualité haute)';
}
$('qualityBtn').onclick = () => {
  quality = quality === 'high' ? 'low' : 'high';
  try {
    localStorage.setItem('sam-quality', quality);
  } catch {
    /* stockage indisponible */
  }
  applyQuality();
};
applyQuality();

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1200);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.enablePan = false;
orbit.minDistance = 4;
orbit.maxDistance = 24;
orbit.minPolarAngle = 0.35;
orbit.maxPolarAngle = 1.32;
// Contrôle caméra style Roblox / jeu d'exploration : clic droit pour pivoter, molette pour zoomer
orbit.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};

const hall = new AuctionHall();
hall.resize(innerWidth, innerHeight);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  hall.resize(innerWidth, innerHeight);
});

// ================================================================== monde

const district = new District(scene);
const convoy = new Convoy(scene);
const visitors = new Visitors(scene);
const remotes = new RemotePlayers(scene);
const guards = new Guards(scene);
remotes.hidden = (x, z, f) => hiddenAt(x, z, f);
guards.hidden = (x, z, f) => hiddenAt(x, z, f);
const input = new Input();
const sfx = new Sfx();
let player: Character | null = null;

/** Les 7 parcelles du quartier ; `myView` est la vôtre (attribuée par le serveur). */
const views = new Map<number, MuseumView>();
let myView: MuseumView | null = null;
let myPlot = -1;
const net = new Net(() => api.currentSession());

// ================================================================== état

let state: PlayerState | null = null;
let stateAt = 0; // performance.now() de la dernière synchro
let offset = 0; // horloge serveur - horloge locale
let playing = false;
let busy = false;
const serverNow = () => Date.now() + offset;

const pos = spawnOf(PLOTS[2]);
const vel = new THREE.Vector2();
let vy = 0;
let facing = Math.PI; // face à la caméra (vers la route) au départ
/** Étage du joueur (0 = rez-de-chaussée) ; pos.y ne sert qu'au saut. */
let floor = 0;
/** Le musée où se trouve le joueur, à son étage. */
const viewAt = () => [...views.values()].find((v) => v.contains(pos, floor)) ?? null;

/** Un joueur ou un garde situé au-dessus de l'étage affiché de son musée est masqué. */
function hiddenAt(x: number, z: number, f: number): boolean {
  if (f === 0) return false;
  const p = new THREE.Vector3(x, 0, z);
  const v = [...views.values()].find((m) => m.contains(p, f));
  return !!v && f > v.currentCut;
}

let playerColor = '';
let questDoneSeen = '';

function applyState(s: PlayerState): void {
  // objectif qui vient d'être atteint : on le signale une seule fois
  if (s.quest?.done && questDoneSeen !== s.quest.id) {
    questDoneSeen = s.quest.id;
    if (state) {
      sfx.rare();
      toast(`Objectif atteint : récupérez ${money(s.quest.reward)} pièces !`);
    }
  }
  // couleur du personnage choisie par le joueur
  if (player && s.color !== playerColor) {
    playerColor = s.color;
    const fresh = new Character(parseInt(s.color.slice(1), 16));
    fresh.root.position.copy(player.root.position);
    fresh.root.rotation.copy(player.root.rotation);
    player.dispose();
    player = fresh;
    scene.add(player.root);
  }
  state = s;
  stateAt = performance.now();
  offset = s.serverTime - Date.now();
  myView?.applyOwn(s);
  const shown = s.artworks.filter((a) => a.slot !== null).length;
  visitors.setTarget(Math.min(s.visitorsCap, Math.ceil(shown * 1.25)));
  renderHud();
  renderTimers();
  renderToolbar();
  if ($('security').classList.contains('open')) renderSecurity();
  if ($('market').classList.contains('open')) renderMarket();
}

/** Caisse affichée : extrapolée entre deux synchros (au rythme « en ligne »). */
function cashNow(): number {
  if (!state) return 0;
  return Math.min(state.cashCap, state.cash + (state.income * (performance.now() - stateAt)) / 1000);
}

// ================================================================== HUD

let hudKey = '';
function renderHud(): void {
  if (!state) return;
  const shown = state.artworks.filter((a) => a.slot !== null).length;
  const reserve = state.artworks.length - shown;
  const q = state.quest;
  const key = [state.coins, state.income, shown, state.slots, reserve, state.value, state.name, state.rank, state.of, JSON.stringify(q)].join('|');
  if (key === hudKey) return;
  hudKey = key;
  $('rankInfo').textContent = state.value > 0 ? `N°${state.rank} du classement sur ${state.of} musées` : 'Pas encore classé';
  $('quest').hidden = !q;
  if (q) {
    $('questStep').textContent = `Objectif ${q.index + 1}/${q.total}`;
    $('questReward').textContent = `+${money(q.reward)}`;
    $('questLabel').textContent = q.label;
    $('questHint').textContent = q.done ? 'Objectif atteint !' : `${money(q.progress)} / ${money(q.target)} · ${q.hint}`;
    $('questBar').style.width = `${Math.round((q.progress / q.target) * 100)}%`;
    $('questClaim').hidden = !q.done;
    $('questClaim').textContent = `Récupérer ${money(q.reward)} pièces`;
    $('quest').classList.toggle('done', q.done);
  }
  $('museumName').textContent = state.name;
  $('coins').textContent = money(state.coins);
  $('income').textContent = `+${perSec(state.income)} /s`;
  $('slotsInfo').textContent = `${shown}/${state.slots} œuvres`;
  $('valueInfo').textContent = `Valeur : ${money(state.value)}`;
  $('reserveInfo').textContent = reserve ? `${reserve} en réserve` : '';
}

const fmtDur = (ms: number) => {
  if (ms >= 3_600_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h} h ${String(m).padStart(2, '0')}`;
  }
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.max(0, Math.ceil(ms / 1000))} s`;
};

/** Ce qui dépend de l'heure : bouclier, protections, fin du contrat des gardes (appelé chaque seconde). */
let guardsWarned = 0;
let guardsWere = false;
function renderTimers(): void {
  if (!state) return;
  const now = serverNow();
  $('shieldInfo').textContent = state.shielded
    ? '🛡 Bouclier débutant : personne ne peut vous voler'
    : state.immuneUntil > now
      ? `🛡 Protégé encore ${Math.ceil((state.immuneUntil - now) / 60_000)} min`
      : '⚠ Votre musée peut être cambriolé';
  $('shieldInfo').classList.toggle('danger', !state.shielded && state.immuneUntil <= now);
  const parts: string[] = [];
  const guardsLeft = state.guardsUntil - now;
  if (guardsLeft > 0) parts.push(`👮 ${state.sec.guards} · ${fmtDur(guardsLeft)}`);
  if (state.camerasUntil > now) parts.push(`📷 ${fmtDur(state.camerasUntil - now)}`);
  if (state.sec.lasers) parts.push('🔴 lasers');
  if (state.sec.generator) parts.push('🔋');
  if (state.insuranceUntil > now) parts.push('📄 assuré');
  $('secInfo').textContent = parts.length ? parts.join(' · ') : 'Aucune protection : touche G';
  $('secInfo').classList.toggle('none', !parts.length);
  // les gardes vont partir : c'est LE moment de revenir renouveler le contrat
  const expiring = guardsLeft > 0 && guardsLeft < 10 * 60_000;
  if (expiring && guardsWarned !== state.guardsUntil && playing) {
    guardsWarned = state.guardsUntil;
    sfx.error();
    toast(`👮 Vos gardes partent dans ${fmtDur(guardsLeft)} : renouvelez le contrat (G)`);
  }
  if (guardsWere && guardsLeft <= 0 && playing) banner('Vos gardes sont partis', 'Votre musée n’est plus surveillé : G pour réembaucher');
  guardsWere = guardsLeft > 0;
  $('secBtn').classList.toggle('warn', expiring || (!state.shielded && !parts.length));
  // l'objectif se range sous le porte-monnaie, quelle que soit sa hauteur
  $('quest').style.top = `${Math.round($('wallet').getBoundingClientRect().bottom + 10)}px`;
}

// ================================================================== sécurité, marché noir, outils (phase 3)

const TOOL_IDS = Object.keys(CATALOG.tools) as ToolId[];
let crowbarArmed = false;

let decorRoomIndex: number | null = null;

function openOverlay(id: 'security' | 'market' | 'decor'): void {
  if (!state) return;
  $(id).classList.add('open');
  input.enabled = false;
  if (id === 'security') renderSecurity();
  else if (id === 'market') renderMarket();
  else if (id === 'decor') renderDecor();
}
function closeOverlays(): void {
  for (const id of ['security', 'market', 'help', 'boards', 'decor']) $(id).classList.remove('open');
  if (!$('welcome').classList.contains('open')) input.enabled = true;
}
document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => (b.onclick = closeOverlays));
for (const id of ['security', 'market', 'boards', 'decor']) $(id).addEventListener('pointerdown', (e) => e.target === $(id) && closeOverlays());
$('secBtn').onclick = () => openOverlay('security');

function offerHtml(title: string, desc: string, price: number | null, data: Record<string, string | number>, label?: string): string {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${v}"`).join(' ');
  const poor = price !== null && (state?.coins ?? 0) < price;
  const btn = price === null
    ? `<button disabled>${label ?? 'Installé'}</button>`
    : `<button ${attrs} class="${poor ? 'poor' : ''}">${label ?? money(price)}</button>`;
  return `<div class="offer"><span class="t">${title}</span>${btn}<span class="d">${desc}</span></div>`;
}

function renderSecurity(): void {
  if (!state) return;
  const s = state;
  const now = serverNow();
  const SC = CATALOG.security;
  const o = s.offers;
  const status = (on: boolean, text: string) => `<small class="${on ? '' : 'off'}">${text}</small>`;
  let html = '';
  const gLeft = s.guardsUntil - now;
  html += `<h2>Gardes ${status(gLeft > 0, gLeft > 0 ? `${SC.guards[s.guardsTier!].label} · encore ${fmtDur(gLeft)}` : 'aucun garde')}</h2>`;
  for (const tier of Object.keys(SC.guards) as GuardTier[]) {
    const g = SC.guards[tier];
    const dur = g.minutes >= 60 ? `${g.minutes / 60} h` : `${g.minutes} min`;
    const desc = s.guardsTier === tier && gLeft > 0 ? `Prolonge votre contrat de ${dur}` : `${g.count} garde${g.count > 1 ? 's' : ''} pendant ${dur} : ils patrouillent et arrêtent les voleurs qu’ils voient`;
    html += offerHtml(`👮 ${g.label} · ${dur}`, desc, o.guards[tier], { item: 'guards', tier });
  }
  html += '<div class="faille">Failles : ils ne voient que dans leur salle et dans leur cône, ils bâillent puis font la relève toutes les 10 min, et les voleurs ont des fumigènes et des leurres.</div>';
  html += `<h2>Caméras ${status(s.camerasUntil > now, s.camerasUntil > now ? `actives · ${fmtDur(s.camerasUntil - now)}` : 'aucune')}</h2>`;
  html += offerHtml(`📷 Une caméra par salle · ${SC.cameras.hours} h`, 'Un décrochage déclenche l’alarme : vous êtes prévenu et les gardes accourent. Faille : brouilleur, coupure de courant.', o.cameras, { item: 'cameras' }, s.camerasUntil > now ? `+24 h · ${money(o.cameras)}` : undefined);
  html += `<h2>Lasers aux portes ${status(s.sec.lasers, s.sec.lasers ? 'installés' : 'non')}</h2>`;
  html += offerHtml('🔴 Barrière laser à l’entrée · permanent', 'Alarme si quelqu’un sort avec une œuvre. Faille : coupure de courant.', o.lasers, { item: 'lasers' });
  html += `<h2>Générateur de secours ${status(s.sec.generator, s.sec.generator ? 'installé' : 'non')}</h2>`;
  html += offerHtml('🔋 Générateur · permanent', 'Garde caméras et lasers allumés pendant une coupure. Faille : un sabotage de 10 s, mais bruyant.', o.generator, { item: 'generator' });
  html += `<h2>Chien de garde ${status(s.dogUntil > now, s.dogUntil > now ? `en service · ${fmtDur(s.dogUntil - now)}` : 'non')}</h2>`;
  html += offerHtml(`🐕 Chien de garde · ${SC.dog.hours} h`, 'Flaire les voleurs déguisés en employé : vos gardes les repèrent quand même.', o.dog, { item: 'dog' }, s.dogUntil > now ? `+${SC.dog.hours} h · ${money(o.dog)}` : undefined);
  html += `<h2>Assurance ${status(s.insuranceUntil > now, s.insuranceUntil > now ? `active · ${fmtDur(s.insuranceUntil - now)}` : 'non')}</h2>`;
  html += offerHtml(`📄 Assurance ${SC.insurance.hours} h`, `Rembourse ${SC.insurance.refund * 100} % d’une œuvre volée. N’empêche pas le vol.`, o.insurance, { item: 'insurance' }, s.insuranceUntil > now ? `+24 h · ${money(o.insurance)}` : undefined);
  html += '<h2>Vitrines blindées</h2>';
  const shown = s.artworks.filter((a) => a.slot !== null).sort((a, b) => work(b.workId).price * CATALOG.frames[b.frame].mult - work(a.workId).price * CATALOG.frames[a.frame].mult);
  if (!shown.length) html += '<div class="d">Exposez des œuvres pour les protéger.</div>';
  for (const a of shown) {
    const v = o.vitrines[a.slot!];
    if (!v) continue;
    const next = SC.vitrine.levels[v.level];
    const cur = v.level ? SC.vitrine.levels[v.level - 1].mult : 1;
    const desc = !next
      ? `Vitrine ×${cur} : décrochage ${cur} fois plus long (maximum)`
      : v.level
        ? `Vitrine ×${cur} posée · renforcer : décrochage ${next.mult} fois plus long`
        : `Décrochage ${next.mult} fois plus long. Faille : pied-de-biche (÷2)`;
    html += offerHtml(`🔲 ${work(a.workId).title}`, desc, v.price, { item: 'vitrine', slot: a.slot! }, v.price === null ? 'Maximum' : undefined);
  }
  html += pushSectionHtml();
  $('secBody').innerHTML = html;
}

$('secBody').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.item) return;
  void (async () => {
    const r = await guarded(() => api.buySecurity(b.dataset.item!, { tier: b.dataset.tier as GuardTier | undefined, slot: b.dataset.slot !== undefined ? Number(b.dataset.slot) : undefined }));
    if (!r) return;
    applyState(r.state);
    sfx.buy();
    bumpWallet();
    toast(`${r.label} : −${money(r.price)} pièces`);
  })();
});

function renderMarket(): void {
  if (!state) return;
  let html = '';
  TOOL_IDS.forEach((id, i) => {
    const t = CATALOG.tools[id];
    const n = state!.tools[id] ?? 0;
    const full = n >= CATALOG.maxTools;
    html += offerHtml(`${t.icon} ${t.label} <small>(${n}/${CATALOG.maxTools} · touche ${i + 1})</small>`, t.desc, full ? null : state!.toolPrices[id], { tool: id }, full ? 'Plein' : undefined);
  });
  html += '<div class="faille">Le marché noir ne rembourse rien. Les outils se déclenchent dans un musée rival ou devant son entrée.</div>';
  html += '<h2>Reproductions</h2>';
  for (const w of CATALOG.works.filter((x) => x.unique)) {
    html += offerHtml(`🖼 « ${w.title} » (copie)`, 'Marquée « Reproduction » sur son cartel. Elle décore, ne rapporte rien, ne compte pas dans la valeur du musée et n’intéresse pas les voleurs.', CATALOG.repro.price, { repro: w.id });
  }
  $('marketBody').innerHTML = html;
}

$('marketBody').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.dataset.repro) {
    void (async () => {
      const r = await guarded(() => api.buyRepro(b.dataset.repro!));
      if (!r) return;
      applyState(r.state);
      sfx.buy();
      toast(`Reproduction accrochée : −${money(r.price)} pièces`);
    })();
    return;
  }
  if (!b?.dataset.tool) return;
  void (async () => {
    const r = await guarded(() => api.buyTool(b.dataset.tool as ToolId));
    if (!r) return;
    applyState(r.state);
    sfx.coin(2);
    toast(`${CATALOG.tools[r.tool].label} acheté : −${money(r.price)} pièces`);
  })();
});

let toolbarKey = '';
function renderToolbar(): void {
  if (!state) return;
  const key = JSON.stringify([state.tools, crowbarArmed]);
  if (key === toolbarKey) return;
  toolbarKey = key;
  const bar = $('toolbar');
  bar.innerHTML = '';
  TOOL_IDS.forEach((id, i) => {
    const n = state!.tools[id] ?? 0;
    if (!n) return;
    const t = CATALOG.tools[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${t.label} : ${t.desc} (touche ${i + 1})`;
    b.innerHTML = `${t.icon}<i>${i + 1}</i><b>${n}</b>`;
    if (id === 'pied' && crowbarArmed) b.classList.add('armed');
    b.onclick = () => useTool(id);
    bar.appendChild(b);
  });
  bar.hidden = !bar.children.length;
}

function renderDecor(): void {
  if (!state || decorRoomIndex === null) return;
  const currentThemes: Record<string, string> = state.roomThemes ?? {};
  const currentTheme = currentThemes[decorRoomIndex] ?? 'classic';
  $('decorTitle').textContent = `Décor de la salle #${decorRoomIndex + 1}`;
  const themesList: Array<{ id: string; label: string; desc: string }> = [
    { id: 'classic', label: 'Classique', desc: 'Boiseries, tapisseries damas rouge rubis et parquet chevrons traditionnel.' },
    { id: 'modern', label: 'Moderne', desc: 'Béton ciré élégant, murs immaculés et éclairage zénithal doux.' },
    { id: 'futuristic', label: 'Futuriste', desc: 'Grille au sol électroluminescente, bordures néon bleues et dalles cyber.' },
    { id: 'zen', label: 'Zen', desc: 'Tatami japonais authentique, cloisons shōji en papier de riz et bois clair.' },
  ];
  let html = '';
  for (const t of themesList) {
    const isCurrent = t.id === currentTheme;
    html += offerHtml(
      t.label,
      t.desc,
      isCurrent ? null : 5000,
      { room: decorRoomIndex, theme: t.id },
      isCurrent ? 'Ambiance actuelle' : undefined,
    );
  }
  $('decorBody').innerHTML = html;
}

$('decorBody').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b?.dataset.theme || b.dataset.room === undefined) return;
  const room = Number(b.dataset.room);
  const theme = b.dataset.theme;
  void (async () => {
    const r = await guarded(() => api.setDecor(room, theme));
    if (!r) return;
    applyState(r.state);
    sfx.buy();
    bumpWallet();
    toast(`Nouveau décor installé : −${money(r.cost)} pièces`);
    renderDecor();
  })();
});

function useTool(id: ToolId): void {
  if (!state?.tools[id]) {
    sfx.error();
    toast(`Pas de ${CATALOG.tools[id].label.toLowerCase()} : passez au marché noir`);
    return;
  }
  if (!net.connected) return;
  net.send({ t: 'tool', tool: id });
}

addEventListener('keydown', (e) => {
  if (!playing || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  const currentRoom = myView?.contains(pos, floor) ? myView.roomIndexOf(pos, floor) : null;
  const anyOpen = ['security', 'market', 'welcome', 'help', 'boards', 'decor'].some((id) => $(id).classList.contains('open'));
  if (e.code === 'KeyG' && !e.repeat) {
    if ($('security').classList.contains('open')) closeOverlays();
    else if (!anyOpen) openOverlay('security');
  } else if (e.code === 'KeyT' && !e.repeat) {
    if ($('decor').classList.contains('open')) closeOverlays();
    else if (!anyOpen && currentRoom !== null) {
      decorRoomIndex = currentRoom;
      openOverlay('decor');
    }
  }
  const n = /^Digit([1-5])$/.exec(e.code);
  if (n && !anyOpen && !e.repeat) useTool(TOOL_IDS[Number(n[1]) - 1]);
});

// ---------------------------------------------------------------- effets : fumigène, leurre

const fxList: Array<{ obj: THREE.Object3D; until: number; kind: 'fumigene' | 'leurre'; born: number }> = [];
function spawnFx(kind: 'fumigene' | 'leurre', x: number, z: number, untilServer: number): void {
  const until = performance.now() + Math.max(500, untilServer - serverNow());
  const g = new THREE.Group();
  if (kind === 'fumigene') {
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfc4cc, transparent: true, opacity: 0.55, depthWrite: false, roughness: 1 });
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      puff.position.set((Math.random() - 0.5) * 3, 0.6 + Math.random() * 1.8, (Math.random() - 0.5) * 3);
      puff.scale.setScalar(0.6 + Math.random() * 0.5);
      g.add(puff);
    }
  } else {
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshStandardMaterial({ color: 0xb46bff, emissive: 0x5a1f9a, emissiveIntensity: 0.6 }));
    balloon.position.y = 1.9;
    balloon.scale.y = 1.2;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    string.position.y = 1.0;
    g.add(balloon, string);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  fxList.push({ obj: g, until, kind, born: performance.now() });
}
function updateFx(t: number): void {
  const now = performance.now();
  for (const f of [...fxList]) {
    if (now > f.until) {
      f.obj.removeFromParent();
      f.obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      fxList.splice(fxList.indexOf(f), 1);
      continue;
    }
    if (f.kind === 'fumigene') {
      const k = Math.min(1, (now - f.born) / 900);
      f.obj.scale.setScalar(0.4 + k * 1.8);
      f.obj.rotation.y = t * 0.3;
    } else f.obj.position.y = Math.sin(t * 3) * 0.15;
  }
}

function bumpWallet(): void {
  const w = $('wallet');
  w.classList.remove('bump');
  void w.offsetWidth;
  w.classList.add('bump');
}

let toastTimer: number | undefined;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2800);
}

let bannerTimer: number | undefined;
function banner(title: string, sub = ''): void {
  const b = $('banner');
  b.textContent = title;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    b.appendChild(s);
  }
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => b.classList.remove('show'), 3200);
}

let promptKey = '';
function setPrompt(items: Array<{ key: string; text: string; poor?: boolean }>): void {
  const k = JSON.stringify(items);
  if (k === promptKey) return;
  promptKey = k;
  const p = $('prompt');
  p.hidden = !items.length;
  p.innerHTML = '';
  for (const it of items) {
    const span = document.createElement('span');
    if (it.poor) span.className = 'poor';
    const kbd = document.createElement('kbd');
    kbd.textContent = it.key;
    span.append(kbd, it.text);
    p.appendChild(span);
  }
  $('tR').hidden = !items.some((i) => i.key === 'R');
}

$('muteBtn').onclick = () => ($('muteBtn').textContent = sfx.toggleMute() ? '🔇' : '🔊');
$('helpBtn').onclick = () => $('help').classList.add('open');
$('helpClose').onclick = () => $('help').classList.remove('open');
addEventListener('pointerdown', () => sfx.unlock());
addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.code === 'Escape') {
    if (reorgSelected) {
      reorgSelected = null;
      toast('Déplacement annulé');
      return;
    }
    const anyOpen = ['security', 'market', 'help', 'boards', 'decor'].some((id) => $(id).classList.contains('open'));
    if (!anyOpen && hall.active) leaveHall();
    else closeOverlays();
  }
});

// ================================================================== actions (toutes validées par le serveur)

async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
  if (busy) return null;
  busy = true;
  try {
    return await fn();
  } catch (e) {
    sfx.error();
    toast((e as Error).message);
    return null;
  } finally {
    busy = false;
  }
}

/** L'œuvre achetée s'envole du camion jusqu'à son emplacement. */
function flyArtwork(workId: string, from: THREE.Vector3, to: THREE.Vector3, ry: number): Promise<void> {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: artTexture(workId), side: THREE.DoubleSide }));
  scene.add(mesh);
  sfx.whoosh();
  const start = performance.now();
  const dur = 1500;
  return new Promise((res) => {
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      const e = t * t * (3 - 2 * t);
      mesh.position.lerpVectors(from, to, e);
      mesh.position.y += Math.sin(Math.PI * t) * 10;
      mesh.rotation.set(0, ry + (1 - e) * Math.PI * 4, 0);
      mesh.scale.setScalar(0.8 + Math.sin(Math.PI * t) * 0.6);
      if (t < 1) requestAnimationFrame(step);
      else {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        res();
      }
    };
    requestAnimationFrame(step);
  });
}

async function doBuy(item: ConvoyItem, from: THREE.Vector3): Promise<void> {
  if (!state) return;
  if (state.coins < item.price) {
    sfx.error();
    toast(`Il vous manque ${money(item.price - state.coins)} pièces`);
    return;
  }
  const r = await guarded(() => api.buy(item.window));
  if (!r) return;
  convoy.markSold(item.window);
  sfx.buy();
  player?.gesture('ThumbsUp', 'Idle');
  const wk = work(item.workId);
  if (r.artwork.slot === null) {
    applyState(r.state);
    toast('Musée plein : l’œuvre part en réserve. Agrandissez pour l’exposer !');
    return;
  }
  if (myView) myView.hiddenUid = r.artwork.uid;
  applyState(r.state);
  bumpWallet();
  const { p, ry } = myView!.slotWorld(r.artwork.slot);
  await flyArtwork(item.workId, from, p, ry);
  if (myView) myView.hiddenUid = null;
  if (item.rarity !== 'commun' || item.frame !== 'normal') sfx.rare();
  banner(wk.title, `+${perSec(incomeOf(item.workId, item.frame))} pièces/s · exposée dans votre musée`);
  maybeAskPush();
}

async function doCollect(): Promise<void> {
  const r = await guarded(() => api.collect());
  if (!r) return;
  applyState(r.state);
  if (r.collected > 0) {
    sfx.coin(Math.ceil(Math.log10(r.collected + 1)));
    bumpWallet();
    if (myView) burstCoins(myView.registerPos, Math.min(24, 6 + Math.round(Math.log2(r.collected + 1))));
    toast(`+${money(r.collected)} pièces encaissées`);
  }
}

async function doExpand(): Promise<void> {
  if (!state?.next) return;
  if (state.coins < state.next.cost) {
    sfx.error();
    toast(`Il vous manque ${money(state.next.cost - state.coins)} pièces pour agrandir`);
    return;
  }
  const r = await guarded(() => api.expand());
  if (!r) return;
  applyState(r.state);
  sfx.expand();
  player?.gesture('Wave', 'Idle');
  if (r.state.floors > 1 && r.state.level >= 6) banner(r.state.floors === 2 ? '1er étage construit !' : `${r.state.floors - 1}e étage construit !`, `${r.state.slots} emplacements · l’escalier est dans la salle d’entrée`);
  else banner('Musée agrandi !', `${r.state.rooms} salles · ${r.state.slots} emplacements`);
}

async function doClaim(): Promise<void> {
  const q = state?.quest;
  if (!q?.done) return;
  const r = await guarded(() => api.claim(q.id));
  if (!r) return;
  applyState(r.state);
  sfx.expand();
  bumpWallet();
  burstCoins(pos.clone().add(new THREE.Vector3(0, 0, 1.2)), 16);
  player?.gesture('Yes', 'Idle');
  banner('Objectif accompli !', `+${money(r.reward)} pièces`);
}
$('questClaim').onclick = () => void doClaim();

let sellArmed: { uid: string; until: number } | null = null;
let reorgSelected: { uid: string; workId: string; slot: number } | null = null;

async function doMove(uid: string, targetSlot: number): Promise<void> {
  const r = await guarded(() => api.moveArtwork(uid, targetSlot));
  if (!r) return;
  reorgSelected = null;
  applyState(r.state);
  sfx.whoosh();
  toast(r.swapped ? 'Œuvres interverties !' : 'Œuvre déplacée !');
}

async function doSell(uid: string): Promise<void> {
  if (!sellArmed || sellArmed.uid !== uid || performance.now() > sellArmed.until) {
    sellArmed = { uid, until: performance.now() + 3000 };
    toast('Appuyez encore sur R pour confirmer la revente');
    return;
  }
  sellArmed = null;
  const r = await guarded(() => api.sell(uid));
  if (!r) return;
  applyState(r.state);
  sfx.coin(3);
  bumpWallet();
  toast(`Œuvre revendue : +${money(r.gain)} pièces`);
}

// ---------------------------------------------------------------- pièces qui jaillissent de la caisse

const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25 });
const flyingCoins: Array<{ m: THREE.Mesh; v: THREE.Vector3; life: number }> = [];
function burstCoins(at: THREE.Vector3, n: number): void {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.copy(at).add(new THREE.Vector3(0, 1.4, -1.2));
    scene.add(m);
    flyingCoins.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 5 + Math.random() * 4, (Math.random() - 0.5) * 4), life: 1.1 });
  }
}
function updateCoins(dt: number): void {
  for (const c of [...flyingCoins]) {
    c.life -= dt;
    c.v.y -= 14 * dt;
    // attirées par le joueur
    c.v.addScaledVector(pos.clone().setY(1.2).sub(c.m.position), dt * 3);
    c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += dt * 12;
    if (c.life <= 0) {
      c.m.removeFromParent();
      flyingCoins.splice(flyingCoins.indexOf(c), 1);
    }
  }
}

// ================================================================== hôtel des ventes (phase 4)

function enterHall(): void {
  if (!state || !net.connected || hall.active) return;
  if (carrying || stealing) {
    sfx.error();
    toast('Pas avec une œuvre volée sous le bras !');
    return;
  }
  closeOverlays();
  hall.enter(state.id);
  document.body.classList.add('in-hall');
  input.enabled = false;
  net.send({ t: 'hall-enter' });
  sfx.whoosh();
  void refreshState(); // porte-monnaie à jour avant d'enchérir
}

function leaveHall(): void {
  if (!hall.active) return;
  net.send({ t: 'hall-leave' });
  hall.leave();
  document.body.classList.remove('in-hall');
  input.enabled = true;
  // on ressort au pied des marches
  pos.set(AUCTION_DOOR.x, 0, AUCTION_DOOR.z + 1.5);
  focus.copy(pos);
}
$('hallLeave').onclick = leaveHall;
$('saleBtn').onclick = enterHall;

function bidAmounts(): number[] {
  const lot = hall.state?.lot;
  if (!lot) return [];
  return [lot.min, lot.min + lot.step, lot.min + lot.step * 4];
}

function placeBid(amount: number): void {
  const lot = hall.state?.lot;
  if (!lot || lot.phase !== 'bidding') return;
  if (!Number.isFinite(amount) || amount < lot.min) {
    sfx.error();
    toast(`Enchère minimale : ${money(lot.min)}`);
    return;
  }
  if ((state?.coins ?? 0) < amount) {
    sfx.error();
    toast(`Il vous manque ${money(amount - (state?.coins ?? 0))} pièces`);
    return;
  }
  net.send({ t: 'bid', amount: Math.floor(amount) });
  sfx.coin(1);
}
['bid1', 'bid2', 'bid3'].forEach((id, i) => ($(id).onclick = () => placeBid(bidAmounts()[i])));
$('bidGo').onclick = () => {
  const raw = $<HTMLInputElement>('bidCustom').value.replace(/[\s  ]/g, '').replace(/k$/i, '000').replace(/m$/i, '000000');
  placeBid(Number(raw));
};
$('bidCustom').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('bidGo').click();
});

let hallUiKey = '';
let lastBidSeen = 0;
function renderHallUi(): void {
  const st = hall.state;
  if (!st || !state) return;
  const now = serverNow();
  const lot = st.lot;
  const me = state.id;
  const left = lot ? Math.max(0, lot.phaseEnd - now) : 0;
  const key = JSON.stringify([lot, st.sale?.id, st.next?.id, state.coins, state.escrow, Math.ceil(left / 1000)]);
  if (key === hallUiKey) return;
  hallUiKey = key;
  $('hallSale').textContent = st.sale ? `${st.sale.label} · lot ${(lot?.index ?? 0) + 1}/${st.sale.lots.length}` : st.next ? `${st.next.label} dans ${fmtDur(st.next.at - now)}` : 'Hôtel des ventes';
  $('lotCard').hidden = !lot;
  if (lot) {
    const wk = work(lot.workId);
    const rar = CATALOG.rarities[wk.rarity];
    $('lotTitle').textContent = wk.title;
    $('lotArtist').textContent = `${wk.artist}, ${wk.year}`;
    $('lotRarity').textContent = lot.frame === 'normal' ? rar.label : `${rar.label} · ${CATALOG.frames[lot.frame].label}`;
    $('lotRarity').style.color = lot.frame === 'normal' ? rar.color : '#ffd36b';
    $('lotEstimate').textContent = money(lot.estimate);
    $('lotIncome').textContent = `+${perSec(incomeOf(lot.workId, lot.frame))} pièces/s`;
  }
  const leading = lot?.leader?.id === me;
  $('bidPrice').textContent = lot ? money(lot.price) : '—';
  $('bidLeader').textContent = !lot ? '' : lot.leader ? (leading ? 'Vous menez !' : lot.leader.name) : 'Mise à prix';
  $('bidLeader').classList.toggle('me', leading);
  const total = lot?.phase === 'present' ? 5000 : 20000;
  $('bidTimer').style.width = lot && lot.phase !== 'sold' ? `${Math.min(100, (left / total) * 100)}%` : '0%';
  $('bidStatus').textContent = !lot
    ? st.next ? `Prochaine vente : ${st.next.label} dans ${fmtDur(st.next.at - now)}. Restez assis, elle commencera ici.` : 'Aucune vente prévue pour l’instant.'
    : lot.phase === 'present' ? `Présentation du lot… enchères dans ${Math.ceil(left / 1000)} s`
    : lot.phase === 'bidding' ? (leading ? 'Votre argent est bloqué tant que vous menez. Il revient si quelqu’un surenchérit.' : `Enchères ouvertes : ${Math.ceil(left / 1000)} s. Une enchère dans les 10 dernières secondes relance le chrono.`)
    : lot.outcome?.sold ? (lot.outcome.id === me ? '🔨 ADJUGÉ ! L’œuvre part dans votre musée.' : `🔨 Adjugé à ${lot.outcome.name} pour ${money(lot.outcome.price ?? 0)}`) : 'Invendu';
  const amounts = bidAmounts();
  const labels = ['+5 %', '+10 %', '+25 %'];
  ['bid1', 'bid2', 'bid3'].forEach((id, i) => {
    const b = $<HTMLButtonElement>(id);
    const a = amounts[i];
    b.innerHTML = a ? `${money(a)}<small>${lot?.leader ? labels[i] : i === 0 ? 'mise à prix' : labels[i]}</small>` : '—';
    b.disabled = !lot || lot.phase !== 'bidding' || leading || state!.coins < a;
  });
  $<HTMLButtonElement>('bidGo').disabled = !lot || lot.phase !== 'bidding' || leading;
  $('bidCoins').textContent = `Vos pièces : ${money(state.coins)}`;
  $('bidEscrow').textContent = state.escrow > 0 ? `Bloqué : ${money(state.escrow)}` : '';
}

function onSale(m: Extract<ServerMsg, { t: 'sale' }>): void {
  switch (m.phase) {
    case 'soon':
      toast(`🔨 ${m.label} dans ${fmtDur(m.at - serverNow())} : hôtel des ventes (bouton 🔨)`);
      break;
    case 'start':
      if (!hall.active) {
        sfx.rare();
        banner(`${m.label} : c’est parti !`, `${m.lots} lot${m.lots > 1 ? 's' : ''}, dont « ${work(m.workId).title} ». Bouton 🔨 pour rejoindre la salle.`);
      }
      break;
    case 'sold':
      if (m.winnerId === state?.id) break; // message « won »
      if (hall.active) sfx.coin(2);
      else if (m.sold) toast(`🔨 « ${work(m.workId).title} » adjugée ${money(m.price)} à ${m.winner}`);
      break;
    case 'end':
      if (hall.active) toast(`${m.label} terminée`);
      break;
  }
}

/** Bouton 🔨 : visible quand une vente est en cours ou commence dans moins de 15 minutes. */
liveBar.onStats((s) => {
  const now = s.serverTime;
  const soon = s.sales.some((x) => x.at > now && x.at - now < 15 * 60_000);
  $('saleBtn').hidden = !(s.liveSale || soon);
  $('saleBtn').title = s.liveSale ? `${s.liveSale.label} en direct : rejoindre la salle` : 'Une vente commence bientôt : rejoindre la salle';
});

// ================================================================== notifications (phase 4)

function pushSectionHtml(): string {
  if (!state) return '';
  const support = pushSupport();
  const on = state.push.devices > 0;
  const prefs = state.push.prefs;
  let html = `<h2>🔔 Alertes sur vos appareils <small class="${on ? '' : 'off'}">${on ? `${state.push.devices} appareil${state.push.devices > 1 ? 's' : ''}` : 'désactivées'}</small></h2>`;
  const why = support === 'install-ios' ? 'Sur iPhone, ajoutez d’abord le jeu à l’écran d’accueil (Partager → Sur l’écran d’accueil).'
    : support === 'denied' ? 'Notifications bloquées dans ce navigateur : autorisez-les dans ses réglages.'
    : support === 'unsupported' ? 'Ce navigateur ne gère pas les notifications.'
    : support === 'no-sw' ? 'Disponible dans la version installée du jeu (pas en mode développement).'
    : 'Soyez prévenu quand on vous cambriole, quand vos gardes partent ou qu’une grande vente commence. 6 alertes par jour au maximum, rien entre 22 h et 8 h.';
  html += `<div class="offer"><span class="t">${on ? 'Ajouter cet appareil' : 'Activer les notifications'}</span><button data-push="enable" ${support === 'ok' ? '' : 'disabled'}>${on ? 'Ajouter' : 'Activer'}</button><span class="d">${why}</span></div>`;
  if (on || prefs) {
    html += '<div class="offer" style="display:block">';
    for (const [k, label] of PUSH_CATEGORIES) {
      const checked = prefs ? prefs[k] : k !== 'theftAtNight';
      html += `<label style="display:flex;gap:10px;align-items:center;padding:4px 0;cursor:pointer"><input type="checkbox" data-pref="${k}" ${checked ? 'checked' : ''}/> ${label}</label>`;
    }
    html += '</div>';
  }
  return html;
}

async function turnOnPush(): Promise<void> {
  try {
    const s = await enablePush();
    applyState(s);
    sfx.expand();
    toast('🔔 Notifications activées sur cet appareil');
  } catch (e) {
    sfx.error();
    toast((e as Error).message);
  }
}

$('secBody').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-push]');
  if (b) void turnOnPush();
});
$('secBody').addEventListener('change', (e) => {
  const c = e.target as HTMLInputElement;
  if (!c.dataset.pref) return;
  void guarded(() => api.pushPrefs({ [c.dataset.pref!]: c.checked })).then((r) => r && applyState(r.state));
});

/** Après le premier achat : proposition d'activer les alertes (jamais au chargement de la page). */
function maybeAskPush(): void {
  if (!state || state.push.devices > 0 || pushSupport() !== 'ok') return;
  try {
    if (localStorage.getItem('sam-push-asked')) return;
    localStorage.setItem('sam-push-asked', '1');
  } catch {
    return;
  }
  $('pushAsk').hidden = false;
}
$('pushYes').onclick = () => {
  $('pushAsk').hidden = true;
  void turnOnPush();
};
$('pushNo').onclick = () => ($('pushAsk').hidden = true);

// ================================================================== serveur : synchro

const announced = new Set<number>();
async function refreshConvoy(): Promise<void> {
  try {
    const c = await api.getConvoy();
    offset = c.serverTime - Date.now();
    convoy.setItems(c.items, c.travelMs);
    const next = convoy.upcoming(serverNow());
    if (next && !announced.has(next.window)) {
      announced.add(next.window);
      const wk = work(next.workId);
      const tag = next.frame !== 'normal' ? CATALOG.frames[next.frame].label : CATALOG.rarities[next.rarity].label;
      toast(`${tag} en approche sur le convoi : ${wk.title} !`);
      sfx.rare();
    }
  } catch {
    /* réseau : nouvel essai au prochain tour */
  }
}

async function refreshState(): Promise<void> {
  if (busy) return;
  try {
    applyState(await api.getState());
  } catch {
    /* réseau */
  }
}

/** Les 4 classements : le panneau de la place les fait défiler, le bouton 🏆 les affiche en onglets. */
const BOARDS: Array<{ id: api.Board; title: string; tab: string; sub: string; empty: string }> = [
  { id: 'value', title: 'LES MUSÉES LES PLUS RICHES', tab: '💰 Plus riches', sub: 'valeur totale des collections · classement permanent', empty: 'Achetez votre première œuvre pour entrer au classement' },
  { id: 'weekly', title: 'CHAMPIONS DE LA SEMAINE', tab: '📅 Semaine', sub: 'valeur gagnée depuis lundi · remis à zéro chaque semaine', empty: 'La semaine commence : à vous de jouer !' },
  { id: 'theft', title: 'LES PLUS GROS CASSES', tab: '🦹 Casses', sub: 'valeur de la plus belle œuvre volée', empty: 'Aucun casse réussi pour l’instant…' },
  { id: 'auction', title: 'LES PLUS GROSSES ENCHÈRES', tab: '🔨 Enchères', sub: 'plus gros prix payé à l’hôtel des ventes', empty: 'Aucune enchère remportée pour l’instant' },
  { id: 'countries', title: 'CLASSEMENT PAR PAYS', tab: '🌍 Nations', sub: 'valeur cumulée des musées par nation', empty: 'Aucun pays classé pour l’instant' },
];
let boardTurn = 0;
async function refreshBoard(): Promise<void> {
  const b = BOARDS[boardTurn++ % BOARDS.length];
  try {
    district.setLeaderboard(await api.leaderboard(b.id), state?.name ?? '', b.title, b.sub, b.empty);
  } catch {
    /* réseau */
  }
}

let boardTab: api.Board = 'value';
let boardCountry = '';
const countryFilterEl = $<HTMLSelectElement>('boardCountryFilter');
if (countryFilterEl) {
  for (const c of CATALOG.countries ?? []) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = `${c.flag} ${c.name}`;
    countryFilterEl.appendChild(opt);
  }
  countryFilterEl.onchange = () => {
    boardCountry = countryFilterEl.value;
    void renderBoards();
  };
}

async function renderBoards(): Promise<void> {
  const b = BOARDS.find((x) => x.id === boardTab)!;
  $('boardTabs').innerHTML = BOARDS.map((x) => `<button data-board="${x.id}" class="${x.id === boardTab ? 'on' : ''}">${x.tab}</button>`).join('');
  $('boardSub').textContent = b.sub;
  if (countryFilterEl) {
    countryFilterEl.style.display = boardTab === 'countries' ? 'none' : '';
  }
  let rows: Awaited<ReturnType<typeof api.leaderboard>> = [];
  try {
    rows = await api.leaderboard(b.id, boardTab === 'countries' ? undefined : (boardCountry || undefined));
  } catch {
    $('boardList').innerHTML = '<li class="muted">Classement indisponible pour l’instant</li>';
    return;
  }
  const me = state?.name ?? '';
  $('boardList').innerHTML = rows.length
    ? rows.map((r, i) => `<li class="${r.name === me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm"></span><b>${money(r.value)}</b></li>`).join('')
    : `<li class="muted">${b.empty}</li>`;
  // noms des joueurs ou pays insérés avec leur drapeau
  $('boardList').querySelectorAll('.nm').forEach((el, i) => {
    const r = rows[i];
    el.textContent = r.flag ? `${r.flag} ${r.name}` : r.name;
  });
}
$('boardBtn').onclick = () => {
  $('boards').classList.add('open');
  input.enabled = false;
  void renderBoards();
};
$('boardTabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-board]');
  if (!b) return;
  boardTab = b.dataset.board as api.Board;
  void renderBoards();
});

// ================================================================== quartier multijoueur

/** Vol en cours côté joueur local. */
let stealing: { plot: number; uid: string; workId: string; endsAt: number; total: number } | null = null;
let carrying: { workId: string; frame: string } | null = null;
let carryPlot = -1; // musée d'où vient l'œuvre portée (lasers à la sortie)
let carryMesh: THREE.Mesh | null = null;
let jailUntil = 0;
let stealRequested = false;
let alarmUntil = 0;
let welcomed = false;
let stateRefreshTimer: number | undefined;
const refreshSoon = () => {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = window.setTimeout(() => void refreshState(), 250);
};

function setCarry(c: { workId: string; frame: string } | null): void {
  carrying = c;
  if (carryMesh) {
    carryMesh.removeFromParent();
    carryMesh.geometry.dispose();
    carryMesh = null;
  }
  if (c && player) {
    carryMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), new THREE.MeshBasicMaterial({ map: artTexture(c.workId), side: THREE.DoubleSide }));
    carryMesh.position.set(0, 2.45, 0);
    player.root.add(carryMesh);
  }
}

function alarm(on: boolean): void {
  alarmUntil = on ? performance.now() + 4000 : 0;
  if (on) sfx.alarm();
}

function applyPlot(info: PlotInfo): void {
  const v = views.get(info.index);
  if (!v) return;
  v.setLock(info.lockedUntil, info.lockReadyAt);
  v.setPower(info.jamUntil, info.powerAt, info.powerUntil);
  if (info.index === myPlot) {
    refreshSoon(); // notre musée a changé (vol, achat dans un autre onglet…) : l'état complet vient de l'API
    return;
  }
  v.setOwner(info.owner, info.online);
}

function onWelcome(m: Extract<ServerMsg, { t: 'welcome' }>): void {
  if (welcomed && m.you.plot !== myPlot) {
    location.reload(); // parcelle réattribuée après une longue coupure : on repart proprement
    return;
  }
  offset = m.now - Date.now();
  if (!welcomed) {
    welcomed = true;
    myPlot = m.you.plot;
    for (const plot of PLOTS) views.set(plot.index, new MuseumView(scene, plot, plot.index === myPlot));
    myView = views.get(myPlot)!;
    visitors.museum = myView;
    // apparition devant votre musée, caméra côté place
    const plot = PLOTS[myPlot];
    const s = spawnOf(plot);
    pos.copy(s);
    facing = plot.f === 1 ? Math.PI : 0;
    focus.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
    orbit.target.copy(focus);
    camera.position.set(s.x, 5.6, s.z - plot.f * 8.5);
    userDist = camera.position.distanceTo(focus);
    if (state) applyState(state);
  }
  for (const info of m.plots) applyPlot(info);
  remotes.sync(m.players, state?.id ?? '');
  guards.sync(m.guards ?? []);
  jailUntil = Math.max(jailUntil, m.you.jailUntil ?? 0);
  $('netStatus').hidden = true;
}

const ALARM_TEXT: Record<string, [string, string]> = {
  camera: ['📷 Caméra', 'décroche une œuvre'],
  laser: ['🔴 Laser', 'sort avec une œuvre'],
  sabotage: ['🔋 Sabotage', 'sabote votre générateur'],
};

function onAlarm(m: Extract<ServerMsg, { t: 'alarm' }>): void {
  const [tag, verb] = ALARM_TEXT[m.reason] ?? ['⚠ Alarme', 'est repéré'];
  if (m.plot === myPlot) {
    alarm(true);
    remotes.setWanted(m.thief, true);
    toast(`${tag} : ${m.thiefName} ${verb} dans votre musée !`);
  } else if (m.thief === state?.id) {
    sfx.error();
    const lines: Record<string, string> = {
      camera: 'Repéré par une caméra ! Les gardes accourent',
      laser: 'Vous avez coupé un laser : alarme !',
      sabotage: 'Le sabotage fait du bruit : on vous entend !',
    };
    toast(`${tag} — ${lines[m.reason] ?? 'Alarme !'}`);
  }
}

function onTool(m: Extract<ServerMsg, { t: 'tool' }>): void {
  if (!m.ok) {
    sfx.error();
    toast(m.error ?? 'Impossible');
    return;
  }
  sfx.whoosh();
  toast(`${CATALOG.tools[m.tool as ToolId]?.icon ?? ''} ${m.message}`);
  if (m.tool === 'pied') crowbarArmed = true;
  if (state && m.tools) state.tools = m.tools as PlayerState['tools'];
  toolbarKey = '';
  renderToolbar();
  refreshSoon();
}

function onSteal(m: Extract<ServerMsg, { t: 'steal' }>): void {
  const me = state?.id;
  const title = 'workId' in m ? work(m.workId).title : '';
  switch (m.phase) {
    case 'refused':
      stealing = null;
      sfx.error();
      toast(m.error);
      break;
    case 'start':
      // sans caméra, le propriétaire n'est pas prévenu : c'est l'alarme (message « alarm ») qui le réveille
      if (m.thief === me) {
        stealing = { plot: m.plot, uid: m.uid, workId: m.workId, endsAt: m.endsAt, total: m.ms };
        if (m.crowbar) {
          crowbarArmed = false;
          renderToolbar();
        }
      }
      break;
    case 'caught':
      remotes.setWanted(m.thief, false);
      if (m.thief === me) {
        stealing = null;
        stealRequested = false;
        jailUntil = m.jailUntil;
        sfx.error();
        banner('Attrapé par un garde !', `${Math.round((m.jailUntil - serverNow()) / 1000)} s en cellule. Guettez son cône de vision la prochaine fois.`);
      } else if (m.plot === myPlot) {
        alarm(false);
        sfx.coin(2);
        banner('Vos gardes veillent', `${m.thiefName} a été attrapé et jeté en cellule`);
        refreshSoon();
      } else toast(`👮 Les gardes ont attrapé ${m.thiefName}`);
      break;
    case 'cancel':
      if (m.thief === me) stealing = null;
      if (m.plot === myPlot) remotes.setWanted(m.thief, false);
      break;
    case 'carry':
      if (m.thief === me) {
        stealing = null;
        carryPlot = m.plot;
        setCarry({ workId: m.workId, frame: m.frame });
        sfx.rare();
        banner('Vous l’avez !', 'Ramenez-la dans votre musée sans vous faire toucher par le propriétaire ni par un garde');
      } else if (m.plot === myPlot) {
        // l'œuvre disparaît du mur : on le voit, mais sans caméra la sirène ne sonne pas
        remotes.setWanted(m.thief, true);
        refreshSoon();
        banner('Au voleur !', `${m.thiefName} s’enfuit avec « ${title} » : touchez-le pour l’arrêter`);
      }
      break;
    case 'delivered':
      remotes.setWanted(m.thief, false);
      if (m.thief === me) {
        setCarry(null);
        sfx.expand();
        player?.gesture('Wave', 'Idle');
        banner('Casse réussi !', `« ${title} » est maintenant dans votre musée`);
        refreshSoon();
      } else if (m.plot === myPlot) {
        alarm(false);
        sfx.error();
        banner('On vous a volé…', m.refund > 0 ? `${m.thiefName} est reparti avec « ${title} ». Assurance : +${money(m.refund)} pièces` : `${m.thiefName} est reparti avec « ${title} ». Protégez-vous : G`);
        refreshSoon();
      } else toast(`${m.thiefName} a volé « ${title} » au ${m.victimName}`);
      break;
    case 'arrested':
      remotes.setWanted(m.thief, false);
      if (m.thief === me) {
        setCarry(null);
        jailUntil = m.jailUntil;
        sfx.error();
        banner(m.by === 'guard' ? 'Arrêté par un garde !' : 'Arrêté !', `Amende de ${money(m.fine)} pièces · 60 s en cellule`);
        refreshSoon();
      } else if (m.by === 'guard' && m.plot === myPlot) {
        alarm(false);
        sfx.coin(4);
        banner('Vos gardes ont arrêté le voleur !', `« ${title} » est revenue · +${money(m.fine)} pièces d’amende`);
        refreshSoon();
      } else if (m.by === me) {
        alarm(false);
        sfx.coin(4);
        player?.gesture('Punch', 'Idle');
        if (m.bounty) banner('Prime de chasseur !', `Vous avez sauvé « ${title} » · +${money(m.bounty)} pièces de prime`);
        else banner('Voleur arrêté !', `« ${title} » est revenue · +${money(m.fine)} pièces d’amende`);
        refreshSoon();
      } else toast(`${m.byName} a arrêté ${m.thiefName} !`);
      break;
    case 'returned':
      remotes.setWanted(m.thief, false);
      if (m.thief === me) {
        setCarry(null);
        toast(m.message);
      }
      if (m.plot === myPlot) {
        toast(`« ${title} » est revenue dans votre musée`);
        refreshSoon();
      }
      break;
  }
}

net.onMessage = (m) => {
  switch (m.t) {
    case 'welcome': onWelcome(m); break;
    case 'snap':
      offset = m.now - Date.now();
      remotes.sync(m.players, state?.id ?? '');
      guards.sync(m.guards ?? []);
      break;
    case 'alarm': onAlarm(m); break;
    case 'hall':
      if (!hall.active) break;
      hall.apply(m);
      offset = m.now - Date.now();
      // une enchère vient de bloquer ou de libérer de l'argent : le porte-monnaie est relu
      if (m.lot?.lastBid && m.lot.lastBid.at !== lastBidSeen) {
        lastBidSeen = m.lot.lastBid.at;
        refreshSoon();
      }
      renderHallUi();
      break;
    case 'hall-error':
      sfx.error();
      toast(m.error);
      break;
    case 'won':
      sfx.expand();
      banner('Adjugé !', `« ${work(m.workId).title} » est à vous pour ${money(m.price)} pièces : direction votre musée`);
      refreshSoon();
      break;
    case 'sale': onSale(m); break;
    case 'mythic': {
      const title = work(m.workId).title;
      if (m.phase === 'start' && m.thief !== state?.id) {
        sfx.alarm();
        banner(`« ${title} » est en train d’être volée !`, `${m.thiefName} cambriole le ${m.victimName}. Touchez-le pour l’arrêter : prime de 1 % de sa valeur !`);
      } else if (m.phase === 'saved') toast(`🏆 ${m.byName} a sauvé « ${title} » et empoche ${money(m.bounty)} de prime`);
      else if (m.phase === 'stolen') toast(`😱 ${m.thiefName} a volé « ${title} » au ${m.victimName}`);
      break;
    }
    case 'ticket':
      if (m.ok) toast(`🎟 Billet d’entrée au ${m.name} : −${money(m.price)} pièces`);
      else {
        sfx.error();
        toast(`🎟 Entrée refusée : le billet coûte ${money(m.price)} pièces`);
      }
      refreshSoon();
      break;
    case 'visitor':
      toast(`🎟 ${m.name} visite votre musée : +${money(m.price)} pièces`);
      refreshSoon();
      break;
    case 'tool': onTool(m); break;
    case 'fx': spawnFx(m.kind, m.x, m.z, m.until); break;
    case 'join':
      if (m.player.id !== state?.id) toast(`${m.player.name} entre dans le quartier`);
      break;
    case 'leave': remotes.remove(m.id); break;
    case 'plot': applyPlot(m.plot); break;
    case 'lock':
      views.get(m.plot)?.setLock(m.lockedUntil, m.lockReadyAt);
      if (m.error) toast(m.error);
      else if (m.plot === myPlot) {
        sfx.expand();
        toast('Portes verrouillées pour 60 s');
      }
      break;
    case 'teleport':
      pos.set(m.x, 0, m.z);
      if (m.f !== undefined) floor = m.f;
      break;
    case 'kicked':
      banner('Partie ouverte ailleurs', m.reason);
      playing = false;
      break;
    case 'steal': onSteal(m); break;
    default: break;
  }
};
net.onStatus = (ok) => {
  $('netStatus').hidden = ok;
};

// position envoyée 10 fois par seconde
setInterval(() => {
  if (!playing || !net.connected) return;
  const sp = vel.length();
  net.send({ t: 'pos', x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100, f: floor, ry: Math.round(facing * 100) / 100, anim: pos.y > 0.05 ? 'Jump' : sp > 5.6 ? 'Running' : sp > 0.3 ? 'Walking' : 'Idle' });
}, 100);

// ================================================================== démarrage

async function start(name?: string, color?: string, country?: string, pre?: Awaited<ReturnType<typeof api.login>>): Promise<void> {
  let r: Awaited<ReturnType<typeof api.login>>;
  try {
    r = pre ?? (await api.login(name, color, country));
  } catch (e) {
    toast(`Connexion impossible : ${(e as Error).message}. Nouvel essai…`);
    setTimeout(() => void start(name, color), 4000);
    return;
  }
  applyState(r.state);
  // entrée dans un quartier multijoueur (le serveur attribue la parcelle)
  net.connect();
  for (let i = 0; i < 100 && !welcomed; i++) await new Promise((res) => setTimeout(res, 100));
  if (!welcomed) toast('Connexion au quartier impossible pour l’instant : nouvel essai automatique…');
  await refreshConvoy();
  void refreshBoard();
  playing = true;
  document.body.classList.add('playing');
  const inbox = r.inbox ?? [];
  const stolen = inbox.filter((i): i is Extract<InboxItem, { type: 'stolen' }> => i.type === 'stolen');
  const caught = inbox.filter((i): i is Extract<InboxItem, { type: 'caught' }> => i.type === 'caught');
  const attempts = inbox.filter((i) => i.type === 'attempt');
  const defended = [
    caught.length ? `${caught.length} voleur${caught.length > 1 ? 's' : ''} arrêté${caught.length > 1 ? 's' : ''} par vos gardes (+${money(caught.reduce((s, c) => s + c.fine, 0))})` : '',
    attempts.length ? `${attempts.length} tentative${attempts.length > 1 ? 's' : ''} repérée${attempts.length > 1 ? 's' : ''} par l’alarme` : '',
  ].filter(Boolean).join(' · ');
  if (stolen.length) {
    sfx.error();
    const refund = stolen.reduce((s, x) => s + (x.refund ?? 0), 0);
    banner(
      stolen.length === 1 ? 'Cambriolé pendant votre absence !' : `${stolen.length} vols pendant votre absence !`,
      [stolen.map((s) => `« ${work(s.workId).title} » par ${s.by}`).join(' · '), refund ? `assurance +${money(refund)}` : '', defended].filter(Boolean).join(' · '),
    );
  } else if (defended) {
    sfx.coin(3);
    banner('Votre musée a tenu bon !', defended);
  } else if (r.created) banner('Bienvenue dans le quartier !', 'Approchez-vous d’un camion du convoi et appuyez sur E pour acheter');
  else if (r.offlineGain > 0) banner('Bon retour !', `Votre caisse a gagné ${money(r.offlineGain)} pièces en votre absence`);
  else banner(`Bon retour, ${r.state.name}`);
  setInterval(() => void refreshConvoy(), 5000);
  setInterval(() => void refreshState(), 15000);
  setInterval(() => void refreshBoard(), 10000);
}

// Choix de la couleur du personnage
let chosenColor = CATALOG.colors[0];
const colorsEl = $('colors');
for (const c of CATALOG.colors) {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.background = c;
  b.dataset.c = c;
  b.title = 'Choisir cette couleur';
  b.onclick = () => markColor(c);
  colorsEl.appendChild(b);
}
function markColor(c: string): void {
  chosenColor = c;
  colorsEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
}

// Choix du pays du joueur
let chosenCountry = (CATALOG.countries && CATALOG.countries[0]?.code) || 'FR';
const countriesEl = $('countries');
if (countriesEl && CATALOG.countries) {
  for (const c of CATALOG.countries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.flag;
    b.dataset.c = c.code;
    b.title = c.name;
    b.style.fontSize = '20px';
    b.onclick = () => markCountry(c.code);
    countriesEl.appendChild(b);
  }
}
function markCountry(c: string): void {
  chosenCountry = c;
  countriesEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
}

function openNameSheet(rename: boolean): void {
  markColor(rename && state ? state.color : CATALOG.colors[0]);
  markCountry(rename && state ? (state.country ?? 'FR') : 'FR');
  const sheet = $('welcome');
  sheet.querySelector('h1')!.textContent = rename ? 'Renommer votre musée' : 'Votre musée vous attend';
  (sheet.querySelector('p') as HTMLElement).hidden = rename;
  sheet.querySelector<HTMLButtonElement>('.go')!.textContent = rename ? 'Valider' : 'Ouvrir mon musée';
  $<HTMLInputElement>('nameInput').value = rename ? state?.name ?? '' : '';
  sheet.dataset.mode = rename ? 'rename' : 'new';
  sheet.classList.add('open');
  void mountGoogle(rename);
  input.enabled = false;
  setTimeout(() => $<HTMLInputElement>('nameInput').focus(), 50);
}

$('welcomeForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>('nameInput').value.trim();
  const sheet = $('welcome');
  if (sheet.dataset.mode === 'rename') {
    const r = await guarded(() => api.rename(name, chosenColor, chosenCountry));
    if (!r) return;
    applyState(r.state);
    void refreshBoard();
  } else {
    if (name && (name.length < 2 || name.length > 24)) return toast('Le nom doit faire de 2 à 24 caractères');
    void start(name || undefined, chosenColor, chosenCountry);
  }
  sheet.classList.remove('open');
  input.enabled = true;
};
$('renameBtn').onclick = () => openNameSheet(true);

/**
 * Compte Google (si le serveur est configuré) : à la création, retrouver un musée existant ;
 * en renommant, lier le musée à Google pour ne jamais le perdre.
 */
async function mountGoogle(rename: boolean): Promise<void> {
  const wrap = $('googleWrap');
  wrap.hidden = true;
  if (rename && state?.google) {
    $('googleLbl').textContent = '✓ Musée lié à votre compte Google';
    $('googleBox').innerHTML = '';
    wrap.hidden = false;
    return;
  }
  $('googleLbl').textContent = rename ? 'Sauvegarder votre musée avec Google (pour le retrouver sur un autre appareil)' : 'Déjà un musée sur un autre appareil ?';
  const ok = await mountGoogleButton($('googleBox'), (credential) => {
    void (async () => {
      try {
        if (rename) {
          const r = await api.linkGoogle(credential);
          applyState(r.state);
          sfx.expand();
          toast('✓ Musée lié à votre compte Google');
          void mountGoogle(true);
        } else {
          const r = await api.loginGoogle(credential);
          $('welcome').classList.remove('open');
          input.enabled = true;
          void start(undefined, undefined, undefined, r);
        }
      } catch (e) {
        sfx.error();
        toast((e as Error).message);
      }
    })();
  }, rename ? 'continue_with' : 'signin_with');
  wrap.hidden = !ok;
}

async function boot(): Promise<void> {
  try {
    await loadCharacterModel('/models/robot.glb');
  } catch {
    $('loading').textContent = 'Impossible de charger le personnage. Vérifiez votre connexion et rechargez la page.';
    return;
  }
  player = new Character();
  player.root.position.copy(pos);
  scene.add(player.root);
  $('loading').remove();
  if (api.hasSavedSession()) void start();
  else openNameSheet(false);
}

// ================================================================== joueur & interactions

const RADIUS = 0.38;
const fwd = new THREE.Vector3();

/** Obstacles de tous les musées (y compris les lasers des musées verrouillés), recalculés à chaque image. */
let frameBoxes: Box[] = [];
let frameCircles: Circle[] = [];
function gatherColliders(): void {
  const now = serverNow();
  frameBoxes = [];
  frameCircles = [];
  // à l'étage, seuls comptent les murs de cet étage du musée où l'on se trouve
  const here = floor > 0 ? viewAt() : null;
  for (const v of here ? [here] : views.values()) {
    const c = v.colliders(v === myView, now, floor);
    frameBoxes.push(...c.boxes);
    frameCircles.push(...c.circles);
  }
}

function canMove(x: number, z: number): boolean {
  return !district.blocked(x, z, RADIUS, frameBoxes, frameCircles);
}

function updatePlayer(dt: number): void {
  if (!player) return;
  const a = input.axis();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const dx = -fwd.z * a.x + fwd.x * a.y;
  const dz = fwd.x * a.x + fwd.z * a.y;
  const mag = Math.min(1, Math.hypot(dx, dz));
  // Déplacement réactif style Roblox : réponse nette aux touches et arrêt franc
  const speed = (input.running() ? 8.0 : 4.8) * (carrying ? 0.72 : 1) * (stealing ? 0 : 1);
  const responsiveness = mag > 0.05 ? 26 : 18;
  const k = 1 - Math.exp(-responsiveness * dt);
  vel.x += ((mag > 0.05 ? (dx / mag) * speed * mag : 0) - vel.x) * k;
  vel.y += ((mag > 0.05 ? (dz / mag) * speed * mag : 0) - vel.y) * k;

  const nx = pos.x + vel.x * dt;
  const nz = pos.z + vel.y * dt;
  if (canMove(nx, nz)) {
    pos.x = nx;
    pos.z = nz;
  } else if (canMove(nx, pos.z)) {
    pos.x = nx;
    vel.y = 0;
  } else if (canMove(pos.x, nz)) {
    pos.z = nz;
    vel.x = 0;
  } else vel.set(0, 0);

  if (input.consume('jump') && pos.y <= 0.001) {
    vy = 6.8;
    sfx.jump();
    player.gesture('Jump', 'Idle');
  }
  vy -= 20 * dt;
  pos.y = Math.max(0, pos.y + vy * dt);
  if (pos.y === 0) vy = 0;

  const sp = vel.length();
  if (sp > 0.25) {
    // Orientation rapide et nette vers la direction de course
    const want = Math.atan2(vel.x, vel.y);
    let d = want - facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    facing += d * Math.min(1, dt * 20);
  }
  player.play(sp > 5.8 ? 'Running' : sp > 0.25 ? 'Walking' : 'Idle');
  player.root.position.copy(pos);
  player.root.position.y += floor * FLOOR_H;
  player.root.rotation.y = facing;
}

/** Escalier : E pour monter, R pour descendre (le serveur vérifie qu'on est bien au pied de l'escalier). */
function stairsInteraction(items: Array<{ key: string; text: string; poor?: boolean }>): boolean {
  const v = viewAt();
  if (!v || !v.nearStairs(pos) || stealing) return false;
  const name = (f: number) => (f === 0 ? 'au rez-de-chaussée' : f === 1 ? 'au 1er étage' : f === 3 ? 'sur le toit-terrasse' : `au ${f}e étage`);
  const up = floor + 1 < v.floors;
  const down = floor > 0;
  if (up) items.push({ key: 'E', text: `Monter ${name(floor + 1)}` });
  if (down) items.push({ key: up ? 'R' : 'E', text: `Descendre ${name(floor - 1)}` });
  const goUp = up && input.consume('action');
  const goDown = down && (up ? input.consume('alt') : input.consume('action'));
  if (goUp || goDown) {
    floor += goUp ? 1 : -1;
    sfx.whoosh();
    net.send({ t: 'pos', x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100, f: floor, ry: Math.round(facing * 100) / 100, anim: 'Idle' });
    toast(`Vous êtes ${name(floor)}`);
  }
  return true;
}

/** Ce qui protège un musée rival, vu du client (le serveur tranche de toute façon). */
function protection(v: MuseumView, now: number): string | null {
  const o = v.owner;
  if (!o || !state) return 'Rien à voler ici';
  if (o.shielded) return 'Protégé : bouclier débutant';
  if (o.immuneUntil > now) return `Protégé encore ${Math.ceil((o.immuneUntil - now) / 60_000)} min (déjà cambriolé)`;
  if (o.value < state.value * 0.5) return 'Cible trop modeste pour vous';
  return null;
}

/** Vol : maintenir E devant une œuvre d'un musée rival. Renvoie true si une invite de vol est affichée. */
function theftInteractions(items: Array<{ key: string; text: string; poor?: boolean }>): boolean {
  const now = serverNow();
  if (carrying) {
    const home = myView ? spawnOf(myView.plot) : pos;
    items.push({ key: '⇢', text: `Ramenez « ${work(carrying.workId).title} » dans votre musée ! (${Math.round(pos.distanceTo(home))} m)` });
    const src = views.get(carryPlot);
    if (src?.contains(pos, floor) && src.lasersOn(now)) items.push({ key: '🔴', text: 'Lasers à la sortie : alarme si vous passez (pince à câbles : 5)', poor: true });
    return true;
  }
  if (stealing) {
    const total = stealing.total || (STEAL_TIME[work(stealing.workId).rarity] ?? 3) * 1000;
    const left = Math.max(0, stealing.endsAt - now);
    items.push({ key: 'E', text: `Décrochage… ${Math.round(100 - (left / total) * 100)} % — ne lâchez pas !` });
    if (!input.holdingAction()) {
      net.send({ t: 'steal-cancel' });
      stealing = null;
      stealRequested = false;
    }
    return true;
  }
  if (!input.holdingAction()) stealRequested = false;
  const rival = [...views.values()].find((v) => v !== myView && v.contains(pos, floor));
  if (!rival) return false;
  const art = rival.nearestArtwork(pos, 1.8, floor);
  if (!art) return false;
  const wk = work(art.workId);
  if (art.repro) {
    items.push({ key: '🖼', text: `« ${wk.title} » : une reproduction sans valeur`, poor: true });
    return true;
  }
  if (jailUntil > now) {
    items.push({ key: '⛓', text: `En cellule encore ${Math.ceil((jailUntil - now) / 1000)} s` });
    return true;
  }
  const blocked = protection(rival, now);
  if (blocked) {
    items.push({ key: '🛡', text: `« ${wk.title} » : ${blocked}`, poor: true });
    return true;
  }
  const vit = rival.vitrineMult(art.slot);
  const secs = ((STEAL_TIME[wk.rarity] ?? 3) * vit) / (crowbarArmed ? 2 : 1);
  const extra = [vit > 1 ? `vitrine ×${vit}` : '', crowbarArmed ? 'pied-de-biche' : ''].filter(Boolean).join(', ');
  items.push({ key: 'E', text: `Maintenez pour voler « ${wk.title} » (${Math.round(secs * 10) / 10} s${extra ? `, ${extra}` : ''}) — ${CATALOG.rarities[wk.rarity].label}` });
  if (rival.camerasOn(now)) items.push({ key: '📷', text: 'Caméras : le décrochage déclenchera l’alarme (brouilleur : 1)', poor: true });
  if (input.holdingAction() && !stealRequested && net.connected) {
    stealRequested = true;
    net.send({ t: 'steal', plot: rival.plot.index, uid: art.uid });
  }
  return true;
}

const STEAL_TIME: Record<string, number> = { commun: 2.5, rare: 4, epique: 6, legendaire: 9, mythique: 20 };

let lastCollect = 0;
function interactions(): void {
  if (!state || busy || !myView) return;
  const museum = myView;
  const items: Array<{ key: string; text: string; poor?: boolean }> = [];
  // escalier d'abord (on peut le prendre avec une œuvre volée sous le bras)
  if (stairsInteraction(items)) {
    if (carrying) theftInteractions(items);
    setPrompt(items);
    return;
  }
  if (theftInteractions(items)) {
    setPrompt(items);
    return;
  }
  const ground = floor === 0; // caisse, panneau et verrou sont au rez-de-chaussée
  const truck = ground ? convoy.nearest(pos, 5.2) : null; // atteignable depuis le trottoir
  const signD = ground ? pos.distanceTo(museum.signPos) : Infinity;
  const lockD = ground ? Math.hypot(pos.x - museum.lockPos.x, pos.z - museum.lockPos.z) : Infinity;
  const regD = ground ? Math.hypot(pos.x - museum.registerPos.x, pos.z - museum.registerPos.z) : Infinity;
  const art = !truck && signD > 1.6 && lockD > 1.2 && museum.contains(pos, floor) ? museum.nearestArtwork(pos, 1.6, floor) : null;
  const now = serverNow();
  const marketD = Math.hypot(pos.x - BLACK_MARKET.x, pos.z - BLACK_MARKET.z);

  const hallD = Math.hypot(pos.x - AUCTION_DOOR.x, pos.z - AUCTION_DOOR.z);

  if (hallD < 3.2) {
    items.push({ key: 'E', text: 'Entrer dans l’hôtel des ventes (enchères)' });
    if (input.consume('action')) enterHall();
  } else if (marketD < 2.8) {
    items.push({ key: 'E', text: 'Marché noir : brouilleur, fumigène, pied-de-biche, leurre, pince' });
    if (input.consume('action')) openOverlay('market');
  } else if (lockD < 1.2) {
    if (museum.isLocked(now)) items.push({ key: '🔒', text: `Portes verrouillées encore ${Math.ceil((museum.lockedUntil - now) / 1000)} s` });
    else if (now < museum.lockReadyAt) items.push({ key: '…', text: `Verrou en recharge : ${Math.ceil((museum.lockReadyAt - now) / 1000)} s` });
    else {
      items.push({ key: 'E', text: 'Verrouiller les portes 60 s (personne ne peut entrer ni sortir)' });
      if (input.consume('action')) net.send({ t: 'lock' });
    }
  } else if (truck) {
    const wk = work(truck.item.workId);
    items.push({ key: 'E', text: `Acheter « ${wk.title} » — ${money(truck.item.price)}`, poor: state.coins < truck.item.price });
    if (input.consume('action')) void doBuy(truck.item, truck.truck.artworkWorld());
  } else if (signD < 1.6) {
    if (state.next) {
      items.push({ key: 'E', text: `Agrandir : ${state.next.rooms} salles, ${state.next.slots} places — ${money(state.next.cost)}`, poor: state.coins < state.next.cost });
      if (input.consume('action')) void doExpand();
    } else items.push({ key: '✓', text: 'Votre musée est au maximum de cette version' });
  } else if (reorgSelected) {
    const nearSlot = museum.nearestSlot(pos, 2.0, floor, state.slots);
    if (nearSlot !== null && nearSlot !== reorgSelected.slot) {
      const occupant = state.artworks.find((a) => a.slot === nearSlot);
      if (occupant) {
        items.push({ key: 'E', text: `Échanger « ${work(reorgSelected.workId).title} » avec « ${work(occupant.workId).title} »` });
      } else {
        items.push({ key: 'E', text: `Poser « ${work(reorgSelected.workId).title} » ici` });
      }
      if (input.consume('action')) void doMove(reorgSelected.uid, nearSlot);
    } else {
      items.push({ key: '…', text: `Déplacement de « ${work(reorgSelected.workId).title} » : approchez-vous d’un emplacement` });
    }
    items.push({ key: 'Échap', text: 'Annuler le déplacement' });
  } else if (art) {
    const gain = art.repro ? 0 : Math.floor(work(art.workId).price * CATALOG.frames[art.frame].mult * 0.5);
    items.push({ key: 'E', text: `Déplacer « ${work(art.workId).title} » (réorganiser)` });
    items.push({ key: 'R', text: art.repro ? `Retirer la reproduction « ${work(art.workId).title} »` : `Revendre « ${work(art.workId).title} » : +${money(gain)}` });
    if (input.consume('action')) {
      reorgSelected = { uid: art.uid, workId: art.workId, slot: art.slot };
      toast(`« ${work(art.workId).title} » sélectionnée. Approchez-vous d’un autre emplacement et appuyez sur E.`);
    } else if (input.consume('alt')) void doSell(art.uid);
  } else {
    const currentRoom = museum.contains(pos, floor) ? museum.roomIndexOf(pos, floor) : null;
    if (currentRoom !== null) {
      items.push({ key: 'T', text: `Décor de la salle #${currentRoom + 1} (ambiance)` });
      if (input.consume('alt')) {
        decorRoomIndex = currentRoom;
        openOverlay('decor');
      }
    }
  }

  // Caisse : encaissement automatique en marchant sur le cercle doré
  if (regD < 1.1) {
    if (cashNow() >= 1 && performance.now() - lastCollect > 1200) {
      lastCollect = performance.now();
      void doCollect();
    } else if (cashNow() < 1) items.push({ key: '…', text: 'La caisse se remplit avec les visites de vos œuvres' });
  }
  setPrompt(items);
}

// ================================================================== caméra

// Au départ, la caméra est côté route et regarde le joueur avec son musée derrière lui (recalée à l'accueil du serveur).
const focus = pos.clone().add(new THREE.Vector3(0, 1.5, 0));
camera.position.set(pos.x, 5.6, pos.z - 8.5);
orbit.target.copy(focus);

/**
 * Caméra à la 3e personne qui ne passe pas à travers les murs : on garde la distance choisie par le joueur
 * (`userDist`), et si un mur s'interpose on rapproche la caméra juste devant lui, le temps qu'il gêne.
 */
let userDist = camera.position.distanceTo(focus);
const camRay = new THREE.Raycaster();
const camDir = new THREE.Vector3();

function updateCamera(dt: number): void {
  const target = pos.clone().add(new THREE.Vector3(0, 1.5 + floor * FLOOR_H, 0));
  focus.lerp(target, 1 - Math.exp(-10 * dt));
  const delta = focus.clone().sub(orbit.target);
  orbit.target.add(delta);
  camera.position.add(delta);
  // Dans un musée (sans toit), la caméra monte pour regarder par-dessus les murs ; dehors, elle redescend.
  const inside = !!viewAt();
  orbit.maxPolarAngle += ((inside ? 0.72 : 1.32) - orbit.maxPolarAngle) * (1 - Math.exp(-3 * dt));
  userDist += ((inside ? Math.max(userDist, 13) : userDist) - userDist) * (1 - Math.exp(-2 * dt));
  // 1. revenir à la distance voulue, 2. appliquer rotation / zoom de l'utilisateur, 3. mémoriser la distance
  camDir.copy(camera.position).sub(orbit.target).normalize();
  camera.position.copy(orbit.target).addScaledVector(camDir, userDist);
  orbit.update();
  userDist = camera.position.distanceTo(orbit.target);
  // 4. collision avec les murs
  camDir.copy(camera.position).sub(orbit.target).normalize();
  camRay.set(orbit.target, camDir);
  camRay.far = userDist;
  const occ: THREE.Object3D[] = [...district.occluders];
  for (const v of views.values()) if (v.plot.x === undefined || Math.abs(v.plot.x - pos.x) < 40) occ.push(...v.occluders);
  const hit = camRay.intersectObjects(occ, false)[0];
  if (hit) camera.position.copy(orbit.target).addScaledVector(camDir, Math.max(0.3, hit.distance - 0.3));
  sun.position.copy(focus).add(new THREE.Vector3(26, 42, 14));
  sun.target.position.copy(focus);
}

// ================================================================== boucle

const clock = new THREE.Clock();
/**
 * Performance mobile : si le jeu tourne sous 26 images/s en qualité haute, on passe en Éco
 * (une seule fois, et seulement si le joueur n'a pas choisi lui-même).
 */
const fpsProbe = { frames: 0, since: 0, done: savedQuality() !== null };
function probeFps(): void {
  if (fpsProbe.done || !playing || hall.active) return;
  const now = performance.now();
  if (!fpsProbe.since) fpsProbe.since = now + 3000; // on laisse le jeu se charger
  if (now < fpsProbe.since) return;
  fpsProbe.frames++;
  const elapsed = now - fpsProbe.since;
  if (elapsed < 5000) return;
  fpsProbe.done = true;
  const fps = (fpsProbe.frames * 1000) / elapsed;
  if (quality === 'high' && fps < 26) {
    quality = 'low';
    applyQuality();
    toast(`Mode Éco activé pour la fluidité (${Math.round(fps)} images/s). Bouton HD pour revenir.`);
  }
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.066);
  const t = clock.elapsedTime;
  probeFps();
  const now = serverNow();
  if (hall.active) {
    // salle des ventes : une scène à part, le quartier continue de vivre sans être dessiné
    hall.update(dt, t, now);
    renderHallUi();
    if (Math.floor(t) !== Math.floor(t - dt)) renderTimers();
    input.endFrame();
    renderer.render(hall.scene, hall.camera);
    return;
  }
  if (playing) {
    gatherColliders();
    updatePlayer(dt);
    interactions();
  }
  player?.update(dt);
  if (carryMesh) carryMesh.rotation.y = Math.sin(t * 2) * 0.2;
  convoy.update(now);
  // étages : on masque ceux au-dessus du joueur, dans le musée où il se trouve
  const here = viewAt();
  for (const v of views.values()) v.setCut(v === here ? floor : 99);
  for (const v of views.values()) v.update(t, dt, now, camera.position);
  if (state && myView) myView.setRegister(cashNow(), state.cashCap, t);
  visitors.update(dt);
  remotes.update(dt, t);
  guards.update(dt, t);
  updateFx(t);
  district.update(t);
  const alarmOn = performance.now() < alarmUntil;
  $('alert').classList.toggle('on', alarmOn);
  if (state && Math.floor(t) !== Math.floor(t - dt)) {
    renderHud();
    renderTimers();
  }
  updateCoins(dt);
  updateCamera(dt);
  input.endFrame();
  renderer.render(scene, camera);
});

// Accès de test (jamais inclus dans le build de production)
if (false as boolean) {
  (window as unknown as Record<string, unknown>).__game = {
    get state() { return state; },
    get pos() { return pos.clone(); },
    get visitors() { return visitors.count; },
    get serverNow() { return serverNow(); },
    get busy() { return busy; },
    get prompt() { return $('prompt').textContent; },
    teleport(x: number, z: number) { pos.set(x, 0, z); focus.copy(pos); },
    get floor() { return floor; },
    scene,
    get renderInfo() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
    get museum() { return myView; },
    views,
    convoy,
    net,
    get myPlot() { return myPlot; },
    get remotes() { return remotes.count; },
    get stealing() { return stealing; },
    get carrying() { return carrying; },
    guards,
    get jailUntil() { return jailUntil; },
    openOverlay,
    hall,
    enterHall,
    leaveHall,
  };
}

void boot();
