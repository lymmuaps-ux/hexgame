import { applyAction, createGame } from '../game/rules';
import { Action, GameState, MAX_PLAYERS } from '../game/types';
import { M } from '../game/msg';
import { Link, getTransport } from './transport';

export interface LobbyInfo {
  code: string;
  players: { name: string; connected: boolean }[];
  started: boolean;
  spectators?: string[];
}

/** a short piece of recorded speech (base64 audio + its mime type) */
export interface VoiceChunk { d: string; m: string }

type ClientMsg =
  | { t: 'join'; name: string; clientId: string }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'voice'; chunk: VoiceChunk };
type HostMsg =
  | { t: 'welcome'; seat: number }
  | { t: 'voice'; from: number; name: string; chunk: VoiceChunk }
  | { t: 'reject'; msg: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'state'; state: GameState; v: number }
  | { t: 'error'; msg: string };

export interface SessionEvents {
  onLobby(l: LobbyInfo): void;
  onState(s: GameState): void;
  onError(msg: string): void;
  onDisconnect(): void;
  onVoice?(from: number, name: string, chunk: VoiceChunk): void;
}

/** What the UI talks to; identical API for host and clients. */
export interface Session {
  readonly isHost: boolean;
  readonly code: string;
  /** player index; negative for spectators */
  seat: number;
  act(a: Action): void;
  chat(text: string): void;
  voice(chunk: VoiceChunk): void;
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
  // people watching: they get every update but cannot act (ids -1, -2, …)
  const spectators: { id: number; name: string; clientId: string; link: Link | null }[] = [];

  const lobby = (): LobbyInfo => ({
    code,
    players: seats.map((s, i) => ({ name: s.name, connected: i === 0 || !!s.link })),
    started: !!state,
    spectators: spectators.filter((x) => x.link).map((x) => x.name),
  });
  const save = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ code, seats: seats.map(({ name, clientId }) => ({ name, clientId })), state }));
    } catch { /* storage unavailable */ }
  };
  let version = 0;
  const broadcast = (m: HostMsg, except?: Link) => {
    seats.forEach((s) => s.link && s.link !== except && s.link.send(m));
    spectators.forEach((s) => s.link && s.link !== except && s.link.send(m));
  };
  const publish = () => {
    if (state) {
      state.players.forEach((p, i) => (p.connected = i === 0 || !!seats[i]?.link));
      state.spectators = spectators.filter((x) => x.link).map((x) => x.name);
    }
    save();
    const l = lobby();
    broadcast({ t: 'lobby', lobby: l });
    ev.onLobby(l);
    if (state) {
      broadcast({ t: 'state', state, v: ++version });
      ev.onState(state);
    }
  };
  const chat = (seat: number, raw: unknown) => {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!state || !text) return;
    const list = state.chat ?? [];
    const name = seat >= 0 ? undefined : spectators.find((x) => x.id === seat)?.name;
    state.chat = [...list, { id: (list[list.length - 1]?.id ?? 0) + 1, p: seat, text, ...(name ? { name } : {}) }].slice(-80);
    publish();
  };
  const nameOf = (seat: number) => (seat >= 0 ? seats[seat]?.name : spectators.find((x) => x.id === seat)?.name) ?? '?';
  /** voice is relayed to everyone except the speaker; it is never stored */
  const voice = (seat: number, chunk: VoiceChunk, from?: Link) => {
    if (!chunk || typeof chunk.d !== 'string' || chunk.d.length > 60000) return;
    const msg: HostMsg = { t: 'voice', from: seat, name: nameOf(seat), chunk: { d: chunk.d, m: String(chunk.m).slice(0, 60) } };
    broadcast(msg, from);
    if (seat !== 0) ev.onVoice?.(seat, nameOf(seat), msg.chunk);
  };
  const handle = (seat: number, a: Action, reply: (m: HostMsg) => void) => {
    if (!state) return reply({ t: 'error', msg: M('net.notStarted') });
    const r = applyAction(state, seat, a);
    if (!r.ok) return reply({ t: 'error', msg: r.error });
    state = r.state;
    publish();
  };

  await getTransport().host(code, (link) => {
    let seat: number | null = null; // not joined yet
    link.onMessage((m: ClientMsg) => {
      if (m.t === 'join') {
        const nm = String(m.name).trim().slice(0, 16) || 'Player';
        let idx = seats.findIndex((s, i) => i > 0 && s.clientId === m.clientId);
        if (idx < 0) idx = seats.findIndex((s, i) => i > 0 && !s.link && s.name.toLowerCase() === nm.toLowerCase());
        if (idx < 0 && (state || seats.length >= MAX_PLAYERS)) {
          // game already running (or full): join as a spectator
          let sp = spectators.find((x) => x.clientId === m.clientId);
          if (!sp) {
            sp = { id: -(spectators.length + 1), name: nm, clientId: m.clientId, link };
            spectators.push(sp);
          }
          sp.link = link;
          sp.name = nm;
          seat = sp.id;
          link.send({ t: 'welcome', seat } satisfies HostMsg);
          publish();
          return;
        }
        if (idx < 0) {
          if (seats.some((s) => s.name.toLowerCase() === nm.toLowerCase()))
            return link.send({ t: 'reject', msg: M('net.nameTaken') } satisfies HostMsg);
          seats.push({ name: nm, clientId: m.clientId, link });
          idx = seats.length - 1;
        } else {
          seats[idx].link = link;
          seats[idx].clientId = m.clientId;
        }
        seat = idx;
        link.send({ t: 'welcome', seat } satisfies HostMsg);
        publish();
      } else if (seat === null) {
        return;
      } else if (m.t === 'action' && seat >= 0) {
        handle(seat, m.action, (r) => link.send(r));
      } else if (m.t === 'chat') {
        chat(seat, m.text);
      } else if (m.t === 'voice') {
        voice(seat, m.chunk, link);
      }
    });
    link.onClose(() => {
      if (seat === null) return;
      const sp = spectators.find((x) => x.id === seat);
      if (sp) {
        if (sp.link === link) sp.link = null;
        publish();
        return;
      }
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
    chat: (text) => chat(0, text),
    voice: (chunk) => voice(0, chunk),
    start: () => {
      if (state) return;
      if (seats.length < 2) return ev.onError(M('net.need2'));
      state = createGame(seats.map((s) => s.name));
      state.log.push(M('log.order', { names: seats.map((s) => s.name).join(' → ') }));
      publish();
    },
  };
  queueMicrotask(publish);
  return session;
}

// ------------------------------------------------------------------ client

export async function joinGame(code: string, name: string, ev: SessionEvents): Promise<Session> {
  const link = await getTransport().join(code.toUpperCase());
  let lastVersion = 0;
  return new Promise((resolve, reject) => {
    const session: Session = {
      isHost: false,
      code: code.toUpperCase(),
      seat: -1,
      act: (a) => link.send({ t: 'action', action: a } satisfies ClientMsg),
      chat: (text) => link.send({ t: 'chat', text } satisfies ClientMsg),
      voice: (chunk) => link.send({ t: 'voice', chunk } satisfies ClientMsg),
    };
    link.onMessage((m: HostMsg) => {
      switch (m.t) {
        case 'welcome': session.seat = m.seat; resolve(session); break;
        case 'reject': reject(new Error(m.msg)); break;
        case 'lobby': ev.onLobby(m.lobby); break;
        case 'state':
          // relays can deliver out of order: never go back to an older state
          if (m.v > lastVersion || m.v < lastVersion - 1000) {
            lastVersion = m.v;
            ev.onState(m.state);
          }
          break;
        case 'error': ev.onError(m.msg); break;
        case 'voice': ev.onVoice?.(m.from, m.name, m.chunk); break;
      }
    });
    link.onClose(() => ev.onDisconnect());
    link.send({ t: 'join', name, clientId: clientId() } satisfies ClientMsg);
  });
}
