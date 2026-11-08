import type { VoiceChunk } from '../net/session';

/**
 * Walkie-talkie style voice chat over the game's message relay.
 * The mic is off by default. While it is on, speech is recorded in short,
 * self-contained pieces (each one decodable on its own) and sent to everyone;
 * incoming pieces are queued per speaker and played back to back.
 * Expect roughly a second of delay.
 */

const PIECE_MS = 800;

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export type MicError = 'denied' | 'unsupported';

export class Voice {
  /** my microphone is sending */
  live = false;
  /** I hear others (can be turned off) */
  listen = true;
  onChange: () => void = () => {};
  /** someone is talking: `from` is their seat (negative for spectators) */
  onSpeaking: (from: number) => void = () => {};
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private nextAt = new Map<number, number>();
  private speakingUntil = new Map<number, number>();

  constructor(private send: (c: VoiceChunk) => void) {
    // browsers only allow audio after a user gesture: unlock on the first tap anywhere
    const unlock = () => {
      this.audio();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
  }

  static supported() {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  isSpeaking(from: number) {
    return (this.speakingUntil.get(from) ?? 0) > performance.now();
  }

  private audio(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** turn the microphone on or off; resolves to an error code when it cannot start */
  async toggleMic(): Promise<MicError | null> {
    if (this.live) {
      this.stopMic();
      return null;
    }
    if (!Voice.supported()) return 'unsupported';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return 'denied';
    }
    this.audio();
    this.live = true;
    this.onChange();
    this.recordPiece();
    return null;
  }

  stopMic() {
    this.live = false;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onChange();
  }

  setListen(on: boolean) {
    this.listen = on;
    this.nextAt.clear();
    this.onChange();
  }

  /** record one self-contained piece, send it, and start the next while the mic stays on */
  private recordPiece() {
    if (!this.live || !this.stream) return;
    const mime = pickMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 });
    } catch {
      this.stopMic();
      return;
    }
    this.recorder = rec;
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = async () => {
      if (this.live) this.recordPiece(); // start the next piece right away to keep gaps tiny
      const blob = new Blob(parts, { type: rec.mimeType || mime });
      if (blob.size < 200) return;
      try {
        this.send({ d: await toBase64(blob), m: blob.type });
      } catch { /* ignore one lost piece */ }
    };
    rec.start();
    setTimeout(() => rec.state === 'recording' && rec.stop(), PIECE_MS);
  }

  /** play a piece someone else recorded */
  async receive(from: number, chunk: VoiceChunk) {
    if (!this.listen) return;
    const ctx = this.audio();
    let buf: AudioBuffer;
    try {
      const bytes = Uint8Array.from(atob(chunk.d), (c) => c.charCodeAt(0));
      buf = await ctx.decodeAudioData(bytes.buffer);
    } catch {
      return; // a format this browser can't decode
    }
    const now = ctx.currentTime;
    let at = this.nextAt.get(from) ?? 0;
    // keep latency bounded: if we fell behind or the queue grew too long, restart the queue
    if (at < now + 0.05 || at > now + 2.5) at = now + 0.12;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(at);
    this.nextAt.set(from, at + buf.duration);
    this.speakingUntil.set(from, performance.now() + (at - now + buf.duration) * 1000 + 250);
    this.onSpeaking(from);
  }
}
