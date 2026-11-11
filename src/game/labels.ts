import * as THREE from 'three';

export interface LabelLine {
  text: string;
  color?: string;
  size?: number; // px dans le canvas
  weight?: number;
}

/**
 * Étiquette 3D toujours face caméra (sprite) dessinée sur un canvas.
 * `update` redessine sans recréer la texture.
 */
export class Label {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private key = '';

  constructor(worldHeight = 0.6, pxWidth = 512, pxHeight = 128) {
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: true, transparent: true }));
    this.sprite.scale.set((worldHeight * pxWidth) / pxHeight, worldHeight, 1);
    this.sprite.renderOrder = 10;
  }

  update(lines: LabelLine[], opts: { bg?: string; border?: string } = {}): void {
    const key = JSON.stringify([lines, opts]);
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d')!;
    const { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);
    const total = lines.reduce((s, l) => s + (l.size ?? 40) * 1.18, 0);
    if (opts.bg) {
      g.font = `${lines[0]?.weight ?? 800} ${lines[0]?.size ?? 40}px 'Segoe UI', system-ui, sans-serif`;
      const width = Math.min(w - 8, Math.max(...lines.map((l) => { g.font = `${l.weight ?? 700} ${l.size ?? 40}px 'Segoe UI', system-ui, sans-serif`; return g.measureText(l.text).width; })) + 48);
      const bh = Math.min(h - 8, total + 24);
      g.fillStyle = opts.bg;
      g.strokeStyle = opts.border ?? 'rgba(255,255,255,.25)';
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect((w - width) / 2, (h - bh) / 2, width, bh, 22);
      g.fill();
      g.stroke();
    }
    let y = (h - total) / 2;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const l of lines) {
      const size = l.size ?? 40;
      g.font = `${l.weight ?? 700} ${size}px 'Segoe UI', system-ui, sans-serif`;
      g.lineWidth = Math.max(4, size / 7);
      g.strokeStyle = 'rgba(0,0,0,.7)';
      g.strokeText(l.text, w / 2, y + size * 0.09, w - 16);
      g.fillStyle = l.color ?? '#fff';
      g.fillText(l.text, w / 2, y + size * 0.09, w - 16);
      y += size * 1.18;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}
