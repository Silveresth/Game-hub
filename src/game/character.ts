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
    for (const n of ['UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR']) {
      const b = model.getObjectByName(n) ?? model.getObjectByName(`${n.slice(0, -1)}.${n.slice(-1)}`);
      if (b) this.legs.push(b);
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
    if (name === 'Sitting') {
      this.setSitting(true);
      name = 'Idle';
    }
    if (this.oneShot) {
      this.after = name;
      return;
    }
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
    this.after = then === 'Sitting' ? 'Idle' : then;
    this.oneShot = true;
  }

  /** Vitesse de lecture des animations (pas plus rapides pour un personnage pressé). */
  setTimeScale(k: number): void {
    this.mixer.timeScale = k;
  }

  update(dt: number): void {
    // pose assise de l'image précédente retirée avant l'animation (sinon, sur un os que l'animation
    // ne pilote pas, la rotation s'additionnerait à chaque image)
    if (this.legPose.length) this.legs.forEach((b, i) => b.quaternion.copy(this.legPose[i]));
    this.mixer.update(dt);
    if (this.sitting) {
      this.legPose = this.legs.map((b) => b.quaternion.clone());
      // cuisses à l'horizontale (UpperLeg.*), genoux pliés (LowerLeg.*)
      this.legs.forEach((b) => b.rotateX(b.name.startsWith('Upper') ? SIT_THIGH : SIT_KNEE));
    } else this.legPose = [];
  }

  private legPose: THREE.Quaternion[] = [];

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
