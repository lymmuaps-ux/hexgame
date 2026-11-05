import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GEO, HEX_SIZE } from '../game/board';
import { GameState, RES_INFO, TileType } from '../game/types';

export type PickKind = 'vertex' | 'edge' | 'hex';
export interface Selectable {
  kind: PickKind;
  ids: number[];
  /** style of vertex highlight */
  style?: 'settlement' | 'city';
}

const TILE_COLORS: Record<TileType, number> = {
  timber: 0x3f8f3a,
  clay: 0xc96a3a,
  wool: 0xa5d66b,
  grain: 0xe8c547,
  ore: 0x9aa0aa,
  desert: 0xe3cf9a,
};

function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const std = (color: number | string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

function shadow<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function labelTexture(lines: string[], opts: { bg?: string; fg?: string; w?: number; h?: number } = {}) {
  const w = opts.w ?? 256, h = opts.h ?? 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.bg ?? 'rgba(255,248,230,0.95)';
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 28);
  g.fill();
  g.strokeStyle = '#5b3d1e';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = opts.fg ?? '#3b2a17';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 50px system-ui, sans-serif';
  lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 52));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function tokenTexture(n: number) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6ecd2';
  g.fillRect(0, 0, s, s);
  const red = n === 6 || n === 8;
  g.fillStyle = red ? '#c62828' : '#2b2118';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${red ? 130 : 118}px Georgia, serif`;
  g.fillText(String(n), s / 2, s / 2 - 18);
  const pips = 6 - Math.abs(7 - n);
  for (let i = 0; i < pips; i++) {
    g.beginPath();
    g.arc(s / 2 + (i - (pips - 1) / 2) * 22, s / 2 + 70, 8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ----------------------------------------------------------- decorations

function tree(rng: () => number) {
  const g = new THREE.Group();
  const h = 0.3 + rng() * 0.15;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 5), std(0x6d4c2f));
  trunk.position.y = 0.05;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.11 + rng() * 0.04, h, 6), std(rng() > 0.5 ? 0x1f5e24 : 0x2a7030));
  top.position.y = 0.1 + h / 2;
  g.add(trunk, top);
  return g;
}
function bricks(rng: () => number) {
  const g = new THREE.Group();
  const mat = std(0xa4471f);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3 - i; j++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.07), mat);
      b.position.set((j - (2 - i) / 2) * 0.13, 0.03 + i * 0.062, 0);
      g.add(b);
    }
  g.rotation.y = rng() * Math.PI;
  return g;
}
function sheep(rng: () => number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), std(0xfafafa));
  body.scale.set(1.3, 0.9, 1);
  body.position.y = 0.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), std(0x333333));
  head.position.set(0.1, 0.1, 0);
  g.add(body, head);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}
function wheat(rng: () => number) {
  const g = new THREE.Group();
  const mat = std(0xc99a1b);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.16 + rng() * 0.06, 4), mat);
    s.position.set((rng() - 0.5) * 0.18, 0.09, (rng() - 0.5) * 0.18);
    g.add(s);
  }
  return g;
}
function rock(rng: () => number) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + rng() * 0.1, 0), std(rng() > 0.5 ? 0x6e737c : 0x5a5f68));
  m.position.y = 0.06;
  m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
  m.scale.y = 0.8 + rng() * 0.6;
  return m;
}
function cactus() {
  const g = new THREE.Group();
  const mat = std(0x5d8f3c);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.25, 6), mat);
  t.position.y = 0.125;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6), mat);
  arm.position.set(0.05, 0.15, 0);
  g.add(t, arm);
  return g;
}

function decorate(type: TileType, id: number): THREE.Group {
  const rng = seeded(id + 7);
  const g = new THREE.Group();
  const count = { timber: 7, clay: 3, wool: 4, grain: 5, ore: 4, desert: 2 }[type];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rng() * 0.5;
    const rad = 0.48 + rng() * 0.28;
    const d =
      type === 'timber' ? tree(rng)
      : type === 'clay' ? bricks(rng)
      : type === 'wool' ? sheep(rng)
      : type === 'grain' ? wheat(rng)
      : type === 'ore' ? rock(rng)
      : cactus();
    d.position.x += Math.cos(ang) * rad;
    d.position.z += Math.sin(ang) * rad;
    g.add(d);
  }
  return g;
}

// ---------------------------------------------------------------- pieces

function settlementMesh(color: string) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.2), std(color, { roughness: 0.5 }));
  body.position.y = 0.075;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.13, 4), std(color, { roughness: 0.5 }));
  roof.position.y = 0.215;
  roof.rotation.y = Math.PI / 4;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.02, 0.205), std(0x222222));
  edge.position.y = 0.15;
  g.add(body, roof, edge);
  return shadow(g);
}
function cityMesh(color: string) {
  const g = new THREE.Group();
  const mat = std(color, { roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), mat);
  base.position.y = 0.08;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), mat);
  tower.position.set(-0.09, 0.26, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.14, 4), mat);
  roof.position.set(-0.09, 0.43, 0);
  roof.rotation.y = Math.PI / 4;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.02, 0.225), std(0x222222));
  trim.position.y = 0.16;
  g.add(base, tower, roof, trim);
  return shadow(g);
}
function roadMesh(color: string) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(HEX_SIZE * 0.66, 0.07, 0.085), std(color, { roughness: 0.5 }));
  m.position.y = 0.035;
  return shadow(m);
}
function raiderMesh() {
  const g = new THREE.Group();
  const mat = std(0x2a2433, { roughness: 0.4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.15, 0.36, 8), mat);
  body.position.y = 0.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat);
  head.position.y = 0.42;
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 8), std(0x4a1f3d));
  hood.position.y = 0.53;
  g.add(body, head, hood);
  return shadow(g);
}

// ---------------------------------------------------------------- the view

export class BoardView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private boardKey = '';
  private boardGroup = new THREE.Group();
  private pieces = new THREE.Group();
  private highlights = new THREE.Group();
  private raider = raiderMesh();
  private raiderTarget = new THREE.Vector3();
  private pieceKeys = new Set<string>();
  private popping: { obj: THREE.Object3D; t: number }[] = [];
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hovered: THREE.Object3D | null = null;
  private downAt = { x: 0, y: 0 };
  private water: THREE.Mesh;
  onPick: (kind: PickKind, id: number) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 9.5, 7.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, 0, 1.1);

    this.scene.background = new THREE.Color(0x87c6e8);
    this.scene.fog = new THREE.Fog(0x87c6e8, 22, 45);
    this.scene.add(new THREE.HemisphereLight(0xdff1ff, 0x5b4a2e, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
    sun.position.set(6, 12, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: 0x1f78b4, roughness: 0.3, metalness: 0.1 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.12;
    this.water.receiveShadow = true;
    this.scene.add(this.water, this.boardGroup, this.pieces, this.highlights, this.raider);

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return;
      this.onMove(e);
      if (this.hovered) this.onPick(this.hovered.userData.kind, this.hovered.userData.id);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /** screen position (CSS px) of the n-th highlighted target – used by tests */
  highlightScreenPos(n: number): { x: number; y: number; id: number } | null {
    const h = this.highlights.children[n];
    if (!h) return null;
    const v = h.getWorldPosition(new THREE.Vector3()).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, id: h.userData.id };
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // pull back on narrow (phone) screens so the island fits
    const fit = w / h < 1 ? 1 / Math.max(w / h, 0.5) : 1;
    this.camera.position.setLength(13.5 * Math.min(fit, 1.8));
    this.camera.updateProjectionMatrix();
  }

  private onMove(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hit = this.ray.intersectObjects(this.highlights.children, false)[0];
    const obj = hit?.object ?? null;
    if (obj !== this.hovered) {
      if (this.hovered) this.hovered.scale.setScalar(1);
      this.hovered = obj;
      this.renderer.domElement.style.cursor = obj ? 'pointer' : 'grab';
    }
  }

  private tick(t: number) {
    this.controls.update();
    const pulse = 0.55 + 0.35 * Math.sin(t / 220);
    for (const h of this.highlights.children) {
      const m = (h as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = h === this.hovered ? 0.95 : pulse;
      if (h === this.hovered) h.scale.setScalar(1.25);
    }
    this.raider.position.lerp(this.raiderTarget, 0.12);
    this.raider.position.y = this.raiderTarget.y + Math.max(0, 0.6 * this.raider.position.distanceTo(this.raiderTarget));
    this.popping = this.popping.filter((p) => {
      p.t = Math.min(1, p.t + 0.06);
      const k = 1 + 0.4 * Math.sin(p.t * Math.PI) * (1 - p.t);
      p.obj.scale.setScalar(p.t * k);
      return p.t < 1;
    });
    this.renderer.render(this.scene, this.camera);
  }

  // ----------------------------------------------------------- building

  private buildBoard(s: GameState) {
    this.boardGroup.clear();
    // sandy island base, a large hexagon around the tiles
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(5.25, 5.6, 0.25, 6), std(0xe6d29a));
    sand.rotation.y = Math.PI / 6;
    sand.position.y = -0.1;
    sand.receiveShadow = true;
    this.boardGroup.add(sand);

    for (const h of s.hexes) {
      const c = GEO.hexCoords[h.id];
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const tile = new THREE.Mesh(new THREE.CylinderGeometry(HEX_SIZE * 0.97, HEX_SIZE, 0.2, 6), std(TILE_COLORS[h.type]));
      tile.position.y = 0.1;
      tile.receiveShadow = true;
      const deco = decorate(h.type, h.id);
      deco.position.y = 0.2;
      g.add(tile, shadow(deco));
      if (h.number) {
        const top = new THREE.MeshStandardMaterial({ map: tokenTexture(h.number), roughness: 0.7 });
        const side = std(0xd9c9a3);
        const tok = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32), [side, top, side]);
        tok.position.y = 0.225;
        tok.rotation.y = Math.PI / 2;
        tok.castShadow = true;
        g.add(tok);
      }
      this.boardGroup.add(g);
    }

    for (const port of s.ports) {
      const e = GEO.edges[port.edge];
      const hc = GEO.hexCoords[e.hexes[0]];
      const dir = new THREE.Vector2(e.x - hc.x, e.z - hc.z).normalize();
      const px = e.x + dir.x * 0.55, pz = e.z + dir.y * 0.55;
      const dock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), std(0x8a5a33));
      dock.position.set(px, 0.02, pz);
      this.boardGroup.add(shadow(dock));
      for (const v of [e.a, e.b]) {
        const vv = GEO.vertices[v];
        const len = Math.hypot(vv.x - px, vv.z - pz);
        const plank = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.06), std(0x9b6b3e));
        plank.position.set((vv.x + px) / 2, 0.06, (vv.z + pz) / 2);
        plank.rotation.y = -Math.atan2(vv.z - pz, vv.x - px);
        this.boardGroup.add(shadow(plank));
      }
      const label = port.type === 'any' ? ['3 : 1', '❓'] : ['2 : 1', RES_INFO[port.type].icon];
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, { h: 160 }), depthWrite: false }));
      sprite.scale.set(0.78, 0.49, 1);
      sprite.position.set(px, 0.5, pz);
      this.boardGroup.add(sprite);
    }
  }

  update(s: GameState, sel: Selectable | null) {
    const key = JSON.stringify(s.hexes) + JSON.stringify(s.ports);
    if (key !== this.boardKey) {
      this.boardKey = key;
      this.buildBoard(s);
      this.pieces.clear();
      this.pieceKeys.clear();
      const c = GEO.hexCoords[s.raider];
      this.raider.position.set(c.x + 0.4, 0.2, c.z - 0.25);
    }

    // pieces (diffed so new ones can pop in)
    const want = new Map<string, () => THREE.Object3D>();
    for (const [v, b] of Object.entries(s.buildings)) {
      const vx = GEO.vertices[Number(v)];
      const color = s.players[b.owner].color;
      want.set(`b${v}${b.kind}${b.owner}`, () => {
        const m = b.kind === 'city' ? cityMesh(color) : settlementMesh(color);
        m.position.set(vx.x, 0.2, vx.z);
        m.rotation.y = Number(v) * 1.3;
        return m;
      });
    }
    for (const [e, owner] of Object.entries(s.roads)) {
      const ed = GEO.edges[Number(e)];
      want.set(`r${e}${owner}`, () => {
        const m = roadMesh(s.players[owner].color);
        m.position.set(ed.x, 0.2, ed.z);
        m.rotation.y = -ed.angle;
        return m;
      });
    }
    for (const child of [...this.pieces.children]) {
      if (!want.has(child.name)) {
        this.pieces.remove(child);
        this.pieceKeys.delete(child.name);
      }
    }
    const fresh = this.pieceKeys.size > 0;
    for (const [k, make] of want) {
      if (this.pieceKeys.has(k)) continue;
      const o = make();
      o.name = k;
      this.pieces.add(o);
      this.pieceKeys.add(k);
      if (fresh) {
        o.scale.setScalar(0.01);
        this.popping.push({ obj: o, t: 0 });
      }
    }

    const rc = GEO.hexCoords[s.raider];
    this.raiderTarget.set(rc.x + 0.4, 0.2, rc.z - 0.25);

    // highlights
    this.highlights.clear();
    this.hovered = null;
    if (!sel) return;
    const mat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
    for (const id of sel.ids) {
      let m: THREE.Mesh;
      if (sel.kind === 'vertex') {
        const v = GEO.vertices[id];
        m = sel.style === 'city'
          ? new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 24), mat())
          : new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat());
        if (sel.style === 'city') m.rotation.x = Math.PI / 2;
        m.position.set(v.x, 0.32, v.z);
      } else if (sel.kind === 'edge') {
        const e = GEO.edges[id];
        m = new THREE.Mesh(new THREE.BoxGeometry(HEX_SIZE * 0.55, 0.08, 0.13), mat());
        m.position.set(e.x, 0.26, e.z);
        m.rotation.y = -e.angle;
      } else {
        const c = GEO.hexCoords[id];
        m = new THREE.Mesh(new THREE.CylinderGeometry(HEX_SIZE * 0.82, HEX_SIZE * 0.82, 0.03, 6), mat());
        (m.material as THREE.MeshBasicMaterial).color.set(0xff5577);
        m.position.set(c.x, 0.27, c.z);
      }
      m.userData = { kind: sel.kind, id };
      this.highlights.add(m);
    }
  }
}
