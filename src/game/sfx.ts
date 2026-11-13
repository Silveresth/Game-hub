/** Bruitages synthétisés en WebAudio (aucun fichier son). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  muted = false;

  /** À appeler depuis un geste utilisateur. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
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
    o.connect(g).connect(this.master);
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
    o.connect(g).connect(this.master);
    o.start(c.currentTime);
    o.stop(c.currentTime + 0.08);
  }
}
