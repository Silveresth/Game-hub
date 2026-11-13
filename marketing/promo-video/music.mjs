// Bande-son de la vidéo promo : musique 128 BPM + bruitages calés sur l'image (synthèse pure, aucun échantillon).
// Mêmes repères que anim.js : une mesure = 1,875 s, 16 mesures = 30 s.
// Usage : node music.mjs [dossier-voix] [fichier-sortie]  (ex. node music.mjs voice-paul audio-paul.wav)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SR = 44100, BPM = 128, BEAT = 60 / BPM, BAR = BEAT * 4, DUR = BAR * 16;
const N = Math.ceil(SR * DUR);
const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const MUS = bus(), DRM = bus(), SFX = bus();
const kicks = [];
let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const lpK = (fc) => 1 - Math.exp((-2 * Math.PI * Math.min(fc, SR * 0.45)) / SR);
const lerp = (a, b, k) => a + (b - a) * k;
const panG = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
function put(b, i, l, r) {
  if (i >= 0 && i < N) {
    b.L[i] += l;
    b.R[i] += r;
  }
}
function osc(type, ph) {
  switch (type) {
    case 'square': return ph < 0.5 ? 1 : -1;
    case 'pulse': return ph < 0.25 ? 1 : -1;
    case 'saw': return 2 * ph - 1;
    case 'tri': return 1 - 4 * Math.abs(ph - 0.5);
    default: return Math.sin(2 * Math.PI * ph);
  }
}

/** Note : enveloppe ADSR, glissando, passe-bas (qui peut glisser), désaccord, panoramique. */
function note(b, t0, dur, o) {
  const { f, f2, type = 'sine', vol = 0.2, a = 0.004, d = 0.1, s = 0.7, r = 0.08, cut, cut2, pan = 0, det = 0 } = o;
  const n0 = Math.round(t0 * SR), len = Math.round((dur + r) * SR);
  const [gl, gr] = panG(pan);
  let ph = rnd(), ph2 = rnd(), lp = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const k = Math.min(1, tt / dur);
    const fr = f2 ? f * Math.pow(f2 / f, k) : f;
    ph += fr / SR;
    ph -= Math.floor(ph);
    let x = osc(type, ph);
    if (det) {
      ph2 += (fr * (1 + det)) / SR;
      ph2 -= Math.floor(ph2);
      x = (x + osc(type, ph2)) * 0.5;
    }
    const env = tt < a ? tt / a : tt < a + d ? 1 - ((1 - s) * (tt - a)) / d : tt < dur ? s : s * Math.max(0, 1 - (tt - dur) / r);
    x *= env * vol;
    if (cut) {
      lp += lpK(cut2 ? cut * Math.pow(cut2 / cut, k) : cut) * (x - lp);
      x = lp;
    }
    put(b, n0 + i, x * gl, x * gr);
  }
}

/** Bruit filtré (passe-bas et passe-haut glissants), enveloppe libre. */
function noiseHit(b, t0, dur, o) {
  const { vol = 0.3, cut = 8000, cut2, hp = 0, hp2, env = (k) => Math.exp(-k * 6), pan = 0, panTo } = o;
  const n0 = Math.round(t0 * SR), len = Math.round(dur * SR);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < len; i++) {
    const k = i / len;
    lp += lpK(cut2 ? cut * Math.pow(cut2 / cut, k) : cut) * (noise() - lp);
    let x = lp;
    if (hp) {
      lp2 += lpK(hp2 ? hp * Math.pow(hp2 / hp, k) : hp) * (x - lp2);
      x -= lp2;
    }
    x *= env(k) * vol;
    const [gl, gr] = panG(panTo !== undefined ? lerp(pan, panTo, k) : pan);
    put(b, n0 + i, x * gl, x * gr);
  }
}

/** Même synthèse que les bruitages du jeu (src/game/sfx.ts) : attaque 10 ms, décroissance exponentielle. */
function tone(b, t0, f, dur, type = 'triangle', vol = 0.18, slide, pan = 0) {
  const n0 = Math.round(t0 * SR), len = Math.round(dur * SR);
  const [gl, gr] = panG(pan);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    const fr = slide ? f * Math.pow(slide / f, tt / dur) : f;
    ph += fr / SR;
    ph -= Math.floor(ph);
    const env = tt < 0.01 ? (tt / 0.01) * vol : vol * Math.pow(0.001 / vol, (tt - 0.01) / (dur - 0.01));
    const x = osc(type, ph) * env;
    put(b, n0 + i, x * gl, x * gr);
  }
}

// ------------------------------------------------------------------ batterie

function kickInto(b, t0, vol) {
  const n0 = Math.round(t0 * SR), len = Math.round(0.42 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    ph += (44 + 120 * Math.exp(-tt * 28)) / SR;
    let x = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 6.5);
    if (tt < 0.004) x += noise() * 0.5 * (1 - tt / 0.004);
    put(b, n0 + i, x * vol, x * vol);
  }
}
function kick(t0, vol = 0.95) {
  kickInto(DRM, t0, vol);
  kicks.push(t0);
}
function clap(t0, vol = 0.32) {
  for (const [o, d] of [[0, 0.03], [0.012, 0.03], [0.024, 0.2]]) noiseHit(DRM, t0 + o, d, { vol, cut: 4200, hp: 900, env: (k) => Math.exp(-k * 5) });
}
function hat(t0, vol = 0.08, open = false, pan = 0) {
  noiseHit(DRM, t0, open ? 0.3 : 0.05, { vol, cut: 16000, hp: 7000, env: (k) => Math.exp(-k * (open ? 4 : 6)), pan });
}
function crash(t0, vol = 0.26) {
  noiseHit(DRM, t0, 2.2, { vol, cut: 14000, hp: 4500, env: (k) => Math.exp(-k * 4.5), pan: -0.3 });
  noiseHit(DRM, t0, 2.2, { vol: vol * 0.8, cut: 12000, hp: 5200, env: (k) => Math.exp(-k * 4.5), pan: 0.35 });
}
function roll(t0, vol = 0.3) {
  for (let i = 0; i < 8; i++) clap(t0 + (i * BEAT) / 8, vol * (0.35 + (i / 8) * 0.65));
}

// ------------------------------------------------------------------ musique

const CH = {
  Am: { bass: 45, tri: [57, 60, 64] },
  F: { bass: 41, tri: [57, 60, 65] },
  C: { bass: 48, tri: [55, 60, 64] },
  G: { bass: 43, tri: [55, 59, 62] },
};
const PROG = ['Am', 'F', 'C', 'G'];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 4, 3, 2, 1];

for (let b = 0; b < 16; b++) {
  const t = b * BAR;
  const intro = b < 2;
  const ch = CH[intro ? 'Am' : PROG[(b - 2) % 4]];
  const tones = [ch.tri[0] + 12, ch.tri[1] + 12, ch.tri[2] + 12, ch.tri[0] + 24, ch.tri[1] + 24];
  const big = b >= 11; // « admin abuse » et final : plus fort, arpège doublé
  // nappe
  ch.tri.forEach((m, i) => note(MUS, t, BAR, { f: mtof(m), type: 'saw', det: 0.006, vol: intro ? 0.05 : 0.04, a: 0.08, d: 0.3, s: 0.8, r: 0.2, cut: intro ? 700 : 1800, pan: (i - 1) * 0.45 }));
  // arpège
  for (let s = 0; s < 16; s++) {
    if (intro && s % 2) continue;
    const m = tones[ARP[s]];
    note(MUS, t + (s * BEAT) / 4, BEAT / 4, { f: mtof(m), type: 'pulse', vol: intro ? 0.06 : 0.055, a: 0.002, d: 0.12, s: 0, r: 0.03, cut: intro ? 2200 : 4200, pan: s % 2 ? 0.35 : -0.35 });
    if (big) note(MUS, t + (s * BEAT) / 4, BEAT / 4, { f: mtof(m + 12), type: 'tri', vol: 0.03, a: 0.002, d: 0.1, s: 0, r: 0.03, pan: s % 2 ? -0.25 : 0.25 });
  }
  // charleston
  for (let s = 0; s < 16; s++) {
    if (intro && s % 2) continue;
    hat(t + (s * BEAT) / 4, s % 4 === 2 ? 0.09 : 0.045, false, s % 2 ? 0.3 : -0.3);
    if (!intro && s % 4 === 2) hat(t + (s * BEAT) / 4, 0.05, true, 0.2);
  }
  if (intro) {
    // battement de cœur : grosse caisse feutrée sur les temps 1 et 3, puis tous les temps avant la montée
    for (let q = 0; q < 4; q++) if (q % 2 === 0 || b === 1) kick(t + q * BEAT, b === 1 && q % 2 ? 0.45 : 0.6);
    note(MUS, t, BAR, { f: mtof(33), type: 'sine', vol: 0.12, a: 0.3, d: 0.2, s: 0.9, r: 0.2 });
    continue;
  }
  // basse en octaves sautillantes
  for (let e = 0; e < 8; e++) note(MUS, t + (e * BEAT) / 2, (BEAT / 2) * 0.85, { f: mtof(ch.bass + (e % 2 ? 12 : 0)), type: 'saw', vol: 0.2, a: 0.003, d: 0.16, s: 0.35, r: 0.04, cut: 900 });
  // grosse caisse et claps (sauf les roulements de fin de section)
  const fill = b === 7 || b === 10 || b === 13;
  for (let q = 0; q < 4; q++) {
    if (fill && q === 3) continue;
    kick(t + q * BEAT);
    if (q % 2 === 1) clap(t + q * BEAT, big ? 0.36 : 0.3);
  }
  if (fill) roll(t + 3 * BEAT, big ? 0.36 : 0.3);
}

// ------------------------------------------------------------------ bruitages

const whoosh = (t0, dur = 0.36, vol = 0.32) => noiseHit(SFX, t0 - dur * 0.6, dur, { vol, cut: 400, cut2: 7000, hp: 150, env: (k) => Math.sin(Math.PI * k) ** 2, pan: -0.7, panTo: 0.7 });
const impact = (t0, vol = 0.9) => {
  note(SFX, t0, 1.1, { f: 72, f2: 32, type: 'sine', vol, a: 0.002, d: 1.0, s: 0, r: 0.05 });
  noiseHit(SFX, t0, 0.5, { vol: vol * 0.45, cut: 900, env: (k) => Math.exp(-k * 7) });
};
const riser = (t0, dur, vol = 0.22) => {
  noiseHit(SFX, t0, dur, { vol, cut: 300, cut2: 11000, hp: 100, env: (k) => k * k });
  note(SFX, t0, dur, { f: 180, f2: 1500, type: 'saw', vol: vol * 0.25, a: dur * 0.9, d: 0.01, s: 1, r: 0.02, cut: 2500 });
};
const tick = (t0, f = 2200, vol = 0.1) => note(SFX, t0, 0.02, { f, type: 'sine', vol, a: 0.001, d: 0.02, s: 0, r: 0.01 });
const pop = (t0, vol = 0.28, f = 380) => note(SFX, t0, 0.07, { f, f2: f * 2.6, type: 'sine', vol, a: 0.002, d: 0.07, s: 0, r: 0.02 });
const stampHit = (t0) => {
  kickInto(SFX, t0, 0.9);
  noiseHit(SFX, t0, 0.14, { vol: 0.5, cut: 3500, hp: 300, env: (k) => Math.exp(-k * 5) });
};
const coin = (t0, n = 1, vol = 0.09, pan = 0) => {
  for (let i = 0; i < n; i++) {
    tone(SFX, t0 + i * 0.06, 1568, 0.12, 'square', vol, null, pan);
    tone(SFX, t0 + i * 0.06 + 0.05, 2093, 0.18, 'square', vol, null, pan);
  }
};
const kaching = (t0) => {
  coin(t0, 3, 0.09);
  noiseHit(SFX, t0, 0.2, { vol: 0.25, cut: 12000, hp: 3000, env: (k) => Math.exp(-k * 8) });
  tone(SFX, t0 + 0.18, 3136, 0.5, 'triangle', 0.08);
};
const chime = (t0, vol = 0.13) => [784, 987.8, 1174.7, 1568, 1975.5, 2349.3].forEach((f, i) => tone(SFX, t0 + i * 0.05, f, 0.5, 'sine', vol, null, i % 2 ? 0.4 : -0.4));
const sparkleSfx = (t0) => {
  for (let i = 0; i < 8; i++) tone(SFX, t0 + i * 0.035, 2000 + rnd() * 2500, 0.15, 'sine', 0.045, null, rnd() * 2 - 1);
};
const siren = (t0, n = 6, vol = 0.07) => {
  for (let i = 0; i < n; i++) note(SFX, t0 + i * 0.28, 0.26, { f: i % 2 ? 660 : 880, type: 'saw', vol, a: 0.01, d: 0.05, s: 0.9, r: 0.03, cut: 2600 });
};
const boing = (t0) => {
  const n0 = Math.round(t0 * SR), len = Math.round(0.65 * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR;
    ph += (250 + 170 * Math.sin(2 * Math.PI * 13 * tt) * Math.exp(-tt * 4) + 160 * tt) / SR;
    const x = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 5) * 0.26;
    put(SFX, n0 + i, x, x);
  }
};
const bonk = (t0) => {
  tone(SFX, t0, 520, 0.09, 'square', 0.14, 180);
  tone(SFX, t0 + 0.05, 240, 0.4, 'sine', 0.3, 640);
  boing(t0 + 0.04);
  kickInto(SFX, t0, 0.75);
  noiseHit(SFX, t0, 0.08, { vol: 0.4, cut: 5000, hp: 400, env: (k) => Math.exp(-k * 6) });
};
const zip = (t0) => {
  note(SFX, t0, 0.22, { f: 300, f2: 2600, type: 'tri', vol: 0.14, a: 0.005, d: 0.2, s: 0.4, r: 0.03 });
  noiseHit(SFX, t0, 0.22, { vol: 0.15, cut: 2000, cut2: 9000, hp: 800, env: (k) => Math.sin(Math.PI * k) });
};
const glitch = (t0) => {
  for (let i = 0; i < 5; i++) noiseHit(SFX, t0 + i * 0.045, 0.03, { vol: 0.22, cut: 6000, hp: 500, env: () => 1 });
  note(SFX, t0, 0.2, { f: 110, f2: 55, type: 'square', vol: 0.14, a: 0.001, d: 0.2, s: 0, r: 0.01, cut: 1500 });
};
const bell = (t0, f = 1046.5, vol = 0.22) => {
  const n0 = Math.round(t0 * SR), len = Math.round(1.8 * SR);
  for (const [m, a, dec] of [[1, 1, 2.2], [2.76, 0.45, 3.5], [5.4, 0.22, 5], [8.93, 0.1, 7]]) {
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / SR;
      ph += (f * m) / SR;
      const x = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * dec) * Math.min(1, tt / 0.002) * vol * a;
      put(SFX, n0 + i, x, x);
    }
  }
};
const tap = (t0) => {
  noiseHit(SFX, t0, 0.012, { vol: 0.3, cut: 9000, hp: 1500, env: () => 1 });
  note(SFX, t0, 0.03, { f: 1300, type: 'sine', vol: 0.12, a: 0.001, d: 0.03, s: 0, r: 0.01 });
};
const confettiPop = (t0) => {
  noiseHit(SFX, t0, 0.25, { vol: 0.35, cut: 9000, hp: 1200, env: (k) => Math.exp(-k * 9) });
  pop(t0 + 0.02, 0.25, 300);
};

// 1. accroche
impact(0);
for (let i = 0; i < 18; i++) tick(0.35 + i * 0.07, 1500 + i * 70, 0.08);
whoosh(1.9, 0.3, 0.4);
stampHit(1.95);
siren(2.05, 3, 0.04);
[2.81, 2.93, 3.05, 3.28, 3.4, 3.52, 3.6].forEach((t) => pop(t, 0.22, 360 + rnd() * 120));
pop(3.16, 0.32, 300);
sparkleSfx(3.18);
riser(2.95, 0.8);
// 2. logo
crash(3.75);
impact(3.75, 0.6);
chime(3.8);
sparkleSfx(3.82);
for (let i = 0; i < 7; i++) tick(3.98 + i * 0.035, 3000, 0.04);
for (let i = 0; i < 11; i++) tick(4.22 + i * 0.03, 3300, 0.04);
pop(4.85);
[6.56, 6.8].forEach((t) => pop(t));
pop(7.03, 0.3, 450);
// transitions
[7.5, 11.25, 15, 18.75, 22.5, 24.375].forEach((c) => whoosh(c + 0.06, 0.36, 0.34));
// 3. achète
tap(8.3);
kaching(8.4);
chime(9.4, 0.1);
tap(9.9);
// 4. expose et encaisse
for (let n = 0; n < 7; n++) {
  pop(11.95 + n * BEAT, 0.12, 500);
  coin(11.95 + n * BEAT + 0.5, 1, 0.07, n % 2 ? 0.4 : -0.4);
}
kaching(14.55);
// 5. vole
for (let i = 0; i < 7; i++) tick(15.3 + (i * BEAT) / 2, 1800 + i * 90, 0.1);
pop(16.875, 0.35, 300);
siren(16.9, 6);
stampHit(16.95);
// 6. bonk
whoosh(18.92, 0.22, 0.32);
bonk(18.95);
sparkleSfx(19.0);
pop(19.2);
riser(19.9, 0.72);
// 7. admin abuse
crash(20.625, 0.3);
glitch(20.625);
impact(20.625, 0.5);
for (let i = 0; i < 15; i++) coin(20.75 + i * 0.11 + rnd() * 0.05, 1, 0.055, rnd() * 2 - 1);
pop(20.85);
chime(22.5);
sparkleSfx(22.6);
bell(22.78, 1318.5);
pop(23.0);
zip(24.375);
zip(24.75);
pop(24.6);
whoosh(25.3, 0.25, 0.25);
riser(25.5, 0.75);
// 8. appel à l'action
crash(26.25, 0.3);
impact(26.25, 0.5);
confettiPop(26.27);
pop(26.35, 0.3, 300);
chime(26.4, 0.1);
[27.2, 27.35, 27.5, 27.75].forEach((t) => pop(t, 0.18));
tap(27.45);
pop(28.2, 0.3, 450);
tap(28.85);
bell(29.06, 1046.5, 0.24);

// ------------------------------------------------------------------ voix off (facultative : voir voice.ps1)

function readWav(file) {
  const b = readFileSync(file);
  let i = 12, rate = 16000, ch = 1;
  while (i < b.length - 8) {
    const id = b.toString('ascii', i, i + 4);
    const sz = b.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      ch = b.readUInt16LE(i + 10);
      rate = b.readUInt32LE(i + 12);
    } else if (id === 'data') {
      const n = Math.floor(Math.min(sz, b.length - i - 8) / (2 * ch));
      const data = new Float32Array(n);
      for (let k = 0; k < n; k++) data[k] = b.readInt16LE(i + 8 + k * 2 * ch) / 32768;
      return { rate, data };
    }
    i += 8 + sz + (sz % 2);
  }
  throw new Error('WAV illisible : ' + file);
}

const VOX = new Float32Array(N);
if (process.argv[2]) {
  const dir = path.join(HERE, process.argv[2]);
  for (const l of JSON.parse(readFileSync(path.join(HERE, 'voice.json'), 'utf8'))) {
    const { rate, data } = readWav(path.join(dir, `${l.id}.wav`));
    // la parole commence pile au repère (30 ms d'avance pour l'attaque), silences de début et de fin retirés
    let first = 0;
    while (first < data.length && Math.abs(data[first]) < 0.03) first++;
    let last = data.length - 1;
    while (last > first && Math.abs(data[last]) < 0.02) last--;
    const seg = data.subarray(Math.max(0, first - Math.round(0.03 * rate)), Math.min(data.length, last + Math.round(0.08 * rate)));
    let peak = 0;
    for (const x of seg) peak = Math.max(peak, Math.abs(x));
    const gain = 0.9 / (peak || 1);
    const n0 = Math.round((l.at - 0.03) * SR);
    const step = rate / SR;
    let lp = 0, hp = 0;
    const count = Math.floor((seg.length - 1) / step); // l'interpolation lit seg[k + 1] : on s'arrête avant la fin
    for (let i = 0; i < count; i++) {
      const p = i * step, k = Math.floor(p), f = p - k;
      let x = (seg[k] * (1 - f) + seg[k + 1] * f) * gain;
      lp += lpK(rate * 0.45) * (x - lp); // rééchantillonnage sans marches
      hp += lpK(110) * (lp - hp); // passe-haut : voix plus nette
      x = Math.tanh((lp - hp) * 1.8) / Math.tanh(1.8); // un peu de densité
      if (n0 + i >= 0 && n0 + i < N) VOX[n0 + i] += x;
    }
  }
}

// ------------------------------------------------------------------ mixage

kicks.sort((a, b) => a - b);
const attK = 1 - Math.exp(-1 / (0.008 * SR)), relK = 1 - Math.exp(-1 / (0.22 * SR));
let venv = 0;
const out = new Int16Array(N * 2);
const mix = new Float32Array(N * 2);
let ki = 0, peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  while (ki + 1 < kicks.length && kicks[ki + 1] <= t) ki++;
  const tk = kicks[ki] !== undefined && kicks[ki] <= t ? t - kicks[ki] : 9;
  const duck = 1 - 0.5 * Math.exp(-tk * 10); // « pompe » de la musique sur la grosse caisse
  // silence comique juste avant le BONK
  const gate = t > 18.68 && t < 18.95 ? Math.max(0, 1 - (t - 18.68) / 0.03) : t >= 18.95 && t < 18.98 ? (t - 18.95) / 0.03 : 1;
  // la musique s'efface sous la voix (environ -8 dB), les bruitages un peu moins
  const v = Math.abs(VOX[i]);
  venv += (v > venv ? attK : relK) * (v - venv);
  const dv = Math.min(1, venv * 5);
  for (let c = 0; c < 2; c++) {
    const m = c ? MUS.R[i] : MUS.L[i], d = c ? DRM.R[i] : DRM.L[i], s = c ? SFX.R[i] : SFX.L[i];
    let x = (m * 0.55 * duck + d * 0.75) * gate * (1 - 0.62 * dv) + s * 0.85 * (1 - 0.35 * dv) + VOX[i] * 0.95;
    x = Math.tanh(x * 1.15) / Math.tanh(1.15);
    mix[i * 2 + c] = x;
    peak = Math.max(peak, Math.abs(x));
  }
}
const norm = 0.96 / peak;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.005, (DUR - t) / 0.3);
  for (let c = 0; c < 2; c++) out[i * 2 + c] = Math.round(Math.max(-1, Math.min(1, mix[i * 2 + c] * norm * fade)) * 32767);
}
const data = Buffer.from(out.buffer);
const head = Buffer.alloc(44);
head.write('RIFF', 0);
head.writeUInt32LE(36 + data.length, 4);
head.write('WAVE', 8);
head.write('fmt ', 12);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24);
head.writeUInt32LE(SR * 4, 28);
head.writeUInt16LE(4, 32);
head.writeUInt16LE(16, 34);
head.write('data', 36);
head.writeUInt32LE(data.length, 40);
const file = path.join(HERE, process.argv[3] ?? 'audio.wav');
writeFileSync(file, Buffer.concat([head, data]));
console.log(`${path.basename(file)} : ${DUR.toFixed(2)} s, crête avant normalisation ${peak.toFixed(2)}`);
