import * as THREE from 'three';

export interface SnapResult {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

export interface Placement extends SnapResult {
  kind: 'wall' | 'floor';
}

/**
 * Wall Snapping Engine : raycast depuis le réticule, lecture de la normale de la face touchée
 * (convertie en repère monde) et orientation automatique de l'œuvre parallèlement au mur.
 * Un sol visé donne un emplacement de socle (sculpture) tourné vers le visiteur.
 */
export class MuseumExhibitor {
  private raycaster = new THREE.Raycaster();
  private dummy = new THREE.Object3D();

  constructor(
    private camera: THREE.Camera,
    private surfaces: THREE.Object3D[],
    maxDistance = 9,
    private minY = 1.3,
    private maxY = 3.6,
  ) {
    this.raycaster.far = maxDistance;
  }

  calculatePlacement(mouseCoords: THREE.Vector2): Placement | null {
    this.raycaster.setFromCamera(mouseCoords, this.camera);
    const hit = this.raycaster.intersectObjects(this.surfaces, false)[0];
    if (!hit || !hit.face || hit.object.userData.noHang) return null;

    // La normale de la face est en repère local : on la passe en repère monde.
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();

    if (hit.object.userData.floor && normal.y > 0.7) {
      const p = hit.point.clone().setY(0);
      const yaw = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z);
      return { kind: 'floor', position: p, rotation: new THREE.Euler(0, yaw, 0) };
    }
    if (Math.abs(normal.y) > 0.3) return null;

    const position = hit.point.clone().addScaledVector(normal, 0.02);
    position.y = THREE.MathUtils.clamp(position.y, this.minY, this.maxY);
    this.dummy.position.copy(position);
    this.dummy.lookAt(position.clone().add(normal));
    return { kind: 'wall', position, rotation: this.dummy.rotation.clone() };
  }

  /** API historique du cahier des charges : uniquement l'accrochage mural. */
  calculateWallSnap(mouseCoords: THREE.Vector2): SnapResult | null {
    const p = this.calculatePlacement(mouseCoords);
    return p?.kind === 'wall' ? p : null;
  }
}
