import * as THREE from 'three';
import { heightAt, ARENA } from './map.js';

export const BULLET = {
  speed: 172, // 2.5x the old 46, then +50% more
  life: 1.8,
  damage: 200,
};

export function createBullets(scene, fx) {
  // Short, completely black shell
  const geo = new THREE.CylinderGeometry(0.05, 0.05, 0.275, 8);
  geo.rotateZ(Math.PI / 2); // axis along +X
  const mat = new THREE.MeshStandardMaterial({
    color: '#0a0b0d',
    roughness: 0.5,
    metalness: 0.25,
  });

  const pool = [];
  const active = [];

  const _X = new THREE.Vector3(1, 0, 0);
  const _q = new THREE.Quaternion();

  function getMesh() {
    let m = pool.pop();
    if (!m) m = new THREE.Mesh(geo, mat);
    scene.add(m);
    return m;
  }

  function fire(owner, pos, dir) {
    const m = getMesh();
    m.position.copy(pos);
    _q.setFromUnitVectors(_X, dir);
    m.quaternion.copy(_q);
    active.push({
      m,
      vel: dir.clone().multiplyScalar(BULLET.speed),
      life: BULLET.life,
      owner,
    });
  }

  const DEFAULT_ENV = { groundAt: heightAt, half: ARENA.half - 0.4, solidAt: null };

  // targets: array of units with { alive, model } — hits call onHit(unit, pos).
  // env: { groundAt(x,z), half, solidAt(p) } — the world the shells fly in.
  function update(dt, targets, onHit, onEnv, env = DEFAULT_ENV) {
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      b.life -= dt;
      b.m.position.addScaledVector(b.vel, dt);
      const p = b.m.position;

      // very thin smoke trail, gone quickly
      fx.bulletTrail(p);

      let done = b.life <= 0;

      if (!done && (
        Math.abs(p.x) > env.half ||
        Math.abs(p.z) > env.half ||
        p.y <= env.groundAt(p.x, p.z) ||
        p.y > 80 ||
        (env.solidAt && env.solidAt(p))
      )) {
        onEnv(p);
        done = true;
      }

      if (!done) {
        for (const t of targets) {
          if (t === b.owner || !t.alive) continue;
          if (t.model.hitTest(p)) {
            onHit(t, p);
            done = true;
            break;
          }
        }
      }

      if (done) {
        scene.remove(b.m);
        pool.push(b.m);
        active.splice(i, 1);
      }
    }
  }

  function clear() {
    for (const b of active) {
      scene.remove(b.m);
      pool.push(b.m);
    }
    active.length = 0;
  }

  // Render one shell far below the arena during the menu so its shader
  // compiles before the first real shot
  function prewarm() {
    const m = getMesh();
    m.position.set(0, -160, 0);
    setTimeout(() => {
      scene.remove(m);
      pool.push(m);
    }, 400);
  }

  return { fire, update, clear, prewarm };
}
