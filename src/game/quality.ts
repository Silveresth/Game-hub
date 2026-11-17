/** Paliers graphiques. Tout l'enrichissement visuel passe par ici : bas sur téléphone, moyen au milieu, haut si la machine suit. */

export type Quality = 'low' | 'medium' | 'high';

/** Palier en cours, lu par les personnages créés après le réglage. */
export let shadowMode: Quality = 'high';
export function setShadowMode(q: Quality): void {
  shadowMode = q;
}

export interface Tier {
  /** Plafond de devicePixelRatio. */
  dpr: number;
  /** Anticrénelage au moment de créer le contexte WebGL (il ne change plus ensuite). */
  antialias: boolean;
  /** 0 = pas d'ombre. */
  shadow: 0 | 1024 | 2048;
  anisotropy: number;
  /** Octaves de nuages dans le ciel (5 au maximum). */
  skyOctaves: number;
  pedestrians: number;
  weather: number;
  /** Distance (m) sous laquelle les étincelles d'une œuvre restent allumées. */
  sparkleDist: number;
  sparkleCap: number;
  /** Gouttes de la fontaine (0 = arrêtées). */
  spray: number;
  /** Relief procédural et eau animée. */
  relief: boolean;
  /** Flou derrière le HUD (cher sur téléphone). */
  blurHud: boolean;
  /** Disque sombre sous les personnages, à la place des ombres. */
  contactBlob: boolean;
  /** Distance (m) d'affichage des étiquettes d'œuvres. */
  labelRange: number;
  /** Intensité du liseré du joueur local. */
  rim: number;
  /** Reflets (dehors / dans un musée). */
  env: number;
  envIn: number;
  /** off : rendu direct. vignette : un passage. full : bloom + vignette, SMAA en plus sur ordinateur. */
  post: 'off' | 'vignette' | 'full';
  smaa: boolean;
  /** Projecteurs braqués sur les œuvres les plus proches (0 = aucun). */
  spots: number;
  /** Au-delà de cette distance (m), un personnage devient une silhouette. */
  lod: number;
  /** Flou de l'ombre du soleil. */
  shadowRadius: number;
}

const phone = (): boolean => matchMedia('(pointer: coarse)').matches;

export function tierOf(q: Quality): Tier {
  const mobile = phone();
  if (q === 'low') {
    return {
      dpr: 1, antialias: false, shadow: 0, anisotropy: 2, skyOctaves: 2,
      pedestrians: 4, weather: 400, sparkleDist: 16, sparkleCap: 6, spray: 0,
      relief: false, blurHud: false, contactBlob: true, labelRange: 12, rim: 0.12,
      env: 0.4, envIn: 0.5, post: 'off', smaa: false, spots: 0, lod: 32, shadowRadius: 1,
    };
  }
  if (q === 'medium') {
    return {
      dpr: mobile ? 1.15 : 1.25, antialias: false, shadow: 1024, anisotropy: 4, skyOctaves: 3,
      pedestrians: 7, weather: 800, sparkleDist: 26, sparkleCap: 18, spray: 70,
      relief: true, blurHud: false, contactBlob: false, labelRange: 18, rim: 0.22,
      env: 0.55, envIn: 0.72, post: 'vignette', smaa: false, spots: 1, lod: 40, shadowRadius: 2,
    };
  }
  return {
    dpr: mobile ? 1.5 : 1.75, antialias: !mobile, shadow: mobile ? 1024 : 2048, anisotropy: 8, skyOctaves: 5,
    pedestrians: 10, weather: 1400, sparkleDist: 40, sparkleCap: 48, spray: 180,
    relief: true, blurHud: true, contactBlob: false, labelRange: 26, rim: 0.28,
    env: 0.62, envIn: 0.85, post: 'full', smaa: !mobile, spots: 2, lod: 52, shadowRadius: 3.5,
  };
}

/** Bas sur téléphone, peu de cœurs ou peu de mémoire ; moyen en dessous d'un PC confortable. */
export function defaultQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (phone() || cores <= 4 || mem <= 3) return 'low';
  if (cores <= 6 || mem <= 4) return 'medium';
  return 'high';
}

/** Un cran en dessous, pour le passage automatique quand les images/s tombent. */
export function stepDown(q: Quality): Quality | null {
  if (q === 'high') return 'medium';
  if (q === 'medium') return 'low';
  return null;
}

/** Lu à la création des textures. Mis à jour par le palier avant de parcourir la scène. */
export let textureAnisotropy = 8;

export function setTextureAnisotropy(n: number): void {
  textureAnisotropy = n;
}
