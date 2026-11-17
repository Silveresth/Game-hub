// Thème du monde (saisons) choisi par l'admin : couleurs du ciel, du sol et de la lumière, décor animé de la place
// (grand sapin et bonshommes de neige, citrouilles et fantômes, œufs et fleurs, palmiers et parasols, ballons et gâteau)
// et particules qui tombent du ciel (neige, feuilles, pétales, confettis).
import * as THREE from 'three';
import { CATALOG, type SeasonDef, type SeasonId } from './catalog';
import type { SeasonState } from './api';
import type { Quality } from './quality';
import { tierOf } from './quality';
import { DECO_CENTER, DECO_SPOTS, type District } from './district';

export interface SeasonLights {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fog: THREE.Fog;
  /** Intensités de base (thème classique). */
  base: { hemi: number; sun: number };
}

type Anim = (t: number, dt: number) => void;

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Matériau partagé par couleur (le décor des saisons en utilise beaucoup de petits). */
function mat(color: number | string, opts: { emissive?: number | string; ei?: number; rough?: number; metal?: number; flat?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = JSON.stringify([color, opts]);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.05, flatShading: !!opts.flat,
      ...(opts.emissive !== undefined ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 0.8 } : {}),
    });
    matCache.set(key, m);
  }
  return m;
}

const PARTY = [0xff3b5c, 0x2ec4f1, 0x3ddc84, 0xffd23f, 0xb46bff, 0xff8c42];
const pick = <T,>(a: T[], i: number) => a[i % a.length];

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/** Texture rayée (œufs, parasols) : bandes de couleurs. */
function stripes(colors: string[], vertical = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const n = colors.length * 2;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    if (vertical) g.fillRect((i * 128) / n, 0, 128 / n + 1, 128);
    else g.fillRect(0, (i * 128) / n, 128, 128 / n + 1);
  }
  // pois blancs : plus « fête »
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.arc((i * 47) % 128, (i * 29) % 128, 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ éléments de décor

/** Sapin de Noël : étages de cônes, boules, guirlande lumineuse qui clignote, étoile qui tourne. */
function christmasTree(scale: number, anims: Anim[], lights = 40): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 10), mat(0x6b4226), 0, 0.7, 0));
  const green = mat(0x1f8a43, { flat: true, rough: 0.8 });
  const snowTip = mat(0xf4f9ff, { rough: 0.9 });
  const tiers = [[3.0, 2.8, 1.4], [2.4, 2.5, 3.1], [1.75, 2.2, 4.6], [1.05, 1.9, 5.9]];
  for (const [r, h, y] of tiers) {
    g.add(mesh(new THREE.ConeGeometry(r, h, 9), green, 0, y, 0));
    const tip = mesh(new THREE.ConeGeometry(r * 0.32, h * 0.3, 9), snowTip, 0, y + h * 0.36, 0);
    g.add(tip);
  }
  // boules
  const ball = new THREE.SphereGeometry(0.17, 12, 10);
  const balls = [0xe2333b, 0xffd23f, 0x2e8bff, 0xd9dde6, 0xb46bff];
  for (let i = 0; i < 26; i++) {
    const tier = tiers[i % tiers.length];
    const a = i * 2.4;
    const k = 0.35 + ((i * 7) % 5) / 8;
    const r = tier[0] * (1 - k) * 0.95 + 0.1;
    g.add(mesh(ball, mat(pick(balls, i), { metal: 0.6, rough: 0.25 }), Math.cos(a) * r, tier[2] - tier[1] / 2 + k * tier[1], Math.sin(a) * r));
  }
  // guirlande lumineuse : des ampoules dont la couleur change en vagues
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), lights);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < lights; i++) {
    const f = i / lights;
    const y = 1.2 + f * 5.6;
    const r = 3.0 * (1 - f) + 0.25;
    const a = f * Math.PI * 9;
    m4.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r);
    bulbs.setMatrixAt(i, m4);
    bulbs.setColorAt(i, new THREE.Color(0xffffff));
  }
  g.add(bulbs);
  const LIGHT = [0xff3b3b, 0xffd23f, 0x3ddc84, 0x2ec4f1, 0xff6fd8].map((c) => new THREE.Color(c));
  let acc = 0;
  let step = 0;
  anims.push((_t, dt) => {
    acc += dt;
    if (acc < 0.35) return;
    acc = 0;
    step++;
    for (let i = 0; i < lights; i++) bulbs.setColorAt(i, LIGHT[(i + step) % LIGHT.length]);
    bulbs.instanceColor!.needsUpdate = true;
  });
  // étoile dorée au sommet
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.28 : 0.62;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const star = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false }), mat(0xffd23f, { emissive: 0xffb300, ei: 1.2, metal: 0.4 }), 0, 7.2, 0);
  g.add(star);
  anims.push((t) => (star.rotation.y = t * 1.2));
  g.scale.setScalar(scale);
  return g;
}

/** Cadeaux emballés avec ruban et nœud. */
function giftPile(n: number, spread: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const s = 0.55 + ((i * 13) % 5) * 0.12;
    const c = pick(PARTY, i);
    const c2 = pick([0xffffff, 0xffd23f, 0xe2333b], i);
    const a = (i / n) * Math.PI * 2 + 0.3;
    const r = spread * (0.75 + ((i * 7) % 3) * 0.12);
    const box = new THREE.Group();
    box.add(mesh(new THREE.BoxGeometry(s, s, s), mat(c), 0, s / 2, 0));
    box.add(mesh(new THREE.BoxGeometry(s + 0.03, s + 0.03, s * 0.2), mat(c2), 0, s / 2, 0));
    box.add(mesh(new THREE.BoxGeometry(s * 0.2, s + 0.03, s + 0.03), mat(c2), 0, s / 2, 0));
    const knot = mesh(new THREE.TorusGeometry(s * 0.18, s * 0.06, 8, 14), mat(c2), 0, s + 0.08, 0);
    box.add(knot);
    box.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    box.rotation.y = a * 1.7;
    g.add(box);
  }
  return g;
}

/** Bonhomme de neige avec écharpe, nez-carotte et chapeau (il se dandine). */
function snowman(anims: Anim[], seed: number): THREE.Group {
  const g = new THREE.Group();
  const snow = mat(0xf7fbff, { rough: 0.9 });
  g.add(mesh(new THREE.SphereGeometry(0.75, 18, 14), snow, 0, 0.7, 0));
  g.add(mesh(new THREE.SphereGeometry(0.55, 18, 14), snow, 0, 1.75, 0));
  const head = new THREE.Group();
  head.position.y = 2.55;
  head.add(mesh(new THREE.SphereGeometry(0.4, 18, 14), snow));
  const coal = mat(0x1a1a1f);
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), coal, s * 0.14, 0.1, 0.36));
  const nose = mesh(new THREE.ConeGeometry(0.07, 0.38, 8), mat(0xff7a1a), 0, 0, 0.5);
  nose.rotation.x = Math.PI / 2;
  head.add(nose);
  head.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16), coal, 0, 0.3, 0));
  head.add(mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.45, 16), coal, 0, 0.55, 0));
  g.add(head);
  const scarf = mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 20), mat(0xe2333b), 0, 2.2, 0);
  scarf.rotation.x = Math.PI / 2;
  g.add(scarf);
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), coal, 0, 1.55 + i * 0.22, 0.53 - Math.abs(i - 1) * 0.03));
  anims.push((t) => (g.rotation.z = Math.sin(t * 2 + seed) * 0.05));
  return g;
}

/** Citrouille côtelée ; `face` : yeux et bouche qui brillent (lanterne). */
function pumpkin(r: number, face: boolean, anims: Anim[], seed: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(r, 24, 16);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 + Math.cos(a * 8) * 0.06; // côtes
    p.setXYZ(i, v.x * k, v.y * 0.78, v.z * k);
  }
  geo.computeVertexNormals();
  g.add(mesh(geo, mat(0xff7a1a, { rough: 0.55 }), 0, r * 0.78, 0));
  const stem = mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.12, r * 0.4, 8), mat(0x3f7a2a), 0, r * 1.62, 0);
  stem.rotation.z = 0.2;
  g.add(stem);
  if (face) {
    const glow = mat(0xffd23f, { emissive: 0xff9a00, ei: 1.4 });
    const tri = (w: number, h: number, flip = false) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, flip ? h / 2 : -h / 2);
      s.lineTo(w / 2, flip ? h / 2 : -h / 2);
      s.lineTo(0, flip ? -h / 2 : h / 2);
      s.closePath();
      return new THREE.ShapeGeometry(s);
    };
    const z = r * 0.985;
    for (const sx of [-1, 1]) {
      const eye = mesh(tri(r * 0.32, r * 0.3), glow, sx * r * 0.32, r * 0.98, z);
      g.add(eye);
    }
    const mouth = new THREE.Shape();
    mouth.moveTo(-r * 0.5, 0);
    for (let i = 0; i <= 6; i++) mouth.lineTo(-r * 0.5 + (i * r) / 6, i % 2 ? -r * 0.12 : 0);
    mouth.lineTo(r * 0.4, -r * 0.22);
    mouth.quadraticCurveTo(0, -r * 0.42, -r * 0.4, -r * 0.22);
    mouth.closePath();
    g.add(mesh(new THREE.ShapeGeometry(mouth), glow, 0, r * 0.62, z * 0.97));
    anims.push((t) => (glow.emissiveIntensity = 1.1 + Math.sin(t * 9 + seed) * 0.25 + Math.sin(t * 23 + seed) * 0.15));
  }
  return g;
}

/** Petit fantôme qui flotte (drap blanc, grands yeux). */
function ghost(anims: Anim[], seed: number, cx: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  const sheet = mat(0xf6f3ff, { emissive: 0xb9a8ff, ei: 0.35, rough: 0.8 });
  g.add(mesh(new THREE.SphereGeometry(0.45, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), sheet, 0, 0.6, 0));
  const body = mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.8, 16, 1, true), sheet, 0, 0.2, 0);
  (body.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(body);
  const eye = mat(0x1a1424);
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), eye, s * 0.16, 0.72, 0.4));
  anims.push((t) => {
    const a = t * 0.5 + seed;
    g.position.set(cx + Math.cos(a) * 2.2, 2.4 + Math.sin(t * 2 + seed) * 0.35, cz + Math.sin(a) * 2.2);
    g.rotation.y = -a;
  });
  return g;
}

/** Chauve-souris (deux ailes qui battent) en ronde au-dessus de la place. */
function bat(anims: Anim[], seed: number): THREE.Group {
  const g = new THREE.Group();
  const black = new THREE.MeshBasicMaterial({ color: 0x1a1424, side: THREE.DoubleSide });
  const wing = new THREE.Shape();
  wing.moveTo(0, 0);
  wing.lineTo(0.9, 0.25);
  wing.lineTo(0.7, -0.05);
  wing.lineTo(0.5, 0.05);
  wing.lineTo(0.3, -0.1);
  wing.closePath();
  const wg = new THREE.ShapeGeometry(wing);
  const l = new THREE.Mesh(wg, black);
  const r = new THREE.Mesh(wg, black);
  r.scale.x = -1;
  g.add(l, r, new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), black));
  anims.push((t) => {
    const a = t * 0.35 + seed;
    const R = 18 + (seed % 3) * 9;
    g.position.set(Math.cos(a) * R, 12 + Math.sin(t + seed) * 2, -6 + Math.sin(a) * R * 0.6);
    g.rotation.y = -a + Math.PI;
    const flap = Math.sin(t * 14 + seed) * 0.7;
    l.rotation.y = flap;
    r.rotation.y = -flap;
  });
  return g;
}

/** Œuf décoré (bandes et pois), posé debout. */
function egg(r: number, colors: string[]): THREE.Mesh {
  const m = new THREE.MeshStandardMaterial({ map: stripes(colors), roughness: 0.45 });
  const e = mesh(new THREE.SphereGeometry(r, 24, 18), m, 0, r * 1.35, 0);
  e.scale.y = 1.35;
  return e;
}

/** Parterre de fleurs colorées (un seul maillage instancié). */
function flowerBed(radius: number, n: number, colors: number[]): THREE.Group {
  const g = new THREE.Group();
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), mat(0x3f9a3a), n);
  const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996;
    const r = Math.sqrt(i / n) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    m4.makeTranslation(x, 0.25, z);
    stems.setMatrixAt(i, m4);
    m4.makeTranslation(x, 0.52, z);
    heads.setMatrixAt(i, m4);
    heads.setColorAt(i, new THREE.Color(pick(colors, i)));
  }
  g.add(stems, heads);
  const earth = mesh(new THREE.CylinderGeometry(radius + 0.25, radius + 0.35, 0.18, 24), mat(0x6b4a2e), 0, 0.09, 0);
  g.add(earth);
  return g;
}

/** Lapin tout rond (corps, tête, longues oreilles) qui sautille. */
function bunny(anims: Anim[], seed: number): THREE.Group {
  const g = new THREE.Group();
  const fur = mat(0xfff7f0, { rough: 0.9 });
  const pink = mat(0xffa6c9);
  g.add(mesh(new THREE.SphereGeometry(0.55, 16, 12), fur, 0, 0.55, 0));
  g.add(mesh(new THREE.SphereGeometry(0.4, 16, 12), fur, 0, 1.25, 0.15));
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), fur, s * 0.17, 1.85, 0.1);
    ear.rotation.z = s * -0.15;
    g.add(ear);
    g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(0x241a1a), s * 0.15, 1.33, 0.5));
  }
  g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), pink, 0, 1.22, 0.55));
  g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), fur, 0, 0.5, -0.55));
  anims.push((t) => (g.position.y = Math.abs(Math.sin(t * 3 + seed)) * 0.35));
  return g;
}

/** Palmier : tronc courbé en anneaux, palmes, noix de coco. */
function palm(seed: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = mat(0x9b6a3c, { rough: 0.9 });
  let x = 0;
  for (let i = 0; i < 9; i++) {
    x += 0.08 + (seed % 2) * 0.03;
    g.add(mesh(new THREE.CylinderGeometry(0.22 - i * 0.008, 0.26 - i * 0.008, 0.62, 8), trunk, x, 0.31 + i * 0.6, 0));
  }
  const top = new THREE.Vector3(x, 5.6, 0);
  const leaf = mat(0x2fa84f, { flat: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const l = mesh(new THREE.ConeGeometry(0.45, 3.2, 4), leaf, top.x + Math.cos(a) * 1.3, top.y - 0.3, Math.sin(a) * 1.3);
    l.scale.set(1, 1, 0.25);
    l.lookAt(top.x + Math.cos(a) * 3, top.y - 1.6, Math.sin(a) * 3);
    l.rotateX(Math.PI / 2);
    g.add(l);
  }
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), mat(0x5a3b1e), top.x + Math.cos(i * 2) * 0.3, top.y - 0.35, Math.sin(i * 2) * 0.3));
  return g;
}

/** Parasol rayé planté dans un rond de sable, avec un ballon de plage qui rebondit. */
function parasol(anims: Anim[], seed: number, colors: string[]): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.06, 28), mat(0xf2d38b, { rough: 1 }), 0, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 8), mat(0xf1f1f1), 0, 1.4, 0));
  const top = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 16, 1, true), new THREE.MeshStandardMaterial({ map: stripes(colors, true), side: THREE.DoubleSide, roughness: 0.6 }));
  top.position.y = 2.85;
  top.castShadow = true;
  g.add(top);
  const ball = mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshStandardMaterial({ map: stripes(['#ff4f6d', '#ffffff', '#2ec4f1', '#ffd23f'], true), roughness: 0.4 }), 1.1, 0.32, 0.4);
  g.add(ball);
  anims.push((t) => {
    ball.position.y = 0.32 + Math.abs(Math.sin(t * 2.6 + seed)) * 1.1;
    ball.rotation.x = t * 2;
  });
  return g;
}

/** Bouquet de ballons qui se balancent au bout de leurs ficelles. */
function balloons(anims: Anim[], seed: number, n = 6): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.4, 10), mat(0x8c5bff), 0, 0.2, 0));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x444455 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const h = 3.2 + ((i * 5) % 3) * 0.45;
    const tip = new THREE.Vector3(Math.cos(a) * 0.7, h, Math.sin(a) * 0.7);
    const b = mesh(new THREE.SphereGeometry(0.42, 16, 12), mat(pick(PARTY, i + seed), { rough: 0.3, metal: 0.1, emissive: pick(PARTY, i + seed), ei: 0.12 }), tip.x, tip.y, tip.z);
    b.scale.y = 1.18;
    g.add(b);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.4, 0), tip.clone().setY(h - 0.48)]), lineMat);
    g.add(line);
    anims.push((t) => {
      const sw = Math.sin(t * 1.4 + i + seed) * 0.12;
      b.position.x = tip.x + sw;
      b.position.y = tip.y + Math.sin(t * 2 + i) * 0.08;
    });
  }
  return g;
}

/** Gâteau d'anniversaire géant à trois étages, bougies qui vacillent. */
function cake(anims: Anim[]): THREE.Group {
  const g = new THREE.Group();
  const tiers: Array<[number, number, number]> = [[2.6, 1.3, 0xff8fc8], [1.9, 1.1, 0xfff1e0], [1.25, 1.0, 0x8b4a2b]];
  let y = 0;
  for (const [r, h, c] of tiers) {
    g.add(mesh(new THREE.CylinderGeometry(r, r, h, 32), mat(c, { rough: 0.7 }), 0, y + h / 2, 0));
    // bourrelet de glaçage au bord de chaque étage
    const icing = mesh(new THREE.TorusGeometry(r, 0.12, 8, 32), mat(0xffffff, { rough: 0.5 }), 0, y + h, 0);
    icing.rotation.x = Math.PI / 2;
    g.add(icing);
    y += h;
  }
  const flame = mat(0xffd23f, { emissive: 0xff9a00, ei: 1.6 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), mat(pick(PARTY, i)), Math.cos(a) * 0.8, y + 0.3, Math.sin(a) * 0.8));
    const f = mesh(new THREE.ConeGeometry(0.08, 0.22, 8), flame, Math.cos(a) * 0.8, y + 0.72, Math.sin(a) * 0.8);
    g.add(f);
    anims.push((t) => (f.scale.y = 1 + Math.sin(t * 15 + i * 1.7) * 0.25));
  }
  return g;
}

/** Chaudron de bonbons d'Halloween (bulles vertes qui montent). */
function cauldron(anims: Anim[]): THREE.Group {
  const g = new THREE.Group();
  const iron = mat(0x24212b, { metal: 0.6, rough: 0.4 });
  const pot = mesh(new THREE.SphereGeometry(1.1, 20, 14, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), iron, 0, 1.05, 0);
  (pot.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(pot);
  const brew = mesh(new THREE.CircleGeometry(0.95, 24), mat(0x7dff6a, { emissive: 0x3ddc84, ei: 1 }), 0, 1.65, 0);
  brew.rotation.x = -Math.PI / 2;
  g.add(brew);
  const bubbles: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const b = mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0xa8ff94, { emissive: 0x3ddc84, ei: 1.2 }), 0, 1.7, 0);
    bubbles.push(b);
    g.add(b);
  }
  // bonbons au pied du chaudron
  for (let i = 0; i < 10; i++) {
    const a = i * 0.9;
    g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(pick(PARTY, i), { rough: 0.3 }), Math.cos(a) * 1.5, 0.16, Math.sin(a) * 1.5));
  }
  anims.push((t) => {
    bubbles.forEach((b, i) => {
      const k = (t * 0.6 + i / 6) % 1;
      b.position.set(Math.cos(i * 2.1) * 0.5, 1.7 + k * 1.2, Math.sin(i * 2.1) * 0.5);
      b.scale.setScalar(1 - k);
    });
  });
  return g;
}

// ------------------------------------------------------------------ particules (neige, feuilles, pétales, confettis)

function particleTexture(kind: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  if (kind === 'snow') {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  } else if (kind === 'leaves' || kind === 'petals') {
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(32, 32, kind === 'leaves' ? 26 : 22, kind === 'leaves' ? 14 : 16, Math.PI / 4, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = '#fff';
    g.fillRect(14, 22, 36, 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PARTICLE_COLORS: Record<string, number[]> = {
  snow: [0xffffff],
  leaves: [0xff7a1a, 0xd9480f, 0xffb300, 0x8c3b12],
  petals: [0xffb3d1, 0xff8fc8, 0xffffff, 0xffd1e6],
  confetti: PARTY,
};

class Weather {
  readonly points: THREE.Points;
  private vel: Float32Array;
  private n: number;
  private box = { w: 70, h: 26, d: 60 };

  constructor(private kind: string, n: number) {
    this.n = n;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    const colors = PARTICLE_COLORS[kind] ?? [0xffffff];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.box.w;
      pos[i * 3 + 1] = Math.random() * this.box.h;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.d;
      const fall = kind === 'snow' ? 1.2 + Math.random() * 1.3 : kind === 'confetti' ? 2.2 + Math.random() * 1.5 : 1.4 + Math.random();
      this.vel[i * 3] = (Math.random() - 0.5) * 0.6;
      this.vel[i * 3 + 1] = -fall;
      this.vel[i * 3 + 2] = Math.random() * Math.PI * 2; // phase du balancement
      c.setHex(colors[i % colors.length]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: particleTexture(kind), vertexColors: true, size: kind === 'snow' ? 0.32 : kind === 'confetti' ? 0.34 : 0.42,
      transparent: true, depthWrite: false, alphaTest: 0.05, opacity: kind === 'snow' ? 0.95 : 1,
    }));
    this.points.frustumCulled = false;
  }

  /** Les particules suivent le joueur : une boîte de 70 × 26 × 60 m autour de lui, recyclée en boucle. */
  update(t: number, dt: number, center: THREE.Vector3): void {
    const a = (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const { w, h, d } = this.box;
    const sway = this.kind === 'snow' ? 0.6 : 1.4;
    for (let i = 0; i < this.n; i++) {
      const ph = this.vel[i * 3 + 2];
      a[i * 3] += (this.vel[i * 3] + Math.sin(t * 1.3 + ph) * sway) * dt;
      a[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      a[i * 3 + 2] += Math.cos(t * 1.1 + ph) * sway * 0.6 * dt;
      // recyclage dans la boîte qui suit le joueur
      if (a[i * 3 + 1] < center.y - 1) a[i * 3 + 1] += h;
      let dx = a[i * 3] - center.x;
      if (dx > w / 2) a[i * 3] -= w;
      else if (dx < -w / 2) a[i * 3] += w;
      dx = a[i * 3 + 2] - center.z;
      if (dx > d / 2) a[i * 3 + 2] -= d;
      else if (dx < -d / 2) a[i * 3 + 2] += d;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    const m = this.points.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

// ------------------------------------------------------------------ gestion du thème

export class Seasons {
  id: SeasonId | '' = '';
  def: SeasonDef = CATALOG.seasons.classique;
  private key = '';
  private deco = new THREE.Group();
  private anims: Anim[] = [];
  private weather: Weather | null = null;
  private quality: Quality = 'high';

  constructor(private scene: THREE.Scene, private district: District, private lights: SeasonLights) {
    scene.add(this.deco);
  }

  /** Position de la pièce centrale (cadeau saisonnier à ouvrir en s'en approchant). */
  readonly center = new THREE.Vector3(DECO_CENTER.x, 0, DECO_CENTER.z);
  /** Le décor de la saison en cours a-t-il une pièce centrale (sapin, chaudron, œuf géant…) ? */
  get hasCenter(): boolean {
    return this.id !== '' && this.id !== 'classique';
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    if (this.id) this.buildWeather();
  }

  apply(s: SeasonState): void {
    const key = JSON.stringify(s);
    if (key === this.key) return;
    this.key = key;
    const def = CATALOG.seasons[s.id] ?? CATALOG.seasons.classique;
    this.def = def;
    const top = s.custom?.skyTop ?? def.sky[0];
    const horizon = s.custom?.skyHorizon ?? def.sky[1];
    this.district.setSkyColors(top, horizon);
    this.district.setGround(s.custom?.grass ?? def.grass, !!def.snow && !s.custom?.grass);
    this.district.setFlagColors(def.flags);
    this.district.setBulb(def.bulb);
    // brume : couleur de l'horizon (personnalisé) ou celle du thème
    this.lights.fog.color.set(s.custom?.skyHorizon ? horizon : def.fog);
    this.lights.hemi.color.set(def.hemi[0]);
    this.lights.hemi.groundColor.set(def.hemi[1]);
    this.lights.hemi.intensity = this.lights.base.hemi * def.light;
    this.lights.sun.color.set(def.sun);
    this.lights.sun.intensity = this.lights.base.sun * def.light;
    document.body.dataset.season = s.id;
    if (s.id !== this.id) {
      this.id = s.id;
      this.buildDeco();
      this.buildWeather();
    }
  }

  update(t: number, dt: number, focus: THREE.Vector3): void {
    for (const a of this.anims) a(t, dt);
    this.weather?.update(t, dt, focus);
  }

  private clearDeco(): void {
    for (const c of [...this.deco.children]) {
      this.deco.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh && !(o as THREE.Line).isLine) return;
        m.geometry?.dispose();
        // les matériaux partagés (cache) restent ; seuls les matériaux texturés propres au décor sont libérés
        const mm = m.material as THREE.Material & { map?: THREE.Texture | null };
        if (mm && ![...matCache.values()].includes(mm as THREE.MeshStandardMaterial)) {
          mm.map?.dispose();
          mm.dispose();
        }
      });
    }
    this.anims = [];
    this.district.seasonCircles = [];
  }

  private buildWeather(): void {
    this.weather?.dispose();
    this.weather = null;
    const kind = this.def.particles;
    if (!kind) return;
    this.weather = new Weather(kind, tierOf(this.quality).weather);
    this.scene.add(this.weather.points);
  }

  private place(o: THREE.Object3D, x: number, z: number, r = 0): void {
    o.position.set(x, 0, z);
    this.deco.add(o);
    if (r) this.district.seasonCircles.push({ x, z, r });
  }

  private buildDeco(): void {
    this.clearDeco();
    const A = this.anims;
    const c = DECO_CENTER;
    switch (this.id) {
      case 'noel': {
        this.place(christmasTree(1.15, A, 60), c.x, c.z, 3.1);
        const gifts = giftPile(10, 3.6);
        this.place(gifts, c.x, c.z);
        DECO_SPOTS.forEach((s, i) => {
          if (i % 2) this.place(snowman(A, i), s.x, s.z, 0.8);
          else {
            const t = christmasTree(0.55, A, 24);
            this.place(t, s.x, s.z, 1.7);
            const g = giftPile(3, 1.6);
            this.place(g, s.x, s.z);
          }
        });
        break;
      }
      case 'halloween': {
        this.place(pumpkin(2.2, true, A, 0), c.x, c.z, 2.5);
        const cd = cauldron(A);
        this.place(cd, c.x + 4.6, c.z + 1.2, 1.2);
        DECO_SPOTS.forEach((s, i) => {
          const g = new THREE.Group();
          g.add(pumpkin(0.75, true, A, i));
          const small = pumpkin(0.45, false, A, i);
          small.position.set(1, 0, 0.5);
          const small2 = pumpkin(0.35, i % 2 === 0, A, i + 3);
          small2.position.set(-0.9, 0, 0.6);
          g.add(small, small2);
          g.rotation.y = s.z > 0 ? Math.PI : 0;
          this.place(g, s.x, s.z, 1.1);
          if (i % 2 === 0) this.deco.add(ghost(A, i * 1.7, s.x, s.z));
        });
        for (let i = 0; i < 9; i++) this.deco.add(bat(A, i * 2.3));
        break;
      }
      case 'printemps': {
        const nest = mesh(new THREE.TorusGeometry(2.0, 0.55, 10, 28), mat(0x9b6a3c, { rough: 1 }), 0, 0.4, 0);
        nest.rotation.x = Math.PI / 2;
        const center = new THREE.Group();
        center.add(nest, flowerBed(3.4, 90, [0xff6fb0, 0xffe066, 0xffffff, 0xb57bff, 0xff9a3c]));
        const big = egg(1.5, ['#ff9ecb', '#ffe27a', '#9fe0ff', '#b9f5a8']);
        big.position.y += 0.4;
        center.add(big);
        A.push((t) => (big.rotation.z = Math.sin(t * 1.5) * 0.06));
        const b = bunny(A, 0);
        b.position.set(2.6, 0, 1.6);
        center.add(b);
        this.place(center, c.x, c.z, 2.4);
        DECO_SPOTS.forEach((s, i) => {
          const g = new THREE.Group();
          g.add(flowerBed(1.5, 36, [0xff6fb0, 0xffe066, 0xffffff, 0x6fc3ff, 0xff9a3c].slice(i % 2)));
          const e = egg(0.55, [pick(['#ffb3d1', '#b9f5a8', '#9fe0ff', '#ffe27a'], i), '#ffffff', pick(['#d7b5ff', '#ff9ecb'], i)]);
          g.add(e);
          if (i % 3 === 1) {
            const bn = bunny(A, i);
            bn.position.set(1.6, 0, 0.6);
            bn.scale.setScalar(0.7);
            g.add(bn);
          }
          this.place(g, s.x, s.z, 1.2);
        });
        break;
      }
      case 'ete': {
        const center = new THREE.Group();
        center.add(mesh(new THREE.CylinderGeometry(4, 4, 0.08, 32), mat(0xf2d38b, { rough: 1 }), 0, 0.04, 0));
        center.add(palm(0));
        const p = parasol(A, 1, ['#ff4f6d', '#ffffff']);
        p.position.set(2.4, 0, 1.2);
        center.add(p);
        this.place(center, c.x, c.z, 1.2);
        DECO_SPOTS.forEach((s, i) => this.place(i % 2 ? parasol(A, i, [pick(['#2ec4f1', '#ffd23f', '#3ddc84'], i), '#ffffff']) : palm(i), s.x, s.z, i % 2 ? 0.6 : 0.8));
        break;
      }
      case 'fete': {
        this.place(cake(A), c.x, c.z, 2.8);
        this.place(giftPile(8, 3.6), c.x, c.z);
        DECO_SPOTS.forEach((s, i) => {
          this.place(balloons(A, i, 6), s.x, s.z, 0.6);
          if (i % 2) this.place(giftPile(3, 1.3), s.x + 1.4, s.z);
        });
        break;
      }
      default:
        break;
    }
  }
}
