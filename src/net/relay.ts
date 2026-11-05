import mqtt, { MqttClient } from 'mqtt';
import type { Link, Transport } from './transport';
import { M } from '../game/msg';

/**
 * Relay transport: every message goes through free public MQTT servers over secure
 * WebSockets (ordinary web traffic, which networks don't block). We connect to
 * several servers at once and publish on all of them; duplicates are dropped, so the
 * game keeps working as long as any one server is up.
 *
 * Override the server list for testing with ?broker=ws://host:port (repeatable).
 */
const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const NS = 'hexhold/v1';
const PING_MS = 4000;
const DEAD_MS = 20000;

const rid = () => Math.random().toString(36).slice(2, 12);
const brokers = () => {
  const custom = new URLSearchParams(location.search).getAll('broker');
  return custom.length ? custom : DEFAULT_BROKERS;
};

type Envelope = { id: string; from: string; kind: 'hello' | 'welcome' | 'msg' | 'ping' | 'bye' | 'reset'; data?: unknown };

class Bus {
  private clients: MqttClient[] = [];
  private handlers = new Map<string, (m: Envelope) => void>();
  private seen = new Set<string>();
  private seenOrder: string[] = [];

  static open(): Promise<Bus> {
    const bus = new Bus();
    return new Promise((resolve, reject) => {
      let settled = false;
      for (const url of brokers()) {
        const c = mqtt.connect(url, {
          clean: true, connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30, protocolVersion: 4,
          clientId: 'hexhold_' + rid(),
        });
        bus.clients.push(c);
        c.on('connect', () => {
          for (const t of bus.handlers.keys()) c.subscribe(t, { qos: 1 });
          if (!settled) {
            settled = true;
            resolve(bus);
          }
        });
        c.on('message', (_topic, payload) => bus.receive(_topic, payload));
        c.on('error', () => { /* other servers may still work; mqtt.js retries */ });
      }
      setTimeout(() => {
        if (settled) return;
        settled = true;
        bus.close();
        reject(new Error(M('net.noServer')));
      }, 12000);
    });
  }

  private receive(topic: string, payload: Uint8Array) {
    let m: Envelope;
    try {
      m = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    if (!m?.id || this.seen.has(m.id)) return;
    this.seen.add(m.id);
    this.seenOrder.push(m.id);
    if (this.seenOrder.length > 2000) this.seen.delete(this.seenOrder.shift()!);
    this.handlers.get(topic)?.(m);
  }

  subscribe(topic: string, h: (m: Envelope) => void) {
    this.handlers.set(topic, h);
    for (const c of this.clients) if (c.connected) c.subscribe(topic, { qos: 1 });
  }

  publish(topic: string, msg: Omit<Envelope, 'id'>) {
    const payload = JSON.stringify({ ...msg, id: rid() + rid() });
    for (const c of this.clients) if (c.connected) c.publish(topic, payload, { qos: 1 });
  }

  close() {
    for (const c of this.clients) c.end(true);
  }
}

export const relayTransport: Transport = {
  async host(code, onLink) {
    const bus = await Bus.open();
    const base = `${NS}/${code}`;
    type L = { msg: ((m: any) => void)[]; close: (() => void)[]; last: number };
    const links = new Map<string, L>();
    const drop = (id: string) => {
      const l = links.get(id);
      if (!l) return;
      links.delete(id);
      l.close.forEach((cb) => cb());
    };

    bus.subscribe(`${base}/host`, (m) => {
      const to = `${base}/c/${m.from}`;
      const l = links.get(m.from);
      if (m.kind === 'hello') {
        bus.publish(to, { from: 'host', kind: 'welcome' });
        if (l) return; // retried hello from a client we already know
        const nl: L = { msg: [], close: [], last: Date.now() };
        links.set(m.from, nl);
        onLink({
          send: (data) => links.get(m.from) === nl && bus.publish(to, { from: 'host', kind: 'msg', data }),
          onMessage: (cb) => nl.msg.push(cb),
          onClose: (cb) => nl.close.push(cb),
        });
        return;
      }
      if (!l) {
        // a client from before the host reloaded – tell it to re-join
        if (m.kind !== 'bye') bus.publish(to, { from: 'host', kind: 'reset' });
        return;
      }
      l.last = Date.now();
      if (m.kind === 'msg') l.msg.forEach((cb) => cb(m.data));
      else if (m.kind === 'bye') drop(m.from);
    });

    setInterval(() => {
      const now = Date.now();
      for (const [id, l] of links) {
        if (now - l.last > DEAD_MS) drop(id);
        else bus.publish(`${base}/c/${id}`, { from: 'host', kind: 'ping' });
      }
    }, PING_MS);
  },

  async join(code) {
    const bus = await Bus.open();
    const base = `${NS}/${code}`;
    const me = rid();
    const msgCbs: ((m: any) => void)[] = [];
    const closeCbs: (() => void)[] = [];
    let lastHost = Date.now();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      closeCbs.forEach((cb) => cb());
    };

    return new Promise<Link>((resolve, reject) => {
      let welcomed = false;
      bus.subscribe(`${base}/c/${me}`, (m) => {
        lastHost = Date.now();
        if (m.kind === 'welcome' && !welcomed) {
          welcomed = true;
          resolve({
            send: (data) => bus.publish(`${base}/host`, { from: me, kind: 'msg', data }),
            onMessage: (cb) => msgCbs.push(cb),
            onClose: (cb) => closeCbs.push(cb),
          });
        } else if (m.kind === 'msg') msgCbs.forEach((cb) => cb(m.data));
        else if (m.kind === 'reset') close();
      });

      // say hello until the host answers (covers subscription start-up delays)
      const started = Date.now();
      const hello = setInterval(() => {
        if (welcomed) return clearInterval(hello);
        if (Date.now() - started > 15000) {
          clearInterval(hello);
          bus.close();
          reject(new Error(M('net.noGame')));
          return;
        }
        bus.publish(`${base}/host`, { from: me, kind: 'hello' });
      }, 1500);
      bus.publish(`${base}/host`, { from: me, kind: 'hello' });

      setInterval(() => {
        if (!welcomed || closed) return;
        bus.publish(`${base}/host`, { from: me, kind: 'ping' });
        if (Date.now() - lastHost > DEAD_MS) close();
      }, PING_MS);
      window.addEventListener('beforeunload', () => bus.publish(`${base}/host`, { from: me, kind: 'bye' }));
    });
  },
};
