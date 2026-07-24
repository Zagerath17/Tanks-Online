import * as THREE from 'three';

// The Arctic Snap stream. Volume comes from three nested cone shells running
// animated fbm noise at different scales and drift speeds (parallax between
// the layers reads as depth), plus a cloud of ice motes tumbling outward
// through the same cone. Everything lives in the muzzle's local space, so it
// follows the barrel for free.

export const CRYO = {
  range: 7.5, // about a tank and a half
  r0: 0.16,
  r1: 1.55,
};

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
uniform float uScale;
uniform float uSpeed;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec2 vUv;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  float t = vUv.y;                    // 0 at the nozzle, 1 at the tip
  float ang = vUv.x * 6.2831853;

  // sample on a cylinder so the noise never seams at the uv wrap
  vec3 p = vec3(cos(ang) * uScale, sin(ang) * uScale, t * uScale * 1.7);
  p.z -= uTime * uSpeed;
  p.x += sin(uTime * 0.7 + uSeed) * 0.25;
  float n = fbm(p + uSeed);

  // billow: the plume opens up and frays as it travels
  float mouth = smoothstep(0.0, 0.10, t);
  float tail = 1.0 - smoothstep(0.45, 1.0, t);
  float wisp = smoothstep(0.30, 0.78, n + t * 0.22);

  float a = uIntensity * mouth * tail * wisp;
  vec3 col = mix(uEdge, uCore, pow(n, 1.6) * (1.0 - t * 0.35));
  gl_FragColor = vec4(col, a);
}
`;

const MOTE_VERT = `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (260.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.0, r) * vAlpha;
  if (a <= 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

// Cone shell whose UVs run (angle, distance) — built along +X, apex at origin
function coneShell(range, r0, r1, rings = 22, seg = 26, curve = 1.35) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const x = t * range;
    const r = r0 + (r1 - r0) * Math.pow(t, curve);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(x, Math.cos(a) * r, Math.sin(a) * r);
      uv.push(j / seg, t);
    }
  }
  const stride = seg + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * stride + j;
      idx.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

export function createCryoBeam() {
  const group = new THREE.Group();
  group.visible = false;

  const LAYERS = [
    { scale: 1.5, speed: 2.2, seed: 0.0, rs: 1.00, core: 0xf2fbff, edge: 0x63a9f0, op: 0.42 },
    { scale: 2.6, speed: 3.1, seed: 11.3, rs: 0.78, core: 0xffffff, edge: 0x8fd4ff, op: 0.34 },
    { scale: 4.4, speed: 4.3, seed: 23.7, rs: 1.18, core: 0xdff2ff, edge: 0x3f7fd0, op: 0.22 },
  ];

  const mats = [];
  for (const L of LAYERS) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: Math.random() * 30 },
        uIntensity: { value: L.op },
        uSeed: { value: L.seed },
        uScale: { value: L.scale },
        uSpeed: { value: L.speed },
        uCore: { value: new THREE.Color(L.core) },
        uEdge: { value: new THREE.Color(L.edge) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    mat.userData.baseOpacity = L.op;
    const mesh = new THREE.Mesh(
      coneShell(CRYO.range, CRYO.r0 * L.rs, CRYO.r1 * L.rs),
      mat
    );
    mesh.frustumCulled = false;
    group.add(mesh);
    mats.push(mat);
  }

  // ---- ice motes -----------------------------------------------------------
  const COUNT = 260;
  const mPos = new Float32Array(COUNT * 3);
  const mSize = new Float32Array(COUNT);
  const mAlpha = new Float32Array(COUNT);
  const life = new Float32Array(COUNT);
  const maxLife = new Float32Array(COUNT);
  const vel = new Float32Array(COUNT * 3);
  const spin = new Float32Array(COUNT);
  const radius = new Float32Array(COUNT);

  function seed(i, stagger) {
    const speed = 9 + Math.random() * 8;
    const ml = (CRYO.range / speed) * (0.7 + Math.random() * 0.5);
    maxLife[i] = ml;
    life[i] = stagger ? Math.random() * ml : ml;
    const a = Math.random() * Math.PI * 2;
    radius[i] = CRYO.r0 * (0.2 + Math.random() * 0.8);
    spin[i] = a;
    vel[i * 3] = speed;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 1.2;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    mSize[i] = 0.7 + Math.random() * 2.1;
    const x = 0.05;
    mPos[i * 3] = x;
    mPos[i * 3 + 1] = Math.cos(a) * radius[i];
    mPos[i * 3 + 2] = Math.sin(a) * radius[i];
    mAlpha[i] = 0;
  }
  for (let i = 0; i < COUNT; i++) seed(i, true);

  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  moteGeo.setAttribute('aSize', new THREE.BufferAttribute(mSize, 1));
  moteGeo.setAttribute('aAlpha', new THREE.BufferAttribute(mAlpha, 1));
  const moteMat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    uniforms: { uColor: { value: new THREE.Color(0xeaf7ff) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  group.add(motes);

  let intensity = 0; // eased 0..1 so the stream spools up and trails off

  function update(dt, on) {
    const target = on ? 1 : 0;
    intensity += (target - intensity) * Math.min(1, (on ? 9 : 5) * dt);
    if (intensity < 0.01) {
      intensity = 0;
      group.visible = false;
      return;
    }
    group.visible = true;

    for (let i = 0; i < mats.length; i++) {
      mats[i].uniforms.uTime.value += dt;
      mats[i].uniforms.uIntensity.value = mats[i].userData.baseOpacity * intensity;
    }
    for (let i = 0; i < COUNT; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        if (intensity > 0.15) seed(i, false);
        else { mAlpha[i] = 0; continue; }
      }
      const i3 = i * 3;
      // swirl outward: radius grows with distance, angle winds slowly
      spin[i] += dt * 1.8;
      const t = 1 - life[i] / maxLife[i];
      const spread = CRYO.r0 + (CRYO.r1 - CRYO.r0) * Math.pow(t, 1.3);
      mPos[i3] += vel[i3] * dt;
      const rr = spread * (0.25 + 0.75 * (radius[i] / Math.max(0.001, CRYO.r0)));
      mPos[i3 + 1] = Math.cos(spin[i]) * rr + vel[i3 + 1] * t;
      mPos[i3 + 2] = Math.sin(spin[i]) * rr + vel[i3 + 2] * t;
      // fade in fast at the nozzle, out toward the tip
      const fadeIn = Math.min(1, t / 0.12);
      const fadeOut = 1 - Math.max(0, (t - 0.55) / 0.45);
      mAlpha[i] = intensity * fadeIn * fadeOut * 0.9;
      if (mPos[i3] > CRYO.range) mAlpha[i] = 0;
    }
    moteGeo.attributes.position.needsUpdate = true;
    moteGeo.attributes.aAlpha.needsUpdate = true;
  }

  function dispose() {
    for (const m of group.children) {
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    }
  }

  return { group, update, dispose };
}
