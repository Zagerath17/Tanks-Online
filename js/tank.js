import * as THREE from 'three';
import { makeGridTexture, makeHubTexture } from './grid-texture.js';
import { ARENA } from './map.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const SPEC = {
  accel: 13, // u/s^2 under throttle
  brakeAccel: 22, // u/s^2 when throttle opposes motion
  drag: 5.5, // u/s^2 rolling decay with no throttle
  maxForward: 9.5,
  maxReverse: 5.0,
  turnRate: 1.8, // rad/s hull pivot
  turnResponse: 8, // how quickly omega reaches its target
  turretRate: 1.65, // rad/s turret traverse
  halfTrack: 1.5, // distance from hull center to each tread centerline
};

// ---------------------------------------------------------------------------
// Tread loop layout (side profile; local +X = forward, +Y = up)
//
//        ___________top run___________
//       /                             \
//  rear| sprocket                idler |front
//       \___________bottom run________/
//
// The loop is a rounded rectangle: two straight runs joined by semicircles.
// Every wheel radius below is derived from this loop so rims, links, and
// sprocket teeth all line up.
// ---------------------------------------------------------------------------
const TREAD = {
  runHalf: 1.7, // straight runs span x in [-1.7, 1.7]
  arcR: 0.375, // semicircle radius at each end (= end wheel r + link half thickness)
  centerY: 0.455, // height of the end-arc centers (idler/sprocket axles)
  linkCount: 34,
  linkLen: 0.25,
  linkW: 0.62,
  linkHalfT: 0.035,
  grouserH: 0.05,
  z: 1.5, // tread centerline offset from hull center
};
TREAD.bottomY = TREAD.centerY - TREAD.arcR; // 0.08
TREAD.topY = TREAD.centerY + TREAD.arcR; // 0.83
TREAD.runLen = TREAD.runHalf * 2; // 3.4
TREAD.arcLen = Math.PI * TREAD.arcR;
TREAD.length = 2 * TREAD.runLen + 2 * TREAD.arcLen;

// Position + tangent angle at distance t along the loop. Param increases in
// the direction the tread surface circulates when driving forward, so the
// bottom run moves toward -X (gripping the ground) and the top run toward +X.
const _pp = { x: 0, y: 0, a: 0 };
function pathPoint(t) {
  const { runHalf, runLen, arcR, arcLen, centerY, bottomY, topY, length } = TREAD;
  t = ((t % length) + length) % length;

  if (t < runLen) {
    // bottom run, front to rear
    _pp.x = runHalf - t;
    _pp.y = bottomY;
    _pp.a = Math.PI;
    return _pp;
  }
  t -= runLen;

  if (t < arcLen) {
    // rear semicircle, wrapping up and over the sprocket
    const th = -Math.PI / 2 - (t / arcLen) * Math.PI;
    _pp.x = -runHalf + arcR * Math.cos(th);
    _pp.y = centerY + arcR * Math.sin(th);
    _pp.a = th - Math.PI / 2;
    return _pp;
  }
  t -= arcLen;

  if (t < runLen) {
    // top run, rear to front
    _pp.x = -runHalf + t;
    _pp.y = topY;
    _pp.a = 0;
    return _pp;
  }
  t -= runLen;

  // front semicircle, down and around the idler
  const th = Math.PI / 2 - (t / arcLen) * Math.PI;
  _pp.x = runHalf + arcR * Math.cos(th);
  _pp.y = centerY + arcR * Math.sin(th);
  _pp.a = th - Math.PI / 2;
  return _pp;
}

// ---------------------------------------------------------------------------
// Materials — the whole tank wears the dev grid, per the brief
// ---------------------------------------------------------------------------
function buildMaterials() {
  const hullTex = makeGridTexture({
    cells: 6, base: '#4d6039', line: '#41522f', lineWidth: 3, repeat: [0.5, 0.5],
  });
  const turretTex = makeGridTexture({
    cells: 6, base: '#57683c', line: '#4a5a32', lineWidth: 3, repeat: [0.7, 0.7],
  });
  const fenderTex = makeGridTexture({
    cells: 4, base: '#43542f', line: '#394728', lineWidth: 3, repeat: [3, 1],
  });
  const barrelTex = makeGridTexture({
    cells: 4, base: '#3f4d2e', line: '#35422a', lineWidth: 3, repeat: [2, 1],
  });
  const trackTex = makeGridTexture({
    cells: 4, base: '#22252a', line: '#31363d', lineWidth: 3, repeat: [4, 4],
  });
  const tyreTex = makeGridTexture({
    cells: 6, base: '#1c1f23', line: '#2b2f35', lineWidth: 2, repeat: [6, 1],
  });
  const hubTex = makeHubTexture();

  return {
    hull: new THREE.MeshStandardMaterial({ map: hullTex, roughness: 0.8, metalness: 0.15 }),
    turret: new THREE.MeshStandardMaterial({ map: turretTex, roughness: 0.75, metalness: 0.15 }),
    fender: new THREE.MeshStandardMaterial({ map: fenderTex, roughness: 0.85, metalness: 0.1 }),
    barrel: new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.6, metalness: 0.3 }),
    track: new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.95, metalness: 0.05 }),
    tyre: new THREE.MeshStandardMaterial({ map: tyreTex, roughness: 0.95, metalness: 0.05 }),
    hub: new THREE.MeshStandardMaterial({ map: hubTex, roughness: 0.65, metalness: 0.35 }),
    metal: new THREE.MeshStandardMaterial({ color: '#2c3138', roughness: 0.55, metalness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#191b1e', roughness: 1.0, metalness: 0.0 }),
    headlight: new THREE.MeshStandardMaterial({
      color: '#fff3c4', emissive: '#ffd76a', emissiveIntensity: 1.4,
    }),
    taillight: new THREE.MeshStandardMaterial({
      color: '#4a1512', emissive: '#ff3b2f', emissiveIntensity: 1.1,
    }),
  };
}

// ---------------------------------------------------------------------------
// Hull
// ---------------------------------------------------------------------------
function buildHull(M) {
  const g = new THREE.Group();

  // Side profile extruded across the width: sloped glacis, flat deck,
  // sloped rear plate.
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
  g.add(new THREE.Mesh(hullGeo, M.hull));

  // Engine deck vents
  const ventGeo = new THREE.BoxGeometry(0.34, 0.035, 1.9);
  for (const x of [-0.6, -1.0, -1.4]) {
    const vent = new THREE.Mesh(ventGeo, M.metal);
    vent.position.set(x, 1.175, 0);
    g.add(vent);
  }

  // Driver hatch + periscope on the front deck
  const dHatch = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.06, 18), M.metal);
  dHatch.position.set(0.62, 1.19, 0.5);
  g.add(dHatch);
  const peri = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.16), M.metal);
  peri.position.set(0.84, 1.2, 0.5);
  g.add(peri);

  // Headlights + guards
  const lightGeo = new THREE.BoxGeometry(0.16, 0.13, 0.2);
  const guardGeo = new THREE.BoxGeometry(0.2, 0.03, 0.24);
  for (const z of [-0.72, 0.72]) {
    const l = new THREE.Mesh(lightGeo, M.headlight);
    l.position.set(2.33, 0.68, z);
    const guard = new THREE.Mesh(guardGeo, M.metal);
    guard.position.set(2.36, 0.78, z);
    g.add(l, guard);
  }

  // Tail lights
  const tailGeo = new THREE.BoxGeometry(0.08, 0.09, 0.15);
  for (const z of [-0.75, 0.75]) {
    const t = new THREE.Mesh(tailGeo, M.taillight);
    t.position.set(-2.46, 0.87, z);
    g.add(t);
  }

  // Exhaust pipes
  const exGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12);
  exGeo.rotateZ(Math.PI / 2);
  const exTipGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.07, 12);
  exTipGeo.rotateZ(Math.PI / 2);
  for (const z of [-0.5, 0.5]) {
    const pipe = new THREE.Mesh(exGeo, M.metal);
    pipe.position.set(-2.5, 0.66, z);
    const tip = new THREE.Mesh(exTipGeo, M.rubber);
    tip.position.set(-2.76, 0.66, z);
    g.add(pipe, tip);
  }

  // Tow hooks on the nose
  const hookGeo = new THREE.TorusGeometry(0.07, 0.024, 8, 14);
  hookGeo.rotateY(Math.PI / 2);
  for (const z of [-0.55, 0.55]) {
    const hook = new THREE.Mesh(hookGeo, M.metal);
    hook.position.set(2.42, 0.5, z);
    g.add(hook);
  }

  // Fenders over the treads, with rubber mud flaps
  const fenderGeo = new THREE.BoxGeometry(4.15, 0.06, 0.74);
  const flapGeo = new THREE.BoxGeometry(0.05, 0.34, 0.7);
  for (const z of [-TREAD.z, TREAD.z]) {
    const fender = new THREE.Mesh(fenderGeo, M.fender);
    fender.position.set(0.05, 0.98, z);
    const front = new THREE.Mesh(flapGeo, M.rubber);
    front.position.set(2.16, 0.8, z);
    front.rotation.z = -0.22;
    const rear = new THREE.Mesh(flapGeo, M.rubber);
    rear.position.set(-2.06, 0.8, z);
    rear.rotation.z = 0.22;
    g.add(fender, front, rear);
  }

  // Deck stowage: fuel drum with straps, and a tool box
  const drumGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.7, 18);
  drumGeo.rotateZ(Math.PI / 2);
  const drum = new THREE.Mesh(drumGeo, M.metal);
  drum.position.set(-1.55, 1.38, -0.68);
  g.add(drum);
  const strapGeo = new THREE.BoxGeometry(0.06, 0.47, 0.47);
  for (const x of [-1.72, -1.38]) {
    const strap = new THREE.Mesh(strapGeo, M.rubber);
    strap.position.set(x, 1.38, -0.68);
    g.add(strap);
  }
  const toolBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.24, 0.42), M.fender);
  toolBox.position.set(-1.5, 1.29, 0.7);
  g.add(toolBox);

  return g;
}

// ---------------------------------------------------------------------------
// Turret
// ---------------------------------------------------------------------------
function buildTurret(M) {
  const t = new THREE.Group();

  // Turret ring collar
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  // Main body: stacked slabs with chamfered cheek plates
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

  // Mantlet + barrel assembly
  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.66), M.turret);
  mantlet.position.set(0.92, 0.4, 0);
  t.add(mantlet);

  const sleeveGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.75, 16);
  sleeveGeo.rotateZ(Math.PI / 2);
  const sleeve = new THREE.Mesh(sleeveGeo, M.barrel);
  sleeve.position.set(1.45, 0.42, 0);
  t.add(sleeve);

  const barrelGeo = new THREE.CylinderGeometry(0.09, 0.085, 1.9, 16);
  barrelGeo.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, M.barrel);
  barrel.position.set(2.75, 0.42, 0);
  t.add(barrel);

  const brakeGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 16);
  brakeGeo.rotateZ(Math.PI / 2);
  const brake = new THREE.Mesh(brakeGeo, M.metal);
  brake.position.set(3.79, 0.42, 0);
  t.add(brake);

  const baffleGeo = new THREE.BoxGeometry(0.06, 0.33, 0.12);
  for (const x of [3.71, 3.87]) {
    const baffle = new THREE.Mesh(baffleGeo, M.rubber);
    baffle.position.set(x, 0.42, 0);
    t.add(baffle);
  }

  const muzzleRing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16).rotateZ(Math.PI / 2), M.rubber);
  muzzleRing.position.set(3.99, 0.42, 0);
  t.add(muzzleRing);

  // Commander hatch with lid + handle
  const hatchBase = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.1, 18), M.turret);
  hatchBase.position.set(-0.35, 0.79, 0.28);
  const hatchLid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 18), M.metal);
  hatchLid.position.set(-0.35, 0.86, 0.28);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), M.metal);
  handle.position.set(-0.35, 0.89, 0.28);
  t.add(hatchBase, hatchLid, handle);

  // Gunner optics on the front edge
  const optics = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.18), M.metal);
  optics.position.set(0.62, 0.72, -0.25);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.1), M.headlight);
  lens.position.set(0.7, 0.72, -0.25);
  t.add(optics, lens);

  // Antenna, slightly raked
  const ant = new THREE.Group();
  ant.position.set(-0.55, 0.76, -0.38);
  ant.rotation.set(0.08, 0, -0.1);
  const antBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.08, 10), M.metal);
  const antRod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.007, 1.0, 8), M.metal);
  antRod.position.y = 0.5;
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), M.rubber);
  antTip.position.y = 1.0;
  ant.add(antBase, antRod, antTip);
  t.add(ant);

  // Grab rails
  const railGeo = new THREE.BoxGeometry(0.55, 0.035, 0.035);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, M.metal);
    rail.position.set(-0.05, 0.56, side * 0.67);
    t.add(rail);
  }

  // Rear stowage bustle
  const bustle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.8), M.fender);
  bustle.position.set(-0.92, 0.36, 0);
  t.add(bustle);

  // Muzzle anchor for later (projectile spawn point)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(4.0, 0.42, 0);
  t.add(muzzle);
  t.userData.muzzle = muzzle;

  return t;
}

// ---------------------------------------------------------------------------
// Treads: wheels + drive sprocket + instanced link chain
// ---------------------------------------------------------------------------
function buildLinkGeometry() {
  const L = TREAD.linkLen / 2;
  const T = TREAD.linkHalfT;
  const G = TREAD.grouserH;

  // Link cross-section: flat pad with a grouser ridge on the outer face (+Y).
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

  const spin = []; // { obj, r } — everything that rotates with the tread

  const tyreMats = [M.tyre, M.hub, M.hub];
  const rollerMats = [M.metal, M.hub, M.hub];

  function addWheel(r, w, x, y, mats, segments = 22) {
    const geo = new THREE.CylinderGeometry(r, r, w, segments);
    geo.rotateX(Math.PI / 2); // axle along Z
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(x, y, 0);
    g.add(mesh);
    spin.push({ obj: mesh, r });
    return mesh;
  }

  // Five road wheels resting on the bottom run
  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
    addWheel(0.25, 0.5, x, TREAD.bottomY + TREAD.linkHalfT + 0.25, tyreMats);
  }

  // Idler (front) and drive sprocket (rear) sit at the end-arc centers
  addWheel(0.3, 0.5, TREAD.runHalf, TREAD.centerY, tyreMats);
  const sprocket = addWheel(0.3, 0.44, -TREAD.runHalf, TREAD.centerY, tyreMats);

  // Sprocket teeth reach into the gaps between links
  const toothGeo = new THREE.BoxGeometry(0.1, 0.075, 0.5);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, M.metal);
    tooth.position.set(Math.cos(a) * 0.345, Math.sin(a) * 0.345, 0);
    tooth.rotation.z = a;
    sprocket.add(tooth);
  }

  // Return rollers carrying the top run
  for (const x of [-0.7, 0.7]) {
    addWheel(0.1, 0.34, x, TREAD.topY - TREAD.linkHalfT - 0.1, rollerMats, 14);
  }

  // Static suspension swing arms, tucked toward the hull
  const armGeo = new THREE.BoxGeometry(0.4, 0.09, 0.09);
  for (const x of [-1.1, -0.55, 0, 0.55, 1.1]) {
    const arm = new THREE.Mesh(armGeo, M.metal);
    arm.position.set(x - 0.16, 0.45, -side * 0.3);
    arm.rotation.z = -0.5;
    g.add(arm);
  }

  // The link chain itself
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

  // Wheels roll at the tread's surface speed; tying rotation directly to the
  // accumulated offset keeps them perfectly in sync with the links.
  for (const w of tread.spin) {
    w.obj.rotation.z = -tread.offset / w.r;
  }
}

// ---------------------------------------------------------------------------
// Assembly + simulation
// ---------------------------------------------------------------------------
export function createTank() {
  const M = buildMaterials();
  const root = new THREE.Group();

  root.add(buildHull(M));

  const treadL = buildTread(M, -1);
  const treadR = buildTread(M, 1);
  root.add(treadL.group, treadR.group);

  const turret = buildTurret(M);
  turret.position.set(0.05, 1.16, 0);
  root.add(turret);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const state = { v: 0, omega: 0, heading: 0, turret: 0 };

  function update(dt, input) {
    // --- throttle -> forward speed ---
    if (input.throttle > 0) {
      state.v += (state.v < 0 ? SPEC.brakeAccel : SPEC.accel) * dt;
    } else if (input.throttle < 0) {
      state.v -= (state.v > 0 ? SPEC.brakeAccel : SPEC.accel) * dt;
    } else {
      const d = SPEC.drag * dt;
      state.v = Math.abs(state.v) <= d ? 0 : state.v - Math.sign(state.v) * d;
    }
    state.v = THREE.MathUtils.clamp(state.v, -SPEC.maxReverse, SPEC.maxForward);

    // --- hull yaw (A/D pivot) ---
    const targetOmega = input.turn * SPEC.turnRate;
    state.omega += (targetOmega - state.omega) * Math.min(1, SPEC.turnResponse * dt);
    state.heading += state.omega * dt;

    // --- integrate position; local +X is forward ---
    root.position.x += Math.cos(state.heading) * state.v * dt;
    root.position.z += -Math.sin(state.heading) * state.v * dt;
    const lim = ARENA.half - ARENA.margin;
    root.position.x = THREE.MathUtils.clamp(root.position.x, -lim, lim);
    root.position.z = THREE.MathUtils.clamp(root.position.z, -lim, lim);
    root.rotation.y = state.heading;

    // --- turret traverse (J/K) ---
    state.turret += input.turret * SPEC.turretRate * dt;
    turret.rotation.y = state.turret;

    // --- per-side tread surface speeds (counter-rotate on pivot turns) ---
    const sR = state.v + state.omega * SPEC.halfTrack;
    const sL = state.v - state.omega * SPEC.halfTrack;
    updateTread(treadR, dt, sR);
    updateTread(treadL, dt, sL);
  }

  return {
    root,
    state,
    update,
    aimAngle: () => state.heading + state.turret,
    muzzle: turret.userData.muzzle,
  };
}
