import * as THREE from 'three';
import { makeGridTexture, makeHubTexture } from './grid-texture.js';

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
  halfTrack: 1.5,
};

export const PALETTE = {
  green: {
    hull: ['#4d6039', '#41522f'],
    turret: ['#57683c', '#4a5a32'],
    barrel: ['#3f4d2e', '#35422a'],
  },
  red: {
    hull: ['#6e3a33', '#5c2f29'],
    turret: ['#7c453a', '#683a30'],
    barrel: ['#5c332c', '#4d2b24'],
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
  linkW: 0.62,
  linkHalfT: 0.035,
  grouserH: 0.05,
  z: 1.5,
};
TREAD.bottomY = TREAD.centerY - TREAD.arcR;
TREAD.topY = TREAD.centerY + TREAD.arcR;
TREAD.runLen = TREAD.runHalf * 2;
TREAD.arcLen = Math.PI * TREAD.arcR;
TREAD.length = 2 * TREAD.runLen + 2 * TREAD.arcLen;

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
  const hullTex = makeGridTexture({
    cells: 6, base: p.hull[0], line: p.hull[1], lineWidth: 3, repeat: [0.5, 0.5],
  });
  const turretTex = makeGridTexture({
    cells: 6, base: p.turret[0], line: p.turret[1], lineWidth: 3, repeat: [0.7, 0.7],
  });
  const barrelTex = makeGridTexture({
    cells: 4, base: p.barrel[0], line: p.barrel[1], lineWidth: 3, repeat: [2, 1],
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
  };
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

  const hullGeo = new THREE.ExtrudeGeometry(s, {
    depth: 2.26,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 1,
  });
  hullGeo.translate(0, 0, -1.13);
  return new THREE.Mesh(hullGeo, M.hull);
}

// ---------------------------------------------------------------------------
// Turret — base shape plus a pitching gun assembly
// ---------------------------------------------------------------------------
function buildTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 1.3), M.turret);
  lower.position.set(0.05, 0.33, 0);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.24, 1.0), M.turret);
  upper.position.set(-0.02, 0.64, 0);
  t.add(lower, upper);

  const cheekGeo = new THREE.BoxGeometry(0.65, 0.42, 0.26);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, M.turret);
    cheek.position.set(0.62, 0.33, side * 0.58);
    cheek.rotation.y = -side * 0.5;
    t.add(cheek);
  }

  // Pitch pivot at the mantlet; everything forward of it elevates together.
  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.92, 0.4, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.66), M.turret);
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
    addWheel(0.25, 0.5, x, TREAD.bottomY + TREAD.linkHalfT + 0.25, tyreMats);
  }

  addWheel(0.3, 0.5, TREAD.runHalf, TREAD.centerY, tyreMats); // idler
  const sprocket = addWheel(0.3, 0.44, -TREAD.runHalf, TREAD.centerY, tyreMats);

  const toothGeo = new THREE.BoxGeometry(0.1, 0.075, 0.5);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, M.metal);
    tooth.position.set(Math.cos(a) * 0.345, Math.sin(a) * 0.345, 0);
    tooth.rotation.z = a;
    sprocket.add(tooth);
  }

  for (const x of [-0.7, 0.7]) {
    addWheel(0.1, 0.34, x, TREAD.topY - TREAD.linkHalfT - 0.1, rollerMats, 14);
  }

  const armGeo = new THREE.BoxGeometry(0.4, 0.09, 0.09);
  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
    const arm = new THREE.Mesh(armGeo, M.metal);
    arm.position.set(x - 0.16, 0.45, -side * 0.3);
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
export function createTankModel(palette = PALETTE.green) {
  const M = buildMaterials(palette);
  const root = new THREE.Group();

  root.add(buildHull(M));

  const treadL = buildTread(M, -1);
  const treadR = buildTread(M, 1);
  root.add(treadL.group, treadR.group);

  const { turret, pitchGroup, gun, muzzle } = buildTurret(M);
  turret.position.set(0.05, 1.16, 0);
  root.add(turret);

  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      meshes.push([o, o.material]);
    }
  });

  const charredMat = new THREE.MeshStandardMaterial({
    color: '#131416',
    roughness: 1.0,
    metalness: 0.05,
  });

  return {
    root,
    turret,
    pitchGroup,
    gun,
    muzzle,
    updateTreads(dt, sL, sR) {
      updateTread(treadL, dt, sL);
      updateTread(treadR, dt, sR);
    },
    setCharred(flag) {
      for (const [mesh, original] of meshes) {
        mesh.material = flag ? charredMat : original;
      }
    },
  };
}
