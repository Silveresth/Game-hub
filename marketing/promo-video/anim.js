// Vidéo promo 9:16 « Steal a Masterpiece » — animation déterministe : renderFrame(t) dessine l'image à l'instant t (s).
// 128 BPM : une mesure = 1,875 s ; chaque plan commence sur une mesure (voir music.mjs, mêmes repères).
const W = 1080, H = 1920;
const BPM = 128, BEAT = 60 / BPM, BAR = BEAT * 4;
const DUR = BAR * 16; // 30 s
const cv = document.getElementById('c');
const g = cv.getContext('2d');

// ------------------------------------------------------------------ outils
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, s, d) => clamp((t - s) / d);
const E = {
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inCubic: (k) => k * k * k,
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2),
  outElastic: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
  outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
};
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const nf = new Intl.NumberFormat('fr-FR');
/** 1 au temps fort, puis décroît jusqu'au temps suivant. */
const beatPulse = (t, from = 0) => (t < from ? 0 : Math.exp(-(((t - from) % BEAT) / BEAT) * 7));
const F = {
  title: (size, w = 900) => `${w} ${size}px Cinzel, Georgia, serif`,
  text: (size, w = 800) => `${w} ${size}px "Bricolage Grotesque", "Segoe UI", "Segoe UI Emoji", sans-serif`,
};
const GOLD = ['#fbe4a0', '#e9bd5a', '#a7701f', '#f3cf73', '#b47a26'];
function goldGrad(x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  GOLD.forEach((c, i) => gr.addColorStop(i / (GOLD.length - 1), c));
  return gr;
}
function rainbowGrad(x0, y0, x1, y1, shift = 0) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, `hsl(${(i * 60 + shift * 360) % 360}, 95%, 62%)`);
  return gr;
}

// ------------------------------------------------------------------ ressources
const IMG = {};
const ART = ['joconde', 'nuit-etoilee', 'grande-vague', 'tournesols'];
const SHOTS = ['hero', 'bonk', 'coins2', 'hero2', 'room'];
function loadImg(key, src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => { IMG[key] = i; res(); };
    i.onerror = () => rej(new Error('image ' + src));
    i.src = src;
  });
}
async function loadLogo() {
  let svg = await (await fetch('/logo.svg')).text();
  svg = svg.replace('<svg ', '<svg width="1440" height="1504" ');
  await loadImg('logo', URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
}
window.ready = (async () => {
  await Promise.all([
    document.fonts.load('900 100px Cinzel'),
    document.fonts.load('800 100px "Bricolage Grotesque"'),
    document.fonts.load('700 100px "Bricolage Grotesque"'),
    ...ART.map((a) => loadImg(a, `/art/${a}.jpg`)),
    ...SHOTS.map((s) => loadImg(s, `/shots/${s}.png`)),
    loadLogo(),
  ]);
  return true;
})();

// ------------------------------------------------------------------ dessin de base

/** Texte centré : relief, contour, ombre, dégradé (fill peut être une fonction (taille) => dégradé local). */
function text(str, x, y, o = {}) {
  g.save();
  g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  if (o.scale !== undefined) g.scale(o.scale, o.scale);
  g.globalAlpha *= o.alpha ?? 1;
  g.font = o.font ?? F.text(60);
  g.textAlign = o.align ?? 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const size = parseInt(/(\d+)px/.exec(g.font)[1], 10);
  if (o.extrude) {
    g.fillStyle = g.strokeStyle = o.extrudeColor ?? '#000';
    g.lineWidth = o.strokeWidth ?? 0;
    for (let i = o.extrude; i > 0; i -= 2) {
      if (o.stroke) g.strokeText(str, 0, i);
      g.fillText(str, 0, i);
    }
  }
  if (o.glow) {
    g.shadowColor = o.glow;
    g.shadowBlur = o.glowBlur ?? 40;
  }
  if (o.stroke) {
    g.strokeStyle = o.stroke;
    g.lineWidth = o.strokeWidth ?? 12;
    g.strokeText(str, 0, 0);
    g.shadowColor = 'transparent';
  }
  g.fillStyle = typeof o.fill === 'function' ? o.fill(size) : o.fill ?? '#fff';
  g.fillText(str, 0, 0);
  g.restore();
}

/** Lettres qui tombent une à une avec rebond. */
function kinetic(str, x, y, t0, t, o = {}) {
  g.save();
  g.font = o.font;
  const chars = [...str];
  const sp = o.spacing ?? 0;
  const widths = chars.map((c) => g.measureText(c).width + sp);
  const total = widths.reduce((a, b) => a + b, 0) - sp;
  g.restore();
  let cx = x - total / 2;
  chars.forEach((c, i) => {
    const k = prog(t, t0 + i * (o.stagger ?? 0.035), o.dur ?? 0.42);
    if (k > 0 && c !== ' ') {
      const e = E.outBack(k, 2.4);
      text(c, cx + (widths[i] - sp) / 2, y + (1 - e) * (o.drop ?? -150), { ...o, alpha: clamp(k * 3), scale: lerp(1.5, 1, E.outCubic(k)), rot: (1 - E.outCubic(k)) * (i % 2 ? 0.3 : -0.3) });
    }
    cx += widths[i];
  });
}

/** Mots qui apparaissent un par un (pop), centrés sur une ligne. */
function wordsPop(words, y, t, o = {}) {
  g.save();
  const gap = o.gap ?? 22;
  const fonts = words.map((w) => (w[2] ? F.text((o.size ?? 72) * 1.25) : F.text(o.size ?? 72)));
  const widths = words.map((w, i) => { g.font = fonts[i]; return g.measureText(w[0]).width; });
  g.restore();
  let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1)) / 2;
  words.forEach((w, i) => {
    const k = prog(t, w[1], 0.28);
    if (k > 0) text(w[0], x + widths[i] / 2, y, { font: fonts[i], fill: w[2] ? (s) => goldGrad(0, -s / 2, 0, s / 2) : '#fff', stroke: '#14060c', strokeWidth: 14, extrude: 8, extrudeColor: '#14060c', scale: E.outBack(k, 3), rot: w[2] ? -0.06 : 0 });
    x += widths[i] + gap;
  });
}

function chip(str, x, y, k, o = {}) {
  if (k <= 0) return;
  g.save();
  g.translate(x, y);
  g.rotate(o.rot ?? 0);
  const s = E.outBack(k, 2.2) * (o.scale ?? 1);
  g.scale(s, s);
  g.font = o.font ?? F.text(46);
  const h = o.h ?? 92;
  const w = g.measureText(str).width + (o.padX ?? 44) * 2;
  g.shadowColor = 'rgba(0,0,0,.45)';
  g.shadowBlur = 24;
  g.shadowOffsetY = 10;
  g.fillStyle = typeof o.bg === 'function' ? o.bg(w, h) : o.bg ?? '#fff';
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, h / 2);
  g.fill();
  g.shadowColor = 'transparent';
  if (o.border) {
    g.lineWidth = o.borderW ?? 6;
    g.strokeStyle = typeof o.border === 'function' ? o.border(w, h) : o.border;
    g.stroke();
  }
  g.fillStyle = o.color ?? '#1b1308';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(str, 0, 3);
  g.restore();
}

/** Carte « capture du jeu » : bord blanc arrondi, ombre, zoom lent, renvoie la conversion image → écran. */
function card(img, crop, cx, cy, w, h, o = {}) {
  let [sx, sy, sw, sh] = crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
  const ca = w / h;
  if (sw / sh > ca) { const nw = sh * ca; sx += (sw - nw) / 2; sw = nw; } else { const nh = sw / ca; sy += (sh - nh) / 2; sh = nh; }
  const z = o.zoom ?? 1;
  const zw = sw / z, zh = sh / z;
  const zx = sx + ((sw - zw) / 2) * (1 + (o.panX ?? 0));
  const zy = sy + ((sh - zh) / 2) * (1 + (o.panY ?? 0));
  const rot = o.rot ?? 0, sc = o.scale ?? 1;
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(sc, sc);
  g.globalAlpha *= o.alpha ?? 1;
  const r = o.radius ?? 40, b = o.borderW ?? 12;
  g.shadowColor = 'rgba(0,0,0,.55)';
  g.shadowBlur = 60;
  g.shadowOffsetY = 28;
  g.fillStyle = o.border ?? '#fff';
  g.beginPath();
  g.roundRect(-w / 2 - b, -h / 2 - b, w + 2 * b, h + 2 * b, r + b);
  g.fill();
  g.shadowColor = 'transparent';
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.clip();
  g.drawImage(img, zx, zy, zw, zh, -w / 2, -h / 2, w, h);
  if (o.zoomBlur) {
    // flou de vitesse : copies agrandies et transparentes
    for (let i = 1; i <= o.zoomBlur; i++) {
      const f = 1 + i * 0.022;
      g.globalAlpha = 0.16;
      g.drawImage(img, zx, zy, zw, zh, (-w / 2) * f, (-h / 2) * f, w * f, h * f);
    }
    g.globalAlpha = 1;
  }
  if (o.tint) {
    g.fillStyle = o.tint;
    g.fillRect(-w / 2, -h / 2, w, h);
  }
  g.restore();
  return (px, py) => {
    const lx = ((px - zx) / zw) * w - w / 2, ly = ((py - zy) / zh) * h - h / 2;
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: cx + (lx * c - ly * s) * sc, y: cy + (lx * s + ly * c) * sc };
  };
}

function sparkle(x, y, r, alpha, color = '#fff6d0') {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = r * 0.8;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
  g.restore();
}

/** Pièce d'or qui tourne (aplatie selon l'angle). */
function coin(x, y, r, spin, alpha = 1) {
  const sx = Math.max(0.12, Math.abs(Math.cos(spin)));
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  // tranche
  g.fillStyle = '#9a6413';
  g.beginPath();
  g.ellipse(r * 0.12 * Math.sign(Math.cos(spin) || 1), 0, r * sx, r, 0, 0, Math.PI * 2);
  g.fill();
  const gr = g.createRadialGradient(-r * 0.35 * sx, -r * 0.35, r * 0.1, 0, 0, r);
  gr.addColorStop(0, '#fff3b0');
  gr.addColorStop(0.45, '#ffc93c');
  gr.addColorStop(1, '#c98a14');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(0, 0, r * sx, r, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(140,80,0,.55)';
  g.lineWidth = r * 0.1;
  g.beginPath();
  g.ellipse(0, 0, r * 0.72 * sx, r * 0.72, 0, 0, Math.PI * 2);
  g.stroke();
  if (sx > 0.45) {
    // étoile en relief
    g.fillStyle = 'rgba(150,90,5,.75)';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.2 : r * 0.46;
      g.lineTo(Math.cos(a) * rr * sx, Math.sin(a) * rr);
    }
    g.fill();
  }
  g.restore();
}

function starburst(x, y, rIn, rOut, n, rot, fill, stroke, lw = 8) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n;
    const r = i % 2 ? rIn : rOut;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.lineJoin = 'round';
    g.stroke();
  }
  g.restore();
}

function rays(cx, cy, t, color, alpha, n = 18, speed = 0.12) {
  g.save();
  g.translate(cx, cy);
  g.rotate(t * speed);
  g.globalAlpha = alpha;
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 2400, a, a + Math.PI / n);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function spotlight(x, y, r, color) {
  const gr = g.createRadialGradient(x, y, 20, x, y + r * 0.6, r);
  gr.addColorStop(0, color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

function halftone(color, alpha, step = 34, t = 0) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  const off = (t * 20) % step;
  for (let y = -step; y < H + step; y += step) {
    for (let x = -step; x < W + step; x += step) {
      const r = 3 + 2.2 * Math.sin((x + y) * 0.004 + t);
      g.beginPath();
      g.arc(x + off + ((y / step) % 2) * (step / 2), y + off, Math.max(0.5, r), 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function bgVelvet(t, light = 1) {
  const gr = g.createRadialGradient(W / 2, H * 0.36, 60, W / 2, H * 0.45, H * 0.85);
  gr.addColorStop(0, `rgb(${122 * light},${29 * light},${51 * light})`);
  gr.addColorStop(0.5, '#4a0f1e');
  gr.addColorStop(1, '#14040a');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // motif damassé
  g.save();
  g.globalAlpha = 0.07;
  g.fillStyle = '#ffb3c4';
  for (let y = -1; y < 12; y++) {
    for (let x = -1; x < 7; x++) {
      const px = x * 190 + (Math.abs(y) % 2) * 95;
      const py = y * 190 + ((t * 10) % 190);
      g.beginPath();
      g.ellipse(px, py, 22, 44, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(px, py, 44, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(px, py - 62, 9, 0, Math.PI * 2);
      g.arc(px, py + 62, 9, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function bgNight(t, c0 = '#24123f', c1 = '#07060d') {
  const gr = g.createRadialGradient(W / 2, H * 0.42, 50, W / 2, H * 0.45, H * 0.8);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

/** Cadre de tableau (anneau) : doré, diamant ou arc-en-ciel. Le tableau se dessine avant. */
function frameRing(cx, cy, w, h, th, style, t) {
  const x0 = cx - w / 2 - th, y0 = cy - h / 2 - th, w2 = w + 2 * th, h2 = h + 2 * th;
  g.save();
  let fill;
  if (style === 'rainbow') fill = rainbowGrad(x0, y0, x0 + w2, y0 + h2, t * 0.35);
  else if (style === 'diamond') {
    fill = g.createLinearGradient(x0, y0, x0 + w2, y0 + h2);
    ['#f2fcff', '#9fd8f5', '#ffffff', '#6fb3dd', '#e3f7ff'].forEach((c, i) => fill.addColorStop(i / 4, c));
  } else fill = goldGrad(x0, y0, x0 + w2, y0 + h2);
  if (style === 'rainbow') {
    g.shadowColor = `hsl(${(t * 140) % 360}, 95%, 60%)`;
    g.shadowBlur = 60;
  } else {
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 44;
    g.shadowOffsetY = 22;
  }
  g.fillStyle = fill;
  g.beginPath();
  g.rect(x0, y0, w2, h2);
  g.rect(cx - w / 2, cy - h / 2, w, h);
  g.fill('evenodd');
  g.shadowColor = 'transparent';
  g.shadowOffsetY = 0;
  g.strokeStyle = 'rgba(255,250,225,.6)';
  g.lineWidth = 3;
  g.strokeRect(x0 + 4, y0 + 4, w2 - 8, h2 - 8);
  g.strokeStyle = 'rgba(70,35,0,.35)';
  g.lineWidth = th * 0.16;
  g.strokeRect(cx - w / 2 - th * 0.5, cy - h / 2 - th * 0.5, w + th, h + th);
  g.strokeStyle = 'rgba(255,245,210,.55)';
  g.lineWidth = 4;
  g.strokeRect(cx - w / 2 - 3, cy - h / 2 - 3, w + 6, h + 6);
  if (style === 'gold') {
    for (const [px, py] of [[x0, y0], [x0 + w2, y0], [x0, y0 + h2], [x0 + w2, y0 + h2]]) {
      const rg = g.createRadialGradient(px - th * 0.12, py - th * 0.12, 2, px, py, th * 0.5);
      rg.addColorStop(0, '#fff2c2');
      rg.addColorStop(0.55, '#e2b04d');
      rg.addColorStop(1, '#7d4f12');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(px, py, th * 0.42, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

/** Tableau encadré centré en (cx, cy), largeur w : renvoie sa hauteur. */
function framed(img, cx, cy, w, style, t, th = 44) {
  const h = (w * img.naturalHeight) / img.naturalWidth;
  g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  if (style === 'diamond') {
    // reflet de vitre
    g.save();
    g.beginPath();
    g.rect(cx - w / 2, cy - h / 2, w, h);
    g.clip();
    const gr = g.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
    gr.addColorStop(0.3, 'rgba(255,255,255,0)');
    gr.addColorStop(0.42, 'rgba(255,255,255,.22)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.restore();
  }
  frameRing(cx, cy, w, h, th, style, t);
  return h;
}

function stamp(str, x, y, k, rot, color = '#e0233c') {
  if (k <= 0) return;
  const s = lerp(2.8, 1, E.outCubic(k));
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.globalAlpha = clamp(k * 2.5);
  g.font = F.text(140);
  const w = g.measureText(str).width + 100, h = 200;
  g.shadowColor = 'rgba(0,0,0,.5)';
  g.shadowBlur = 30;
  g.fillStyle = 'rgba(255,244,238,.94)';
  g.beginPath();
  g.roundRect(-w / 2, -h / 2, w, h, 26);
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = color;
  g.lineWidth = 14;
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.roundRect(-w / 2 + 18, -h / 2 + 18, w - 36, h - 36, 14);
  g.stroke();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(str, 0, 8);
  g.restore();
}

function umbrella(x, y, rot, s) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  const cy = -260, R = 175;
  // manche en J
  g.lineCap = 'round';
  g.strokeStyle = '#3b2412';
  g.lineWidth = 18;
  g.beginPath();
  g.moveTo(0, cy);
  g.lineTo(0, 10);
  g.arc(-30, 10, 30, 0, Math.PI, false);
  g.stroke();
  // toile festonnée
  const segs = 6;
  g.beginPath();
  g.arc(0, cy, R, Math.PI, Math.PI * 2);
  for (let i = segs; i > 0; i--) {
    const xa = -R + (i * 2 * R) / segs, xb = -R + ((i - 1) * 2 * R) / segs;
    g.quadraticCurveTo((xa + xb) / 2, cy - 38, xb, cy);
  }
  g.closePath();
  const gr = g.createLinearGradient(-R, cy - R, R, cy);
  gr.addColorStop(0, '#d7b4ff');
  gr.addColorStop(0.5, '#a66bff');
  gr.addColorStop(1, '#6a2fd6');
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#2b1050';
  g.lineJoin = 'round';
  g.stroke();
  // baleines
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 5;
  for (let i = 1; i < segs; i++) {
    const xb = -R + (i * 2 * R) / segs;
    g.beginPath();
    g.moveTo(0, cy - R + 6);
    g.quadraticCurveTo(xb * 0.55, cy - R * 0.55, xb, cy);
    g.stroke();
  }
  // pointe
  g.fillStyle = '#ffd36b';
  g.beginPath();
  g.arc(0, cy - R - 10, 12, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function lasers(t, alarm) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const L = [[-40, 700, W + 40, 1150, 0], [-40, 1260, W + 40, 880, 1.7], [-40, 1060, W + 40, 1330, 3.1]];
  for (const [x0, y0, x1, y1, ph] of L) {
    const wob = Math.sin(t * 1.3 + ph) * 50;
    const a = alarm ? 0.55 + 0.45 * Math.abs(Math.sin(t * 22)) : 0.55 + 0.2 * Math.sin(t * 5 + ph);
    g.shadowColor = '#ff2d55';
    g.shadowBlur = 30;
    g.strokeStyle = `rgba(255,45,85,${0.4 * a})`;
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(x0, y0 + wob);
    g.lineTo(x1, y1 - wob);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = `rgba(255,190,205,${a})`;
    g.lineWidth = 3.5;
    g.stroke();
  }
  g.restore();
}

/** Bandeau d'étape : badge numéroté + mot géant + sous-titre. */
function header(num, word, sub, t, t0, color = '#fff') {
  const k = prog(t, t0 + 0.04, 0.5);
  if (k <= 0) return;
  const s = E.outBack(k, 2.2) * (1 + 0.025 * beatPulse(t, t0 + BEAT));
  g.save();
  g.translate(W / 2, 290);
  g.rotate(-0.035);
  g.scale(s, s);
  g.font = F.text(150);
  const ww = g.measureText(word).width;
  const total = 170 + 30 + ww;
  const bx = -total / 2 + 85;
  g.save();
  g.translate(bx, 4);
  g.rotate(-0.14 + Math.sin(t * 5) * 0.05);
  starburst(0, 0, 76, 94, 16, t * 0.6, '#ffd36b', '#2a1206', 7);
  text(String(num), 0, 8, { font: F.title(104), fill: '#2a1206' });
  g.restore();
  text(word, -total / 2 + 200 + ww / 2, 10, { font: F.text(150), fill: color, stroke: '#12081a', strokeWidth: 18, extrude: 14, extrudeColor: '#12081a' });
  g.restore();
  const k2 = prog(t, t0 + 0.28, 0.4);
  if (k2 > 0) text(sub, W / 2, 445, { font: F.text(50, 700), fill: '#ffe7a8', alpha: clamp(k2 * 2), scale: lerp(0.85, 1, E.outBack(k2)), stroke: 'rgba(20,8,12,.75)', strokeWidth: 10 });
}

function tapHand(x, y, t, taps) {
  let s = 1, ripple = -1;
  for (const tt of taps) {
    if (t >= tt - 0.25 && t < tt + 0.6) {
      const d = t - tt;
      s = d < 0 ? 1 + 0.15 * (d / 0.25 + 1) : 1 - 0.18 * Math.exp(-d * 10);
      if (d >= 0) ripple = d;
    }
  }
  const k = prog(t, taps[0] - 0.45, 0.25);
  if (k <= 0) return;
  if (ripple >= 0 && ripple < 0.5) {
    g.save();
    g.strokeStyle = `rgba(255,255,255,${1 - ripple * 2})`;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(x, y, 30 + ripple * 200, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  text('👆', x + 34, y + 70, { font: F.text(130), scale: s * E.outBack(k), rot: -0.25, glow: 'rgba(0,0,0,.6)', glowBlur: 20 });
}

// ------------------------------------------------------------------ particules (déterministes)

function makeBurst(seed, n, o) {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    a: r() * Math.PI * 2,
    v: o.vMin + r() * (o.vMax - o.vMin),
    spin: r() * 12 - 6,
    size: o.sMin + r() * (o.sMax - o.sMin),
    ph: r() * 10,
    c: r(),
  }));
}
const COIN_BURST = makeBurst(7, 34, { vMin: 900, vMax: 1900, sMin: 26, sMax: 46 });
const CONFETTI = makeBurst(21, 130, { vMin: 900, vMax: 2300, sMin: 14, sMax: 26 });
const RAIN = (() => {
  const r = rng(11);
  return Array.from({ length: 80 }, () => ({ x: r() * W, y0: -120 - r() * 2200, v: 1100 + r() * 900, spin: r() * 10, size: 30 + r() * 26, sw: r() * 6 }));
})();
const SPARKS = (() => {
  const r = rng(5);
  return Array.from({ length: 40 }, () => ({ a: r() * Math.PI * 2, d: 0.55 + r() * 0.6, ph: r() * 6, sp: 2 + r() * 3, s: 14 + r() * 24 }));
})();
const SPEED = (() => {
  const r = rng(17);
  return Array.from({ length: 70 }, () => ({ a: r() * Math.PI * 2, ph: r(), len: 120 + r() * 380, w: 2 + r() * 6 }));
})();

function coinBurst(t, t0, cx, cy) {
  const d = t - t0;
  if (d < 0 || d > 2.4) return;
  for (const p of COIN_BURST) {
    const x = cx + Math.cos(p.a) * p.v * d * 0.55;
    const y = cy + Math.sin(p.a) * p.v * d * 0.55 + 1300 * d * d;
    coin(x, y, p.size, p.spin * d * 3 + p.ph, clamp(1 - (d - 1.6) / 0.8));
  }
}

const CONF_COLORS = ['#ffd36b', '#ff5e62', '#3d8bff', '#4cc38a', '#b46bff', '#ff9f43', '#ffffff'];
function confetti(t, t0, cx, cy) {
  const d = t - t0;
  if (d < 0 || d > 3.8) return;
  for (const p of CONFETTI) {
    const drag = 2.2;
    const f = (1 - Math.exp(-drag * d)) / drag;
    const x = cx + Math.cos(p.a) * p.v * f + Math.sin(d * 3 + p.ph) * 30;
    const y = cy + Math.sin(p.a) * p.v * f * 0.8 - 700 * f + 520 * d * d * 0.6;
    g.save();
    g.translate(x, y);
    g.rotate(p.spin * d + p.ph);
    g.scale(1, Math.cos(d * 8 + p.ph));
    g.fillStyle = CONF_COLORS[Math.floor(p.c * CONF_COLORS.length)];
    g.fillRect(-p.size / 2, -p.size * 0.8, p.size, p.size * 1.6);
    g.restore();
  }
}

function coinRain(t, t0) {
  const d = t - t0;
  if (d < 0) return;
  for (const p of RAIN) {
    const y = p.y0 + p.v * d;
    if (y < -80 || y > H + 80) continue;
    coin(p.x + Math.sin(d * 2 + p.sw) * 30, y, p.size, p.spin + d * 6);
  }
}

function sparkRing(t, cx, cy, rx, ry, colorFn) {
  for (const p of SPARKS) {
    const a = p.a + t * 0.25;
    const x = cx + Math.cos(a) * rx * p.d, y = cy + Math.sin(a) * ry * p.d;
    const tw = Math.pow(Math.max(0, Math.sin(t * p.sp + p.ph)), 3);
    sparkle(x, y, p.s * (0.6 + tw), tw, colorFn ? colorFn(p) : '#fff6d0');
  }
}

// ------------------------------------------------------------------ plans

// 1. Accroche : la Joconde… volée
function sceneHook(t) {
  bgVelvet(t);
  spotlight(W / 2, 220, 1100, 'rgba(255,226,160,0.30)');
  const art = IMG.joconde;
  const cx = W / 2, cy = 960, fw = 540, fh = (fw * art.naturalHeight) / art.naturalWidth;
  const kIn = prog(t, 0, 0.6);
  const s = lerp(0.5, 1, E.outBack(kIn, 1.5)) * (1 + (0.05 * t) / 3.75);
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.translate(-cx, -cy);
  g.globalAlpha = clamp(kIn * 4);
  // toile vide sous le tableau
  const vg = g.createLinearGradient(0, cy - fh / 2, 0, cy + fh / 2);
  vg.addColorStop(0, '#2b0912');
  vg.addColorStop(1, '#12030a');
  g.fillStyle = vg;
  g.fillRect(cx - fw / 2, cy - fh / 2, fw, fh);
  const ky = prog(t, 1.875, 0.24);
  if (ky < 1) {
    g.save();
    g.beginPath();
    g.rect(cx - fw / 2, cy - fh / 2, fw, fh);
    g.clip();
    g.drawImage(art, cx - fw / 2, cy - fh / 2 - E.inCubic(ky) * (fh + 700), fw, fh);
    g.restore();
  } else {
    text('?', cx, cy, { font: F.title(300), fill: 'rgba(255,200,210,.08)' });
  }
  frameRing(cx, cy, fw, fh, 60, 'gold', t);
  g.restore();
  // traînées pendant l'arrachage
  if (ky > 0 && ky < 1) {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = cx - fw / 2 + 40 + (i * (fw - 80)) / 6;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(x, cy - fh / 2 - 40 - ky * 300);
      g.lineTo(x, cy - fh / 2 - 260 - ky * 600);
      g.stroke();
    }
    g.restore();
  }
  lasers(t, t > 1.95);
  // alarme rouge après le vol
  if (t > 1.95) {
    const a = 0.2 * Math.abs(Math.sin((t - 1.95) * 9));
    g.fillStyle = `rgba(255,20,50,${a})`;
    g.fillRect(0, 0, W, H);
  }
  kinetic('LA JOCONDE', cx, 230, 0.12, t, { font: F.title(104), fill: (sz) => goldGrad(0, -sz / 2, 0, sz / 2), stroke: '#2a1206', strokeWidth: 14, extrude: 8, extrudeColor: '#2a1206', stagger: 0.03 });
  const kc = prog(t, 0.35, 1.25);
  if (kc > 0) text(`${nf.format(Math.round(800e6 * E.outExpo(kc)))} 🪙`, cx, 350, { font: F.text(70), fill: '#fff', stroke: '#1b0710', strokeWidth: 12, alpha: clamp(kc * 6), scale: lerp(0.7, 1, E.outBack(clamp(kc * 4))) });
  if (t >= 1.95) stamp('VOLÉE !', cx, cy - 10, prog(t, 1.95, 0.13), -0.2);
  wordsPop([['Et', 2.81], ['si', 2.93], ['c’était', 3.05], ['TOI', 3.16, true]], 1555, t, { size: 76 });
  wordsPop([['le', 3.28], ['voleur', 3.4], ['?', 3.52], ['😏', 3.6]], 1665, t, { size: 76 });
}

// 2. Logo
function sceneLogo(t) {
  const lt = t - 3.75;
  bgNight(t, '#3a1546', '#0a0610');
  rays(W / 2, 760, t, '#ffd36b', 0.09, 18, 0.18);
  halftone('#ffffff', 0.04, 40, t);
  coinBurst(t, 3.75, W / 2, 760);
  const k = prog(t, 3.75, 1.0);
  const s = E.outElastic(k) * (1 + 0.03 * beatPulse(t, 3.75));
  const bob = Math.sin(lt * 3) * 12;
  sparkRing(t, W / 2, 760, 420, 380);
  if (k > 0) {
    g.save();
    g.translate(W / 2, 750 + bob);
    g.rotate(Math.sin(lt * 2.2) * 0.05 * clamp(lt));
    g.scale(s, s);
    g.shadowColor = 'rgba(255,200,90,.55)';
    g.shadowBlur = 80;
    const lw = 500, lh = (lw * 1504) / 1440;
    g.drawImage(IMG.logo, -lw / 2, -lh / 2, lw, lh);
    g.restore();
  }
  kinetic('STEAL A', W / 2, 1120, 3.98, t, { font: F.text(100), fill: '#fff', stroke: '#1b0c22', strokeWidth: 16, extrude: 10, extrudeColor: '#1b0c22', spacing: 6 });
  kinetic('MASTERPIECE', W / 2, 1250, 4.22, t, { font: F.title(112), fill: (sz) => goldGrad(0, -sz / 2, 0, sz / 2), stroke: '#2a1206', strokeWidth: 16, extrude: 12, extrudeColor: '#4a2a08', stagger: 0.03 });
  chip('LE CASSE DU SIÈCLE', W / 2, 1390, prog(t, 4.85, 0.4), { font: F.text(46), bg: (w, h) => goldGrad(-w / 2, -h / 2, w / 2, h / 2), color: '#2a1206', rot: -0.03 });
  const row = [['🏛️ Construis', 6.56], ['🖼️ Collectionne', 6.8], ['🦹 Vole', 7.03]];
  g.save();
  g.font = F.text(40);
  const ws = row.map(([s2]) => g.measureText(s2).width + 64);
  g.restore();
  let x = W / 2 - (ws.reduce((a, b) => a + b, 0) + 24 * 2) / 2;
  row.forEach(([s2, at], i) => {
    chip(s2, x + ws[i] / 2, 1560, prog(t, at, 0.3), { font: F.text(40), padX: 32, h: 84, bg: '#fff', color: '#1b1308', rot: i === 1 ? 0.03 : -0.02 });
    x += ws[i] + 24;
  });
}

// 3. Achète au convoi
function sceneBuy(t) {
  bgNight(t, '#16295c', '#060a18');
  rays(W / 2, 1100, t, '#7fb4ff', 0.06, 14, -0.1);
  halftone('#9fc2ff', 0.05, 36, t);
  header(1, 'ACHÈTE', 'les chefs-d’œuvre du convoi 🚚', t, 7.5);
  const k = prog(t, 7.55, 0.5);
  const cy = lerp(H + 600, 1090, E.outBack(k, 1.3));
  const map = card(IMG.hero, [100, 60, 664, 830], W / 2, cy, 800, 1000, { rot: -0.025, zoom: 1 + 0.12 * prog(t, 7.5, 3.75), panY: 0.3 });
  const truck = map(373, 690);
  tapHand(truck.x, truck.y, t, [8.3, 9.9]);
  chip('26 000 🪙', W / 2 + 250, 690, prog(t, 8.4, 0.3), { font: F.text(64), h: 112, bg: (w, h) => goldGrad(-w / 2, -h / 2, w / 2, h / 2), color: '#2a1206', rot: 0.1, border: '#fff', borderW: 8 });
  chip('🌈 Cadre arc-en-ciel = ×10 !', W / 2, 1640, prog(t, 9.4, 0.3), { font: F.text(50), h: 104, bg: '#fff', color: '#1b1308', border: (w) => rainbowGrad(-w / 2, 0, w / 2, 0, t * 0.5), borderW: 10, rot: -0.03 });
}

// 4. Expose et encaisse
const WALL = [
  { img: 'grande-vague', x: 215, y: 1010, w: 300, style: 'diamond', tag: '+4 500 /s', d: 0 },
  { img: 'tournesols', x: 870, y: 1000, w: 250, style: 'gold', tag: '+12 k /s', d: 0.12 },
  { img: 'nuit-etoilee', x: 540, y: 810, w: 410, style: 'rainbow', tag: '+480 k /s', d: 0.24 },
];
function sceneExpose(t) {
  bgVelvet(t, 0.95);
  spotlight(W / 2, 500, 1000, 'rgba(255,226,160,0.18)');
  header(2, 'EXPOSE', 'et encaisse, même quand tu dors 😴', t, 11.25);
  const tops = [];
  for (const p of WALL) {
    const k = prog(t, 11.4 + p.d, 0.55);
    if (k <= 0) continue;
    const dt = t - (11.4 + p.d);
    const y = lerp(p.y - 900, p.y, E.outBack(k, 1.2));
    g.save();
    g.translate(p.x, y - 260);
    g.rotate(0.22 * Math.exp(-3 * dt) * Math.sin(dt * 8));
    // fil d'accroche
    g.strokeStyle = 'rgba(255,220,150,.6)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-60, 120);
    g.lineTo(0, 0);
    g.lineTo(60, 120);
    g.stroke();
    const h = framed(IMG[p.img], 0, 260, p.w, p.style, t, p.style === 'rainbow' ? 40 : 30);
    g.restore();
    tops.push({ p, x: p.x, y: y - h / 2 - 40 });
    if (p.style === 'rainbow') sparkRing(t, p.x, y, 330, 250, (q) => `hsl(${(q.ph * 60 + t * 120) % 360},95%,75%)`);
  }
  // revenus qui s'envolent et pièces qui rejoignent la caisse
  const panel = { x: W / 2, y: 1450 };
  for (let n = 0; n < 7; n++) {
    const tt = 11.95 + n * BEAT;
    const src = tops[n % tops.length];
    if (!src) continue;
    const d = t - tt;
    if (d > 0 && d < 1.0) text(src.p.tag, src.x, src.y - d * 120, { font: F.text(54), fill: '#7dff9a', stroke: '#0b2a14', strokeWidth: 10, alpha: clamp(1.3 - d * 1.3), scale: lerp(0.6, 1, E.outBack(clamp(d * 4))) });
    if (d > 0 && d < 0.55) {
      const k = d / 0.55;
      const x = lerp(src.x, panel.x - 300, k), y = lerp(src.y + 120, panel.y, k) - Math.sin(k * Math.PI) * 220;
      coin(x, y, 30, d * 14);
    }
  }
  // caisse
  const kp = prog(t, 11.7, 0.4);
  if (kp > 0) {
    const bump = 1 + 0.05 * beatPulse(t, 11.95 + 0.55);
    g.save();
    g.translate(panel.x, panel.y);
    g.scale(E.outBack(kp) * bump, E.outBack(kp) * bump);
    g.shadowColor = 'rgba(0,0,0,.6)';
    g.shadowBlur = 40;
    g.fillStyle = 'rgba(12,10,22,.92)';
    g.beginPath();
    g.roundRect(-430, -105, 860, 210, 50);
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = goldGrad(-430, -105, 430, 105);
    g.lineWidth = 7;
    g.stroke();
    coin(-320, 0, 64, t * 3);
    text('TA CAISSE', 50, -52, { font: F.text(34, 700), fill: '#e8b64c' });
    const v = 500 + (12_480_000 - 500) * Math.pow(prog(t, 11.8, 3.0), 2.2);
    text(nf.format(Math.floor(v)), 50, 24, { font: F.text(104), fill: '#fff' });
    g.restore();
  }
}

// 5. Vole
function sceneSteal(t) {
  bgVelvet(t, 0.85);
  header(3, 'VOLE', 'les chefs-d’œuvre de tes rivaux 🦹', t, 15, '#ff6b6b');
  const art = IMG['grande-vague'];
  const kp = prog(t, 15.3, 1.5);
  const kf = prog(t, 16.875, 1.5);
  const k0 = prog(t, 15.05, 0.4);
  // trajet vers la maison (courbe de Bézier)
  const P0 = { x: W / 2, y: 930 }, P1 = { x: W / 2 + 520, y: 700 }, P2 = { x: 860, y: 1560 };
  const bez = (k) => ({ x: (1 - k) * (1 - k) * P0.x + 2 * (1 - k) * k * P1.x + k * k * P2.x, y: (1 - k) * (1 - k) * P0.y + 2 * (1 - k) * k * P1.y + k * k * P2.y });
  if (kf > 0) {
    // chemin pointillé
    g.save();
    g.setLineDash([22, 22]);
    g.lineDashOffset = -t * 120;
    g.strokeStyle = 'rgba(255,230,160,.8)';
    g.lineWidth = 8;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const q = bez(i / 40);
      i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y);
    }
    g.stroke();
    g.restore();
    text('🏛️', P2.x, P2.y + 30, { font: F.text(150), scale: E.outBack(prog(t, 16.95, 0.35)) * (1 + 0.06 * beatPulse(t, 17.34)) });
  }
  const e = E.inOutCubic(kf);
  const pos = bez(e * 0.92);
  const scale = lerp(1, 0.42, e);
  const jig = kp > 0 && kp < 1 ? Math.sin(t * 70) * 0.025 * kp : 0;
  g.save();
  g.translate(pos.x, pos.y);
  g.rotate(jig + e * 0.3);
  g.scale(scale * E.outBack(k0), scale * E.outBack(k0));
  framed(art, 0, 0, 640, 'diamond', t, 36);
  g.restore();
  if (kf > 0) text('🦹', pos.x, pos.y + 250 * scale + 70, { font: F.text(150), rot: Math.sin(t * 16) * 0.1 });
  // le garde qui court derrière
  const kg = prog(t, 17.3, 1.45);
  if (kg > 0) {
    const gp = bez(E.inOutCubic(kg) * 0.75);
    text('👮', gp.x - 40, gp.y + 140, { font: F.text(130), rot: Math.sin(t * 18) * 0.12 });
    if (Math.sin(t * 20) > 0) text('!', gp.x + 40, gp.y + 40, { font: F.text(80), fill: '#ffd36b', stroke: '#000', strokeWidth: 8 });
  }
  // décrochage : anneau de progression
  if (t < 17.05) {
    const ka = prog(t, 15.25, 0.3) * (1 - prog(t, 16.85, 0.2));
    g.save();
    g.globalAlpha = ka;
    g.translate(W / 2, 1460);
    g.fillStyle = 'rgba(10,10,20,.88)';
    g.beginPath();
    g.arc(0, 0, 100, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.15)';
    g.lineWidth = 18;
    g.beginPath();
    g.arc(0, 0, 80, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = '#ffd36b';
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, 0, 80, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * kp);
    g.stroke();
    text('E', 0, 4, { font: F.text(80), fill: '#fff' });
    g.restore();
    text(`Décrochage… ${Math.round(kp * 100)} %`, W / 2, 1625, { font: F.text(54), fill: '#fff', stroke: '#14060c', strokeWidth: 12, alpha: ka });
  }
  // alarme
  if (t > 16.875) {
    const red = Math.floor((t - 16.875) / (BEAT / 2)) % 2 === 0;
    g.fillStyle = red ? 'rgba(255,30,60,.2)' : 'rgba(40,90,255,.16)';
    g.fillRect(0, 0, W, H);
    for (const [bx, col] of [[90, red ? '#ff2d55' : '#2d6bff'], [W - 90, red ? '#2d6bff' : '#ff2d55']]) {
      const gr = g.createRadialGradient(bx, 120, 10, bx, 120, 420);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.55;
      g.fillStyle = gr;
      g.fillRect(0, 0, W, 700);
      g.globalAlpha = 1;
    }
    stamp('AU VOLEUR !', W / 2, 640, prog(t, 16.95, 0.13), 0.1);
    chip('Ramène-la chez toi sans te faire toucher !', W / 2, 1720, prog(t, 17.55, 0.3), { font: F.text(38), h: 86, padX: 34, bg: '#fff', color: '#1b1308', rot: -0.02 });
  }
}

// 6. Bonk
function sceneBonk(t) {
  bgNight(t, '#2b145a', '#08051a');
  rays(W / 2, 1000, t, '#b46bff', 0.1, 16, 0.25);
  halftone('#d9b8ff', 0.06, 34, t);
  const k = prog(t, 18.75, 0.22);
  const map = card(IMG.bonk, [0, 200, 864, 880], W / 2, 1060, 840, 856, { scale: lerp(1.25, 1, E.outCubic(k)), alpha: clamp(k * 3), rot: 0.02, zoom: 1 + 0.06 * prog(t, 18.75, 1.9) });
  const hand = map(335, 625);
  const head = map(690, 355);
  const sw = prog(t, 18.78, 0.17);
  let rot;
  if (t < 18.95) rot = lerp(-1.5, 1.2, E.inCubic(sw));
  else {
    const d = t - 18.95;
    rot = 1.2 - 0.35 * Math.exp(-6 * d) * Math.sin(d * 22);
  }
  if (t >= 18.95) {
    const d = t - 18.95;
    starburst(head.x, head.y - 30, 70 + d * 120, 150 + d * 260, 12, d, `rgba(255,211,107,${clamp(1 - d * 1.6)})`, null);
    for (let i = 0; i < 4; i++) {
      const a = d * 7 + (i * Math.PI) / 2;
      text('⭐', head.x + Math.cos(a) * 110, head.y - 120 + Math.sin(a) * 34, { font: F.text(54), alpha: clamp(1.6 - d) });
    }
  }
  umbrella(hand.x, hand.y, rot, 0.95);
  const kb = prog(t, 18.95, 0.16);
  if (kb > 0) {
    starburst(W / 2, 420, 170, 250, 14, t * 0.4, '#ffd36b', '#2a1206', 10);
    text('BONK !', W / 2, 425, { font: F.text(190), fill: (sz) => { const gr = g.createLinearGradient(0, -sz / 2, 0, sz / 2); gr.addColorStop(0, '#e2c8ff'); gr.addColorStop(1, '#8b4dff'); return gr; }, stroke: '#2b1050', strokeWidth: 20, extrude: 14, extrudeColor: '#2b1050', scale: lerp(3, 1, E.outBack(kb, 2)) * (1 + 0.04 * beatPulse(t, 18.95)), rot: -0.08 });
  } else {
    text('☂', W / 2, 420, { font: F.text(200), alpha: prog(t, 18.75, 0.1) });
  }
  chip('☂ Touche F', W / 2, 1600, prog(t, 19.2, 0.3), { font: F.text(54), h: 104, bg: (w, h) => goldGrad(-w / 2, -h / 2, w / 2, h / 2), color: '#2a1206', rot: -0.04 });
  const kc = prog(t, 19.4, 0.3);
  if (kc > 0) text('le voleur lâche ton œuvre !', W / 2, 1715, { font: F.text(50), fill: '#fff', stroke: '#14060c', strokeWidth: 12, scale: E.outBack(kc) });
}

// 7. Admin abuse : bandeau commun
function adminBanner(t) {
  const k = prog(t, 20.625, 0.22);
  if (k <= 0) return;
  g.save();
  g.translate(W / 2, 255);
  g.rotate(-0.05);
  const s = lerp(2.4, 1, E.outCubic(k)) * (1 + 0.035 * beatPulse(t, 20.625));
  g.scale(s, s);
  g.globalAlpha = clamp(k * 3);
  // ruban « attention » jaune et noir
  g.save();
  g.beginPath();
  g.rect(-760, -92, 1520, 184);
  g.clip();
  g.fillStyle = '#ffd400';
  g.fillRect(-760, -92, 1520, 184);
  g.fillStyle = '#111';
  const off = (t * 260) % 120;
  for (let x = -900; x < 900; x += 120) {
    g.beginPath();
    g.moveTo(x + off, -92);
    g.lineTo(x + off + 60, -92);
    g.lineTo(x + off - 124, 92);
    g.lineTo(x + off - 184, 92);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = '#0b0b12';
  g.beginPath();
  g.roundRect(-430, -70, 860, 140, 22);
  g.fill();
  const glitch = Math.sin(t * 37) > 0.75 || t - 20.625 < 0.25;
  if (glitch) {
    text('ADMIN ABUSE', -7, 4, { font: F.text(110), fill: 'rgba(255,40,80,.85)' });
    text('ADMIN ABUSE', 7, 4, { font: F.text(110), fill: 'rgba(40,230,255,.85)' });
  }
  text('ADMIN ABUSE', 0, 4, { font: F.text(110), fill: () => rainbowGrad(-400, 0, 400, 0, t * 0.6) });
  g.restore();
}

function sceneRain(t) {
  bgNight(t, '#3b2a06', '#0c0803');
  rays(W / 2, 1000, t, '#ffd36b', 0.1, 20, 0.2);
  const k = prog(t, 20.65, 0.35);
  card(IMG.coins2, null, W / 2, 1010, 760, 950, { scale: E.outBack(k, 1.4), rot: -0.025, zoom: 1 + 0.1 * prog(t, 20.625, 1.875) });
  coinRain(t, 20.68);
  chip('💰 PLUIE D’OR', W / 2, 1600, prog(t, 20.85, 0.3), { font: F.text(72), h: 130, padX: 54, bg: (w, h) => goldGrad(-w / 2, -h / 2, w / 2, h / 2), color: '#2a1206', rot: -0.04, border: '#fff', borderW: 8 });
  const kc = prog(t, 21.15, 0.3);
  if (kc > 0) text('ramasse tout sur la place !', W / 2, 1725, { font: F.text(48), fill: '#fff', stroke: '#1b1004', strokeWidth: 12, scale: E.outBack(kc) });
}

function sceneRainbow(t) {
  bgNight(t, '#1d1240', '#05040c');
  g.save();
  g.translate(W / 2, 900);
  g.rotate(t * 0.15);
  for (let i = 0; i < 24; i++) {
    g.fillStyle = `hsla(${i * 15 + t * 60}, 95%, 60%, .13)`;
    g.beginPath();
    g.moveTo(0, 0);
    const a = (i / 24) * Math.PI * 2;
    g.arc(0, 0, 2400, a, a + Math.PI / 24);
    g.closePath();
    g.fill();
  }
  g.restore();
  const k = prog(t, 22.52, 0.45);
  const art = IMG['nuit-etoilee'];
  g.save();
  g.translate(W / 2, 880);
  g.rotate(Math.sin((t - 22.5) * 3) * 0.03);
  g.scale(E.outBack(k, 1.6), E.outBack(k, 1.6));
  framed(art, 0, 0, 760, 'rainbow', t, 56);
  g.restore();
  sparkRing(t, W / 2, 880, 560, 440, (q) => `hsl(${(q.ph * 60 + t * 140) % 360},95%,78%)`);
  const kx = prog(t, 22.78, 0.3);
  if (kx > 0) text('×10', W / 2, 1400, { font: F.text(250), fill: () => rainbowGrad(-260, 0, 260, 0, t * 0.7), stroke: '#fff', strokeWidth: 16, extrude: 16, extrudeColor: '#1b0c30', scale: E.outBack(kx, 3) * (1 + 0.05 * beatPulse(t, 22.78)), rot: -0.06 });
  chip('🌈 CADRE ARC-EN-CIEL', W / 2, 1640, prog(t, 23.0, 0.3), { font: F.text(58), h: 116, padX: 46, bg: '#fff', color: '#1b1308', border: (w) => rainbowGrad(-w / 2, 0, w / 2, 0, t * 0.5), borderW: 12, rot: 0.03 });
}

function sceneSpeed(t) {
  bgNight(t, '#0b3f7a', '#03081a');
  // traits de vitesse
  const cx = W / 2, cy = 1010;
  g.save();
  g.lineCap = 'round';
  for (const p of SPEED) {
    const ph = (p.ph + (t - 24.375) * 2.4) % 1;
    const r0 = 200 + ph * 1400;
    g.strokeStyle = `rgba(190,240,255,${0.5 * (1 - ph)})`;
    g.lineWidth = p.w;
    g.beginPath();
    g.moveTo(cx + Math.cos(p.a) * r0, cy + Math.sin(p.a) * r0);
    g.lineTo(cx + Math.cos(p.a) * (r0 + p.len), cy + Math.sin(p.a) * (r0 + p.len));
    g.stroke();
  }
  g.restore();
  const k = prog(t, 24.4, 0.3);
  const jx = Math.sin(t * 61) * 6, jy = Math.cos(t * 47) * 6;
  card(IMG.hero2, null, cx + jx, cy + jy, 760, 950, { scale: lerp(1.3, 1, E.outCubic(k)), alpha: clamp(k * 3), rot: 0.025, zoom: 1 + 0.3 * prog(t, 24.375, 1.875), zoomBlur: 6 });
  text('⚡', 175, 560, { font: F.text(170), rot: -0.2, scale: E.outBack(prog(t, 24.55, 0.3)) * (1 + 0.1 * beatPulse(t, 24.375)) });
  chip('+60 %', W - 200, 590, prog(t, 24.75, 0.3), { font: F.text(70), h: 124, bg: '#5ee7ff', color: '#03243a', rot: 0.12, border: '#fff', borderW: 8 });
  chip('⚡ SUPER VITESSE', W / 2, 1600, prog(t, 24.6, 0.3), { font: F.text(70), h: 128, padX: 50, bg: '#5ee7ff', color: '#03243a', rot: -0.04, border: '#fff', borderW: 8 });
  const kc = prog(t, 25.0, 0.3);
  if (kc > 0) text('chaque soir à 21 h, un événement surprise 🎉', W / 2, 1725, { font: F.text(40), fill: '#fff', stroke: '#02101e', strokeWidth: 10, scale: E.outBack(kc) });
}

// 8. Appel à l'action
function sceneCta(t) {
  bgVelvet(t);
  rays(W / 2, 560, t, '#ffd36b', 0.12, 20, 0.15);
  confetti(t, 26.25, W / 2, 700);
  const k = prog(t, 26.3, 0.9);
  if (k > 0) {
    g.save();
    g.translate(W / 2, 520 + Math.sin(t * 3) * 10);
    const s = E.outElastic(k) * (1 + 0.03 * beatPulse(t, 26.25));
    g.scale(s, s);
    g.shadowColor = 'rgba(255,200,90,.6)';
    g.shadowBlur = 70;
    const lw = 380, lh = (lw * 1504) / 1440;
    g.drawImage(IMG.logo, -lw / 2, -lh / 2, lw, lh);
    g.restore();
  }
  sparkRing(t, W / 2, 520, 330, 300);
  kinetic('STEAL A', W / 2, 820, 26.4, t, { font: F.text(84), fill: '#fff', stroke: '#1b0c22', strokeWidth: 14, extrude: 8, extrudeColor: '#1b0c22', spacing: 6, stagger: 0.025 });
  kinetic('MASTERPIECE', W / 2, 930, 26.55, t, { font: F.title(100), fill: (sz) => goldGrad(0, -sz / 2, 0, sz / 2), stroke: '#2a1206', strokeWidth: 14, extrude: 10, extrudeColor: '#4a2a08', stagger: 0.025 });
  // bouton
  const kb = prog(t, 26.9, 0.4);
  if (kb > 0) {
    const s = E.outBack(kb, 2) * (1 + 0.05 * beatPulse(t, 26.25));
    g.save();
    g.translate(W / 2, 1150);
    g.scale(s, s);
    g.shadowColor = 'rgba(255,190,70,.7)';
    g.shadowBlur = 60;
    g.fillStyle = goldGrad(-430, -85, 430, 85);
    g.beginPath();
    g.roundRect(-430, -85, 860, 170, 85);
    g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#fff6d6';
    g.lineWidth = 6;
    g.stroke();
    // reflet qui balaie le bouton
    g.save();
    g.clip();
    const sx = -700 + (((t - 26.9) * 900) % 1800);
    const gr = g.createLinearGradient(sx - 120, 0, sx + 120, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-430, -85, 860, 170);
    g.restore();
    text('JOUE GRATUITEMENT', 0, 6, { font: F.text(68), fill: '#2a1206' });
    g.restore();
  }
  tapHand(W / 2 + 365, 1185, t, [27.45, 28.85]);
  const row = [['🖥️ Navigateur', 27.2], ['📱 Android', 27.35], ['🆓 Gratuit', 27.5]];
  g.save();
  g.font = F.text(40);
  const ws = row.map(([s2]) => g.measureText(s2).width + 64);
  g.restore();
  let x = W / 2 - (ws.reduce((a, b) => a + b, 0) + 22 * 2) / 2;
  row.forEach(([s2, at], i) => {
    chip(s2, x + ws[i] / 2, 1360, prog(t, at, 0.3), { font: F.text(40), padX: 32, h: 84, bg: 'rgba(255,255,255,.95)', color: '#1b1308' });
    x += ws[i] + 22;
  });
  const ke = prog(t, 27.75, 0.3);
  if (ke > 0) text('🎉 Événement surprise chaque soir à 21 h', W / 2, 1490, { font: F.text(44, 700), fill: '#fff', stroke: '#14060c', strokeWidth: 10, scale: E.outBack(ke) });
  chip('🔗 Lien en bio', W / 2, 1640, prog(t, 28.2, 0.3), { font: F.text(56), h: 112, padX: 48, bg: (w, h) => goldGrad(-w / 2, -h / 2, w / 2, h / 2), color: '#2a1206', rot: -0.03, border: '#fff', borderW: 8, scale: 1 + 0.05 * beatPulse(t, 28.125) });
}

// ------------------------------------------------------------------ montage

const SCENES = [
  [0, sceneHook], [3.75, sceneLogo], [7.5, sceneBuy], [11.25, sceneExpose], [15, sceneSteal],
  [18.75, sceneBonk], [20.625, sceneRain], [22.5, sceneRainbow], [24.375, sceneSpeed], [26.25, sceneCta],
];
const SHAKES = [[1.95, 30, 0.45], [3.75, 16, 0.3], [16.9, 18, 0.4], [18.95, 36, 0.5], [20.625, 26, 0.4], [22.78, 14, 0.3], [26.25, 18, 0.35]];
const WIPES = [7.5, 11.25, 15, 18.75, 22.5, 24.375];
const FLASHES = [[3.75, 1], [20.625, 0.75], [26.25, 0.8], [1.95, 0.35]];

function shake(t) {
  let x = 0, y = 0;
  SHAKES.forEach(([t0, a, d], i) => {
    const k = (t - t0) / d;
    if (k < 0 || k > 1) return;
    const e = a * Math.pow(1 - k, 2);
    x += e * Math.sin(t * 95 + i * 3);
    y += e * Math.cos(t * 83 + i * 7);
  });
  return [x, y];
}

function wipes(t) {
  const D = 0.36;
  for (const c of WIPES) {
    const p = (t - (c - 0.59 * D)) / D;
    if (p <= 0 || p >= 1) continue;
    const cols = ['#ffd36b', '#ff5e62', '#b46bff', '#0d0b18'];
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.35);
    cols.forEach((col, i) => {
      const pp = clamp((p - i * 0.06) / 0.82);
      const x = lerp(-2700, 2700, E.inOutCubic(pp));
      g.fillStyle = col;
      g.fillRect(x - 1300, -1900, 2600, 3800);
    });
    g.restore();
  }
}

function vignette() {
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,.45)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

function renderFrame(t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  let idx = 0;
  SCENES.forEach(([s], i) => { if (t >= s) idx = i; });
  const [sx, sy] = shake(t);
  g.save();
  g.translate(W / 2 + sx, H / 2 + sy);
  g.scale(1.03, 1.03); // marge pour les secousses
  g.translate(-W / 2, -H / 2);
  SCENES[idx][1](t);
  if (t >= 20.625 && t < 26.25) adminBanner(t);
  g.restore();
  vignette();
  wipes(t);
  for (const [t0, a] of FLASHES) {
    const before = prog(t, t0 - 0.08, 0.08), after = 1 - prog(t, t0, 0.28);
    const al = t < t0 ? before * a : after * a;
    if (al > 0.001) {
      g.fillStyle = t0 === 1.95 ? `rgba(255,40,60,${al})` : `rgba(255,255,255,${al})`;
      g.fillRect(0, 0, W, H);
    }
  }
  // fondu de fin (la vidéo boucle sur l'accroche)
  const fo = prog(t, DUR - 0.25, 0.25);
  if (fo > 0) {
    g.fillStyle = `rgba(0,0,0,${fo})`;
    g.fillRect(0, 0, W, H);
  }
}

window.renderFrame = renderFrame;
window.DURATION = DUR;
window.contactSheet = (times, cols = 4, tw = 270) => {
  const th = (tw * 16) / 9;
  const rows = Math.ceil(times.length / cols);
  const sh = document.createElement('canvas');
  sh.width = cols * tw;
  sh.height = rows * (th + 30);
  const sg = sh.getContext('2d');
  sg.fillStyle = '#222';
  sg.fillRect(0, 0, sh.width, sh.height);
  times.forEach((t, i) => {
    renderFrame(t);
    const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 30);
    sg.drawImage(cv, x, y, tw, th);
    sg.fillStyle = '#fff';
    sg.font = 'bold 20px sans-serif';
    sg.fillText(`${t.toFixed(2)} s`, x + 8, y + th + 22);
  });
  return sh.toDataURL('image/jpeg', 0.85);
};
