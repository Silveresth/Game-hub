import type { ThemeId } from './Room';

export type ArtifactType = 'PHOTO' | 'AUDIO' | 'SCULPTURE';
export type SculptureForm = 'knot' | 'orb' | 'spiral' | 'rings' | 'monolith';
export type SculptureMaterial = 'marble' | 'gold' | 'bronze' | 'glass' | 'jade';

export interface ArtifactConfig {
  id: string;
  type: ArtifactType;
  title: string;
  /** Data-URL (image redimensionnée / audio), `gen:style:seed` (œuvre générée) ou vide (sculpture). */
  url: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  spot: boolean;
  form?: SculptureForm;
  material?: SculptureMaterial;
  /** Cadre spécial (jeu) : doré ×2, diamant ×5. */
  frameStyle?: 'normal' | 'dore' | 'diamant';
}

export interface RoomCell {
  x: number;
  z: number;
  theme: ThemeId;
}

/** Identifiants de publication (gardés uniquement en local, jamais envoyés dans le musée). */
export interface RemoteInfo {
  id: string;
  token: string;
}

export interface MuseumData {
  version: 2;
  name: string;
  author: string;
  rooms: RoomCell[];
  artifacts: ArtifactConfig[];
  remote?: RemoteInfo;
}

export interface MuseumSummary {
  id: string;
  name: string;
  author: string;
  rooms: number;
  artifacts: number;
  views: number;
  likes: number;
  updatedAt: number;
  hasThumb: boolean;
}
