export type Action = 'action' | 'alt' | 'jump';

// (Entrée ouvre la discussion du quartier : elle ne sert plus d'action)
const ACTION_KEYS: Record<string, Action> = { KeyE: 'action', KeyR: 'alt', Space: 'jump' };

/**
 * Entrées : clavier (positions physiques → ZQSD sur AZERTY, WASD sur QWERTY), joystick virtuel et boutons tactiles.
 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private stick = { x: 0, y: 0 };
  enabled = true;

  constructor() {
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat && ACTION_KEYS[e.code]) this.pressed.add(ACTION_KEYS[e.code]);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.setupJoystick();
    document.querySelectorAll<HTMLElement>('[data-action]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pressed.add(b.dataset.action as Action);
        if (b.dataset.action === 'action') this.touchHeld = true;
      });
      const up = () => {
        if (b.dataset.action === 'action') this.touchHeld = false;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  /** x = droite, y = avant ; |v| ≤ 1. */
  axis(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    const k = (...c: string[]) => (c.some((x) => this.keys.has(x)) ? 1 : 0);
    let x = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + this.stick.x;
    let y = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Course : touche Maj, ou joystick poussé à fond. */
  running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.92;
  }

  /** Touche d'action maintenue (pour décrocher une œuvre) : E au clavier ou bouton tactile appuyé. */
  holdingAction(): boolean {
    return this.enabled && (this.keys.has('KeyE') || this.touchHeld);
  }

  private touchHeld = false;

  consume(a: Action): boolean {
    const had = this.enabled && this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  private setupJoystick(): void {
    const base = document.getElementById('joy');
    const knob = document.getElementById('joyKnob');
    if (!base || !knob) return;
    let id: number | null = null;
    const R = 50;
    const move = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick = { x: dx / R, y: -dy / R };
    };
    base.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      base.setPointerCapture(e.pointerId);
      move(e);
    });
    base.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
}
