import * as THREE from 'three';
import { heightAt, ARENA } from './map.js';

// Projectile kinds. Range is a real distance budget in metres, so a bolt
// expires exactly where it should regardless of how fast it flies. Nothing
// here is affected by gravity — every projectile flies dead flat.
export const PROJECTILES = {
  shell: {
    speed: 172,
    range: 310,
    damage: 200,
    trail: 'smoke',
  },
  plasma: {
    speed: 86, // half the shell's muzzle velocity
    range: 70, // expires at 70 m
    damage: 25,
    trail: 'plasma',
  },
};

// kept for older call sites that just want the shell's numbers
export const BULLET = PROJECTILES.shell;

// Soft radial sprite used for the bolt's corona
function makeCoronaTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(220,242,255,0.95)');
  g.addColorStop(0.28, 'rgba(110,190,255,0.55)');
  g.addColorStop(0.62, 'rgba(45,120,255,0.20)');
  g.addColorStop(1, 'rgba(30,90,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBullets(scene, fx) {
  // ---- shell: a short matte-black dart --------------------------------------
  const shellGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.275, 8);
  shellGeo.rotateZ(Math.PI / 2); // axis along +X
  const shellMat = new THREE.MeshStandardMaterial({
    color: '#0a0b0d',
    roughness: 0.5,
    metalness: 0.25,
  });

  // ---- plasma: a layered bolt of contained blue fire ------------------------
  // core (unlit, always blazing) -> inner plasma shell -> outer halo ->
  // billboarded corona, so it reads as a glowing volume from any angle.
  const coronaTex = makeCoronaTexture();

  const coreGeo = new THREE.IcosahedronGeometry(0.085, 1);
  const coreMat = new THREE.MeshBasicMaterial({ color: '#eaf6ff' });

  const innerGeo = new THREE.IcosahedronGeometry(0.165, 2);
  const innerMat = new THREE.MeshBasicMaterial({
    color: '#7ec5ff',
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const haloGeo = new THREE.SphereGeometry(0.27, 16, 12);
  const haloMat = new THREE.MeshBasicMaterial({
    color: '#2f7dff',
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });

  const coronaMat = new THREE.SpriteMaterial({
    map: coronaTex,
    color: '#9fd8ff',
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  function buildPlasma() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(coreGeo, coreMat);
    const inner = new THREE.Mesh(innerGeo, innerMat);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    const corona = new THREE.Sprite(coronaMat);
    corona.scale.setScalar(1.15);
    g.add(halo, inner, core, corona);
    g.userData.core = core;
    g.userData.inner = inner;
    g.userData.corona = corona;
    return g;
  }

  const pools = { shell: [], plasma: [] };
  const active = [];

  const _X = new THREE.Vector3(1, 0, 0);
  const _q = new THREE.Quaternion();

  function getMesh(kind) {
    let m = pools[kind].pop();
    if (!m) m = kind === 'plasma' ? buildPlasma() : new THREE.Mesh(shellGeo, shellMat);
    scene.add(m);
    return m;
  }

  // kind: 'shell' | 'plasma'
  function fire(owner, pos, dir, kind = 'shell') {
    const spec = PROJECTILES[kind] || PROJECTILES.shell;
    const m = getMesh(spec === PROJECTILES.plasma ? 'plasma' : 'shell');
    m.position.copy(pos);
    _q.setFromUnitVectors(_X, dir);
    m.quaternion.copy(_q);
    active.push({
      m,
      kind: spec === PROJECTILES.plasma ? 'plasma' : 'shell',
      vel: dir.clone().multiplyScalar(spec.speed),
      travelled: 0,
      range: spec.range,
      damage: spec.damage,
      trail: spec.trail,
      age: 0,
      owner,
    });
  }

  const DEFAULT_ENV = { groundAt: heightAt, half: ARENA.half - 0.4, solidAt: null };

  // targets: array of units with { alive, model } — hits call onHit(unit, pos, damage).
  // env: { groundAt(x,z), half, solidAt(p) } — the world the shells fly in.
  function update(dt, targets, onHit, onEnv, env = DEFAULT_ENV) {
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      const step = b.vel.length() * dt;
      b.travelled += step;
      b.age += dt;
      b.m.position.addScaledVector(b.vel, dt);
      const p = b.m.position;

      if (b.trail === 'plasma') {
        // the bolt sheds glowing motes and pulses as it flies
        fx.plasmaTrail(p);
        const pulse = 1 + 0.14 * Math.sin(b.age * 34);
        b.m.userData.inner.scale.setScalar(pulse);
        b.m.userData.corona.scale.setScalar(1.15 * (1 + 0.1 * Math.sin(b.age * 21 + 1.4)));
        b.m.userData.core.rotation.x += dt * 9;
        b.m.userData.core.rotation.y += dt * 7;
      } else {
        fx.bulletTrail(p);
      }

      let done = b.travelled >= b.range;

      if (!done && (
        Math.abs(p.x) > env.half ||
        Math.abs(p.z) > env.half ||
        p.y <= env.groundAt(p.x, p.z) ||
        p.y > 80 ||
        (env.solidAt && env.solidAt(p))
      )) {
        onEnv(p, b.kind);
        done = true;
      }

      if (!done) {
        for (const t of targets) {
          if (t === b.owner || !t.alive) continue;
          if (t.model.hitTest(p)) {
            onHit(t, p, b.damage, b.kind);
            done = true;
            break;
          }
        }
      }

      if (done) {
        scene.remove(b.m);
        pools[b.kind].push(b.m);
        active.splice(i, 1);
      }
    }
  }

  function clear() {
    for (const b of active) {
      scene.remove(b.m);
      pools[b.kind].push(b.m);
    }
    active.length = 0;
  }

  // Render one of each far below the arena during the menu so their shaders
  // compile before the first real shot
  function prewarm() {
    const made = [getMesh('shell'), getMesh('plasma')];
    for (const m of made) m.position.set(0, -160, 0);
    setTimeout(() => {
      scene.remove(made[0]);
      pools.shell.push(made[0]);
      scene.remove(made[1]);
      pools.plasma.push(made[1]);
    }, 400);
  }

  return { fire, update, clear, prewarm };
}
