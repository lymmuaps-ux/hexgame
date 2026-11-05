import './style.css';
import { GameState } from './game/types';
import { LobbyInfo, Session, SessionEvents, clearSavedHost, hostGame, joinGame, loadSavedHost } from './net/session';
import { BoardView } from './render/scene';
import { Hud } from './ui/hud';
import { Chat } from './ui/chat';
import { M } from './game/msg';
import { WIN_POINTS } from './game/types';
import { applyDir, getLang, onLangChange, setLang, t, tr } from './i18n';

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const params = new URLSearchParams(location.search);

let session: Session | null = null;
let board: BoardView | null = null;
let hud: Hud | null = null;
let lastLobby: LobbyInfo | null = null;
let pendingState: GameState | null = null;

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ------------------------------------------------------------------ lobby

let screen: 'home' | 'connecting' | 'waiting' | 'game' = 'home';
let homeError = '';
const langBtn = () => `<button class="langbtn" id="lang">${t('hud.switchLang')}</button>`;
const bindLang = () => app.querySelector('#lang')?.addEventListener('click', () => setLang(getLang() === 'ar' ? 'en' : 'ar'));

/** `error` is a message code or plain text */
function renderHome(error = '') {
  screen = 'home';
  homeError = error;
  const saved = loadSavedHost();
  const room = params.get('room') ?? '';
  app.innerHTML = `
    <div class="lobby">
      <div class="panel">
        ${langBtn()}
        <h1>⬢ Hexhold</h1>
        <p class="tag">${t('lobby.tag', { n: WIN_POINTS })}</p>
        <label>${t('lobby.name')}<input id="name" maxlength="16" placeholder="${t('lobby.namePh')}" value="${esc(store.get('hexhold-name'))}"></label>
        ${error ? `<div class="err">${tr(error, true)}</div>` : ''}
        <div class="split">
          <div>
            <h3>${t('lobby.join')}</h3>
            <input id="code" maxlength="5" placeholder="${t('lobby.codePh')}" value="${esc(room)}" style="text-transform:uppercase" dir="ltr">
            <button id="join" class="primary">${t('lobby.joinBtn')}</button>
          </div>
          <div>
            <h3>${t('lobby.host')}</h3>
            <p class="hint">${t('lobby.hostHint')}</p>
            <button id="host" class="${room ? '' : 'primary'}">${t('lobby.create')}</button>
            ${saved?.state ? `<button id="resume">${t('lobby.resume', { code: esc(saved.code) })}</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  bindLang();
  const nameEl = app.querySelector<HTMLInputElement>('#name')!;
  nameEl.addEventListener('input', () => store.set('hexhold-name', nameEl.value.trim()));
  const codeEl = app.querySelector<HTMLInputElement>('#code')!;
  codeEl.addEventListener('input', () => params.set('room', codeEl.value.trim().toUpperCase()));
  const getName = () => {
    const n = nameEl.value.trim();
    if (!n) { nameEl.focus(); nameEl.classList.add('bad'); return null; }
    store.set('hexhold-name', n);
    return n;
  };
  app.querySelector('#host')!.addEventListener('click', () => {
    const n = getName();
    if (n) start(() => hostGame(n, events));
  });
  app.querySelector('#resume')?.addEventListener('click', () => {
    const n = getName();
    if (n && saved) start(() => hostGame(n, events, saved));
  });
  const join = () => {
    const n = getName();
    const code = app.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
    if (!n) return;
    if (code.length !== 5) return renderHome(M('lobby.codeErr'));
    start(() => joinGame(code, n, events));
  };
  app.querySelector('#join')!.addEventListener('click', join);
  app.querySelector('#code')!.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && join());
}

async function start(fn: () => Promise<Session>) {
  screen = 'connecting';
  app.innerHTML = `<div class="lobby"><div class="panel"><h2>${t('lobby.connecting')}</h2><div class="spinner"></div><p class="hint">${t('lobby.slow')}</p></div></div>`;
  try {
    session = await fn();
    if (pendingState) onState(pendingState);
    else if (lastLobby) renderWaiting(lastLobby);
  } catch (e) {
    session = null;
    renderHome((e as Error).message);
  }
}

function renderWaiting(l: LobbyInfo) {
  if (!session || hud) return;
  screen = 'waiting';
  const link = `${location.origin}${location.pathname}?room=${l.code}${params.has('tabs') ? '&tabs' : ''}`;
  app.innerHTML = `
    <div class="lobby">
      <div class="panel">
        ${langBtn()}
        <h2>${t('lobby.roomCode')}</h2>
        <div class="bigcode" dir="ltr">${esc(l.code)}</div>
        <div class="share"><input readonly value="${esc(link)}" dir="ltr"><button id="copy">${t('lobby.copyLink')}</button></div>
        <h3>${t('lobby.players', { n: l.players.length })}</h3>
        <ul class="plist">${l.players.map((p, i) => `<li><span class="dot" style="--pc:${['#e53935', '#1e88e5', '#f5f5f5', '#fb8c00'][i]}"></span>${esc(p.name)}${i === 0 ? ' 👑' : ''}${i === session!.seat ? ` ${t('hud.you')}` : ''}</li>`).join('')}</ul>
        ${session.isHost
          ? `<button id="start" class="primary" ${l.players.length < 2 ? 'disabled' : ''}>${t('lobby.start')}</button>
             <p class="hint">${l.players.length < 2 ? t('lobby.needFriend') : t('lobby.ready')}</p>`
          : `<p class="hint">${t('lobby.waitHost')}</p>`}
      </div>
    </div>`;
  app.querySelector('#copy')!.addEventListener('click', () =>
    navigator.clipboard?.writeText(link).then(() => ((app.querySelector('#copy') as HTMLElement).textContent = t('lobby.copied'))));
  bindLang();
  app.querySelector('#start')?.addEventListener('click', () => session?.start?.());
}

// ------------------------------------------------------------------- game

function onState(s: GameState) {
  if (!session) { pendingState = s; return; }
  if (!hud) {
    screen = 'game';
    app.innerHTML = `<div id="board"></div><div id="hud"></div>`;
    board = new BoardView(document.getElementById('board')!);
    hud = new Hud(document.getElementById('hud')!, session.seat, (a) => session!.act(a), session.code);
    board.onPick = (k, id) => hud!.pick(k, id);
    board.onDiceLanded = () => hud!.diceLanded();
    hud.hexScreenPos = (h) => board!.hexScreenPos(h);
    hud.onChange = () => board!.update(s0!, hud!.selectable());
    const chat = new Chat(app, session.seat, (text) => session!.chat(text),
      (p) => document.querySelector(`.player[data-p="${p}"]`)?.getBoundingClientRect() ?? null);
    chat.onUnreadChange = () => hud!.render();
    hud.chat = chat;
  }
  hud.chat?.update(s);
  s0 = s;
  hud.setState(s);
  board!.update(s, hud.selectable());
}
let s0: GameState | null = null;
// handy for debugging from the browser console
(window as any).hexhold = { get state() { return s0; }, get session() { return session; }, get hud() { return hud; }, get board() { return board; } };

const events: SessionEvents = {
  onLobby: (l) => {
    lastLobby = l;
    if (!l.started) renderWaiting(l);
  },
  onState,
  onError: (msg) => (hud ? hud.toast(tr(msg)) : alert(tr(msg))),
  onDisconnect: () => {
    if (hud) hud.toast(t('lobby.lostGame'));
    else renderHome(M('lobby.lost'));
  },
};

window.addEventListener('beforeunload', (e) => {
  if (session?.isHost && s0 && s0.phase !== 'ended') e.preventDefault();
});
if (params.has('reset')) clearSavedHost();
applyDir();
onLangChange(() => {
  if (screen === 'home') renderHome(homeError);
  else if (screen === 'waiting' && lastLobby) renderWaiting(lastLobby);
  else if (screen === 'game') {
    hud?.chat?.relabel();
    hud?.render();
  }
});
renderHome();
