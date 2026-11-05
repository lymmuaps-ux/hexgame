import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const SIZE = 0.42;
const GROUND = 0.22 + SIZE / 2; // tile tops are at y = 0.22
const FLIGHT = 1.3; // seconds in the air / tumbling
const HOLD = 2.4; // seconds the dice stay visible after landing
const FADE = 0.35;

// BoxGeometry face order: +x, -x, +y, -y, +z, -z  (opposite faces sum to 7)
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_NORMALS: Record<number, THREE.Vector3> = {
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
};
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.27, 0.24], [0.73, 0.24], [0.27, 0.5], [0.73, 0.5], [0.27, 0.76], [0.73, 0.76]],
};

function faceTexture(v: number) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.direction = 'ltr'; // never mirror ratios like "3 : 1" when the page is right-to-left
  g.fillStyle = '#fbf6ea';
  g.fillRect(0, 0, s, s);
  g.fillStyle = v === 1 ? '#c62828' : '#2b2118';
  for (const [x, y] of PIPS[v]) {
    g.beginPath();
    g.arc(x * s, y * s, v === 1 ? 17 : 12, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

interface Throw {
  die: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  final: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  height: number;
}

/** Two dice that get tossed onto the board and land on given values. */
export class Dice {
  readonly group = new THREE.Group();
  private dice: THREE.Mesh[];
  private throws: Throw[] = [];
  private t = -1;
  private landed = true;
  private onLand: (() => void) | null = null;

  constructor() {
    const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35 }));
    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.06);
    this.dice = [0, 1].map(() => {
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true;
      m.visible = false;
      this.group.add(m);
      return m;
    });
  }

  get busy() {
    return this.t >= 0;
  }

  /** Throw the dice so they come to rest showing `values`. */
  roll(values: [number, number], onLand: () => void) {
    // tossed in from the near edge of the island, landing just below the centre
    const side = Math.random() < 0.5 ? -1 : 1;
    const targets = [new THREE.Vector3(-0.38, GROUND, 0.75), new THREE.Vector3(0.38, GROUND, 1.05)];
    this.throws = this.dice.map((die, i) => {
      const to = targets[i].clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
      const from = new THREE.Vector3(side * (3.2 + i * 0.5), GROUND, 4.2 + i * 0.4);
      const final = new THREE.Quaternion()
        .setFromUnitVectors(FACE_NORMALS[values[i]], new THREE.Vector3(0, 1, 0))
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2));
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
      die.visible = true;
      die.scale.setScalar(1);
      return { die, from, to, final, axis, spin: Math.PI * (5 + Math.random() * 3), height: 1.8 + Math.random() * 0.5 };
    });
    this.t = 0;
    this.landed = false;
    this.onLand = onLand;
    this.apply();
  }

  tick(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    this.apply();
    if (!this.landed && this.t >= FLIGHT) {
      this.landed = true;
      this.onLand?.();
    }
    if (this.t > FLIGHT + HOLD + FADE) {
      this.t = -1;
      this.dice.forEach((d) => (d.visible = false));
    }
  }

  private apply() {
    const u = Math.min(1, this.t / FLIGHT);
    const q = new THREE.Quaternion();
    for (const th of this.throws) {
      // slide in, bouncing three times with decaying height
      th.die.position.lerpVectors(th.from, th.to, easeOut(u));
      th.die.position.y = GROUND + th.height * (1 - u) * (1 - u) * Math.abs(Math.cos(u * Math.PI * 2.5));
      // tumble: extra spin around a random axis that unwinds exactly to the final face
      q.setFromAxisAngle(th.axis, (1 - easeOut(u)) * th.spin);
      th.die.quaternion.copy(q).multiply(th.final);
      const fadeT = this.t - FLIGHT - HOLD;
      if (fadeT > 0) th.die.scale.setScalar(Math.max(0.001, 1 - fadeT / FADE));
    }
  }
}
