import raw from '../shared/catalog.json';

export type RarityId = 'commun' | 'rare' | 'epique' | 'legendaire' | 'mythique';
export type FrameId = 'normal' | 'dore' | 'diamant' | 'arcenciel';

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
  frames: Record<FrameId, { label: string; mult: number; chance: number }>;
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
};

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
