import * as THREE from 'three';
import { heightAt, ARENA } from './map.js';

export const BULLET = {
  speed: 46,
  life: 3,
  damage: 100,
};

export function createBullets(scene) {
  const geo = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 10);
  geo.rotateZ(Math.PI / 2); // axis along +X
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffd27a',
    emissive: '#ff9f2e',
    emissiveIntensity: 2.6,
    roughness: 0.4,
  });

  const pool = [];
  const active = [];

  const _X = new THREE.Vector3(1, 0, 0);
  const _q = new THREE.Quaternion();
  const _local = new THREE.Vector3();

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

  // targets: array of units with { alive, model } — hits call onHit(unit, pos)
  function update(dt, targets, onHit, onEnv) {
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      b.life -= dt;
      b.m.position.addScaledVector(b.vel, dt);
      const p = b.m.position;

      let done = b.life <= 0;

      if (!done && (
        Math.abs(p.x) > ARENA.half - 0.4 ||
        Math.abs(p.z) > ARENA.half - 0.4 ||
        p.y < heightAt(p.x, p.z) ||
        p.y > 40
      )) {
        onEnv(p);
        done = true;
      }

      if (!done) {
        for (const t of targets) {
          if (t === b.owner || !t.alive) continue;
          _local.copy(p);
          t.model.root.worldToLocal(_local);
          if (
            Math.abs(_local.x) < 2.55 &&
            Math.abs(_local.z) < 1.95 &&
            _local.y > -0.15 && _local.y < 2.3
          ) {
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

  return { fire, update };
}
