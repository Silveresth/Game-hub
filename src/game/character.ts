import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Personnage 3D animé : RobotExpressive (Tomás Laulhé / Quaternius, licence CC0), animations Idle, Walking,
 * Running, Jump, Wave, ThumbsUp, Sitting… Un seul téléchargement, cloné pour le joueur et les visiteurs.
 */
let template: GLTF | null = null;

export async function loadCharacterModel(url: string): Promise<void> {
  template = await new GLTFLoader().loadAsync(url);
}

const ONE_SHOT = new Set(['Jump', 'Wave', 'ThumbsUp', 'Yes', 'No', 'Punch', 'Death', 'WalkJump', 'Interact']);
const HEIGHT = 2.0; // taille humaine naturelle : lisible en vue à la 3e personne

export class Character {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private oneShot = false;

  /** @param tint couleur du corps/vêtement */
  constructor(tint?: number) {
    if (!template) throw new Error('Modèle du personnage non chargé');
    const model = cloneSkinned(template.scene);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      if (tint !== undefined) {
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
        const tinted = mats.map((m) => {
          if (m.name === 'Main' || m.name.toLowerCase().includes('suit') || m.name.toLowerCase().includes('shirt') || m.name.toLowerCase().includes('body')) {
            const c = m.clone();
            c.color.setHex(tint);
            return c;
          }
          return m;
        });
        mesh.material = Array.isArray(mesh.material) ? tinted : tinted[0];
      }
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of template.animations) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
      // Alias pour compatibilité humaine (Walk -> Walking, Run -> Running)
      if (clip.name === 'Walk') this.actions.set('Walking', action);
      if (clip.name === 'Run') this.actions.set('Running', action);
      if (clip.name === 'Interact') this.actions.set('Punch', action);
    }
    this.mixer.addEventListener('finished', () => {
      this.oneShot = false;
      this.play(this.after, 0.25);
    });
    this.play('Idle', 0);
  }

  private after = 'Idle';

  /** Animation en boucle (Idle, Walking, Running…). Ignorée pendant un geste ponctuel. */
  play(name: string, fade = 0.2): void {
    if (this.oneShot) {
      this.after = name;
      return;
    }
    if (name === this.current) return;
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.actions.get(this.current);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    prev?.fadeOut(fade);
    this.current = name;
  }

  /** Geste ponctuel (saut, salut, pouce levé), puis retour à `then`. */
  gesture(name: string, then = 'Idle'): void {
    const a = this.actions.get(name);
    if (!a) return;
    const prev = this.actions.get(this.current);
    a.reset().setEffectiveWeight(1).fadeIn(0.12).play();
    prev?.fadeOut(0.12);
    this.current = name;
    this.after = then;
    this.oneShot = true;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
