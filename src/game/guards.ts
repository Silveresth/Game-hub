import * as THREE from 'three';
import { Character } from './character';
import { Label } from './labels';
import type { NetGuard } from './net';
import { FLOOR_H } from './layout';

/** Mêmes valeurs que le serveur (server/guards.mjs) : le cône affiché est exactement ce que voit le garde. */
const VISION = 10;
const HALF_ANGLE = 0.96;

const STATE_TEXT: Record<NetGuard['s'], { text: string; color: string } | null> = {
  patrol: null,
  return: null,
  yawn: { text: '😴 bâille… relève imminente', color: '#ffd36b' },
  break: { text: '☕ relève de la garde', color: '#9fe3ff' },
  chase: { text: '❗ AU VOLEUR !', color: '#ff6b6b' },
  alert: { text: '⚠ alarme : il accourt', color: '#ffb020' },
  blind: { text: '😵 aveuglé', color: '#cfc9bb' },
  lured: { text: '❓ distrait', color: '#b46bff' },
};

const CONE_COLOR: Partial<Record<NetGuard['s'], number>> = { patrol: 0xffd21f, return: 0xffd21f, yawn: 0xffd21f, chase: 0xff2a3d, alert: 0xff8a1f };

const coneGeo = (() => {
  // éventail centré sur +z (l'avant du personnage), posé au sol
  const g = new THREE.CircleGeometry(VISION, 28, -Math.PI / 2 - HALF_ANGLE, HALF_ANGLE * 2);
  g.rotateX(-Math.PI / 2);
  return g;
})();
/** Contour du cône : la limite exacte de ce que voit le garde. */
const edgeGeo = (() => {
  const pts = [new THREE.Vector3(0, 0, 0)];
  for (let i = 0; i <= 28; i++) {
    const a = -HALF_ANGLE + (i / 28) * HALF_ANGLE * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * VISION, 0, Math.cos(a) * VISION));
  }
  pts.push(new THREE.Vector3(0, 0, 0));
  return new THREE.BufferGeometry().setFromPoints(pts);
})();

class GuardView {
  readonly ch = new Character(0x1d2b4f);
  readonly label = new Label(0.6, 640, 130);
  readonly cone: THREE.Mesh;
  readonly edge: THREE.Line;
  target = new THREE.Vector3();
  ry = 0;
  s: NetGuard['s'] = 'patrol';
  floor = 0;
  private labelKey = '';

  constructor(scene: THREE.Scene, g: NetGuard) {
    // casquette de vigile
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.14, 18), new THREE.MeshStandardMaterial({ color: 0x0f1a33, roughness: 0.6 }));
    cap.position.y = 2.02;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.26), cap.material);
    visor.position.set(0, 1.97, 0.32);
    this.ch.root.add(cap, visor);
    // le cône flotte juste au-dessus du parquet (décalage de profondeur pour ne pas scintiller avec le sol)
    this.cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.cone.position.y = 0.14;
    this.edge = new THREE.Line(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, toneMapped: false }));
    this.cone.add(this.edge);
    this.cone.renderOrder = 2;
    this.ch.root.add(this.cone, this.label.sprite);
    this.label.sprite.position.y = 2.75;
    this.ch.root.position.set(g.x, 0, g.z);
    this.target.set(g.x, 0, g.z);
    this.ry = g.ry;
    this.ch.root.rotation.y = g.ry;
    scene.add(this.ch.root);
    this.refresh();
  }

  refresh(): void {
    const info = STATE_TEXT[this.s];
    const key = info ? info.text : 'GARDE';
    if (key !== this.labelKey) {
      this.labelKey = key;
      this.label.update(
        [{ text: info ? info.text : '👮 GARDE', color: info ? info.color : '#9fb6ff', size: 46, weight: 900 }],
        { bg: 'rgba(6,10,24,.75)', border: info ? info.color : 'rgba(159,182,255,.5)' },
      );
    }
    const c = CONE_COLOR[this.s];
    this.cone.visible = c !== undefined;
    if (c !== undefined) {
      const m = this.cone.material as THREE.MeshBasicMaterial;
      m.color.setHex(c);
      (this.edge.material as THREE.LineBasicMaterial).color.setHex(c);
      m.opacity = this.s === 'chase' ? 0.42 : this.s === 'alert' ? 0.38 : 0.32;
    }
  }

  dispose(): void {
    this.ch.dispose();
    this.label.dispose();
    (this.cone.material as THREE.Material).dispose();
    (this.edge.material as THREE.Material).dispose();
  }
}

/** Tous les gardes du quartier, interpolés entre deux instantanés du serveur. */
export class Guards {
  private map = new Map<string, GuardView>();
  /** Masque les gardes d'un étage caché (même règle que les joueurs). */
  hidden: (x: number, z: number, floor: number) => boolean = () => false;

  constructor(private scene: THREE.Scene) {}

  get count(): number {
    return this.map.size;
  }

  /** Gardes d'un musée donné (pour les tests et l'aide au joueur). */
  states(plot: number): Array<{ s: NetGuard['s']; x: number; z: number }> {
    return [...this.map.entries()].filter(([k]) => k.startsWith(`${plot}:`)).map(([, g]) => ({ s: g.s, x: g.target.x, z: g.target.z }));
  }

  sync(list: NetGuard[]): void {
    const seen = new Set<string>();
    for (const g of list) {
      const key = `${g.plot}:${g.k}`;
      seen.add(key);
      let v = this.map.get(key);
      if (!v) {
        v = new GuardView(this.scene, g);
        this.map.set(key, v);
      }
      v.target.set(g.x, (g.f ?? 0) * FLOOR_H, g.z);
      v.floor = g.f ?? 0;
      v.ry = g.ry;
      if (v.s !== g.s) {
        v.s = g.s;
        v.refresh();
      }
    }
    for (const [key, v] of this.map) {
      if (seen.has(key)) continue;
      v.dispose();
      this.map.delete(key);
    }
  }

  update(dt: number, t: number): void {
    for (const v of this.map.values()) {
      const pos = v.ch.root.position;
      const before = pos.clone();
      const k = 1 - Math.exp(-10 * dt);
      if (pos.distanceTo(v.target) > 8) pos.copy(v.target);
      else pos.lerp(v.target, k);
      let d = v.ry - v.ch.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.ch.root.rotation.y += d * k;
      v.ch.root.visible = !this.hidden(pos.x, pos.z, v.floor);
      const speed = pos.distanceTo(before) / Math.max(dt, 1e-3);
      v.ch.play(speed > 4 ? 'Running' : speed > 0.4 ? 'Walking' : v.s === 'break' || v.s === 'yawn' ? 'Sitting' : 'Idle');
      v.ch.update(dt);
      if (v.s === 'chase') (v.cone.material as THREE.MeshBasicMaterial).opacity = 0.38 + Math.sin(t * 12) * 0.1;
    }
  }
}
