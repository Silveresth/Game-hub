import * as THREE from 'three';
import { Character } from './character';
import { Label } from './labels';
import { artTexture } from './convoy';
import type { HallSeat, HallState } from './net';

/**
 * Salle de l'hôtel des ventes (phase 4) : une scène à part, rendue à la place du quartier quand on y entre.
 * Estrade avec commissaire-priseur et chevalet sous projecteur, 6 rangs de 8 places.
 * Le serveur attribue les places : chaque joueur s'assoit automatiquement, la caméra regarde l'estrade.
 */
const COLS = 8;
const STAGE_Z = -12;
const FRAME_COLORS: Record<string, number> = { normal: 0x3a2516, dore: 0xe0b041, diamant: 0xcff0ff };

export function seatPos(seat: number): THREE.Vector3 {
  const row = Math.floor(seat / COLS);
  const col = seat % COLS;
  return new THREE.Vector3(-10.5 + col * 3 + (col >= 4 ? 1.2 : -1.2), 0, -2 + row * 2.8); // allée centrale
}

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

interface Sitter {
  ch: Character;
  label: Label;
  key: string;
}

export class AuctionHall {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private sitters = new Map<number, Sitter>();
  /** Créé à la première entrée (le modèle 3D est chargé après le module). */
  private auctioneer: Character | null = null;
  private painting: THREE.Mesh;
  private frame: THREE.Mesh;
  private spot: THREE.SpotLight;
  private board: Label;
  private lastBidAt = 0;
  private lastPhase = '';
  private lotKey = '';
  private boardKey = '';
  private camTarget = new THREE.Vector3(0, 3.4, STAGE_Z);
  private camPos = new THREE.Vector3(0, 6, 16);
  state: HallState | null = null;
  active = false;
  selfId = '';

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x1a0f10);
    s.fog = new THREE.Fog(0x1a0f10, 30, 70);
    s.add(new THREE.HemisphereLight(0xffe9d0, 0x3a2020, 1.6));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.2);
    key.position.set(6, 14, 10);
    s.add(key);

    // sol, murs, plafond
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), std(0x5a1a1f, { roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 1;
    s.add(floor);
    const wall = std(0x3b1418, { roughness: 0.9 });
    const panel = (w: number, h: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wall);
      m.position.set(x, h / 2, z);
      m.rotation.y = ry;
      s.add(m);
    };
    panel(34, 10, 0, -16, 0);
    panel(34, 10, -17, 1, Math.PI / 2);
    panel(34, 10, 17, 1, -Math.PI / 2);
    panel(34, 10, 0, 18, Math.PI);
    // boiseries dorées
    for (const x of [-17, 17]) {
      for (let z = -12; z <= 14; z += 6.5) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), std(0xc9a24a, { metalness: 0.7, roughness: 0.35 }));
        pil.position.set(x * 0.97, 5, z);
        s.add(pil);
      }
    }
    // lustres
    for (const [x, z] of [[-7, 2], [7, 2], [0, 10]] as const) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
      c.position.set(x, 8.2, z);
      s.add(c);
      const l = new THREE.PointLight(0xffe2b0, 40, 26, 1.4);
      l.position.copy(c.position);
      s.add(l);
    }

    // estrade
    const stage = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 7), std(0x2a1a12, { roughness: 0.5 }));
    stage.position.set(0, 0.4, STAGE_Z);
    s.add(stage);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(18.2, 0.12, 0.2), std(0xc9a24a, { metalness: 0.8, roughness: 0.3 }));
    edge.position.set(0, 0.82, STAGE_Z + 3.5);
    s.add(edge);
    // rideau de fond
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(20, 9), std(0x8e1b25, { roughness: 1 }));
    curtain.position.set(0, 4.5, -15.9);
    s.add(curtain);
    // pupitre
    const lectern = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 0.9), std(0x5c3a22, { roughness: 0.45 }));
    lectern.position.set(-5, 1.55, STAGE_Z + 1.4);
    s.add(lectern);

    // chevalet + tableau du lot
    const easelMat = std(0x6b4a2e);
    for (const dx of [-1.1, 1.1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.6, 0.12), easelMat);
      leg.position.set(2.5 + dx, 3.0, STAGE_Z + 0.2);
      leg.rotation.z = -dx * 0.08;
      s.add(leg);
    }
    this.frame = new THREE.Mesh(new THREE.BoxGeometry(4.9, 3.8, 0.12), std(FRAME_COLORS.normal, { roughness: 0.4 }));
    this.frame.position.set(2.5, 3.9, STAGE_Z + 0.35);
    s.add(this.frame);
    this.painting = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
    this.painting.position.set(2.5, 3.9, STAGE_Z + 0.42);
    s.add(this.painting);
    this.spot = new THREE.SpotLight(0xfff4dc, 60, 30, 0.35, 0.5, 1.2);
    this.spot.position.set(2.5, 9.5, STAGE_Z + 7);
    this.spot.target = this.painting;
    s.add(this.spot);

    // panneau des enchères au-dessus de l'estrade
    this.board = new Label(1.6, 900, 240);
    this.board.sprite.position.set(-4.5, 5.6, STAGE_Z - 1);
    s.add(this.board.sprite);

    // chaises
    const chairMat = std(0x2c1a14, { roughness: 0.5 });
    const cushion = std(0xa3242f, { roughness: 0.9 });
    for (let i = 0; i < 48; i++) {
      const p = seatPos(i);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.0), cushion);
      seat.position.set(p.x, 0.62, p.z);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.12), chairMat);
      back.position.set(p.x, 1.2, p.z + 0.5);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.56, 0.8), chairMat);
      base.position.set(p.x, 0.28, p.z);
      s.add(seat, back, base);
    }
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private sitterFor(s: HallSeat): Sitter {
    const key = `${s.id}|${s.color}|${s.name}`;
    let sit = this.sitters.get(s.seat);
    if (sit && sit.key === key) return sit;
    if (sit) this.dropSitter(s.seat);
    // collectionneurs PNJ : apparence variée ; joueurs : leur couleur
    const ch = s.npc ? new Character(undefined, { crowd: true }) : new Character(parseInt(s.color.slice(1), 16));
    const p = seatPos(s.seat);
    ch.root.position.set(p.x, 0.12, p.z + 0.05);
    ch.root.rotation.y = Math.PI; // face à l'estrade
    ch.play('Sitting', 0);
    const label = new Label(0.42, 512, 110);
    const me = s.id === this.selfId;
    label.update([{ text: me ? `★ ${s.name}` : s.name, color: me ? '#ffd36b' : s.npc ? '#cfc9bb' : '#fff', size: 46, weight: 900 }], { bg: 'rgba(0,0,0,.55)', border: me ? '#ffd36b' : 'rgba(255,255,255,.15)' });
    label.sprite.position.y = 2.3;
    ch.root.add(label.sprite);
    this.scene.add(ch.root);
    sit = { ch, label, key };
    this.sitters.set(s.seat, sit);
    return sit;
  }

  private dropSitter(seat: number): void {
    const s = this.sitters.get(seat);
    if (!s) return;
    s.ch.dispose();
    s.label.dispose();
    this.sitters.delete(seat);
  }

  apply(st: HallState): void {
    this.state = st;
    const seen = new Set<number>();
    for (const s of st.seats) {
      seen.add(s.seat);
      this.sitterFor(s);
    }
    for (const seat of [...this.sitters.keys()]) if (!seen.has(seat)) this.dropSitter(seat);
    // caméra derrière sa place, tournée vers l'estrade
    if (st.you.seat !== null) {
      const p = seatPos(st.you.seat);
      this.camPos.set(p.x * 0.6, 4.6, p.z + 6.5);
    }
    const lot = st.lot;
    if (lot) {
      const key = `${st.sale?.id}:${lot.index}`;
      if (key !== this.lotKey) {
        this.lotKey = key;
        const m = this.painting.material as THREE.MeshStandardMaterial;
        m.map = artTexture(lot.workId);
        m.needsUpdate = true;
        const f = this.frame.material as THREE.MeshStandardMaterial;
        f.color.setHex(FRAME_COLORS[lot.frame] ?? FRAME_COLORS.normal);
        f.metalness = lot.frame === 'normal' ? 0.1 : 1;
        this.auctioneer?.gesture('Wave', 'Idle');
      }
      // une main levée à chaque nouvelle enchère
      if (lot.lastBid && lot.lastBid.at !== this.lastBidAt) {
        this.lastBidAt = lot.lastBid.at;
        this.sitters.get(lot.lastBid.seat)?.ch.gesture('Wave', 'Sitting');
        this.auctioneer?.gesture('ThumbsUp', 'Idle');
      }
      if (lot.phase === 'sold' && this.lastPhase !== `sold:${key}`) {
        this.lastPhase = `sold:${key}`;
        this.auctioneer?.gesture('Yes', 'Idle'); // coup de marteau
        if (lot.outcome?.sold && lot.leader) this.sitters.get(lot.leader.seat)?.ch.gesture('ThumbsUp', 'Sitting');
      }
    } else {
      (this.painting.material as THREE.MeshStandardMaterial).map = null;
      (this.painting.material as THREE.MeshStandardMaterial).needsUpdate = true;
      this.lotKey = '';
    }
  }

  update(dt: number, t: number, now: number): void {
    for (const s of this.sitters.values()) s.ch.update(dt);
    this.auctioneer?.update(dt);
    // tableau : proportions de l'image une fois chargée
    const img = (this.painting.material as THREE.MeshStandardMaterial).map?.image as HTMLImageElement | undefined;
    if (img?.width) {
      const r = img.width / img.height;
      const w = r >= 4.5 / 3.4 ? 4.5 : 3.4 * r;
      const h = w / r;
      this.painting.scale.set(w / 4.5, h / 3.4, 1);
      this.frame.scale.set((w + 0.4) / 4.9, (h + 0.4) / 3.8, 1);
    }
    this.spot.intensity = 60 + Math.sin(t * 2) * 4;
    // panneau : prix en cours et chrono
    const lot = this.state?.lot;
    const lines = !lot
      ? [{ text: 'HÔTEL DES VENTES', color: '#e8b64c', size: 70, weight: 900 }, { text: this.state?.next ? `${this.state.next.label} à venir` : 'Aucune vente prévue', color: '#fff', size: 52, weight: 800 }]
      : lot.phase === 'present'
        ? [{ text: `LOT ${lot.index + 1} / ${lot.count}`, color: '#e8b64c', size: 64, weight: 900 }, { text: `Mise à prix ${lot.price.toLocaleString('fr-FR')}`, color: '#fff', size: 56, weight: 900 }]
        : lot.phase === 'bidding'
          ? [{ text: `${lot.price.toLocaleString('fr-FR')}`, color: '#ffd36b', size: 92, weight: 900 }, { text: `${lot.leader ? lot.leader.name : 'Mise à prix'} · ${Math.max(0, Math.ceil((lot.phaseEnd - now) / 1000))} s`, color: '#fff', size: 48, weight: 800 }]
          : [{ text: lot.outcome?.sold ? 'ADJUGÉ !' : 'INVENDU', color: lot.outcome?.sold ? '#7dff9a' : '#ff8fa0', size: 84, weight: 900 }, { text: lot.outcome?.sold ? `${lot.outcome.name} · ${(lot.outcome.price ?? 0).toLocaleString('fr-FR')}` : '', color: '#fff', size: 48, weight: 800 }];
    const boardKey = JSON.stringify(lines);
    if (boardKey !== this.boardKey) {
      this.boardKey = boardKey;
      this.board.update(lines, { bg: 'rgba(10,6,6,.85)', border: '#c9a24a' });
    }
    // caméra : glisse doucement vers sa place, léger balancement
    const k = 1 - Math.exp(-3 * dt);
    this.camera.position.lerp(this.camPos.clone().add(new THREE.Vector3(Math.sin(t * 0.3) * 0.25, 0, 0)), k);
    this.camera.lookAt(this.camTarget);
  }

  /** Entrée dans la salle : caméra placée d'emblée au fond. */
  enter(selfId: string): void {
    if (!this.auctioneer) {
      this.auctioneer = new Character(0x23232b);
      this.auctioneer.root.position.set(-5, 0.8, STAGE_Z + 0.4);
      this.scene.add(this.auctioneer.root);
    }
    this.selfId = selfId;
    this.active = true;
    this.camera.position.set(0, 6, 18);
    this.camera.lookAt(this.camTarget);
  }

  leave(): void {
    this.active = false;
    for (const seat of [...this.sitters.keys()]) this.dropSitter(seat);
    this.state = null;
    this.lotKey = '';
  }
}
