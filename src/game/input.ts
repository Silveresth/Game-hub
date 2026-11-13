export type Action = 'action' | 'alt' | 'jump';

// (Entrée ouvre la discussion du quartier : elle ne sert plus d'action)
const ACTION_KEYS: Record<string, Action> = { KeyE: 'action', KeyR: 'alt', Space: 'jump' };

/** Joystick : au-delà de cette inclinaison, le personnage court (avant : 0,92, presque impossible au pouce). */
const RUN_STICK = 0.6;

/**
 * Entrées : clavier (positions physiques → ZQSD sur AZERTY, WASD sur QWERTY), joystick tactile flottant et boutons.
 *  - clavier : on court par défaut, Maj maintenue pour marcher ;
 *  - tactile : le joystick apparaît là où le pouce se pose (moitié gauche de l'écran), et court quand on le pousse loin.
 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private stick = { x: 0, y: 0 };
  enabled = true;
  /** Moment (performance.now) du dernier appui sur Saut : un saut demandé juste avant d'atterrir compte quand même. */
  jumpAt = -1;

  constructor() {
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat && ACTION_KEYS[e.code]) this.press(ACTION_KEYS[e.code]);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.setupJoystick();
    document.querySelectorAll<HTMLElement>('[data-action]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.press(b.dataset.action as Action);
        if (b.dataset.action === 'action') this.touchHeld = true;
        b.classList.add('down');
      });
      const up = () => {
        if (b.dataset.action === 'action') this.touchHeld = false;
        b.classList.remove('down');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  private press(a: Action): void {
    this.pressed.add(a);
    if (a === 'jump') this.jumpAt = performance.now();
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

  /** Course : par défaut au clavier (Maj = marcher), joystick poussé au-delà de 60 % au tactile. */
  running(): boolean {
    if (Math.hypot(this.stick.x, this.stick.y) > 0.05) return Math.hypot(this.stick.x, this.stick.y) > RUN_STICK;
    return !(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
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

  /** Joystick flottant : la zone couvre la moitié gauche de l'écran ; la base se place sous le pouce. */
  private setupJoystick(): void {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joy');
    const knob = document.getElementById('joyKnob');
    if (!zone || !base || !knob) return;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const R = 52;
    const move = (e: PointerEvent) => {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // petite zone morte au centre, puis réponse progressive
      const m = Math.min(1, len / R);
      const k = m < 0.12 ? 0 : (m - 0.12) / 0.88 / Math.max(m, 1e-6);
      this.stick = { x: (dx / R) * k, y: (-dy / R) * k };
      base.classList.toggle('run', Math.hypot(this.stick.x, this.stick.y) > RUN_STICK);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      // la base se pose sous le pouce, sans déborder de l'écran
      cx = Math.max(R + 8, Math.min(innerWidth - R - 8, e.clientX));
      cy = Math.max(R + 8, Math.min(innerHeight - R - 8, e.clientY));
      base.style.left = `${cx - r.width / 2}px`;
      base.style.top = `${cy - r.height / 2}px`;
      base.style.bottom = 'auto';
      base.classList.add('active');
      move(e);
    });
    zone.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
      base.classList.remove('active', 'run');
      base.style.left = '';
      base.style.top = '';
      base.style.bottom = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
