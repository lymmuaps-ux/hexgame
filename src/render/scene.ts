import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GEO, HEX_SIZE } from '../game/board';
import { Dice } from './dice';
import { Clouds, Ocean, Particles } from './effects';
import { IslandDecor } from './island';
import { Social } from './social';
import { classicSurround, flatTile } from './classic';
import { decorateTile, tileBase } from './tiles';
import { GameState, RES_INFO } from '../game/types';

export type PickKind = 'vertex' | 'edge' | 'hex';
export interface Selectable {
  kind: PickKind;
  ids: number[];
  /** style of vertex highlight */
  style?: 'settlement' | 'city';
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
  g.direction = 'ltr'; // never mirror ratios like "3 : 1" when the page is right-to-left
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
  g.direction = 'ltr'; // never mirror ratios like "3 : 1" when the page is right-to-left
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
  private popping: { obj: THREE.Object3D; t: number; road?: boolean }[] = [];
  private ocean = new Ocean();
  private clouds = new Clouds();
  private particles = new Particles();
  private raiderLanding = false;
  private decor: IslandDecor | null = null;
  private spinners: THREE.Object3D[] = [];
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hovered: THREE.Object3D | null = null;
  private downAt = { x: 0, y: 0 };
  private water: THREE.Mesh;
  private dice = new Dice();
  private lastRoll: number | undefined | null = null;
  private tokens = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>();
  private celebrate: { hexes: number[]; raider: boolean; t: number } | null = null;
  private lastFrame = 0;
  onPick: (kind: PickKind, id: number) => void = () => {};
  /** fires when the dice come to rest */
  onDiceLanded: (sum: number) => void = () => {};
  /** where the pointer is on the island (null when off it) */
  onHover: (pt: { x: number; z: number } | null) => void = () => {};
  /** while aiming a reaction, a tap on the island lands here instead of picking */
  aiming = false;
  onAim: (pt: { x: number; z: number }) => void = () => {};
  readonly social: Social;
  // view mode: '3d' (default) or '2d' classic printed board seen from above
  view: '3d' | '2d' = '3d';
  private terrain3d: THREE.Object3D[] = [];
  private classic = new THREE.Group();
  private saved3d: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private camGoal: { pos: THREE.Vector3; target: THREE.Vector3; t: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3 } | null = null;
  private fog: THREE.Fog | null = null;
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.22);

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

    this.water = this.ocean.mesh;
    this.scene.add(this.water, this.boardGroup, this.pieces, this.highlights, this.raider, this.dice.group, this.clouds.group, this.particles.group);
    this.social = new Social(this.particles);
    this.scene.add(this.social.group);

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) return;
      this.onMove(e);
      if (this.aiming) {
        const pt = this.groundPoint();
        if (pt) this.onAim(pt);
        return;
      }
      if (this.hovered) this.onPick(this.hovered.userData.kind, this.hovered.userData.id);
    });
    el.addEventListener('pointerleave', () => this.onHover(null));
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /** screen position (CSS px) of a tile's number token */
  hexScreenPos(hex: number): { x: number; y: number } {
    const c = GEO.hexCoords[hex];
    const v = new THREE.Vector3(c.x, 0.3, c.z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
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
    this.camera.position.sub(this.controls.target).setLength(this.viewDistance()).add(this.controls.target);
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
    }
    this.renderer.domElement.style.cursor = this.aiming ? 'crosshair' : obj ? 'pointer' : 'grab';
    this.onHover(this.groundPoint());
  }

  /** the point on the island under the pointer (null when it's over the sea) */
  private groundPoint() {
    const v = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, v) || Math.hypot(v.x, v.z) > 6) return null;
    return { x: Math.round(v.x * 100) / 100, z: Math.round(v.z * 100) / 100 };
  }

  private tick(t: number) {
    const dt = Math.min(0.1, (t - (this.lastFrame || t)) / 1000);
    this.lastFrame = t;
    if (this.camGoal) {
      // glide the camera between the two views
      const g = this.camGoal;
      g.t = Math.min(1, g.t + dt * 1.8);
      const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 2) / 2;
      this.camera.position.lerpVectors(g.fromPos, g.pos, e);
      this.controls.target.lerpVectors(g.fromTarget, g.target, e);
      if (g.t >= 1) this.camGoal = null;
    }
    this.controls.update();
    this.dice.tick(dt);
    this.animateCelebration(dt);
    const wave = (Math.sin(t / 220) + 1) / 2;
    const ripple = (t / 1100) % 1;
    for (const h of this.highlights.children) {
      const hov = h === this.hovered;
      const m = (h as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = hov ? 1 : (h.userData.kind === 'hex' ? 0.3 + 0.35 * wave : 0.7 + 0.25 * wave);
      h.scale.setScalar(hov ? 1.3 : 1);
      const arrow = h.userData.arrow as THREE.Mesh | undefined;
      if (arrow) arrow.position.y = 0.62 + 0.12 * wave;
      const ring = h.userData.ring as THREE.Mesh | undefined;
      if (ring) {
        ring.scale.setScalar(1 + ripple * 1.8);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - ripple);
      }
    }
    this.raider.position.lerp(this.raiderTarget, 0.12);
    this.raider.position.y = this.raiderTarget.y + Math.max(0, 0.6 * this.raider.position.distanceTo(this.raiderTarget));
    if (this.celebrate?.raider) {
      const k = Math.min(1, this.celebrate.t / 1.6);
      this.raider.position.y += 0.35 * Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k);
      this.raider.rotation.y = k * Math.PI * 4;
    }
    this.popping = this.popping.filter((p) => {
      p.t = Math.min(1, p.t + dt * 3.2);
      if (p.road) {
        // roads grow along their edge
        const e = 1 - Math.pow(1 - p.t, 3);
        p.obj.scale.set(Math.max(0.01, e), 1, 1);
      } else {
        // buildings drop in and squash a little on landing
        const k = 1 + 0.4 * Math.sin(p.t * Math.PI) * (1 - p.t);
        p.obj.scale.setScalar(Math.max(0.01, p.t * k));
        p.obj.position.y = 0.2 + (1 - p.t) * (1 - p.t) * 1.2;
      }
      return p.t < 1;
    });
    this.ocean.tick(t);
    this.decor?.tick(t, dt);
    this.social.tick(dt, t);
    for (const sp of this.spinners) sp.rotation.z += sp.userData.spin * dt;
    this.clouds.tick(dt);
    this.particles.tick(dt);
    if (this.raiderLanding && this.raider.position.distanceTo(this.raiderTarget) < 0.06) {
      this.raiderLanding = false;
      this.particles.smoke(this.raiderTarget.x, this.raiderTarget.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ----------------------------------------------------------- building

  /** after a roll: producing number tokens hop and glow; on a 7 the Raider dances */
  private animateCelebration(dt: number) {
    const c = this.celebrate;
    if (!c) return;
    c.t += dt;
    const k = Math.min(1, c.t / 2.2);
    for (const id of c.hexes) {
      const tok = this.tokens.get(id);
      if (!tok) continue;
      tok.mesh.position.y = 0.245 + 0.22 * Math.abs(Math.sin(k * Math.PI * 4)) * (1 - k);
      tok.mesh.scale.setScalar(1 + 0.3 * (1 - k));
      tok.mat.emissiveIntensity = 0.9 * (1 - k);
    }
    if (k >= 1) this.celebrate = null;
  }

  private buildBoard(s: GameState) {
    this.boardGroup.clear();
    this.tokens.clear();
    this.spinners = [];
    this.terrain3d = [];
    this.classic = new THREE.Group();

    for (const h of s.hexes) {
      const c = GEO.hexCoords[h.id];
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const deco = decorateTile(h.type, h.id);
      deco.position.y = 0.22;
      deco.traverse((o) => o.userData.spin && this.spinners.push(o));
      const terrain = new THREE.Group();
      terrain.add(tileBase(h.type), deco);
      this.terrain3d.push(terrain);
      g.add(terrain);
      // the same tile as a flat printed illustration for the classic view
      const flat = flatTile(h.type, h.id * 7 + (h.number ?? 0));
      flat.position.set(c.x, 0.2, c.z);
      this.classic.add(flat);
      if (h.number) {
        const top = new THREE.MeshStandardMaterial({ map: tokenTexture(h.number), roughness: 0.7, emissive: 0xffc23d, emissiveIntensity: 0 });
        const side = std(0xd9c9a3);
        const tok = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32), [side, top, side]);
        tok.position.y = 0.245;
        tok.rotation.y = Math.PI / 2;
        tok.castShadow = true;
        g.add(tok);
        this.tokens.set(h.id, { mesh: tok, mat: top });
      }
      this.boardGroup.add(g);
    }

    const docks: { x: number; z: number }[] = [];
    for (const port of s.ports) {
      const e = GEO.edges[port.edge];
      const hc = GEO.hexCoords[e.hexes[0]];
      const dir = new THREE.Vector2(e.x - hc.x, e.z - hc.z).normalize();
      const px = e.x + dir.x * 0.55, pz = e.z + dir.y * 0.55;
      docks.push({ x: px, z: pz });
      // classic view: flat wooden pier from the harbour to its two corners, drawn on the sea
      const woodMat = std(0x8a5a33);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.36), woodMat);
      deck.position.set(px, 0.165, pz);
      deck.rotation.y = -Math.atan2(dir.y, dir.x);
      this.classic.add(deck);
      for (const v of [e.a, e.b]) {
        const vv = GEO.vertices[v];
        const len = Math.hypot(vv.x - px, vv.z - pz);
        const plank = new THREE.Mesh(new THREE.BoxGeometry(len, 0.025, 0.07), std(0x9b6b3e));
        plank.position.set((vv.x + px) / 2, 0.17, (vv.z + pz) / 2);
        plank.rotation.y = -Math.atan2(vv.z - pz, vv.x - px);
        this.classic.add(plank);
      }
      // little wooden pier on posts
      const dock = new THREE.Group();
      dock.position.set(px, 0, pz);
      dock.rotation.y = -Math.atan2(dir.y, dir.x);
      for (let k = 0; k < 5; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.42), std(k % 2 ? 0x8a5a33 : 0x9b6b3e));
        plank.position.set(-0.17 + k * 0.085, 0.07, 0);
        dock.add(plank);
      }
      for (const [x, z] of [[-0.19, -0.19], [-0.19, 0.19], [0.19, -0.19], [0.19, 0.19]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 6), std(0x6d4c2f));
        post.position.set(x, -0.02, z);
        dock.add(post);
      }
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 8), std(0x7a5634));
      barrel.position.set(0.12, 0.12, 0.13);
      dock.add(barrel);
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
    // beach, shallows, palms, boats… seeded by the board so everyone sees the same island
    const seed = s.hexes.reduce((h, x, n) => (h * 31 + x.type.charCodeAt(0) * (n + 1) + (x.number ?? 0)) % 100000, 7);
    this.decor = new IslandDecor(docks, seed);
    this.boardGroup.add(this.decor.group);
    this.classic.add(classicSurround());
    this.boardGroup.add(this.classic);
    this.applyView(false);
  }

  /** switch between the 3D island and the flat classic board */
  setView(v: '3d' | '2d') {
    if (v === this.view) return;
    this.view = v;
    this.applyView(true);
  }

  private applyView(animate: boolean) {
    const flat = this.view === '2d';
    this.terrain3d.forEach((o) => (o.visible = !flat));
    this.classic.visible = flat;
    if (this.decor) this.decor.group.visible = !flat;
    this.water.visible = !flat;
    this.clouds.group.visible = !flat;
    this.fog ??= this.scene.fog as THREE.Fog;
    this.scene.fog = flat ? null : this.fog;
    this.controls.enableRotate = !flat;
    let pos: THREE.Vector3, target: THREE.Vector3;
    if (flat) {
      this.saved3d = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
      target = new THREE.Vector3(0, 0, 0);
      pos = new THREE.Vector3(0, this.viewDistance(), 0.001);
    } else {
      pos = this.saved3d?.pos ?? new THREE.Vector3(0, 9.5, 7.5).setLength(this.viewDistance());
      target = this.saved3d?.target ?? new THREE.Vector3(0, 0, 1.1);
    }
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      return;
    }
    this.camGoal = { pos, target, t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone() };
  }

  /** how far the camera sits so the board fits the screen */
  private viewDistance() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const fit = w / h < 1 ? 1 / Math.max(w / h, 0.5) : 1;
    return (this.view === '2d' ? 15.5 : 13.5) * Math.min(fit, 1.8);
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
        m.userData.color = color;
        m.position.set(vx.x, 0.2, vx.z);
        m.rotation.y = Number(v) * 1.3;
        return m;
      });
    }
    for (const [e, owner] of Object.entries(s.roads)) {
      const ed = GEO.edges[Number(e)];
      want.set(`r${e}${owner}`, () => {
        const m = roadMesh(s.players[owner].color);
        m.userData.color = s.players[owner].color;
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
        const road = k.startsWith('r');
        if (road) o.scale.set(0.01, 1, 1);
        else o.scale.setScalar(0.01);
        this.popping.push({ obj: o, t: 0, road });
        const color = o.userData.color as string;
        // burst when the piece lands (roads: right away, buildings: after the drop)
        const fire = () => this.particles.burst(o.position.x, o.position.z, color, road ? 8 : 18);
        if (road) fire();
        else setTimeout(fire, 280);
      }
    }

    // a new roll happened: toss the dice (not on first load / reconnect)
    if (this.lastRoll === null) this.lastRoll = s.rollId;
    else if (s.rollId !== this.lastRoll && s.dice) {
      this.lastRoll = s.rollId;
      const d = s.dice;
      const sum = d[0] + d[1];
      const raiderHex = s.raider;
      this.dice.roll(d, () => {
        this.celebrate = {
          hexes: s.hexes.filter((h) => h.number === sum && h.id !== raiderHex).map((h) => h.id),
          raider: sum === 7,
          t: 0,
        };
        this.onDiceLanded(sum);
      });
    }

    const rc = GEO.hexCoords[s.raider];
    if (Math.abs(this.raiderTarget.x - (rc.x + 0.4)) > 0.01 || Math.abs(this.raiderTarget.z - (rc.z - 0.25)) > 0.01) {
      if (this.raiderTarget.lengthSq() > 0) this.raiderLanding = true;
    }
    this.raiderTarget.set(rc.x + 0.4, 0.2, rc.z - 0.25);
    // victory lap: the camera slowly circles the island
    this.controls.autoRotate = s.phase === 'ended';
    this.controls.autoRotateSpeed = 0.8;

    // highlights
    this.highlights.clear();
    this.hovered = null;
    if (!sel) return;
    // bright cyan markers drawn on top of everything so they can't hide behind trees or blend into tiles
    const CYAN = 0x22e6ff;
    const mat = (color: number, opacity = 0.85, onTop = true) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: !onTop });
    const pin = (x: number, z: number, y: number) => {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), mat(0x00d8ff, 0.95));
      core.position.set(x, y, z);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 8), mat(CYAN, 0.45));
      beam.position.y = 0.45;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 32), mat(CYAN, 0.9));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.24 - y;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.28, 16), mat(0xffffff, 0.95));
      arrow.rotation.x = Math.PI; // point down at the spot
      arrow.position.y = 0.62;
      core.userData.ring = ring;
      // many spots (e.g. during setup): plain glowing dots, few spots: tall pins that are easy to find
      if (sel.ids.length > 12) {
        core.scale.setScalar(0.8);
        core.add(ring);
      } else {
        core.add(beam, ring, arrow);
        core.userData.arrow = arrow;
      }
      return core;
    };
    for (const id of sel.ids) {
      let m: THREE.Mesh;
      if (sel.kind === 'vertex') {
        const v = GEO.vertices[id];
        m = pin(v.x, v.z, sel.style === 'city' ? 0.66 : 0.38);
      } else if (sel.kind === 'edge') {
        const e = GEO.edges[id];
        m = new THREE.Mesh(new THREE.BoxGeometry(HEX_SIZE * 0.6, 0.1, 0.16), mat(CYAN, 0.9));
        m.position.set(e.x, 0.28, e.z);
        m.rotation.y = -e.angle;
      } else {
        const c = GEO.hexCoords[id];
        m = new THREE.Mesh(new THREE.CylinderGeometry(HEX_SIZE * 0.82, HEX_SIZE * 0.82, 0.03, 6), mat(0xff5577, 0.6, false));
        m.position.set(c.x, 0.27, c.z);
      }
      m.traverse((o) => (o.renderOrder = 10));
      m.userData = { ...m.userData, kind: sel.kind, id };
      this.highlights.add(m);
    }
  }
}
