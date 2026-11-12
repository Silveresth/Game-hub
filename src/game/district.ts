import * as THREE from 'three';
import { money } from './catalog';

/** Quartier des musées : place centrale, route du convoi, 7 parcelles de joueurs + l'hôtel des ventes. */
export const BOUNDS = { minX: -84, maxX: 84, minZ: -62, maxZ: 62 };
export const ROAD = { z: 0, x0: -72, x1: 72 };
/** Comptoir du marché noir (devant la tente, côté place). */
export const BLACK_MARKET = { x: -60, z: -10 };
/** Porte de l'hôtel des ventes (au pied des marches). */
export const AUCTION_DOOR = { x: 60, z: -24.4 };

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Circle { x: number; z: number; r: number }

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function tileTexture(base: string, line: string, tiles: number, noise = 0.05): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${noise})` : `rgba(0,0,0,${noise})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = line;
  g.lineWidth = 3;
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

function textTexture(lines: Array<[string, string, number]>, w = 1024, h = 256, bg = '#141826'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e8b64c';
  g.lineWidth = 10;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = lines.reduce((s, [, , size]) => s + size * 1.25, 0);
  let y = (h - total) / 2;
  for (const [text, color, size] of lines) {
    g.font = `800 ${size}px Georgia, 'Times New Roman', serif`;
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
  private water!: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildSky(scene);
    this.buildGround();
    this.buildPlots();
    this.buildPlaza();
    this.buildBoard();
    this.buildPerimeterFence();
    this.buildDepots();
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
    title = 'LES MUSÉES LES PLUS RICHES',
    subtitle = 'valeur totale des collections',
    empty = 'Achetez votre première œuvre pour entrer au classement',
  ): void {
    const c = this.boardCanvas;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0d1018';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#e8b64c';
    g.lineWidth = 14;
    g.strokeRect(7, 7, c.width - 14, c.height - 14);
    g.fillStyle = '#e8b64c';
    g.font = "800 64px Georgia, serif";
    g.textAlign = 'center';
    g.fillText(title, c.width / 2, 92, c.width - 80);
    g.font = "600 30px 'Segoe UI', sans-serif";
    g.fillStyle = '#a9a49a';
    g.fillText(subtitle, c.width / 2, 136);
    const medals = ['#ffd36b', '#d9dde6', '#d08a4a'];
    rows.slice(0, 6).forEach((r, i) => {
      const y = 210 + i * 64;
      const me = r.name === myName;
      if (me) {
        g.fillStyle = 'rgba(232,182,76,.16)';
        g.fillRect(60, y - 44, c.width - 120, 58);
      }
      g.textAlign = 'left';
      g.font = "800 40px 'Segoe UI', sans-serif";
      g.fillStyle = medals[i] ?? '#cfc9bb';
      g.fillText(`${i + 1}.`, 80, y);
      g.fillStyle = me ? '#ffd36b' : '#f2ede1';
      g.fillText(r.name.slice(0, 22), 150, y);
      g.textAlign = 'right';
      g.fillStyle = '#ffd36b';
      g.fillText(money(r.value), c.width - 80, y);
    });
    if (!rows.length) {
      g.textAlign = 'center';
      g.fillStyle = '#cfc9bb';
      g.font = "600 40px 'Segoe UI', sans-serif";
      g.fillText(empty, c.width / 2, 320, c.width - 100);
    }
    this.boardTexture.needsUpdate = true;
  }

  update(t: number): void {
    const w = this.water.material as THREE.MeshStandardMaterial;
    w.emissiveIntensity = 0.25 + Math.sin(t * 1.5) * 0.08;
  }

  // ---------------------------------------------------------------- construction

  private buildSky(scene: THREE.Scene): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color('#2568ba') }, horizon: { value: new THREE.Color('#9fc2ea') } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          varying vec3 vP;
          void main() {
            gl_FragColor = vec4(mix(horizon, top, smoothstep(-0.02, 0.4, vP.y)), 1.0);
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
    // Grand dallage minéral et allées structurées en plaques de pierre
    // 1. Dalle de fondation globale en pierre beige/grège chaleureuse
    const baseStone = tileTexture('#5a5245', 'rgba(30,25,20,0.45)', 8, 0.04);
    baseStone.repeat.set(50, 50);
    this.plane(240, 180, 0, 0, std(0xffffff, { map: baseStone, roughness: 0.9 }), -0.05);

    // 2. Parvis central majestueux en pavés de pierre ambrée chaleureuse
    const pav = tileTexture('#948470', 'rgba(40,35,28,0.5)', 4, 0.03);
    pav.repeat.set(170 / 4, 48 / 4);
    this.plane(170, 48, 0, 0, std(0xffffff, { map: pav, roughness: 0.8 }), -0.01);

    // 3. Trottoirs piétons d'accès le long de la place (nord et sud) en pierre dorée
    const walkwayMat = std(0xa89984, { roughness: 0.75 });
    this.plane(160, 4.0, 0, -5.5, walkwayMat, 0.01);
    this.plane(160, 4.0, 0, 5.5, walkwayMat, 0.01);

    // 4. Chaussée du convoi (asphalte sombre avec bordures en granit clair)
    const asphalt = tileTexture('#282b30', 'rgba(0,0,0,0)', 1, 0.04);
    asphalt.repeat.set(30, 1);
    this.plane(148, 6.4, 0, ROAD.z, std(0xffffff, { map: asphalt, roughness: 0.85 }), 0);

    for (let x = ROAD.x0 + 2; x < ROAD.x1; x += 6) {
      this.plane(3, 0.25, x, ROAD.z, std(0xf4f0e4), 0.01);
    }
    for (const z of [-3.35, 3.35]) {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(148, 0.2, 0.35), std(0x736c62, { roughness: 0.7 }));
      kerb.position.set(0, 0.1, z);
      kerb.receiveShadow = true;
      this.group.add(kerb);
    }

    // 5. Parcelles des musées : dallages individuels raffinés en damier de pierre noble
    const plot = tileTexture('#8c7f6d', 'rgba(40,35,28,0.4)', 6, 0.02);
    plot.repeat.set(6, 6);
    const plotMat = std(0xffffff, { map: plot, roughness: 0.75 });
    for (const x of [-60, -20, 20, 60]) {
      for (const z of [-41, 41]) {
        // Dalle de parcelle complète
        this.plane(38, 38, x, z, plotMat, -0.005);
        // Allée en plaques de travertin guidant de la chaussée jusqu'à l'entrée du musée
        const walkZ = z > 0 ? 15 : -15;
        this.plane(6, 18, x, walkZ, std(0xa89882, { roughness: 0.7 }), 0.005);
      }
    }
  }

  /** Bâtiments majestueux et palais d'art impériaux avec toiture classique complète. */
  private buildPlots(): void {
    const stone = std(0xe8e0cf, { roughness: 0.8 });
    const dark = std(0x2a2d36, { roughness: 0.5 });
    const roofSlate = std(0x38414e, { roughness: 0.7 });
    const goldAccent = std(0xe8b64c, { metalness: 0.7, roughness: 0.3 });

    const facade = (x: number, z: number, facing: 1 | -1, title: string, sub: string, accent = 0xe8b64c, dome = false) => {
      const g = new THREE.Group();
      // Corps principal de l'édifice
      const body = new THREE.Mesh(new THREE.BoxGeometry(30, 9.5, 24), stone);
      body.position.set(0, 4.75, 0);
      g.add(body);
      this.occluders.push(body);

      // Corniche supérieure en pierre moulurée
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(31.2, 0.6, 25.2), stone);
      cornice.position.y = 9.8;
      g.add(cornice);

      // Toiture majestueuse à 4 pans (toit complet au-dessus du bâtiment)
      const roofPeak = new THREE.Mesh(new THREE.ConeGeometry(19, 4.8, 4), roofSlate);
      roofPeak.rotation.y = Math.PI / 4;
      roofPeak.scale.set(1.15, 1, 0.9);
      roofPeak.position.set(0, 12.5, 0);
      g.add(roofPeak);

      // Fronton triangulaire architectural sculpté (orienté vers le ciel)
      const pedShape = new THREE.Shape();
      pedShape.moveTo(-13, 0);
      pedShape.lineTo(13, 0);
      pedShape.lineTo(0, 3.2);
      pedShape.closePath();
      const pedGeo = new THREE.ExtrudeGeometry(pedShape, { depth: 0.9, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.08, bevelThickness: 0.08 });
      const ped = new THREE.Mesh(pedGeo, stone);
      ped.position.set(0, 9.8, 12.1);

      const clockOrn = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.15, 24), goldAccent);
      clockOrn.rotation.x = Math.PI / 2;
      clockOrn.position.set(0, 10.8, 12.2);
      g.add(ped, clockOrn);

      // Colonnade classique avec chapiteaux dorés
      for (let i = 0; i < 6; i++) {
        const colGroup = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 8.4, 16), stone);
        shaft.position.y = 4.2;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.3), goldAccent);
        cap.position.y = 8.5;
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), stone);
        base.position.y = 0.2;
        colGroup.add(shaft, cap, base);
        colGroup.position.set(-12.5 + i * 5, 0, 13.6);
        g.add(colGroup);
      }

      // Grand perron et marches monumentales
      const steps = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 3.6), std(0xd9d1bf, { roughness: 0.8 }));
      steps.position.set(0, 0.3, 15.4);
      g.add(steps);

      // Grande porte en chêne sombre avec poignées dorées
      const door = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.8, 0.35), dark);
      door.position.set(0, 2.9, 12.05);
      g.add(door);

      // Dôme central prestigieux (pour l'Hôtel des Ventes)
      if (dome) {
        const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 2.2, 32), stone);
        domeBase.position.y = 11.0;
        const d = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), std(accent, { metalness: 0.8, roughness: 0.25 }));
        d.position.y = 12.1;
        const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.0, 16), goldAccent);
        lantern.position.y = 19.1;
        g.add(domeBase, d, lantern);
      }

      // Enseigne prestigieuse en laiton gravé
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(10.5, 2.6),
        new THREE.MeshStandardMaterial({ map: textTexture([[title, '#e8b64c', 74], [sub, '#cfc9bb', 46]]), roughness: 0.5 }),
      );
      sign.position.set(0, 7.8, 14.3);
      g.add(sign);

      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      g.position.set(x, 0, z);
      g.rotation.y = facing === 1 ? 0 : Math.PI;
      this.group.add(g);
      // emprise au sol (corps + colonnade + marches)
      const zFront = z + facing * 17.5;
      const zBack = z - facing * 12.5;
      this.boxes.push({ minX: x - 15.8, maxX: x + 15.8, minZ: Math.min(zFront, zBack), maxZ: Math.max(zFront, zBack) });
    };
    // Palais des Enchères (Hôtel des Ventes) situé au nord-est
    facade(60, -42, 1, 'HÔTEL DES VENTES', 'Enchères de Chefs-d’Œuvre', 0xc9302c, true);
  }

  private buildPlaza(): void {
    // fontaine
    const f = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.8, 40), std(0xd9d1bf));
    basin.position.y = 0.4;
    this.water = new THREE.Mesh(
      new THREE.CylinderGeometry(3.05, 3.05, 0.1, 40),
      new THREE.MeshStandardMaterial({ color: 0x3f8fe0, emissive: 0x1b4f8f, emissiveIntensity: 0.25, roughness: 0.15, metalness: 0.2 }),
    );
    this.water.position.y = 0.76;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 16), std(0xd9d1bf));
    column.position.y = 1.7;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.4, 0.4, 24), std(0xd9d1bf));
    bowl.position.y = 3;
    f.add(basin, this.water, column, bowl);
    f.position.set(0, 0, -12);
    f.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(f);
    this.circles.push({ x: 0, z: -12, r: 3.6 });

    // lampadaires élégants disposés le long de la route en évitant strictement l'axe central des musées
    // Les musées sont situés à x = -60, -20, 20, 60 -> on place les lampadaires aux entre-axes (x = -75, -40, 0, 40, 75)
    const post = std(0x23262e, { metalness: 0.6, roughness: 0.4 });
    const bulb = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffd58a, emissiveIntensity: 1.4 });
    for (const x of [-75, -40, 0, 40, 75]) {
      for (const z of [-5.2, 5.2]) {
        const l = new THREE.Group();
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 4.2, 10), post);
        p.position.y = 2.1;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), bulb);
        b.position.y = 4.35;
        l.add(p, b);
        l.position.set(x, 0, z);
        l.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        this.group.add(l);
        this.circles.push({ x, z, r: 0.2 });
      }
    }

    // arbres en bacs aux coins de la place
    const leaf = std(0x4e8f44, { flatShading: true });
    const trunk = std(0x7a5232);
    const planter = std(0xcfc6b2);
    for (const [x, z] of [[-40, -14], [40, -14], [-40, 14], [-75, 14], [75, 14], [-75, -14], [75, -14]] as const) {
      const t = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 2.4), planter);
      box.position.y = 0.4;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 8), trunk);
      tr.position.y = 1.9;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 0), leaf);
      crown.position.y = 3.9;
      crown.scale.y = 1.15;
      t.add(box, tr, crown);
      t.position.set(x, 0, z);
      t.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.group.add(t);
      this.boxes.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2 });
    }

    // Échoppe discrète et élégante du Marché Noir : comptoir en acajou et tenture pourpre
    const tent = new THREE.Group();
    // Pavillon en bois sombre avec toiture en pagode/mansarde pourpre
    const cloth = new THREE.Mesh(new THREE.ConeGeometry(3.6, 3.2, 4), std(0x2d182e, { roughness: 0.6 }));
    cloth.position.y = 3.6;
    cloth.rotation.y = Math.PI / 4;

    const base = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.0, 4.8), std(0x211728, { roughness: 0.7 }));
    base.position.y = 1.0;

    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.0, 1.2), std(0x3e2723, { roughness: 0.4 }));
    counter.position.set(0, 0.5, 2.0);

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff4081, emissive: 0xc2185b, emissiveIntensity: 1.8 })
    );
    lantern.position.set(0, 2.5, 2.1);

    tent.add(cloth, base, counter, lantern);
    this.occluders.push(cloth, base);

    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.1),
      new THREE.MeshStandardMaterial({
        map: textTexture([['MARCHÉ NOIR', '#ff4081', 68], ['Outils d’Infiltration', '#e0e0e0', 42]], 1024, 256, '#180c1c'),
        roughness: 0.5,
      })
    );
    tag.position.set(0, 2.2, 2.45);
    tent.add(tag);

    tent.position.set(BLACK_MARKET.x, 0, BLACK_MARKET.z - 3);
    tent.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(tent);
    this.boxes.push({ minX: -62.6, maxX: -57.4, minZ: -16.0, maxZ: -10.0 });
  }

  private buildBoard(): void {
    this.boardCanvas.width = 1280;
    this.boardCanvas.height = 640;
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshStandardMaterial({ map: this.boardTexture, emissive: 0xffffff, emissiveMap: this.boardTexture, emissiveIntensity: 0.65 }),
    );
    screen.position.y = 4.6;
    const back = new THREE.Mesh(new THREE.BoxGeometry(10.6, 5.6, 0.3), std(0x1b1e27, { metalness: 0.5 }));
    back.position.set(0, 4.6, -0.17);
    g.add(screen, back);
    for (const sx of [-4, 4]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.35), std(0x1b1e27));
      p.position.set(sx, 1.1, -0.17);
      g.add(p);
    }
    g.position.set(-20, 0, -13);
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.group.add(g);
    this.boxes.push({ minX: -25.3, maxX: -14.7, minZ: -13.5, maxZ: -12.6 });
    this.setLeaderboard([], '');
  }

  /**
   * Mur d'enceinte géant de la ville (hauteur 14 mètres) :
   * Impossible de voir au-delà et impossible à traverser.
   * Aucune grille intérieure : espace urbain fluide et élégant.
   */
  private buildPerimeterFence(): void {
    const wallHeight = 14.0;
    const wallThick = 2.4;
    const wallMat = std(0x423d37, { roughness: 0.95 });
    const capMat = std(0x2a2723, { roughness: 0.85 });

    const addPerimeterWall = (x1: number, z1: number, x2: number, z2: number) => {
      const g = new THREE.Group();
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) return;
      const angle = Math.atan2(dx, dz);

      g.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
      g.rotation.y = angle;

      // Mur d'enceinte opaque géant
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(wallThick, wallHeight, len), wallMat);
      wallMesh.position.y = wallHeight / 2;
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      g.add(wallMesh);
      this.occluders.push(wallMesh);

      // Couronnement / corniche supérieure de protection
      const capMesh = new THREE.Mesh(new THREE.BoxGeometry(wallThick + 0.6, 1.0, len), capMat);
      capMesh.position.y = wallHeight + 0.5;
      capMesh.castShadow = true;
      g.add(capMesh);

      // Contreforts réguliers le long du mur tous les 12 mètres
      const count = Math.max(1, Math.round(len / 12));
      const step = len / count;
      for (let i = 0; i <= count; i++) {
        const offset = -len / 2 + i * step;
        const buttress = new THREE.Mesh(new THREE.BoxGeometry(wallThick + 1.2, wallHeight, 1.6), wallMat);
        buttress.position.set(0, wallHeight / 2, offset);
        buttress.castShadow = true;
        g.add(buttress);
      }

      this.group.add(g);

      // Boîte de collision infranchissable
      const minX = Math.min(x1, x2) - wallThick / 2 - 0.2;
      const maxX = Math.max(x1, x2) + wallThick / 2 + 0.2;
      const minZ = Math.min(z1, z2) - wallThick / 2 - 0.2;
      const maxZ = Math.max(z1, z2) + wallThick / 2 + 0.2;
      this.boxes.push({ minX, maxX, minZ, maxZ });
    };

    // 4 pans du grand mur d'enceinte infranchissable qui clôture toute la ville
    addPerimeterWall(BOUNDS.minX, BOUNDS.minZ, BOUNDS.maxX, BOUNDS.minZ);
    addPerimeterWall(BOUNDS.minX, BOUNDS.maxZ, BOUNDS.maxX, BOUNDS.maxZ);
    addPerimeterWall(BOUNDS.minX, BOUNDS.minZ, BOUNDS.minX, -6);
    addPerimeterWall(BOUNDS.minX, 6, BOUNDS.minX, BOUNDS.maxZ);
    addPerimeterWall(BOUNDS.maxX, BOUNDS.minZ, BOUNDS.maxX, -6);
    addPerimeterWall(BOUNDS.maxX, 6, BOUNDS.maxX, BOUNDS.maxZ);
  }

  /**
   * Grands bâtiments / hangars d'où sortent et entrent les camions du convoi d'œuvres d'art.
   * - Ouest : Dépôt de logistique d'art d'où les camions sortent par une haute porte noire.
   * - Est : Dépôt sécurisé des convois où les camions entrent à la fin de leur parcours.
   */
  private buildDepots(): void {
    const wallMat = std(0x232630, { roughness: 0.7 });
    const trimMat = std(0x181a22, { roughness: 0.5, metalness: 0.5 });
    const roofMat = std(0x14161d, { roughness: 0.8 });
    const blackDoorMat = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.95 });
    const yellowStripeMat = new THREE.MeshBasicMaterial({ color: 0xf5b722 });

    const createDepot = (xCenter: number, isWest: boolean, title: string) => {
      const g = new THREE.Group();
      // Bâtiment de 20m de large, 10m de haut, 22m de profondeur
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 22), wallMat);
      body.position.set(0, 5, 0);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      this.occluders.push(body);

      // Toit à pans biseautés
      const roof = new THREE.Mesh(new THREE.BoxGeometry(20.8, 1.2, 22.8), roofMat);
      roof.position.set(0, 10.6, 0);
      roof.castShadow = true;
      g.add(roof);

      // Encadrement de la grande porte de convoi (face intérieure tournée vers la place)
      const doorFacingX = isWest ? 10.05 : -10.05;
      const frameW = 0.6;
      const frameH = 6.4;
      const frameD = 8.6;

      const portalFrame = new THREE.Mesh(new THREE.BoxGeometry(frameW, frameH, frameD), trimMat);
      portalFrame.position.set(doorFacingX, 3.2, 0);
      portalFrame.castShadow = true;
      g.add(portalFrame);

      // Grande porte noire par laquelle passent les camions
      const blackDoor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.6, 7.6), blackDoorMat);
      blackDoor.position.set(doorFacingX + (isWest ? -0.1 : 0.1), 2.8, 0);
      g.add(blackDoor);

      // Bandes de sécurité jaunes / signalétique au-dessus de la porte
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 7.8), yellowStripeMat);
      stripe.position.set(doorFacingX + (isWest ? 0.05 : -0.05), 5.9, 0);
      g.add(stripe);

      // Enseigne du bâtiment
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 2.2),
        new THREE.MeshStandardMaterial({
          map: textTexture([[title, '#e8b64c', 60], ['CONVOIS SÉCURISÉS', '#cfc9bb', 38]], 1024, 256, '#0f121a'),
          roughness: 0.6,
        }),
      );
      sign.position.set(doorFacingX + (isWest ? 0.15 : -0.15), 7.8, 0);
      sign.rotation.y = isWest ? Math.PI / 2 : -Math.PI / 2;
      g.add(sign);

      // Lampes de quai au-dessus de la porte noire
      const lampGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xffd277, emissive: 0xffaa22, emissiveIntensity: 2.0 }),
      );
      lampGlow.position.set(doorFacingX + (isWest ? 0.35 : -0.35), 6.4, 0);
      g.add(lampGlow);

      g.position.set(xCenter, 0, 0);
      this.group.add(g);

      // Collision solide pour que le joueur ne rentre pas dans le bâtiment
      this.boxes.push({
        minX: xCenter - 10.2,
        maxX: xCenter + 10.2,
        minZ: -11.2,
        maxZ: 11.2,
      });
    };

    // Dépôt OUEST : Départ des convois (xCenter = -80)
    createDepot(-80, true, 'DÉPÔT CENTRAL');

    // Dépôt EST : Arrivée des convois (xCenter = 80)
    createDepot(80, false, 'TERMINAL DES ARTS');
  }
}
