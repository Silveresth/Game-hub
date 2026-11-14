import type { FrameId } from './catalog';
import type { SeasonState } from './api';
import type { MuseumSnap } from './museumView';

export interface PlotInfo {
  index: number;
  owner: MuseumSnap | null;
  online: boolean;
  lockedUntil: number;
  lockReadyAt: number;
  jamUntil: number;
  powerAt: number;
  powerUntil: number;
}

/** Un garde, simulé par le serveur. */
export interface NetGuard {
  plot: number;
  k: number;
  x: number;
  z: number;
  f: number;
  ry: number;
  s: 'patrol' | 'yawn' | 'break' | 'chase' | 'alert' | 'return' | 'blind' | 'lured';
}

export interface NetPlayer {
  id: string;
  name: string;
  color: string;
  plot: number;
  x: number;
  z: number;
  /** Étage (0 = rez-de-chaussée). */
  f: number;
  ry: number;
  anim: string;
  carry: { workId: string; frame: FrameId } | null;
  /** Déguisé en employé (outil du marché noir). */
  disguised?: boolean;
  stealing: { plot: number; uid: string; endsAt: number } | null;
  /** Micro activé (discussion vocale de proximité). */
  voice?: boolean;
  /** Tenue choisie (0 = costume, 1-3 = autres silhouettes). */
  skin?: number;
}

/** Événement en direct (« admin abuse ») : pluie d'or, convoi arc-en-ciel, super vitesse. */
export interface LiveEvent {
  kind: string;
  label: string;
  icon: string;
  desc: string;
  admin?: boolean;
  startsAt: number;
  endsAt: number;
}
export interface CoinSpot {
  id: number;
  x: number;
  z: number;
}

export interface ChatLine {
  t: 'chat';
  id: string;
  name: string;
  color: string;
  text: string;
  at: number;
}
export type EmoteKind = 'wave' | 'laugh' | 'fire' | 'wow' | 'clap' | 'heart';
export type RtcData =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

export type StealEvent =
  | { t: 'steal'; phase: 'refused'; error: string }
  | { t: 'steal'; phase: 'start'; thief: string; thiefName: string; plot: number; uid: string; workId: string; endsAt: number; ms: number; crowbar: boolean }
  | { t: 'steal'; phase: 'caught'; thief: string; thiefName: string; plot: number; jailUntil: number }
  | { t: 'steal'; phase: 'cancel'; thief: string; plot: number; uid: string; reason: string }
  | { t: 'steal'; phase: 'carry'; thief: string; thiefName: string; plot: number; uid: string; workId: string; frame: FrameId }
  | { t: 'steal'; phase: 'delivered'; thief: string; thiefName: string; plot: number; victimName: string; uid: string; workId: string; frame: FrameId; refund: number }
  | { t: 'steal'; phase: 'arrested'; thief: string; thiefName: string; by: string; byName: string; plot: number; uid: string; workId: string; fine: number; bounty?: number; jailUntil: number }
  | { t: 'steal'; phase: 'returned'; thief: string; plot: number; uid: string; workId: string; message: string };

/** Salle des ventes (phase 4). */
export interface HallSeat {
  seat: number;
  id: string;
  name: string;
  color: string;
  npc: boolean;
}
export interface HallLot {
  index: number;
  count: number;
  workId: string;
  frame: FrameId;
  estimate: number;
  phase: 'present' | 'bidding' | 'sold';
  phaseEnd: number;
  price: number;
  step: number;
  min: number;
  leader: { id: string; name: string; npc: boolean; seat: number } | null;
  lastBid: { seat: number; at: number; name: string; amount: number } | null;
  outcome: { sold: boolean; npc?: boolean; name?: string; price?: number; id?: string } | null;
}
export interface SaleInfo {
  id: string;
  kind: 'express' | 'grande' | 'prestige' | 'abuse';
  label: string;
  at: number;
  live: boolean;
}
export interface HallState {
  t: 'hall';
  now: number;
  you: { seat: number | null };
  seats: HallSeat[];
  sale: (SaleInfo & { lots: Array<{ workId: string; frame: FrameId; estimate: number }> }) | null;
  next: SaleInfo | null;
  lot: HallLot | null;
}

export type ServerMsg =
  | HallState
  | { t: 'mythic'; phase: 'start'; thief: string; thiefName: string; victimName: string; workId: string; district: number }
  | { t: 'mythic'; phase: 'saved'; thiefName: string; byName: string; workId: string; bounty: number }
  | { t: 'mythic'; phase: 'stolen'; thiefName: string; victimName: string; workId: string }
  | { t: 'ticket'; ok: boolean; price: number; name: string }
  | { t: 'visitor'; name: string; price: number }
  | { t: 'hall-error'; error: string }
  | { t: 'won'; workId: string; frame: FrameId; price: number }
  | { t: 'sale'; phase: 'soon'; id: string; label: string; kind: string; at: number }
  | { t: 'sale'; phase: 'start'; id: string; label: string; kind: string; lots: number; workId: string }
  | { t: 'sale'; phase: 'sold'; label: string; workId: string; frame: FrameId; sold: boolean; price: number; winner: string | null; npc: boolean; winnerId: string | null }
  | { t: 'sale'; phase: 'end'; id: string; label: string }
  | {
    t: 'welcome'; now: number; you: { id: string; plot: number; jailUntil: number }; plots: PlotInfo[]; players: NetPlayer[]; guards: NetGuard[]; district: number;
    chat?: ChatLine[]; invite?: { status: 'ok' | 'full' | 'offline' | 'unknown' | 'self'; name: string | null } | null; max?: number;
    coins?: CoinSpot[];
    /** Serveur privé : son propriétaire (null dans un quartier public). */
    privateOf?: { id: string; name: string } | null;
    season?: SeasonState;
  }
  | { t: 'season'; season: SeasonState }
  | { t: 'bonk'; from: string; to: string | null; dropped: boolean; x: number; z: number; stunMs: number }
  | { t: 'coins'; add?: CoinSpot[]; del?: number[]; by?: string }
  | { t: 'coin-got'; id: number; amount: number }
  | { t: 'live-event'; event: LiveEvent | null }
  | ChatLine
  | { t: 'chat-error'; error: string }
  | { t: 'emote'; id: string; kind: EmoteKind }
  | { t: 'rtc'; from: string; data: RtcData }
  | { t: 'snap'; now: number; players: NetPlayer[]; guards: NetGuard[] }
  | { t: 'alarm'; plot: number; thief: string; thiefName: string; reason: 'camera' | 'laser' | 'sabotage' }
  | { t: 'tool'; ok: boolean; tool: string; error?: string; message?: string; plot?: number; tools?: Record<string, number> }
  | { t: 'fx'; kind: 'fumigene' | 'leurre'; plot: number; x: number; z: number; until: number }
  | { t: 'join'; player: NetPlayer; invited?: string | null }
  | { t: 'leave'; id: string }
  | { t: 'plot'; plot: PlotInfo }
  | { t: 'lock'; plot: number; lockedUntil: number; lockReadyAt: number; error?: string }
  | { t: 'teleport'; x: number; z: number; f?: number }
  | { t: 'kicked'; reason: string }
  | { t: 'error'; error: string }
  | StealEvent;

/** Connexion WebSocket au quartier, avec reconnexion automatique. */
export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  connected = false;
  /** Code d'invitation d'un ami : envoyé à la première connexion seulement. */
  joinCode: string | null = null;
  /**
   * « private » : aller (et revenir après une coupure) sur son serveur privé ;
   * « public » : quitter le serveur privé pour un quartier public (une seule fois).
   */
  mode: 'private' | 'public' | null = null;
  onMessage: (m: ServerMsg) => void = () => undefined;
  onStatus: (connected: boolean) => void = () => undefined;

  constructor(private auth: () => { id: string; token: string } | null) {}

  connect(): void {
    const a = this.auth();
    if (!a || this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'auth', id: a.id, token: a.token, ...(this.joinCode ? { join: this.joinCode } : {}), ...(this.mode ? { [this.mode]: true } : {}) }));
      this.joinCode = null; // une reconnexion ramène le joueur chez lui, pas chez l'ami
      if (this.mode === 'public') this.mode = null;
      this.retry = 0;
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.connected = true;
        this.onStatus(true);
      }
      if (m.t === 'kicked') this.closed = true;
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // ancienne connexion remplacée (wake)
      this.connected = false;
      this.onStatus(false);
      if (this.closed) return;
      // reconnexion progressive : 1 s, 2 s, 4 s… jusqu'à 15 s (sans internet, on attend surtout le retour du réseau : wake)
      const delay = Math.min(15000, 1000 * 2 ** this.retry++);
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private timer: number | undefined;

  /**
   * Le réseau revient (événement « online » du navigateur) : on se reconnecte tout de suite,
   * au lieu d'attendre la fin du délai de reconnexion (jusqu'à 15 s).
   */
  wake(): void {
    if (this.closed || this.connected) return;
    clearTimeout(this.timer);
    this.retry = 0;
    const old = this.ws;
    this.ws = null;
    if (old && old.readyState !== WebSocket.CLOSED) {
      old.onclose = null;
      old.close();
    }
    this.connect();
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
