import * as THREE from 'three';
import { Character } from './character';
import { Label } from './labels';
import { artTexture } from './convoy';
import type { NetPlayer } from './net';
import { FLOOR_H } from './layout';

/** Un autre joueur : personnage à sa couleur, nom au-dessus, œuvre portée au-dessus de la tête. */
class Remote {
  readonly ch: Character;
  readonly label = new Label(0.55, 512, 120);
  target = new THREE.Vector3();
  ry = 0;
  anim = 'Idle';
  carry: THREE.Mesh | null = null;
  carryKey = '';
  wanted = false; // voleur en fuite avec une œuvre du joueur local
  floor = 0;

  constructor(scene: THREE.Scene, readonly p: NetPlayer) {
    this.ch = new Character(parseInt(p.color.slice(1), 16));
    this.ch.root.position.set(p.x, 0, p.z);
    this.target.set(p.x, 0, p.z);
    this.ch.root.add(this.label.sprite);
    this.label.sprite.position.y = 2.75;
    scene.add(this.ch.root);
    this.refreshLabel();
  }

  disguised = false;

  refreshLabel(): void {
    // un déguisement trompe les gardes, pas les joueurs : le badge « employé » le trahit
    const text = this.wanted ? `⚠ ${this.p.name}` : this.disguised ? `🥸 ${this.p.name} · « employé »` : this.p.name;
    this.label.update(
      [{ text, color: this.wanted ? '#ff6b6b' : this.disguised ? '#ffd36b' : '#fff', size: 52, weight: 900 }],
      { bg: this.wanted ? 'rgba(80,0,10,.8)' : 'rgba(0,0,0,.55)', border: this.wanted ? '#ff4d6d' : this.disguised ? '#ffd36b' : 'rgba(255,255,255,.2)' },
    );
  }

  setCarry(carry: NetPlayer['carry']): void {
    const key = carry ? `${carry.workId}:${carry.frame}` : '';
    if (key === this.carryKey) return;
    this.carryKey = key;
    if (this.carry) {
      this.carry.removeFromParent();
      this.carry.geometry.dispose();
      this.carry = null;
    }
    if (carry) {
      this.carry = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), new THREE.MeshBasicMaterial({ map: artTexture(carry.workId), side: THREE.DoubleSide }));
      this.carry.position.set(0, 2.45, 0);
      this.ch.root.add(this.carry);
    }
  }
}

export class RemotePlayers {
  private map = new Map<string, Remote>();
  /** Masque les joueurs d'un étage caché (le joueur local est en dessous, dans le même musée). */
  hidden: (x: number, z: number, floor: number) => boolean = () => false;

  constructor(private scene: THREE.Scene) {}

  get count(): number {
    return this.map.size;
  }

  get(id: string): Remote | undefined {
    return this.map.get(id);
  }

  positionOf(id: string): THREE.Vector3 | null {
    return this.map.get(id)?.ch.root.position ?? null;
  }

  /** Met à jour la liste complète (instantané du serveur), sans le joueur local. */
  sync(players: NetPlayer[], selfId: string): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === selfId) continue;
      seen.add(p.id);
      let r = this.map.get(p.id);
      if (!r || r.p.color !== p.color || r.p.name !== p.name) {
        if (r) this.remove(p.id);
        r = new Remote(this.scene, p);
        this.map.set(p.id, r);
      }
      r.target.set(p.x, (p.f ?? 0) * FLOOR_H, p.z);
      r.floor = p.f ?? 0;
      r.ry = p.ry;
      r.anim = p.anim;
      r.setCarry(p.carry);
      if (r.disguised !== !!p.disguised) {
        r.disguised = !!p.disguised;
        r.refreshLabel();
      }
    }
    for (const id of [...this.map.keys()]) if (!seen.has(id)) this.remove(id);
  }

  remove(id: string): void {
    const r = this.map.get(id);
    if (!r) return;
    r.ch.dispose();
    r.label.dispose();
    this.map.delete(id);
  }

  setWanted(id: string, wanted: boolean): void {
    const r = this.map.get(id);
    if (!r || r.wanted === wanted) return;
    r.wanted = wanted;
    r.refreshLabel();
  }

  /** Interpolation douce vers la dernière position reçue (10 fois par seconde). */
  update(dt: number, t: number): void {
    for (const r of this.map.values()) {
      const pos = r.ch.root.position;
      const k = 1 - Math.exp(-12 * dt);
      const far = pos.distanceTo(r.target) > 8;
      if (far) pos.copy(r.target);
      else pos.lerp(r.target, k);
      let d = r.ry - r.ch.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.ch.root.rotation.y += d * k;
      r.ch.root.visible = !this.hidden(pos.x, pos.z, r.floor);
      r.ch.play(['Idle', 'Walking', 'Running', 'Jump'].includes(r.anim) ? r.anim : 'Idle');
      r.ch.update(dt);
      if (r.carry) r.carry.rotation.y = Math.sin(t * 2) * 0.2;
    }
  }
}
