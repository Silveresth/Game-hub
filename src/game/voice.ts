/**
 * Discussion vocale de proximité (WebRTC, pair à pair) entre les joueurs d'un même quartier qui ont activé leur micro.
 *  - le serveur ne fait que relayer la signalisation (offre, réponse, candidats) ; la voix va directement d'un joueur à l'autre ;
 *  - une seule connexion par paire : c'est le joueur dont l'identifiant est le plus petit qui appelle (pas d'offres croisées) ;
 *  - le volume dépend de la distance (plein à 5 m, muet au-delà de 25 m) ;
 *  - détection de la voix (qui parle ?) pour afficher 🔊 au-dessus des têtes.
 */
import type { RtcData } from './net';

const FULL = 5;
const SILENT = 25;
const SPEAK_LEVEL = 0.035;

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  pending: RTCIceCandidateInit[];
  speaking: boolean;
}

export class Voice {
  enabled = false;
  muted = false;
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private buf = new Float32Array(512);
  /** Joueurs masqués (ni texte ni voix). */
  blocked = new Set<string>();
  onSpeaking: (id: string, speaking: boolean) => void = () => undefined;

  constructor(private send: (m: Record<string, unknown>) => void, private myId: () => string) {}

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && 'RTCPeerConnection' in window;
  }

  /** Active le micro (demande d'autorisation au navigateur). */
  async enable(): Promise<void> {
    if (this.enabled) return;
    try {
      const cfg = (await (await fetch('/api/config')).json()) as { iceServers?: RTCIceServer[] };
      if (cfg.iceServers?.length) this.ice = cfg.iceServers;
    } catch {
      /* serveur STUN par défaut */
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.localAnalyser = this.ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    this.ctx.createMediaStreamSource(this.stream).connect(this.localAnalyser);
    this.enabled = true;
    this.setMuted(false);
    this.send({ t: 'voice', on: true });
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.localAnalyser = null;
    this.send({ t: 'voice', on: false });
  }

  /** Micro coupé (on entend toujours les autres). */
  setMuted(m: boolean): void {
    this.muted = m;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m));
  }

  /** Liste des joueurs du quartier (instantané du serveur) : ouvre ou ferme les connexions. */
  sync(players: Array<{ id: string; voice?: boolean }>): void {
    if (!this.enabled) return;
    const me = this.myId();
    const live = new Set(players.filter((p) => p.voice && p.id !== me && !this.blocked.has(p.id)).map((p) => p.id));
    for (const id of [...this.peers.keys()]) if (!live.has(id)) this.drop(id);
    for (const id of live) if (!this.peers.has(id) && me < id) void this.call(id);
  }

  private create(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pc, audio, analyser: null, pending: [], speaking: false };
    this.peers.set(id, peer);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(id, { type: 'candidate', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      void audio.play().catch(() => undefined);
      if (this.ctx) {
        peer.analyser = this.ctx.createAnalyser();
        peer.analyser.fftSize = 512;
        this.ctx.createMediaStreamSource(e.streams[0]).connect(peer.analyser);
      }
    };
    pc.onconnectionstatechange = () => {
      // échec (réseaux trop fermés, sans serveur TURN) : on oublie ce pair ; le prochain instantané retentera
      if (pc.connectionState === 'failed') this.drop(id);
    };
    return peer;
  }

  private async call(id: string): Promise<void> {
    const peer = this.create(id);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.signal(id, { type: 'offer', sdp: offer.sdp ?? '' });
  }

  /** Message de signalisation reçu d'un autre joueur. */
  async onSignal(from: string, data: RtcData): Promise<void> {
    if (!this.enabled || this.blocked.has(from)) return;
    try {
      if (data.type === 'offer') {
        this.drop(from); // nouvelle offre : on repart d'une connexion propre
        const peer = this.create(from);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.signal(from, { type: 'answer', sdp: answer.sdp ?? '' });
        await this.flush(peer);
      } else if (data.type === 'answer') {
        const peer = this.peers.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flush(peer);
      } else if (data.type === 'candidate') {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pending.push(data.candidate); // arrivé avant la description : on le garde pour plus tard
      }
    } catch {
      this.drop(from);
    }
  }

  private async flush(peer: Peer): Promise<void> {
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
  }

  private signal(to: string, data: RtcData): void {
    this.send({ t: 'rtc', to, data });
  }

  private drop(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(id);
    if (peer.speaking) this.onSpeaking(id, false);
  }

  private level(a: AnalyserNode | null): number {
    if (!a) return 0;
    a.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    return Math.sqrt(s / this.buf.length);
  }

  /** Niveau du micro local (0 à 1), pour l'indicateur du bouton. */
  micLevel(): number {
    return this.enabled && !this.muted ? Math.min(1, this.level(this.localAnalyser) * 8) : 0;
  }

  /** Volume selon la distance, joueurs masqués, et détection de qui parle (appelé à chaque image). */
  update(posOf: (id: string) => { x: number; z: number } | null, me: { x: number; z: number }): void {
    for (const [id, peer] of this.peers) {
      const p = posOf(id);
      const d = p ? Math.hypot(p.x - me.x, p.z - me.z) : SILENT;
      peer.audio.volume = Math.max(0, Math.min(1, (SILENT - d) / (SILENT - FULL)));
      peer.audio.muted = this.blocked.has(id);
      const speaking = !peer.audio.muted && peer.audio.volume > 0 && this.level(peer.analyser) > SPEAK_LEVEL;
      if (speaking !== peer.speaking) {
        peer.speaking = speaking;
        this.onSpeaking(id, speaking);
      }
    }
  }

  /** Nombre de joueurs entendus. */
  get count(): number {
    return this.peers.size;
  }
}
