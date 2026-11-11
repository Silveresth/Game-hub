import { GRID, MAX_ROOMS, THEMES, type ThemeId } from './Room';
import type { ArtifactConfig, MuseumData, RoomCell } from './types';
import { SCULPTURE_FORMS, SCULPTURE_MATERIALS } from './Artifact';

const KEY = 'memory-museum-v2';
const OLD_KEY = 'memory-museum-v1';

export function loadMuseum(): MuseumData | null {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    return raw ? parseMuseum(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** @returns false si le quota du navigateur est dépassé. */
export function saveMuseum(data: MuseumData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    localStorage.removeItem(OLD_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearMuseum(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(OLD_KEY);
  } catch {
    /* stockage indisponible */
  }
}

const isTheme = (t: unknown): t is ThemeId => typeof t === 'string' && t in THEMES;
const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

function validArtifact(a: Partial<ArtifactConfig> | null): boolean {
  if (!a || typeof a.id !== 'string' || typeof a.url !== 'string' || !isVec3(a.position) || !isVec3(a.rotation)) return false;
  if (!Number.isFinite(a.scale) || a.scale! < 0.2 || a.scale! > 4) return false;
  if (a.type === 'SCULPTURE') return !!a.form && a.form in SCULPTURE_FORMS && !!a.material && a.material in SCULPTURE_MATERIALS;
  return a.type === 'PHOTO' || a.type === 'AUDIO';
}

/** Vérifie que toutes les salles sont reliées à l'entrée (0, 0). */
export function roomsConnected(rooms: Array<{ x: number; z: number }>): boolean {
  const set = new Set(rooms.map((r) => `${r.x},${r.z}`));
  if (!set.has('0,0')) return false;
  const seen = new Set(['0,0']);
  const stack: Array<[number, number]> = [[0, 0]];
  while (stack.length) {
    const [x, z] = stack.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${z + dz}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, z + dz]);
      }
    }
  }
  return seen.size === set.size;
}

function validRooms(rooms: unknown): rooms is RoomCell[] {
  if (!Array.isArray(rooms) || rooms.length < 1 || rooms.length > MAX_ROOMS) return false;
  const ok = rooms.every(
    (r) => r && Number.isInteger(r.x) && Number.isInteger(r.z) && Math.abs(r.x) <= GRID && Math.abs(r.z) <= GRID && isTheme(r.theme),
  );
  return ok && new Set(rooms.map((r) => `${r.x},${r.z}`)).size === rooms.length && roomsConnected(rooms);
}

/** Valide un musée (v2) ou migre l'ancien format (v1, salle unique). */
export function parseMuseum(json: unknown): MuseumData | null {
  const d = json as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.artifacts)) return null;

  if (d.version === 1) {
    const theme = isTheme(d.theme) ? d.theme : 'modern';
    // Seules les œuvres du mur nord de l'ancienne salle tombent juste dans la nouvelle grille.
    const artifacts = (d.artifacts as ArtifactConfig[])
      .filter((a) => validArtifact(a) && Math.abs(a.position[0]) < 5.5 && Math.abs(a.position[2] + 5.98) < 0.1)
      .map((a) => ({ ...a, position: [a.position[0], a.position[1], -5.88] as [number, number, number] }));
    return { version: 2, name: 'Mon musée', author: '', rooms: [{ x: 0, z: 0, theme }], artifacts };
  }

  if (d.version !== 2 || !validRooms(d.rooms)) return null;
  if (!(d.artifacts as unknown[]).every((a) => validArtifact(a as ArtifactConfig))) return null;
  const remote = d.remote as { id?: unknown; token?: unknown } | undefined;
  return {
    version: 2,
    name: typeof d.name === 'string' ? d.name.slice(0, 40) : 'Mon musée',
    author: typeof d.author === 'string' ? d.author.slice(0, 30) : '',
    rooms: d.rooms as RoomCell[],
    artifacts: d.artifacts as ArtifactConfig[],
    remote: remote && typeof remote.id === 'string' && typeof remote.token === 'string' ? { id: remote.id, token: remote.token } : undefined,
  };
}
