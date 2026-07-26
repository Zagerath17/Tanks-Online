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
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // a ragged sooty core with spatter round it
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(10,9,8,0.92)');
  g.addColorStop(0.42, 'rgba(16,14,12,0.6)');
  g.addColorStop(0.78, 'rgba(20,18,15,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (0.2 + Math.random() * 0.42) * size / 2;
    const rad = 1 + Math.random() * 4;
    ctx.fillStyle = `rgba(12,11,10,${0.15 + Math.random() * 0.45})`;
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, rad, 0, 6.3);
    ctx.fill();
  }
  // a few streaks flung outward
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = size * 0.16;
    const r1 = r0 + Math.random() * size * 0.3;
    ctx.strokeStyle = `rgba(14,12,10,${0.1 + Math.random() * 0.3})`;
    ctx.lineWidth = 0.8 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(size / 2 + Math.cos(a) * r0, size / 2 + Math.sin(a) * r0);
    ctx.lineTo(size / 2 + Math.cos(a) * r1, size / 2 + Math.sin(a) * r1);
    ctx.stroke();
  }

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
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
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

  const SIZE = { shell: 1.5, rail: 1.1, plasma: 0.7, pellet: 0.34, bolt: 1.7 };

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

    const s = (SIZE[kind] || 1) * (0.82 + Math.random() * 0.36);
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
