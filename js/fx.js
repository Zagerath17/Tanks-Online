import * as THREE from 'three';

// Soft radial sprite texture, reused (tinted) for smoke, fire, and flashes
function makePuffTexture(size = 128, inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.45)') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, mid);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFx(scene) {
  const puffTex = makePuffTexture();
  const flashTex = makePuffTexture(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0.8)');

  const particles = [];

  // Fixed pool of point lights that live in the scene permanently at zero
  // intensity. Adding/removing lights forces three.js to recompile every
  // shader — that was the first-shot freeze. Reusing these never does.
  const lightPool = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 16, 2);
    l.position.set(0, -200, 0);
    scene.add(l);
    lightPool.push({ l, life: 0, maxLife: 1, intensity: 0 });
  }

  function flashLight(pos, { color = 0xffb45e, intensity = 30, life = 0.09, distance = 16 } = {}) {
    let slot = lightPool.find((s) => s.life <= 0);
    if (!slot) slot = lightPool[0];
    slot.l.color.set(color);
    slot.l.distance = distance;
    slot.l.position.copy(pos);
    slot.life = life;
    slot.maxLife = life;
    slot.intensity = intensity;
    slot.l.intensity = intensity;
  }

  function spawn({
    pos, vel = null, life = 1, scale = 1, grow = 0, color = 0xffffff,
    opacity = 1, additive = false, gravity = 0, drag = 0,
  }) {
    const mat = new THREE.SpriteMaterial({
      map: additive ? flashTex : puffTex,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(scale);
    scene.add(s);
    particles.push({
      s, mat,
      vel: vel ? vel.clone() : new THREE.Vector3(),
      life, maxLife: life, grow, gravity, drag,
      baseOpacity: opacity,
    });
  }

  // ---- effect recipes ------------------------------------------------------

  function muzzleFlash(pos, dir) {
    spawn({ pos, life: 0.07, scale: 1.7, grow: 8, color: 0xffdf9e, opacity: 1, additive: true });
    spawn({
      pos: pos.clone().addScaledVector(dir, 0.5),
      life: 0.06, scale: 1.0, grow: 5, color: 0xffa244, opacity: 0.9, additive: true,
    });
    for (let i = 0; i < 5; i++) {
      const v = dir.clone().multiplyScalar(9 + Math.random() * 7);
      v.x += (Math.random() - 0.5) * 4;
      v.y += (Math.random() - 0.5) * 4;
      v.z += (Math.random() - 0.5) * 4;
      spawn({
        pos, vel: v, life: 0.14 + Math.random() * 0.1, scale: 0.22,
        color: 0xffc26a, additive: true, drag: 4,
      });
    }
    flashLight(pos);
  }

  function barrelSmoke(pos, dir) {
    const v = dir.clone().multiplyScalar(1.2 + Math.random() * 0.8);
    v.y += 0.7 + Math.random() * 0.5;
    v.x += (Math.random() - 0.5) * 0.5;
    v.z += (Math.random() - 0.5) * 0.5;
    spawn({
      pos, vel: v, life: 1.1 + Math.random() * 0.5, scale: 0.5 + Math.random() * 0.3,
      grow: 1.4, color: 0xb8bcc2, opacity: 0.4, drag: 1.2,
    });
  }

  function huskSmoke(pos) {
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 0.7,
      1.4 + Math.random() * 0.8,
      (Math.random() - 0.5) * 0.7
    );
    spawn({
      pos: pos.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.6, 1.0 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2
      )),
      vel: v, life: 1.6 + Math.random() * 0.9, scale: 0.9 + Math.random() * 0.7,
      grow: 1.5, color: 0x17181a, opacity: 0.55, drag: 0.6,
    });
  }

  function bulletTrail(pos) {
    spawn({
      pos,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.35, (Math.random() - 0.5) * 0.2),
      life: 0.22 + Math.random() * 0.1,
      scale: 0.14,
      grow: 0.8,
      color: 0x2c2e33,
      opacity: 0.42,
      drag: 0.5,
    });
  }

  function impact(pos) {
    spawn({ pos, life: 0.08, scale: 1.1, grow: 6, color: 0xffd08a, additive: true });
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 12, Math.random() * 8, (Math.random() - 0.5) * 12
      );
      spawn({
        pos, vel: v, life: 0.2 + Math.random() * 0.15, scale: 0.18,
        color: 0xffb75e, additive: true, gravity: -14, drag: 2,
      });
    }
    spawn({
      pos, vel: new THREE.Vector3(0, 1.5, 0), life: 0.8, scale: 0.7, grow: 1.6,
      color: 0x9aa0a8, opacity: 0.4, drag: 1,
    });
    flashLight(pos, { intensity: 14, distance: 10, life: 0.07 });
  }

  function explosion(pos) {
    spawn({ pos, life: 0.12, scale: 4.5, grow: 34, color: 0xfff1c0, additive: true });
    spawn({ pos, life: 0.28, scale: 3.0, grow: 16, color: 0xff9a3c, additive: true, opacity: 0.95 });
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 16, Math.random() * 12 + 2, (Math.random() - 0.5) * 16
      );
      spawn({
        pos, vel: v, life: 0.35 + Math.random() * 0.3, scale: 0.9 + Math.random() * 0.7,
        grow: 2.5, color: 0xff8432, additive: true, opacity: 0.9, gravity: -6, drag: 1.5,
      });
    }
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 7, Math.random() * 6 + 1.5, (Math.random() - 0.5) * 7
      );
      spawn({
        pos: pos.clone(), vel: v, life: 1.6 + Math.random() * 1.2,
        scale: 1.2 + Math.random(), grow: 2.2, color: 0x1c1d20, opacity: 0.6, drag: 0.9,
      });
    }
    flashLight(pos, { intensity: 90, distance: 34, life: 0.16, color: 0xffa050 });
  }

  // Compile every material variant during the menu, far below the arena, so
  // nothing hitches the first time an effect appears in a match.
  function prewarm() {
    const p = new THREE.Vector3(0, -160, 0);
    spawn({ pos: p, life: 0.1, scale: 0.3, color: 0x888888, opacity: 0.2 });
    spawn({ pos: p, life: 0.1, scale: 0.3, color: 0x888888, opacity: 0.2, additive: true });
    bulletTrail(p.clone());
    flashLight(p, { intensity: 0.01, life: 0.08 });
  }

  // ---- per-frame update ----------------------------------------------------

  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        scene.remove(p.s);
        p.mat.dispose();
        particles.splice(i, 1);
        continue;
      }
      if (p.gravity) p.vel.y += p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      if (p.grow) {
        const g = 1 + p.grow * dt / p.s.scale.x;
        p.s.scale.multiplyScalar(g);
      }
      p.mat.opacity = p.baseOpacity * (p.life / p.maxLife);
    }

    for (const slot of lightPool) {
      if (slot.life > 0) {
        slot.life -= dt;
        slot.l.intensity = slot.life <= 0 ? 0 : slot.intensity * (slot.life / slot.maxLife);
      }
    }
  }

  return { muzzleFlash, barrelSmoke, huskSmoke, bulletTrail, impact, explosion, prewarm, update };
}
