import { applyAction, createGame } from '../game/rules';
import { Action, GameState, MAX_PLAYERS } from '../game/types';
import { Link, getTransport } from './transport';

export interface LobbyInfo {
  code: string;
  players: { name: string; connected: boolean }[];
  started: boolean;
}

type ClientMsg = { t: 'join'; name: string; clientId: string } | { t: 'action'; action: Action };
type HostMsg =
  | { t: 'welcome'; seat: number }
  | { t: 'reject'; msg: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'state'; state: GameState }
  | { t: 'error'; msg: string };

export interface SessionEvents {
  onLobby(l: LobbyInfo): void;
  onState(s: GameState): void;
  onError(msg: string): void;
  onDisconnect(): void;
}

/** What the UI talks to; identical API for host and clients. */
export interface Session {
  readonly isHost: boolean;
  readonly code: string;
  seat: number;
  act(a: Action): void;
  start?(): void;
}

export function clientId(): string {
  let id = '';
  try {
    id = sessionStorage.getItem('hexhold-client') ?? '';
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('hexhold-client', id);
    }
  } catch {
    id = Math.random().toString(36).slice(2, 10);
  }
  return id;
}

export function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

const SAVE_KEY = 'hexhold-hosted-game';
interface SavedHost { code: string; seats: { name: string; clientId: string }[]; state: GameState | null }

export function loadSavedHost(): SavedHost | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedHost) : null;
  } catch {
    return null;
  }
}
export function clearSavedHost() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// ------------------------------------------------------------------- host

export async function hostGame(name: string, ev: SessionEvents, resume?: SavedHost): Promise<Session> {
  const code = resume?.code ?? newRoomCode();
  const seats: { name: string; clientId: string; link: Link | null }[] = resume
    ? resume.seats.map((s, i) => ({ ...s, link: null, clientId: i === 0 ? clientId() : s.clientId }))
    : [{ name, clientId: clientId(), link: null }];
  let state: GameState | null = resume?.state ?? null;

  const lobby = (): LobbyInfo => ({
    code,
    players: seats.map((s, i) => ({ name: s.name, connected: i === 0 || !!s.link })),
    started: !!state,
  });
  const save = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ code, seats: seats.map(({ name, clientId }) => ({ name, clientId })), state }));
    } catch { /* storage unavailable */ }
  };
  const broadcast = (m: HostMsg) => seats.forEach((s) => s.link?.send(m));
  const publish = () => {
    if (state) state.players.forEach((p, i) => (p.connected = i === 0 || !!seats[i]?.link));
    save();
    const l = lobby();
    broadcast({ t: 'lobby', lobby: l });
    ev.onLobby(l);
    if (state) {
      broadcast({ t: 'state', state });
      ev.onState(state);
    }
  };
  const handle = (seat: number, a: Action, reply: (m: HostMsg) => void) => {
    if (!state) return reply({ t: 'error', msg: 'The game has not started yet.' });
    const r = applyAction(state, seat, a);
    if (!r.ok) return reply({ t: 'error', msg: r.error });
    state = r.state;
    publish();
  };

  await getTransport().host(code, (link) => {
    let seat = -1;
    link.onMessage((m: ClientMsg) => {
      if (m.t === 'join') {
        const nm = String(m.name).trim().slice(0, 16) || 'Player';
        let idx = seats.findIndex((s, i) => i > 0 && s.clientId === m.clientId);
        if (idx < 0) idx = seats.findIndex((s, i) => i > 0 && !s.link && s.name.toLowerCase() === nm.toLowerCase());
        if (idx < 0) {
          if (state) return link.send({ t: 'reject', msg: 'This game has already started.' } satisfies HostMsg);
          if (seats.length >= MAX_PLAYERS) return link.send({ t: 'reject', msg: 'The game is full.' } satisfies HostMsg);
          if (seats.some((s) => s.name.toLowerCase() === nm.toLowerCase()))
            return link.send({ t: 'reject', msg: 'That name is taken – pick another.' } satisfies HostMsg);
          seats.push({ name: nm, clientId: m.clientId, link });
          idx = seats.length - 1;
        } else {
          seats[idx].link = link;
          seats[idx].clientId = m.clientId;
        }
        seat = idx;
        link.send({ t: 'welcome', seat } satisfies HostMsg);
        publish();
      } else if (m.t === 'action' && seat >= 0) {
        handle(seat, m.action, (r) => link.send(r));
      }
    });
    link.onClose(() => {
      if (seat < 0 || seats[seat]?.link !== link) return;
      if (!state) seats.splice(seat, 1); // left the lobby
      else seats[seat].link = null;
      publish();
    });
  });

  const session: Session = {
    isHost: true,
    code,
    seat: 0,
    act: (a) => handle(0, a, (m) => m.t === 'error' && ev.onError(m.msg)),
    start: () => {
      if (state) return;
      if (seats.length < 2) return ev.onError('You need at least 2 players.');
      state = createGame(seats.map((s) => s.name));
      state.log.push(`Turn order: ${seats.map((s) => s.name).join(' → ')}`);
      publish();
    },
  };
  queueMicrotask(publish);
  return session;
}

// ------------------------------------------------------------------ client

export async function joinGame(code: string, name: string, ev: SessionEvents): Promise<Session> {
  const link = await getTransport().join(code.toUpperCase());
  return new Promise((resolve, reject) => {
    const session: Session = {
      isHost: false,
      code: code.toUpperCase(),
      seat: -1,
      act: (a) => link.send({ t: 'action', action: a } satisfies ClientMsg),
    };
    link.onMessage((m: HostMsg) => {
      switch (m.t) {
        case 'welcome': session.seat = m.seat; resolve(session); break;
        case 'reject': reject(new Error(m.msg)); break;
        case 'lobby': ev.onLobby(m.lobby); break;
        case 'state': ev.onState(m.state); break;
        case 'error': ev.onError(m.msg); break;
      }
    });
    link.onClose(() => ev.onDisconnect());
    link.send({ t: 'join', name, clientId: clientId() } satisfies ClientMsg);
  });
}
