// Cadre porté à deux mains. Géométrie et matériau de cadre partagés : seul le matériau de la toile est propre à l'œuvre.
import * as THREE from 'three';
import { CATALOG, type FrameId } from './catalog';
import { artTexture } from './convoy';

const frameGeo = new THREE.BoxGeometry(1.26, 0.96, 0.07);
const canvasGeo = new THREE.PlaneGeometry(1.05, 0.76);
const frameMats = new Map<string, THREE.MeshStandardMaterial>();

function frameMat(frame: string): THREE.MeshStandardMaterial {
  const color = CATALOG.frames[frame as FrameId]?.color ?? '#e8b64c';
  let m = frameMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: 0.62, roughness: 0.32 });
    frameMats.set(color, m);
  }
  return m;
}

/** Petit cadre doré (ou de la couleur du cadre) avec la toile, tenu devant le torse. */
export function makeCarry(workId: string, frame: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'carry';
  const wood = new THREE.Mesh(frameGeo, frameMat(frame));
  const canvas = new THREE.Mesh(canvasGeo, new THREE.MeshBasicMaterial({ map: artTexture(workId) }));
  canvas.position.z = 0.045;
  g.add(wood, canvas);
  g.position.set(0, 1.15, 0.42);
  g.rotation.x = -0.18;
  return g;
}

/** Retire le cadre. La toile et le matériau du cadre sont partagés : on ne libère que le matériau de la toile. */
export function disposeCarry(g: THREE.Object3D): void {
  g.removeFromParent();
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    if ([...frameMats.values()].includes(mat as THREE.MeshStandardMaterial)) return;
    mat.dispose();
  });
}
