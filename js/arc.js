import * as THREE from 'three';

// Sprites need a texture: an untextured SpriteMaterial renders as a flat
// opaque square, which is exactly what showed up in front of the railgun.
function makeGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const GLOW = makeGlowTexture();

// The Aegis Emitter's lifeline: a jagged electrical arc strung between the
// emitter and whatever it has locked. Built as three nested camera-facing
// ribbons following one shared path — a white-hot core, a coloured body, and
// a wide soft halo — so it reads as a bolt rather than a line.

const SEGS = 26;
const LAYERS = [
  { width: 0.055, color: 0xffffff, opacity: 0.95 },
  { width: 0.16, color: 0x66ff9c, opacity: 0.6 },
  { width: 0.42, color: 0x2fbf60, opacity: 0.22 },
];

// The railgun's discharge: a solid blue lance that appears instantly along
// the shot line and burns out over a moment. Three nested cylinders — a
// white-hot core, a saturated body and a soft bloom — plus a muzzle flash.
export function createRailBeam(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const LAYERS = [
    { r: 0.055, color: 0xffffff, opacity: 1.0 },
    { r: 0.15, color: 0x5aa8ff, opacity: 0.75 },
    { r: 0.36, color: 0x2266dd, opacity: 0.3 },
  ];
  const shells = LAYERS.map((L) => {
    const geo = new THREE.CylinderGeometry(L.r, L.r, 1, 12, 1, true);
    geo.rotateZ(-Math.PI / 2); // lie along +X
    geo.translate(0.5, 0, 0);  // so scale.x is the beam length
    const mat = new THREE.MeshBasicMaterial({
      color: L.color, transparent: true, opacity: L.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, mat, baseOpacity: L.opacity };
  });

  const flashMat = new THREE.SpriteMaterial({
    map: GLOW, color: 0xbfe0ff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flash = new THREE.Sprite(flashMat);
  group.add(flash);

  const _x = new THREE.Vector3(1, 0, 0);
  const _q = new THREE.Quaternion();
  let life = 0;
  const LIFE = 0.42;

  function fire(from, dir, length) {
    group.position.copy(from);
    _q.setFromUnitVectors(_x, dir);
    group.quaternion.copy(_q);
    for (const s of shells) s.mesh.scale.set(length, 1, 1);
    flash.position.set(0.4, 0, 0);
    life = LIFE;
    group.visible = true;
  }

  function update(dt) {
    if (life <= 0) return;
    life -= dt;
    if (life <= 0) {
      group.visible = false;
      return;
    }
    const f = life / LIFE;
    for (const s of shells) {
      s.mat.opacity = s.baseOpacity * f * f;
      s.mesh.scale.y = s.mesh.scale.z = 0.4 + 0.6 * f;
    }
    flashMat.opacity = 0.9 * f;
    flash.scale.setScalar(1.6 * (0.4 + 0.6 * f));
  }

  function hide() {
    life = 0;
    group.visible = false;
  }

  return { fire, update, hide };
}

// The short arc that jumps between the Aegis's two prong tips. It lives on
// the turret rather than in the world, so it is parented, not positioned.
//
// `scale` is the gap it has to bridge relative to the 0.30 the proportions
// below were drawn for. Ribbon widths and wander amplitude both track it, so
// a four-times-wider spark gap gets a four-times-heavier arc rather than a
// hairline strung across a big empty fork.
export function createProngArc(parent, scale = 1) {
  const SEG = 12;
  const group = new THREE.Group();
  parent.add(group);

  const layers = [
    { w: 0.028, c: 0xffffff, o: 0.95 },
    { w: 0.075, c: 0xffd23d, o: 0.6 },
    { w: 0.17, c: 0xffa914, o: 0.25 },
  ];
  const ribbons = layers.map((L) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: L.c, transparent: true, opacity: L.o,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { geo, mat, w: L.w * scale, base: L.o };
  });

  const seeds = [];
  for (let i = 0; i <= SEG; i++) seeds.push({ a: Math.random() * 6.28, s: 14 + Math.random() * 22 });

  const _c = new THREE.Color();
  let t = 0;

  // from/to are in the parent's local space; colour is the beam's state
  function update(dt, from, to, colour, strength, pulse) {
    t += dt;
    _c.set(colour);
    const amp = (0.045 + 0.03 * pulse) * scale;
    for (let li = 0; li < ribbons.length; li++) {
      const r = ribbons[li];
      r.mat.color.copy(_c);
      if (li === 0) r.mat.color.lerp(new THREE.Color(0xffffff), 0.7);
      r.mat.opacity = r.base * strength * (0.75 + 0.25 * Math.sin(t * 18 + li));
      const pos = r.geo.attributes.position;
      for (let i = 0; i <= SEG; i++) {
        const f = i / SEG;
        const taper = Math.sin(f * Math.PI);
        const s = seeds[i];
        const jy = Math.sin(t * s.s + s.a) * amp * taper;
        const jx = Math.cos(t * s.s * 0.7 + s.a) * amp * taper;
        const x = from.x + (to.x - from.x) * f + jx;
        const y = from.y + (to.y - from.y) * f + jy;
        const z = from.z + (to.z - from.z) * f;
        const w = r.w * (0.5 + 0.5 * taper);
        pos.setXYZ(i * 2, x, y + w, z);
        pos.setXYZ(i * 2 + 1, x, y - w, z);
      }
      pos.needsUpdate = true;
      r.geo.computeBoundingSphere();
    }
  }

  function setVisible(v) { group.visible = v; }
  setVisible(false);

  return { update, setVisible, group };
}

export function createArcBeam(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const ribbons = LAYERS.map((L) => {
    const geo = new THREE.BufferGeometry();
    // two vertices per path point, stitched into a strip
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGS + 1) * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < SEGS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: L.color,
      transparent: true,
      opacity: L.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, geo, mat, width: L.width, baseOpacity: L.opacity };
  });

  // muzzle flare and a bloom where the arc lands
  const flareMat = new THREE.SpriteMaterial({
    map: GLOW, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flare = new THREE.Sprite(flareMat);
  flare.scale.setScalar(0.8);
  group.add(flare);

  const impactMat = flareMat.clone();
  const impact = new THREE.Sprite(impactMat);
  impact.scale.setScalar(1.2);
  group.add(impact);

  // per-point wander, re-rolled slowly so the bolt writhes instead of buzzing
  const seeds = [];
  for (let i = 0; i <= SEGS; i++) {
    seeds.push({
      a: Math.random() * Math.PI * 2,
      b: Math.random() * Math.PI * 2,
      s1: 4 + Math.random() * 7,
      s2: 9 + Math.random() * 12,
    });
  }

  const _dir = new THREE.Vector3();
  const _view = new THREE.Vector3();
  const _perp = new THREE.Vector3();
  const _side = new THREE.Vector3();
  const _pt = new THREE.Vector3();
  const _prev = new THREE.Vector3();
  const _colour = new THREE.Color();

  let t = 0;
  let intensity = 0;

  function update(dt, camera, from, to, active, colour) {
    t += dt;
    intensity += ((active ? 1 : 0) - intensity) * Math.min(1, (active ? 22 : 12) * dt);
    if (intensity < 0.02) {
      group.visible = false;
      return;
    }
    group.visible = true;

    _colour.set(colour);
    for (let li = 0; li < ribbons.length; li++) {
      const r = ribbons[li];
      // the core stays white; the body and halo take the beam's colour
      if (li === 0) r.mat.color.setRGB(
        0.75 + 0.25 * _colour.r, 0.75 + 0.25 * _colour.g, 0.75 + 0.25 * _colour.b
      );
      else r.mat.color.copy(_colour).multiplyScalar(li === 1 ? 1 : 0.75);
      r.mat.opacity = r.baseOpacity * intensity;
    }

    _dir.copy(to).sub(from);
    const len = _dir.length() || 0.001;
    _dir.divideScalar(len);
    _view.copy(camera.position).sub(from).normalize();
    _perp.copy(_dir).cross(_view);
    if (_perp.lengthSq() < 1e-6) _perp.set(0, 1, 0);
    _perp.normalize();
    _side.copy(_dir).cross(_perp).normalize();

    // amplitude tapers to nothing at both ends so it stays pinned
    const amp = Math.min(0.55, 0.10 + len * 0.035);

    for (const r of ribbons) {
      const pos = r.geo.attributes.position;
      for (let i = 0; i <= SEGS; i++) {
        const f = i / SEGS;
        const taper = Math.sin(f * Math.PI); // 0 at the ends, 1 in the middle
        const s = seeds[i];
        const jx = Math.sin(t * s.s1 + s.a) * amp * taper;
        const jy = Math.cos(t * s.s2 + s.b) * amp * taper * 0.7;

        _pt.copy(from).addScaledVector(_dir, len * f);
        _pt.addScaledVector(_perp, jx);
        _pt.addScaledVector(_side, jy);

        // ribbon width follows the local direction, so corners stay solid
        if (i === 0) _prev.copy(_pt);
        const w = r.width * (0.55 + 0.45 * taper);
        pos.setXYZ(i * 2, _pt.x + _perp.x * w, _pt.y + _perp.y * w, _pt.z + _perp.z * w);
        pos.setXYZ(i * 2 + 1, _pt.x - _perp.x * w, _pt.y - _perp.y * w, _pt.z - _perp.z * w);
      }
      pos.needsUpdate = true;
      r.geo.computeBoundingSphere();
    }

    flare.position.copy(from);
    flareMat.color.copy(_colour).lerp(new THREE.Color(0xffffff), 0.6);
    flareMat.opacity = 0.75 * intensity * (0.8 + 0.2 * Math.sin(t * 40));
    flare.scale.setScalar(0.55 + 0.15 * Math.sin(t * 33));

    impact.position.copy(to);
    impactMat.color.copy(_colour).lerp(new THREE.Color(0xffffff), 0.35);
    impactMat.opacity = 0.7 * intensity * (0.75 + 0.25 * Math.sin(t * 27 + 1.1));
    impact.scale.setScalar(0.9 + 0.25 * Math.sin(t * 19));
  }

  function hide() {
    intensity = 0;
    group.visible = false;
  }

  function dispose() {
    for (const r of ribbons) {
      r.geo.dispose();
      r.mat.dispose();
    }
    flareMat.dispose();
    impactMat.dispose();
    scene.remove(group);
  }

  return { update, hide, dispose };
}
