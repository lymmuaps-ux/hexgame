import * as THREE from 'three';

/**
 * Everything around the tiles: beach with an organic coastline, an earthy plateau,
 * turquoise shallows, surf, palms, rocks, a lighthouse, sailboats and seagulls.
 * All placement is seeded by the board so every player sees the same island.
 */

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

function seeded(seed: number) {
  let s = (seed % 233280) + 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** distance from the centre to the edge of a hexagon with corners at 0°, 60°, … */
const hexR = (a: number, R: number) => {
  const seg = Math.PI / 3;
  const local = ((a % seg) + seg) % seg - seg / 2;
  return (R * Math.cos(Math.PI / 6)) / Math.cos(local);
};

/** radius of the coastline at angle a */
const coast = (a: number) =>
  hexR(a, 5.35) * 0.7 + 4.85 * 0.3 + 0.13 * Math.sin(5 * a + 1) + 0.08 * Math.sin(11 * a + 2) + 0.05 * Math.sin(17 * a + 0.5);
/** radius of the plateau the tiles sit on */
const plateau = (a: number) => hexR(a, 4.72);

function ringShape(inner: (a: number) => number, outer: (a: number) => number, steps = 160) {
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = outer(a);
    const x = Math.cos(a) * r, y = -Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const hole = new THREE.Path();
  for (let i = steps; i >= 0; i--) {
    const a = (i / steps) * Math.PI * 2;
    const r = inner(a);
    const x = Math.cos(a) * r, y = -Math.sin(a) * r;
    if (i === steps) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  shape.holes.push(hole);
  return shape;
}

function flatRing(inner: (a: number) => number, outer: (a: number) => number, color: number, opacity: number, y: number) {
  const geo = new THREE.ShapeGeometry(ringShape(inner, outer));
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.25, depthWrite: false }));
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function palm(rng: () => number) {
  const g = new THREE.Group();
  const trunkMat = std(0x8b6a43);
  const lean = (rng() - 0.5) * 0.5;
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.035 - i * 0.003, 0.045 - i * 0.003, 0.16, 6), trunkMat);
    seg.position.set(lean * i * 0.06, y + 0.08, 0);
    seg.rotation.z = -lean * 0.4;
    g.add(seg);
    y += 0.15;
  }
  const leafMat = std(rng() > 0.5 ? 0x2e8b3a : 0x3d9a3f, { side: THREE.DoubleSide });
  const top = new THREE.Vector3(lean * 0.3, y, 0);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 4), leafMat);
    leaf.scale.set(1, 1, 0.25);
    leaf.position.copy(top);
    leaf.rotation.y = (i / 6) * Math.PI * 2 + rng() * 0.4;
    leaf.rotateZ(Math.PI / 2 + 0.45);
    leaf.translateY(0.19);
    g.add(leaf);
  }
  const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), std(0x5a3d22));
  coconut.position.copy(top).add(new THREE.Vector3(0.03, -0.04, 0.02));
  g.add(coconut);
  g.rotation.y = rng() * Math.PI * 2;
  g.scale.setScalar(0.9 + rng() * 0.35);
  return g;
}

function rock(rng: () => number, size: number) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), std(rng() > 0.5 ? 0x8d8a83 : 0x77746e));
  m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
  m.scale.y = 0.6 + rng() * 0.4;
  return m;
}

function lighthouse() {
  const g = new THREE.Group();
  const white = std(0xf5f2ea), red = std(0xc93a32);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 10), std(0x8d8a83));
  base.position.y = 0.06;
  g.add(base);
  for (let i = 0; i < 4; i++) {
    const r0 = 0.17 - i * 0.022, r1 = 0.17 - (i + 1) * 0.022;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.18, 10), i % 2 ? red : white);
    seg.position.y = 0.12 + 0.09 + i * 0.18;
    g.add(seg);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 10), std(0x333333));
  deck.position.y = 0.86;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffd54a, emissiveIntensity: 1.2 }));
  lamp.position.y = 0.94;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.1, 8), red);
  cap.position.y = 1.05;
  // rotating light beam
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.z = Math.PI / 2;
  beam.position.set(0.8, 0, 0);
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 0.94;
  beamPivot.add(beam);
  g.add(deck, lamp, cap, beamPivot);
  g.traverse((o) => (o.castShadow = true));
  beam.castShadow = false;
  g.userData.beam = beamPivot;
  return g;
}

function boat(rng: () => number) {
  const g = new THREE.Group();
  const hullColors = [0x8b5a2b, 0x2f5d8a, 0xa23b2a];
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.18), std(hullColors[Math.floor(rng() * 3)]));
  hull.position.y = 0.05;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 4), hull.material);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.x = Math.PI / 4;
  bow.scale.set(1, 1, 0.6);
  bow.position.set(0.33, 0.05, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 5), std(0x5a3d22));
  mast.position.set(0.02, 0.37, 0);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 0.45);
  sailShape.lineTo(-0.28, 0.02);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), std(0xfaf6ea, { side: THREE.DoubleSide }));
  sail.position.set(0.01, 0.13, 0);
  g.add(hull, bow, mast, sail);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function gull() {
  const g = new THREE.Group();
  const mat = std(0xffffff, { side: THREE.DoubleSide });
  const wingGeo = new THREE.BoxGeometry(0.22, 0.01, 0.06);
  wingGeo.translate(0.11, 0, 0);
  const left = new THREE.Mesh(wingGeo, mat);
  const right = new THREE.Mesh(wingGeo, mat);
  right.rotation.y = Math.PI;
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 5), mat);
  body.rotation.x = Math.PI / 2;
  g.add(left, right, body);
  g.userData.wings = [left, right];
  return g;
}

export class IslandDecor {
  readonly group = new THREE.Group();
  private foam: THREE.Mesh;
  private boats: { obj: THREE.Group; r: number; a: number; speed: number; phase: number }[] = [];
  private gulls: { obj: THREE.Group; r: number; a: number; speed: number; y: number; phase: number }[] = [];
  private beam: THREE.Object3D | null = null;

  /** `ports` are the dock positions (kept free of decorations) */
  constructor(ports: { x: number; z: number }[], seed: number) {
    const rng = seeded(seed);
    const nearPort = (x: number, z: number, d: number) => ports.some((p) => Math.hypot(p.x - x, p.z - z) < d);

    // beach: an extruded organic coastline
    const beachShape = new THREE.Shape();
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const r = coast(a);
      if (i === 0) beachShape.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
      else beachShape.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
    }
    const beachGeo = new THREE.ExtrudeGeometry(beachShape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.16, bevelSegments: 2, curveSegments: 1 });
    beachGeo.rotateX(-Math.PI / 2);
    const beach = new THREE.Mesh(beachGeo, std(0xe9d6a0, { roughness: 0.95 }));
    beach.position.y = -0.37;
    beach.receiveShadow = true;
    this.group.add(beach);

    // wet sand rim and the earthy plateau under the tiles
    this.group.add(flatRing((a) => coast(a) - 0.05, (a) => coast(a) + 0.2, 0xcdb37a, 0.9, 0.0));
    const plateauMesh = new THREE.Mesh(new THREE.CylinderGeometry(4.72, 4.95, 0.2, 6), std(0x7c5a3a));
    plateauMesh.rotation.y = Math.PI / 6;
    plateauMesh.position.y = 0.04;
    plateauMesh.receiveShadow = true;
    const grassRim = new THREE.Mesh(new THREE.CylinderGeometry(4.74, 4.74, 0.04, 6), std(0x6d9b45));
    grassRim.rotation.y = Math.PI / 6;
    grassRim.position.y = 0.15;
    grassRim.receiveShadow = true;
    this.group.add(plateauMesh, grassRim);

    // shallows (turquoise lagoon fading out) and surf
    this.group.add(flatRing((a) => coast(a) + 0.1, (a) => coast(a) + 0.9 + 0.15 * Math.sin(3 * a), 0x4fd0c8, 0.7, -0.03));
    this.group.add(flatRing((a) => coast(a) + 0.9 + 0.15 * Math.sin(3 * a), (a) => coast(a) + 2.2 + 0.3 * Math.sin(4 * a + 1), 0x2fa6b8, 0.4, -0.035));
    this.foam = flatRing((a) => coast(a) + 0.12, (a) => coast(a) + 0.26, 0xffffff, 0.7, -0.01);
    this.group.add(this.foam);

    // spots on the beach band between the plateau and the water
    const beachSpot = (a: number, t: number) => {
      const r0 = plateau(a) + 0.28, r1 = coast(a) - 0.12;
      const r = r0 + (r1 - r0) * t;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, room: r1 - r0 };
    };

    // lighthouse where it's farthest from any harbour
    let bestA = 0, bestD = -1;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const p = beachSpot(a, 0.55);
      const d = Math.min(...ports.map((q) => Math.hypot(q.x - p.x, q.z - p.z)));
      if (d > bestD && p.room > 0.25) { bestD = d; bestA = a; }
    }
    const lh = lighthouse();
    const lp = beachSpot(bestA, 0.55);
    lh.position.set(lp.x, 0.05, lp.z);
    this.beam = lh.userData.beam;
    this.group.add(lh);

    // palms
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < 9; tries++) {
      const a = rng() * Math.PI * 2;
      const p = beachSpot(a, 0.3 + rng() * 0.5);
      if (p.room < 0.2 || nearPort(p.x, p.z, 0.75) || Math.hypot(p.x - lp.x, p.z - lp.z) < 0.6) continue;
      const tree = palm(rng);
      tree.position.set(p.x, 0.05, p.z);
      tree.traverse((o) => (o.castShadow = true));
      this.group.add(tree);
      placed++;
    }

    // rocks on the beach and some half-sunk in the shallows
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const inWater = i % 3 === 0;
      const r = inWater ? coast(a) + 0.3 + rng() * 0.9 : plateau(a) + 0.2 + (coast(a) - plateau(a) - 0.25) * rng();
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (nearPort(x, z, 0.6)) continue;
      const m = rock(rng, inWater ? 0.08 + rng() * 0.12 : 0.04 + rng() * 0.07);
      m.position.set(x, inWater ? -0.04 : 0.06, z);
      m.castShadow = true;
      this.group.add(m);
    }

    // sailboats circling out at sea
    for (let i = 0; i < 3; i++) {
      const b = boat(rng);
      this.group.add(b);
      this.boats.push({ obj: b, r: 7.6 + i * 1.3 + rng(), a: rng() * Math.PI * 2, speed: (0.03 + rng() * 0.03) * (i % 2 ? 1 : -1), phase: rng() * 6 });
    }

    // seagulls overhead
    for (let i = 0; i < 4; i++) {
      const g = gull();
      this.group.add(g);
      this.gulls.push({ obj: g, r: 3 + rng() * 4, a: rng() * Math.PI * 2, speed: 0.25 + rng() * 0.2, y: 2.6 + rng() * 1.4, phase: rng() * 6 });
    }
  }

  tick(time: number, dt: number) {
    const t = time / 1000;
    (this.foam.material as THREE.MeshStandardMaterial).opacity = 0.45 + 0.3 * Math.sin(t * 1.6);
    this.foam.scale.setScalar(1 + 0.006 * Math.sin(t * 1.6));
    if (this.beam) this.beam.rotation.y = t * 0.9;
    for (const b of this.boats) {
      b.a += b.speed * dt;
      const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
      b.obj.position.set(x, -0.1 + 0.04 * Math.sin(t * 1.5 + b.phase), z);
      // face the direction of travel and rock on the waves
      b.obj.rotation.set(0.08 * Math.sin(t * 1.3 + b.phase), -b.a + (b.speed > 0 ? -Math.PI / 2 : Math.PI / 2), 0.06 * Math.sin(t * 1.1 + b.phase));
    }
    for (const g of this.gulls) {
      g.a += g.speed * dt;
      g.obj.position.set(Math.cos(g.a) * g.r, g.y + 0.15 * Math.sin(t + g.phase), Math.sin(g.a) * g.r);
      g.obj.rotation.set(0, -g.a, 0.25);
      const flap = Math.sin(t * 9 + g.phase) * 0.5;
      const [l, r] = g.obj.userData.wings as THREE.Mesh[];
      l.rotation.z = flap;
      r.rotation.z = -flap;
    }
  }
}
