import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ROAD } from './district';

interface VehicleDef {
  model: THREE.Group;
  wheels: THREE.Object3D[];
}

const CAR_FILES = ['delivery.glb', 'van.glb', 'truck.glb'];

interface ActiveCar {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  x: number;
  z: number;
  speed: number;
  dir: 1 | -1;
  dist: number;
}

/**
 * Gestionnaire de trafic urbain 3D :
 * Fait circuler des voitures et camionnettes de livraison sur les voies routières
 * pour donner une vraie vie citadine animée au quartier.
 */
export class TrafficManager {
  private templates: VehicleDef[] = [];
  private cars: ActiveCar[] = [];
  private group = new THREE.Group();
  private loaded = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    void this.loadModels();
  }

  private async loadModels(): Promise<void> {
    const loader = new GLTFLoader();
    for (const f of CAR_FILES) {
      try {
        const gltf = await loader.loadAsync(`/models/cars/${f}`);
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        const wheels: THREE.Object3D[] = [];
        model.traverse((o) => {
          if (o.name.toLowerCase().includes('wheel')) wheels.push(o);
        });
        this.templates.push({ model, wheels });
      } catch (err) {
        console.warn(`Impossible de charger le véhicule ${f}`, err);
      }
    }
    if (this.templates.length > 0) {
      this.loaded = true;
      this.spawnInitialCars();
    }
  }

  private spawnInitialCars(): void {
    // Voie Sud (va vers l'est, dir = +1, z = ROAD.z + 1.6)
    // Voie Nord (va vers l'ouest, dir = -1, z = ROAD.z - 1.6)
    const configs = [
      { x: -50, dir: 1 as const, z: ROAD.z + 1.6, speed: 11.0 },
      { x: 10, dir: 1 as const, z: ROAD.z + 1.6, speed: 12.5 },
      { x: 45, dir: -1 as const, z: ROAD.z - 1.6, speed: 11.8 },
      { x: -15, dir: -1 as const, z: ROAD.z - 1.6, speed: 13.0 },
    ];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const tmpl = this.templates[i % this.templates.length];
      const clone = cloneSkinned(tmpl.model) as THREE.Group;
      clone.scale.setScalar(2.1); // Proportions réalistes par rapport à la taille humaine

      const wheels: THREE.Object3D[] = [];
      clone.traverse((o) => {
        if (o.name.toLowerCase().includes('wheel')) wheels.push(o);
      });

      const car: ActiveCar = {
        root: clone,
        wheels,
        x: cfg.x,
        z: cfg.z,
        speed: cfg.speed,
        dir: cfg.dir,
        dist: 0,
      };

      clone.position.set(car.x, 0, car.z);
      // Rotation selon le sens de circulation
      clone.rotation.y = car.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(clone);
      this.cars.push(car);
    }
  }

  update(dt: number): void {
    if (!this.loaded) return;
    const minX = ROAD.x0 - 15;
    const maxX = ROAD.x1 + 15;

    for (const car of this.cars) {
      car.x += car.dir * car.speed * dt;
      car.dist += car.speed * dt;

      // Boucle infinie fluide sur les extrémités de l'avenue
      if (car.dir === 1 && car.x > maxX) {
        car.x = minX;
      } else if (car.dir === -1 && car.x < minX) {
        car.x = maxX;
      }

      car.root.position.x = car.x;
      // Rotation des roues selon la distance parcourue
      for (const w of car.wheels) {
        w.rotation.x = car.dist * 1.5;
      }
    }
  }
}
