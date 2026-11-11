import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GRID, MAX_ROOMS, MuseumBuilding, THEMES, type Circle, type ThemeId } from './Room';
import { MuseumExhibitor, type Placement } from './MuseumExhibitor';
import { Artifact, SCULPTURE_FORMS, SCULPTURE_MATERIALS } from './Artifact';
import { genThumb, randomGenSpec, renderGenArt } from './art';
import { clearMuseum, loadMuseum, parseMuseum, roomsConnected, saveMuseum } from './storage';
import { createDefaultMuseum } from './defaults';
import * as api from './api';
import { mountLiveBar, setupPwa } from '../shared/live';

mountLiveBar();
setupPwa('../sw.js');
import type { ArtifactConfig, ArtifactType, MuseumData, MuseumSummary, SculptureForm, SculptureMaterial } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SPAWN = new THREE.Vector3(0, 1.7, 4.5);

// ================================================================== rendu

const canvas = $<HTMLCanvasElement>('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);
scene.fog = new THREE.Fog(0x0e0e12, 26, 70);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.35));

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
camera.position.copy(SPAWN);
const listener = new THREE.AudioListener();
camera.add(listener);

const building = new MuseumBuilding(scene);
const controls = new PointerLockControls(camera, canvas);
const exhibitor = new MuseumExhibitor(camera, building.hangables);
const pickRaycaster = new THREE.Raycaster();
pickRaycaster.far = 9;
const CENTER = new THREE.Vector2(0, 0);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Fantômes de prévisualisation (mode édition)
const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.28, depthWrite: false });
const ghostLine = new THREE.LineBasicMaterial({ color: 0xffb454 });
const wallGhost = new THREE.Group();
wallGhost.add(
  new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.05), ghostMat),
  new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.4, 1.05)), ghostLine),
);
const floorGhost = new THREE.Group();
const ped = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.8), ghostMat);
ped.position.y = 0.5;
floorGhost.add(ped, new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.8, 1.0, 0.8)).translate(0, 0.5, 0), ghostLine));
wallGhost.visible = floorGhost.visible = false;
scene.add(wallGhost, floorGhost);

// ================================================================== état

const artifacts = new Map<string, Artifact>();
const artifactsRoot = new THREE.Group();
scene.add(artifactsRoot);

let data: MuseumData = loadMuseum() ?? createDefaultMuseum();
let colliders: Circle[] = [];
let editing = false;
let modalOpen = false;
/** Vrai quand on visite le musée d'un autre : aucune modification ni sauvegarde. */
let readOnly = false;
let visiting: MuseumSummary | null = null;
let selectedRoom = { x: 0, z: 0 };
let saveTimer: number | undefined;

function applyData(d: MuseumData): void {
  data = d;
  for (const a of artifacts.values()) {
    artifactsRoot.remove(a.group);
    a.dispose();
  }
  artifacts.clear();
  building.build(d.rooms);
  d.artifacts.forEach(addArtifact);
  refreshColliders();
  if (building.isBlocked(camera.position.x, camera.position.z, colliders)) camera.position.copy(SPAWN);
  selectedRoom = { x: 0, z: 0 };
  renderMenu();
}

function addArtifact(cfg: ArtifactConfig): Artifact {
  const a = new Artifact(cfg, listener);
  artifacts.set(cfg.id, a);
  artifactsRoot.add(a.group);
  return a;
}

function removeArtifact(id: string): void {
  const a = artifacts.get(id);
  if (!a) return;
  artifactsRoot.remove(a.group);
  a.dispose();
  artifacts.delete(id);
}

function refreshColliders(): void {
  colliders = [...artifacts.values()].map((a) => a.collider).filter((c): c is Circle => !!c);
}

function syncArtifacts(): void {
  data.artifacts = [...artifacts.values()].map((a) => a.config);
}

function queueSave(): void {
  if (readOnly) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    syncArtifacts();
    if (!saveMuseum(data)) toast('Stockage local plein : publiez ou exportez votre musée');
  }, 300);
}

const roomIndex = (x: number, z: number) => data.rooms.findIndex((r) => r.x === x && r.z === z);
const cellOfArtifact = (a: ArtifactConfig) => building.cellOf(a.position[0], a.position[2]);

// ================================================================== menu : plan & salles

const planEl = $('plan');
const themesRow = $('themes');

for (const [id, t] of Object.entries(THEMES) as Array<[ThemeId, (typeof THEMES)[ThemeId]]>) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.dataset.theme = id;
  b.innerHTML = `<span class="swatch" style="background:${t.swatch}"></span>`;
  b.append(t.label);
  b.onclick = () => {
    const i = roomIndex(selectedRoom.x, selectedRoom.z);
    if (i < 0 || readOnly) return;
    data.rooms[i].theme = id;
    building.build(data.rooms);
    queueSave();
    renderPlan();
  };
  themesRow.appendChild(b);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function renderPlan(): void {
  planEl.innerHTML = '';
  const me = building.cellOf(camera.position.x, camera.position.z);
  const canAdd = !readOnly && data.rooms.length < MAX_ROOMS;
  for (let z = -GRID; z <= GRID; z++) {
    for (let x = -GRID; x <= GRID; x++) {
      const room = data.rooms.find((r) => r.x === x && r.z === z);
      const neighbor = data.rooms.some((r) => Math.abs(r.x - x) + Math.abs(r.z - z) === 1);
      const el = document.createElement(room || (canAdd && neighbor) ? 'button' : 'div');
      el.className = 'pc';
      if (room) {
        const sw = THEMES[room.theme].swatch;
        el.classList.add('room');
        if (luminance(sw) < 0.5) el.classList.add('dark');
        if (x === selectedRoom.x && z === selectedRoom.z) el.classList.add('sel');
        el.style.background = sw;
        el.textContent = String(roomIndex(x, z) + 1);
        el.title = `Salle ${roomIndex(x, z) + 1} · ${THEMES[room.theme].label}`;
        if (x === 0 && z === 0) el.insertAdjacentHTML('beforeend', '<span class="entry">entrée</span>');
        if (me.x === x && me.z === z) el.insertAdjacentHTML('beforeend', '<span class="me" title="Vous êtes ici"></span>');
        el.onclick = () => {
          selectedRoom = { x, z };
          renderPlan();
        };
      } else if (canAdd && neighbor) {
        el.classList.add('add');
        el.textContent = '+';
        el.title = 'Ajouter une salle ici';
        el.onclick = () => addRoom(x, z);
      }
      planEl.appendChild(el);
    }
  }
  const sel = data.rooms[roomIndex(selectedRoom.x, selectedRoom.z)];
  const count = data.artifacts.filter((a) => {
    const c = cellOfArtifact(a);
    return c.x === selectedRoom.x && c.z === selectedRoom.z;
  }).length;
  $('roomInfo').textContent = sel
    ? `Salle ${roomIndex(sel.x, sel.z) + 1} · ${THEMES[sel.theme].label} · ${count} œuvre${count > 1 ? 's' : ''} — ${data.rooms.length}/${MAX_ROOMS} salles`
    : '';
  themesRow.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === sel?.theme));
  $<HTMLButtonElement>('removeRoom').disabled = !sel || (sel.x === 0 && sel.z === 0);
}

function addRoom(x: number, z: number): void {
  if (readOnly || data.rooms.length >= MAX_ROOMS) return;
  const theme = data.rooms[roomIndex(selectedRoom.x, selectedRoom.z)]?.theme ?? 'modern';
  data.rooms.push({ x, z, theme });
  building.build(data.rooms);
  selectedRoom = { x, z };
  queueSave();
  renderPlan();
  toast(`Salle ${data.rooms.length} ajoutée`);
}

$('removeRoom').onclick = () => {
  const { x, z } = selectedRoom;
  if (readOnly || (x === 0 && z === 0)) return;
  const rest = data.rooms.filter((r) => !(r.x === x && r.z === z));
  if (!roomsConnected(rest)) return toast('Impossible : cette salle relie d’autres salles à l’entrée.');
  syncArtifacts();
  const inside = data.artifacts.filter((a) => {
    const c = cellOfArtifact(a);
    return c.x === x && c.z === z;
  });
  if (inside.length && !confirm(`Supprimer la salle et ses ${inside.length} œuvre(s) ?`)) return;
  inside.forEach((a) => removeArtifact(a.id));
  data.rooms = rest;
  syncArtifacts();
  building.build(data.rooms);
  refreshColliders();
  if (building.isBlocked(camera.position.x, camera.position.z, colliders)) camera.position.copy(SPAWN);
  selectedRoom = { x: 0, z: 0 };
  queueSave();
  renderPlan();
};

$('enter').onclick = () => controls.lock();

$('export').onclick = () => {
  syncArtifacts();
  const { remote: _r, ...pub } = data;
  const url = URL.createObjectURL(new Blob([JSON.stringify(pub)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'memory-museum.json';
  a.click();
  URL.revokeObjectURL(url);
};
$('import').onclick = () => $<HTMLInputElement>('importFile').click();
$<HTMLInputElement>('importFile').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || readOnly) return;
  try {
    const parsed = parseMuseum(JSON.parse(await file.text()));
    if (!parsed) throw new Error('format');
    parsed.remote = data.remote;
    applyData(parsed);
    queueSave();
    toast('Musée importé');
  } catch {
    toast('Fichier invalide');
  }
};
$('reset').onclick = () => {
  if (readOnly) return;
  if (!confirm('Revenir au musée de départ ? Vos salles et œuvres seront effacées.')) return;
  clearMuseum();
  const fresh = createDefaultMuseum();
  fresh.remote = data.remote;
  applyData(fresh);
  queueSave();
  toast('Musée réinitialisé');
};

// ---------------------------------------------------------------- onglets

let activeTab = 'plan';
document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
  t.onclick = () => showTab(t.dataset.tab!);
});
function showTab(name: string): void {
  activeTab = name;
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name === 'explore') void loadExplore();
  if (name === 'plan') renderPlan();
}

function renderMenu(): void {
  $('museumTitle').textContent = readOnly ? data.name || 'Musée sans nom' : 'Mon musée';
  $('museumSub').textContent = readOnly
    ? `Un musée de ${data.author || 'anonyme'} · ${data.rooms.length} salle(s) · ${data.artifacts.length} œuvre(s)`
    : 'Votre galerie personnelle : agrandissez-la, accrochez vos souvenirs, visitez celles des autres.';
  $('visitBar').hidden = !readOnly;
  $('roomEdit').hidden = readOnly;
  $('dataRow').hidden = readOnly;
  (document.querySelector('[data-tab=publish]') as HTMLElement).hidden = readOnly;
  $<HTMLInputElement>('pubName').value = data.name;
  $<HTMLInputElement>('pubAuthor').value = data.author;
  $('publish').textContent = data.remote ? 'Mettre à jour la publication' : 'Publier mon musée';
  if (data.remote) showShareLink(data.remote.id);
  if (readOnly && activeTab === 'publish') showTab('plan');
  renderPlan();
}

// ---------------------------------------------------------------- publication

$<HTMLInputElement>('pubName').oninput = (e) => {
  data.name = (e.target as HTMLInputElement).value.slice(0, 40);
  queueSave();
};
$<HTMLInputElement>('pubAuthor').oninput = (e) => {
  data.author = (e.target as HTMLInputElement).value.slice(0, 30);
  queueSave();
};

function shareUrlFor(id: string): string {
  return `${location.origin}${location.pathname}?m=${id}`;
}
function showShareLink(id: string): void {
  $<HTMLInputElement>('shareLink').value = shareUrlFor(id);
  $('shareRow').hidden = false;
}
$('copyLink').onclick = async () => {
  try {
    await navigator.clipboard.writeText($<HTMLInputElement>('shareLink').value);
    toast('Lien copié');
  } catch {
    $<HTMLInputElement>('shareLink').select();
  }
};

/** Vignette 16:9 prise depuis l'entrée du musée. */
function captureThumbnail(): string {
  const cam = new THREE.PerspectiveCamera(72, canvas.width / canvas.height, 0.05, 120);
  cam.position.set(0, 1.8, 5.6);
  cam.lookAt(0, 1.8, -8);
  const ghosts = [wallGhost.visible, floorGhost.visible];
  wallGhost.visible = floorGhost.visible = false;
  renderer.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = 480;
  out.height = 270;
  const g = out.getContext('2d')!;
  const sw = canvas.width;
  const sh = Math.min(canvas.height, (sw * 9) / 16);
  g.drawImage(canvas, 0, (canvas.height - sh) / 2, sw, sh, 0, 0, 480, 270);
  [wallGhost.visible, floorGhost.visible] = ghosts;
  return out.toDataURL('image/jpeg', 0.8);
}

$('publish').onclick = async () => {
  if (readOnly) return;
  if (!data.name.trim()) {
    $<HTMLInputElement>('pubName').focus();
    return toast('Donnez un nom à votre musée');
  }
  syncArtifacts();
  const status = $('pubStatus');
  status.textContent = 'Publication…';
  try {
    const thumb = captureThumbnail();
    if (data.remote) {
      try {
        await api.updateMuseum(data, thumb);
      } catch (e) {
        if ((e as { status?: number }).status !== 404 && (e as { status?: number }).status !== 403) throw e;
        data.remote = await api.publishMuseum(data, thumb);
      }
    } else {
      data.remote = await api.publishMuseum(data, thumb);
    }
    queueSave();
    showShareLink(data.remote.id);
    $('publish').textContent = 'Mettre à jour la publication';
    status.textContent = 'Publié ✓';
    toast('Musée publié : il est visible dans « Explorer »');
  } catch (e) {
    status.textContent = '';
    toast(e instanceof TypeError ? 'Serveur indisponible (lancez « npm run server »)' : `Échec : ${(e as Error).message}`);
  }
};

// ---------------------------------------------------------------- exploration

let sort: 'popular' | 'recent' = 'popular';
document.querySelectorAll<HTMLElement>('#sortChips .chip').forEach((c) => {
  c.onclick = () => {
    sort = c.dataset.sort as typeof sort;
    document.querySelectorAll('#sortChips .chip').forEach((x) => x.classList.toggle('active', x === c));
    void loadExplore();
  };
});
$('refreshList').onclick = () => void loadExplore();

/** Vignette de secours : une œuvre générée propre à chaque musée. */
function fallbackThumb(id: string): string {
  return `url("${genThumb(id)}")`;
}

async function loadExplore(): Promise<void> {
  const list = $('exploreList');
  list.innerHTML = '<div class="empty">Chargement…</div>';
  let museums: MuseumSummary[];
  try {
    museums = await api.listMuseums(sort);
  } catch {
    list.innerHTML = '<div class="empty">Serveur indisponible. Lancez « npm run server » (ou « npm start »).</div>';
    return;
  }
  list.innerHTML = '';
  if (!museums.length) {
    list.innerHTML = '<div class="empty">Aucun musée publié pour l’instant. Soyez le premier !</div>';
    return;
  }
  for (const m of museums) {
    const card = document.createElement('article');
    card.className = 'mcard';
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.backgroundImage = m.hasThumb ? `url("${api.thumbUrl(m.id)}"), ${fallbackThumb(m.id)}` : fallbackThumb(m.id);
    const b = document.createElement('div');
    b.className = 'b';
    if (data.remote?.id === m.id && !readOnly) {
      const mine = document.createElement('span');
      mine.className = 'mine';
      mine.textContent = 'Votre musée';
      b.appendChild(mine);
    }
    const h3 = document.createElement('h3');
    h3.textContent = m.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `par ${m.author || 'anonyme'} · ${m.rooms} salle(s) · ${m.artifacts} œuvre(s) · ♥ ${m.likes} · 👁 ${m.views}`;
    const go = document.createElement('button');
    go.className = 'btn primary';
    go.textContent = 'Visiter';
    go.style.marginTop = 'auto';
    go.onclick = () => (location.href = `?m=${encodeURIComponent(m.id)}`);
    b.append(h3, meta, go);
    card.append(thumb, b);
    list.appendChild(card);
  }
}

// ---------------------------------------------------------------- visite d'un musée publié

const likedKey = 'mm-liked';
function likedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(likedKey) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function renderVisitBar(): void {
  if (!visiting) return;
  const v = visiting;
  $('visitInfo').textContent = `Vous visitez « ${v.name} » de ${v.author || 'anonyme'} · 👁 ${v.views}`;
  $('likeCount').textContent = String(v.likes);
  const liked = likedSet().has(v.id);
  $('likeBtn').classList.toggle('liked', liked);
  $<HTMLButtonElement>('likeBtn').disabled = liked;
  $('roomTag').dataset.visit = `${v.name} — ${v.author || 'anonyme'}`;
  lastCellKey = '';
}

async function loadSharedMuseum(id: string): Promise<void> {
  $('enter').textContent = 'Chargement du musée…';
  try {
    const { museum, meta } = await api.getMuseum(id);
    const parsed = parseMuseum(museum);
    if (!parsed) throw new Error('format');
    readOnly = true;
    visiting = meta;
    applyData(parsed);
    renderVisitBar();
    toast(`Bienvenue dans « ${meta.name} »`);
  } catch {
    toast('Musée introuvable : retour au vôtre');
    history.replaceState(null, '', location.pathname);
  }
  $('enter').textContent = 'Entrer dans la galerie';
}

$('likeBtn').onclick = async () => {
  if (!visiting) return;
  try {
    const { likes } = await api.likeMuseum(visiting.id);
    visiting.likes = likes;
    const s = likedSet();
    s.add(visiting.id);
    localStorage.setItem(likedKey, JSON.stringify([...s]));
  } catch {
    toast('Impossible d’aimer ce musée pour le moment');
  }
  renderVisitBar();
};

$('copyShared').onclick = () => {
  if (!readOnly) return;
  if (!confirm('Remplacer votre musée par une copie de celui-ci ?')) return;
  const own = loadMuseum();
  readOnly = false;
  visiting = null;
  data.name = `${data.name} (copie)`.slice(0, 40);
  data.author = own?.author ?? '';
  data.remote = own?.remote;
  history.replaceState(null, '', location.pathname);
  queueSave();
  renderMenu();
  toast('Copie enregistrée : c’est maintenant votre musée');
};

// ================================================================== contrôles

controls.addEventListener('lock', () => {
  $('menu').classList.remove('open');
  document.body.classList.add('playing');
  void listener.context.resume();
  artifacts.forEach((a) => a.startAudio());
  updateModeUi();
});
// Si le navigateur refuse le verrouillage du pointeur, on ne laisse pas le joueur sans interface.
controls.addEventListener('error' as never, () => {
  modalOpen = false;
  $('modal').classList.remove('open');
  $('menu').classList.add('open');
});
controls.addEventListener('unlock', () => {
  document.body.classList.remove('playing');
  wallGhost.visible = floorGhost.visible = false;
  if (!modalOpen) {
    $('enter').textContent = 'Reprendre la visite';
    $('menu').classList.add('open');
    renderPlan();
  }
});

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && modalOpen) return closeModal();
  if (!controls.isLocked) return;
  keys.add(e.code);
  if (e.code === 'KeyE' && !e.repeat) {
    if (readOnly) return toast('Vous visitez un musée : créez votre copie pour le modifier');
    editing = !editing;
    updateModeUi();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function updateModeUi(): void {
  document.body.classList.toggle('editing', editing);
  $('mode').textContent = editing ? 'Mode édition' : readOnly ? 'Visite' : 'Visite · E pour éditer';
  $('hint').textContent = editing
    ? 'Mur : accrocher · Sol : sculpture · Œuvre : modifier · E : quitter'
    : 'Échap : plan du musée, publier, explorer';
}

const vel = new THREE.Vector3();
let lastCellKey = '';
function move(dt: number): void {
  if (!controls.isLocked) return;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7 : 4;
  const len = Math.hypot(f, r) || 1;
  const k = 1 - Math.exp(-10 * dt);
  vel.x += ((r / len) * speed - vel.x) * k;
  vel.z += ((f / len) * speed - vel.z) * k;

  const prev = camera.position.clone();
  controls.moveRight(vel.x * dt);
  controls.moveForward(vel.z * dt);
  const next = camera.position;
  if (building.isBlocked(next.x, next.z, colliders)) {
    if (!building.isBlocked(next.x, prev.z, colliders)) next.z = prev.z;
    else if (!building.isBlocked(prev.x, next.z, colliders)) next.x = prev.x;
    else next.set(prev.x, next.y, prev.z);
  }
  // léger balancement de marche
  const moving = Math.hypot(vel.x, vel.z);
  next.y = 1.7 + Math.sin(performance.now() / 160) * 0.025 * Math.min(1, moving / 4);
  updateRoomTag();
}

function updateRoomTag(): void {
  const c = building.cellOf(camera.position.x, camera.position.z);
  const k = `${c.x},${c.z}`;
  if (k === lastCellKey) return;
  lastCellKey = k;
  const room = building.get(c.x, c.z);
  if (!room) return;
  const tag = $('roomTag');
  tag.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = `Salle ${roomIndex(c.x, c.z) + 1}`;
  tag.append(b, ` · ${THEMES[room.theme].label}`);
  if (tag.dataset.visit) tag.append(` · ${tag.dataset.visit}`);
}

// ================================================================== édition

function pickArtifact(): string | null {
  pickRaycaster.setFromCamera(CENTER, camera);
  const hit = pickRaycaster.intersectObjects(artifactsRoot.children, true)[0];
  // une œuvre plus loin qu'un mur ne doit pas être sélectionnée à travers lui
  const wall = pickRaycaster.intersectObjects(building.hangables, false)[0];
  if (!hit || (wall && wall.distance < hit.distance - 0.05)) return null;
  let o: THREE.Object3D | null = hit.object;
  while (o) {
    if (o.userData.artifactId) return o.userData.artifactId as string;
    o = o.parent;
  }
  return null;
}

function placementValid(p: Placement): boolean {
  return p.kind === 'wall' || building.canPlaceFloor(p.position.x, p.position.z, colliders);
}

function updateGhost(): void {
  wallGhost.visible = floorGhost.visible = false;
  if (!controls.isLocked || !editing || modalOpen || pickArtifact()) return;
  const p = exhibitor.calculatePlacement(CENTER);
  if (!p) return;
  const g = p.kind === 'wall' ? wallGhost : floorGhost;
  g.visible = true;
  g.position.copy(p.position);
  g.rotation.copy(p.rotation);
  const color = placementValid(p) ? 0xffb454 : 0xff4d4d;
  ghostMat.color.setHex(color);
  ghostLine.color.setHex(color);
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !controls.isLocked || !editing || modalOpen) return;
  const id = pickArtifact();
  if (id) return openModal({ kind: 'edit', id });
  const p = exhibitor.calculatePlacement(CENTER);
  if (!p) return;
  if (!placementValid(p)) return toast('Trop près d’un mur, d’une porte ou d’un meuble');
  openModal({ kind: 'create', placement: p });
});

// ---------------------------------------------------------------- fenêtre d'œuvre

type Pending = { kind: 'create'; placement: Placement } | { kind: 'edit'; id: string };
let pending: Pending | null = null;
let chosenType: ArtifactType = 'PHOTO';
let genSpec: string | null = null;
let chosenForm: SculptureForm = 'knot';
let chosenMat: SculptureMaterial = 'marble';

const form = $<HTMLFormElement>('form');
const photoFile = $<HTMLInputElement>('photoFile');
const audioFile = $<HTMLInputElement>('audioFile');
const titleInput = $<HTMLInputElement>('title');
const scaleInput = $<HTMLInputElement>('scale');
const spotInput = $<HTMLInputElement>('spot');
const genPreview = $<HTMLImageElement>('genPreview');

function buildChips<T extends string>(el: HTMLElement, entries: Array<[T, string, string?]>, onPick: (v: T) => void): void {
  for (const [value, label, swatch] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.v = value;
    if (swatch) b.innerHTML = `<span class="swatch" style="background:${swatch}"></span>`;
    b.append(label);
    b.onclick = () => onPick(value);
    el.appendChild(b);
  }
}
const markChips = (el: HTMLElement, v: string) => el.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.classList.toggle('active', c.dataset.v === v));

buildChips($('formChips'), Object.entries(SCULPTURE_FORMS) as Array<[SculptureForm, string]>, (v) => {
  chosenForm = v;
  markChips($('formChips'), v);
});
buildChips(
  $('matChips'),
  (Object.entries(SCULPTURE_MATERIALS) as Array<[SculptureMaterial, { label: string; swatch: string }]>).map(([k, m]) => [k, m.label, m.swatch]),
  (v) => {
    chosenMat = v;
    markChips($('matChips'), v);
  },
);

function setType(t: ArtifactType): void {
  chosenType = t;
  $('typeRow').querySelectorAll<HTMLElement>('.chip').forEach((b) => b.classList.toggle('active', b.dataset.type === t));
  $('photoBox').hidden = t !== 'PHOTO';
  $('audioBox').hidden = t !== 'AUDIO';
  $('sculptBox').hidden = t !== 'SCULPTURE';
}
$('typeRow').querySelectorAll<HTMLElement>('.chip').forEach((b) => (b.onclick = () => setType(b.dataset.type as ArtifactType)));
scaleInput.oninput = () => ($('scaleVal').textContent = `${Number(scaleInput.value).toFixed(1)}×`);

function showGenPreview(spec: string | null): void {
  genSpec = spec;
  genPreview.hidden = !spec;
  if (spec) genPreview.src = renderGenArt(spec).toDataURL('image/jpeg', 0.8);
}
$('genBtn').onclick = () => {
  photoFile.value = '';
  showGenPreview(randomGenSpec());
};
photoFile.onchange = () => {
  if (photoFile.files?.length) showGenPreview(null);
};

function openModal(p: Pending): void {
  pending = p;
  modalOpen = true;
  controls.unlock();
  form.reset();
  photoFile.value = audioFile.value = '';
  showGenPreview(null);
  const isEdit = p.kind === 'edit';
  const cfg = isEdit ? artifacts.get(p.id)!.config : null;
  const type: ArtifactType = cfg ? cfg.type : p.kind === 'create' && p.placement.kind === 'floor' ? 'SCULPTURE' : 'PHOTO';
  $('mTitle').textContent = isEdit ? 'Modifier l’œuvre' : type === 'SCULPTURE' ? 'Nouvelle sculpture' : 'Nouvelle œuvre murale';
  $('typeRow').hidden = isEdit || type === 'SCULPTURE';
  $('delete').hidden = !isEdit;
  setType(type);
  chosenForm = cfg?.form ?? 'knot';
  chosenMat = cfg?.material ?? 'marble';
  markChips($('formChips'), chosenForm);
  markChips($('matChips'), chosenMat);
  titleInput.value = cfg?.title ?? '';
  scaleInput.value = String(cfg?.scale ?? 1);
  spotInput.checked = cfg?.spot ?? true;
  $('scaleVal').textContent = `${Number(scaleInput.value).toFixed(1)}×`;
  $('menu').classList.remove('open');
  $('modal').classList.add('open');
}

function closeModal(): void {
  modalOpen = false;
  pending = null;
  $('modal').classList.remove('open');
  controls.lock();
}

$('cancel').onclick = closeModal;
$('delete').onclick = () => {
  if (pending?.kind !== 'edit') return;
  removeArtifact(pending.id);
  refreshColliders();
  queueSave();
  closeModal();
};

form.onsubmit = async (e) => {
  e.preventDefault();
  if (!pending) return;
  try {
    let url: string | undefined;
    if (chosenType === 'PHOTO') {
      const file = photoFile.files?.[0];
      if (file) {
        if (!file.type.startsWith('image/')) throw new Error('Choisissez une image.');
        url = await imageToDataURL(file);
      } else if (genSpec) url = genSpec;
    } else if (chosenType === 'AUDIO') {
      const file = audioFile.files?.[0];
      if (file) {
        if (!file.type.startsWith('audio/')) throw new Error('Choisissez un fichier audio.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Fichier audio trop lourd (8 Mo max).');
        url = await readAsDataURL(file);
      }
    } else url = '';

    const common = {
      title: titleInput.value.trim(),
      scale: Number(scaleInput.value),
      spot: spotInput.checked,
      ...(chosenType === 'SCULPTURE' ? { form: chosenForm, material: chosenMat } : {}),
    };

    if (pending.kind === 'create') {
      if (url === undefined) throw new Error(chosenType === 'PHOTO' ? 'Ajoutez une image ou générez une œuvre.' : 'Ajoutez un fichier audio.');
      const p = pending.placement;
      addArtifact({
        id: crypto.randomUUID(), type: chosenType, url, ...common,
        position: p.position.toArray() as [number, number, number],
        rotation: [p.rotation.x, p.rotation.y, p.rotation.z],
      });
    } else {
      const a = artifacts.get(pending.id)!;
      Object.assign(a.config, common);
      if (url) a.config.url = url;
      a.rebuild();
    }
    refreshColliders();
    queueSave();
    closeModal();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Erreur de chargement');
  }
};

async function imageToDataURL(file: File, max = 1280): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.84);
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('Lecture du fichier impossible'));
    r.readAsDataURL(file);
  });
}

// ================================================================== démarrage

let toastTimer: number | undefined;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}

applyData(data);
const sharedId = new URLSearchParams(location.search).get('m');
if (sharedId) void loadSharedMuseum(sharedId);
updateModeUi();

// Accès de test (jamais inclus dans le build de production)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__museum = { camera, artifacts, controls, building, data: () => data };
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  move(dt);
  updateGhost();
  const t = clock.elapsedTime;
  artifacts.forEach((a) => a.update(t, dt));
  renderer.render(scene, camera);
});
