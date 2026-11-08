import { GameState } from '../game/types';
import { t } from '../i18n';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const REACTIONS = ['👍', '😂', '😮', '😡', '🎉', '👏'];
/** a message made only of emoji (e.g. a quick reaction) gets a big floating animation */
const isEmojiOnly = (s: string) => /^[\p{Extended_Pictographic}‍️\s]{1,12}$/u.test(s);

/**
 * Chat lives in its own element outside the re-rendered HUD, so typing is never
 * interrupted by game updates.
 */
export class Chat {
  unread = 0;
  open = false;
  onUnreadChange: () => void = () => {};
  private el: HTMLElement;
  private list: HTMLElement;
  private input: HTMLInputElement;
  private lastId: number | null = null;

  constructor(
    private layer: HTMLElement,
    private seat: number,
    private send: (text: string) => void,
    /** screen rectangle of a player's panel, to place speech bubbles */
    private panelRect: (p: number) => DOMRect | null,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'chat';
    this.el.innerHTML = `
      <div class="chat-head"><b class="chat-title"></b><button class="chat-close" aria-label="close">✕</button></div>
      <div class="chat-list"></div>
      <div class="chat-react">${REACTIONS.map((e) => `<button data-e="${e}">${e}</button>`).join('')}</div>
      <form class="chat-form"><input maxlength="200" autocomplete="off"><button class="primary" type="submit"></button></form>`;
    layer.appendChild(this.el);
    this.list = this.el.querySelector('.chat-list')!;
    this.input = this.el.querySelector('input')!;
    this.el.querySelector('.chat-close')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.send(text);
      this.input.value = '';
    });
    this.el.querySelectorAll<HTMLElement>('.chat-react button').forEach((b) =>
      b.addEventListener('click', () => this.send(b.dataset.e!)),
    );
    this.input.addEventListener('keydown', (e) => e.key === 'Escape' && this.toggle(false));
    this.relabel();
  }

  relabel() {
    this.el.querySelector('.chat-title')!.textContent = `💬 ${t('chat.title')}`;
    this.el.querySelector<HTMLButtonElement>('.chat-form button')!.textContent = t('chat.send');
    this.input.placeholder = t('chat.placeholder');
    if (!this.list.children.length) this.list.innerHTML = `<div class="chat-empty">${t('chat.empty')}</div>`;
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.classList.toggle('open', this.open);
    if (this.open) {
      this.clearNotes();
      this.unread = 0;
      this.onUnreadChange();
      this.list.scrollTop = this.list.scrollHeight;
      // don't pop the phone keyboard up automatically
      if (innerWidth > 760) setTimeout(() => this.input.focus(), 50);
    }
  }

  update(s: GameState) {
    const msgs = s.chat ?? [];
    const first = this.lastId === null;
    const fresh = msgs.filter((m) => this.lastId === null || m.id > this.lastId);
    if (!fresh.length) {
      if (first) this.lastId = 0;
      return;
    }
    this.lastId = msgs[msgs.length - 1].id;
    this.list.querySelector('.chat-empty')?.remove();
    for (const m of fresh) {
      const p = s.players[m.p];
      const row = document.createElement('div');
      row.className = `chat-msg${m.p === this.seat ? ' mine' : ''}${first ? '' : ' new'}${isEmojiOnly(m.text) ? ' emoji' : ''}`;
      row.style.setProperty('--pc', p?.color ?? '#9aa0aa');
      row.innerHTML = `<span class="who"><span class="dot"></span>${esc(p?.name ?? (m.name ? `${m.name} 👁` : '?'))}</span><span class="txt" dir="auto">${esc(m.text)}</span>`;
      this.list.appendChild(row);
      if (first) continue;
      if (isEmojiOnly(m.text)) this.floatEmoji(m.p, m.text);
      if (m.p !== this.seat) {
        if (!this.open) {
          this.unread++;
          this.onUnreadChange();
          this.notify(p?.name ?? (m.name ? `${m.name} 👁` : '?'), m.text, p?.color ?? '#9aa0aa');
        }
      }
    }
    while (this.list.children.length > 80) this.list.firstElementChild!.remove();
    this.list.scrollTop = this.list.scrollHeight;
  }

  /** small card in the corner showing who wrote what; tap to open the chat */
  private notify(name: string, text: string, color: string) {
    let stack = this.layer.querySelector<HTMLElement>('.chat-notes');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'chat-notes';
      this.layer.appendChild(stack);
    }
    const n = document.createElement('div');
    n.className = 'chat-note';
    n.style.setProperty('--pc', color);
    n.innerHTML = `<span class="who"><span class="dot"></span>${esc(name)}</span><span class="txt" dir="auto"></span><i class="bar"></i>`;
    n.querySelector('.txt')!.textContent = text;
    if (isEmojiOnly(text)) n.classList.add('emoji');
    let gone = false;
    const close = () => {
      if (gone) return;
      gone = true;
      n.classList.add('out');
      setTimeout(() => n.remove(), 300);
    };
    n.addEventListener('click', () => {
      close();
      this.toggle(true);
    });
    stack.appendChild(n);
    // keep at most 3 on screen
    const notes = [...stack.querySelectorAll('.chat-note:not(.out)')];
    notes.slice(0, Math.max(0, notes.length - 3)).forEach((o) => {
      o.classList.add('out');
      setTimeout(() => o.remove(), 300);
    });
    setTimeout(close, 5000);
  }

  /** close every notification (when the chat opens) */
  private clearNotes() {
    this.layer.querySelectorAll('.chat-note').forEach((n) => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 300);
    });
  }

  /** reactions float up from the sender's panel */
  private floatEmoji(p: number, emoji: string) {
    const r = this.panelRect(p);
    const x = r ? r.left + r.width / 2 : innerWidth / 2;
    const y = r ? r.top + r.height / 2 : innerHeight / 2;
    for (let i = 0; i < 5; i++) {
      const e = document.createElement('div');
      e.className = 'emojifloat';
      e.textContent = emoji;
      e.style.left = `${x + (Math.random() - 0.5) * 60}px`;
      e.style.top = `${y}px`;
      e.style.setProperty('--dx', `${(Math.random() - 0.5) * 80}px`);
      e.style.animationDelay = `${i * 0.12}s`;
      this.layer.appendChild(e);
      setTimeout(() => e.remove(), 2600);
    }
  }
}
