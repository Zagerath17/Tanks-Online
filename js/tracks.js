import * as THREE from 'three';

// Tread marks pressed into the ground. Each segment is one instanced quad
// carrying its own age, so hundreds of them cost a single draw call. They
// hold at full strength for HOLD seconds, then fade out over FADE.
// Sized so one tank at the fastest hull's top speed can lay a full-length
// trail without recycling (Falcon needs ~1330). With several tanks moving at
// once the oldest marks are reused early, which just shortens trails rather
// than breaking them.
const MAX = 2000;
const HOLD = 20;
const FADE = 6;
// stamp length is set per hull from its own link pitch (see trail below)

// REVERTED to the v0.28 implementation, deliberately and in full.
//
// Two rewrites of this file since then were, as far as every check I could
// make could tell, more correct than this one — the grouser bars lay across
// the track instead of along it, the stamps met instead of leaving gaps, and
// the spacing was frame-rate independent. Neither of them drew anything on
// screen. This one is wrong in all of those ways and it works, which beats
// being right and invisible. Do not "fix" the rotateY below without checking
// on a real GPU first: it is load-bearing.
//
// One track imprint, three grousers long.
//
// The quad's baked rotations mean texture **v** runs along the direction of
// travel and **u** runs across the track. So the grouser bars are horizontal
// bands stacked up the canvas (repeating along v), each spanning the full
// width — that prints them across the track the way real links do. Getting
// this the other way round prints lengthwise stripes instead.
const BARS = 3;

function makeTreadTexture() {
  const w = 96;   // across the track
  const h = 192;  // along travel: 64 px per grouser
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // ground scuffed up between the bars
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(3, 0, w - 6, h);
  for (let i = 0; i < 1100; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
    ctx.fillRect(3 + Math.random() * (w - 6), Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // the grousers: one band per link, across the full width of the track
  const pitch = h / BARS;
  for (let i = 0; i < BARS; i++) {
    const y = i * pitch;
    const barH = pitch * 0.42; // the raised ridge is about this much of a link
    const g = ctx.createLinearGradient(0, y, 0, y + barH);
    g.addColorStop(0, 'rgba(0,0,0,0.34)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.66)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(4, y, w - 8, barH);

    // the fine detail: each link's cleats, running across the track with the
    // bar rather than along it
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let k = 0; k < 7; k++) {
      const x = 6 + k * ((w - 12) / 6.4);
      ctx.fillRect(x, y - pitch * 0.04, 1.5, barH + pitch * 0.08);
    }
    // worn ends of the bar, so no two imprints read identically
    ctx.clearRect(4, y + Math.random() * barH * 0.6, 3 + Math.random() * 5, 2);
    ctx.clearRect(w - 8, y + Math.random() * barH * 0.6, 3 + Math.random() * 5, 2);
  }

  // darker down the centre line, where the road wheels press hardest
  const centre = ctx.createLinearGradient(0, 0, w, 0);
  centre.addColorStop(0, 'rgba(0,0,0,0)');
  centre.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  centre.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = centre;
  ctx.fillRect(0, 0, w, h);

  // soften the outer edges of the track (the u extremes)
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.10, 'rgba(0,0,0,0)');
  edge.addColorStop(0.90, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping; // across: one track, no repeat
  tex.wrapT = THREE.RepeatWrapping;      // along travel: tiles link to link
  tex.anisotropy = 8;
  return tex;
}

const VERT = `
attribute float aAge;
varying vec2 vUv;
varying float vAge;
void main() {
  vUv = uv;
  vAge = aAge;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform sampler2D uMap;
uniform float uHold;
uniform float uFade;
varying vec2 vUv;
varying float vAge;
void main() {
  if (vAge < 0.0) discard;
  float k = 1.0 - clamp((vAge - uHold) / uFade, 0.0, 1.0);
  if (k <= 0.001) discard;
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(0.04, 0.035, 0.03, t.a * k * 0.85);
}
`;

export function createTreadMarks(scene) {
  const tex = makeTreadTexture();
  // lie flat with the quad's LENGTH along local X — the same axis a heading
  // rotation maps forward onto — and its width across local Z
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 2);

  const ages = new Float32Array(MAX).fill(-1);
  geo.setAttribute('aAge', new THREE.InstancedBufferAttribute(ages, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMap: { value: tex },
      uHold: { value: HOLD },
      uFade: { value: FADE },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  let next = 0;
  const emitters = new Map(); // per tank, per side: distance since last mark

  const _m = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);

  function stamp(x, y, z, heading, width, length) {
    const i = next % MAX;
    next++;
    _pos.set(x, y, z);
    _quat.setFromAxisAngle(_yAxis, heading);
    _scale.set(length, 1, width);
    _m.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(i, _m);
    ages[i] = 0;
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
  }

  // Lay marks under both tracks of a tank that's actually on the ground.
  // key identifies the tank so each one keeps its own spacing counter.
  // Lay marks at exact intervals along the ground actually covered, rather
  // than one per frame once enough distance has piled up. Stamping at the
  // tank's current position meant the gap between stamps was the span PLUS
  // however far the last frame moved — which is what broke the trail into
  // dashes. Walking the path also means the spacing no longer depends on
  // framerate at all.
  function trail(key, model, groundY, heading, moved, onGround) {
    const tread = model.hull.tread;
    // one stamp covers exactly BARS links, so the printed grousers land at
    // the tread's own pitch and consecutive stamps butt up
    const span = (tread.length / tread.linkCount) * BARS;
    const width = tread.linkW;
    const px = model.root.position.x;
    const pz = model.root.position.z;

    let e = emitters.get(key);
    if (!e) {
      e = { x: px, z: pz, y: groundY, started: false };
      emitters.set(key, e);
    }
    if (!onGround || moved <= 0) {
      // keep the anchor with the tank so lifting off doesn't draw a streak
      e.x = px;
      e.z = pz;
      e.y = groundY;
      return;
    }

    let dx = px - e.x;
    let dz = pz - e.z;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-6) return;

    // a big jump means a respawn or a teleport: reset rather than paint a line
    if (dist > span * 12) {
      e.x = px;
      e.z = pz;
      e.y = groundY;
      return;
    }
    if (dist < span) return;

    const ux = dx / dist;
    const uz = dz / dist;
    const rx = Math.sin(heading);
    const rz = Math.cos(heading);

    let walked = 0;
    while (dist - walked >= span) {
      walked += span;
      const cx = e.x + ux * walked;
      const cz = e.z + uz * walked;
      const cy = e.y + (groundY - e.y) * (walked / dist);
      for (const side of [-1, 1]) {
        const oz = side * tread.z;
        stamp(
          cx + rx * oz,
          cy + 0.015,
          cz + rz * oz,
          heading,
          width,
          span * 1.06 // slight overlap, so there is never a seam
        );
      }
    }
    // carry the leftover so the next stamp lands exactly one span on
    e.x += ux * walked;
    e.z += uz * walked;
    e.y += (groundY - e.y) * (walked / dist);
  }

  function forget(key) {
    emitters.delete(key);
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      if (ages[i] < 0) continue;
      ages[i] += dt;
      if (ages[i] > HOLD + FADE) ages[i] = -1;
      dirty = true;
    }
    if (dirty) geo.attributes.aAge.needsUpdate = true;
  }

  function clear() {
    ages.fill(-1);
    emitters.clear();
    geo.attributes.aAge.needsUpdate = true;
  }

  return { trail, update, clear, forget, mesh };
}
