import './style.css';
import { GameState } from './game/types';
import { LobbyInfo, Session, SessionEvents, clearSavedHost, hostGame, joinGame, loadSavedHost } from './net/session';
import { BoardView } from './render/scene';
import { Hud } from './ui/hud';

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

function renderHome(error = '') {
  const saved = loadSavedHost();
  const room = params.get('room') ?? '';
  app.innerHTML = `
    <div class="lobby">
      <div class="panel">
        <h1>⬢ Hexhold</h1>
        <p class="tag">Settle the island, trade with friends, race to ${10} points.</p>
        <label>Your name<input id="name" maxlength="16" placeholder="e.g. Sam" value="${esc(store.get('hexhold-name'))}"></label>
        ${error ? `<div class="err">${esc(error)}</div>` : ''}
        <div class="split">
          <div>
            <h3>Join a game</h3>
            <input id="code" maxlength="5" placeholder="Room code" value="${esc(room)}" style="text-transform:uppercase">
            <button id="join" class="primary">Join</button>
          </div>
          <div>
            <h3>Host a game</h3>
            <p class="hint">You'll get a code to share. Your browser runs the game – keep this tab open.</p>
            <button id="host" class="${room ? '' : 'primary'}">Create game</button>
            ${saved?.state ? `<button id="resume">Resume game ${esc(saved.code)}</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  const nameEl = app.querySelector<HTMLInputElement>('#name')!;
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
    if (code.length !== 5) return renderHome('Enter the 5-letter room code from your host.');
    start(() => joinGame(code, n, events));
  };
  app.querySelector('#join')!.addEventListener('click', join);
  app.querySelector('#code')!.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && join());
}

async function start(fn: () => Promise<Session>) {
  app.innerHTML = `<div class="lobby"><div class="panel"><h2>Connecting…</h2><div class="spinner"></div><p class="hint">This can take up to 30 seconds on some networks.</p></div></div>`;
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
  const link = `${location.origin}${location.pathname}?room=${l.code}${params.has('tabs') ? '&tabs' : ''}`;
  app.innerHTML = `
    <div class="lobby">
      <div class="panel">
        <h2>Room code</h2>
        <div class="bigcode">${esc(l.code)}</div>
        <div class="share"><input readonly value="${esc(link)}"><button id="copy">Copy link</button></div>
        <h3>Players (${l.players.length}/4)</h3>
        <ul class="plist">${l.players.map((p, i) => `<li><span class="dot" style="--pc:${['#e53935', '#1e88e5', '#f5f5f5', '#fb8c00'][i]}"></span>${esc(p.name)}${i === 0 ? ' 👑' : ''}${i === session!.seat ? ' (you)' : ''}</li>`).join('')}</ul>
        ${session.isHost
          ? `<button id="start" class="primary" ${l.players.length < 2 ? 'disabled' : ''}>Start game</button>
             <p class="hint">${l.players.length < 2 ? 'Waiting for at least one friend to join…' : 'Everyone in? Start when ready.'}</p>`
          : `<p class="hint">Waiting for the host to start the game…</p>`}
      </div>
    </div>`;
  app.querySelector('#copy')!.addEventListener('click', () =>
    navigator.clipboard?.writeText(link).then(() => ((app.querySelector('#copy') as HTMLElement).textContent = 'Copied!')));
  app.querySelector('#start')?.addEventListener('click', () => session?.start?.());
}

// ------------------------------------------------------------------- game

function onState(s: GameState) {
  if (!session) { pendingState = s; return; }
  if (!hud) {
    app.innerHTML = `<div id="board"></div><div id="hud"></div>`;
    board = new BoardView(document.getElementById('board')!);
    hud = new Hud(document.getElementById('hud')!, session.seat, (a) => session!.act(a), session.code);
    board.onPick = (k, id) => hud!.pick(k, id);
    board.onDiceLanded = () => hud!.diceLanded();
    hud.onChange = () => board!.update(s0!, hud!.selectable());
  }
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
  onError: (msg) => hud?.toast(msg) ?? alert(msg),
  onDisconnect: () => {
    if (hud) hud.toast('Lost connection to the host. Reload and re-join with the same name.');
    else renderHome('Lost connection to the host.');
  },
};

window.addEventListener('beforeunload', (e) => {
  if (session?.isHost && s0 && s0.phase !== 'ended') e.preventDefault();
});
if (params.has('reset')) clearSavedHost();
renderHome();
