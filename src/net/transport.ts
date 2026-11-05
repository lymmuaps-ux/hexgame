import Peer, { DataConnection } from 'peerjs';

/** A bidirectional message pipe between the host and one client. */
export interface Link {
  send(msg: unknown): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
}

export interface Transport {
  /** Host: claim the room code and accept incoming links. */
  host(code: string, onLink: (l: Link) => void): Promise<void>;
  /** Client: connect to the host of a room. */
  join(code: string): Promise<Link>;
}

const PREFIX = 'hexhold-room-';

// ---------------------------------------------------------- PeerJS (WebRTC)

function wrapConn(conn: DataConnection): Link {
  return {
    send: (m) => conn.open && conn.send(m),
    onMessage: (cb) => conn.on('data', cb),
    onClose: (cb) => {
      conn.on('close', cb);
      conn.on('error', cb);
    },
  };
}

/**
 * ICE servers. STUN finds each browser's public address; TURN relays the traffic when
 * routers / mobile networks block a direct connection (the usual cause of join timeouts).
 * Use your own TURN server by setting these at build time (e.g. a free Metered.ca account):
 *   VITE_TURN_URLS="turn:a.relay.metered.ca:80,turn:a.relay.metered.ca:443?transport=tcp"
 *   VITE_TURN_USERNAME=...  VITE_TURN_CREDENTIAL=...
 */
const env = import.meta.env ?? {};
const turn: RTCIceServer = env.VITE_TURN_URLS
  ? { urls: String(env.VITE_TURN_URLS).split(','), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }
  : {
      // public community relay (Open Relay Project) – fine for casual games
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    };
const ICE = {
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
      turn,
    ],
  },
};

const JOIN_TIMEOUT_MS = 30000;

export const peerTransport: Transport = {
  host(code, onLink) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOpen = () => {
        const peer = new Peer(PREFIX + code, ICE);
        peer.on('open', () => resolve());
        peer.on('connection', (conn) => conn.on('open', () => onLink(wrapConn(conn))));
        peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
        peer.on('error', (e: any) => {
          // after a page refresh the broker may still hold our old id for a few seconds
          if (e.type === 'unavailable-id' && attempts++ < 10) {
            peer.destroy();
            setTimeout(tryOpen, 2000);
          } else if (e.type !== 'peer-unavailable') reject(new Error(e.message ?? String(e)));
        });
      };
      tryOpen();
    });
  },
  join(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(ICE);
      peer.on('error', (e: any) =>
        reject(new Error(e.type === 'peer-unavailable' ? 'No game found with that code.' : e.message)),
      );
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const t = setTimeout(() => {
          const pc: RTCPeerConnection | undefined = conn.peerConnection;
          const ice = pc?.iceConnectionState ?? 'unknown';
          const why =
            !pc || ice === 'new'
              ? 'The host did not answer – make sure the host tab is open and in the foreground, then try again.'
              : `A direct connection could not be made (network state: ${ice}). One of the networks is blocking peer-to-peer traffic – try another network (e.g. Wi-Fi instead of mobile data).`;
          peer.destroy();
          reject(new Error(`Could not reach the host. ${why}`));
        }, JOIN_TIMEOUT_MS);
        conn.on('open', () => {
          clearTimeout(t);
          resolve(wrapConn(conn));
        });
        conn.on('error', (e: any) => {
          clearTimeout(t);
          reject(new Error(`Connection error: ${e?.message ?? e}`));
        });
      });
    });
  },
};

// ------------------------------------- BroadcastChannel (same browser, tabs)

type BcMsg = { kind: 'hello' | 'welcome' | 'msg' | 'bye'; from: string; to: string; data?: unknown };

export const tabTransport: Transport = {
  async host(code, onLink) {
    const ch = new BroadcastChannel(PREFIX + code);
    const links = new Map<string, { msg: ((m: any) => void)[]; close: (() => void)[] }>();
    ch.onmessage = (ev: MessageEvent<BcMsg>) => {
      const m = ev.data;
      if (m.to !== 'host') return;
      if (m.kind === 'hello') {
        const h = { msg: [] as ((m: any) => void)[], close: [] as (() => void)[] };
        links.set(m.from, h);
        ch.postMessage({ kind: 'welcome', from: 'host', to: m.from } satisfies BcMsg);
        onLink({
          send: (data) => ch.postMessage({ kind: 'msg', from: 'host', to: m.from, data } satisfies BcMsg),
          onMessage: (cb) => h.msg.push(cb),
          onClose: (cb) => h.close.push(cb),
        });
      } else if (m.kind === 'msg') links.get(m.from)?.msg.forEach((cb) => cb(m.data));
      else if (m.kind === 'bye') {
        links.get(m.from)?.close.forEach((cb) => cb());
        links.delete(m.from);
      }
    };
  },
  join(code) {
    return new Promise((resolve, reject) => {
      const ch = new BroadcastChannel(PREFIX + code);
      const me = Math.random().toString(36).slice(2);
      const msg: ((m: any) => void)[] = [];
      const t = setTimeout(() => reject(new Error('No game found with that code (in this browser).')), 3000);
      ch.onmessage = (ev: MessageEvent<BcMsg>) => {
        const m = ev.data;
        if (m.to !== me) return;
        if (m.kind === 'welcome') {
          clearTimeout(t);
          resolve({
            send: (data) => ch.postMessage({ kind: 'msg', from: me, to: 'host', data } satisfies BcMsg),
            onMessage: (cb) => msg.push(cb),
            onClose: () => {},
          });
        } else if (m.kind === 'msg') msg.forEach((cb) => cb(m.data));
      };
      window.addEventListener('beforeunload', () => ch.postMessage({ kind: 'bye', from: me, to: 'host' }));
      ch.postMessage({ kind: 'hello', from: me, to: 'host' } satisfies BcMsg);
    });
  },
};

export const getTransport = (): Transport =>
  new URLSearchParams(location.search).has('tabs') ? tabTransport : peerTransport;
