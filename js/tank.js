import * as THREE from 'three';
import { makeGridTexture, makeHubTexture } from './grid-texture.js';
import { createCryoBeam } from './cryo.js';

// ---------------------------------------------------------------------------
// Movement tuning (used by the player controller)
// ---------------------------------------------------------------------------
export const SPEC = {
  accel: 13,
  brakeAccel: 22,
  drag: 5.5,
  maxForward: 9.5,
  maxReverse: 5.0,
  turnRate: 1.8,
  turnResponse: 8,
  halfTrack: 1.18,
};

// Skins are palettes plus a grid pattern — swappable on a built model.
export const SKINS = [
  {
    id: 'olive', name: 'Olive Drab',
    hull: ['#4d6039', '#41522f'], turret: ['#57683c', '#4a5a32'], barrel: ['#3f4d2e', '#35422a'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'desert', name: 'Desert Tan',
    hull: ['#9a8459', '#87734b'], turret: ['#a68e60', '#917b51'], barrel: ['#7f6c46', '#6d5c3b'],
    pattern: { cells: 4, lineWidth: 2 },
  },
  {
    id: 'urban', name: 'Urban Grey',
    hull: ['#6b7178', '#5b6066'], turret: ['#767d85', '#646a71'], barrel: ['#565b61', '#494d52'],
    pattern: { cells: 10, lineWidth: 2 },
  },
  {
    id: 'arctic', name: 'Arctic',
    hull: ['#c3cdd4', '#a8b3bc'], turret: ['#ced8de', '#b2bdc6'], barrel: ['#9aa5ad', '#848e96'],
    pattern: { cells: 6, lineWidth: 4 },
  },
  {
    id: 'forest', name: 'Deep Forest',
    hull: ['#2f4232', '#26352a'], turret: ['#374b3a', '#2c3d2f'], barrel: ['#243328', '#1d2a21'],
    pattern: { cells: 3, lineWidth: 5 },
  },
  {
    id: 'crimson', name: 'Crimson',
    hull: ['#6e3a33', '#5c2f29'], turret: ['#7c453a', '#683a30'], barrel: ['#5c332c', '#4d2b24'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'midnight', name: 'Midnight',
    hull: ['#2a3140', '#222836'], turret: ['#313949', '#28303d'], barrel: ['#1f2531', '#191e28'],
    pattern: { cells: 8, lineWidth: 3 },
  },
  {
    id: 'rust', name: 'Rust',
    hull: ['#7d5133', '#6a442b'], turret: ['#8a5a39', '#754b30'], barrel: ['#63402a', '#523522'],
    pattern: { cells: 5, lineWidth: 5, major: 4 },
  },
];

export const PALETTE = { green: SKINS[0] };

// Per-turret behaviour. 'projectile' fires shells on a cooldown; 'stream'
// pours a continuous jet that burns fuel and has to recharge.
export const TURRET_SPECS = {
  cannon: { mode: 'projectile', fireInterval: 2.5, damage: 200 },
  arctic: {
    mode: 'stream',
    range: 7.5,      // about a tank and a half
    coneR: 2.2,      // spray half-width at maximum range
    dps: 50,
    fuelDrain: 10,   // 10 s of continuous stream from full
    fuelRecharge: 5.6, // refills in ~18 s, starting the instant you let go
    restartAt: 8,    // must build this much back before it'll fire again
    chillRise: 1 / 3, // 3 s of stream to reach the full 50% slow
    chillFall: 1 / 3, // thaws at the same rate...
    thawDelay: 2,     // ...after a couple of seconds off the beam
    maxSlow: 0.5,
  },
};

// ---------------------------------------------------------------------------
// Tread loop layout (side profile; local +X = forward, +Y = up).
// Rounded-rectangle loop: two straight runs joined by semicircles. Every
// wheel radius is derived from the loop so rims, links, and teeth line up.
// ---------------------------------------------------------------------------
export const TREAD = {
  runHalf: 1.7,
  arcR: 0.375,
  centerY: 0.455,
  linkCount: 34,
  linkLen: 0.25,
  linkW: 0.56,
  linkHalfT: 0.035,
  grouserH: 0.05,
  z: 1.18,
};
TREAD.bottomY = TREAD.centerY - TREAD.arcR;
TREAD.topY = TREAD.centerY + TREAD.arcR;
TREAD.runLen = TREAD.runHalf * 2;
TREAD.arcLen = Math.PI * TREAD.arcR;
TREAD.length = 2 * TREAD.runLen + 2 * TREAD.arcLen;

// Overall body bounds derived from the geometry below — used for accurate
// hit detection (hull/tread box in root space, turret box in turret space)
export const HIT = {
  bodyX: 2.5,
  bodyZ: TREAD.z + TREAD.linkW / 2 + TREAD.grouserH + 0.02,
  bodyY0: 0.02,
  bodyY1: 1.19,
  turretX0: -0.9,
  turretX1: 1.1,
  turretZ: 0.62,
  turretY0: 0.0,
  turretY1: 0.8,
};

// Position + tangent angle at distance t along the loop. Param increases in
// the direction the tread circulates when driving forward: bottom run moves
// toward -X (gripping the ground), top run toward +X.
const _pp = { x: 0, y: 0, a: 0 };
function pathPoint(t) {
  const { runHalf, runLen, arcR, arcLen, centerY, bottomY, topY, length } = TREAD;
  t = ((t % length) + length) % length;

  if (t < runLen) {
    _pp.x = runHalf - t;
    _pp.y = bottomY;
    _pp.a = Math.PI;
    return _pp;
  }
  t -= runLen;

  if (t < arcLen) {
    const th = -Math.PI / 2 - (t / arcLen) * Math.PI;
    _pp.x = -runHalf + arcR * Math.cos(th);
    _pp.y = centerY + arcR * Math.sin(th);
    _pp.a = th - Math.PI / 2;
    return _pp;
  }
  t -= arcLen;

  if (t < runLen) {
    _pp.x = -runHalf + t;
    _pp.y = topY;
    _pp.a = 0;
    return _pp;
  }
  t -= runLen;

  const th = Math.PI / 2 - (t / arcLen) * Math.PI;
  _pp.x = runHalf + arcR * Math.cos(th);
  _pp.y = centerY + arcR * Math.sin(th);
  _pp.a = th - Math.PI / 2;
  return _pp;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function buildMaterials(p) {
  const pat = p.pattern || {};
  const cells = pat.cells || 6;
  const lw = pat.lineWidth || 3;
  const major = pat.major;
  const hullTex = makeGridTexture({
    cells, base: p.hull[0], line: p.hull[1], lineWidth: lw, major,
    majorLine: p.hull[1], majorWidth: lw + 2, repeat: [0.5, 0.5],
  });
  const turretTex = makeGridTexture({
    cells, base: p.turret[0], line: p.turret[1], lineWidth: lw, major,
    majorLine: p.turret[1], majorWidth: lw + 2, repeat: [0.7, 0.7],
  });
  const barrelTex = makeGridTexture({
    cells: Math.max(2, Math.round(cells * 0.7)),
    base: p.barrel[0], line: p.barrel[1], lineWidth: lw, repeat: [2, 1],
  });
  // Tracks read as rubber: near-black, subtle grid, glossy clearcoat sheen
  const trackTex = makeGridTexture({
    cells: 4, base: '#1d1f24', line: '#282b31', lineWidth: 3, repeat: [4, 4],
  });
  const tyreTex = makeGridTexture({
    cells: 6, base: '#1a1c20', line: '#25282e', lineWidth: 2, repeat: [6, 1],
  });
  const hubTex = makeHubTexture();

  return {
    hull: new THREE.MeshStandardMaterial({ map: hullTex, roughness: 0.8, metalness: 0.15 }),
    turret: new THREE.MeshStandardMaterial({ map: turretTex, roughness: 0.75, metalness: 0.15 }),
    barrel: new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.6, metalness: 0.3 }),
    track: new THREE.MeshPhysicalMaterial({
      map: trackTex, roughness: 0.55, metalness: 0.0,
      clearcoat: 0.7, clearcoatRoughness: 0.32,
    }),
    tyre: new THREE.MeshPhysicalMaterial({
      map: tyreTex, roughness: 0.6, metalness: 0.0,
      clearcoat: 0.6, clearcoatRoughness: 0.35,
    }),
    hub: new THREE.MeshStandardMaterial({ map: hubTex, roughness: 0.65, metalness: 0.35 }),
    metal: new THREE.MeshStandardMaterial({ color: '#2c3138', roughness: 0.55, metalness: 0.6 }),
    // cryo hardware keeps its own colour across every skin
    cryo: new THREE.MeshStandardMaterial({
      color: '#bfe6ff', emissive: '#4aa3e0', emissiveIntensity: 0.85,
      roughness: 0.35, metalness: 0.2,
    }),
  };
}

// Remember each material's untinted colours so the freeze overlay can lerp
// toward ice and back without drift.
function rememberBaseColors(M) {
  for (const mat of Object.values(M)) {
    mat.userData.baseColor = mat.color.clone();
    if (mat.emissive) mat.userData.baseEmissive = mat.emissive.clone();
  }
  return M;
}

// ---------------------------------------------------------------------------
// Hull — just the base armored body
// ---------------------------------------------------------------------------
function buildHull(M) {
  const s = new THREE.Shape();
  s.moveTo(-2.25, 0.4);
  s.lineTo(2.2, 0.4);
  s.lineTo(2.45, 0.62); // nose tip
  s.lineTo(1.05, 1.16); // top of glacis
  s.lineTo(-1.6, 1.16); // deck
  s.lineTo(-2.35, 1.02); // rear deck slope
  s.lineTo(-2.45, 0.78); // rear plate
  s.closePath();

  // depth 1.70 (+0.03 bevel) keeps the hull sides clear of the tread
  // chains, whose inner faces sit at |z| = 0.90
  const hullGeo = new THREE.ExtrudeGeometry(s, {
    depth: 1.70,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 1,
  });
  hullGeo.translate(0, 0, -0.85);
  return new THREE.Mesh(hullGeo, M.hull);
}

// ---------------------------------------------------------------------------
// Turret — base shape plus a pitching gun assembly
// ---------------------------------------------------------------------------
function buildCannonTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 1.1), M.turret);
  lower.position.set(0.05, 0.33, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.24, 0.85), M.turret);
  upper.position.set(-0.02, 0.64, 0);
  t.add(lower, upper);

  const cheekGeo = new THREE.BoxGeometry(0.65, 0.42, 0.26);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, M.turret);
    cheek.position.set(0.62, 0.33, side * 0.48);
    cheek.rotation.y = -side * 0.5;
    t.add(cheek);
  }

  // Pitch pivot at the mantlet; everything forward of it elevates together.
  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.92, 0.4, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.6), M.turret);
  pitchGroup.add(mantlet);

  // Gun group slides backward for recoil
  const gun = new THREE.Group();
  pitchGroup.add(gun);

  const sleeveGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.75, 16);
  sleeveGeo.rotateZ(Math.PI / 2);
  const sleeve = new THREE.Mesh(sleeveGeo, M.barrel);
  sleeve.position.set(0.53, 0.02, 0);
  gun.add(sleeve);

  const barrelGeo = new THREE.CylinderGeometry(0.09, 0.085, 1.9, 16);
  barrelGeo.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, M.barrel);
  barrel.position.set(1.83, 0.02, 0);
  gun.add(barrel);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(2.86, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle };
}

// ---------------------------------------------------------------------------
// Arctic Snap: a cryo projector built in the same faceted language as the
// hull — a low wedge housing, a recessed coolant spine, and a heavy octagonal
// shroud venting frost just behind a tapered emitter.
// ---------------------------------------------------------------------------
function buildArcticTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  // faceted housing: extruded side profile, like the hull
  const profile = new THREE.Shape();
  profile.moveTo(-0.78, 0.0);
  profile.lineTo(0.70, 0.0);
  profile.lineTo(0.88, 0.17);
  profile.lineTo(0.60, 0.50);
  profile.lineTo(-0.44, 0.62);
  profile.lineTo(-0.82, 0.44);
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 1.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -0.56);
  const body = new THREE.Mesh(bodyGeo, M.turret);
  body.position.y = 0.08;
  t.add(body);

  // recessed coolant spine down the centre line, flanked by two thin runs
  const spine = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.11, 0.32), M.metal);
  spine.position.set(-0.14, 0.66, 0);
  t.add(spine);
  const runGeo = new THREE.BoxGeometry(0.88, 0.05, 0.055);
  for (const side of [-1, 1]) {
    const run = new THREE.Mesh(runGeo, M.cryo);
    run.position.set(-0.14, 0.705, side * 0.1);
    t.add(run);
  }

  // shoulder plates tying the housing into the shroud
  const plateGeo = new THREE.BoxGeometry(0.42, 0.3, 0.1);
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(plateGeo, M.turret);
    plate.position.set(0.6, 0.3, side * 0.42);
    plate.rotation.z = 0.12;
    t.add(plate);
  }

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.8, 0.34, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.46, 0.68), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  // octagonal shroud
  const shroudGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.12, 8);
  shroudGeo.rotateZ(Math.PI / 2);
  const shroud = new THREE.Mesh(shroudGeo, M.barrel);
  shroud.position.set(0.62, 0.02, 0);
  gun.add(shroud);

  // frost vents cut along the top and sides near the tip
  const ventGeo = new THREE.BoxGeometry(0.34, 0.035, 0.075);
  for (const [x, ang] of [[0.72, 0], [0.95, 0], [0.72, 2.09], [0.95, 2.09], [0.72, -2.09], [0.95, -2.09]]) {
    const vent = new THREE.Mesh(ventGeo, M.cryo);
    vent.position.set(x, 0.02 + Math.cos(ang) * 0.2, Math.sin(ang) * 0.2);
    vent.rotation.x = ang;
    gun.add(vent);
  }

  // muzzle collar + tapered emitter (narrows to the tip, no funnel)
  const collarGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.1, 8);
  collarGeo.rotateZ(Math.PI / 2);
  const ring = new THREE.Mesh(collarGeo, M.metal);
  ring.position.set(1.2, 0.02, 0);
  gun.add(ring);

  const emitterGeo = new THREE.CylinderGeometry(0.175, 0.105, 0.4, 8);
  emitterGeo.rotateZ(Math.PI / 2);
  const emitter = new THREE.Mesh(emitterGeo, M.barrel);
  emitter.position.set(1.44, 0.02, 0);
  gun.add(emitter);

  // feed pipe slung under the shroud
  const pipeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.8, 10);
  pipeGeo.rotateZ(Math.PI / 2);
  const pipe = new THREE.Mesh(pipeGeo, M.metal);
  pipe.position.set(0.55, -0.16, 0);
  gun.add(pipe);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.66, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle };
}

function buildTurret(M, kind) {
  return kind === 'arctic' ? buildArcticTurret(M) : buildCannonTurret(M);
}

// ---------------------------------------------------------------------------
// Treads: running gear + instanced link chain
// ---------------------------------------------------------------------------
function buildLinkGeometry() {
  const L = TREAD.linkLen / 2;
  const T = TREAD.linkHalfT;
  const G = TREAD.grouserH;

  const s = new THREE.Shape();
  s.moveTo(-L, -T);
  s.lineTo(L, -T);
  s.lineTo(L, T);
  s.lineTo(0.06, T);
  s.lineTo(0.045, T + G);
  s.lineTo(-0.045, T + G);
  s.lineTo(-0.06, T);
  s.lineTo(-L, T);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, { depth: TREAD.linkW, bevelEnabled: false });
  geo.translate(0, 0, -TREAD.linkW / 2);
  return geo;
}

function buildTread(M, side) {
  const g = new THREE.Group();
  g.position.z = side * TREAD.z;

  const spin = [];
  const tyreMats = [M.tyre, M.hub, M.hub];
  const rollerMats = [M.metal, M.hub, M.hub];

  function addWheel(r, w, x, y, mats, segments = 22) {
    const geo = new THREE.CylinderGeometry(r, r, w, segments);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(x, y, 0);
    g.add(mesh);
    spin.push({ obj: mesh, r });
    return mesh;
  }

  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
    addWheel(0.25, 0.46, x, TREAD.bottomY + TREAD.linkHalfT + 0.25, tyreMats);
  }

  addWheel(0.3, 0.46, TREAD.runHalf, TREAD.centerY, tyreMats); // idler
  const sprocket = addWheel(0.3, 0.4, -TREAD.runHalf, TREAD.centerY, tyreMats);

  const toothGeo = new THREE.BoxGeometry(0.1, 0.075, 0.42);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, M.metal);
    tooth.position.set(Math.cos(a) * 0.345, Math.sin(a) * 0.345, 0);
    tooth.rotation.z = a;
    sprocket.add(tooth);
  }

  for (const x of [-0.7, 0.7]) {
    addWheel(0.1, 0.3, x, TREAD.topY - TREAD.linkHalfT - 0.1, rollerMats, 14);
  }

  const armGeo = new THREE.BoxGeometry(0.4, 0.09, 0.09);
  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
    const arm = new THREE.Mesh(armGeo, M.metal);
    arm.position.set(x - 0.16, 0.45, -side * 0.26);
    arm.rotation.z = -0.5;
    g.add(arm);
  }

  const links = new THREE.InstancedMesh(buildLinkGeometry(), M.track, TREAD.linkCount);
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  links.castShadow = true;
  links.frustumCulled = false;
  g.add(links);

  return { group: g, spin, links, offset: side * 1.7 };
}

const _dummy = new THREE.Object3D();

function updateTread(tread, dt, speed) {
  tread.offset += speed * dt;

  const pitch = TREAD.length / TREAD.linkCount;
  for (let i = 0; i < TREAD.linkCount; i++) {
    const p = pathPoint(i * pitch + tread.offset);
    _dummy.position.set(p.x, p.y, 0);
    _dummy.rotation.set(0, 0, p.a);
    _dummy.updateMatrix();
    tread.links.setMatrixAt(i, _dummy.matrix);
  }
  tread.links.instanceMatrix.needsUpdate = true;

  for (const w of tread.spin) {
    w.obj.rotation.z = -tread.offset / w.r;
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
export function createTankModel(palette = SKINS[0], turretId = 'cannon') {
  let M = rememberBaseColors(buildMaterials(palette));
  const root = new THREE.Group();

  root.add(buildHull(M));

  const treadL = buildTread(M, -1);
  const treadR = buildTread(M, 1);
  root.add(treadL.group, treadR.group);
  // Lay the link chains out immediately — a tank that never drives (the
  // dummy) would otherwise render its wheels with no tracks
  updateTread(treadL, 0, 0);
  updateTread(treadR, 0, 0);

  let beam = null;
  let streaming = false;

  function attachTurret(kind) {
    const built = buildTurret(M, kind);
    built.turret.position.set(0.05, 1.16, 0);
    root.add(built.turret);
    if (kind === 'arctic') {
      beam = createCryoBeam();
      // effect meshes must never be repainted by skins or the husk swap
      beam.group.traverse((o) => { o.userData.fx = true; });
      built.muzzle.add(beam.group);
    }
    return built;
  }

  let parts = attachTurret(turretId);
  const { turret, pitchGroup, gun, muzzle } = parts;

  // Tag every mesh with the material role it was built from, so skins and the
  // freeze overlay can repaint without rebuilding any geometry.
  const meshes = [];
  function collectMeshes() {
    const roleOf = new Map([
      [M.hull, 'hull'], [M.turret, 'turret'], [M.barrel, 'barrel'],
      [M.track, 'track'], [M.metal, 'metal'], [M.tyre, 'tyre'],
      [M.hub, 'hub'], [M.cryo, 'cryo'],
    ]);
    meshes.length = 0;
    root.traverse((o) => {
      if (!o.isMesh || o.userData.fx) return;
      o.castShadow = true;
      o.receiveShadow = true;
      meshes.push([o, Array.isArray(o.material) ? 'wheel' : roleOf.get(o.material) || 'metal']);
    });
  }
  collectMeshes();

  function materialFor(role) {
    return role === 'wheel' ? [M.tyre, M.hub, M.hub] : M[role];
  }

  function disposeMaterials(set) {
    for (const mat of Object.values(set)) {
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
  }

  let charred = false;
  let chill = 0;

  const ICE = new THREE.Color('#7fc4ff');
  const ICE_GLOW = new THREE.Color('#2f79c8');

  function applyChillTint() {
    for (const mat of Object.values(M)) {
      const base = mat.userData.baseColor;
      if (!base) continue;
      mat.color.copy(base).lerp(ICE, 0.62 * chill);
      if (mat.emissive && mat.userData.baseEmissive) {
        mat.emissive.copy(mat.userData.baseEmissive).lerp(ICE_GLOW, 0.75 * chill);
        if (mat.userData.baseEmissive.getHex() === 0) {
          mat.emissiveIntensity = 0.55 * chill;
        }
      }
    }
  }

  const charredMat = new THREE.MeshStandardMaterial({
    color: '#131416',
    roughness: 1.0,
    metalness: 0.05,
  });

  const _hb = new THREE.Vector3();

  return {
    root,
    turret,
    pitchGroup,
    gun,
    muzzle,
    turretId,
    updateTreads(dt, sL, sR) {
      updateTread(treadL, dt, sL);
      updateTread(treadR, dt, sR);
    },
    setCharred(flag) {
      charred = flag;
      if (flag) {
        chill = 0;
        applyChillTint();
        streaming = false;
      }
      for (const [mesh, role] of meshes) {
        mesh.material = flag ? charredMat : materialFor(role);
      }
    },
    // Repaint the whole tank from a skin definition, in place
    setSkin(skin) {
      const old = M;
      M = rememberBaseColors(buildMaterials(skin));
      if (!charred) {
        for (const [mesh, role] of meshes) mesh.material = materialFor(role);
      }
      applyChillTint();
      disposeMaterials(old);
    },
    // Swap the whole turret assembly, keeping the hull and treads
    setTurret(kind) {
      if (kind === this.turretId) return;
      if (beam) {
        beam.dispose();
        beam = null;
      }
      root.remove(this.turret);
      this.turret.traverse((o) => {
        if (o.isMesh && !o.userData.fx) o.geometry.dispose();
      });
      parts = attachTurret(kind);
      this.turret = parts.turret;
      this.pitchGroup = parts.pitchGroup;
      this.gun = parts.gun;
      this.muzzle = parts.muzzle;
      this.turretId = kind;
      streaming = false;
      collectMeshes();
      if (charred) {
        for (const [mesh, role] of meshes) mesh.material = charredMat;
      }
      applyChillTint();
    },
    // 0 = normal, 1 = fully frozen (drives the blue overlay)
    setChill(amount) {
      const next = Math.max(0, Math.min(1, amount));
      if (Math.abs(next - chill) < 0.002) return;
      chill = next;
      applyChillTint();
    },
    getChill: () => chill,
    hasStream: () => !!beam,
    setStream(on) {
      streaming = !!on && !!beam;
    },
    updateStream(dt) {
      if (beam) beam.update(dt, streaming && !charred);
    },
    // Accurate two-box hit test: hull+treads in root space (follows ground
    // pitch/roll), turret in turret space (follows traverse).
    hitTest(worldPoint) {
      _hb.copy(worldPoint);
      root.worldToLocal(_hb);
      if (
        Math.abs(_hb.x) < HIT.bodyX &&
        Math.abs(_hb.z) < HIT.bodyZ &&
        _hb.y > HIT.bodyY0 && _hb.y < HIT.bodyY1
      ) return true;

      _hb.copy(worldPoint);
      turret.worldToLocal(_hb);
      return (
        _hb.x > HIT.turretX0 && _hb.x < HIT.turretX1 &&
        Math.abs(_hb.z) < HIT.turretZ &&
        _hb.y > HIT.turretY0 && _hb.y < HIT.turretY1
      );
    },
  };
}
