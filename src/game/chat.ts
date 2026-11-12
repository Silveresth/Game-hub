/**
 * Discussion du quartier : historique (texte toujours inséré en textContent, jamais en HTML), saisie (touche Entrée),
 * émotes rapides, messages du jeu (casses, ventes, arrivées), et bulles de dialogue au-dessus des personnages.
 */
import * as THREE from 'three';
import { Label } from './labels';
import type { EmoteKind } from './net';

export const EMOTE_ICONS: Record<EmoteKind, string> = { wave: '👋', laugh: '😂', fire: '🔥', wow: '😱', clap: '👏', heart: '❤️' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class ChatUI {
  private log = $('chatLog');
  private form = $<HTMLFormElement>('chatForm');
  private input = $<HTMLInputElement>('chatInput');
  /** Joueurs dont on ne veut plus voir les messages. */
  blocked = new Set<string>();
  onSend: (text: string) => void = () => undefined;
  onEmote: (kind: EmoteKind) => void = () => undefined;
  onOpenChange: (open: boolean) => void = () => undefined;

  constructor() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text) this.onSend(text);
      this.input.value = '';
      this.close();
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // les touches tapées ne pilotent pas le jeu
      if (e.key === 'Escape') this.close();
    });
    const bar = $('emotes');
    for (const [kind, icon] of Object.entries(EMOTE_ICONS) as Array<[EmoteKind, string]>) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = icon;
      b.title = 'Émote';
      b.onclick = () => this.onEmote(kind);
      bar.appendChild(b);
    }
    $('chatToggle').onclick = () => (this.isOpen ? this.close() : this.open());
  }

  get isOpen(): boolean {
    return document.body.classList.contains('chatting');
  }

  open(): void {
    document.body.classList.add('chatting');
    this.onOpenChange(true);
    // focus immédiat (avant, un setTimeout faisait perdre les premières lettres tapées) ;
    // la touche Entrée qui a ouvert la discussion est annulée (preventDefault) : elle n'envoie rien
    this.input.focus();
  }

  close(): void {
    document.body.classList.remove('chatting');
    this.input.blur();
    this.onOpenChange(false);
  }

  /** Message d'un joueur (couleur de son personnage) ou du jeu (`system`). */
  add(line: { id?: string; name?: string; color?: string; text: string; system?: boolean; me?: boolean }): void {
    if (line.id && this.blocked.has(line.id)) return;
    const row = document.createElement('div');
    row.className = line.system ? 'sys' : line.me ? 'me' : '';
    if (line.name) {
      const who = document.createElement('b');
      who.textContent = `${line.name} `;
      if (line.color) who.style.color = line.color;
      row.appendChild(who);
    }
    row.appendChild(document.createTextNode(line.text));
    this.log.appendChild(row);
    while (this.log.children.length > 40) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    // les messages s'estompent au bout de 12 s (ils restent lisibles quand la discussion est ouverte)
    setTimeout(() => row.classList.add('old'), 12_000);
  }

  system(text: string): void {
    this.add({ text, system: true });
  }

  clear(): void {
    this.log.innerHTML = '';
  }
}

/** Bulle de dialogue (ou grande émote) au-dessus d'un personnage, quelques secondes. */
export class SpeechBubble {
  readonly label = new Label(0.95, 640, 170);
  private until = 0;

  constructor(parent: THREE.Object3D, y = 3.2) {
    this.label.sprite.position.y = y;
    this.label.sprite.visible = false;
    parent.add(this.label.sprite);
  }

  /** @param color couleur du joueur (bordure de la bulle) */
  say(text: string, color = 'rgba(0,0,0,.25)'): void {
    const short = text.length > 46 ? `${text.slice(0, 44)}…` : text;
    this.label.update([{ text: short, color: '#1b1308', size: 44, weight: 800 }], { bg: 'rgba(255,255,255,.95)', border: color, stroke: false });
    this.label.sprite.visible = true;
    this.until = performance.now() + Math.min(8000, 4000 + text.length * 70);
  }

  emote(icon: string): void {
    this.label.update([{ text: icon, color: '#fff', size: 110, weight: 900 }], { bg: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)' });
    this.label.sprite.visible = true;
    this.until = performance.now() + 2600;
  }

  update(): void {
    if (this.label.sprite.visible && performance.now() > this.until) this.label.sprite.visible = false;
  }

  dispose(): void {
    this.label.sprite.removeFromParent();
    this.label.dispose();
  }
}
