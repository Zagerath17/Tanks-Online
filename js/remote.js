import * as THREE from 'three';
import { createTankModel } from './tank.js';

// Floating red HP bar above a tank (canvas sprite)
function makeHpBar(root) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 28;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  sprite.scale.set(3.0, 0.33, 1);
  sprite.position.set(0, 4.3, 0);
  root.add(sprite);

  function draw(frac) {
    ctx.clearRect(0, 0, 256, 28);
    ctx.fillStyle = 'rgba(10,12,14,0.72)';
    ctx.fillRect(0, 0, 256, 28);
    ctx.strokeStyle = 'rgba(220,225,230,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, 253, 25);
    ctx.fillStyle = '#d9534a';
    ctx.fillRect(4, 4, 248 * Math.max(0, Math.min(1, frac)), 20);
    tex.needsUpdate = true;
  }
  draw(1);
  return { sprite, draw };
}

function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

export function createRemoteManager({ scene, fx, audio }) {
  const players = new Map(); // pid -> remote unit

  function ensure(pid) {
    let ru = players.get(pid);
    if (ru) return ru;
    const model = createTankModel();
    model.root.rotation.order = 'YZX';
    model.root.visible = false; // until the first full state lands
    scene.add(model.root);
    ru = {
      id: pid,
      isLocal: false,
      model,
      bar: makeHpBar(model.root),
      alive: true,
      hp: 1000,
      cur: { x: 0, y: 0, z: 0, h: 0, gp: 0, gr: 0, ty: 0, tp: 0 },
      tgt: null,
      speed: 0,
      prevX: 0,
      prevZ: 0,
      fireSmoke: 0,
      smokeAcc: 0,
      huskAcc: 0,
      recoil: 0,
    };
    players.set(pid, ru);
    return ru;
  }

  function applyState(pid, s) {
    const ru = ensure(pid);
    if (!s || typeof s.x !== 'number') return; // lobby stub, no game state yet
    const wasAlive = ru.alive;
    ru.tgt = s;
    if (typeof s.hp === 'number') {
      ru.hp = s.hp;
      ru.bar.draw(s.hp / 1000);
    }
    if (!ru.model.root.visible) {
      // first real state: snap into place
      Object.assign(ru.cur, { x: s.x, y: s.y, z: s.z, h: s.h, gp: s.gp, gr: s.gr, ty: s.ty, tp: s.tp });
      ru.prevX = s.x;
      ru.prevZ = s.z;
      ru.model.root.visible = true;
    }
    const aliveNow = s.al !== false;
    if (wasAlive && !aliveNow) dieVisual(ru);
    else if (!wasAlive && aliveNow) reviveVisual(ru, s);
    ru.alive = aliveNow;
  }

  function dieVisual(ru) {
    const pos = new THREE.Vector3(ru.cur.x, ru.cur.y + 1.2, ru.cur.z);
    fx.explosion(pos);
    audio.playAt('explosion', pos, { volume: 1, ref: 14 });
    ru.model.setCharred(true);
    ru.model.turret.rotation.y += (Math.random() - 0.5) * 1.4;
    ru.model.pitchGroup.rotation.z = -0.06;
    ru.bar.sprite.visible = false;
    ru.fireSmoke = 0;
  }

  function reviveVisual(ru, s) {
    ru.model.setCharred(false);
    ru.model.gun.position.x = 0;
    ru.model.pitchGroup.rotation.z = 0;
    ru.bar.sprite.visible = true;
    ru.bar.draw(1);
    // teleport to the fresh spawn — no glide across the map
    Object.assign(ru.cur, { x: s.x, y: s.y, z: s.z, h: s.h, gp: s.gp, gr: s.gr, ty: s.ty, tp: s.tp });
    ru.prevX = s.x;
    ru.prevZ = s.z;
  }

  function removePlayer(pid) {
    const ru = players.get(pid);
    if (!ru) return;
    scene.remove(ru.model.root);
    players.delete(pid);
  }

  // A shot event arrived from this player — kick their barrel and smoke it
  function shotFrom(pid) {
    const ru = players.get(pid);
    if (ru) {
      ru.fireSmoke = 2;
      ru.recoil = 0.22;
    }
    return ru || null;
  }

  const _sm = new THREE.Vector3();
  const _sd = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  function update(dt) {
    for (const ru of players.values()) {
      if (!ru.tgt || !ru.model.root.visible) continue;
      const t = ru.tgt;
      const k = 1 - Math.exp(-12 * dt);
      ru.cur.x += (t.x - ru.cur.x) * k;
      ru.cur.y += (t.y - ru.cur.y) * k;
      ru.cur.z += (t.z - ru.cur.z) * k;
      ru.cur.h = lerpAngle(ru.cur.h, t.h, k);
      ru.cur.gp += (t.gp - ru.cur.gp) * k;
      ru.cur.gr += (t.gr - ru.cur.gr) * k;
      ru.cur.ty = lerpAngle(ru.cur.ty, t.ty, k);
      ru.cur.tp += (t.tp - ru.cur.tp) * k;

      const m = ru.model;
      m.root.position.set(ru.cur.x, ru.cur.y, ru.cur.z);
      m.root.rotation.y = ru.cur.h;
      m.root.rotation.z = ru.cur.gp;
      m.root.rotation.x = ru.cur.gr;
      if (ru.alive) {
        m.turret.rotation.y = ru.cur.ty;
        m.pitchGroup.rotation.z = ru.cur.tp;
      }

      // treads follow actual ground motion along the hull axis
      const dx = ru.cur.x - ru.prevX;
      const dz = ru.cur.z - ru.prevZ;
      ru.prevX = ru.cur.x;
      ru.prevZ = ru.cur.z;
      const fwd = dx * Math.cos(ru.cur.h) + dz * -Math.sin(ru.cur.h);
      const sp = dt > 0 ? fwd / dt : 0;
      ru.speed += (sp - ru.speed) * Math.min(1, 10 * dt);
      if (ru.alive) m.updateTreads(dt, ru.speed, ru.speed);

      // barrel recoil + after-shot smoke
      ru.recoil = Math.max(0, ru.recoil - dt * (0.4 + ru.recoil * 9));
      m.gun.position.x = -ru.recoil;
      if (ru.fireSmoke > 0 && ru.alive) {
        ru.fireSmoke -= dt;
        ru.smokeAcc += dt;
        while (ru.smokeAcc > 0.07) {
          ru.smokeAcc -= 0.07;
          m.muzzle.getWorldPosition(_sm);
          m.muzzle.getWorldQuaternion(_q);
          _sd.set(1, 0, 0).applyQuaternion(_q);
          fx.barrelSmoke(_sm, _sd);
        }
      }

      if (!ru.alive) {
        ru.huskAcc += dt;
        while (ru.huskAcc > 0.13) {
          ru.huskAcc -= 0.13;
          fx.huskSmoke(m.root.position);
        }
      }
    }
  }

  function targets() {
    return [...players.values()];
  }

  function alivePositions() {
    const out = [];
    for (const ru of players.values()) {
      if (ru.alive && ru.model.root.visible) out.push({ x: ru.cur.x, z: ru.cur.z });
    }
    return out;
  }

  function clear() {
    for (const pid of [...players.keys()]) removePlayer(pid);
  }

  return { applyState, removePlayer, shotFrom, update, targets, alivePositions, clear };
}
