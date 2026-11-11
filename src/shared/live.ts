/**
 * Barre live (haut de page) + PWA, partagées par la landing et le jeu.
 * Les chiffres viennent du serveur par un flux Server-Sent Events (/api/live) :
 * la connexion ouverte compte comme « en ligne », et les stats arrivent toutes les 5 s.
 */

export interface Sale {
  id: string;
  at: number;
  kind: 'express' | 'grande' | 'prestige' | 'abuse';
  label: string;
  live: boolean;
}

export interface LiveStats {
  online: number;
  visitors: number;
  serverTime: number;
  sales: Sale[];
  nextMajor: Sale | null;
  /** Vente en cours, s'il y en a une. */
  liveSale: { label: string; kind: string; workId: string; index: number; count: number } | null;
  top: { id: string; name: string; author: string; likes: number } | null;
}

type Listener = (s: LiveStats) => void;

const nf = new Intl.NumberFormat('fr-FR');
const clockFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export const parisTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Identifiant anonyme et stable du navigateur (compte des visiteurs uniques). */
export function visitorId(): string {
  const KEY = 'sam-visitor';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID().replace(/-/g, '');
  }
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'maintenant';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  if (m >= 10) return `${m} min`; // les secondes ne comptent qu'au dernier moment
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const ICONS = {
  online: '<span class="lb-dot" aria-hidden="true"></span>',
  visitors: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-12 9c0-3 3.6-5 8-5s8 2 8 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  gavel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 4 7 7m-9-5 7 7m-5.5-5.5-8 8 2 2 8-8M4 20h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 8 4 4 4-6 4 6 4-4-2 10H6L4 8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

/**
 * Monte la barre live dans `#livebar`. Renvoie une fonction pour s'abonner aux stats (utile à la landing).
 */
export function mountLiveBar(opts: { gameHref?: string } = {}): { onStats: (fn: Listener) => void } {
  const bar = document.getElementById('livebar');
  const listeners: Listener[] = [];
  if (!bar) return { onStats: () => undefined };

  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Infos en direct');
  bar.innerHTML = `
    <div class="lb-track">
      <span class="lb-item lb-online" title="Joueurs connectés en ce moment">${ICONS.online}<b data-k="online">—</b><span class="lb-l">en ligne</span></span>
      <span class="lb-item" title="Visiteurs uniques depuis le lancement">${ICONS.visitors}<b data-k="visitors">—</b><span class="lb-l">visiteurs depuis le lancement</span></span>
      <span class="lb-item" title="Heure de Paris (heure du serveur)">${ICONS.clock}<span class="lb-l">Paris</span><b data-k="clock">--:--:--</b></span>
      <span class="lb-item lb-sale" data-k="saleBox" title="Prochaine vente aux enchères">${ICONS.gavel}<span class="lb-l" data-k="saleLabel">Prochaine vente</span><span class="lb-l" data-k="saleIn">dans</span><b data-k="countdown">--:--</b></span>
      <span class="lb-item lb-major" title="Prochaine grande vente">${ICONS.gavel}<span class="lb-l" data-k="majorLabel">Grande vente</span><b data-k="major">—</b></span>
      <span class="lb-item lb-top" title="Musée le plus populaire">${ICONS.crown}<span class="lb-l">N°1</span><b data-k="top">—</b></span>
      ${opts.gameHref ? `<a class="lb-play" href="${opts.gameHref}">Jouer</a>` : ''}
    </div>`;
  const $ = (k: string) => bar.querySelector<HTMLElement>(`[data-k="${k}"]`)!;

  let stats: LiveStats | null = null;
  let offset = 0; // horloge serveur - horloge locale
  let connected = false;

  const render = () => {
    const now = Date.now() + offset;
    $('clock').textContent = clockFmt.format(now);
    if (!stats) return;
    const next = stats.sales.find((s) => s.at > now - 1000) ?? stats.sales[0];
    if (stats.liveSale) {
      // vente en direct : la barre l'affiche à la place du compte à rebours
      $('saleLabel').textContent = `🔴 ${stats.liveSale.label}`;
      $('countdown').textContent = `en direct · lot ${stats.liveSale.index + 1}/${stats.liveSale.count}`;
      $('saleIn').hidden = true;
      $('saleBox').classList.add('soon');
    } else if (next) {
      $('saleIn').hidden = false;
      const left = next.at - now;
      $('saleLabel').textContent = next.label;
      $('countdown').textContent = formatCountdown(left);
      $('saleBox').classList.toggle('soon', left < 15 * 60 * 1000);
    }
    if (stats.nextMajor) {
      $('majorLabel').textContent = stats.nextMajor.label;
      $('major').textContent = parisTime.format(stats.nextMajor.at);
    }
  };

  const apply = (s: LiveStats) => {
    stats = s;
    offset = s.serverTime - Date.now();
    $('online').textContent = nf.format(s.online);
    $('visitors').textContent = nf.format(s.visitors);
    $('top').textContent = s.top ? `${s.top.name}` : '—';
    bar.classList.toggle('offline', !connected);
    render();
    listeners.forEach((fn) => fn(s));
  };

  const connect = () => {
    if (!('EventSource' in window)) return poll();
    const es = new EventSource(`/api/live?v=${encodeURIComponent(visitorId())}`);
    es.onopen = () => {
      connected = true;
      bar.classList.remove('offline');
    };
    es.onmessage = (e) => {
      try {
        connected = true;
        apply(JSON.parse(e.data) as LiveStats);
      } catch {
        /* message illisible : ignoré */
      }
    };
    es.onerror = () => {
      connected = false;
      bar.classList.add('offline');
    };
  };

  const poll = async () => {
    try {
      const r = await fetch('/api/stats');
      if (r.ok) apply((await r.json()) as LiveStats);
    } catch {
      bar.classList.add('offline');
    }
    setTimeout(poll, 10000);
  };

  connect();
  render();
  setInterval(render, 1000);
  return { onStats: (fn) => listeners.push(fn) };
}

// ------------------------------------------------------------------ PWA

let deferredPrompt: (Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> }) | null = null;

/** Enregistre le service worker (en production) et branche les boutons « Installer l'application ». */
export function setupPwa(swUrl: string): void {
  // Pas de service worker avec le serveur de dev Vite (port 5173) : il mettrait du code périmé en cache.
  if ('serviceWorker' in navigator && location.port !== '5173') {
    addEventListener('load', () => {
      navigator.serviceWorker.register(swUrl).catch(() => undefined);
    });
  }
  const buttons = () => document.querySelectorAll<HTMLElement>('[data-install]');
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (standalone) return;

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as typeof deferredPrompt;
    buttons().forEach((b) => (b.hidden = false));
  });
  if (ios) buttons().forEach((b) => (b.hidden = false));

  buttons().forEach((b) =>
    b.addEventListener('click', async () => {
      if (deferredPrompt) {
        await deferredPrompt.prompt();
        deferredPrompt = null;
        buttons().forEach((x) => (x.hidden = true));
      } else if (ios) {
        alert('Sur iPhone : touchez le bouton Partager, puis « Sur l’écran d’accueil ».');
      }
    }),
  );
}
