import * as THREE from 'three';
import { money } from './catalog';

/** Quartier / Arena Steal A Brainrot : Hub semi-ouvert, arène de vol centrale avec trampolines et obstacles. */
export const BOUNDS = { minX: -84, maxX: 84, minZ: -62, maxZ: 62 };
export const ROAD = { z: 0, x0: -72, x1: 72 };
/** Stand du Marché Noir (Brainrot Shop). */
export const BLACK_MARKET = { x: -60, z: -10 };
/** Stand de l'Hôtel des Ventes / Enchères. */
export const AUCTION_DOOR = { x: 60, z: -24.4 };

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Circle { x: number; z: number; r: number }

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, flatShading: true, ...extra });

function tileTexture(base: string, line: string, tiles: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = line;
  g.lineWidth = 4;
  const s = 512 / tiles;
  for (let i = 0; i <= tiles; i++) {
    g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function textTexture(lines: Array<[string, string, number]>, w = 1024, h = 256, bg = '#0d0f1a'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#00e5ff';
  g.lineWidth = 12;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((s, [, , size]) => s + size * 1.25, 0);
  let y = (h - total) / 2;
  for (const [text, color, size] of lines) {
    g.font = `900 ${size}px 'Fredoka One', 'Luckiest Guy', 'Impact', sans-serif`;
    g.fillStyle = color;
    g.fillText(text, w / 2, y + (size * 1.25) / 2, w - 60);
    y += size * 1.25;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class District {
  readonly group = new THREE.Group();
  readonly boxes: Box[] = [];
  readonly circles: Circle[] = [];
  /** Volumes opaques qui peuvent masquer le joueur (pour la caméra). */
  readonly occluders: THREE.Object3D[] = [];
  private boardTexture!: THREE.CanvasTexture;
  private boardCanvas = document.createElement('canvas');
  private neonRings: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildSky(scene);
    this.buildGround();
    this.buildPlots();
    this.buildCentralArena();
    this.buildPlaza();
    this.buildTradePlaza();
    this.buildBoard();
    this.buildPerimeterFence();
    this.buildDepots();
    this.buildSafeZones();
  }

  /** Collision du joueur (rayon r) avec le décor et les limites du quartier. */
  blocked(x: number, z: number, r: number, extraBoxes: Box[] = [], extraCircles: Circle[] = []): boolean {
    if (x < BOUNDS.minX + r || x > BOUNDS.maxX - r || z < BOUNDS.minZ + r || z > BOUNDS.maxZ - r) return true;
    for (const b of this.boxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    for (const b of extraBoxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    for (const c of this.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    for (const c of extraCircles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    return false;
  }

  setLeaderboard(
    rows: Array<{ name: string; value: number }>,
    myName: string,
    title = '🔥 LES MAÎTRES DU BRAINROT 🔥',
    subtitle = 'Plus grands voleurs & fortunes du serveur',
    empty = 'Adopte ton premier Brainrot pour figurer au classement !',
  ): void {
    const c = this.boardCanvas;
    const g = c.getContext('2d')!;
    g.fillStyle = '#080a14';
    g.fillRect(0, 0, c.width, c.height);

    // Cadre néon cartoon vibrant
    g.strokeStyle = '#00e5ff';
    g.lineWidth = 16;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);

    g.fillStyle = '#ffd600';
    g.font = "900 60px 'Fredoka One', 'Luckiest Guy', 'Impact', sans-serif";
    g.textAlign = 'center';
    g.fillText(title, c.width / 2, 85, c.width - 80);

    g.font = "700 28px 'Segoe UI', sans-serif";
    g.fillStyle = '#ff007f';
    g.fillText(subtitle, c.width / 2, 132);

    const medals = ['#ffd600', '#00e5ff', '#d500f9'];
    rows.slice(0, 6).forEach((r, i) => {
      const y = 205 + i * 66;
      const me = r.name === myName;
      if (me) {
        g.fillStyle = 'rgba(0, 229, 255, 0.22)';
        g.fillRect(50, y - 46, c.width - 100, 60);
      }
      g.textAlign = 'left';
      g.font = "900 38px 'Fredoka One', 'Luckiest Guy', sans-serif";
      g.fillStyle = medals[i] ?? '#b0bec5';
      g.fillText(`${i + 1}.`, 70, y);
      g.fillStyle = me ? '#ffd600' : '#ffffff';
      g.fillText(r.name.slice(0, 22), 140, y);
      g.textAlign = 'right';
      g.fillStyle = '#76ff03';
      g.fillText(`$${money(r.value)}`, c.width - 70, y);
    });

    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#b0bec5';
      g.font = "700 38px 'Segoe UI', sans-serif";
      g.fillText(empty, c.width / 2, 320, c.width - 100);
    }
    this.boardTexture.needsUpdate = true;
  }

  update(t: number): void {
    // Pulsation des anneaux néon de l'arène
    for (let i = 0; i < this.neonRings.length; i++) {
      const ring = this.neonRings[i];
      const s = 1 + Math.sin(t * 3 + i) * 0.05;
      ring.scale.set(s, s, 1);
    }
  }

  // ---------------------------------------------------------------- construction

  private buildSky(scene: THREE.Scene): void {
    // Dôme céleste Néo-Pop / Cartoon Cyber
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color('#311b92') }, // Violet sombre cosmique
          mid: { value: new THREE.Color('#00e5ff') }, // Cyan néon horizon
          horizon: { value: new THREE.Color('#ff007f') }, // Magenta vif
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 mid;
          uniform vec3 horizon;
          varying vec3 vP;
          void main() {
            float y = smoothstep(-0.05, 0.5, vP.y);
            vec3 col = mix(horizon, mix(mid, top, smoothstep(0.1, 0.8, vP.y)), y);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    scene.add(sky);
  }

  private plane(w: number, d: number, x: number, z: number, mat: THREE.Material, y = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildGround(): void {
    // Sol Roblox Voxel : dalle gazon cartoon punchy
    const grass = std(0x2e7d32, { roughness: 0.8 });
    this.plane(400, 400, 0, 0, grass, -0.05);

    // Place centrale quadrillée cartoon avec néons
    const pav = tileTexture('#1a1c29', '#00e5ff', 4);
    pav.repeat.set(170 / 8, 44 / 8);
    this.plane(170, 44, 0, 0, std(0xffffff, { map: pav }), -0.01);

    // Piste de transport du Convoi (Asphalte sombre avec bordures néon jaune/vert)
    const asphalt = tileTexture('#10121a', 'rgba(0,0,0,0)', 1);
    asphalt.repeat.set(30, 1);
    this.plane(148, 6.4, 0, ROAD.z, std(0xffffff, { map: asphalt, roughness: 0.6 }), 0);

    for (let x = ROAD.x0 + 2; x < ROAD.x1; x += 6) {
      this.plane(3, 0.35, x, ROAD.z, new THREE.MeshBasicMaterial({ color: 0x76ff03 }), 0.01);
    }

    for (const z of [-3.35, 3.35]) {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(148, 0.22, 0.3), std(0x00e5ff, { emissive: 0x007788, emissiveIntensity: 0.3 }));
      kerb.position.set(0, 0.11, z);
      kerb.receiveShadow = true;
      this.group.add(kerb);
    }

    // Parcelles joueurs (Dallage néon avec bordures rouge et or)
    const plot = tileTexture('#202438', '#ff007f', 6);
    plot.repeat.set(4, 4);
    const plotMat = std(0xffffff, { map: plot });
    for (const x of [-60, -20, 20, 60]) {
      for (const z of [-41, 41]) {
        this.plane(38, 38, x, z, plotMat, -0.005);
      }
    }
  }

  /** Zone Centrale : Arène de vol avec obstacles, rampes et trampolines de poursuite */
  private buildCentralArena(): void {
    const arenaMat = std(0x00e5ff, { emissive: 0x0088aa, emissiveIntensity: 0.4 });
    const bounceMat = std(0xff007f, { emissive: 0x880044, emissiveIntensity: 0.5 });
    const boxMat = std(0xffd600, { roughness: 0.3 });

    // 1. Trampolines — shared geometries for performance (12 segments for cylinders)
    const baseGeo = new THREE.CylinderGeometry(1.6, 1.8, 0.3, 12);
    const padGeo = new THREE.CylinderGeometry(1.3, 1.3, 0.08, 12);
    const ringGeo = new THREE.RingGeometry(1.7, 1.95, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x76ff03, side: THREE.DoubleSide });
    const trampolines = [
      { x: -16, z: 12 },
      { x: 16, z: 12 },
      { x: -28, z: -12 },
      { x: 28, z: -12 },
    ];
    for (const t of trampolines) {
      const base = new THREE.Mesh(baseGeo, arenaMat);
      base.position.set(t.x, 0.15, t.z);
      base.castShadow = true;
      base.receiveShadow = true;
      // Pad flush with base top: base center y=0.15, half-height=0.15 → top=0.30; pad half-height=0.04 → center=0.34
      const pad = new THREE.Mesh(padGeo, bounceMat);
      pad.position.set(t.x, 0.30 + 0.04, t.z);
      pad.receiveShadow = true;
      this.group.add(base, pad);
      this.circles.push({ x: t.x, z: t.z, r: 1.6 });

      // Anneau néon animé au sol
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(t.x, 0.03, t.z);
      this.group.add(ring);
      this.neonRings.push(ring);
    }

    // 2. Boîtes / Blocs d'obstacles cartoony empilés pour duels et cover
    const blockPositions = [
      { x: -8, z: 14, w: 2.2, h: 1.6, d: 2.2 },
      { x: 8, z: 14, w: 2.2, h: 1.6, d: 2.2 },
      { x: -35, z: 14, w: 3, h: 2, d: 2 },
      { x: 35, z: 14, w: 3, h: 2, d: 2 },
    ];
    for (const b of blockPositions) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), boxMat);
      box.position.set(b.x, b.h / 2, b.z);
      box.castShadow = true;
      box.receiveShadow = true;
      this.group.add(box);
      this.boxes.push({
        minX: b.x - b.w / 2,
        maxX: b.x + b.w / 2,
        minZ: b.z - b.d / 2,
        maxZ: b.z + b.d / 2,
      });
    }

    // 3. Low cover walls in central arena for chase cover
    const wallMat = std(0x283593, { roughness: 0.4 });
    const coverWalls = [
      { x: 0, z: 8, w: 4, h: 1.4, d: 0.6 },
      { x: -12, z: -8, w: 0.6, h: 1.8, d: 4 },
      { x: 12, z: -8, w: 0.6, h: 1.8, d: 4 },
    ];
    for (const cw of coverWalls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(cw.w, cw.h, cw.d), wallMat);
      wall.position.set(cw.x, cw.h / 2, cw.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      this.boxes.push({
        minX: cw.x - cw.w / 2,
        maxX: cw.x + cw.w / 2,
        minZ: cw.z - cw.d / 2,
        maxZ: cw.z + cw.d / 2,
      });
    }

    // 4. Rampes d'accès — lowered to connect with ground (y=0.2 so bottom touches y=0)
    for (const rx of [-48, 48]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 6), std(0x283593));
      ramp.position.set(rx, 0.2, -14);
      ramp.rotation.x = -0.18;
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      this.group.add(ramp);
      this.boxes.push({ minX: rx - 1.8, maxX: rx + 1.8, minZ: -17, maxZ: -11 });
    }
  }

  private buildPlots(): void {
    const wallColor = std(0x151926);
    const neonCyan = std(0x00e5ff, { emissive: 0x0088aa, emissiveIntensity: 0.3 });

    const facade = (x: number, z: number, facing: 1 | -1, title: string, sub: string, accent = 0xff007f) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 24), wallColor);
      body.position.set(0, 4.5, 0);
      g.add(body);
      this.occluders.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(31, 0.8, 25), std(accent));
      roof.position.y = 9.4;
      g.add(roof);

      // Colonnes néo-pop colorées
      for (let i = 0; i < 6; i++) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.2, 0.8), neonCyan);
        col.position.set(-12.5 + i * 5, 4.1, 13.6);
        g.add(col);
      }

      const steps = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 3), std(0x212538));
      steps.position.set(0, 0.25, 15.2);
      g.add(steps);

      const door = new THREE.Mesh(new THREE.BoxGeometry(4, 5.6, 0.3), std(0x0a0c14));
      door.position.set(0, 2.8, 12.05);
      g.add(door);

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 2.5),
        new THREE.MeshStandardMaterial({
          map: textTexture([[title, '#ffd600', 70], [sub, '#00e5ff', 44]], 1024, 256, '#0f1220'),
          roughness: 0.4,
        }),
      );
      sign.position.set(0, 7.6, 14.3);
      g.add(sign);

      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      g.position.set(x, 0, z);
      g.rotation.y = facing === 1 ? 0 : Math.PI;
      this.group.add(g);

      const zFront = z + facing * 16.7;
      const zBack = z - facing * 12;
      this.boxes.push({ minX: x - 15.5, maxX: x + 15.5, minZ: Math.min(zFront, zBack), maxZ: Math.max(zFront, zBack) });
    };

    facade(60, -42, 1, 'HÔTEL DES ENCHÈRES', 'Enchères de Brainrots Rares', 0xff007f);
  }

  private buildPlaza(): void {
    // Stand Vente / Gacha Trade Plaza
    const shop = new THREE.Group();
    const tentRoof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.8, 6), std(0xd500f9, { emissive: 0x660077, emissiveIntensity: 0.3 }));
    tentRoof.position.y = 3.4;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.8, 4.2), std(0x191c2b));
    counter.position.y = 0.9;
    shop.add(tentRoof, counter);
    this.occluders.push(counter);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.2),
      new THREE.MeshStandardMaterial({
        map: textTexture([['BRAINROT SHOP', '#76ff03', 70], ['Boosts & Outils de Vol', '#ffd600', 44]], 1024, 256, '#111422'),
      }),
    );
    sign.position.set(0, 1.2, 2.15);
    shop.add(sign);
    shop.position.set(-60, 0, -13);
    shop.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(shop);
    this.boxes.push({ minX: -62.8, maxX: -57.2, minZ: -15.5, maxZ: -10.5 });

    // Lampadaires néon le long de l'avenue
    const postMat = std(0x1a1d2e);
    const bulbCyan = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.8 });
    const bulbMagenta = new THREE.MeshStandardMaterial({ color: 0xff007f, emissive: 0xff007f, emissiveIntensity: 1.8 });

    for (let x = -60; x <= 60; x += 20) {
      for (const z of [-5, 5]) {
        const l = new THREE.Group();
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.2, 0.2), postMat);
        p.position.y = 2.1;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), (x + z) % 40 === 0 ? bulbCyan : bulbMagenta);
        b.position.y = 4.35;
        l.add(p, b);
        l.position.set(x, 0, z);
        l.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        this.group.add(l);
        this.circles.push({ x, z, r: 0.3 });
      }
    }
  }

  private buildBoard(): void {
    this.boardCanvas.width = 1280;
    this.boardCanvas.height = 640;
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshStandardMaterial({ map: this.boardTexture, emissive: 0xffffff, emissiveMap: this.boardTexture, emissiveIntensity: 0.8 }),
    );
    screen.position.y = 4.6;
    const back = new THREE.Mesh(new THREE.BoxGeometry(10.6, 5.6, 0.3), std(0x0e111a));
    back.position.set(0, 4.6, -0.17);
    g.add(screen, back);
    for (const sx of [-4, 4]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 0.4), std(0x00e5ff));
      p.position.set(sx, 1.1, -0.17);
      g.add(p);
    }
    g.position.set(-20, 0, -13);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(g);
    this.boxes.push({ minX: -25.5, maxX: -14.5, minZ: -13.6, maxZ: -12.4 });
    this.setLeaderboard([], '');
  }

  private buildPerimeterFence(): void {
    const barMat = std(0x00e5ff, { emissive: 0x004455, emissiveIntensity: 0.3 });
    const postMat = std(0xff007f);

    const addFenceSegment = (x1: number, z1: number, x2: number, z2: number, solid = true) => {
      const g = new THREE.Group();
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) return;
      const angle = Math.atan2(dx, dz);

      g.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
      g.rotation.y = angle;

      const railTop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), barMat);
      railTop.position.y = 2.2;
      const railMid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), barMat);
      railMid.position.y = 1.1;
      g.add(railTop, railMid);

      const count = Math.max(1, Math.round(len / 4));
      const step = len / count;
      for (let i = 0; i <= count; i++) {
        const offset = -len / 2 + i * step;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), postMat);
        post.position.set(0, 1.25, offset);
        g.add(post);
      }

      this.group.add(g);

      if (solid) {
        const minX = Math.min(x1, x2) - 0.3;
        const maxX = Math.max(x1, x2) + 0.3;
        const minZ = Math.min(z1, z2) - 0.3;
        const maxZ = Math.max(z1, z2) + 0.3;
        this.boxes.push({ minX, maxX, minZ, maxZ });
      }
    };

    // Frontières de la carte
    addFenceSegment(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX, BOUNDS.minZ);
    addFenceSegment(BOUNDS.minX, BOUNDS.maxZ, BOUNDS.maxX, BOUNDS.maxZ);
    addFenceSegment(BOUNDS.minX, BOUNDS.minZ, BOUNDS.minX, -6);
    addFenceSegment(BOUNDS.minX, 6, BOUNDS.minX, BOUNDS.maxZ);
    addFenceSegment(BOUNDS.maxX, BOUNDS.minZ, BOUNDS.maxX, -6);
    addFenceSegment(BOUNDS.maxX, 6, BOUNDS.maxX, BOUNDS.maxZ);
  }

  private buildDepots(): void {
    const wallMat = std(0x111422);
    const neonMat = std(0x00e5ff, { emissive: 0x00e5ff, emissiveIntensity: 0.5 });

    const createDepot = (xCenter: number, isWest: boolean, title: string) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 22), wallMat);
      body.position.set(0, 5, 0);
      g.add(body);
      this.occluders.push(body);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(20.8, 1.2, 22.8), neonMat);
      roof.position.set(0, 10.6, 0);
      g.add(roof);

      const doorFacingX = isWest ? 10.05 : -10.05;
      const blackDoor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.6, 7.6), std(0x05060a));
      blackDoor.position.set(doorFacingX, 2.8, 0);
      g.add(blackDoor);

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 2.2),
        new THREE.MeshStandardMaterial({
          map: textTexture([[title, '#ffd600', 56], ['CONVOI BRAINROT', '#ff007f', 38]], 1024, 256, '#090b14'),
        }),
      );
      sign.position.set(doorFacingX + (isWest ? 0.15 : -0.15), 7.8, 0);
      sign.rotation.y = isWest ? Math.PI / 2 : -Math.PI / 2;
      g.add(sign);

      g.position.set(xCenter, 0, 0);
      this.group.add(g);

      this.boxes.push({ minX: xCenter - 10.2, maxX: xCenter + 10.2, minZ: -11.2, maxZ: 11.2 });
    };

    createDepot(-80, true, 'SPAWN DES BRAINROTS');
    createDepot(80, false, 'TERMINAL DES VENTES');
  }

  private buildTradePlaza(): void {
    // Allée avec stands d'achat, machines à gacha et tapis rouge d'exposition
    const plazaGroup = new THREE.Group();
    plazaGroup.position.set(-42, 0, -14);

    // Tapis rouge d'exposition
    const carpetMat = std(0xd50000, { roughness: 0.6 });
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), carpetMat);
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.02, 0);
    carpet.receiveShadow = true;
    plazaGroup.add(carpet);

    // Piédestaux d'exposition d'enchères
    const pedMat = std(0xffd600, { metalness: 0.8, roughness: 0.2 });
    for (const [px, pz] of [[-3.5, -2.5], [3.5, -2.5], [-3.5, 2.5], [3.5, 2.5]]) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.9, 16), pedMat);
      ped.position.set(px, 0.45, pz);
      ped.castShadow = true;
      plazaGroup.add(ped);
      this.circles.push({ x: -42 + px, z: -14 + pz, r: 0.7 });
    }

    // Enseigne TRADE PLAZA
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 1.6),
      new THREE.MeshStandardMaterial({
        map: textTexture([['TRADE PLAZA', '#ffd600', 60], ['Échange & Gacha de Brainrots', '#00e5ff', 36]], 1024, 256, '#0f1224'),
      }),
    );
    sign.position.set(0, 2.8, -4.0);
    plazaGroup.add(sign);

    this.group.add(plazaGroup);
  }

  private buildSafeZones(): void {
    // Safe Zones : plateformes surélevées avec barrières lumineuses néon empêchant le vol
    const safeZoneCoords = [
      { x: -35, z: 22 },
      { x: 35, z: 22 },
    ];

    const platformMat = std(0x00e5ff, { emissive: 0x004466, emissiveIntensity: 0.3 });
    const barrierMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });

    for (const sz of safeZoneCoords) {
      const g = new THREE.Group();
      g.position.set(sz.x, 0, sz.z);

      // Plateforme surélevée (y = 0.25)
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.5, 24), platformMat);
      plat.position.y = 0.25;
      plat.receiveShadow = true;
      g.add(plat);

      // Dôme / barrière lumineuse
      const barrier = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 2.5, 24, 1, true), barrierMat);
      barrier.position.y = 1.5;
      g.add(barrier);

      // Anneau néon animé
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(4.3, 4.6, 32),
        new THREE.MeshBasicMaterial({ color: 0x76ff03, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.52;
      g.add(ring);
      this.neonRings.push(ring);

      this.group.add(g);
      this.circles.push({ x: sz.x, z: sz.z, r: 4.4 });
    }
  }
}
