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
const WHITE = new THREE.Color(0xffffff);

// The Aegis Emitter's lifeline: a jagged electrical arc strung between the
// emitter and whatever it has locked. Built as three nested camera-facing
// ribbons following one shared path — a white-hot core, a coloured body, and
// a wide soft halo — so it reads as a bolt rather than a line.

const SEGS = 26;
// Radii, not half-widths: the lifeline is built from the same nested tubes
// the prong arc uses, sized to sit alongside it rather than dwarf it.
const LAYERS = [
  { radius: 0.026, color: 0xffffff, opacity: 0.95 },
  { radius: 0.062, color: 0x66ff9c, opacity: 0.55 },
  { radius: 0.115, color: 0x2fbf60, opacity: 0.20 },
];
const BEAM_SIDES = 6;

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
// Built as three nested TUBES, not flat ribbons. The ribbon version offset
// each path point by +/- w in Y, which meant the strip only had area when the
// gap ran across Y — and once the prongs went horizontal and the widths were
// scaled with the gap, the outer layer became a 1.4 m flat card hanging in
// mid-air that swung about as the camera moved. A tube reads as a bolt from
// every angle and needs no billboarding.
//
// `scale` is the gap it bridges relative to the 0.30 it was drawn for. It
// drives how far the bolt WANDERS, which is the part that should grow with
// the gap; the radii stay small and absolute, because a spark does not get
// fatter just because the electrodes moved apart.
const ARC_SEG = 14;   // points along the bolt
const ARC_SIDES = 6;  // faces around it

export function createProngArc(parent, scale = 1) {
  const group = new THREE.Group();
  parent.add(group);

  const layers = [
    { r: 0.022, c: 0xffffff, o: 0.95 },
    { r: 0.055, c: 0xffd23d, o: 0.55 },
    { r: 0.095, c: 0xffa914, o: 0.20 },
  ];

  const tubes = layers.map((L) => {
    const geo = new THREE.BufferGeometry();
    const verts = (ARC_SEG + 1) * ARC_SIDES;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    const idx = [];
    for (let i = 0; i < ARC_SEG; i++) {
      for (let s = 0; s < ARC_SIDES; s++) {
        const a = i * ARC_SIDES + s;
        const b = i * ARC_SIDES + ((s + 1) % ARC_SIDES);
        const c = a + ARC_SIDES;
        const d = b + ARC_SIDES;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: L.c, transparent: true, opacity: L.o,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { geo, mat, r: L.r, base: L.o };
  });

  const seeds = [];
  for (let i = 0; i <= ARC_SEG; i++) {
    seeds.push({ a: Math.random() * 6.28, b: Math.random() * 6.28, s: 14 + Math.random() * 22 });
  }

  const _c = new THREE.Color();
  const _pt = new THREE.Vector3();
  const _tan = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _bn = new THREE.Vector3();
  const _ref = new THREE.Vector3();
  const path = [];
  for (let i = 0; i <= ARC_SEG; i++) path.push(new THREE.Vector3());
  let t = 0;

  // from/to are in the parent's local space; colour is the beam's state
  function update(dt, from, to, colour, strength, pulse) {
    t += dt;
    _c.set(colour);

    // one shared jittered path, so every layer sits concentric
    const amp = (0.015 + 0.010 * pulse) * scale;
    for (let i = 0; i <= ARC_SEG; i++) {
      const f = i / ARC_SEG;
      const taper = Math.sin(f * Math.PI); // pinned at both tips
      const s = seeds[i];
      path[i].set(
        from.x + (to.x - from.x) * f + Math.cos(t * s.s * 0.7 + s.a) * amp * taper,
        from.y + (to.y - from.y) * f + Math.sin(t * s.s + s.a) * amp * taper,
        from.z + (to.z - from.z) * f + Math.sin(t * s.s * 0.55 + s.b) * amp * taper * 0.6
      );
    }

    for (let li = 0; li < tubes.length; li++) {
      const tube = tubes[li];
      tube.mat.color.copy(_c);
      if (li === 0) tube.mat.color.lerp(WHITE, 0.7);
      tube.mat.opacity = tube.base * strength * (0.75 + 0.25 * Math.sin(t * 18 + li));

      const pos = tube.geo.attributes.position;
      for (let i = 0; i <= ARC_SEG; i++) {
        _pt.copy(path[i]);
        // tangent from the neighbours, so the tube follows the wander
        _tan.copy(path[Math.min(ARC_SEG, i + 1)]).sub(path[Math.max(0, i - 1)]);
        if (_tan.lengthSq() < 1e-9) _tan.set(0, 0, 1);
        _tan.normalize();
        // any reference not parallel to the tangent gives a stable ring
        _ref.set(0, 1, 0);
        if (Math.abs(_tan.y) > 0.9) _ref.set(1, 0, 0);
        _n.crossVectors(_tan, _ref).normalize();
        _bn.crossVectors(_tan, _n).normalize();

        const f = i / ARC_SEG;
        // taper to a point at each tip so it springs off the electrodes
        const r = tube.r * (0.35 + 0.65 * Math.sin(f * Math.PI) ** 0.5);
        for (let s = 0; s < ARC_SIDES; s++) {
          const ang = (s / ARC_SIDES) * Math.PI * 2;
          const cx = Math.cos(ang) * r;
          const cy = Math.sin(ang) * r;
          pos.setXYZ(
            i * ARC_SIDES + s,
            _pt.x + _n.x * cx + _bn.x * cy,
            _pt.y + _n.y * cx + _bn.y * cy,
            _pt.z + _n.z * cx + _bn.z * cy
          );
        }
      }
      pos.needsUpdate = true;
      tube.geo.computeBoundingSphere();
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

  // Nested tubes, exactly as the prong arc is built. The old version was a
  // pair of camera-facing ribbons — a flat sprite that swung about as you
  // moved and never matched the bolt permanently crackling across the prongs.
  const ribbons = LAYERS.map((L) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array((SEGS + 1) * BEAM_SIDES * 3), 3
    ));
    const idx = [];
    for (let i = 0; i < SEGS; i++) {
      for (let k = 0; k < BEAM_SIDES; k++) {
        const a = i * BEAM_SIDES + k;
        const b = i * BEAM_SIDES + ((k + 1) % BEAM_SIDES);
        idx.push(a, a + BEAM_SIDES, b, b, a + BEAM_SIDES, b + BEAM_SIDES);
      }
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
    return { mesh, geo, mat, radius: L.radius, baseOpacity: L.opacity };
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
  const _tan = new THREE.Vector3();
  const _nrm = new THREE.Vector3();
  const _bin = new THREE.Vector3();
  const _ref = new THREE.Vector3();
  const path = [];
  for (let i = 0; i <= SEGS; i++) path.push(new THREE.Vector3());
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
    // a stable frame about the beam axis, no camera involved any more
    _perp.set(0, 1, 0).cross(_dir);
    if (_perp.lengthSq() < 1e-6) _perp.set(1, 0, 0);
    _perp.normalize();
    _side.copy(_dir).cross(_perp).normalize();

    // amplitude tapers to nothing at both ends so it stays pinned
    const amp = Math.min(0.55, 0.10 + len * 0.035);

    // one shared wandering path, so every layer sits concentric
    for (let i = 0; i <= SEGS; i++) {
      const f = i / SEGS;
      const taper = Math.sin(f * Math.PI);
      const sd = seeds[i];
      path[i].copy(from).addScaledVector(_dir, len * f)
        .addScaledVector(_perp, Math.sin(t * sd.s1 + sd.a) * amp * taper)
        .addScaledVector(_side, Math.cos(t * sd.s2 + sd.b) * amp * taper * 0.7);
    }

    for (const r of ribbons) {
      const pos = r.geo.attributes.position;
      for (let i = 0; i <= SEGS; i++) {
        _pt.copy(path[i]);
        _tan.copy(path[Math.min(SEGS, i + 1)]).sub(path[Math.max(0, i - 1)]);
        if (_tan.lengthSq() < 1e-9) _tan.copy(_dir);
        _tan.normalize();
        _ref.set(0, 1, 0);
        if (Math.abs(_tan.y) > 0.9) _ref.set(1, 0, 0);
        _nrm.crossVectors(_tan, _ref).normalize();
        _bin.crossVectors(_tan, _nrm).normalize();

        const f = i / SEGS;
        // tapered to a point at each end, so it springs off the prongs and
        // lands on the hull rather than stopping dead
        const rad = r.radius * (0.3 + 0.7 * Math.sin(f * Math.PI) ** 0.5);
        for (let k = 0; k < BEAM_SIDES; k++) {
          const ang = (k / BEAM_SIDES) * Math.PI * 2;
          const cx = Math.cos(ang) * rad;
          const cy = Math.sin(ang) * rad;
          pos.setXYZ(
            i * BEAM_SIDES + k,
            _pt.x + _nrm.x * cx + _bin.x * cy,
            _pt.y + _nrm.y * cx + _bin.y * cy,
            _pt.z + _nrm.z * cx + _bin.z * cy
          );
        }
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
