import type { ArtifactConfig, MuseumData } from './types';

const P = Math.PI;
type V3 = [number, number, number];

const photo = (id: string, url: string, title: string, position: V3, ry: number, scale = 1): ArtifactConfig => ({
  id, type: 'PHOTO', title, url, position, rotation: [0, ry, 0], scale, spot: true,
});
const sculpture = (
  id: string, title: string, position: V3, form: ArtifactConfig['form'], material: ArtifactConfig['material'], scale = 1,
): ArtifactConfig => ({ id, type: 'SCULPTURE', title, url: '', position, rotation: [0, 0, 0], scale, spot: true, form, material });

/** Musée de départ : deux salles reliées, des œuvres générées et des sculptures. */
export function createDefaultMuseum(): MuseumData {
  return {
    version: 2,
    name: 'Mon musée',
    author: '',
    rooms: [
      { x: 0, z: 0, theme: 'modern' },
      { x: 0, z: -1, theme: 'classic' },
    ],
    artifacts: [
      // Salle d'entrée (moderne)
      photo('d1', 'gen:landscape:11', 'Vallée', [-3.75, 2.0, -5.88], 0),
      photo('d2', 'gen:rothko:7', 'Champs de couleur', [3.75, 2.0, -5.88], 0),
      photo('d3', 'gen:sunset:3', 'Crépuscule', [-5.88, 2.0, 0], P / 2, 1.3),
      photo('d4', 'gen:mondrian:5', 'Composition', [5.88, 2.0, 0], -P / 2, 1.3),
      sculpture('d5', 'Gemme', [-3.2, 0, 3.2], 'orb', 'marble'),
      sculpture('d6', 'Nœud d’or', [3.2, 0, 3.2], 'knot', 'gold'),
      // Salle classique
      photo('d7', 'gen:mountains:21', 'Sommets', [-5.88, 2.0, -12], P / 2, 1.3),
      photo('d8', 'gen:circles:9', 'Orbites', [5.88, 2.0, -12], -P / 2, 1.3),
      photo('d9', 'gen:waves:4', 'Houle', [0, 2.0, -17.88], 0, 1.5),
      photo('d10', 'gen:bauhaus:2', 'Formes', [-3.75, 2.0, -6.12], P),
      sculpture('d11', 'Spirale', [-3.2, 0, -15], 'spiral', 'bronze'),
      sculpture('d12', 'Monolithe', [3.2, 0, -15], 'monolith', 'jade'),
    ],
  };
}
