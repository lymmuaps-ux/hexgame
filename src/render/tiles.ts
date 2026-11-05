import * as THREE from 'three';
import { HEX_SIZE } from '../game/board';
import { TileType } from '../game/types';

/**
 * Detailed terrain tiles: each tile is a thick board piece (earthy sides, framed top)
 * with a little scene on it. The centre is kept free for the number token.
 * Objects with `userData.spin` are rotated by the board every frame (windmill sails).
 */

export const TILE_COLORS: Record<TileType, number> = {
  timber: 0x3f8f3a,
  clay: 0xc96a3a,
  wool: 0xa5d66b,
  grain: 0xe8c547,
  ore: 0x9aa0aa,
  desert: 0xe3cf9a,
};

const mats = new Map<string, THREE.MeshStandardMaterial>();
/** shared flat-shaded materials (one per colour) */
const m = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const key = color + JSON.stringify(extra);
  let mat = mats.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });
    mats.set(key, mat);
  }
  return mat;
};
const mesh = (geo: THREE.BufferGeometry, color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
  new THREE.Mesh(geo, m(color, extra));

function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const shade = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k).getHex();

// ------------------------------------------------------------------- base

/** the board piece: earthy sides, slightly bevelled top in the terrain colour, a framed inner field */
export function tileBase(type: TileType): THREE.Group {
  const g = new THREE.Group();
  const col = TILE_COLORS[type];
  const side = m(shade(0x7a5534, type === 'desert' ? 1.25 : 1));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(HEX_SIZE * 0.95, HEX_SIZE * 0.99, 0.18, 6), [side, m(shade(col, 0.82)), side]);
  body.position.y = 0.09;
  const field = mesh(new THREE.CylinderGeometry(HEX_SIZE * 0.88, HEX_SIZE * 0.93, 0.04, 6), col);
  field.position.y = 0.2;
  body.receiveShadow = true;
  field.receiveShadow = true;
  g.add(body, field);
  return g;
}

// --------------------------------------------------------------- builders

type Rng = () => number;

/** a spot on the tile, away from the centre token; `i` of `n` spreads them around */
function spot(rng: Rng, i: number, n: number, rMin = 0.42, rMax = 0.7) {
  const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / n);
  const r = rMin + rng() * (rMax - rMin);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, a };
}

function pine(rng: Rng) {
  const g = new THREE.Group();
  const h = 0.22 + rng() * 0.1;
  const trunk = mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.08, 5), 0x6d4c2f);
  trunk.position.y = 0.04;
  const green = rng() > 0.5 ? 0x1f5e24 : 0x2a6e2e;
  const low = mesh(new THREE.ConeGeometry(0.11, h * 0.7, 6), green);
  low.position.y = 0.08 + h * 0.3;
  const high = mesh(new THREE.ConeGeometry(0.075, h * 0.6, 6), shade(green, 1.15));
  high.position.y = 0.08 + h * 0.7;
  g.add(trunk, low, high);
  return g;
}

function leafy(rng: Rng) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 5), 0x7a5634);
  trunk.position.y = 0.06;
  const crown = mesh(new THREE.IcosahedronGeometry(0.09 + rng() * 0.03, 0), rng() > 0.5 ? 0x4f9d3a : 0x3c8a35);
  crown.position.y = 0.17;
  crown.scale.y = 0.85;
  g.add(trunk, crown);
  return g;
}

function sheep(rng: Rng) {
  const g = new THREE.Group();
  const body = mesh(new THREE.IcosahedronGeometry(0.06, 0), 0xfafafa);
  body.scale.set(1.3, 0.9, 1);
  body.position.y = 0.07;
  const head = mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), 0x333333);
  head.position.set(0.08, 0.09, 0);
  for (const [x, z] of [[0.04, 0.03], [0.04, -0.03], [-0.04, 0.03], [-0.04, -0.03]]) {
    const leg = mesh(new THREE.BoxGeometry(0.012, 0.04, 0.012), 0x333333);
    leg.position.set(x, 0.02, z);
    g.add(leg);
  }
  g.add(body, head);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

function fence(len: number) {
  const g = new THREE.Group();
  const wood = 0x9b7448;
  const posts = Math.max(2, Math.round(len / 0.12));
  for (let i = 0; i <= posts; i++) {
    const p = mesh(new THREE.BoxGeometry(0.018, 0.07, 0.018), wood);
    p.position.set(-len / 2 + (i / posts) * len, 0.035, 0);
    g.add(p);
  }
  for (const y of [0.03, 0.055]) {
    const rail = mesh(new THREE.BoxGeometry(len, 0.01, 0.01), wood);
    rail.position.y = y;
    g.add(rail);
  }
  return g;
}

function windmill() {
  const g = new THREE.Group();
  const tower = mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 8), 0xf1e9d6);
  tower.position.y = 0.15;
  const roof = mesh(new THREE.ConeGeometry(0.07, 0.09, 8), 0xa4472b);
  roof.position.y = 0.34;
  const door = mesh(new THREE.BoxGeometry(0.04, 0.06, 0.01), 0x5a3d22);
  door.position.set(0, 0.03, 0.075);
  const hub = new THREE.Group();
  hub.position.set(0, 0.27, 0.07);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    const spar = mesh(new THREE.BoxGeometry(0.012, 0.2, 0.008), 0x6d4c2f);
    spar.position.y = 0.1;
    const sail = mesh(new THREE.BoxGeometry(0.045, 0.15, 0.004), 0xfaf3df);
    sail.position.set(0.026, 0.11, 0);
    arm.add(spar, sail);
    hub.add(arm);
  }
  hub.userData.spin = 1.4;
  g.add(tower, roof, door, hub);
  return g;
}

function haystack() {
  const g = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 8), 0xd9ad3c);
  base.position.y = 0.03;
  const top = mesh(new THREE.ConeGeometry(0.06, 0.07, 8), 0xe2bb4f);
  top.position.y = 0.095;
  g.add(base, top);
  return g;
}

function mountain(rng: Rng, h: number) {
  const g = new THREE.Group();
  const peak = mesh(new THREE.ConeGeometry(h * 0.62, h, 6), rng() > 0.5 ? 0x7d828b : 0x8c9098);
  peak.position.y = h / 2;
  peak.rotation.y = rng() * Math.PI;
  const snow = mesh(new THREE.ConeGeometry(h * 0.62 * 0.32, h * 0.32, 6), 0xf7f9fb);
  snow.position.y = h - h * 0.16 + 0.005;
  snow.rotation.y = peak.rotation.y;
  g.add(peak, snow);
  return g;
}

function mine() {
  const g = new THREE.Group();
  const hill = mesh(new THREE.SphereGeometry(0.13, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0x80848c);
  hill.scale.y = 0.9;
  const hole = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), 0x1d1a17);
  hole.position.set(0, 0.035, 0.1);
  const beam = mesh(new THREE.BoxGeometry(0.1, 0.015, 0.02), 0x8b6a43);
  beam.position.set(0, 0.075, 0.115);
  const postL = mesh(new THREE.BoxGeometry(0.015, 0.075, 0.02), 0x8b6a43);
  postL.position.set(-0.042, 0.037, 0.115);
  const postR = postL.clone();
  postR.position.x = 0.042;
  // ore cart on a little track
  const cart = mesh(new THREE.BoxGeometry(0.06, 0.035, 0.04), 0x5d4a3a);
  cart.position.set(0.02, 0.03, 0.2);
  const ore = mesh(new THREE.DodecahedronGeometry(0.022, 0), 0xb9c0ca, { metalness: 0.4, roughness: 0.4 });
  ore.position.set(0.02, 0.055, 0.2);
  g.add(hill, hole, beam, postL, postR, cart, ore);
  return g;
}

function bricks(rng: Rng) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3 - i; j++) {
      const b = mesh(new THREE.BoxGeometry(0.09, 0.045, 0.05), rng() > 0.3 ? 0xa4471f : 0x8f3d1a);
      b.position.set((j - (2 - i) / 2) * 0.1, 0.022 + i * 0.047, 0);
      g.add(b);
    }
  g.rotation.y = rng() * Math.PI;
  return g;
}

function kiln() {
  const g = new THREE.Group();
  const dome = mesh(new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xb5653c);
  const mouth = mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), 0x2b1a12);
  mouth.position.set(0, 0.02, 0.08);
  const glow = mesh(new THREE.BoxGeometry(0.035, 0.025, 0.01), 0xff8a3d, { emissive: 0xff6a1a, emissiveIntensity: 1.2 });
  glow.position.set(0, 0.018, 0.09);
  const chimney = mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.1, 6), 0x8f3d1a);
  chimney.position.set(-0.03, 0.1, -0.02);
  g.add(dome, mouth, glow, chimney);
  return g;
}

function cactus(rng: Rng) {
  const g = new THREE.Group();
  const green = 0x5d8f3c;
  const h = 0.16 + rng() * 0.08;
  const t = mesh(new THREE.CylinderGeometry(0.028, 0.032, h, 6), green);
  t.position.y = h / 2;
  const arm = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 6), green);
  arm.position.set(0.045, h * 0.6, 0);
  const elbow = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), green);
  elbow.rotation.z = Math.PI / 2;
  elbow.position.set(0.028, h * 0.45, 0);
  g.add(t, arm, elbow);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

function miniPalm(rng: Rng) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.2, 5), 0x8b6a43);
  trunk.position.y = 0.1;
  trunk.rotation.z = 0.15;
  g.add(trunk);
  for (let i = 0; i < 5; i++) {
    const leaf = mesh(new THREE.ConeGeometry(0.035, 0.16, 4), 0x3d9a3f, { side: THREE.DoubleSide });
    leaf.scale.z = 0.3;
    leaf.position.set(0.015, 0.2, 0);
    leaf.rotation.y = (i / 5) * Math.PI * 2 + rng();
    leaf.rotateZ(Math.PI / 2 + 0.5);
    leaf.translateY(0.07);
    g.add(leaf);
  }
  return g;
}

function tufts(g: THREE.Group, rng: Rng, color: number, n: number) {
  for (let i = 0; i < n; i++) {
    const p = spot(rng, i, n, 0.36, 0.8);
    const t = mesh(new THREE.ConeGeometry(0.018, 0.05, 3), color);
    t.position.set(p.x, 0.025, p.z);
    g.add(t);
  }
}

function flowers(g: THREE.Group, rng: Rng, n: number) {
  const colors = [0xffffff, 0xffd84d, 0xe86a9a, 0x9f7be0];
  for (let i = 0; i < n; i++) {
    const p = spot(rng, i, n, 0.38, 0.78);
    const f = mesh(new THREE.SphereGeometry(0.014, 5, 4), colors[i % colors.length]);
    f.position.set(p.x, 0.018, p.z);
    g.add(f);
  }
}

// ------------------------------------------------------------------ scenes

export function decorateTile(type: TileType, id: number): THREE.Group {
  const rng = seeded(id + 7);
  const g = new THREE.Group();
  const put = (o: THREE.Object3D, p: { x: number; z: number }, rotY?: number) => {
    o.position.x += p.x;
    o.position.z += p.z;
    if (rotY !== undefined) o.rotation.y = rotY;
    g.add(o);
    return o;
  };

  switch (type) {
    case 'timber': {
      const n = 11;
      for (let i = 0; i < n; i++) put(i % 3 === 1 ? leafy(rng) : pine(rng), spot(rng, i, n, 0.4, 0.76));
      const stump = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.035, 7), 0x8b6a43);
      stump.position.y = 0.017;
      put(stump, spot(rng, 2, 6, 0.36, 0.42));
      const logs = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const log = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), 0x7a5634);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 0.02 + (i === 2 ? 0.03 : 0), (i === 2 ? 0 : i - 0.5) * 0.042);
        logs.add(log);
      }
      put(logs, spot(rng, 5, 6, 0.38, 0.45), rng() * Math.PI);
      tufts(g, rng, 0x2f7a2f, 6);
      break;
    }
    case 'clay': {
      for (let i = 0; i < 2; i++) {
        const hill = mesh(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), i ? 0xb85a30 : 0xa94f28);
        hill.scale.set(1, 0.55, 0.8);
        put(hill, spot(rng, i * 3, 6, 0.55, 0.62), rng() * 3);
      }
      put(bricks(rng), spot(rng, 1, 6, 0.48, 0.6));
      put(bricks(rng), spot(rng, 4, 6, 0.48, 0.6));
      put(kiln(), spot(rng, 2, 6, 0.5, 0.6), rng() * Math.PI * 2);
      // clay pit
      const pit = mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.012, 7), 0x7b3518);
      pit.position.y = 0.006;
      put(pit, spot(rng, 5, 6, 0.5, 0.6));
      break;
    }
    case 'wool': {
      for (let i = 0; i < 6; i++) put(sheep(rng), spot(rng, i, 6, 0.42, 0.72));
      const f1 = fence(0.42);
      put(f1, { x: 0, z: 0.66 }, 0);
      const f2 = fence(0.42);
      put(f2, { x: 0.57, z: -0.33 }, Math.PI / 3);
      flowers(g, rng, 10);
      tufts(g, rng, 0x7cb84a, 8);
      break;
    }
    case 'grain': {
      // rows of wheat across the field (centre left free for the token)
      const dir = rng() * Math.PI;
      const rows = new THREE.Group();
      for (let r = -4; r <= 4; r++) {
        const off = r * 0.15;
        for (let s = -5; s <= 5; s++) {
          const x = s * 0.13, z = off;
          const d = Math.hypot(x, z);
          if (d < 0.38 || d > 0.74) continue;
          const stalk = mesh(new THREE.ConeGeometry(0.03, 0.1 + rng() * 0.04, 4), rng() > 0.5 ? 0xc99a1b : 0xd8aa2a);
          stalk.position.set(x, 0.05, z);
          rows.add(stalk);
        }
      }
      rows.rotation.y = dir;
      g.add(rows);
      const millSpot = spot(rng, 0, 1, 0.6, 0.62);
      // the windmill stands on a small clearing instead of wheat
      rows.children = rows.children.filter((c) => {
        const wp = c.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), dir);
        return Math.hypot(wp.x - millSpot.x, wp.z - millSpot.z) > 0.16;
      });
      put(windmill(), millSpot, -millSpot.a + Math.PI / 2);
      put(haystack(), spot(rng, 2, 3, 0.55, 0.62));
      break;
    }
    case 'ore': {
      put(mountain(rng, 0.42), spot(rng, 0, 3, 0.52, 0.56));
      put(mountain(rng, 0.32), spot(rng, 1, 3, 0.55, 0.6));
      put(mountain(rng, 0.26), spot(rng, 1.6, 3, 0.6, 0.66));
      put(mine(), spot(rng, 2.3, 3, 0.52, 0.56), rng() * Math.PI * 2);
      for (let i = 0; i < 5; i++) {
        const r = mesh(new THREE.DodecahedronGeometry(0.025 + rng() * 0.03, 0), 0x6e737c);
        r.position.y = 0.02;
        put(r, spot(rng, i, 5, 0.38, 0.78));
      }
      break;
    }
    case 'desert': {
      for (let i = 0; i < 3; i++) {
        const dune = mesh(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? 0xd9c189 : 0xe8d39f);
        dune.scale.set(1, 0.28, 0.55);
        put(dune, spot(rng, i, 3, 0.5, 0.62), rng() * Math.PI);
      }
      put(cactus(rng), spot(rng, 0.5, 3, 0.45, 0.6));
      put(cactus(rng), spot(rng, 1.5, 3, 0.45, 0.6));
      // oasis: a little pond with palms (kept beside the Raider's spot)
      const o = spot(rng, 2.5, 3, 0.55, 0.58);
      const pond = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 12), 0x3fb6c9, { roughness: 0.2, metalness: 0.1 });
      pond.position.y = 0.006;
      put(pond, o);
      put(miniPalm(rng), { x: o.x + 0.12, z: o.z - 0.05 });
      put(miniPalm(rng), { x: o.x - 0.1, z: o.z + 0.08 });
      break;
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
