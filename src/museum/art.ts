/**
 * Générateur d'œuvres procédurales déterministes : `gen:<style>:<seed>` produit toujours la même image.
 * Permet de remplir un musée sans fichier et de partager des œuvres très légères.
 */

export const GEN_STYLES = ['landscape', 'sunset', 'rothko', 'mondrian', 'circles', 'waves', 'mountains', 'bauhaus'] as const;
export type GenStyle = (typeof GEN_STYLES)[number];

const PALETTES = [
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
  ['#0b132b', '#1c2541', '#3a506b', '#5bc0be', '#f2f7f2'],
  ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff'],
  ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c', '#d90429'],
  ['#606c38', '#283618', '#fefae0', '#dda15e', '#bc6c25'],
  ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'],
  ['#3d0c11', '#7a1c2a', '#d4a373', '#faedcd', '#e9edc9'],
  ['#10002b', '#3c096c', '#7b2cbf', '#c77dff', '#e0aaff'],
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isGenSpec(url: string): boolean {
  return /^gen:[a-z]+:\d+$/.test(url);
}

export function randomGenSpec(): string {
  const style = GEN_STYLES[Math.floor(Math.random() * GEN_STYLES.length)];
  return `gen:${style}:${Math.floor(Math.random() * 1e6)}`;
}

/** Petite image JPEG (data-URL) dérivée d'un identifiant : vignette de secours d'un musée. */
export function genThumb(id: string): string {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return renderGenArt(`gen:${GEN_STYLES[h % GEN_STYLES.length]}:${h % 1000000}`, 320, 180).toDataURL('image/jpeg', 0.75);
}

const cache = new Map<string, HTMLCanvasElement>();

export function renderGenArt(spec: string, w = 640, h = 480): HTMLCanvasElement {
  const k = `${spec}@${w}x${h}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const [, styleRaw, seedRaw] = spec.split(':');
  const style: GenStyle = (GEN_STYLES as readonly string[]).includes(styleRaw) ? (styleRaw as GenStyle) : 'bauhaus';
  const rnd = mulberry32(Number(seedRaw) || 1);
  const pal = PALETTES[Math.floor(rnd() * PALETTES.length)];
  const pick = () => pal[Math.floor(rnd() * pal.length)];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  PAINTERS[style](g, w, h, rnd, pal, pick);
  // grain de toile
  for (let i = 0; i < (w * h) / 60; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.035)';
    g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }
  cache.set(k, c);
  return c;
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, pal: string[], pick: () => string) => void;

function hills(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, base: number, amp: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, h);
  const f = 1 + rnd() * 2;
  const ph = rnd() * 6;
  for (let x = 0; x <= w; x += 8) g.lineTo(x, base + Math.sin(x / w * Math.PI * f + ph) * amp + Math.sin(x / 37 + ph) * amp * 0.15);
  g.lineTo(w, h);
  g.fill();
}

const PAINTERS: Record<GenStyle, Painter> = {
  landscape(g, w, h, rnd, pal) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, pal[4]);
    sky.addColorStop(1, pal[3]);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,240,.9)';
    g.beginPath();
    g.arc(w * (0.2 + rnd() * 0.6), h * (0.2 + rnd() * 0.15), 30 + rnd() * 30, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 4; i++) hills(g, w, h, rnd, h * (0.45 + i * 0.13), 30 - i * 4, pal[(i + 1) % 3]);
  },
  sunset(g, w, h, rnd, pal) {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, pal[0]);
    sky.addColorStop(0.6, pal[2]);
    sky.addColorStop(1, pal[3]);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h * 0.6);
    const sx = w * (0.35 + rnd() * 0.3);
    g.fillStyle = pal[4];
    g.beginPath();
    g.arc(sx, h * 0.6, 70 + rnd() * 30, Math.PI, 0);
    g.fill();
    g.fillStyle = pal[1];
    g.fillRect(0, h * 0.6, w, h * 0.4);
    for (let y = h * 0.62; y < h; y += 9) {
      const len = 30 + rnd() * 140 * (1 - (y - h * 0.6) / (h * 0.5));
      g.fillStyle = 'rgba(255,230,180,.45)';
      g.fillRect(sx - len / 2 + (rnd() - 0.5) * 30, y, len, 3);
    }
  },
  rothko(g, w, h, rnd, _pal, pick) {
    g.fillStyle = pick();
    g.fillRect(0, 0, w, h);
    g.filter = 'blur(5px)';
    const n = 2 + Math.floor(rnd() * 2);
    let y = h * 0.08;
    for (let i = 0; i < n; i++) {
      const bh = (h * 0.84) / n - 14;
      g.globalAlpha = 0.9;
      g.fillStyle = pick();
      g.fillRect(w * 0.1, y, w * 0.8, bh);
      y += bh + 14;
    }
    g.filter = 'none';
    g.globalAlpha = 1;
  },
  mondrian(g, w, h, rnd) {
    g.fillStyle = '#f3efe4';
    g.fillRect(0, 0, w, h);
    const colors = ['#d62828', '#1d4ed8', '#f7c815', '#f3efe4', '#f3efe4', '#f3efe4', '#111'];
    const split = (x: number, y: number, ww: number, hh: number, d: number) => {
      if (d > 4 || ww < 70 || hh < 70 || (d > 1 && rnd() < 0.25)) {
        g.fillStyle = colors[Math.floor(rnd() * colors.length)];
        g.fillRect(x, y, ww, hh);
        g.strokeStyle = '#111';
        g.lineWidth = 8;
        g.strokeRect(x, y, ww, hh);
        return;
      }
      if (ww > hh) {
        const s = ww * (0.3 + rnd() * 0.4);
        split(x, y, s, hh, d + 1);
        split(x + s, y, ww - s, hh, d + 1);
      } else {
        const s = hh * (0.3 + rnd() * 0.4);
        split(x, y, ww, s, d + 1);
        split(x, y + s, ww, hh - s, d + 1);
      }
    };
    split(0, 0, w, h, 0);
  },
  circles(g, w, h, rnd, pal) {
    g.fillStyle = pal[0];
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'screen';
    for (let i = 0; i < 14; i++) {
      g.fillStyle = pal[1 + Math.floor(rnd() * 4)];
      g.globalAlpha = 0.35 + rnd() * 0.4;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 20 + rnd() * 130, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  },
  waves(g, w, h, rnd, pal) {
    g.fillStyle = pal[4];
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = pal[i % 4];
      g.beginPath();
      g.moveTo(0, h);
      const base = h * 0.25 + i * h * 0.1;
      const a = 12 + rnd() * 25;
      const f = 2 + rnd() * 3;
      const ph = rnd() * 6;
      for (let x = 0; x <= w; x += 6) g.lineTo(x, base + Math.sin((x / w) * Math.PI * f + ph) * a);
      g.lineTo(w, h);
      g.fill();
    }
  },
  mountains(g, w, h, rnd, pal) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, pal[0]);
    sky.addColorStop(1, pal[2]);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fffbe8';
    g.beginPath();
    g.arc(w * (0.15 + rnd() * 0.7), h * 0.18, 22, 0, Math.PI * 2);
    g.fill();
    for (let layer = 0; layer < 3; layer++) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const cx = rnd() * w;
        const top = h * (0.25 + layer * 0.15 + rnd() * 0.1);
        const half = 90 + rnd() * 120;
        const base = h * (0.75 + layer * 0.1);
        g.fillStyle = pal[(layer + 1) % 5];
        g.beginPath();
        g.moveTo(cx - half, base); g.lineTo(cx, top); g.lineTo(cx + half, base);
        g.fill();
        if (layer === 0) {
          g.fillStyle = 'rgba(255,255,255,.85)';
          const k = 0.22;
          g.beginPath();
          g.moveTo(cx - half * k, top + (base - top) * k); g.lineTo(cx, top); g.lineTo(cx + half * k, top + (base - top) * k);
          g.fill();
        }
      }
    }
    g.fillStyle = pal[1];
    g.fillRect(0, h * 0.93, w, h * 0.07);
  },
  bauhaus(g, w, h, rnd, pal, pick) {
    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = pick();
      const x = rnd() * w;
      const y = rnd() * h;
      const s = 40 + rnd() * 140;
      const kind = Math.floor(rnd() * 3);
      g.beginPath();
      if (kind === 0) g.arc(x, y, s / 2, 0, Math.PI * (rnd() < 0.5 ? 1 : 2));
      else if (kind === 1) { g.moveTo(x, y - s / 2); g.lineTo(x + s / 2, y + s / 2); g.lineTo(x - s / 2, y + s / 2); }
      else g.rect(x - s / 2, y - s / 6, s, s / 3);
      g.fill();
    }
    g.strokeStyle = pal[0];
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, h * rnd()); g.lineTo(w, h * rnd());
    g.stroke();
  },
};
