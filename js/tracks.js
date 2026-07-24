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
const SPACING = 0.55; // metres of travel between segments, per track

// A realistic track imprint: transverse grouser bars with worn, uneven ends,
// soil scuffed up between them, and a darker core where the weight sits.
function makeTreadTexture() {
  const w = 64;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  ctx.clearRect(0, 0, w, h);

  // scuffed ground between the bars
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(4, 0, w - 8, h);
  for (let i = 0; i < 900; i++) {
    const x = 3 + Math.random() * (w - 6);
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.07})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // the grouser bars themselves — 8 across the tile, tiling seamlessly
  const bars = 8;
  const pitch = h / bars;
  for (let i = 0; i < bars; i++) {
    const y = i * pitch;
    const barH = pitch * 0.42;
    const inset = 5 + Math.random() * 3;
    const g = ctx.createLinearGradient(0, y, 0, y + barH);
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.62)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(inset, y, w - inset * 2, barH);
    // chipped ends, so no two bars read identically
    ctx.clearRect(inset, y + barH * (0.1 + Math.random() * 0.5), 1 + Math.random() * 2, barH * 0.3);
    ctx.clearRect(w - inset - 2, y + barH * (0.1 + Math.random() * 0.5), 1 + Math.random() * 2, barH * 0.3);
  }

  // darker down the centre line where the road wheels ride
  const centre = ctx.createLinearGradient(0, 0, w, 0);
  centre.addColorStop(0, 'rgba(0,0,0,0)');
  centre.addColorStop(0.5, 'rgba(0,0,0,0.20)');
  centre.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = centre;
  ctx.fillRect(0, 0, w, h);

  // soften the outer edges so a track doesn't end in a hard line
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.12, 'rgba(0,0,0,0)');
  edge.addColorStop(0.88, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // lie flat, length along local Z

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
    _scale.set(width, 1, length);
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
    let e = emitters.get(key);
    if (!e) {
      e = { d: 0 };
      emitters.set(key, e);
    }
    e.d += moved;
    if (e.d < SPACING) return;
    e.d = 0;

    const tread = model.hull.tread;
    const width = tread.linkW + tread.grouserH;
    // heading + PI/2 puts the quad's length along the direction of travel
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    for (const side of [-1, 1]) {
      const oz = side * tread.z;
      stamp(
        // offset sideways from the hull centre, in world space
        model.root.position.x + s * oz,
        groundY + 0.015,
        model.root.position.z + c * oz,
        heading,
        width,
        SPACING * 1.35 // slight overlap so a trail reads continuous
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
