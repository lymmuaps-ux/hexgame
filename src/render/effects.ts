import * as THREE from 'three';

// ---------------------------------------------------------------- particles

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
}

/** Small burst effects: confetti-like chips when building, smoke puffs for the Raider. */
export class Particles {
  readonly group = new THREE.Group();
  private list: Particle[] = [];
  private cube = new THREE.BoxGeometry(1, 1, 1);
  private puff = new THREE.IcosahedronGeometry(1, 0);

  /** colored chips + sandy dust shooting up and out from a spot */
  burst(x: number, z: number, color: string | number, count = 16) {
    for (let i = 0; i < count; i++) {
      const dust = i % 3 === 0;
      const m = new THREE.Mesh(
        dust ? this.puff : this.cube,
        new THREE.MeshStandardMaterial({ color: dust ? 0xe8dcb5 : color, transparent: true, flatShading: true }),
      );
      const size = dust ? 0.05 + Math.random() * 0.04 : 0.035 + Math.random() * 0.03;
      m.scale.setScalar(size);
      m.position.set(x, 0.3, z);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6;
      this.add(m, new THREE.Vector3(Math.cos(a) * sp, 1.6 + Math.random() * 1.8, Math.sin(a) * sp), 0.9 + Math.random() * 0.4, dust ? 1.8 : 0);
    }
  }

  /** dark smoke ring (the Raider landing) */
  smoke(x: number, z: number) {
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.puff, new THREE.MeshStandardMaterial({ color: 0x3b3346, transparent: true, flatShading: true, opacity: 0.85 }));
      m.scale.setScalar(0.07 + Math.random() * 0.05);
      m.position.set(x, 0.25, z);
      const a = (i / 14) * Math.PI * 2;
      this.add(m, new THREE.Vector3(Math.cos(a) * 1.1, 0.35 + Math.random() * 0.4, Math.sin(a) * 1.1), 1.1, 2.2, false);
    }
  }

  private add(mesh: THREE.Mesh, vel: THREE.Vector3, life: number, grow: number, gravity = true) {
    mesh.castShadow = true;
    if (!gravity) mesh.userData.floaty = true;
    this.group.add(mesh);
    this.list.push({ mesh, vel, life, max: life, grow, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
  }

  tick(dt: number) {
    this.list = this.list.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      if (!p.mesh.userData.floaty) p.vel.y -= 6 * dt;
      p.vel.multiplyScalar(p.mesh.userData.floaty ? 0.94 : 0.985);
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.22) {
        p.mesh.position.y = 0.22;
        p.vel.y *= -0.35;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(1, (p.life / p.max) * 1.6) * (p.mesh.userData.floaty ? 0.85 : 1);
      return true;
    });
  }
}

// -------------------------------------------------------------------- ocean

/** Low-poly ocean whose vertices roll gently. */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private base: Float32Array;

  constructor() {
    const geo = new THREE.PlaneGeometry(90, 90, 72, 72);
    this.base = (geo.attributes.position.array as Float32Array).slice();
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x1f78b4, roughness: 0.35, metalness: 0.1, flatShading: true }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = -0.16;
    this.mesh.receiveShadow = true;
  }

  tick(time: number) {
    const pos = this.mesh.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const t = time / 1000;
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.base[i], y = this.base[i + 1];
      arr[i + 2] = 0.06 * Math.sin(x * 0.7 + t * 1.1) + 0.05 * Math.cos(y * 0.9 - t * 0.8) + 0.025 * Math.sin((x + y) * 1.7 + t * 2);
    }
    pos.needsUpdate = true;
  }
}

// ------------------------------------------------------------------- clouds

/** A few puffy clouds circling the island at the horizon. */
export class Clouds {
  readonly group = new THREE.Group();
  private clouds: { obj: THREE.Group; r: number; a: number; speed: number; y: number }[] = [];

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + Math.random() * 0.5, 1), mat);
        puff.position.set(k * 0.8 - n * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.6);
        puff.scale.y = 0.65;
        g.add(puff);
      }
      g.traverse((o) => (o.castShadow = true));
      this.group.add(g);
      this.clouds.push({ obj: g, r: 13 + Math.random() * 9, a: (i / 7) * Math.PI * 2 + Math.random(), speed: 0.012 + Math.random() * 0.012, y: 2.2 + Math.random() * 2.2 });
    }
  }

  tick(dt: number) {
    for (const c of this.clouds) {
      c.a += c.speed * dt;
      c.obj.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
      c.obj.rotation.y = -c.a;
    }
  }
}
