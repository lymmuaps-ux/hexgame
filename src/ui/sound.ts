/**
 * Sound effects, synthesized with the Web Audio API (no audio files to download).
 * Browsers only allow audio after a user gesture, so nothing plays until the first tap.
 */

type Wave = OscillatorType;

class SoundFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantAmbience = false;
  private last = new Map<string, number>();
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem('hexhold-sound') !== 'off';
    } catch { /* storage unavailable */ }
    const unlock = () => {
      this.audio();
      if (this.wantAmbience) this.startAmbience();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try { localStorage.setItem('hexhold-sound', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  private audio(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.6 : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** ready to make sound right now? (unlocked, enabled, not spamming the same effect) */
  private ready(name: string, gapMs = 40): AudioContext | null {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return null;
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < gapMs) return null;
    this.last.set(name, now);
    return this.ctx;
  }

  // -------------------------------------------------------------- primitives

  private tone(freq: number, dur: number, o: { type?: Wave; vol?: number; at?: number; slide?: number; attack?: number } = {}) {
    const ctx = this.ctx!, t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.25, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, o: { vol?: number; at?: number; freq?: number; q?: number; filter?: BiquadFilterType; slide?: number; attack?: number } = {}) {
    const ctx = this.ctx!, t = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** a short woody "tock" (dice on wood, pieces on the board) */
  private knock(at: number, pitch = 1, vol = 0.35) {
    this.tone(180 * pitch, 0.09, { type: 'triangle', vol, at, slide: 90 * pitch });
    this.noise(0.05, { vol: vol * 0.8, at, freq: 2400 * pitch, q: 2 });
  }

  // ------------------------------------------------------------------ effects

  /** dice shaken in the hand, then tossed: rattles followed by three bounces */
  diceRoll() {
    if (!this.ready('dice', 300)) return;
    for (let i = 0; i < 9; i++) this.noise(0.035, { vol: 0.18, at: i * 0.045 + Math.random() * 0.02, freq: 3200 + Math.random() * 1500, q: 4 });
    [0.5, 0.82, 1.08, 1.22].forEach((at, k) => {
      this.knock(at, 1.1 - k * 0.05, 0.32 - k * 0.06);
      this.knock(at + 0.03 + Math.random() * 0.03, 1.25, 0.2 - k * 0.04);
    });
  }

  /** dice settled; a 7 sounds ominous */
  diceLand(sum: number) {
    if (!this.ready('land', 300)) return;
    if (sum === 7) {
      this.tone(70, 0.9, { type: 'sawtooth', vol: 0.12, slide: 45, attack: 0.05 });
      this.noise(0.9, { vol: 0.12, freq: 180, filter: 'lowpass', attack: 0.08 });
      this.tone(110, 0.6, { type: 'triangle', vol: 0.12, at: 0.15, slide: 82 });
    } else {
      this.tone(660, 0.35, { type: 'sine', vol: 0.12 });
      this.tone(990, 0.3, { type: 'sine', vol: 0.06, at: 0.05 });
    }
  }

  /** a resource card lands in a hand (pitch varies per resource) */
  card(resourceIndex = 0) {
    if (!this.ready('card', 60)) return;
    this.noise(0.08, { vol: 0.16, freq: 5000, filter: 'highpass', slide: 1500 });
    const notes = [523, 587, 659, 784, 880];
    this.tone(notes[resourceIndex % 5], 0.18, { type: 'triangle', vol: 0.07, at: 0.03 });
  }

  build(kind: 'road' | 'settlement' | 'city') {
    if (!this.ready('build-' + kind, 120)) return;
    if (kind === 'road') {
      this.knock(0, 1.3, 0.3);
      this.knock(0.09, 1.15, 0.22);
    } else if (kind === 'settlement') {
      this.tone(120, 0.18, { type: 'sine', vol: 0.4, at: 0.25, slide: 60 });
      this.knock(0.25, 0.9, 0.3);
      [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.08, at: 0.32 + i * 0.06 }));
    } else {
      this.tone(90, 0.25, { type: 'sine', vol: 0.45, at: 0.25, slide: 45 });
      this.knock(0.25, 0.7, 0.35);
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.09, at: 0.32 + i * 0.07 }));
    }
  }

  buyCard() {
    if (!this.ready('buy', 150)) return;
    for (let i = 0; i < 3; i++) this.noise(0.06, { vol: 0.15, at: i * 0.06, freq: 4500, filter: 'highpass' });
    this.tone(880, 0.12, { type: 'triangle', vol: 0.06, at: 0.2 });
  }

  /** playing a fortune card: a sparkle */
  playCard() {
    if (!this.ready('play', 150)) return;
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', vol: 0.06, at: i * 0.05 }));
    this.noise(0.4, { vol: 0.05, freq: 7000, filter: 'highpass', attack: 0.05 });
  }

  steal() {
    if (!this.ready('steal', 150)) return;
    this.noise(0.3, { vol: 0.18, freq: 600, slide: 3000, q: 3, attack: 0.05 });
    this.tone(330, 0.15, { type: 'triangle', vol: 0.06, at: 0.22, slide: 220 });
  }

  /** coins clinking */
  trade() {
    if (!this.ready('trade', 150)) return;
    [0, 0.07, 0.15].forEach((at, i) => {
      this.tone(2400 + i * 300, 0.12, { type: 'sine', vol: 0.07, at });
      this.tone(3600 + i * 200, 0.08, { type: 'sine', vol: 0.04, at: at + 0.005 });
    });
  }

  discard() {
    if (!this.ready('discard', 150)) return;
    this.noise(0.25, { vol: 0.14, freq: 1200, slide: 300, attack: 0.02 });
  }

  /** the Raider lands on a tile */
  raider() {
    if (!this.ready('raider', 300)) return;
    this.tone(65, 0.35, { type: 'sine', vol: 0.45, slide: 40 });
    this.noise(0.3, { vol: 0.15, freq: 300, filter: 'lowpass' });
  }

  yourTurn() {
    if (!this.ready('turn', 500)) return;
    this.tone(784, 0.25, { type: 'sine', vol: 0.14 });
    this.tone(1175, 0.4, { type: 'sine', vol: 0.12, at: 0.14 });
  }

  otherTurn() {
    if (!this.ready('turn', 500)) return;
    this.tone(523, 0.12, { type: 'sine', vol: 0.05 });
  }

  award() {
    if (!this.ready('award', 300)) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 0.5 : 0.18, { type: 'square', vol: 0.05, at: i * 0.11 }));
  }

  win() {
    if (!this.ready('win', 1000)) return;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => {
      this.tone(f, i === notes.length - 1 ? 0.9 : 0.2, { type: 'square', vol: 0.05, at: i * 0.13 });
      this.tone(f / 2, i === notes.length - 1 ? 0.9 : 0.2, { type: 'triangle', vol: 0.06, at: i * 0.13 });
    });
  }

  pop() {
    if (!this.ready('pop', 120)) return;
    this.tone(500, 0.08, { type: 'sine', vol: 0.12, slide: 900 });
  }

  whoosh() {
    if (!this.ready('whoosh', 80)) return;
    this.noise(0.35, { vol: 0.12, freq: 400, slide: 2500, q: 2, attack: 0.1 });
  }

  splat(big = false) {
    if (!this.ready('splat', 80)) return;
    this.noise(big ? 0.25 : 0.15, { vol: big ? 0.35 : 0.2, freq: 700, filter: 'lowpass', slide: 200 });
    this.tone(big ? 120 : 200, 0.12, { type: 'sine', vol: 0.15, slide: 70 });
  }

  click() {
    if (!this.ready('click', 30)) return;
    this.tone(1200, 0.03, { type: 'square', vol: 0.025 });
  }

  error() {
    if (!this.ready('error', 300)) return;
    this.tone(220, 0.12, { type: 'triangle', vol: 0.12 });
    this.tone(180, 0.18, { type: 'triangle', vol: 0.12, at: 0.1 });
  }

  /** soft ocean waves under the 3D island */
  setAmbience(on: boolean) {
    this.wantAmbience = on;
    if (on) this.startAmbience();
    else this.stopAmbience();
  }

  private startAmbience() {
    const ctx = this.ctx;
    if (!ctx || this.ambience || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    // slow swell, like waves rolling in
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.12;
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(g.gain);
    const base = ctx.createConstantSource();
    base.offset.value = 0.035;
    base.connect(g.gain);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    lfo.start();
    base.start();
    this.ambience = { src, gain: g };
  }

  private stopAmbience() {
    if (!this.ambience) return;
    try { this.ambience.src.stop(); } catch { /* already stopped */ }
    this.ambience.gain.disconnect();
    this.ambience = null;
  }
}

export const sound = new SoundFx();
