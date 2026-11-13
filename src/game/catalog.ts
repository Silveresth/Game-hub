import raw from '../shared/catalog.json';

export type RarityId = 'commun' | 'rare' | 'epique' | 'legendaire' | 'mythique';
/** Cadres spéciaux et mutations (les mutations saisonnières n'apparaissent que pendant leur saison). */
export type FrameId = 'normal' | 'dore' | 'diamant' | 'arcenciel' | 'givre' | 'hante' | 'fleuri' | 'solaire' | 'festif';
export type SeasonId = 'classique' | 'noel' | 'halloween' | 'printemps' | 'ete' | 'fete';
export interface SeasonDef {
  label: string;
  icon: string;
  desc: string;
  /** Ciel : [haut, horizon]. */
  sky: [string, string];
  fog: string;
  grass: string;
  /** Sol enneigé (la pelouse devient de la neige). */
  snow?: boolean;
  hemi: [string, string];
  sun: string;
  /** Intensité de la lumière (1 = normale). */
  light: number;
  flags: string[];
  bulb: string;
  particles: 'snow' | 'leaves' | 'petals' | 'confetti' | null;
  gift?: { label: string; icon: string };
  mutation?: FrameId;
  event?: string;
}

export interface Work {
  id: string;
  title: string;
  artist: string;
  year: number;
  rarity: RarityId;
  price: number;
  unique?: boolean;
  kind?: 'painting' | 'statue';
  /** Forme 3D : figurative pour les statues célèbres (thinker, venus, victory, david), abstraite sinon. */
  form?: 'knot' | 'orb' | 'spiral' | 'rings' | 'monolith' | 'thinker' | 'venus' | 'victory' | 'david';
  mat?: 'marble' | 'gold' | 'bronze' | 'glass' | 'jade';
}

export const CATALOG = raw as unknown as {
  rarities: Record<RarityId, { label: string; color: string; convoyWeight: number; incomeRate: number }>;
  frames: Record<FrameId, { label: string; short: string; icon: string; color: string; mult: number; chance: number; season?: SeasonId }>;
  seasons: Record<SeasonId, SeasonDef>;
  seasonRules: { mutationChance: number; chestMutationChance: number };
  privateServer: { price: number; days: number; max: number };
  events: { kinds: Record<string, { label: string; icon: string; desc: string; admin?: boolean; rain?: boolean; mult?: number; season?: SeasonId }> };
  incomeRate: number;
  startCoins: number;
  countries: Array<{ code: string; name: string; flag: string }>;
  colors: string[];
  works: Work[];
  levels: Array<{ level: number; rooms: number; slots: number; visitors: number; cost: number }>;
  security: {
    guards: Record<'vigile' | 'agent' | 'brigade', { label: string; count: number; minutes: number }>;
    cameras: { label: string; hours: number };
    lasers: { label: string };
    generator: { label: string };
    insurance: { label: string; hours: number; refund: number };
    dog: { label: string; hours: number };
    vitrine: { label: string; levels: Array<{ mult: number }> };
  };
  tools: Record<'brouilleur' | 'fumigene' | 'pied' | 'leurre' | 'pince' | 'deguisement', { label: string; icon: string; desc: string }>;
  repro: { price: number; label: string };
  /** Prix pour changer l'ambiance d'une salle (même valeur que le serveur). */
  decorCost: number;
  themes: string[];
  /** Durée de décrochage par rareté, en secondes (même valeur que le serveur). */
  stealSeconds: Record<RarityId, number>;
  maxTools: number;
  upgrades: Record<'speed' | 'lock' | 'vault' | 'gloves' | 'luck', { label: string; icon: string; desc: string; unit: string; levels: Array<{ price: number; value: number }> }>;
  rebirth: { label: string; minLevel: number; baseCost: number; growth: number; incomeBonus: number };
  premium: {
    label: string;
    short: string;
    coinsPerSth: number;
    minExchange: number;
    maxExchange: number;
    monthlyCap: number;
    monthlyCount: number;
    xofCountries: string[];
    eurCountries: string[];
    packs: Array<{ id: string; sth: number; bonus: number; xof: number; eur: number; usd: number; tag?: string }>;
  };
  chests: Record<'simple' | 'rare' | 'epique' | 'legendaire', {
    label: string;
    short: string;
    color: string;
    price: number;
    desc: string;
    odds: Partial<Record<RarityId, number>>;
    frames: Partial<Record<FrameId, number>>;
    pity?: { every: number; rarity: RarityId };
  }>;
  chestBulk: { qty: number; discount: number };
};

/** Libellé court d'un cadre / d'une mutation, avec son icône : « ❄️ Givré ×3 ». Vide pour un cadre normal. */
export const frameTag = (f: FrameId): string => (f === 'normal' ? '' : `${CATALOG.frames[f].icon} ${CATALOG.frames[f].short} ×${CATALOG.frames[f].mult}`);
/** Étoiles de rareté (lisibles même sans connaître les couleurs). */
export const RARITY_STARS: Record<RarityId, string> = { commun: '●', rare: '★', epique: '★★', legendaire: '★★★', mythique: '♛' };
/** Mutation saisonnière (et non simple cadre spécial). */
export const isMutation = (f: FrameId): boolean => !!CATALOG.frames[f]?.season;

const byId = new Map(CATALOG.works.map((w) => [w.id, w]));
export const work = (id: string): Work => byId.get(id)!;
export const artUrl = (id: string) => `/art/${id}.jpg`;
/** Revenu par seconde (même formule que le serveur : taux propre à chaque rareté). */
export const incomeOf = (workId: string, frame: FrameId) => {
  const w = work(workId);
  return w.price * CATALOG.frames[frame].mult * (CATALOG.rarities[w.rarity].incomeRate ?? CATALOG.incomeRate);
};

const nf = new Intl.NumberFormat('fr-FR');
/** 1 234 · 12,3 k · 4,5 M */
export function money(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Md`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (a >= 1e5) return `${(n / 1e3).toFixed(0)} k`;
  return nf.format(Math.floor(n));
}
export function perSec(n: number): string {
  return n >= 100 ? money(n) : n.toFixed(1).replace('.', ',');
}
