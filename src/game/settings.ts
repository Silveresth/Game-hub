/** Réglages du joueur (écran Options), gardés sur l'appareil. */
export interface Settings {
  /** Volume de la musique, 0 à 100 (0 = coupée). */
  music: number;
  /** Volume des bruitages, 0 à 100. */
  sfx: number;
  /** Tout le son coupé (bouton 🔊 du menu). */
  muted: boolean;
  quality: 'high' | 'low';
  /** Qualité choisie par le joueur (sinon le jeu peut passer seul en Économie s'il rame). */
  qualityChosen: boolean;
  /** Vitesse de rotation de la caméra, en % (50 à 200). */
  camSpeed: number;
  /** La caméra se replace toute seule derrière le personnage quand il avance. */
  autoCam: boolean;
  /** Plein écran au lancement du jeu (navigateur de téléphone). */
  fullscreen: boolean;
}

const KEY = 'sam-settings';

/** « Éco » par défaut sur les téléphones et les petites machines. */
export const defaultQuality = (): Settings['quality'] =>
  matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high';

export function loadSettings(): Settings {
  const s: Settings = { music: 50, sfx: 80, muted: false, quality: defaultQuality(), qualityChosen: false, camSpeed: 100, autoCam: true, fullscreen: true };
  try {
    // ancien réglage (bouton HD / Éco du menu)
    const legacy = localStorage.getItem('sam-quality');
    if (legacy === 'high' || legacy === 'low') {
      s.quality = legacy;
      s.qualityChosen = true;
    }
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (raw && typeof raw === 'object') {
      const num = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
      s.music = num(raw.music, 0, 100, s.music);
      s.sfx = num(raw.sfx, 0, 100, s.sfx);
      s.camSpeed = num(raw.camSpeed, 50, 200, s.camSpeed);
      if (raw.quality === 'high' || raw.quality === 'low') s.quality = raw.quality;
      for (const k of ['muted', 'qualityChosen', 'autoCam', 'fullscreen'] as const) if (typeof raw[k] === 'boolean') s[k] = raw[k];
    }
  } catch {
    /* stockage indisponible : réglages par défaut */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : les réglages valent pour cette partie seulement */
  }
}
