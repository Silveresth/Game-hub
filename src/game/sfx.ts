import { Music } from './music';

/** Volume réel d'un réglage de 0 à 100 (courbe au carré : le curseur suit ce que l'oreille perçoit). */
const level = (v: number, ref: number, at: number) => ref * (v / at) ** 2;

/** Bruitages synthétisés en WebAudio (aucun fichier son), et musique de fond. */
export class Sfx {
  private ctx: AudioContext | null = null;
  /** Coupure générale (bouton 🔊). */
  private master!: GainNode;
  /** Bruitages. */
  private fx!: GainNode;
  private musicBus!: GainNode;
  private music: Music | null = null;
  muted = false;
  /** Volumes des options, de 0 à 100. */
  private vol = { fx: 80, music: 50 };

  /** À appeler depuis un geste utilisateur (le navigateur n'autorise le son qu'après un clic ou une touche). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.fx = this.ctx.createGain();
      this.fx.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.applyVolumes();
      this.music = new Music(this.ctx, this.musicBus);
      // onglet caché, application en arrière-plan : son et musique en pause (batterie), reprise au retour
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
    }
    if (!document.hidden && this.ctx.state !== 'running') void this.ctx.resume();
    this.syncMusic();
  }

  /** Volumes des bruitages et de la musique (0 à 100) ; 0 pour la musique l'arrête. */
  setVolumes(fx: number, music: number): void {
    this.vol = { fx, music };
    this.applyVolumes();
    this.syncMusic();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    this.syncMusic();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.fx.gain.setTargetAtTime(level(this.vol.fx, 0.6, 80), t, 0.05);
    // musique un peu sous les bruitages : une pièce ou une sirène doit toujours s'entendre par-dessus
    this.musicBus.gain.setTargetAtTime(level(this.vol.music, 0.32, 50), t, 0.05);
  }

  /** La musique ne tourne que si elle s'entend (volume > 0, son non coupé) : rien n'est calculé pour rien. */
  private syncMusic(): void {
    if (!this.music) return;
    if (!this.muted && this.vol.music > 0) this.music.start();
    else this.music.stop();
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType = 'triangle', vol = 0.18, slide?: number): void {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + at);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + at + dur);
    g.gain.setValueAtTime(0, c.currentTime + at);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + dur);
    o.connect(g).connect(this.fx);
    o.start(c.currentTime + at);
    o.stop(c.currentTime + at + dur + 0.05);
  }

  coin(n = 1): void {
    for (let i = 0; i < Math.min(n, 6); i++) {
      this.tone(1568, i * 0.06, 0.12, 'square', 0.05);
      this.tone(2093, i * 0.06 + 0.05, 0.18, 'square', 0.05);
    }
  }
  buy(): void { [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, i * 0.07, 0.3)); }
  expand(): void { [392, 523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this.tone(f, i * 0.09, 0.45, 'triangle', 0.2)); }
  error(): void { this.tone(160, 0, 0.12, 'square', 0.07); this.tone(120, 0.13, 0.16, 'square', 0.07); }
  whoosh(): void { this.tone(300, 0, 0.5, 'sine', 0.08, 1200); }
  jump(): void { this.tone(330, 0, 0.14, 'sine', 0.1, 660); }
  /** Sirène : on vous cambriole ! */
  alarm(): void {
    for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, i * 0.28, 0.26, 'sawtooth', 0.06);
  }
  rare(): void { [784, 987.8, 1174.7, 1568].forEach((f, i) => this.tone(f, i * 0.06, 0.4, 'sine', 0.12)); }
  /** Coup de parapluie : « boing » cartoon. */
  bonk(): void {
    this.tone(520, 0, 0.09, 'square', 0.09, 180);
    this.tone(240, 0.06, 0.32, 'sine', 0.16, 640);
  }
  /** Double saut : petit envol plus aigu. */
  jump2(): void { this.tone(520, 0, 0.16, 'sine', 0.1, 1240); }
  /** Pièce de la pluie d'or ramassée. */
  pickup(): void {
    this.tone(1318.5, 0, 0.08, 'square', 0.05);
    this.tone(1975.5, 0.06, 0.2, 'square', 0.05);
  }
  /** Début d'un événement en direct : fanfare. */
  fanfare(): void { [523.3, 659.3, 784, 1046.5, 784, 1046.5].forEach((f, i) => this.tone(f, i * 0.11, i === 5 ? 0.6 : 0.2, 'triangle', 0.16)); }

  /** Atterrissage. */
  land(): void { this.tone(90, 0, 0.1, 'sine', 0.1, 42); }
  /** Décrochage d'une œuvre : petit grincement, sans fichier audio. */
  pry(): void { this.tone(210, 0, 0.05, 'square', 0.035, 140); }

  /** Bruit de pas feutré lors de la marche ou la course */
  step(): void {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(110 + Math.random() * 25, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(45, c.currentTime + 0.07);
    g.gain.setValueAtTime(0.04, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.07);
    o.connect(g).connect(this.fx);
    o.start(c.currentTime);
    o.stop(c.currentTime + 0.08);
  }
}
