import type { FrameId, RarityId } from './catalog';

export interface OwnedArtwork {
  uid: string;
  workId: string;
  frame: FrameId;
  /** Emplacement dans le musée, ou null = en réserve. */
  slot: number | null;
  /** Reproduction (marché noir) : décorative, sans valeur ni revenu. */
  repro?: boolean;
}

export interface Quest {
  id: string;
  label: string;
  hint: string;
  progress: number;
  target: number;
  reward: number;
  done: boolean;
  index: number;
  total: number;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  country?: string;
  quest: Quest | null;
  rank: number;
  of: number;
  coins: number;
  level: number;
  slots: number;
  rooms: number;
  roomThemes?: Record<string, string>;
  /** Nombre d'étages (1 = rez-de-chaussée seul). */
  floors: number;
  visitorsCap: number;
  next: { level: number; cost: number; rooms: number; slots: number; floors: number } | null;
  artworks: OwnedArtwork[];
  cash: number;
  cashCap: number;
  income: number;
  value: number;
  serverTime: number;
  shielded: boolean;
  immuneUntil: number;
  stolen: number;
  arrests: number;
  sec: PublicSecurity;
  guardsUntil: number;
  guardsTier: GuardTier | null;
  camerasUntil: number;
  insuranceUntil: number;
  dogUntil: number;
  offers: SecurityOffers;
  tools: Partial<Record<ToolId, number>>;
  toolPrices: Record<ToolId, number>;
  escrow: number;
  /** Musée lié à un compte Google (retrouvable sur un autre appareil). */
  google: boolean;
  push: { devices: number; prefs: PushPrefs | null };
}

export interface PushPrefs {
  theft: boolean;
  stolen: boolean;
  guards: boolean;
  sales: boolean;
  abuse: boolean;
  cash: boolean;
  theftAtNight: boolean;
}

export type GuardTier = 'vigile' | 'agent' | 'brigade';
export type ToolId = 'brouilleur' | 'fumigene' | 'pied' | 'leurre' | 'pince' | 'deguisement';

/** Protections visibles de tous (les failles doivent être lisibles). */
export interface PublicSecurity {
  guards: number;
  cameras: boolean;
  lasers: boolean;
  generator: boolean;
  insured: boolean;
  vitrines: Record<string, number>;
  /** Chien de garde : flaire les voleurs déguisés. */
  dog: boolean;
}

export interface SecurityOffers {
  guards: Record<GuardTier, number>;
  cameras: number;
  lasers: number | null;
  generator: number | null;
  insurance: number;
  dog: number;
  vitrines: Record<string, { level: number; price: number | null }>;
}

export type InboxItem =
  | { type: 'stolen'; workId: string; frame: FrameId; by: string; refund?: number; at: number }
  | { type: 'caught'; by: string; workId?: string; fine: number; byGuard: boolean; at: number }
  | { type: 'attempt'; by: string; reason: string; at: number };

export interface ConvoyItem {
  window: number;
  workId: string;
  frame: FrameId;
  rarity: RarityId;
  price: number;
  startsAt: number;
  sold: boolean;
}

const KEY = 'sam-player';
let session: { id: string; token: string } | null = null;

function loadSession(): { id: string; token: string } | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session) Object.assign(headers, { 'x-player-id': session.id, 'x-player-token': session.token });
  const res = await fetch(`/api/game/${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Erreur ${res.status}`), { status: res.status });
  return data;
}

const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export async function login(name?: string, color?: string, country?: string): Promise<{ state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[] }> {
  const saved = loadSession();
  const r = await post<{ id: string; token?: string; state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[] }>('login', { ...saved, name, color, country });
  session = { id: r.id, token: r.token ?? saved!.token };
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* stockage indisponible : la session vit le temps de l'onglet */
  }
  return r;
}

/** Connexion avec Google sur un nouvel appareil : le serveur renvoie un jeton propre à cet appareil. */
export async function loginGoogle(credential: string): Promise<{ state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[] }> {
  const r = await post<{ id: string; token: string; state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[] }>('login/google', { credential });
  session = { id: r.id, token: r.token };
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* stockage indisponible */
  }
  return r;
}
export const linkGoogle = (credential: string) => post<{ state: PlayerState }>('link/google', { credential });

export const hasSavedSession = () => !!loadSession();
/** Identifiants pour le WebSocket du quartier (après login). */
export const currentSession = () => session;
export const getState = () => call<PlayerState>('state');
export const getConvoy = () => call<{ serverTime: number; intervalMs: number; travelMs: number; items: ConvoyItem[] }>('convoy');
export const buy = (window: number) => post<{ artwork: OwnedArtwork; state: PlayerState }>('buy', { window });
export const collect = () => post<{ collected: number; state: PlayerState }>('collect');
export const expand = () => post<{ state: PlayerState }>('expand');
export const sell = (uid: string) => post<{ gain: number; state: PlayerState }>('sell', { uid });
export const moveArtwork = (uid: string, slot: number) => post<{ state: PlayerState; swapped: boolean }>('move', { uid, slot });
export const setDecor = (room: number, theme: string) => post<{ state: PlayerState; room: number; theme: string; cost: number }>('decor', { room, theme });
export const rename = (name: string, color?: string, country?: string) => post<{ state: PlayerState }>('name', { name, color, country });
export const claim = (quest: string) => post<{ reward: number; state: PlayerState }>('claim', { quest });
export const buySecurity = (item: string, extra: { tier?: GuardTier; slot?: number } = {}) => post<{ label: string; price: number; state: PlayerState }>('security', { item, ...extra });
export const buyTool = (tool: ToolId) => post<{ tool: ToolId; price: number; state: PlayerState }>('blackmarket', { tool });
export const buyRepro = (workId: string) => post<{ price: number; state: PlayerState }>('blackmarket', { tool: 'repro', workId });
export const pushSubscribe = (subscription: unknown) => post<{ state: PlayerState }>('push/subscribe', { subscription });
export const pushPrefs = (prefs: Partial<PushPrefs>) => post<{ state: PlayerState }>('push/prefs', { prefs });
export type Board = 'value' | 'weekly' | 'theft' | 'auction' | 'countries';
export const leaderboard = (board: Board = 'value', country?: string) => call<Array<{ name: string; value: number; level: number; artworks: number; country?: string; flag?: string }>>(`leaderboard?board=${board}${country ? `&country=${country}` : ''}`);
