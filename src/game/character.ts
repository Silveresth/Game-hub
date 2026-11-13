import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Personnages 3D animés. Tous les modèles humains partagent le même squelette (62 os) :
 * les animations (Idle, Walk, Run, Wave, Interact) d'un modèle s'appliquent aux autres tenues.
 *  - modèle principal (joueur, autres joueurs, gardes) : costume, teinté à la couleur choisie ;
 *  - foule (visiteurs, collectionneurs, passants) : 4 tenues (homme/femme, ville/costume) et une apparence
 *    tirée au hasard (teint, cheveux, vêtements) — chargées en arrière-plan, sans retarder le jeu.
 */
interface Template {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Vêtement principal (le plus grand), teinté à la couleur du joueur. */
  cloth?: string;
}

const loader = new GLTFLoader();
let main: Template | null = null;
const crowd: Template[] = [];
/** Tenues au choix des joueurs (skins) : 0 = costume (modèle principal), puis les tenues de la foule. */
const OUTFIT_FILES = ['', 'human_female', 'm_casual', 'f_casual'];
const outfits = new Map<number, Template>();

export async function loadCharacterModel(url: string): Promise<void> {
  const g = await loader.loadAsync(url);
  main = { scene: g.scene, clips: g.animations };
}

/** Tenues supplémentaires (foule et skins des joueurs), en arrière-plan ; en cas d'échec, on garde le modèle principal. */
export async function loadCrowdModels(): Promise<void> {
  if (!main || crowd.length) return;
  const male = main;
  for (let i = 1; i < OUTFIT_FILES.length; i++) {
    try {
      const g = await loader.loadAsync(`/models/${OUTFIT_FILES[i]}.glb`);
      // les tenues sans animation reprennent celles du modèle du même genre (même squelette)
      const anims = g.animations.length ? g.animations : (OUTFIT_FILES[i].startsWith('f') ? outfits.get(1) ?? male : male).clips;
      const tpl = { scene: g.scene, clips: anims };
      outfits.set(i, tpl);
      crowd.push(tpl);
    } catch {
      /* tenue indisponible : ignorée */
    }
  }
}

/** La tenue est-elle chargée (sinon le personnage porte le costume en attendant) ? */
export const hasOutfit = (skin: number): boolean => skin === 0 || outfits.has(skin);

/** Nom du vêtement principal d'une tenue : le matériau qui couvre le plus de triangles (hors peau, cheveux, yeux). */
function clothOf(tpl: Template): string {
  if (tpl.cloth !== undefined) return tpl.cloth;
  const size = new Map<string, number>();
  tpl.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    const geo = mesh.geometry;
    const total = geo.index ? geo.index.count : geo.getAttribute('position').count;
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const g of groups) {
      const n = mats[g.materialIndex ?? 0]?.name.toLowerCase() ?? '';
      if (!n || /skin|hair|eye/.test(n)) continue;
      size.set(n, (size.get(n) ?? 0) + Math.min(g.count, total));
    }
  });
  tpl.cloth = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return tpl.cloth;
}

const ONE_SHOT = new Set(['Jump', 'Wave', 'ThumbsUp', 'Yes', 'No', 'Punch', 'Death', 'WalkJump', 'Interact']);
const HEIGHT = 2.0; // taille humaine naturelle : lisible en vue à la 3e personne

// Palettes de l'apparence aléatoire (sRGB)
const SKIN = [0xf3d0b0, 0xe8b894, 0xd29a73, 0xb47a52, 0x8a5a3b, 0x60402b];
const HAIR = [0x1a1210, 0x2f1d12, 0x5a3820, 0x8d5a2b, 0xc89a55, 0xe1c690, 0x8b8b8b, 0xa33a2a];
const CLOTHES = [0x2b3a67, 0x8c2f39, 0x2e7d5b, 0xd9a441, 0x5a5f6b, 0x7a4fb3, 0xe07a5f, 0x3d5a80, 0x26262c, 0xe8e2d4, 0x4aa3a8, 0xb5651d, 0x9a3b6b, 0x6b8f3a];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** Pose « assis » : rotation des cuisses et des genoux (aucune animation assise dans les modèles). */
const SIT_THIGH = -Math.PI / 2;
const SIT_KNEE = Math.PI / 2;
const SIT_DROP = 0.46;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export interface CharacterOptions {
  /** Personnage de la foule : tenue et apparence au hasard. */
  crowd?: boolean;
  /** Tenue choisie par un joueur (0 = costume). */
  skin?: number;
}

export class Character {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private oneShot = false;
  private after = 'Idle';
  /** Matériaux clonés (teinte, apparence) : propres à ce personnage, libérés avec lui. */
  private ownMaterials: THREE.Material[] = [];
  private legs: THREE.Object3D[] = [];
  private sitting = false;
  private baseY = 0;
  /** Tenue réellement portée (0 si la tenue demandée n'est pas encore chargée). */
  readonly outfit: number;

  /** @param tint couleur du costume (joueur, gardes) ; ignorée pour la foule */
  constructor(tint?: number, opts: CharacterOptions = {}) {
    if (!main) throw new Error('Modèle du personnage non chargé');
    const chosen = !opts.crowd && opts.skin ? outfits.get(opts.skin) : undefined;
    this.outfit = chosen ? opts.skin! : 0;
    const tpl = opts.crowd && crowd.length ? pick([main, ...crowd]) : chosen ?? main;
    const cloth = chosen ? clothOf(chosen) : '';
    const model = cloneSkinned(tpl.scene);
    this.model = model;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
    this.baseY = model.position.y;
    // apparence de la foule : une couleur par « famille » de matériau, gardée pour tout le personnage
    const look = opts.crowd ? { skin: pick(SKIN), hair: pick(HAIR), clothes: new Map<string, number>() } : null;
    model.traverse((o) => {
      if (/pistol|gun|weapon|sword|arme/i.test(o.name)) {
        o.visible = false; // jamais d'arme sur les personnages
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      const next = mats.map((m) => {
        const name = m.name.toLowerCase();
        let color: number | null = null;
        if (look) {
          if (name.includes('skin')) color = name.includes('dark') ? darken(look.skin, 0.82) : look.skin;
          else if (name.includes('hair')) color = look.hair;
          else if (name.includes('eyebrow')) color = darken(look.hair, 0.7);
          else if (!['eye', 'white', 'black'].includes(name)) {
            if (!look.clothes.has(name)) look.clothes.set(name, pick(CLOTHES));
            color = look.clothes.get(name)!;
          }
        } else if (tint !== undefined && (chosen ? name === cloth : name === 'main' || name.includes('suit') || name.includes('shirt') || name.includes('body'))) {
          color = tint;
        }
        if (color === null) return m;
        const c = m.clone();
        c.color.setHex(color);
        this.ownMaterials.push(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
    // (le chargeur GLTF retire les points des noms d'os : « UpperLeg.L » devient « UpperLegL »)
    const bone = (n: string) => model.getObjectByName(n) ?? model.getObjectByName(`${n.slice(0, -1)}.${n.slice(-1)}`);
    for (const n of ['UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR']) {
      const b = bone(n);
      if (b) this.legs.push(b);
    }
    // Les pieds (Foot.L / Foot.R) ne sont PAS les enfants des tibias : ce sont des cibles posées au sol (rig « IK »).
    // Quand on plie les jambes (saut, position assise), il faut les raccrocher à la cheville, sinon le pied reste
    // au sol et la peau s'étire (pieds « déformés »). On note donc, en pose de repos, où se trouve le pied
    // par rapport au tibia (position et orientation).
    model.updateMatrixWorld(true);
    for (const side of ['L', 'R'] as const) {
      const upper = bone(`UpperLeg${side}`);
      const lower = bone(`LowerLeg${side}`);
      const foot = bone(`Foot${side}`);
      if (!upper || !lower || !foot?.parent) continue;
      const lowerQ = lower.getWorldQuaternion(new THREE.Quaternion());
      this.rig.push({
        left: side === 'L',
        upper, lower, foot,
        restUpper: upper.quaternion.clone(),
        restLower: lower.quaternion.clone(),
        footInLower: lower.worldToLocal(foot.getWorldPosition(new THREE.Vector3())),
        footRelQ: lowerQ.invert().multiply(foot.getWorldQuaternion(new THREE.Quaternion())),
      });
    }
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of tpl.clips) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }
    // noms attendus par le jeu → animations disponibles dans les modèles humains
    const alias: Record<string, string> = { Walking: 'Walk', Running: 'Run', Punch: 'Interact', ThumbsUp: 'Wave', Yes: 'Wave' };
    for (const [want, have] of Object.entries(alias)) {
      const a = this.actions.get(have);
      if (a && !this.actions.has(want)) this.actions.set(want, a);
    }
    this.mixer.addEventListener('finished', () => {
      this.oneShot = false;
      this.play(this.after, 0.25);
    });
    this.play('Idle', 0);
  }

  /** Animation en boucle (Idle, Walking, Running…). « Sitting » : pose assise (repos + jambes pliées). */
  play(name: string, fade = 0.2): void {
    if (this.oneShot) {
      this.after = name;
      return;
    }
    // Se lever dès qu'on joue autre chose qu'« assis » : avant, un garde qui avait fait sa pause
    // repartait en patrouille les jambes encore pliées (personnage déformé en marchant).
    const sit = name === 'Sitting';
    if (sit !== this.sitting) this.setSitting(sit);
    if (sit) name = 'Idle';
    if (name === this.current) return;
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.actions.get(this.current);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current = name;
  }

  setSitting(on: boolean): void {
    this.sitting = on;
    this.model.position.y = this.baseY - (on ? SIT_DROP : 0);
  }

  /** Geste ponctuel (salut…), puis retour à `then`. */
  gesture(name: string, then = 'Idle'): void {
    const a = this.actions.get(name);
    if (!a) return;
    const prev = this.actions.get(this.current);
    a.reset().setEffectiveWeight(1).fadeIn(0.12).play();
    if (prev && prev !== a) prev.fadeOut(0.12);
    this.current = name;
    // « Sitting » est rejoué tel quel à la fin du geste : le personnage assis le reste
    this.after = then;
    this.oneShot = true;
  }

  /** Vitesse de lecture des animations (pas plus rapides pour un personnage pressé). */
  setTimeScale(k: number): void {
    this.mixer.timeScale = k;
  }

  /**
   * Pose de saut (0 = au sol, 1 = en l'air) : les modèles humains n'ont pas d'animation de saut,
   * on replie donc les jambes (genou avant levé, l'autre jambe tirée en arrière), comme un saut de course.
   */
  setAir(k: number): void {
    this.air = Math.max(0, Math.min(1, k));
  }

  private air = 0;
  /** Os des jambes et des pieds, pose de repos, et place du pied par rapport au tibia (voir le constructeur). */
  private rig: Array<{
    left: boolean;
    upper: THREE.Object3D;
    lower: THREE.Object3D;
    foot: THREE.Object3D;
    restUpper: THREE.Quaternion;
    restLower: THREE.Quaternion;
    footInLower: THREE.Vector3;
    footRelQ: THREE.Quaternion;
  }> = [];
  /** Pose des os modifiés à l'image précédente (remise en place avant l'animation suivante). */
  private saved: Array<{ o: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }> = [];

  update(dt: number): void {
    // pose de l'image précédente retirée avant l'animation (sinon, sur un os que l'animation
    // ne pilote pas, la rotation s'additionnerait à chaque image)
    for (const s of this.saved) {
      s.o.quaternion.copy(s.q);
      s.o.position.copy(s.p);
    }
    this.saved = [];
    this.mixer.update(dt);
    const w = this.sitting ? 1 : this.air;
    if (w <= 0.01 || !this.rig.length) return;
    for (const r of this.rig) for (const o of [r.upper, r.lower, r.foot]) this.saved.push({ o, q: o.quaternion.clone(), p: o.position.clone() });
    // pose visée (depuis la pose de repos, pas en plus de l'animation : sinon, en pleine course,
    // le genou dépassait 150° et la jambe se repliait dans la cuisse)
    // assis : cuisses à l'horizontale, genoux pliés ; en l'air : un genou levé devant, l'autre jambe tirée en arrière
    for (const r of this.rig) {
      const thigh = this.sitting ? SIT_THIGH : r.left ? -1.1 : 0.35;
      const knee = this.sitting ? SIT_KNEE : r.left ? 1.45 : 1.05;
      r.upper.quaternion.slerp(tmpQ.copy(r.restUpper).multiply(tmpQ2.setFromAxisAngle(X_AXIS, thigh)), w);
      r.lower.quaternion.slerp(tmpQ.copy(r.restLower).multiply(tmpQ2.setFromAxisAngle(X_AXIS, knee)), w);
    }
    // les pieds suivent la cheville (position et orientation de repos par rapport au tibia)
    this.model.updateMatrixWorld(true);
    for (const r of this.rig) {
      const parent = r.foot.parent!;
      const at = r.lower.localToWorld(tmpV.copy(r.footInLower));
      r.foot.position.copy(parent.worldToLocal(at));
      const q = r.lower.getWorldQuaternion(tmpQ).multiply(r.footRelQ);
      r.foot.quaternion.copy(parent.getWorldQuaternion(tmpQ2).invert().multiply(q));
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.root.removeFromParent();
    this.ownMaterials.forEach((m) => m.dispose());
    this.ownMaterials = [];
  }
}

function darken(hex: number, k: number): number {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return c.getHex();
}
