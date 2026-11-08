import * as THREE from 'three';
import { HEX_SIZE } from '../game/board';
import { TileType } from '../game/types';

/**
 * "Classic board" view: flat, illustrated tiles painted on a canvas (our own artwork),
 * a sea frame and a wooden table. Seen from straight above.
 */

const S = 512; // texture size

function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function hexPath(g: CanvasRenderingContext2D, r: number) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

type Rng = () => number;

/** scatter n points inside the hexagon (roughly even, with jitter) */
function scatter(rng: Rng, n: number, margin = 40) {
  const pts: { x: number; y: number }[] = [];
  const R = S / 2 - margin;
  let tries = 0;
  while (pts.length < n && tries++ < n * 40) {
    const x = S / 2 + (rng() * 2 - 1) * R, y = S / 2 + (rng() * 2 - 1) * R;
    // inside a pointy-top hexagon of circumradius R
    const dx = Math.abs(x - S / 2), dy = Math.abs(y - S / 2);
    if (dx > R * 0.866 || dy > R - dx * 0.577) continue;
    if (pts.some((p) => Math.hypot(p.x - x, p.y - y) < R * 0.17)) continue;
    pts.push({ x, y });
  }
  return pts.sort((a, b) => a.y - b.y); // paint back to front
}

const shadow = (g: CanvasRenderingContext2D, x: number, y: number, w: number) => {
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath();
  g.ellipse(x + 4, y + 3, w, w * 0.35, 0, 0, Math.PI * 2);
  g.fill();
};

function pine(g: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng) {
  shadow(g, x, y, s * 0.6);
  g.fillStyle = '#5b3a1f';
  g.fillRect(x - s * 0.08, y - s * 0.25, s * 0.16, s * 0.3);
  const greens = ['#1f5e24', '#26702c', '#2f7d32'];
  for (let k = 0; k < 3; k++) {
    g.fillStyle = greens[(k + Math.floor(rng() * 3)) % 3];
    const w = s * (0.62 - k * 0.14), top = y - s * (0.5 + k * 0.32), base = y - s * (0.15 + k * 0.3);
    g.beginPath();
    g.moveTo(x, top - s * 0.25);
    g.lineTo(x + w, base);
    g.lineTo(x - w, base);
    g.closePath();
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(x, y - s * 1.4);
  g.lineTo(x - s * 0.3, y - s * 0.75);
  g.lineTo(x, y - s * 0.85);
  g.fill();
}

function roundTree(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  shadow(g, x, y, s * 0.55);
  g.fillStyle = '#6d4c2f';
  g.fillRect(x - s * 0.07, y - s * 0.35, s * 0.14, s * 0.38);
  g.fillStyle = '#3c8a35';
  g.beginPath();
  g.arc(x, y - s * 0.62, s * 0.42, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#52a447';
  g.beginPath();
  g.arc(x - s * 0.12, y - s * 0.72, s * 0.22, 0, Math.PI * 2);
  g.fill();
}

function sheep(g: CanvasRenderingContext2D, x: number, y: number, s: number, rng: Rng) {
  shadow(g, x, y, s * 0.5);
  const dir = rng() > 0.5 ? 1 : -1;
  g.fillStyle = '#2b2b2b';
  for (const lx of [-0.22, -0.08, 0.1, 0.24]) g.fillRect(x + lx * s, y - s * 0.12, s * 0.06, s * 0.16);
  g.fillStyle = '#fbfbf7';
  for (const [ox, oy, r] of [[-0.18, -0.3, 0.2], [0, -0.36, 0.22], [0.17, -0.3, 0.2], [0, -0.22, 0.2]]) {
    g.beginPath();
    g.arc(x + ox * s, y + oy * s, r * s, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#2b2b2b';
  g.beginPath();
  g.ellipse(x + dir * s * 0.36, y - s * 0.33, s * 0.12, s * 0.09, 0, 0, Math.PI * 2);
  g.fill();
}

function wheatRows(g: CanvasRenderingContext2D, rng: Rng) {
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(-0.5 + rng() * 0.3);
  for (let row = -10; row <= 10; row++) {
    const y = row * 26;
    g.fillStyle = row % 2 ? '#d9ab2c' : '#e6bd3e';
    g.fillRect(-300, y - 13, 600, 26);
    g.strokeStyle = '#a9811a';
    g.lineWidth = 2;
    for (let x = -300; x < 300; x += 9) {
      g.beginPath();
      g.moveTo(x, y + 8);
      g.lineTo(x + 3, y - 8);
      g.stroke();
    }
  }
  g.restore();
}

function windmill(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  shadow(g, x, y, s * 0.45);
  g.fillStyle = '#f1e9d6';
  g.beginPath();
  g.moveTo(x - s * 0.25, y);
  g.lineTo(x + s * 0.25, y);
  g.lineTo(x + s * 0.15, y - s * 0.8);
  g.lineTo(x - s * 0.15, y - s * 0.8);
  g.fill();
  g.fillStyle = '#a4472b';
  g.beginPath();
  g.moveTo(x - s * 0.22, y - s * 0.78);
  g.lineTo(x, y - s * 1.05);
  g.lineTo(x + s * 0.22, y - s * 0.78);
  g.fill();
  g.strokeStyle = '#6d4c2f';
  g.lineWidth = s * 0.06;
  g.fillStyle = '#fbf6e8';
  for (let k = 0; k < 4; k++) {
    const a = k * (Math.PI / 2) + 0.4;
    const ex = x + Math.cos(a) * s * 0.7, ey = y - s * 0.75 + Math.sin(a) * s * 0.7;
    g.beginPath();
    g.moveTo(x, y - s * 0.75);
    g.lineTo(ex, ey);
    g.stroke();
  }
}

function hill(g: CanvasRenderingContext2D, x: number, y: number, s: number, c1: string, c2: string) {
  g.fillStyle = c2;
  g.beginPath();
  g.ellipse(x + s * 0.08, y, s, s * 0.55, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = c1;
  g.beginPath();
  g.ellipse(x - s * 0.08, y, s * 0.85, s * 0.5, 0, Math.PI, 0);
  g.fill();
}

function bricks(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  shadow(g, x, y, s * 0.6);
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < 3 - row; k++) {
      const bx = x - s * 0.5 + k * s * 0.34 + row * s * 0.17, by = y - s * 0.18 - row * s * 0.18;
      g.fillStyle = (row + k) % 2 ? '#9c3f1a' : '#b44d22';
      g.fillRect(bx, by, s * 0.32, s * 0.17);
      g.strokeStyle = '#6e2a10';
      g.lineWidth = 2;
      g.strokeRect(bx, by, s * 0.32, s * 0.17);
    }
}

function peak(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  shadow(g, x, y, s * 0.7);
  g.fillStyle = '#7d828b';
  g.beginPath();
  g.moveTo(x - s * 0.8, y);
  g.lineTo(x, y - s * 1.2);
  g.lineTo(x + s * 0.8, y);
  g.fill();
  g.fillStyle = '#5f646c';
  g.beginPath();
  g.moveTo(x, y - s * 1.2);
  g.lineTo(x + s * 0.8, y);
  g.lineTo(x + s * 0.1, y);
  g.fill();
  g.fillStyle = '#f7f9fb';
  g.beginPath();
  g.moveTo(x - s * 0.27, y - s * 0.8);
  g.lineTo(x, y - s * 1.2);
  g.lineTo(x + s * 0.27, y - s * 0.8);
  g.lineTo(x + s * 0.1, y - s * 0.88);
  g.lineTo(x - s * 0.05, y - s * 0.78);
  g.fill();
}

function cactus(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  shadow(g, x, y, s * 0.3);
  g.fillStyle = '#5d8f3c';
  g.fillRect(x - s * 0.09, y - s * 0.8, s * 0.18, s * 0.8);
  g.fillRect(x + s * 0.09, y - s * 0.55, s * 0.18, s * 0.1);
  g.fillRect(x + s * 0.2, y - s * 0.75, s * 0.09, s * 0.3);
  g.fillRect(x - s * 0.27, y - s * 0.45, s * 0.18, s * 0.09);
  g.fillRect(x - s * 0.27, y - s * 0.6, s * 0.09, s * 0.22);
}

const BASE: Record<TileType, [string, string]> = {
  timber: ['#2f7a35', '#1d5a25'],
  wool: ['#a9d870', '#86bf55'],
  grain: ['#e3b73a', '#c99a1b'],
  clay: ['#cf7444', '#a8532a'],
  ore: ['#a3a8b0', '#7f848c'],
  desert: ['#ead39b', '#d6b977'],
};

/** paint one illustrated tile */
export function paintTile(type: TileType, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.direction = 'ltr';
  const rng = seeded(seed + 3);
  g.save();
  hexPath(g, S / 2 - 6);
  g.clip();
  const [a, b] = BASE[type];
  const grad = g.createRadialGradient(S * 0.4, S * 0.35, 20, S / 2, S / 2, S * 0.6);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // texture speckles
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${rng() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rng() * 0.05})`;
    g.fillRect(rng() * S, rng() * S, 2 + rng() * 5, 2 + rng() * 3);
  }

  switch (type) {
    case 'timber':
      for (const p of scatter(rng, 26, 30)) (rng() > 0.25 ? pine(g, p.x, p.y + 20, 44 + rng() * 14, rng) : roundTree(g, p.x, p.y + 20, 42));
      break;
    case 'wool': {
      g.strokeStyle = 'rgba(60,110,40,0.35)';
      g.lineWidth = 2;
      for (let i = 0; i < 90; i++) {
        const x = rng() * S, y = rng() * S;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 3, y - 9);
        g.stroke();
      }
      g.strokeStyle = '#9b7448';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(90, 360);
      g.lineTo(250, 420);
      g.lineTo(400, 350);
      g.stroke();
      for (const p of scatter(rng, 9, 60)) sheep(g, p.x, p.y + 15, 46, rng);
      break;
    }
    case 'grain':
      wheatRows(g, rng);
      windmill(g, 150 + rng() * 40, 190, 80);
      break;
    case 'clay':
      for (const p of scatter(rng, 6, 70)) hill(g, p.x, p.y + 30, 70, '#b85a30', '#94431f');
      for (const p of scatter(rng, 4, 90)) bricks(g, p.x, p.y + 20, 60);
      break;
    case 'ore':
      for (const p of scatter(rng, 9, 55)) peak(g, p.x, p.y + 40, 52 + rng() * 22);
      break;
    case 'desert':
      g.strokeStyle = 'rgba(160,120,60,0.45)';
      g.lineWidth = 4;
      for (let i = 0; i < 9; i++) {
        const y = 60 + i * 50 + rng() * 20;
        g.beginPath();
        g.moveTo(20, y);
        g.bezierCurveTo(160, y - 40, 300, y + 40, 500, y - 10);
        g.stroke();
      }
      for (const p of scatter(rng, 5, 80)) cactus(g, p.x, p.y + 30, 60);
      break;
  }
  g.restore();
  // printed-tile frame: dark outline + cream inner border
  hexPath(g, S / 2 - 8);
  g.lineWidth = 10;
  g.strokeStyle = '#f3e6c4';
  g.stroke();
  hexPath(g, S / 2 - 3);
  g.lineWidth = 5;
  g.strokeStyle = '#4b331d';
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** flat hexagon showing a painted texture (pointy-top, matching the board) */
export function flatTile(type: TileType, seed: number) {
  const geo = new THREE.CircleGeometry(HEX_SIZE * 0.995, 6, Math.PI / 6);
  // map the texture square onto the hexagon (Circle UVs span the bounding circle)
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: paintTile(type, seed), roughness: 0.9 }));
  m.receiveShadow = true;
  return m;
}

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a4f2c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 64) {
    g.fillStyle = i % 128 ? '#82552f' : '#744a28';
    g.fillRect(0, i, 512, 62);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, i + 62, 512, 2);
  }
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(40,20,5,${0.08 + Math.random() * 0.1})`;
    g.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * 512;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + (Math.random() - 0.5) * 20, 340, y + (Math.random() - 0.5) * 20, 512, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function seaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(256, 256, 100, 256, 256, 256);
  grad.addColorStop(0, '#4fb3d9');
  grad.addColorStop(1, '#2a7fb8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 3;
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    g.beginPath();
    g.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.9);
    g.arc(x + 16, y, 8, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** the table and the sea frame around the tiles */
export function classicSurround(): THREE.Group {
  const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.8 }));
  table.rotation.x = -Math.PI / 2;
  table.position.y = 0.02;
  table.receiveShadow = true;
  // sea frame: a big flat-topped hexagon with a wooden rim
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(6.15, 6.25, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0x4b331d, roughness: 0.7 }));
  rim.rotation.y = Math.PI / 6;
  rim.position.y = 0.08;
  const sea = new THREE.Mesh(new THREE.CircleGeometry(5.95, 6, 0), new THREE.MeshStandardMaterial({ map: seaTexture(), roughness: 0.4 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0.145;
  sea.receiveShadow = true;
  g.add(table, rim, sea);
  return g;
}
