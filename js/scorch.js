import * as THREE from 'three';

// Burn marks left where a shot lands on anything solid. They sit flat against
// whatever they hit — wall, slope or floor — and fade out after ten seconds.
//
// Built the same dull way the tread marks are: one InstancedMesh, one plain
// material, per-instance age in an attribute. There is nothing clever here on
// purpose.
const MAX = 220;
const HOLD = 7;   // seconds at full strength
const FADE = 3;   // ...then gone by ten

function makeScorchTexture() {
  // 256, not 128: at the old size a mark stretched over a wall was visibly
  // soft. And it is drawn as a struck surface rather than an airbrushed blob —
  // a torn crater, a scorched rim, grit thrown clear of it, and fine radial
  // streaking where the blast washed outward.
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const mid = size / 2;

  // radial streaking first, so everything else sits on top of it
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = size * (0.07 + Math.random() * 0.06);
    const r1 = r0 + size * (0.04 + Math.random() * 0.28);
    ctx.strokeStyle = `rgba(16,14,12,${0.05 + Math.random() * 0.22})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0);
    ctx.lineTo(mid + Math.cos(a) * r1, mid + Math.sin(a) * r1);
    ctx.stroke();
  }

  // the crater: a torn polygon, not a circle, so no two marks look stamped
  const pts = 22;
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = size * (0.108 + Math.random() * 0.055);
    const x = mid + Math.cos(a) * r;
    const y = mid + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const core = ctx.createRadialGradient(mid, mid, 0, mid, mid, size * 0.17);
  core.addColorStop(0, 'rgba(6,5,5,0.96)');
  core.addColorStop(0.55, 'rgba(13,11,10,0.88)');
  core.addColorStop(1, 'rgba(18,16,14,0.55)');
  ctx.fillStyle = core;
  ctx.fill();

  // scorched rim just outside the crater, lighter than the core
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = 'rgba(38,32,27,0.4)';
  ctx.stroke();

  // grit and spatter thrown clear
  for (let i = 0; i < 170; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = size * (0.13 + Math.pow(Math.random(), 1.7) * 0.34);
    const rad = 0.6 + Math.random() * 2.4;
    ctx.fillStyle = `rgba(14,12,11,${0.12 + Math.random() * 0.5})`;
    ctx.beginPath();
    ctx.arc(mid + Math.cos(a) * r, mid + Math.sin(a) * r, rad, 0, 6.3);
    ctx.fill();
  }

  // a faint dust halo, kept tight so the mark has a definite edge
  const halo = ctx.createRadialGradient(mid, mid, size * 0.15, mid, mid, size * 0.47);
  halo.addColorStop(0, 'rgba(22,19,17,0.20)');
  halo.addColorStop(0.6, 'rgba(22,19,17,0.07)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
  gl_FragColor = vec4(t.rgb, t.a * k * 0.85);
}
`;

export function createScorchMarks(scene) {
  const tex = makeScorchTexture();

  // a quad facing +Z, so it can be aimed straight down a surface normal
  const geo = new THREE.PlaneGeometry(1, 1);
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
    side: THREE.DoubleSide,
    // A modest, constant bias. Large polygon offsets are scaled by the
    // polygon's depth slope, so on a steeply angled surface a big factor
    // pushes the mark far enough toward the camera to win the depth test
    // against walls in front of it — which is exactly how decals end up
    // visible through solid objects.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.count = 0;
  scene.add(mesh);

  let next = 0;
  const _pos = new THREE.Vector3();
  const _nrm = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _up = new THREE.Vector3(0, 0, 1);

  // These were roughly double this and read as great soft smudges. A shell
  // crater on a wall is a hand's span of soot, not a metre of it.
  const SIZE = { shell: 0.72, rail: 0.55, plasma: 0.34, pellet: 0.18, bolt: 0.8 };

  // hit: { x, y, z, nx, ny, nz } — a point and the surface normal there
  function add(hit, kind = 'shell') {
    if (!hit) return;
    const i = next % MAX;
    next++;
    if (next > mesh.count) mesh.count = Math.min(next, MAX);

    // `|| 1` on the Y component fired whenever a normal legitimately had
    // ny === 0 — which is every vertical wall in the game — and tilted the
    // mark 45 degrees off the surface it was supposed to be lying on.
    _nrm.set(
      hit.nx === undefined ? 0 : hit.nx,
      hit.ny === undefined ? 1 : hit.ny,
      hit.nz === undefined ? 0 : hit.nz
    );
    if (_nrm.lengthSq() < 1e-6) _nrm.set(0, 1, 0);
    _nrm.normalize();
    // lift it a hair off the surface so it never fights the wall for depth
    _pos.set(hit.x, hit.y, hit.z).addScaledVector(_nrm, 0.02);
    _quat.setFromUnitVectors(_up, _nrm);
    // a random roll about the normal, so repeats do not read as stamps
    _quat.multiply(new THREE.Quaternion().setFromAxisAngle(_up, Math.random() * Math.PI * 2));

    const s = (SIZE[kind] || 0.6) * (0.86 + Math.random() * 0.28);
    _scale.set(s, s, 1);
    _m.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(i, _m);
    ages[i] = 0;
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < mesh.count; i++) {
      if (ages[i] < 0) continue;
      ages[i] += dt;
      if (ages[i] > HOLD + FADE) ages[i] = -1;
      dirty = true;
    }
    if (dirty) geo.attributes.aAge.needsUpdate = true;
  }

  function clear() {
    ages.fill(-1);
    next = 0;
    mesh.count = 0;
    geo.attributes.aAge.needsUpdate = true;
  }

  return { add, update, clear, mesh };
}
