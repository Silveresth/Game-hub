import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Performance (phase 5) : fusionne les maillages fixes d'un objet (murs, sols, mobilier, façade…) en un seul
 * maillage par matériau. Un musée à 3 étages passe d'environ 1 000 appels de dessin à quelques dizaines.
 *
 * Les maillages d'origine restent dans la scène, invisibles : ils servent toujours aux collisions et à la caméra
 * (le Raycaster de three.js teste aussi les objets invisibles). Les matériaux sont partagés : changer la texture
 * d'une enseigne se voit sur la version fusionnée.
 *
 * @returns un groupe à ajouter à la scène, avec la même transformation que `src`
 */
export function mergeStatic(src: THREE.Object3D): THREE.Group {
  const out = new THREE.Group();
  src.updateMatrixWorld(true);
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.scale.copy(src.scale);
  const inv = src.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();
  const merged: THREE.Mesh[] = [];
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry, cast: boolean) => {
    const key = `${mat.uuid}|${cast ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { mat, geos: [], cast };
      buckets.set(key, b);
    }
    b.geos.push(geo);
  };
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    if ((m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => x.transparent)) return; // les objets transparents restent à part (ordre d'affichage)
    const attrs = Object.keys(m.geometry.attributes).sort().join(',');
    if (attrs !== 'normal,position,uv') return;
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld.clone().premultiply(inv));
    if (!Array.isArray(m.material)) add(m.material, geo, m.castShadow);
    else {
      // plusieurs matériaux (une boîte dont chaque face a le sien) : un morceau de géométrie par matériau
      for (const grp of geo.groups) {
        const mat = m.material[grp.materialIndex ?? 0];
        if (!mat) continue;
        const part = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const a = geo.getAttribute(name) as THREE.BufferAttribute;
          part.setAttribute(name, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
        }
        add(mat, part, m.castShadow);
      }
      geo.dispose();
    }
    merged.push(m);
  });
  for (const b of buckets.values()) {
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    for (const g of b.geos) if (g !== geo) g.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    out.add(mesh);
  }
  for (const m of merged) m.visible = false;
  return out;
}

export function disposeMerged(g: THREE.Group | null): void {
  if (!g) return;
  g.removeFromParent();
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
