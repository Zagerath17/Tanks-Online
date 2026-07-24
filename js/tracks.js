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

// One track imprint, three grousers long. The canvas u axis runs ALONG the
// direction of travel, so the bars sit across the track exactly the way the
// real links do, and BARS here is matched to the stamp length so the bar
// pitch equals the tread's own link pitch.
const BARS = 3;

function makeTreadTexture() {
  const w = 192; // 64 px per grouser
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // ground scuffed up between the bars
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(0, 3, w, h - 6);
  for (let i = 0; i < 1100; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * w, 3 + Math.random() * (h - 6), 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // the grousers: one bar per link, spanning the full width of the track
  const pitch = w / BARS;
  for (let i = 0; i < BARS; i++) {
    const x = i * pitch;
    const barW = pitch * 0.42; // the raised ridge is about this much of a link
    const g = ctx.createLinearGradient(x, 0, x + barW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.34)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.66)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 4, barW, h - 8);

    // the fine detail lines: each link's cleats, running across the bar
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let k = 0; k < 7; k++) {
      const y = 6 + k * ((h - 12) / 6.4);
      ctx.fillRect(x - pitch * 0.05, y, barW + pitch * 0.10, 1.5);
    }
    // worn ends, so no two imprints read identically
    ctx.clearRect(x + Math.random() * barW * 0.6, 4, 2, 3 + Math.random() * 5);
    ctx.clearRect(x + Math.random() * barW * 0.6, h - 8, 2, 3 + Math.random() * 5);
  }

  // darker down the centre where the road wheels press hardest
  const centre = ctx.createLinearGradient(0, 0, 0, h);
  centre.addColorStop(0, 'rgba(0,0,0,0)');
  centre.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  centre.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = centre;
  ctx.fillRect(0, 0, w, h);

  // soften the outer edges of the track
  const edge = ctx.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.10, 'rgba(0,0,0,0)');
  edge.addColorStop(0.90, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
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
  function trail(key, model, groundY, heading, moved, onGround) {
    if (!onGround || moved <= 0) return;
    const tread = model.hull.tread;
    // One stamp covers exactly BARS links, so consecutive stamps butt up and
    // the printed grousers land at the tread's own pitch.
    const linkPitch = tread.length / tread.linkCount;
    const span = linkPitch * BARS;

    let e = emitters.get(key);
    if (!e) {
      e = { d: 0 };
      emitters.set(key, e);
    }
    e.d += moved;
    if (e.d < span) return;
    e.d = 0;

    const width = tread.linkW;
    // right vector for this heading, to sit each mark under its own track
    const rx = Math.sin(heading);
    const rz = Math.cos(heading);
    for (const side of [-1, 1]) {
      const oz = side * tread.z;
      stamp(
        model.root.position.x + rx * oz,
        groundY + 0.015,
        model.root.position.z + rz * oz,
        heading,
        width,
        span * 1.02 // a hair of overlap so there is no seam between stamps
      );
    }
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
