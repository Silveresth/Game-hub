// Journal des versions : affiché sur la page d'accueil (feuille de route) et dans le jeu (menu ☰ → Nouveautés).
// Source unique : changelog.json, complété à chaque livraison.
import data from './changelog.json';

export interface ChangeItem { type: 'new' | 'improved' | 'fixed'; text: string }
export interface Version { version: string; date: string | null; title: string; items: ChangeItem[] }
export interface Roadmap { status: 'next' | 'planned' | 'idea'; text: string }

export const CHANGELOG = data as unknown as { current: string; versions: Version[]; roadmap: Roadmap[] };
export const GAME_VERSION = CHANGELOG.current;

const TYPE: Record<ChangeItem['type'], [string, string]> = {
  new: ['Nouveau', 'new'],
  improved: ['Amélioré', 'improved'],
  fixed: ['Corrigé', 'fixed'],
};
const STATUS: Record<Roadmap['status'], string> = { next: 'Prochainement', planned: 'Prévu', idea: 'Idée' };
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function versionHtml(v: Version, open = true): string {
  const counts = (['new', 'improved', 'fixed'] as const).map((t) => [t, v.items.filter((i) => i.type === t).length] as const).filter(([, n]) => n);
  return `<details class="cl-version" ${open ? 'open' : ''}>
    <summary><span class="cl-num">v${esc(v.version)}</span><span class="cl-title">${esc(v.title)}</span>
      <span class="cl-date">${v.date ? dateFmt.format(new Date(`${v.date}T12:00:00`)) : 'Développement'}</span>
      <span class="cl-counts">${counts.map(([t, n]) => `<i class="cl-${TYPE[t][1]}">${n} ${TYPE[t][0].toLowerCase()}${n > 1 ? (t === 'new' ? 'x' : 's') : ''}</i>`).join('')}</span></summary>
    <ul>${v.items.map((i) => `<li><span class="cl-tag cl-${TYPE[i.type][1]}">${TYPE[i.type][0]}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>
  </details>`;
}

export function roadmapHtml(): string {
  return `<ul class="cl-roadmap">${CHANGELOG.roadmap.map((r) => `<li class="rm-${r.status}"><span class="cl-tag">${STATUS[r.status]}</span><span>${esc(r.text)}</span></li>`).join('')}</ul>`;
}
