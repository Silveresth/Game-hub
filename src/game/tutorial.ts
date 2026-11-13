// Tutoriel interactif du premier lancement : chaque étape se valide en la faisant (bouger, tourner la caméra,
// courir et sauter, acheter au convoi, accrocher, encaisser, inventaire, Lucky coffres).
// Une flèche 3D (gérée par main.ts) montre où aller : `target()`.

export interface TutoFacts {
  moved: number; // mètres parcourus depuis le début de l'étape
  camTurn: number; // rotation de caméra faite par le joueur (radians cumulés)
  jumps: number;
  runTime: number; // secondes passées à courir
  owned: number;
  shown: number;
  holding: boolean; // une œuvre en mains
  collected: number;
  inventoryOpened: boolean;
  shopOpened: boolean;
}

type Target = 'truck' | 'museum' | 'register' | null;

interface Step {
  id: string;
  icon: string;
  title: string;
  desktop: string;
  touch: string;
  target?: Target;
  /** Étape déjà faite au moment où elle arrive (joueur expérimenté) : on la saute. */
  skip?: (f: TutoFacts) => boolean;
  done: (f: TutoFacts, base: TutoFacts) => boolean;
  highlight?: string;
  manual?: boolean;
}

const STEPS: Step[] = [
  {
    id: 'move', icon: '🕹', title: 'Déplacez-vous',
    desktop: 'Touches <kbd>Z Q S D</kbd> (ou <kbd>W A S D</kbd>, flèches). Vous courez automatiquement ; maintenez <kbd>Maj</kbd> pour marcher.',
    touch: 'Posez le pouce n’importe où sur la <b>moitié gauche</b> de l’écran et glissez : le joystick apparaît sous votre doigt.',
    done: (f, b) => f.moved - b.moved > 6,
  },
  {
    id: 'camera', icon: '🎥', title: 'Tournez la caméra',
    desktop: '<b>Cliquez et glissez</b> avec la souris (bouton gauche ou droit). Molette : zoomer. La caméra se replace aussi toute seule derrière vous quand vous avancez.',
    touch: '<b>Glissez un doigt</b> sur la moitié droite de l’écran. Deux doigts pour zoomer.',
    done: (f, b) => f.camTurn - b.camTurn > 1.1,
  },
  {
    id: 'jump', icon: '🦘', title: 'Courez et sautez',
    desktop: '<kbd>Espace</kbd> pour sauter, deux fois pour un double saut.',
    touch: 'Joystick poussé loin = course. Bouton <b>⤒</b> pour sauter (deux fois : double saut).',
    done: (f, b) => f.jumps - b.jumps >= 2,
  },
  {
    id: 'buy', icon: '🚚', title: 'Achetez une œuvre au convoi',
    desktop: 'Un camion passe toutes les 8 s sur la route. Approchez-vous (la flèche dorée vous guide) et appuyez sur <kbd>E</kbd>.',
    touch: 'Un camion passe toutes les 8 s. Approchez-vous (flèche dorée) et touchez le bouton doré <b>E</b>.',
    target: 'truck',
    skip: (f) => f.owned > 0,
    done: (f, b) => f.owned > b.owned,
  },
  {
    id: 'hang', icon: '🖼', title: 'Accrochez-la dans votre musée',
    desktop: 'Entrez dans votre musée (flèche), approchez-vous d’un mur et appuyez sur <kbd>E</kbd>. Chaque œuvre exposée rapporte des pièces, même hors ligne.',
    touch: 'Entrez dans votre musée (flèche), approchez-vous d’un mur et touchez <b>E</b>.',
    target: 'museum',
    skip: (f) => f.shown > 0 && !f.holding,
    done: (f) => f.shown > 0 && !f.holding,
  },
  {
    id: 'cash', icon: '💰', title: 'Encaissez la caisse',
    desktop: 'Marchez sur le <b>cercle doré</b> à l’entrée de votre musée : la caisse se vide dans votre porte-monnaie.',
    touch: 'Marchez sur le <b>cercle doré</b> à l’entrée de votre musée.',
    target: 'register',
    done: (f, b) => f.collected > b.collected,
  },
  {
    id: 'inventory', icon: '🎒', title: 'Votre inventaire',
    desktop: 'Bouton <b>🎒</b> (touche <kbd>I</kbd>) : vos coffres, vos œuvres exposées, la réserve, vos outils et l’album de la collection.',
    touch: 'Touchez <b>🎒</b> en haut à droite : coffres, œuvres exposées, réserve, outils, album.',
    highlight: 'invBtn',
    done: (f) => f.inventoryOpened,
  },
  {
    id: 'chests', icon: '🎁', title: 'Les Lucky coffres',
    desktop: 'Boutique <b>🛒</b> (touche <kbd>B</kbd>) → Lucky coffres : des œuvres rares à gagner, probabilités affichées. Rechargez vos 💎 STH coins dans l’onglet STH.',
    touch: 'Boutique <b>🛒</b> → Lucky coffres : des œuvres rares à gagner, probabilités affichées avant l’achat.',
    highlight: 'shopBtn',
    done: (f) => f.shopOpened,
  },
  {
    id: 'end', icon: '🏆', title: 'À vous de jouer !',
    desktop: 'Suivez les objectifs en haut à gauche, protégez votre musée (🛡) et allez voler les chefs-d’œuvre de vos voisins. Bon casse !',
    touch: 'Suivez les objectifs en haut à gauche, protégez votre musée (🛡) et volez les chefs-d’œuvre de vos voisins. Bon casse !',
    manual: true,
    done: () => false,
  },
];

const KEY = 'sam-tuto-v2';

export class Tutorial {
  active = false;
  private i = 0;
  private base: TutoFacts | null = null;
  private last: TutoFacts | null = null;
  private doneAt = 0;

  constructor(private el: HTMLElement, private touch: boolean) {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.tuto === 'skip') this.next();
      else if (b.dataset.tuto === 'quit' || b.dataset.tuto === 'end') this.stop();
    });
  }

  static seen(): boolean {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return true;
    }
  }

  start(): void {
    this.active = true;
    this.i = 0;
    this.base = null;
    this.render();
  }

  stop(): void {
    this.active = false;
    this.el.hidden = true;
    this.highlight(null);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* stockage indisponible */
    }
  }

  private next(): void {
    this.i++;
    this.base = this.last ? { ...this.last } : null;
    this.doneAt = 0;
    if (this.i >= STEPS.length) return this.stop();
    if (this.last && STEPS[this.i].skip?.(this.last)) return this.next();
    this.render();
  }

  /** Où pointer la flèche 3D (null : aucune). */
  target(): Target {
    return this.active ? STEPS[this.i]?.target ?? null : null;
  }

  update(f: TutoFacts): void {
    if (!this.active) return;
    this.last = f;
    if (!this.base) {
      this.base = { ...f };
      if (STEPS[this.i].skip?.(f)) return this.next();
    }
    const step = STEPS[this.i];
    if (this.doneAt) {
      if (performance.now() - this.doneAt > 900) this.next();
      return;
    }
    if (!step.manual && step.done(f, this.base)) {
      this.doneAt = performance.now();
      this.el.classList.add('ok');
    }
  }

  private highlight(id: string | null): void {
    document.querySelectorAll('.tuto-glow').forEach((x) => x.classList.remove('tuto-glow'));
    if (id) document.getElementById(id)?.classList.add('tuto-glow');
  }

  private render(): void {
    const s = STEPS[this.i];
    this.el.hidden = false;
    this.el.classList.remove('ok');
    this.highlight(s.highlight ?? null);
    const dots = STEPS.map((_, k) => `<i class="${k < this.i ? 'done' : k === this.i ? 'on' : ''}"></i>`).join('');
    this.el.innerHTML = `<div class="tu-icon">${s.icon}</div>
      <div class="tu-txt"><div class="tu-head"><b>${s.title}</b><span class="tu-dots">${dots}</span></div>
      <p>${this.touch ? s.touch : s.desktop}</p>
      <div class="tu-actions">${s.manual ? '<button data-tuto="end" class="tu-go">C’est parti !</button>' : '<button data-tuto="skip">Passer l’étape</button><button data-tuto="quit">Quitter le tutoriel</button>'}</div></div>
      <span class="tu-check">✓</span>`;
  }
}
