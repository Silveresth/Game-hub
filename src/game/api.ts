import type { FrameId, RarityId } from './catalog';

export interface OwnedArtwork {
  uid: string;
  workId: string;
  frame: FrameId;
  /** Emplacement dans le musée, ou null = en réserve. */
  slot: number | null;
  /** Reproduction (marché noir) : décorative, sans valeur ni revenu. */
  repro?: boolean;
  /** Décrochée par un voleur, en cours de transport : elle ne s'affiche plus au mur. */
  carried?: boolean;
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
  /** Tenue du personnage (0 = costume). */
  skin?: number;
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
  /** Boutique : niveau acheté de chaque amélioration et prochain palier. */
  upgrades: Record<UpgradeId, { level: number; max: number; value: number | null; next: { price: number; value: number } | null }>;
  rebirths: number;
  /** Multiplicateur de revenu des renaissances (1 = aucune). */
  incomeMult: number;
  rebirth: { cost: number; minLevel: number; bonus: number; ready: boolean };
  daily: DailyInfo;
  event: { current: ConvoyEvent | null; next: ConvoyEvent | null };
  /** Code à partager pour inviter un ami dans son quartier. */
  inviteCode: string;
  /** Compte : e-mail et mot de passe, ou Google ; sans l'un ni l'autre, c'est un invité (musée sur cet appareil). */
  account: { email: string | null; password: boolean; google: boolean };
  /** STH coins : monnaie premium (argent réel, ou échange de pièces à un taux très élevé). */
  sth: number;
  /** Lucky coffres achetés, pas encore ouverts. */
  chests: Record<ChestId, number>;
  /** Garantie de chaque coffre : nombre de coffres ouverts depuis la dernière rareté garantie. */
  pity: Partial<Record<ChestId, { count: number; every: number; rarity: RarityId }>>;
  /** Mythiques encore libres (possibles dans les coffres). */
  freeMythics: string[];
}

export type ChestId = 'simple' | 'rare' | 'epique' | 'legendaire';
export type PayMethodId = 'tmoney' | 'flooz' | 'card' | 'paypal';
export interface PayMethod { id: PayMethodId; label: string; icon: string; currencies: string[]; provider: string; needsPhone: boolean }
export interface PayPack { id: string; sth: number; bonus: number; xof: number; eur: number; usd: number; tag?: string }
export interface PayOrder { id: string; pack: string; sth: number; method: PayMethodId; amount: number; currency: string; status: 'pending' | 'paid' | 'failed' | 'expired' | 'error'; hint: string | null; createdAt: number; test: boolean }

export type UpgradeId = 'speed' | 'lock' | 'vault' | 'gloves' | 'luck';
export interface DailyInfo {
  claimable: boolean;
  streak: number;
  reward: number;
  day: number;
  days: number;
}
export interface ConvoyEvent {
  /** golden, rare, soldes : événements du convoi ; pluie, arcenciel, vitesse : « admin abuse » en direct. */
  kind: 'golden' | 'rare' | 'soldes' | 'pluie' | 'arcenciel' | 'vitesse';
  admin?: boolean;
  label: string;
  icon: string;
  desc: string;
  startsAt: number;
  endsAt: number;
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
  /** Événement en cours au départ du camion (prix soldé, cadre ou rareté favorisés). */
  event?: ConvoyEvent['kind'] | null;
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

async function call<T>(path: string, init: RequestInit = {}, prefix = '/api/game/'): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session) Object.assign(headers, { 'x-player-id': session.id, 'x-player-token': session.token });
  const res = await fetch(`${prefix}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Erreur ${res.status}`), { status: res.status });
  return data;
}

const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export async function login(name?: string, color?: string, country?: string, skin?: number): Promise<{ state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[] }> {
  const saved = loadSession();
  const r = await post<{ id: string; token?: string; state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[] }>('login', { ...saved, name, color, country, skin });
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

type SessionReply = { id: string; token?: string; state: PlayerState; offlineGain: number; created: boolean; inbox?: InboxItem[]; upgraded?: boolean };

function keepSession(r: SessionReply): SessionReply {
  if (r.token) {
    session = { id: r.id, token: r.token };
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      /* stockage indisponible : la session vit le temps de l'onglet */
    }
  }
  return r;
}

/** Inscription. Avec une session d'invité ouverte, son musée devient le compte (rien n'est perdu). */
export const register = async (username: string, email: string, password: string, color?: string, country?: string, skin?: number) =>
  keepSession(await post<SessionReply>('register', { username, email, password, color, country, skin }));
/** Connexion par e-mail et mot de passe (sur n'importe quel appareil). */
export const loginPassword = async (email: string, password: string) => keepSession(await post<SessionReply>('login/password', { email, password }));
export const forgotPassword = (email: string) => post<{ ok: boolean; message: string; devLink?: string }>('password/forgot', { email });
/** Nouveau mot de passe depuis le lien reçu par e-mail : les autres sessions sont fermées, celle-ci s'ouvre. */
export const resetPassword = async (token: string, password: string) => keepSession(await post<SessionReply>('password/reset', { token, password }));
/** Déconnexion de cet appareil. */
export async function logout(): Promise<void> {
  try {
    await post('logout');
  } finally {
    session = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* rien à effacer */
    }
  }
}

export const hasSavedSession = () => !!loadSession();
/** Identifiants pour le WebSocket du quartier (après login). */
export const currentSession = () => session;
export const getState = () => call<PlayerState>('state');
export const getConvoy = () => call<{ serverTime: number; intervalMs: number; travelMs: number; items: ConvoyItem[] }>('convoy');
export const buy = (window: number) => post<{ artwork: OwnedArtwork; state: PlayerState }>('buy', { window });
export const collect = () => post<{ collected: number; state: PlayerState }>('collect');
export const expand = () => post<{ state: PlayerState }>('expand');
export const sell = (uid: string) => post<{ gain: number; state: PlayerState }>('sell', { uid });
/** `swappedUid` : l'œuvre qui occupait l'emplacement, décrochée et repartie à l'ancienne place de celle qu'on accroche. */
export const moveArtwork = (uid: string, slot: number) => post<{ state: PlayerState; swapped: boolean; swappedUid?: string | null }>('move', { uid, slot });
export const setDecor = (room: number, theme: string) => post<{ state: PlayerState; room: number; theme: string; cost: number }>('decor', { room, theme });
export const rename = (name: string, color?: string, country?: string, skin?: number) => post<{ state: PlayerState }>('name', { name, color, country, skin });
export const claim = (quest: string) => post<{ reward: number; state: PlayerState }>('claim', { quest });
export const buySecurity = (item: string, extra: { tier?: GuardTier; slot?: number } = {}) => post<{ label: string; price: number; state: PlayerState }>('security', { item, ...extra });
export const buyTool = (tool: ToolId) => post<{ tool: ToolId; price: number; state: PlayerState }>('blackmarket', { tool });
export const buyRepro = (workId: string) => post<{ price: number; state: PlayerState }>('blackmarket', { tool: 'repro', workId });
export const buyUpgrade = (id: UpgradeId) => post<{ id: UpgradeId; level: number; price: number; state: PlayerState }>('upgrade', { id });
export const rebirth = () => post<{ rebirths: number; incomeMult: number; state: PlayerState }>('rebirth');
export const claimDaily = () => post<{ reward: number; streak: number; state: PlayerState }>('daily');
export const pushSubscribe = (subscription: unknown) => post<{ state: PlayerState }>('push/subscribe', { subscription });
export const pushPrefs = (prefs: Partial<PushPrefs>) => post<{ state: PlayerState }>('push/prefs', { prefs });
// inventaire : réserve et emplacements
export const storeArtwork = (uid: string) => post<{ state: PlayerState }>('store', { uid });
export const placeArtwork = (uid: string) => post<{ slot: number; state: PlayerState }>('place', { uid });
// STH coins et Lucky coffres
export const exchangeSth = (sth: number) => post<{ sth: number; cost: number; state: PlayerState }>('sth/exchange', { sth });
export const buyChest = (id: ChestId, qty: number) => post<{ id: ChestId; qty: number; cost: number; state: PlayerState }>('chest/buy', { id, qty });
export const openChest = (id: ChestId) => post<{ chest: ChestId; artwork: OwnedArtwork; rarity: RarityId; frame: FrameId; pityUsed: boolean; state: PlayerState }>('chest/open', { id });
// paiements en argent réel (STH coins)
const payPost = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }, '/api/pay/');
export const payConfig = () => call<{ methods: PayMethod[]; packs: PayPack[]; test: boolean }>('config', {}, '/api/pay/');
export const payCreate = (pack: string, method: PayMethodId, currency: string, phone?: string) =>
  payPost<{ order: PayOrder; url: string | null; push: boolean; test: boolean }>('create', { pack, method, currency, phone });
export const payOrder = (id: string) => call<{ order: PayOrder; sth: number }>(`order?id=${encodeURIComponent(id)}`, {}, '/api/pay/');
export const payTestComplete = (id: string) => payPost<{ order: PayOrder; sth: number }>('test/complete', { id });

export type Board = 'value' | 'weekly' | 'theft' | 'auction' | 'countries';
export const leaderboard = (board: Board = 'value', country?: string) => call<Array<{ name: string; value: number; level: number; artworks: number; country?: string; flag?: string; me?: boolean }>>(`leaderboard?board=${board}${country ? `&country=${country}` : ''}`);
