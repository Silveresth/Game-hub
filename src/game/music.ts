/**
 * Musique de fond originale, jouée en direct par WebAudio (aucun fichier son à télécharger) :
 * un petit groove de « cambriolage joyeux », swingué, en do majeur, à 104 battements par minute.
 * Basse rebondissante, accords de marimba, mélodie au xylophone (motifs tirés au sort à chaque tour :
 * jamais deux fois tout à fait la même), shaker, grosse caisse et claquements de doigts doux.
 * Structure : intro, A, B, A' (8 mesures chacune, environ 74 s), puis la boucle reprend avec une nouvelle mélodie.
 */

const BPM = 104;
const BEAT = 60 / BPM;
/** Swing : la croche du temps dure 60 % du temps, celle du contretemps 40 %. */
const SWING = 0.6;
/** Croches par mesure. */
const STEPS = 8;
const LOOKAHEAD = 0.5; // secondes planifiées d'avance (le fil principal peut être occupé par le rendu 3D)
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

type ChordName = 'C' | 'Am' | 'Dm' | 'G7' | 'Em' | 'A7' | 'F' | 'Fm';
interface Chord {
  /** Fondamentale à la basse (numéro MIDI, octave 2). */
  root: number;
  /** Intervalles des notes de l'accord. */
  iv: number[];
}
const CHORDS: Record<ChordName, Chord> = {
  C: { root: 36, iv: [0, 4, 7, 11] },
  Am: { root: 45, iv: [0, 3, 7, 10] },
  Dm: { root: 38, iv: [0, 3, 7, 10] },
  G7: { root: 43, iv: [0, 4, 7, 10] },
  Em: { root: 40, iv: [0, 3, 7, 10] },
  A7: { root: 45, iv: [0, 4, 7, 10] },
  F: { root: 41, iv: [0, 4, 7, 11] },
  Fm: { root: 41, iv: [0, 3, 7, 9] }, // fa mineur 6 : la touche « en douce » du pont
};

type Kind = 'intro' | 'A' | 'B' | 'A2';
const SECTIONS: Array<{ kind: Kind; chords: ChordName[] }> = [
  { kind: 'intro', chords: ['C', 'Am', 'Dm', 'G7', 'C', 'Am', 'Dm', 'G7'] },
  { kind: 'A', chords: ['C', 'Am', 'Dm', 'G7', 'Em', 'A7', 'Dm', 'G7'] },
  { kind: 'B', chords: ['F', 'Fm', 'Em', 'A7', 'Dm', 'G7', 'C', 'G7'] },
  { kind: 'A2', chords: ['C', 'Am', 'Dm', 'G7', 'Em', 'A7', 'Dm', 'G7'] },
];
const TOTAL_STEPS = SECTIONS.length * 8 * STEPS;

/** Rythmes de la mélodie (une mesure, croche par croche : 1 = une note). */
const PATTERNS = [
  [1, 0, 1, 0, 1, 1, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0],
  [0, 0, 1, 1, 0, 1, 1, 0],
  [1, 1, 0, 1, 0, 0, 0, 0],
  [1, 0, 1, 1, 1, 0, 0, 0],
  [0, 1, 0, 1, 0, 1, 1, 0],
  [1, 0, 0, 0, 1, 0, 1, 1],
];
/** Fin de phrase : moins de notes, la dernière se pose. */
const ENDINGS = [
  [1, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 0, 0, 0],
  [0, 0, 1, 0, 1, 0, 0, 0],
];
/** Pas de la mélodie dans sa gamme (surtout des petits pas, parfois un saut). */
const MOVES = [-2, -1, -1, 0, 1, 1, 2, -3, 3];
const MEL_LOW = 72;
const MEL_HIGH = 88;

interface Note {
  step: number;
  len: number;
  midi: number;
  /** Deuxième voix, une tierce en dessous (dernière section). */
  harm?: number;
}

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pcOf = (m: number) => ((m % 12) + 12) % 12;
const chordPcs = (c: Chord) => c.iv.map((i) => pcOf(c.root + i));

/** Notes jouables par la mélodie sur cet accord : ses notes, plus la gamme pentatonique sans frottement d'un demi-ton. */
function poolOf(c: Chord): number[] {
  const tones = chordPcs(c);
  const pcs = new Set(tones);
  for (const p of [0, 2, 4, 7, 9]) {
    if (!tones.some((t) => pcOf(p - t) === 1 || pcOf(t - p) === 1)) pcs.add(p);
  }
  const out: number[] = [];
  for (let m = MEL_LOW; m <= MEL_HIGH; m++) if (pcs.has(pcOf(m))) out.push(m);
  return out;
}

const nearestIn = (list: number[], m: number) => list.reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best), list[0]);

function chordTonesInRange(c: Chord): number[] {
  const pcs = chordPcs(c);
  const out: number[] = [];
  for (let m = MEL_LOW; m <= MEL_HIGH; m++) if (pcs.includes(pcOf(m))) out.push(m);
  return out;
}

/** Huit mesures de mélodie : phrase de 4 mesures (a b a fin), reprise variée sur les 4 suivantes. */
function phrase(rng: () => number, chords: ChordName[], harmony: boolean): Note[][] {
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)];
  const r0 = pick(PATTERNS);
  const r1 = pick(PATTERNS);
  const end = pick(ENDINGS);
  const rhythms = [r0, r1, r0, end, r0, pick(PATTERNS), r1, end];
  const bars: Note[][] = [];
  let prev = 79;
  for (let b = 0; b < 8; b++) {
    const ch = CHORDS[chords[b]];
    const pool = poolOf(ch);
    const tones = chordTonesInRange(ch);
    if (b === 4) {
      // reprise du début de la phrase, ajustée au nouvel accord : l'oreille reconnaît le motif
      const again = bars[0].map((n) => ({ ...n, midi: n.step % 4 === 0 ? nearestIn(tones, n.midi) : nearestIn(pool, n.midi) }));
      bars.push(again);
      if (again.length) prev = again[again.length - 1].midi;
      continue;
    }
    const steps = rhythms[b].flatMap((on, k) => (on ? [k] : []));
    bars.push(
      steps.map((k, i) => {
        let move = MOVES[Math.floor(rng() * MOVES.length)];
        // la mélodie revient vers le milieu de sa tessiture
        if (prev > 84) move = -Math.max(1, Math.abs(move));
        else if (prev < 75) move = Math.max(1, Math.abs(move));
        const idx = Math.max(0, Math.min(pool.length - 1, pool.indexOf(nearestIn(pool, prev)) + move));
        let midi = pool[idx];
        if (k % 4 === 0) midi = nearestIn(tones, midi); // sur les temps forts : une note de l'accord
        prev = midi;
        return { step: k, len: Math.min(3, (steps[i + 1] ?? STEPS) - k), midi };
      }),
    );
  }
  if (harmony) {
    for (let b = 0; b < 8; b++) {
      const pool = poolOf(CHORDS[chords[b]]);
      for (const n of bars[b]) {
        const i = pool.indexOf(nearestIn(pool, n.midi));
        if (i >= 2) n.harm = pool[i - 2];
      }
    }
  }
  return bars;
}

/** Mélodies de toute la boucle (32 mesures) : une nouvelle à chaque tour. */
function makePlan(loop: number): Note[][] {
  const rng = rngOf(0x5a17 + loop * 7919);
  const melody: Note[][] = [];
  for (const s of SECTIONS) {
    if (s.kind === 'intro') for (let b = 0; b < 8; b++) melody.push([]);
    else melody.push(...phrase(rng, s.chords, s.kind === 'A2'));
  }
  return melody;
}

export class Music {
  private readonly out: GainNode;
  private readonly mix: GainNode;
  private readonly bassBus: BiquadFilterNode;
  private readonly left: AudioNode;
  private readonly right: AudioNode;
  private readonly noise: AudioBuffer;
  private timer: number | undefined;
  private nextTime = 0;
  /** Croche en cours dans la boucle (0 à 255). */
  private step = 0;
  private loop = 0;
  private melody: Note[][] = makePlan(0);
  playing = false;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // compresseur doux : niveau régulier, plus lisible sur un haut-parleur de téléphone
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    comp.connect(this.out);
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.8;
    this.mix.connect(comp);
    this.bassBus = ctx.createBiquadFilter();
    this.bassBus.type = 'lowpass';
    this.bassBus.frequency.value = 1100;
    this.bassBus.connect(this.mix);
    // un peu d'espace : mélodie à droite, accords à gauche (sans panoramique si le navigateur ne le gère pas)
    const pan = (v: number): AudioNode => {
      if (typeof ctx.createStereoPanner !== 'function') return this.mix;
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      p.connect(this.mix);
      return p;
    };
    this.left = pan(-0.25);
    this.right = pan(0.2);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Démarre (ou reprend là où elle s'était arrêtée) avec un fondu d'entrée. */
  start(): void {
    if (this.playing) return;
    this.playing = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(1, t + 1.2);
    this.nextTime = Math.max(this.nextTime, t + 0.08);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD), 120);
    this.scheduleUntil(t + LOOKAHEAD);
  }

  /** Arrêt avec un fondu de sortie (volume à zéro, son coupé). */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 0.4);
  }

  /** Rendu hors ligne (aperçu, mesure des niveaux) : planifie `seconds` de musique d'un coup. */
  prerender(seconds: number): void {
    this.out.gain.value = 1;
    this.nextTime = 0.05;
    this.scheduleUntil(seconds);
  }

  /** Planifie toutes les croches jusqu'à l'instant `until` (horloge audio). */
  private scheduleUntil(until: number): void {
    // fil principal bloqué un moment : on saute les notes en retard plutôt que de les jouer en rafale
    while (this.nextTime < this.ctx.currentTime - 0.02) this.advance();
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime);
      this.advance();
    }
  }

  private advance(): void {
    this.nextTime += (this.step % 2 === 0 ? SWING : 1 - SWING) * BEAT;
    this.step++;
    if (this.step >= TOTAL_STEPS) {
      this.step = 0;
      this.loop++;
      this.melody = makePlan(this.loop);
    }
  }

  private playStep(s: number, t: number): void {
    const bar = Math.floor(s / STEPS);
    const k = s % STEPS;
    const section = SECTIONS[Math.floor(bar / 8)];
    const b = bar % 8;
    const kind = section.kind;
    const chord = CHORDS[section.chords[b]];
    const nextBar = (bar + 1) % (SECTIONS.length * 8);
    const next = CHORDS[SECTIONS[Math.floor(nextBar / 8)].chords[nextBar % 8]];
    const last = b === 7; // dernière mesure de la section : petite relance au wood-block
    const full = kind !== 'intro' || b >= 4;
    const eighth = BEAT / 2;

    // batterie
    this.shaker(t, k % 2 ? 0.05 : 0.028);
    if (kind !== 'intro' && (k === 0 || k === (kind === 'B' ? 5 : 4))) this.kick(t);
    if (full && (k === 2 || (k === 6 && !last))) this.snap(t);
    if (last && k >= 5) this.wood(t, [84, 79, 76][k - 5]);

    // basse : fondamentale, octave, quinte, puis une note d'approche vers l'accord suivant
    const root = chord.root;
    if (k === 0) this.bass(t, root, BEAT * 0.85);
    else if (k === 4) this.bass(t, root + 7, BEAT * 0.8);
    else if (full && k === 3) this.bass(t, root + 12, 0.12, 0.6);
    else if (full && k === 7) {
      let target = next.root;
      while (target - root > 6) target -= 12;
      while (root - target > 6) target += 12;
      let approach = target + (bar % 2 ? 1 : -1);
      if (approach < 33) approach += 12;
      this.bass(t, approach, 0.14, 0.7);
    }

    // accords : sur les temps 2 et 4, en contretemps dans le pont (B)
    const comp = kind === 'B' ? k % 2 === 1 : k === 2 || k === 6;
    if (comp && !(last && k >= 5)) this.chord(t, chord, kind === 'B' ? 0.032 : 0.045);

    // mélodie
    for (const n of this.melody[bar]) {
      if (n.step !== k) continue;
      this.mallet(t, n.midi, 0.12, n.len * eighth);
      if (n.harm) this.mallet(t, n.harm, 0.055, n.len * eighth);
    }
  }

  // ---------------------------------------------------------------- instruments

  /** Enveloppe percussive : montée rapide puis extinction exponentielle. */
  private env(t: number, peak: number, attack: number, decay: number, to: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    g.connect(to);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, to: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(to);
    o.start(t);
    o.stop(t + dur);
  }

  private noiseAt(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 0.8, dur);
    return s;
  }

  /** Xylophone : fondamentale ronde, « toc » aigu du maillet, un peu de triangle pour les petits haut-parleurs. */
  private mallet(t: number, midi: number, vol: number, len: number): void {
    const f = mtof(midi);
    const decay = 0.22 + len * 0.6;
    this.osc('sine', f, t, decay + 0.05, this.env(t, vol, 0.004, decay, this.right));
    this.osc('sine', f * 4, t, 0.1, this.env(t, vol * 0.45, 0.002, 0.06, this.right));
    this.osc('triangle', f, t, 0.25, this.env(t, vol * 0.3, 0.004, 0.18, this.right));
  }

  /** Accord court de marimba, voix serrées entre sol 3 et sol 4. */
  private chord(t: number, c: Chord, vol: number): void {
    for (const pc of chordPcs(c)) {
      let m = 55 + pcOf(pc - 55);
      if (m > 67) m -= 12;
      const f = mtof(m);
      this.osc('sine', f, t, 0.3, this.env(t, vol, 0.005, 0.24, this.left));
      this.osc('triangle', f * 2, t, 0.1, this.env(t, vol * 0.25, 0.003, 0.07, this.left));
    }
  }

  /** Basse ronde (triangle) avec son octave, pour qu'on l'entende aussi sur un téléphone. */
  private bass(t: number, midi: number, len: number, vol = 1): void {
    const f = mtof(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.24 * vol, t + 0.012);
    g.gain.setTargetAtTime(0.15 * vol, t + 0.03, 0.09);
    g.gain.setTargetAtTime(0, t + len, 0.045);
    g.connect(this.bassBus);
    this.osc('triangle', f, t, len + 0.3, g);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.35;
    g2.connect(g);
    this.osc('sine', f * 2, t, len + 0.3, g2);
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    o.connect(this.env(t, 0.5, 0.002, 0.2, this.mix));
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Claquement de doigts : bruit filtré autour de 2,4 kHz. */
  private snap(t: number): void {
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.4;
    bp.connect(this.env(t, 0.2, 0.001, 0.08, this.left));
    this.noiseAt(t, 0.12).connect(bp);
  }

  private shaker(t: number, vol: number): void {
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    hp.connect(this.env(t, vol, 0.006, 0.045, this.right));
    this.noiseAt(t, 0.07).connect(hp);
  }

  /** Wood-block : « toc toc toc » de fin de section. */
  private wood(t: number, midi: number): void {
    const f = mtof(midi);
    this.osc('sine', f, t, 0.1, this.env(t, 0.12, 0.002, 0.07, this.mix));
    this.osc('triangle', f * 1.5, t, 0.06, this.env(t, 0.05, 0.002, 0.04, this.mix));
  }
}
