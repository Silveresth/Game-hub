import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mountLiveBar, setupPwa } from '../shared/live';
import * as api from './api';
import type { ConvoyEvent, ConvoyItem, GuardTier, InboxItem, PlayerState, ToolId, UpgradeId } from './api';
import { Character, hasOutfit, loadCharacterModel, loadCrowdModels } from './character';
import { Coins, burst, dust, initFx, updateFx as updateParticles } from './fx';
import { updateRainbow } from './textures';
import { AUCTION_DOOR, BLACK_MARKET, BOUTIQUE, District, type Box, type Circle } from './district';
import { Guards } from './guards';
import { AuctionHall } from './auction';
import { PUSH_CATEGORIES, enablePush, pushSupport } from './push';
import { mountGoogleButton } from './google';
import { MuseumView } from './museumView';
import { FLOOR_H, PLOTS, ROOMS, spawnOf } from './layout';
import { Net, type EmoteKind, type LiveEvent, type PlotInfo, type ServerMsg } from './net';
import { ChatUI, EMOTE_ICONS, SpeechBubble } from './chat';
import { Voice } from './voice';
import { Label } from './labels';
import { RemotePlayers } from './remote';
import { Convoy, artTexture } from './convoy';
import { Pedestrians, Visitors } from './visitors';
import { Input } from './input';
import { Sfx } from './sfx';
import { CATALOG, incomeOf, money, perSec, work } from './catalog';
import { Premium } from './premium';
import { Inventory, type InvTab } from './inventory';
import { Tutorial, type TutoFacts } from './tutorial';
import { CHANGELOG, GAME_VERSION, roadmapHtml, versionHtml } from '../shared/changelog';

const liveBar = mountLiveBar();
setupPwa('../sw.js');

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

// ================================================================== rendu

const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
// « Neutre » (Khronos PBR Neutral) au lieu d'ACES : les couleurs gardent leur saturation (ACES les délavait)
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#9cc6ee', 100, 280); // Ciel azur avec brume atmosphérique légère
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0x9cd0ff, 0x6f8f4a, 1.45));
const sun = new THREE.DirectionalLight(0xfff0d6, 3.0);
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
  pedestrians.setCount(pedestrianCount());
};
applyQuality();

const BASE_FOV = 58;
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.1, 1200);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.14; // (0,05 par défaut : la caméra « glissait » longtemps, sensation de mollesse)
orbit.rotateSpeed = matchMedia('(pointer: coarse)').matches ? 1.15 : 0.85;
orbit.enablePan = false;
orbit.minDistance = 4;
orbit.maxDistance = 24;
orbit.minPolarAngle = 0.35;
orbit.maxPolarAngle = 1.32;
// Caméra : cliquer-glisser avec le bouton gauche OU droit pour tourner (avant : clic droit maintenu seulement), molette pour zoomer
orbit.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
/** Le joueur tourne la caméra lui-même : la caméra automatique (derrière le personnage) attend qu'il ait fini. */
let camDragging = false;
let camReleasedAt = -1e9;
/** Rotation de caméra faite par le joueur (radians cumulés), pour le tutoriel. */
let camTurnTotal = 0;
let lastAzimuth = 0;
orbit.addEventListener('start', () => {
  camDragging = true;
  lastAzimuth = orbit.getAzimuthalAngle();
});
orbit.addEventListener('end', () => {
  camDragging = false;
  camReleasedAt = performance.now();
});
orbit.addEventListener('change', () => {
  if (!camDragging) return;
  const a = orbit.getAzimuthalAngle();
  camTurnTotal += Math.abs(Math.atan2(Math.sin(a - lastAzimuth), Math.cos(a - lastAzimuth)));
  lastAzimuth = a;
});

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
const pedestrians = new Pedestrians(scene);
/** Passants sur la place : moins nombreux en mode Éco. */
const pedestrianCount = () => (quality === 'high' ? 10 : 5);
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

// ================================================================== social : discussion, émotes, voix, invitations

const chat = new ChatUI();
const voice = new Voice((m) => net.send(m), () => state?.id ?? '');
voice.onSpeaking = (id, on) => remotes.setSpeaking(id, on);
/** Bulle au-dessus de votre personnage (suit sa position à chaque image). */
const selfAnchor = new THREE.Group();
scene.add(selfAnchor);
const selfBubble = new SpeechBubble(selfAnchor, 3.45);
let districtId = 0;
let districtMax = 7;
chat.onSend = (text) => {
  if (!net.connected) return toast('Pas encore connecté au quartier');
  net.send({ t: 'chat', text });
};
chat.onEmote = (kind: EmoteKind) => {
  if (!net.connected) return;
  net.send({ t: 'emote', kind });
};
chat.onOpenChange = (open) => {
  if (open) input.enabled = false;
  else if (!anyOverlayOpen()) input.enabled = true;
};
// lien d'invitation : /game/?join=CODE (le paramètre est retiré de l'adresse une fois lu)
{
  const params = new URLSearchParams(location.search);
  const code = params.get('join');
  if (code && /^[A-Za-z0-9_-]{4,16}$/.test(code)) net.joinCode = code;
  if (params.has('join')) history.replaceState(null, '', location.pathname);
}

// ---------------------------------------------------------------- confettis et gains flottants (moments forts)

const CONFETTI_COLORS = [0xffd36b, 0xff5e62, 0x3d8bff, 0x4cc38a, 0xb46bff, 0xff9f43, 0xffffff];
const confettiGeo = new THREE.PlaneGeometry(0.14, 0.22);
const confettiMats = CONFETTI_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const confettiList: Array<{ m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number }> = [];
function confetti(at: THREE.Vector3, n = 70): void {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(confettiGeo, confettiMats[i % confettiMats.length]);
    m.position.copy(at).add(new THREE.Vector3(0, 2.2, 0));
    scene.add(m);
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 4;
    confettiList.push({ m, v: new THREE.Vector3(Math.cos(a) * s, 6 + Math.random() * 5, Math.sin(a) * s), spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), life: 2.4 + Math.random() });
  }
}
const floaters: Array<{ label: Label; life: number }> = [];
/** Texte qui s'élève et s'efface (gain encaissé, récompense…). */
function floatText(at: THREE.Vector3, text: string, color = '#ffd36b'): void {
  const label = new Label(0.9, 512, 130);
  label.update([{ text, color, size: 76, weight: 900 }]);
  label.sprite.position.copy(at);
  scene.add(label.sprite);
  floaters.push({ label, life: 1.6 });
}
function updateCelebrations(dt: number): void {
  for (const c of [...confettiList]) {
    c.life -= dt;
    c.v.y -= 12 * dt;
    c.v.multiplyScalar(1 - dt * 0.8); // freinage de l'air : ils flottent en retombant
    c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += c.spin.x * dt;
    c.m.rotation.y += c.spin.y * dt;
    if (c.life <= 0 || c.m.position.y < 0) {
      c.m.removeFromParent();
      confettiList.splice(confettiList.indexOf(c), 1);
    }
  }
  for (const f of [...floaters]) {
    f.life -= dt;
    f.label.sprite.position.y += dt * 1.1;
    (f.label.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, f.life / 0.6);
    if (f.life <= 0) {
      f.label.sprite.removeFromParent();
      f.label.dispose();
      floaters.splice(floaters.indexOf(f), 1);
    }
  }
}

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

let playerLook = '';
let questDoneSeen = '';

/** Personnage du joueur à sa couleur et dans sa tenue (reconstruit si l'une change, ou quand la tenue finit de charger). */
function rebuildPlayer(): void {
  if (!player || !state) return;
  const skin = state.skin ?? 0;
  const look = `${state.color}:${skin}:${hasOutfit(skin)}`;
  if (look === playerLook) return;
  playerLook = look;
  const fresh = new Character(parseInt(state.color.slice(1), 16), { skin });
  fresh.root.position.copy(player.root.position);
  fresh.root.rotation.copy(player.root.rotation);
  player.dispose();
  player = fresh;
  scene.add(player.root);
}

function applyState(s: PlayerState): void {
  // objectif qui vient d'être atteint : on le signale une seule fois
  if (s.quest?.done && questDoneSeen !== s.quest.id) {
    questDoneSeen = s.quest.id;
    if (state) {
      sfx.rare();
      toast(`Objectif atteint : récupérez ${money(s.quest.reward)} pièces !`);
    }
  }
  state = s;
  rebuildPlayer();
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
  if ($('shop').classList.contains('open')) renderShopPane();
  if ($('inventory').classList.contains('open')) inventory.render();
  // STH coins et coffres à ouvrir (pastille du bouton 🎒)
  $('sthCoins').textContent = money(s.sth ?? 0);
  $('shopSth').textContent = (s.sth ?? 0).toLocaleString('fr-FR');
  $('invSth').textContent = (s.sth ?? 0).toLocaleString('fr-FR');
  const toOpen = Inventory.chestCount(s);
  $('invBadge').hidden = !toOpen;
  $('invBadge').textContent = String(toOpen);
  // invité : on l'invite à créer un compte pour ne pas perdre son musée
  const guestNow = !s.account.email && !s.account.google;
  $('renameBtn').textContent = guestNow ? '💾 Sauver' : '👤';
  $('renameBtn').title = guestNow ? 'Sauvegarder : créez un compte pour retrouver votre musée partout' : 'Compte : nom, apparence, connexion';
  $('renameBtn').classList.toggle('save', guestNow);
  $('dailyBtn').hidden = !s.daily.claimable;
  $('dailyBtn').title = s.daily.claimable ? `Récompense du jour : +${money(s.daily.reward)} (série ${s.daily.streak})` : '';
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
  $('museumName').textContent = `${state.name} · niveau ${state.level}`;
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
  renderEvent(now);
  // l'objectif se range sous le porte-monnaie, quelle que soit sa hauteur
  $('quest').style.top = `${Math.round($('wallet').getBoundingClientRect().bottom + 10)}px`;
}

// ================================================================== sécurité, marché noir, outils (phase 3)

const TOOL_IDS = Object.keys(CATALOG.tools) as ToolId[];
let crowbarArmed = false;

let decorRoomIndex: number | null = null;

/** Panneaux superposés (un seul ouvert à la fois). */
const OVERLAYS = ['security', 'market', 'help', 'boards', 'decor', 'shop', 'social', 'inventory', 'news'] as const;
const anyOverlayOpen = () => OVERLAYS.some((id) => $(id).classList.contains('open')) || $('welcome').classList.contains('open') || !$('chestOpen').hidden;

function openOverlay(id: 'security' | 'market' | 'decor' | 'shop' | 'social' | 'inventory' | 'news'): void {
  if (!state) return;
  if (chat.isOpen) chat.close();
  for (const o of OVERLAYS) if (o !== id) $(o).classList.remove('open');
  $('menu').hidden = true;
  $(id).classList.add('open');
  input.enabled = false;
  if (id === 'security') renderSecurity();
  else if (id === 'market') renderMarket();
  else if (id === 'decor') renderDecor();
  else if (id === 'shop') {
    tuto.shopOpened = true;
    renderShopPane();
  } else if (id === 'social') renderSocial();
  else if (id === 'inventory') {
    tuto.inventoryOpened = true;
    inventory.render();
  } else if (id === 'news') renderNews();
}
function closeOverlays(): void {
  for (const id of OVERLAYS) $(id).classList.remove('open');
  if (!$('welcome').classList.contains('open')) input.enabled = true;
}
document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => (b.onclick = closeOverlays));
for (const id of ['security', 'market', 'boards', 'decor', 'shop', 'social', 'inventory', 'news', 'help']) $(id).addEventListener('pointerdown', (e) => e.target === $(id) && closeOverlays());

// ---------------------------------------------------------------- menu ☰, nouveautés, tutoriel

$('menuBtn').onclick = (e) => {
  e.stopPropagation();
  $('menu').hidden = !$('menu').hidden;
};
addEventListener('pointerdown', (e) => {
  if (!$('menu').hidden && !(e.target as HTMLElement).closest('#menu, #menuBtn')) $('menu').hidden = true;
});
$('verLabel').textContent = `Version ${GAME_VERSION}`;
$('newsBtn').onclick = () => openOverlay('news');
function renderNews(): void {
  $('newsBody').innerHTML = `<p>Version actuelle : <b>${GAME_VERSION}</b></p>${CHANGELOG.versions.slice(0, 4).map((v, i) => versionHtml(v, i === 0)).join('')}
    <h2>À venir</h2>${roadmapHtml()}`;
}

/** Faits observés pour valider les étapes du tutoriel. */
const tuto = { moved: 0, jumps: 0, runTime: 0, collected: 0, inventoryOpened: false, shopOpened: false };
const tutorial = new Tutorial($('tuto'), document.body.classList.contains('touch'));
function startTutorial(): void {
  closeOverlays();
  $('menu').hidden = true;
  tuto.inventoryOpened = false;
  tuto.shopOpened = false;
  tutorial.start();
}
$('tutoBtn').onclick = startTutorial;
$('helpTuto').onclick = () => {
  $('help').classList.remove('open');
  startTutorial();
};
$('rotateOk').onclick = () => document.body.classList.add('rotate-ok');
// l'objectif se réduit d'un appui sur son titre
$('quest').querySelector('.qhead')!.addEventListener('click', () => {
  $('quest').classList.toggle('mini');
  renderTimers();
});

// ---------------------------------------------------------------- boutique : onglets, Lucky coffres, STH coins ; inventaire

let shopTab: 'chests' | 'sth' | 'upgrades' = 'chests';
const premium = new Premium(
  {
    state: () => state,
    apply: (s) => applyState(s),
    guarded: (fn) => guarded(fn),
    toast: (m) => toast(m),
    banner: (t, s) => banner(t, s),
    sfx,
    celebrate: (n) => confetti(pos.clone().setY(floor * FLOOR_H), n),
    openInventory: (tab) => openInventory((tab as InvTab) ?? 'chests'),
    refresh: () => refreshState(),
    inNativeApp: !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
  },
  $('shopChests'),
  $('shopSthPane'),
);
premium.onNeedSth = () => setShopTab('sth');
premium.opener.onAgain = (id) => void premium.openChest(id);
premium.opener.onInventory = () => openInventory('chests');

function setShopTab(tab: typeof shopTab): void {
  shopTab = tab;
  $('shopTabs').querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('shopChests').hidden = tab !== 'chests';
  $('shopSthPane').hidden = tab !== 'sth';
  $('shopBody').hidden = tab !== 'upgrades';
  renderShopPane();
}
function renderShopPane(): void {
  if (shopTab === 'chests') premium.renderChests();
  else if (shopTab === 'sth') premium.renderSth();
  else renderShop();
}
$('shopTabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (b) setShopTab(b.dataset.tab as typeof shopTab);
});
function openShop(tab: typeof shopTab = shopTab): void {
  openOverlay('shop');
  setShopTab(tab);
}
$('sthChip').addEventListener('click', (e) => {
  e.stopPropagation();
  openShop('sth');
});

const inventory = new Inventory(
  {
    state: () => state,
    apply: (s) => applyState(s),
    guarded: (fn) => guarded(fn),
    toast: (m) => toast(m),
    sfx,
    slotWhere: (slot) => slotWhere(slot),
    openChest: (id) => {
      closeOverlays();
      void premium.openChest(id);
    },
    openShop: (tab) => openShop(tab),
  },
  $('invTabs'),
  $('invBody'),
);
function openInventory(tab?: InvTab): void {
  if (tab) inventory.tab = tab;
  openOverlay('inventory');
}
$('invBtn').onclick = () => openInventory();

// ---------------------------------------------------------------- panneau « Amis et quartier »

const inviteLink = () => `${location.origin}/game/?join=${state?.inviteCode ?? ''}`;
function renderSocial(): void {
  if (!state) return;
  const others = remotes.list();
  $('districtInfo').textContent = districtId ? `Quartier n°${districtId} · ${others.length + 1}/${districtMax} joueurs en ligne` : 'Connexion au quartier…';
  $('inviteCode').textContent = state.inviteCode;
  $('shareInvite').hidden = !('share' in navigator);
  const list = $('playerList');
  list.innerHTML = '';
  const row = (name: string, color: string, extra: string, id?: string) => {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.style.background = color;
    const nm = document.createElement('span');
    nm.textContent = `${name}${extra}`;
    li.append(dot, nm);
    if (id) {
      // masquer un joueur : on ne voit plus ses messages et on ne l'entend plus
      const b = document.createElement('button');
      const muted = chat.blocked.has(id);
      b.textContent = muted ? 'Masqué' : 'Masquer';
      b.className = muted ? 'on' : '';
      b.onclick = () => {
        if (chat.blocked.has(id)) {
          chat.blocked.delete(id);
          voice.blocked.delete(id);
        } else {
          chat.blocked.add(id);
          voice.blocked.add(id);
        }
        renderSocial();
      };
      li.appendChild(b);
    }
    list.appendChild(li);
  };
  row(`${state.name} (vous)`, state.color, voice.enabled ? ' 🎙' : '');
  for (const p of others) row(p.name, p.color, p.voice ? ' 🎙' : '', p.id);
  $('voiceState').textContent = !Voice.supported() ? 'Non disponible dans ce navigateur' : voice.enabled ? (voice.muted ? 'Micro coupé (V)' : `Micro actif · ${voice.count} joueur${voice.count > 1 ? 's' : ''} entendu${voice.count > 1 ? 's' : ''}`) : 'Micro désactivé';
  $('voiceToggle').textContent = voice.enabled ? 'Désactiver le micro' : 'Activer le micro';
}
$('socialBtn').onclick = () => openOverlay('social');
$('copyInvite').onclick = () => {
  void navigator.clipboard?.writeText(inviteLink()).then(
    () => toast('🔗 Lien d’invitation copié : envoyez-le à un ami !'),
    () => toast(`Votre lien : ${inviteLink()}`),
  );
};
$('shareInvite').onclick = () => {
  void (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share?.({ title: 'Steal a Masterpiece', text: `Viens dans mon quartier : ${state?.name}`, url: inviteLink() }).catch(() => undefined);
};
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $<HTMLInputElement>('joinInput').value.trim();
  let code = raw;
  try {
    code = new URL(raw).searchParams.get('join') ?? raw;
  } catch {
    /* pas un lien : c'est le code lui-même */
  }
  if (!/^[A-Za-z0-9_-]{4,16}$/.test(code)) return toast('Code d’invitation invalide');
  if (code === state?.inviteCode) return toast('C’est votre propre code : envoyez-le à un ami !');
  location.href = `/game/?join=${encodeURIComponent(code)}`;
});

async function toggleVoice(): Promise<void> {
  if (!Voice.supported()) return toast('Discussion vocale indisponible dans ce navigateur');
  if (voice.enabled) {
    voice.disable();
    toast('🎙 Discussion vocale désactivée');
  } else {
    try {
      await voice.enable();
      sfx.whoosh();
      toast('🎙 Micro activé : les joueurs proches vous entendent (V pour couper)');
    } catch {
      sfx.error();
      toast('Micro refusé ou introuvable : autorisez-le dans les réglages du navigateur');
    }
  }
  renderVoiceBtn();
  if ($('social').classList.contains('open')) renderSocial();
}
function renderVoiceBtn(): void {
  const b = $('voiceBtn');
  b.classList.toggle('on', voice.enabled && !voice.muted);
  b.classList.toggle('muted', voice.enabled && voice.muted);
  b.textContent = voice.enabled && voice.muted ? '🔇' : '🎙';
  b.title = voice.enabled ? (voice.muted ? 'Micro coupé (V pour le rétablir)' : 'Micro actif : cliquer pour quitter la discussion vocale') : 'Discussion vocale de proximité : activer le micro';
}
$('voiceBtn').onclick = () => void toggleVoice();
$('voiceToggle').onclick = () => void toggleVoice();
$('secBtn').onclick = () => openOverlay('security');
// interface compacte (téléphone) : un appui sur le porte-monnaie déplie ou replie ses détails
$('wallet').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  $('wallet').classList.toggle('open');
  renderTimers(); // l'objectif se recale tout de suite sous le porte-monnaie déplié
});
$('shopBtn').onclick = () => openOverlay('shop');

// ---------------------------------------------------------------- boutique, Renaissance, récompense du jour

const UPGRADE_IDS = Object.keys(CATALOG.upgrades) as UpgradeId[];
/** Valeur lisible d'un palier d'amélioration. */
function upgradeText(id: UpgradeId, v: number): string {
  switch (id) {
    case 'speed': return `+${Math.round(v * 100)} % de vitesse`;
    case 'lock': return `verrou ${v} s`;
    case 'vault': return `caisse ${v} h`;
    case 'gloves': return `décrochage −${Math.round((1 - v) * 100)} %`;
    case 'luck': return `rares ×${String(v).replace('.', ',')}`;
  }
}
let rebirthArmed = 0;

function renderShop(): void {
  if (!state) return;
  const s = state;
  let html = '<h2>Améliorations</h2>';
  for (const id of UPGRADE_IDS) {
    const u = CATALOG.upgrades[id];
    const cur = s.upgrades[id];
    const dots = `<span class="lvl">${u.levels.map((_, i) => `<i class="${i < cur.level ? 'on' : ''}"></i>`).join('')}</span>`;
    const now = cur.value !== null ? ` · actuel : ${upgradeText(id, cur.value)}` : '';
    const desc = cur.next ? `${u.desc}${now} · prochain : ${upgradeText(id, cur.next.value)}` : `${u.desc}${now} · niveau maximum`;
    html += offerHtml(`${u.icon} ${u.label}${dots}`, desc, cur.next ? cur.next.price : null, { upgrade: id }, cur.next ? undefined : 'Maximum');
  }
  // récompense du jour
  const d = s.daily;
  html += `<h2>Récompense du jour <small class="${d.claimable ? '' : 'off'}">série : ${d.streak} jour${d.streak > 1 ? 's' : ''}</small></h2>`;
  html += offerHtml(`🎁 Jour ${d.day}/${d.days}`, d.claimable ? 'Revenez chaque jour : la récompense grandit avec la série (et avec vos revenus).' : 'Déjà récupérée aujourd’hui : revenez demain pour continuer la série !', d.claimable ? 0 : null, { daily: 1 }, d.claimable ? `+${money(d.reward)}` : 'Demain');
  // Renaissance
  const r = s.rebirth;
  const nextMult = 1 + (s.rebirths + 1) * r.bonus;
  const armed = performance.now() < rebirthArmed;
  html += `<div class="rebirth"><b>✨ Renaissance ${s.rebirths ? `· ${s.rebirths} déjà` : ''}</b>
    <span>Repartez de zéro (musée, œuvres et pièces) et gagnez <strong>revenu ×${String(nextMult).replace('.', ',')}</strong> pour toujours.
    Vos améliorations de la boutique, vos objectifs et vos records sont conservés.</span>
    <span class="d">${r.ready ? `Coût : ${money(r.cost)} pièces.` : `Disponible au niveau ${r.minLevel} (rez-de-chaussée complet).`} Revenu actuel ×${String(s.incomeMult).replace('.', ',')}.</span>
    <button data-rebirth="1" class="${armed ? 'armed' : ''}" ${r.ready && s.coins >= r.cost ? '' : 'disabled'}>${armed ? 'Confirmer : tout recommencer' : `Renaissance · ${money(r.cost)}`}</button></div>`;
  $('shopBody').innerHTML = html;
}

$('shopBody').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!b) return;
  if (b.dataset.upgrade) {
    void (async () => {
      const r = await guarded(() => api.buyUpgrade(b.dataset.upgrade as UpgradeId));
      if (!r) return;
      applyState(r.state);
      sfx.expand();
      bumpWallet();
      const u = CATALOG.upgrades[r.id];
      toast(`${u.icon} ${u.label} niveau ${r.level} : −${money(r.price)} pièces`);
    })();
  } else if (b.dataset.daily) void doDaily();
  else if (b.dataset.rebirth) {
    if (performance.now() > rebirthArmed) {
      rebirthArmed = performance.now() + 4000; // deuxième clic pour confirmer
      renderShop();
      return;
    }
    rebirthArmed = 0;
    void (async () => {
      const r = await guarded(() => api.rebirth());
      if (!r) return;
      closeOverlays();
      applyState(r.state);
      sfx.rare();
      burstCoins(pos.clone(), 24);
      confetti(pos, 140);
      banner(`✨ Renaissance n°${r.rebirths} !`, `Votre revenu est multiplié par ${String(r.incomeMult).replace('.', ',')} pour toujours. À vous de rebâtir !`);
    })();
  }
});

async function doDaily(): Promise<void> {
  const r = await guarded(() => api.claimDaily());
  if (!r) return;
  applyState(r.state);
  sfx.coin(5);
  bumpWallet();
  burstCoins(pos.clone(), 18);
  confetti(pos, 60);
  floatText(pos.clone().setY(3.6 + floor * FLOOR_H), `+${money(r.reward)}`);
  banner(`🎁 +${money(r.reward)} pièces`, `Récompense du jour · série de ${r.streak} jour${r.streak > 1 ? 's' : ''} : revenez demain !`);
}
$('dailyBtn').onclick = () => void doDaily();

/** Événement du convoi : affiché dans le porte-monnaie, annoncé au début. */
let eventSeen = '';
function renderEvent(now: number): void {
  if (!state) return;
  const { current, next } = state.event;
  const el = $('eventInfo');
  if (current && current.endsAt > now) {
    // texte court (le porte-monnaie ne s'élargit plus) ; la description complète est dans l'infobulle et la bannière
    el.textContent = `${current.icon} ${current.label} : encore ${fmtDur(current.endsAt - now)}`;
    el.title = current.desc;
    el.classList.add('live');
    const key = `${current.kind}:${current.startsAt}`;
    if (eventSeen !== key && playing) {
      eventSeen = key;
      if (current.admin) {
        // « admin abuse » : fanfare, confettis, bannière et message dans la discussion
        sfx.fanfare();
        confetti(pos, 90);
        banner(`${current.icon} ${current.label.toUpperCase()} !`, `${current.desc} · encore ${fmtDur(current.endsAt - now)}`);
        chat.system(`${current.icon} Événement en direct : ${current.label} (${fmtDur(current.endsAt - now)})`);
      } else {
        sfx.rare();
        banner(`${current.icon} ${current.label} !`, `${current.desc} pendant ${fmtDur(current.endsAt - now)}`);
      }
      district.setSkyEvent(current.kind);
    }
    document.body.dataset.event = current.kind;
  } else if (next) {
    if (document.body.dataset.event) {
      delete document.body.dataset.event;
      district.setSkyEvent(null);
    }
    el.textContent = `${next.icon} ${next.label} dans ${fmtDur(Math.max(0, next.startsAt - now))}`;
    el.title = next.desc;
    el.classList.remove('live');
    // l'événement vient de commencer : l'état du serveur le confirmera, on le redemande
    if (next.startsAt <= now) refreshSoon();
  } else {
    el.textContent = '';
    if (document.body.dataset.event) {
      delete document.body.dataset.event;
      district.setSkyEvent(null);
    }
  }
}

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
  // sans choix du joueur, chaque salle garde l'ambiance d'origine du plan (layout.json)
  const currentTheme = currentThemes[decorRoomIndex] ?? ROOMS[decorRoomIndex % ROOMS.length][2];
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
      isCurrent ? null : CATALOG.decorCost,
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
  const anyOpen = anyOverlayOpen();
  if (e.code === 'KeyG' && !e.repeat) {
    if ($('security').classList.contains('open')) closeOverlays();
    else if (!anyOpen) openOverlay('security');
  } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && !anyOpen && !hall.active) {
    e.preventDefault();
    chat.open();
  } else if (e.code === 'KeyV' && !e.repeat && voice.enabled) {
    voice.setMuted(!voice.muted);
    renderVoiceBtn();
    toast(voice.muted ? '🔇 Micro coupé (V pour le rétablir)' : '🎙 Micro rétabli');
  } else if (e.code === 'KeyF' && !e.repeat && !anyOpen) {
    doBonk();
  } else if (e.code === 'KeyB' && !e.repeat) {
    if ($('shop').classList.contains('open')) closeOverlays();
    else if (!anyOpen) openOverlay('shop');
  } else if (e.code === 'KeyI' && !e.repeat) {
    if ($('inventory').classList.contains('open')) closeOverlays();
    else if (!anyOpen) openInventory();
  } else if (e.code === 'KeyT' && !e.repeat) {
    if ($('decor').classList.contains('open')) closeOverlays();
    else if (!anyOpen && currentRoom !== null) {
      decorRoomIndex = currentRoom;
      openOverlay('decor');
    }
  }
  // une touche par outil (1 à 6), pavé numérique compris
  const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  const tool = n ? TOOL_IDS[Number(n[1]) - 1] : undefined;
  if (tool && !anyOpen && !e.repeat) useTool(tool);
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
$('helpBtn').onclick = () => {
  $('menu').hidden = true;
  $('help').classList.add('open');
};
$('helpClose').onclick = () => $('help').classList.remove('open');
addEventListener('pointerdown', () => sfx.unlock());
addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.code === 'Escape') {
    // 0. animation d'ouverture d'un coffre, menu ☰
    if (!$('chestOpen').hidden) {
      premium.opener.close();
      return;
    }
    if (!$('menu').hidden) {
      $('menu').hidden = true;
      return;
    }
    // 1. un panneau ouvert se ferme d'abord (sans toucher à l'œuvre que l'on tient en mains)
    if (OVERLAYS.some((id) => $(id).classList.contains('open'))) {
      closeOverlays();
      return;
    }
    // 2. puis l'œuvre tenue en mains (déplacement ou achat à accrocher)
    if (reorgSelected) {
      if (myView && reorgSelected.uid) myView.hiddenUid = null;
      setCarry(null);
      // œuvre reprise lors d'un échange : elle est déjà accrochée (côté serveur) à la place libérée
      toast(reorgSelected.fromSwap ? `« ${work(reorgSelected.workId).title} » reste accrochée ${slotWhere(reorgSelected.slot)}` : 'Déplacement annulé');
      reorgSelected = null;
      return;
    }
    if (boughtToPlace) {
      // l'œuvre achetée reste à l'emplacement que le serveur lui a donné
      if (myView) myView.hiddenUid = null;
      setCarry(null);
      boughtToPlace = null;
      toast('Œuvre laissée à sa place dans votre musée');
      return;
    }
    const anyOpen = OVERLAYS.some((id) => $(id).classList.contains('open'));
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


async function doBuy(item: ConvoyItem, _from: THREE.Vector3): Promise<void> {
  if (!state) return;
  if (boughtToPlace || reorgSelected || heist) {
    sfx.error();
    toast('Vos mains sont prises : accrochez d’abord l’œuvre que vous portez (Échap pour la laisser)');
    return;
  }
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
  // L'œuvre est transportée manuellement par le joueur pour être accrochée au mur !
  boughtToPlace = { uid: r.artwork.uid, workId: item.workId, tempSlot: r.artwork.slot };
  if (myView) myView.hiddenUid = r.artwork.uid;
  applyState(r.state);
  bumpWallet();
  setCarry({ workId: item.workId, frame: item.frame });
  if (item.rarity !== 'commun' || item.frame !== 'normal') sfx.rare();
  if (item.frame === 'arcenciel' || item.rarity === 'mythique') {
    // jackpot : grosse fête (confettis, onde de choc, message dans la discussion)
    confetti(pos, 120);
    burst(pos.clone(), 0xff8fd8, true);
    chat.system(`🌈 Vous décrochez « ${wk.title} » ${item.frame === 'arcenciel' ? 'en cadre arc-en-ciel (×10) !' : ', une Mythique !'}`);
  }
  banner(wk.title, `Œuvre entre vos mains ! Entrez dans votre musée et appuyez sur E devant un emplacement pour l'accrocher.`);
  maybeAskPush();
}

async function doCollect(): Promise<void> {
  const r = await guarded(() => api.collect());
  if (!r) return;
  applyState(r.state);
  if (r.collected > 0) {
    tuto.collected++;
    sfx.coin(Math.ceil(Math.log10(r.collected + 1)));
    bumpWallet();
    if (myView) {
      burstCoins(myView.registerPos, Math.min(24, 6 + Math.round(Math.log2(r.collected + 1))));
      floatText(myView.registerPos.clone().setY(3.4), `+${money(r.collected)}`);
    }
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
  confetti(pos, 90);
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
  confetti(pos, 50);
  player?.gesture('Yes', 'Idle');
  banner('Objectif accompli !', `+${money(r.reward)} pièces`);
}
$('questClaim').onclick = () => void doClaim();

let sellArmed: { uid: string; until: number } | null = null;
/**
 * Œuvre portée en mains pour la déplacer. `fromSwap` : décrochée par un échange (déjà accrochée à `slot` côté serveur) ;
 * `lockSlot` : l'emplacement que l'on vient de remplir, ignoré tant que l'on ne s'en est pas éloigné.
 */
let reorgSelected: { uid: string; workId: string; slot: number; fromSwap?: boolean; lockSlot?: number } | null = null;
let boughtToPlace: { uid: string; workId: string; tempSlot: number } | null = null;

/** « dans la salle #3 (1er étage) » : où se trouve un emplacement de votre musée. */
function slotWhere(slot: number): string {
  if (!myView) return 'à sa nouvelle place';
  const s = myView.slotWorld(slot);
  const room = myView.roomIndexOf(s.p.clone().addScaledVector(s.normal, 1.2), s.floor);
  const level = s.floor === 0 ? 'rez-de-chaussée' : s.floor >= 3 ? 'toit-terrasse' : s.floor === 1 ? '1er étage' : `${s.floor}e étage`;
  return room === null ? `sur le ${level}` : `dans la salle #${room + 1} (${level})`;
}

async function doMove(uid: string, targetSlot: number): Promise<void> {
  const placedWorkId = reorgSelected?.uid === uid ? reorgSelected.workId : boughtToPlace?.uid === uid ? boughtToPlace.workId : null;
  const r = await guarded(() => api.moveArtwork(uid, targetSlot));
  if (!r) return;
  reorgSelected = null;
  boughtToPlace = null;
  if (myView) myView.hiddenUid = null;
  setCarry(null);
  applyState(r.state);
  sfx.whoosh();
  // Échange : l'œuvre qui était au mur passe dans les mains du joueur (au lieu de partir, invisible, à l'ancienne
  // place de celle qu'il tenait, parfois dans une autre salle ou à un autre étage).
  const other = r.swappedUid ? r.state.artworks.find((a) => a.uid === r.swappedUid && a.slot !== null && !a.carried) : undefined;
  if (other && other.slot !== null) {
    reorgSelected = { uid: other.uid, workId: other.workId, slot: other.slot, fromSwap: true, lockSlot: targetSlot };
    if (myView) myView.hiddenUid = other.uid;
    setCarry({ workId: other.workId, frame: other.frame });
    toast(`${placedWorkId ? `« ${work(placedWorkId).title} » accrochée. ` : ''}Vous tenez maintenant « ${work(other.workId).title} » : approchez-vous d’un emplacement (Échap pour la laisser ${slotWhere(other.slot)})`);
    return;
  }
  toast('Œuvre accrochée au mur !');
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

// ================================================================== coup de parapluie, pluie d'or, événements en direct

const BONK = (CATALOG as unknown as { bonk?: { range: number; cooldownMs: number; stunMs: number } }).bonk ?? { range: 2.6, cooldownMs: 2500, stunMs: 1100 };
initFx(scene);
const rainCoins = new Coins(scene);
/** Sonné par un coup de parapluie jusqu'à (horloge locale). */
let stunUntil = 0;
let bonkAt = 0;
/** Secousse de la caméra (s), appliquée juste avant le rendu puis retirée. */
let shake = 0;
const shakeOff = new THREE.Vector3();

/** Événement en cours (convoi ou « admin abuse »), ou null. */
function liveKind(): string | null {
  const c = state?.event.current;
  return c && c.endsAt > serverNow() ? c.kind : null;
}

function doBonk(): void {
  if (!playing || !player || !net.connected || anyOverlayOpen() || hall.active || stealing) return;
  const now = performance.now();
  if (now < stunUntil || jailUntil > serverNow() || now - bonkAt < BONK.cooldownMs) return;
  bonkAt = now;
  net.send({ t: 'bonk' });
  player.gesture('Punch', 'Idle');
  sfx.whoosh();
  const b = $('tB');
  b.classList.add('cool');
  setTimeout(() => b.classList.remove('cool'), BONK.cooldownMs);
}
$('tB').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doBonk();
});

function onBonk(m: Extract<ServerMsg, { t: 'bonk' }>): void {
  const me = state?.id;
  const from = new THREE.Vector3(m.x, 0, m.z);
  // geste du frappeur (s'il n'est pas vous) et projection de la cible (si ce n'est pas vous)
  remotes.bonk(m.from, m.to === me ? null : m.to, from, m.stunMs);
  if (!m.to) return; // coup dans le vide
  const at = m.to === me ? pos.clone().setY(floor * FLOOR_H) : remotes.positionOf(m.to)?.clone();
  if (!at || at.distanceTo(pos) > 45) return; // trop loin pour voir l'effet
  burst(at, 0xb48cff, m.dropped);
  floatText(at.clone().setY(at.y + 2.9), m.dropped ? 'BONK ! 🖼💨' : 'BONK !', '#d2b4ff');
  sfx.bonk();
  if (m.to === me) {
    // projeté en arrière (les murs arrêtent la glissade), petit saut, étourdi
    stunUntil = performance.now() + m.stunMs;
    const away = new THREE.Vector2(pos.x - m.x, pos.z - m.z);
    if (away.lengthSq() < 1e-4) away.set(Math.sin(facing), Math.cos(facing));
    vel.copy(away.normalize().multiplyScalar(9));
    vy = 5;
    shake = 0.35;
    selfBubble.emote('💫');
    if (stealing) stealing = null;
  } else if (m.from === me && m.dropped) {
    sfx.coin(3);
    toast('☂ En plein dans le mille : le voleur lâche l’œuvre !');
  }
}

function onCoins(m: Extract<ServerMsg, { t: 'coins' }>): void {
  if (m.add?.length) rainCoins.add(m.add);
  if (m.del?.length) {
    const gone = rainCoins.remove(m.del);
    // une pièce ramassée par quelqu'un d'autre : petit éclat doré
    if (m.by && m.by !== state?.id) for (const p of gone) if (p.distanceTo(pos) < 30) burst(p.setY(0), 0xffc93c);
  }
}

function onCoinGot(m: Extract<ServerMsg, { t: 'coin-got' }>): void {
  if (!state) return;
  state.coins += m.amount;
  renderHud();
  bumpWallet();
  sfx.pickup();
  burst(pos.clone(), 0xffc93c);
  floatText(pos.clone().setY(3.1), `+${money(m.amount)}`);
}

function onLiveEvent(ev: LiveEvent | null): void {
  if (!state) return;
  if (ev) state.event = { ...state.event, current: ev as unknown as ConvoyEvent };
  else {
    if (state.event.current?.admin) state.event = { ...state.event, current: null };
    rainCoins.clear();
    refreshSoon(); // un événement du convoi reprend peut-être la main
  }
  renderEvent(serverNow());
  district.setSkyEvent(liveKind());
}

// ================================================================== hôtel des ventes (phase 4)

function enterHall(): void {
  if (!state || !net.connected || hall.active) return;
  if (heist || stealing) {
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
      if (m.sold) chat.system(`🔨 « ${work(m.workId).title} » adjugée ${money(m.price)} à ${m.winner}`);
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
    // un camion toutes les 8 s : on n'annonce que les pièces remarquables (rareté ou cadre)
    if (next && !announced.has(next.window) && (next.rarity !== 'commun' || next.frame !== 'normal')) {
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
  $('boardList').innerHTML = rows.length
    ? rows.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm"></span><b>${money(r.value)}</b></li>`).join('')
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
/** Œuvre tenue en mains (affichage) : volée, achetée ou en cours de déplacement. */
let carrying: { workId: string; frame: string } | null = null;
/** Vrai seulement quand l'œuvre portée est volée (le serveur suit alors le casse). */
let heist = false;
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
    // Cadre et tableau portés à deux mains devant le personnage (hauteur poitrine/torse ~1.0m, avancé de 0.55m)
    carryMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), new THREE.MeshBasicMaterial({ map: artTexture(c.workId), side: THREE.DoubleSide }));
    carryMesh.position.set(0, 1.1, 0.55);
    carryMesh.rotation.set(-0.15, 0, 0); // Légèrement incliné pour un portage naturel à deux mains
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
  rainCoins.clear();
  if (m.coins?.length) rainCoins.add(m.coins);
  jailUntil = Math.max(jailUntil, m.you.jailUntil ?? 0);
  $('netStatus').hidden = true;
  // social : historique de la discussion, quartier, micro (après une reconnexion, le serveur l'a oublié)
  districtId = m.district;
  districtMax = m.max ?? 7;
  chat.clear();
  for (const line of m.chat ?? []) if (!chat.blocked.has(line.id)) chat.add({ ...line, me: line.id === state?.id });
  chat.system(`Quartier n°${m.district} · ${m.players.length}/${districtMax} joueurs · Entrée pour écrire, 👥 pour inviter un ami`);
  if (voice.enabled) net.send({ t: 'voice', on: true });
  const inv = m.invite;
  if (inv) {
    const msg = {
      ok: `🎉 Bienvenue dans le quartier de ${inv.name} !`,
      full: `Le quartier de ${inv.name} est plein (${districtMax} joueurs) : vous êtes dans un autre quartier`,
      offline: `${inv.name} n’est pas en ligne : vous êtes dans un autre quartier`,
      unknown: 'Code d’invitation inconnu',
      self: 'C’est votre propre code d’invitation',
    }[inv.status];
    if (inv.status === 'ok') banner(msg, 'Écrivez-lui avec Entrée, ou activez le micro 🎙');
    else toast(msg);
    chat.system(msg);
  }
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
        heist = true;
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
        heist = false;
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
      chat.system(`🦹 ${m.thiefName} a volé « ${title} » au ${m.victimName}`);
      if (m.thief === me) confetti(pos, 80);
      break;
    case 'arrested':
      remotes.setWanted(m.thief, false);
      if (m.thief === me) {
        heist = false;
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
      chat.system(`👮 ${m.byName} a arrêté ${m.thiefName}`);
      break;
    case 'returned':
      remotes.setWanted(m.thief, false);
      if (m.thief === me) {
        heist = false;
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
      voice.sync(m.players);
      break;
    case 'chat':
      if (m.id === state?.id) {
        chat.add({ ...m, me: true });
        selfBubble.say(m.text, m.color);
      } else if (!chat.blocked.has(m.id)) {
        chat.add(m);
        remotes.say(m.id, m.text);
        sfx.coin(1);
      }
      break;
    case 'chat-error':
      toast(m.error);
      break;
    case 'emote':
      if (m.id === state?.id) {
        selfBubble.emote(EMOTE_ICONS[m.kind]);
        if (m.kind === 'wave' || m.kind === 'clap' || m.kind === 'heart') player?.gesture('Wave', 'Idle');
      } else if (!chat.blocked.has(m.id)) remotes.emote(m.id, m.kind);
      break;
    case 'rtc':
      void voice.onSignal(m.from, m.data);
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
      if (!hall.active) confetti(pos, 90);
      chat.system(`🔨 Vous remportez « ${work(m.workId).title} » pour ${money(m.price)} !`);
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
      chat.system(m.phase === 'start' ? `🚨 ${m.thiefName} vole « ${title} » chez ${m.victimName} !` : m.phase === 'saved' ? `🏆 ${m.byName} a sauvé « ${title} »` : `😱 « ${title} » volée par ${m.thiefName}`);
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
      if (m.player.id !== state?.id) {
        toast(`${m.player.name} entre dans le quartier`);
        chat.system(m.invited ? `👋 ${m.player.name} arrive, invité par ${m.invited}` : `👋 ${m.player.name} entre dans le quartier`);
      }
      break;
    case 'leave': {
      const who = remotes.list().find((p) => p.id === m.id);
      if (who) chat.system(`🚪 ${who.name} quitte le quartier`);
      remotes.remove(m.id);
      break;
    }
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
    case 'bonk': onBonk(m); break;
    case 'coins': onCoins(m); break;
    case 'coin-got': onCoinGot(m); break;
    case 'live-event': onLiveEvent(m.event); break;
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
  net.send({ t: 'pos', x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100, f: floor, ry: Math.round(facing * 100) / 100, anim: pos.y > 0.05 ? 'Jump' : sp > 6.2 ? 'Running' : sp > 0.3 ? 'Walking' : 'Idle' });
}, 100);

// ================================================================== démarrage

let started = false;
async function start(name?: string, color?: string, country?: string, pre?: Awaited<ReturnType<typeof api.login>>, skin?: number): Promise<void> {
  if (!(await modelReady)) return; // personnage introuvable : le message reste affiché
  let r: Awaited<ReturnType<typeof api.login>>;
  try {
    r = pre ?? (await api.login(name, color, country, skin));
  } catch (e) {
    toast(`Connexion impossible : ${(e as Error).message}. Nouvel essai…`);
    setTimeout(() => void start(name, color, country, undefined, skin), 4000);
    return;
  }
  if (started) {
    // déjà en jeu et nouvelle session (connexion Google après coup) : on repart proprement avec la session enregistrée,
    // plutôt que de garder le quartier de l'ancien compte et de doubler les minuteries
    location.reload();
    return;
  }
  started = true;
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
  if (r.state.daily.claimable) setTimeout(() => toast(`🎁 Récompense du jour : +${money(r.state.daily.reward)} (bouton 🎁 ou boutique)`), 3600);
  // tutoriel : automatique pour un nouveau joueur (ou un joueur qui débute) ; proposé une fois aux autres
  if (!Tutorial.seen()) {
    if (r.created || (r.state.quest?.index ?? 99) < 3) setTimeout(startTutorial, 1800);
    else {
      setTimeout(() => toast('🎓 Nouveau : un tutoriel et les Lucky coffres ! Menu ☰ → Tutoriel'), 4500);
      try {
        localStorage.setItem('sam-tuto-v2', '1');
      } catch {
        /* stockage indisponible */
      }
    }
  }
  // retour de la page de paiement (/game/?pay=…) ou paiement en attente : suivi jusqu'au crédit des STH
  {
    const params = new URLSearchParams(location.search);
    const pay = params.get('pay');
    if (pay) history.replaceState(null, '', location.pathname);
    premium.resume(pay && /^sth_[A-Za-z0-9_-]{10,40}$/.test(pay) ? pay : null);
    if (pay) setTimeout(() => openShop('sth'), 600);
  }
  void premium.loadConfig();
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

// Choix de la tenue (skin), visible par tous les joueurs
const SKIN_ICONS = ['🤵', '👩‍💼', '🧑', '👩'];
let chosenSkin = 0;
const skinsEl = $('skins');
for (const s of (CATALOG as unknown as { skins?: Array<{ id: number; label: string }> }).skins ?? []) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.s = String(s.id);
  b.innerHTML = `<span>${SKIN_ICONS[s.id] ?? '🙂'}</span>${s.label}`;
  b.onclick = () => markSkin(s.id);
  skinsEl.appendChild(b);
}
function markSkin(s: number): void {
  chosenSkin = s;
  skinsEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.s === String(s)));
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
/** Pays proposé à l'inscription : la région de la langue du navigateur (fr-TG → Togo), sinon la France. */
function detectCountry(): string {
  const known = new Set((CATALOG.countries ?? []).map((c) => c.code));
  for (const lang of navigator.languages ?? [navigator.language]) {
    const region = /[-_]([A-Za-z]{2})$/.exec(lang)?.[1]?.toUpperCase();
    if (region && known.has(region)) return region;
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byTz: Record<string, string> = { 'Africa/Lome': 'TG', 'Africa/Porto-Novo': 'BJ', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Ouagadougou': 'BF', 'Africa/Bamako': 'ML', 'Africa/Niamey': 'NE', 'Africa/Douala': 'CM', 'Africa/Libreville': 'GA', 'Africa/Brazzaville': 'CG', 'Africa/Kinshasa': 'CD', 'Africa/Accra': 'GH', 'Africa/Lagos': 'NG', 'Africa/Conakry': 'GN', 'Africa/Casablanca': 'MA' };
    if (byTz[tz] && known.has(byTz[tz])) return byTz[tz];
  } catch {
    /* pas de fuseau horaire */
  }
  return 'FR';
}
function markCountry(c: string): void {
  chosenCountry = c;
  countriesEl.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
}

// ================================================================== compte : inscription, connexion, mot de passe oublié

type AuthMode = 'signup' | 'login' | 'forgot' | 'reset' | 'account';
let authMode: AuthMode = 'signup';
/** Jeton du lien « nouveau mot de passe » reçu par e-mail (/game/?reset=…). */
let resetToken: string | null = null;
const nameInput = $<HTMLInputElement>('nameInput');
const emailInput = $<HTMLInputElement>('emailInput');
const passInput = $<HTMLInputElement>('passInput');
/** Application mobile (Capacitor) : Google refuse la connexion dans une vue web intégrée. */
const inNativeApp = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
const isGuest = () => !!state && !state.account.email && !state.account.google;

const AUTH_TEXT: Record<AuthMode, { title: string; intro: string; go: string }> = {
  signup: { title: 'Votre musée vous attend', intro: 'Créez votre compte pour retrouver votre musée sur tous vos appareils. Vous commencez avec un petit local et 500 pièces.', go: 'Créer mon compte' },
  login: { title: 'Bon retour', intro: 'Connectez-vous pour retrouver votre musée, sur n’importe quel appareil.', go: 'Se connecter' },
  forgot: { title: 'Mot de passe oublié', intro: 'Indiquez l’e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.', go: 'Envoyer le lien' },
  reset: { title: 'Nouveau mot de passe', intro: 'Choisissez votre nouveau mot de passe (8 caractères au moins).', go: 'Enregistrer et jouer' },
  account: { title: 'Votre compte', intro: '', go: 'Enregistrer le nom et l’apparence' },
};

function authMsg(text: string, error = false): void {
  const m = $('authMsg');
  m.textContent = text;
  m.hidden = !text;
  m.classList.toggle('err', error);
}

function setAuthMode(mode: AuthMode): void {
  authMode = mode;
  const form = $('welcomeForm');
  form.dataset.mode = mode;
  // « save » : sans e-mail (invité, ou compte Google seul), on peut ajouter e-mail + mot de passe et garder son musée ;
  // « member » : un compte (e-mail ou Google) peut se déconnecter
  const visible = new Set<string>([mode]);
  if (mode === 'account' && !state?.account.email) visible.add('save');
  if (mode === 'account' && !isGuest()) visible.add('member');
  form.querySelectorAll<HTMLElement>('[data-modes]').forEach((el) => (el.hidden = !el.dataset.modes!.split(' ').some((m) => visible.has(m))));
  form.querySelectorAll<HTMLElement>('[data-auth]').forEach((b) => b.classList.toggle('on', b.dataset.auth === mode));
  const t = AUTH_TEXT[mode];
  $('authTitle').textContent = t.title;
  $('authGo').textContent = t.go;
  $('authIntro').textContent = mode !== 'account'
    ? t.intro
    : isGuest()
      ? 'Votre musée n’est enregistré que sur cet appareil. Créez un compte pour le retrouver partout : vous gardez tout.'
      : state?.account.email
        ? `Connecté avec ${state.account.email}${state.account.google ? ' et Google' : ''}.`
        : 'Connecté avec Google. Ajoutez un e-mail et un mot de passe pour vous connecter aussi depuis l’application mobile.';
  passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authMsg('');
  void mountGoogle();
}

/** Ouvre le panneau de compte dans un mode donné. */
function openAuth(mode: AuthMode): void {
  if (mode === 'account' && state) {
    nameInput.value = state.name;
    markColor(state.color);
    markCountry(state.country ?? 'FR');
    markSkin(state.skin ?? 0);
  } else if (mode === 'signup') {
    markColor(CATALOG.colors[0]);
    markCountry(detectCountry());
    markSkin(0);
  }
  $('welcome').classList.add('open');
  input.enabled = false;
  setAuthMode(mode);
  const first = [nameInput, emailInput, passInput].find((el) => !el.closest<HTMLElement>('[data-modes]')!.hidden && !el.value);
  setTimeout(() => (first ?? nameInput).focus(), 50);
}

function closeAuth(): void {
  $('welcome').classList.remove('open');
  if (!anyOverlayOpen()) input.enabled = true;
}

/** Appel au serveur depuis le formulaire : l'erreur s'affiche dans le formulaire (pas dans un toast caché derrière). */
async function authCall<T>(fn: () => Promise<T>): Promise<T | null> {
  const go = $<HTMLButtonElement>('authGo');
  go.disabled = true;
  try {
    return await fn();
  } catch (e) {
    sfx.error();
    authMsg((e as Error).message, true);
    return null;
  } finally {
    go.disabled = false;
  }
}

/** Session ouverte (inscription, connexion, nouveau mot de passe) : on joue, ou on recharge si un autre musée était ouvert. */
function enterWith(r: Awaited<ReturnType<typeof api.login>>): void {
  closeAuth();
  if (started) location.reload();
  else void start(undefined, undefined, undefined, r);
}

$('welcomeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if ((authMode === 'signup' || authMode === 'account') && (name.length < 2 || name.length > 24)) return authMsg('Nom d’utilisateur : 2 à 24 caractères', true);
  if ((authMode === 'signup' || authMode === 'login' || authMode === 'forgot') && !/^\S+@\S+\.\S+$/.test(email)) return authMsg('Adresse e-mail invalide', true);
  if ((authMode === 'signup' || authMode === 'reset') && pass.length < 8) return authMsg('Mot de passe : 8 caractères au moins', true);
  if (authMode === 'login' && !pass) return authMsg('Entrez votre mot de passe', true);
  switch (authMode) {
    case 'signup': {
      const r = await authCall(() => api.register(name, email, pass, chosenColor, chosenCountry, chosenSkin));
      if (r) enterWith(r);
      break;
    }
    case 'login': {
      const r = await authCall(() => api.loginPassword(email, pass));
      if (r) enterWith(r);
      break;
    }
    case 'forgot': {
      const r = await authCall(() => api.forgotPassword(email));
      if (r) authMsg(r.devLink ? `${r.message} (mode test : ${r.devLink})` : r.message);
      break;
    }
    case 'reset': {
      if (!resetToken) return authMsg('Lien incomplet : ouvrez le lien reçu par e-mail', true);
      const r = await authCall(() => api.resetPassword(resetToken!, pass));
      if (r) {
        resetToken = null;
        enterWith(r);
      }
      break;
    }
    case 'account': {
      const r = await authCall(() => api.rename(name, chosenColor, chosenCountry, chosenSkin));
      if (!r) return;
      applyState(r.state);
      void refreshBoard();
      closeAuth();
      toast('Nom et apparence enregistrés');
      break;
    }
  }
});

$('welcomeForm').querySelectorAll<HTMLElement>('[data-auth]').forEach((b) => (b.onclick = () => setAuthMode(b.dataset.auth as AuthMode)));
$('forgotLink').onclick = () => setAuthMode('forgot');
$('backLink').onclick = () => setAuthMode('login');
$('closeAccount').onclick = closeAuth;
$('renameBtn').onclick = () => openAuth('account');
// jouer tout de suite, sans compte (le nom saisi sert de nom de musée)
$('guestLink').onclick = () => {
  const name = nameInput.value.trim();
  if (name && (name.length < 2 || name.length > 24)) return authMsg('Nom du musée : 2 à 24 caractères', true);
  closeAuth();
  void start(name || undefined, chosenColor, chosenCountry, undefined, chosenSkin);
};
// un invité transforme son musée en compte : il garde tout (œuvres, pièces, niveau)
$('saveGo').onclick = async () => {
  const name = nameInput.value.trim() || state?.name || '';
  const email = emailInput.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg('Adresse e-mail invalide', true);
  if (passInput.value.length < 8) return authMsg('Mot de passe : 8 caractères au moins', true);
  const r = await authCall(() => api.register(name, email, passInput.value, chosenColor, chosenCountry, chosenSkin));
  if (!r) return;
  applyState(r.state);
  sfx.expand();
  confetti(pos, 60);
  passInput.value = '';
  setAuthMode('account');
  authMsg('✓ Compte créé : connectez-vous avec cet e-mail sur n’importe quel appareil.');
};
$('logoutBtn').onclick = async () => {
  await api.logout().catch(() => undefined);
  location.reload();
};

/**
 * Bouton Google (si le serveur est configuré) : inscription ou connexion ; dans « Mon compte », liaison au musée.
 * Masqué dans l'application mobile : Google y refuse la connexion (vue web intégrée).
 */
async function mountGoogle(): Promise<void> {
  const wrap = $('googleWrap');
  wrap.hidden = true;
  if (inNativeApp || authMode === 'forgot' || authMode === 'reset') return;
  const linking = authMode === 'account';
  const modeAtStart = authMode;
  if (linking && state?.account.google) {
    $('googleLbl').textContent = '✓ Musée lié à votre compte Google';
    $('googleBox').innerHTML = '';
    wrap.hidden = false;
    return;
  }
  $('googleLbl').textContent = linking ? 'Ou liez votre musée à Google :' : 'ou';
  const ok = await mountGoogleButton($('googleBox'), (credential) => {
    void (async () => {
      try {
        if (linking) {
          const r = await api.linkGoogle(credential);
          applyState(r.state);
          sfx.expand();
          setAuthMode('account');
          authMsg('✓ Musée lié à votre compte Google');
        } else enterWith(await api.loginGoogle(credential));
      } catch (e) {
        sfx.error();
        authMsg((e as Error).message, true);
      }
    })();
  }, linking ? 'continue_with' : authMode === 'login' ? 'signin_with' : 'signup_with');
  wrap.hidden = !ok || authMode !== modeAtStart; // le mode a changé pendant le chargement de Google
}

/** Personnage principal chargé (false : échec). Le formulaire du nom s'affiche sans l'attendre. */
let modelReady: Promise<boolean> = Promise.resolve(false);

async function loadModels(): Promise<boolean> {
  try {
    await loadCharacterModel('/models/human_male.glb');
  } catch {
    try {
      await loadCharacterModel('/models/robot.glb');
    } catch {
      $('loading').textContent = 'Impossible de charger le personnage. Vérifiez votre connexion et rechargez la page.';
      $('loading').hidden = false;
      return false;
    }
  }
  player = new Character();
  player.root.position.copy(pos);
  scene.add(player.root);
  $('loading').remove();
  // tenues de la foule en arrière-plan, puis les passants de la place
  void loadCrowdModels().finally(() => {
    pedestrians.setCount(pedestrianCount());
    rebuildPlayer(); // votre tenue est maintenant disponible
  });
  return true;
}

async function boot(): Promise<void> {
  modelReady = loadModels();
  // lien « nouveau mot de passe » reçu par e-mail : /game/?reset=…
  const reset = new URLSearchParams(location.search).get('reset');
  if (reset) {
    resetToken = reset;
    history.replaceState(null, '', location.pathname);
    $('loading').hidden = true;
    openAuth('reset');
    return;
  }
  if (api.hasSavedSession()) {
    // connexion lancée tout de suite, en parallèle du téléchargement du personnage (démarrage plus rapide) ;
    // en cas d'échec réseau, start() réessaie lui-même
    void api.login().then(
      (r) => start(undefined, undefined, undefined, r),
      () => start(),
    );
    return;
  }
  // nouveau joueur (ou déconnecté) : inscription / connexion pendant que le personnage (≈ 1 Mo) se télécharge
  $('loading').hidden = true;
  openAuth('signup');
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

/** Sauts depuis le dernier contact avec le sol (2 = double saut utilisé). */
let jumps = 0;
let dustAcc = 0;
let airborne = false;

function updatePlayer(dt: number): void {
  if (!player) return;
  const stunned = performance.now() < stunUntil;
  const a = stunned ? { x: 0, y: 0 } : input.axis();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  const dx = -fwd.z * a.x + fwd.x * a.y;
  const dz = fwd.x * a.x + fwd.z * a.y;
  const mag = Math.min(1, Math.hypot(dx, dz));
  // Déplacement réactif style Roblox : réponse nette aux touches et arrêt franc
  const jailed = jailUntil > serverNow();
  // baskets de sprint (boutique) et « super vitesse » : mêmes bonus que ceux que le serveur autorise
  const boost = (1 + (state?.upgrades.speed.value ?? 0)) * (liveKind() === 'vitesse' ? 1.6 : 1);
  const running = input.running();
  const speed = (running ? 8.6 : 5.0) * boost * (heist ? 0.72 : 1) * (stealing || jailed ? 0 : 1);
  // sonné : on glisse sur l'élan du coup reçu, sans pouvoir se diriger ; en l'air, un peu moins de contrôle (élan)
  const air = pos.y > 0.05;
  const responsiveness = stunned ? 3 : mag > 0.05 ? (air ? 11 : 24) : air ? 4 : 20;
  const k = 1 - Math.exp(-responsiveness * dt);
  // au tactile, l'inclinaison du joystick dose la vitesse ; au clavier, pleine vitesse tout de suite
  const amount = Math.min(1, mag * (running ? 1.15 : 1));
  vel.x += ((mag > 0.05 ? (dx / mag) * speed * amount : 0) - vel.x) * k;
  vel.y += ((mag > 0.05 ? (dz / mag) * speed * amount : 0) - vel.y) * k;

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

  // saut, puis double saut en l'air (petit nuage sous les pieds).
  // « Coyote time » (on peut encore sauter 0,1 s après avoir quitté le sol) et saut mémorisé 0,15 s avant d'atterrir :
  // le saut part toujours quand on appuie, il ne « rate » plus.
  const now = performance.now();
  if (pos.y <= 0.001) groundedAt = now;
  const wantJump = input.consume('jump') || (now - input.jumpAt < 150 && pos.y <= 0.001 && jumps === 0 && input.jumpAt > lastJumpAt);
  if (wantJump && !stunned && !stealing && !jailed) {
    if (pos.y <= 0.001 || (now - groundedAt < 100 && jumps === 0)) {
      vy = 8.4;
      jumps = 1;
      lastJumpAt = now;
      sfx.jump();
      squash = -0.22; // étirement au décollage
      dust(pos.clone().setY(floor * FLOOR_H), 4, 0.5);
      tuto.jumps++;
    } else if (jumps === 1) {
      vy = 7.6;
      jumps = 2;
      lastJumpAt = now;
      sfx.jump2();
      squash = -0.18;
      spin = Math.PI * 2; // petite vrille au double saut
      dust(pos.clone().setY(floor * FLOOR_H + pos.y), 6, 0.6);
      tuto.jumps++;
    }
  }
  // gravité plus forte à la descente : saut franc, pas « flottant »
  vy -= (vy > 0 ? 23 : 30) * dt;
  pos.y = Math.max(0, pos.y + vy * dt);
  if (pos.y > 0.05) airborne = true;
  if (pos.y === 0) {
    if (airborne && vy < -4) {
      dust(pos.clone().setY(floor * FLOOR_H), 7, 0.75); // atterrissage
      squash = Math.min(0.3, -vy * 0.025); // écrasement à l'atterrissage
    }
    airborne = false;
    vy = 0;
    jumps = 0;
  }
  // pose en l'air (jambes repliées), écrasement / étirement, vrille du double saut
  airPose += ((pos.y > 0.08 ? 1 : 0) - airPose) * (1 - Math.exp(-dt * (pos.y > 0.08 ? 16 : 22)));
  player.setAir(airPose);
  squash += (0 - squash) * (1 - Math.exp(-dt * 12));
  spin = Math.max(0, spin - dt * 14);
  player.root.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);

  const sp = vel.length();
  if (sp > 0.5 && pos.y === 0) tuto.moved += sp * dt;
  if (sp > 6.2) tuto.runTime += dt;
  // poussière de course
  if (sp > 6.4 && pos.y === 0) {
    dustAcc += dt;
    if (dustAcc > 0.09) {
      dustAcc = 0;
      dust(pos.clone().setY(floor * FLOOR_H).addScaledVector(new THREE.Vector3(vel.x, 0, vel.y).normalize(), -0.3));
    }
  }
  // sonné : il titube (ordre YXZ : l'inclinaison avant se fait dans le repère du personnage)
  player.root.rotation.order = 'YXZ';
  player.root.rotation.z = stunned ? Math.sin(performance.now() / 55) * 0.12 : 0;
  if (sp > 0.25 && !stunned) {
    // Orientation rapide et nette vers la direction de course
    const want = Math.atan2(vel.x, vel.y);
    let d = want - facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    facing += d * Math.min(1, dt * 20);
  }
  const anim = sp > 6.2 ? 'Running' : sp > 0.25 ? 'Walking' : 'Idle';
  player.play(anim);
  // cadence des pas accordée à la vitesse (sinon les pieds glissent et le personnage paraît mou)
  player.setTimeScale(anim === 'Running' ? Math.min(1.5, Math.max(0.95, sp / 7.4)) : anim === 'Walking' ? Math.min(1.45, Math.max(0.8, sp / 3.9)) : 1);
  player.root.position.copy(pos);
  player.root.position.y += floor * FLOOR_H;
  player.root.rotation.y = facing + spin;
  // légère inclinaison vers l'avant en courant
  player.root.rotation.x = stunned ? 0 : Math.min(0.12, sp * 0.011) * (pos.y > 0.05 ? 0.4 : 1);
}

let groundedAt = 0;
let lastJumpAt = 0;
let airPose = 0;
let squash = 0;
let spin = 0;

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
  if (heist && carrying) {
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
  // mains déjà prises par une de vos œuvres (achat ou déplacement) : pas de vol possible
  if (boughtToPlace || reorgSelected) return false;
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

const STEAL_TIME: Record<string, number> = CATALOG.stealSeconds;

let lastCollect = 0;
function interactions(): void {
  if (!state || busy || !myView) return;
  const museum = myView;
  // en cellule : le serveur retient le joueur, aucune autre action possible
  const jailLeft = jailUntil - serverNow();
  if (jailLeft > 0) {
    setPrompt([{ key: '⛓', text: `En cellule encore ${Math.ceil(jailLeft / 1000)} s` }]);
    return;
  }
  const items: Array<{ key: string; text: string; poor?: boolean }> = [];
  // escalier d'abord (on peut le prendre avec une œuvre volée sous le bras)
  if (stairsInteraction(items)) {
    if (heist) theftInteractions(items);
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
  // œuvre en mains devant un emplacement : accrocher passe avant le panneau « Agrandir » (posé tout près d'un mur)
  const held = reorgSelected ?? boughtToPlace;
  const slotFirst = !!held && museum.nearestSlot(pos, 2.2, floor, state.slots, work(held.workId).kind === 'statue') !== null;
  const now = serverNow();
  const marketD = Math.hypot(pos.x - BLACK_MARKET.x, pos.z - BLACK_MARKET.z);
  const shopD = Math.hypot(pos.x - BOUTIQUE.x, pos.z - BOUTIQUE.z);

  const hallD = Math.hypot(pos.x - AUCTION_DOOR.x, pos.z - AUCTION_DOOR.z);

  if (hallD < 3.2) {
    items.push({ key: 'E', text: 'Entrer dans l’hôtel des ventes (enchères)' });
    if (input.consume('action')) enterHall();
  } else if (marketD < 2.8) {
    items.push({ key: 'E', text: 'Marché noir : brouilleur, fumigène, pied-de-biche, leurre, pince, déguisement' });
    if (input.consume('action')) openOverlay('market');
  } else if (shopD < 2.8) {
    items.push({ key: 'E', text: 'Boutique : Lucky coffres, STH coins, améliorations, Renaissance' });
    if (input.consume('action')) openOverlay('shop');
  } else if (lockD < 1.2) {
    if (museum.isLocked(now)) items.push({ key: '🔒', text: `Portes verrouillées encore ${Math.ceil((museum.lockedUntil - now) / 1000)} s` });
    else if (now < museum.lockReadyAt) items.push({ key: '…', text: `Verrou en recharge : ${Math.ceil((museum.lockReadyAt - now) / 1000)} s` });
    else {
      items.push({ key: 'E', text: `Verrouiller les portes ${state.upgrades.lock.value ?? 60} s (personne ne peut entrer ni sortir)` });
      if (input.consume('action')) net.send({ t: 'lock' });
    }
  } else if (truck) {
    const wk = work(truck.item.workId);
    items.push({ key: 'E', text: `Acheter « ${wk.title} » — ${money(truck.item.price)}`, poor: state.coins < truck.item.price });
    if (input.consume('action')) void doBuy(truck.item, truck.truck.artworkWorld());
  } else if (signD < 1.6 && !slotFirst) {
    if (state.next) {
      items.push({ key: 'E', text: `Agrandir : ${state.next.rooms} salles, ${state.next.slots} places — ${money(state.next.cost)}`, poor: state.coins < state.next.cost });
      if (input.consume('action')) void doExpand();
    } else items.push({ key: '✓', text: 'Votre musée est au maximum de cette version' });
  } else if (reorgSelected) {
    let nearSlot = museum.nearestSlot(pos, 2.0, floor, state.slots, work(reorgSelected.workId).kind === 'statue');
    // juste après un échange, on est encore devant l'emplacement rempli : un second appui (double tap au tactile,
    // réseau lent) échangerait aussitôt dans l'autre sens. Il compte de nouveau une fois qu'on s'en est éloigné.
    if (reorgSelected.lockSlot !== undefined) {
      if (nearSlot === reorgSelected.lockSlot) nearSlot = null;
      else reorgSelected.lockSlot = undefined;
    }
    if (nearSlot !== null && nearSlot !== reorgSelected.slot) {
      const occupant = state.artworks.find((a) => a.slot === nearSlot);
      if (occupant) {
        items.push({ key: 'E', text: `Échanger : accrocher « ${work(reorgSelected.workId).title} » et prendre « ${work(occupant.workId).title} » en mains` });
      } else {
        items.push({ key: 'E', text: `Accrocher « ${work(reorgSelected.workId).title} » ici` });
      }
      if (input.consume('action')) void doMove(reorgSelected.uid, nearSlot);
    } else {
      items.push({ key: '…', text: `Transport de « ${work(reorgSelected.workId).title} » : approchez-vous d’un emplacement` });
    }
    items.push({ key: 'Échap', text: reorgSelected.fromSwap ? 'La laisser à la place libérée' : 'Annuler le déplacement' });
  } else if (boughtToPlace) {
    const nearSlot = museum.nearestSlot(pos, 2.2, floor, state.slots, work(boughtToPlace.workId).kind === 'statue');
    if (nearSlot !== null) {
      const occupant = state.artworks.find((a) => a.slot === nearSlot && a.uid !== boughtToPlace?.uid);
      if (occupant) {
        items.push({ key: 'E', text: `Échanger : accrocher « ${work(boughtToPlace.workId).title} » et prendre « ${work(occupant.workId).title} » en mains` });
      } else {
        items.push({ key: 'E', text: `Accrocher « ${work(boughtToPlace.workId).title} » sur ce mur` });
      }
      if (input.consume('action')) void doMove(boughtToPlace.uid, nearSlot);
    } else {
      items.push({ key: '…', text: `Approchez-vous d'un mur dans votre musée pour accrocher « ${work(boughtToPlace.workId).title} »` });
    }
  } else if (art) {
    const gain = art.repro ? 0 : Math.floor(work(art.workId).price * CATALOG.frames[art.frame].mult * 0.5);
    items.push({ key: 'E', text: `Déplacer « ${work(art.workId).title} » (porter en mains)` });
    items.push({ key: 'R', text: art.repro ? `Retirer la reproduction « ${work(art.workId).title} »` : `Revendre « ${work(art.workId).title} » : +${money(gain)}` });
    if (input.consume('action') && !heist) {
      reorgSelected = { uid: art.uid, workId: art.workId, slot: art.slot };
      if (myView) myView.hiddenUid = art.uid;
      setCarry({ workId: art.workId, frame: art.frame });
      toast(`Vous tenez « ${work(art.workId).title} ». Approchez-vous d’un autre emplacement et appuyez sur E.`);
    } else if (input.consume('alt')) void doSell(art.uid);
  } else {
    const currentRoom = museum.contains(pos, floor) ? museum.roomIndexOf(pos, floor) : null;
    if (currentRoom !== null) {
      // R (bouton tactile R) ou T au clavier : les deux ouvrent le décor
      items.push({ key: 'R', text: `Décor de la salle #${currentRoom + 1} (ambiance) · touche T aussi` });
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
  // suivi plus serré (16 au lieu de 10) : la caméra ne traîne plus derrière le personnage
  focus.lerp(target, 1 - Math.exp(-16 * dt));
  const delta = focus.clone().sub(orbit.target);
  orbit.target.add(delta);
  camera.position.add(delta);
  // Caméra automatique : quand le personnage avance et que le joueur ne tourne pas la caméra lui-même,
  // elle se replace doucement derrière lui (sauf s'il court vers la caméra : elle ne fait pas demi-tour).
  const sp = vel.length();
  if (playing && !camDragging && performance.now() - camReleasedAt > 1400 && sp > 1.5 && !stealing) {
    const az = Math.atan2(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z);
    const behind = facing + Math.PI;
    const d = Math.atan2(Math.sin(behind - az), Math.cos(behind - az));
    if (Math.abs(d) < 2.3) {
      const rate = (viewAt() ? 0.8 : 1.7) * Math.min(1, sp / 8);
      const step = d * (1 - Math.exp(-rate * dt));
      const off = camera.position.clone().sub(orbit.target);
      off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, step);
      camera.position.copy(orbit.target).add(off);
    }
  }
  // un peu plus de champ en pleine course : sensation de vitesse
  const fov = BASE_FOV + (sp > 7 ? Math.min(7, (sp - 7) * 2.2) : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();
  }
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

// ================================================================== flèche guide du tutoriel

const guide = new THREE.Group();
{
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xffa21a, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.35 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 20), gold);
  cone.rotation.x = Math.PI; // pointe vers le bas
  cone.position.y = 0.55;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 12), gold);
  shaft.position.y = 1.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2;
  ring.name = 'ring';
  guide.add(cone, shaft, ring);
  guide.visible = false;
  scene.add(guide);
}
const guideTarget = new THREE.Vector3();

/** Tutoriel : faits observés, puis position de la flèche dorée (camion, musée, caisse). */
function updateTutorial(t: number): void {
  if (!tutorial.active || !state) {
    guide.visible = false;
    return;
  }
  const facts: TutoFacts = {
    moved: tuto.moved,
    camTurn: camTurnTotal,
    jumps: tuto.jumps,
    runTime: tuto.runTime,
    owned: state.artworks.length,
    shown: state.artworks.filter((a) => a.slot !== null).length,
    holding: !!(boughtToPlace || reorgSelected),
    collected: tuto.collected,
    inventoryOpened: tuto.inventoryOpened,
    shopOpened: tuto.shopOpened,
  };
  tutorial.update(facts);
  const kind = tutorial.target();
  let at: THREE.Vector3 | null = null;
  if (kind === 'truck') {
    const n = convoy.nearest(pos, 200);
    if (n) at = n.truck.artworkWorld().clone().setY(4.6);
  } else if (kind === 'museum' && myView && !myView.contains(pos, floor)) at = spawnOf(myView.plot).clone().setY(0.2);
  else if (kind === 'register' && myView && floor === 0) at = myView.registerPos.clone().setY(0.15);
  guide.visible = !!at;
  if (!at) return;
  guideTarget.lerp(at, guideTarget.lengthSq() ? 0.2 : 1);
  guide.position.copy(guideTarget);
  guide.children.forEach((c) => {
    if (c.name !== 'ring') c.position.y = (c === guide.children[0] ? 0.55 : 1.5) + 1.2 + Math.sin(t * 4) * 0.3;
  });
  guide.rotation.y = t * 2;
}

// ================================================================== boucle

const clock = new THREE.Clock();
/** Tests visuels (mode développement) : caméra placée à la main, la boucle ne la déplace plus. */
let camFrozen = false;
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
    pedestrians.setCount(pedestrianCount());
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
  if (carryMesh) carryMesh.rotation.z = Math.sin(t * 3) * 0.05; // Léger balancement naturel lors de la marche
  convoy.update(now);
  // étages : on masque ceux au-dessus du joueur, dans le musée où il se trouve
  const here = viewAt();
  for (const v of views.values()) v.setCut(v === here ? floor : 99);
  for (const v of views.values()) v.update(t, dt, now, camera.position, pos);
  if (state && myView) myView.setRegister(cashNow(), state.cashCap, t);
  visitors.update(dt);
  pedestrians.update(dt);
  remotes.update(dt, t);
  // social : bulle du joueur, volume des voix selon la distance, niveau du micro sur le bouton
  if (player) selfAnchor.position.copy(player.root.position);
  selfBubble.update();
  if (voice.enabled) {
    voice.update((id) => remotes.positionOf(id), pos);
    $('voiceBtn').style.setProperty('--mic', voice.micLevel().toFixed(2));
  }
  updateCelebrations(dt);
  guards.update(dt, t);
  updateFx(t);
  updateParticles(t, dt);
  updateRainbow(t);
  rainCoins.update(t);
  district.update(t);
  const alarmOn = performance.now() < alarmUntil;
  $('alert').classList.toggle('on', alarmOn);
  if (state && Math.floor(t) !== Math.floor(t - dt)) {
    renderHud();
    renderTimers();
  }
  updateCoins(dt);
  if (playing) updateTutorial(t);
  if (!camFrozen) updateCamera(dt);
  input.endFrame();
  // secousse (coup reçu) : décalage ajouté le temps du rendu seulement, pour ne pas dériver
  shake = Math.max(0, shake - dt);
  shakeOff.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  camera.position.add(shakeOff);
  renderer.render(scene, camera);
  camera.position.sub(shakeOff);
});

// Accès de test pour tests/smoke.mjs : actif avec le serveur de développement Vite, retiré du build de production
// (build.mjs définit import.meta.env.DEV à false, esbuild élimine alors ce bloc).
if (import.meta.env.DEV) {
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
    pedestrians,
    /** Caméra fixe pour une capture : position (x, y, z) et point visé. `null` rend la main à la caméra du jeu. */
    shoot(at: [number, number, number] | null, look: [number, number, number] = [0, 0, 0]) {
      camFrozen = !!at;
      if (!at) return;
      camera.position.set(...at);
      camera.lookAt(...look);
    },
    /** Personnage de test (foule) posé en (x, z), assis ou debout. */
    testCharacter(x: number, z: number, sit = false, ry = 0) {
      const c = new Character(undefined, { crowd: true });
      c.root.position.set(x, 0, z);
      c.root.rotation.y = ry;
      if (sit) c.play('Sitting', 0);
      scene.add(c.root);
      const tick = () => {
        c.update(1 / 60);
        requestAnimationFrame(tick);
      };
      tick();
      return true;
    },
  };
}

void boot();
