import * as THREE from 'three';
import { Particles } from './effects';

/** Emoji thrown onto the island, and where other players are pointing. */

const emojiTextures = new Map<string, THREE.Texture>();
function emojiTexture(e: string) {
  let t = emojiTextures.get(e);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.direction = 'ltr';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.fillText(e, 64, 70);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    emojiTextures.set(e, t);
  }
  return t;
}

/** splash colour per reaction */
const SPLASH: Record<string, number> = { '🍅': 0xd62828, '🔥': 0xff7a1a, '❤️': 0xff4d6d, '😡': 0xd62828, '🎉': 0xffc94d, '👏': 0xffd54a };

interface Flying { sprite: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; t: number; e: string; landed: boolean }
interface Splat { mesh: THREE.Mesh; t: number }
interface Pointer { group: THREE.Group; target: THREE.Vector3; last: number }

export class Social {
  readonly group = new THREE.Group();
  private flying: Flying[] = [];
  private splats: Splat[] = [];
  private pointers = new Map<number, Pointer>();

  constructor(private particles: Particles) {}

  /** an emoji arcs in from the sky, bounces on the spot and splashes */
  throwEmoji(e: string, x: number, z: number) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(e), depthWrite: false, transparent: true }));
    sprite.scale.setScalar(0.55);
    sprite.renderOrder = 12;
    const to = new THREE.Vector3(x, 0.45, z);
    const from = new THREE.Vector3(x + (Math.random() - 0.5) * 3, 4.5, z + 3.5);
    sprite.position.copy(from);
    this.group.add(sprite);
    this.flying.push({ sprite, from, to, t: 0, e, landed: false });
  }

  private land(f: Flying) {
    const color = SPLASH[f.e] ?? 0xffe066;
    this.particles.burst(f.to.x, f.to.z, color, 14);
    if (f.e === '🍅') {
      // tomato leaves a splat on the board for a few seconds
      const shape = new THREE.Shape();
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const r = 0.16 + (i % 2 ? 0.07 : 0) + Math.random() * 0.04;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc1121f, transparent: true, opacity: 0.85, depthWrite: false }));
      mesh.position.set(f.to.x, 0.25, f.to.z);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.renderOrder = 11;
      this.group.add(mesh);
      this.splats.push({ mesh, t: 0 });
    }
  }

  /** show (or move) another player's pointer; null hides it */
  setPointer(id: number, color: string, pt: { x: number; z: number } | null) {
    let p = this.pointers.get(id);
    if (!pt) {
      if (p) p.last = 0;
      return;
    }
    if (!p) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 28), mat);
      ring.rotation.x = Math.PI / 2;
      const pin = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), mat);
      pin.rotation.x = Math.PI;
      pin.position.y = 0.3;
      group.add(ring, pin);
      group.traverse((o) => (o.renderOrder = 11));
      group.position.set(pt.x, 0.26, pt.z);
      this.group.add(group);
      p = { group, target: new THREE.Vector3(), last: 0 };
      this.pointers.set(id, p);
    }
    p.target.set(pt.x, 0.26, pt.z);
    p.last = performance.now();
  }

  tick(dt: number, time: number) {
    this.flying = this.flying.filter((f) => {
      f.t += dt;
      const FLY = 0.75;
      if (f.t < FLY) {
        const u = f.t / FLY;
        f.sprite.position.lerpVectors(f.from, f.to, u);
        f.sprite.position.y = f.from.y + (f.to.y - f.from.y) * u + Math.sin(u * Math.PI) * 1.2;
        f.sprite.material.rotation = u * 6;
      } else {
        if (!f.landed) {
          f.landed = true;
          f.sprite.material.rotation = 0;
          this.land(f);
        }
        const k = f.t - FLY;
        // bounce, then fade away
        f.sprite.position.y = f.to.y + Math.abs(Math.sin(k * 9)) * 0.25 * Math.max(0, 1 - k * 1.5);
        f.sprite.scale.setScalar(0.55 * (1 + 0.25 * Math.max(0, 1 - k * 3)));
        if (k > 1.6) f.sprite.material.opacity = Math.max(0, 1 - (k - 1.6) * 2);
        if (k > 2.2) {
          this.group.remove(f.sprite);
          f.sprite.material.dispose();
          return false;
        }
      }
      return true;
    });
    this.splats = this.splats.filter((s) => {
      s.t += dt;
      if (s.t > 4) (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 - (s.t - 4) * 0.6);
      if (s.t > 5.5) {
        this.group.remove(s.mesh);
        return false;
      }
      return true;
    });
    const now = performance.now();
    for (const p of this.pointers.values()) {
      const visible = now - p.last < 4000;
      p.group.visible = visible;
      if (!visible) continue;
      p.group.position.lerp(p.target, 0.25);
      p.group.children[1].position.y = 0.3 + 0.06 * Math.sin(time / 180);
      p.group.children[0].scale.setScalar(1 + 0.15 * Math.sin(time / 250));
    }
  }
}
