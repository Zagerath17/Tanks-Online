import * as THREE from 'three';
import { makeMetalTexture, makeHubTexture, makeArmourTexture } from './grid-texture.js';
import { createStreamBeam } from './cryo.js';

// ---------------------------------------------------------------------------
// Movement tuning (used by the player controller)
// ---------------------------------------------------------------------------
// Handling shared by every hull. Per-hull speed, size, and hull points live
// in HULL_SPECS below; SPEC stays the baseline the specs scale from.
export const SPEC = {
  accel: 13,
  brakeAccel: 22,
  drag: 5.5,
  maxForward: 9.5,
  maxReverse: 5.0,
  turnRate: 1.8,
  turnResponse: 8,
  halfTrack: 1.18,
  // --- traction model (the controller is the only source of ground grip) ---
  gripRate: 14,   // how fast sideways slide is scrubbed off, 1/s
  slipRate: 3,    // how fast the commanded speed gives up when blocked, 1/s
  stabilize: 3,   // bleeds pitch/roll rate while tracks are down, 1/s
  scrub: 3.5,     // ground drag on a hull nobody is driving (husk, flipped)
};

// ---------------------------------------------------------------------------
// Hulls. Everything dimensional is declared here once; the tread layout, the
// hit boxes and the physics chassis are all DERIVED from these numbers by
// deriveHull() below, so a hull's collision can never drift from its model.
// ---------------------------------------------------------------------------
const HULL_DEFS = {
  vanguard: {
    name: 'Vanguard',
    maxHp: 1000,
    speedMul: 1.0,
    // hull side profile (x = fore/aft, y = up), extruded across the width
    // the reference silhouette: a single clean raked glacis
    profile: [
      [-2.25, 0.40], [2.20, 0.40], [2.45, 0.62],
      [1.05, 1.16], [-1.60, 1.16], [-2.35, 1.02], [-2.45, 0.78],
    ],
    details: [
      { part: 'glacis applique', x: 1.66, y: 0.86, z: 0, sx: 0.60, sy: 0.08, sz: 1.34, rot: -0.40 },
      { part: 'rear grille', x: -1.95, y: 1.20, z: 0, sx: 0.60, sy: 0.08, sz: 1.20, mat: 'metal' },
    ],
    depth: 1.70,
    deckY: 1.16,
    turretX: 0.05,
    tread: {
      runHalf: 1.7, arcR: 0.375, centerY: 0.455, linkCount: 34,
      linkLen: 0.25, linkW: 0.56, linkHalfT: 0.035, grouserH: 0.05, z: 1.18,
      roadWheels: [-1.1, -0.55, 0, 0.55, 1.1], roadR: 0.25, roadW: 0.46,
      rollers: [-0.7, 0.7], rollerR: 0.1, rollerW: 0.3,
      endR: 0.30, endW: 0.46, sprocketW: 0.40, teeth: 10,
    },
  },
  ironclad: {
    name: 'Ironclad',
    maxHp: 1500,
    speedMul: 0.765, // 15% slower again than the Paladin's 0.9
    // the heaviest chassis in the game: a long, deep, slab-sided hull on
    // seven road wheels, carrying the widest track the ramps will take
    // a ram prow stepping up through layered belt armour to a slab deck
    profile: [
      [-2.90, 0.50], [2.55, 0.50], [3.15, 0.72],
      [2.62, 0.96], [2.72, 1.16], [2.20, 1.48],
      [-2.20, 1.48], [-3.02, 1.34], [-3.15, 1.02],
    ],
    details: [
      { part: 'prow rib', x: 2.92, y: 0.66, z: 0, sx: 0.26, sy: 0.09, sz: 1.60, mat: 'metal' },
      { part: 'belt step', x: 2.50, y: 1.06, z: 0, sx: 0.22, sy: 0.14, sz: 1.70 },
      { part: 'engine deck', x: -2.28, y: 1.56, z: 0, sx: 0.86, sy: 0.12, sz: 1.72 },
      { part: 'louvre', x: -1.60, y: 1.545, z: 0, sx: 0.16, sy: 0.09, sz: 1.40, mat: 'metal' },
      { part: 'louvre', x: -1.28, y: 1.545, z: 0, sx: 0.16, sy: 0.09, sz: 1.40, mat: 'metal' },
    ],
    depth: 2.18,
    deckY: 1.48,
    turretX: 0.05,
    tread: {
      runHalf: 2.28, arcR: 0.47, centerY: 0.56, linkCount: 45,
      linkLen: 0.25, linkW: 0.74, linkHalfT: 0.035, grouserH: 0.05, z: 1.50,
      roadWheels: [-1.83, -1.22, -0.61, 0, 0.61, 1.22, 1.83], roadR: 0.30, roadW: 0.60,
      rollers: [-1.0, 0, 1.0], rollerR: 0.12, rollerW: 0.40,
      endR: 0.38, endW: 0.60, sprocketW: 0.54, teeth: 12,
    },
  },
  paladin: {
    name: 'Paladin',
    maxHp: 1250,
    speedMul: 0.9, // 10% slower than the Vanguard
    // a heavy chassis: longer, wider, taller, riding on six road wheels with
    // a third return roller to carry the extra track
    // squared-off and slab-fronted, with bolt-on plate over the glacis
    profile: [
      [-2.46, 0.44], [2.50, 0.44], [2.68, 0.60],
      [2.68, 1.02], [2.30, 1.28],
      [-1.90, 1.28], [-2.60, 1.16], [-2.68, 0.84],
    ],
    details: [
      { part: 'armour block', x: 2.60, y: 0.72, z: 0.42, sx: 0.20, sy: 0.22, sz: 0.46, mat: 'metal' },
      { part: 'armour block', x: 2.60, y: 0.72, z: -0.42, sx: 0.20, sy: 0.22, sz: 0.46, mat: 'metal' },
      { part: 'front plate', x: 2.60, y: 1.06, z: 0, sx: 0.18, sy: 0.20, sz: 1.44 },
      { part: 'deck riser', x: -2.05, y: 1.34, z: 0, sx: 0.62, sy: 0.10, sz: 1.42 },
    ],
    depth: 1.88,
    deckY: 1.28,
    turretX: 0.05,
    tread: {
      runHalf: 1.92, arcR: 0.41, centerY: 0.50, linkCount: 38,
      linkLen: 0.25, linkW: 0.64, linkHalfT: 0.035, grouserH: 0.05, z: 1.30,
      roadWheels: [-1.45, -0.87, -0.29, 0.29, 0.87, 1.45], roadR: 0.27, roadW: 0.52,
      rollers: [-0.85, 0, 0.85], rollerR: 0.11, rollerW: 0.34,
      endR: 0.33, endW: 0.52, sprocketW: 0.46, teeth: 11,
    },
  },
  falcon: {
    name: 'Falcon',
    maxHp: 650,
    speedMul: 1.4784, // 12% over the Pioneer, then 10% again on top
    // the smallest chassis: short, low, and tightly sprung. Width is floored
    // by the turret ring every hull has to carry, so it buys its compactness
    // in length and height instead.
    // one long unbroken rake from a knife nose to a short tail — stripped
    profile: [
      [-1.58, 0.34], [1.28, 0.34], [1.75, 0.50],
      [1.02, 0.84], [0.42, 0.90],
      [-1.16, 0.90], [-1.62, 0.80], [-1.75, 0.58],
    ],
    details: [
      { part: 'rear louvre', x: -1.28, y: 0.955, z: 0, sx: 0.52, sy: 0.11, sz: 0.92, mat: 'metal' },
      { part: 'nose splitter', x: 1.50, y: 0.545, z: 0, sx: 0.34, sy: 0.06, sz: 1.14, mat: 'metal' },
    ],
    depth: 1.42,
    deckY: 0.90,
    turretX: 0.05,
    tread: {
      runHalf: 1.18, arcR: 0.30, centerY: 0.36, linkCount: 25,
      linkLen: 0.25, linkW: 0.48, linkHalfT: 0.035, grouserH: 0.05, z: 0.99,
      roadWheels: [-0.78, -0.26, 0.26, 0.78], roadR: 0.19, roadW: 0.38,
      rollers: [-0.45, 0.45], rollerR: 0.08, rollerW: 0.26,
      endR: 0.24, endW: 0.38, sprocketW: 0.32, teeth: 8,
    },
  },
  pioneer: {
    name: 'Pioneer',
    maxHp: 800,
    speedMul: 1.2, // 20% quicker than the Vanguard
    // shorter, narrower, lower — a compact scout hull
    // a stepped two-stage glacis, short and busy — a working scout hull
    profile: [
      [-1.92, 0.38], [1.80, 0.38], [2.10, 0.56],
      [1.62, 0.74], [1.30, 0.78], [0.72, 1.02],
      [-1.30, 1.02], [-1.98, 0.92], [-2.10, 0.68],
    ],
    details: [
      { part: 'stowage box', x: -1.58, y: 1.10, z: 0.30, sx: 0.46, sy: 0.17, sz: 0.52, mat: 'metal' },
      { part: 'rear grille', x: -1.58, y: 1.05, z: -0.34, sx: 0.46, sy: 0.07, sz: 0.44, mat: 'metal' },
      { part: 'step plate', x: 1.46, y: 0.66, z: 0, sx: 0.30, sy: 0.07, sz: 1.22 },
    ],
    depth: 1.52,
    deckY: 1.02,
    turretX: 0.05,
    tread: {
      runHalf: 1.45, arcR: 0.34, centerY: 0.41, linkCount: 30,
      linkLen: 0.25, linkW: 0.52, linkHalfT: 0.035, grouserH: 0.05, z: 1.06,
      roadWheels: [-0.95, -0.32, 0.32, 0.95], roadR: 0.22, roadW: 0.42,
      rollers: [-0.55, 0.55], rollerR: 0.09, rollerW: 0.28,
      endR: 0.27, endW: 0.42, sprocketW: 0.36, teeth: 9,
    },
  },
};

// Fill in every derived quantity for a hull: the tread loop, the hit boxes,
// and the physics chassis that has to enclose all of it.
function deriveHull(id, def) {
  const t = { ...def.tread };
  t.bottomY = t.centerY - t.arcR;
  t.topY = t.centerY + t.arcR;
  t.runLen = t.runHalf * 2;
  t.arcLen = Math.PI * t.arcR;
  t.length = 2 * t.runLen + 2 * t.arcLen;

  // extents straight off the profile, so the boxes match the model
  const xs = def.profile.map((p) => p[0]);
  const ys = def.profile.map((p) => p[1]);
  const noseX = Math.max(...xs);
  const tailX = Math.min(...xs);
  const floorY = Math.min(...ys);
  const roofY = Math.max(...ys);

  // the widest thing on the tank is the outer face of a track grouser
  const halfWidth = t.z + t.linkW / 2 + t.grouserH;
  // the longest is whichever of hull nose / idler wheel reaches furthest
  const halfLength = Math.max(noseX, -tailX, t.runHalf + t.endR);
  const treadBottom = t.bottomY - t.linkHalfT - t.grouserH;

  const hit = {
    bodyX: halfLength + 0.05,
    bodyZ: halfWidth + 0.02,
    bodyY0: Math.max(0, treadBottom) + 0.02,
    bodyY1: roofY + 0.03,
    // turret box, in turret-local space (same for every hull)
    turretX0: -0.9, turretX1: 1.1, turretZ: 0.62,
    turretY0: 0.0, turretY1: 0.8,
  };

  // Physics box: encloses the tank from track bottom to deck, pulled a hair
  // inside the visual extents so the hull doesn't catch on scenery its model
  // clears. The centre of mass sits at COM_FRAC of the box height rather than
  // halfway up, which is what keeps a tank stable but still flippable — the
  // original hand-tuned chassis had exactly this proportion.
  const COM_FRAC = 0.42;
  const hy = (roofY - treadBottom) / 2;
  const chassis = {
    hx: halfLength - 0.04,
    hy,
    hz: halfWidth - 0.02,
    shapeOffY: hy * (1 - 2 * COM_FRAC),
  };
  // where the model's origin (its ground-contact plane) sits in body space
  chassis.modelOffY = chassis.shapeOffY - hy - treadBottom;
  chassis.groundReach = hy - chassis.shapeOffY + 0.38;

  const move = {
    ...SPEC,
    accel: SPEC.accel * def.speedMul,
    brakeAccel: SPEC.brakeAccel * def.speedMul,
    maxForward: SPEC.maxForward * def.speedMul,
    maxReverse: SPEC.maxReverse * def.speedMul,
    halfTrack: t.z,
  };

  return {
    id, name: def.name, maxHp: def.maxHp, speedMul: def.speedMul,
    profile: def.profile, details: def.details || [], depth: def.depth, deckY: def.deckY, turretX: def.turretX,
    tread: t, hit, chassis, move,
  };
}

export const HULLS = {};
for (const [id, def] of Object.entries(HULL_DEFS)) HULLS[id] = deriveHull(id, def);

export const DEFAULT_HULL = 'vanguard';

export function hullSpec(id) {
  return HULLS[id] || HULLS[DEFAULT_HULL];
}

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
    id: 'red', name: 'Red',
    hull: ['#a8302a', '#8c2722'], turret: ['#b83a32', '#9a2e28'], barrel: ['#8a2822', '#71201c'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'orange', name: 'Orange',
    hull: ['#c26a1c', '#a45716'], turret: ['#d2761f', '#b06119'], barrel: ['#a05616', '#874712'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'yellow', name: 'Yellow',
    hull: ['#c9a81c', '#a98d16'], turret: ['#d9b722', '#b5991a'], barrel: ['#a58a16', '#8a7312'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'green', name: 'Green',
    hull: ['#2b8c3d', '#227430'], turret: ['#309a44', '#267f36'], barrel: ['#227430', '#1b5e27'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'blue', name: 'Blue',
    hull: ['#2455ac', '#1d468f'], turret: ['#2a60bd', '#224e9a'], barrel: ['#1d468f', '#173a76'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'indigo', name: 'Indigo',
    hull: ['#3b2f8f', '#302677'], turret: ['#45379f', '#382c82'], barrel: ['#2d2470', '#241d5c'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'violet', name: 'Violet',
    hull: ['#76309c', '#612782'], turret: ['#8437ac', '#6d2d8d'], barrel: ['#5d2680', '#4c1f69'],
    pattern: { cells: 6, lineWidth: 3 },
  },
  {
    id: 'black', name: 'Black',
    hull: ['#1a1c1f', '#111315'], turret: ['#212427', '#16181a'], barrel: ['#141618', '#0d0f10'],
    pattern: { cells: 5, lineWidth: 4 },
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
  cannon: {
    mode: 'projectile', fireInterval: 2.5, damage: 200, projectile: 'shell',
    // Backward impulse at the muzzle, in metres per second of hull velocity.
    // A 200 mm gun shoves its own tank hard; this is deliberately heavy.
    recoilKick: 1.75,  // 70% of the Thunderbolt's base kick (2.5)
  },
  // Flechette: a shotgun. One pull throws a tight cone of 26 darts that are
  // spent by 40 m — devastating in someone's face, useless across the arena.
  flechette: {
    mode: 'projectile',
    projectile: 'pellet',
    fireInterval: 1.6,
    damage: 20,          // per dart; 520 if the whole cone lands
    pellets: 26,
    spread: 0.055,       // radians of cone half-angle: tight, not a wall
    recoilKick: 3.0,
  },

  // Thunderbolt: a heavy assault gun that fires when you LET GO, and that
  // will trade a shot for a much bigger one if you are willing to stand still
  // and hold the trigger down for it.
  thunder: {
    mode: 'projectile',
    projectile: 'bolt',
    fireInterval: 2,
    damage: 350,
    releaseFire: true,      // the round leaves on the release, not the press
    chargeTime: 3,          // hold this long and the shot is banked instead
    chargedDamage: 600,
    chargedCooldown: 3,     // and the gun needs longer to recover afterwards
    // The banked round kicks exactly twice as hard as a normal one, and is
    // deliberately pitched just under the railgun (5.6) — heavier than
    // anything else on the roster, but still not the heaviest thing there is.
    recoilKick: 2.5,
    chargedKick: 5.0,
  },
  plasma: {
    mode: 'projectile',
    projectile: 'plasma',
    fireInterval: 0.125, // a bolt every eighth of a second, barrels alternating
    damage: 25,
    dual: true,        // barrels take it in turns
    auto: true,        // hold the trigger and it keeps firing
    recoil: 0.1,       // a plasma bolt barely nudges the tank
    recoilKick: 0.5,   // a light but real nudge
    smokeTime: 0,      // no propellant, so no barrel smoke
    // charge bar, same 0-100 scale the stream weapons use, but spent per
    // bolt rather than per second
    fuelPerShot: 4,    // ~25 bolts, a little over three seconds of fire
    fuelRecharge: 11,  // ~9 s back to full, starting the moment you release
    restartAt: 8,
  },
  arctic: {
    mode: 'stream',
    element: 'cryo',
    recoilKick: 0,     // a poured stream has nothing to recoil against
    range: 9.0,        // matches the beam geometry exactly (see cryo.js)
    coneR: 2.2,        // spray half-width at maximum range
    tickDamage: 10,    // 100 dps, applied in tenth-second bites
    tickInterval: 0.1,
    fuelDrain: 10,     // 10 s of continuous stream from full
    fuelRecharge: 5.6, // refills in ~18 s, starting the instant you let go
    restartAt: 8,      // must build this much back before it'll fire again
    statusRise: 1 / 3, // 3 s of stream to reach the full effect
    statusFall: 1 / 3, // fades at the same rate...
    statusDelay: 2,    // ...after a couple of seconds off the beam
    maxSlow: 0.5,      // frozen tanks move at half speed
  },
  railgun: {
    mode: 'railgun',
    range: 120,
    windUp: 1.0,        // a second of spin-up before it lets go
    damage: 650,
    falloff: 150,       // each tank it punches through takes 150 less
    // The heaviest thing on any hull by a wide margin: it visibly throws the
    // tank backwards and stands it up on its rear idlers.
    recoilKick: 5.6,
    rechargeTime: 7,
    fuelRecharge: 100 / 7,
  },
  aegis: {
    mode: 'beam',
    range: 26,
    recoilKick: 0,       // an energy tether does not kick
    lockAngle: 0.42,     // ~24 degrees either side of where you're aiming
    tickInterval: 0.1,
    damageTick: 7.5,     // 75 a second to an enemy
    healTick: 5,         // 50 a second to a teammate
    lifestealFrac: 0.2,  // and you take back a fifth of the damage you deal
    fuelDrain: 10,
    fuelRecharge: 5.6,
    restartAt: 8,
  },
  inferno: {
    mode: 'stream',
    element: 'flame',
    recoilKick: 0,     // a poured stream has nothing to recoil against
    range: 9.0,        // matches the beam geometry exactly
    coneR: 2.2,
    tickDamage: 6,     // 60 dps, applied in tenth-second bites
    tickInterval: 0.1,
    fuelDrain: 10,
    fuelRecharge: 5.6,
    restartAt: 8,
    statusRise: 1 / 3,
    statusFall: 1 / 3,
    statusDelay: 2,
    burnFrac: 0.2,     // at full burn, 20% of this weapon's own dps, per second
  },
};

// ---------------------------------------------------------------------------
// Tread loop layout (side profile; local +X = forward, +Y = up).
// Rounded-rectangle loop: two straight runs joined by semicircles. Every
// wheel radius is derived from the loop so rims, links, and teeth line up.
// ---------------------------------------------------------------------------
// Vanguard's tread layout, kept exported for anything that wants the
// baseline numbers. Live geometry always reads the equipped hull's own copy.
export const TREAD = HULLS.vanguard.tread;
export const HIT = HULLS.vanguard.hit;

// Position + tangent angle at distance t along the loop. Param increases in
// the direction the tread circulates when driving forward: bottom run moves
// toward -X (gripping the ground), top run toward +X.
const _pp = { x: 0, y: 0, a: 0 };
function pathPoint(T, t) {
  const { runHalf, runLen, arcR, arcLen, centerY, bottomY, topY, length } = T;
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
// A skin means half a dozen 512x512 procedural plates, each thousands of
// canvas draws. Regenerating them on every click is what made switching skins
// stall, and switching back rebuilt paint that had just been thrown away.
//
// The TEXTURES are cached and shared; the MATERIALS are not. That split
// matters: the freeze and burn overlays work by mutating material colours, so
// if two tanks shared a material set, chilling one would turn the other blue
// as well. Sharing only the maps keeps switching instant and keeps every
// tank's tint its own.
const textureCache = new Map();

function texturesFor(p) {
  const key = p && p.id ? p.id : 'custom';
  let set = textureCache.get(key);
  if (set) return set;

  // A skin's old grid settings drive how the steel is finished: finer cells
  // mean a tighter brush grain, heavier lines a more beaten plate.
  const pat = p.pattern || {};
  const grain = Math.min(2, Math.max(0.5, (pat.cells || 6) / 6));
  const wear = Math.min(2, Math.max(0.5, (pat.lineWidth || 3) / 3));

  set = {
    // One designed sheet per surface at repeat [1, 1] — no tiling, so the
    // same smudge never shows up in four places on the same plate.
    hull: makeArmourTexture({ base: p.hull[0], shade: p.hull[1], wear, seed: 3 }),
    turret: makeArmourTexture({ base: p.turret[0], shade: p.turret[1], wear, seed: 11 }),
    barrel: makeMetalTexture({
      base: p.barrel[0], shade: p.barrel[1], grain: grain * 1.4, wear, repeat: [3, 1],
    }),
    // Tracks stay rubber: near-black, fine grain, glossy clearcoat sheen
    track: makeMetalTexture({
      base: '#1d1f24', shade: '#141619', grain: 1.6, wear: 0.6, repeat: [3, 3],
    }),
    tyre: makeMetalTexture({
      base: '#1a1c20', shade: '#121417', grain: 1.8, wear: 0.5, repeat: [5, 1],
    }),
    hub: makeHubTexture(),
  };
  textureCache.set(key, set);
  return set;
}

function materialsFor(p) {
  return rememberBaseColors(buildMaterials(p));
}

function buildMaterials(p) {
  const T = texturesFor(p);
  const hullTex = T.hull;
  const turretTex = T.turret;
  const barrelTex = T.barrel;
  const trackTex = T.track;
  const tyreTex = T.tyre;
  const hubTex = T.hub;

  return {
    hull: new THREE.MeshStandardMaterial({ map: hullTex, roughness: 0.62, metalness: 0.55 }),
    turret: new THREE.MeshStandardMaterial({ map: turretTex, roughness: 0.58, metalness: 0.58 }),
    barrel: new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.48, metalness: 0.68 }),
    track: new THREE.MeshPhysicalMaterial({
      map: trackTex, roughness: 0.55, metalness: 0.0,
      clearcoat: 0.7, clearcoatRoughness: 0.32,
    }),
    tyre: new THREE.MeshPhysicalMaterial({
      map: tyreTex, roughness: 0.6, metalness: 0.0,
      clearcoat: 0.6, clearcoatRoughness: 0.35,
    }),
    hub: new THREE.MeshStandardMaterial({ map: hubTex, roughness: 0.65, metalness: 0.35 }),
    // The parts a skin never colours: blackened steel, worked and polished.
    // These were a flat mid-grey at half metalness and read as plastic.
    metal: new THREE.MeshStandardMaterial({
      map: makeMetalTexture({
        base: '#141619', shade: '#0d0f11', grain: 2.2, wear: 1.4, repeat: [2, 2],
      }),
      color: '#ffffff', roughness: 0.34, metalness: 0.95,
    }),
    // ...and the inside of a gun barrel, which is darker still
    bore: new THREE.MeshStandardMaterial({
      color: '#08090b', roughness: 0.42, metalness: 0.9, side: THREE.DoubleSide,
    }),
    // An open-ended cylinder has no end caps and, with the default
    // single-sided material, no inner wall either — so looking into a muzzle
    // showed the world straight through the barrel. These two are the same
    // paint drawn on both faces, for exactly those tubes.
    barrelOpen: new THREE.MeshStandardMaterial({
      map: barrelTex, roughness: 0.48, metalness: 0.68, side: THREE.DoubleSide,
    }),
    metalOpen: new THREE.MeshStandardMaterial({
      color: '#2c3138', roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide,
    }),
    // cryo hardware keeps its own colour across every skin
    cryo: new THREE.MeshStandardMaterial({
      color: '#bfe6ff', emissive: '#4aa3e0', emissiveIntensity: 0.85,
      roughness: 0.35, metalness: 0.2,
    }),
    // ...as does the inferno's hot gear
    ember: new THREE.MeshStandardMaterial({
      color: '#ffb166', emissive: '#e04a10', emissiveIntensity: 0.9,
      roughness: 0.4, metalness: 0.25,
    }),
    // ...and the plasma turret's charged hardware
    plasma: new THREE.MeshStandardMaterial({
      color: '#8fd0ff', emissive: '#2a7bff', emissiveIntensity: 1.15,
      roughness: 0.3, metalness: 0.15,
    }),
    // ...a soft shell that sits around the charged parts and blooms as the
    // railgun winds up, so the glow spills into the air instead of stopping
    // dead at the surface of each ring
    plasmaGlow: new THREE.MeshBasicMaterial({
      color: '#5aa8ff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      toneMapped: false,
    }),
    // ...and the Aegis's brass emitter gear, which stays brass on every skin.
    // Textured like the rest of the steel so it reads as a cast, worked
    // component rather than a flat gold-coloured primitive.
    brass: new THREE.MeshStandardMaterial({
      map: makeMetalTexture({
        base: '#c9a752', shade: '#7d5f1e', grain: 1.5, wear: 1.6, repeat: [2, 2],
      }),
      roughness: 0.33,
      metalness: 0.92,
    }),
  };
}

// Remember each material's untinted colours so the freeze overlay can lerp
// toward ice and back without drift.
function rememberBaseColors(M) {
  for (const mat of Object.values(M)) {
    mat.userData.baseColor = mat.color.clone();
    if (mat.emissive) {
      mat.userData.baseEmissive = mat.emissive.clone();
      // the railgun's wind-up drives emissiveIntensity, so it needs a resting
      // value to scale from and fall back to
      mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
    }
  }
  return M;
}

// ---------------------------------------------------------------------------
// Hull — just the base armored body
// ---------------------------------------------------------------------------
// Extrude the hull's own side profile. The depth is chosen per hull so the
// sides stay clear of the tread chains' inner faces.
function buildHull(M, hull) {
  const s = new THREE.Shape();
  hull.profile.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(s, {
    depth: hull.depth,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 1,
  });
  hullGeo.translate(0, 0, -hull.depth / 2);

  const group = new THREE.Group();
  group.add(new THREE.Mesh(hullGeo, M.hull));

  // Bolt-on parts that give each hull its character. Every one is checked to
  // sit inside the hull's own width, clear of the turret ring, and below deck
  // level anywhere the gun can sweep.
  for (const d of hull.details) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(d.sx, d.sy, d.sz),
      d.mat === 'metal' ? M.metal : M.hull
    );
    mesh.position.set(d.x, d.y, d.z);
    if (d.rot) mesh.rotation.z = d.rot;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------------------
// Turret — base shape plus a pitching gun assembly
// ---------------------------------------------------------------------------
// Opens the end of a gun: the outer tube loses its end caps and a dark
// sleeve is dropped inside it, so you are looking down an actual hole rather
// than at a flat disc of barrel paint.
function borePipe(gun, M, { r, len, x, y = 0.02 }) {
  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len, 16, 1, true), M.bore
  );
  bore.rotation.z = -Math.PI / 2;
  bore.position.set(x, y, 0);
  gun.add(bore);
  // a plug well down the tube, so it does not read straight through
  const plug = new THREE.Mesh(new THREE.CircleGeometry(r, 16), M.bore);
  plug.rotation.y = -Math.PI / 2;
  plug.position.set(x - len / 2, y, 0);
  gun.add(plug);
  return bore;
}

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

  const barrelGeo = new THREE.CylinderGeometry(0.09, 0.085, 1.9, 16, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, M.barrelOpen);
  barrel.position.set(1.83, 0.02, 0);
  borePipe(gun, M, { r: 0.058, len: 1.6, x: 1.93 });
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

// ---------------------------------------------------------------------------
// Torrential Inferno: the Arctic Snap's opposite number. Heavier housing,
// an armoured fuel drum slung across the back, heat-shielded flanks, and a
// stubby wide-bore barrel ringed by igniter prongs around a pilot flame.
// ---------------------------------------------------------------------------
function buildInfernoTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  // housing: same faceted language, blunter and heavier than the cryo unit
  const profile = new THREE.Shape();
  profile.moveTo(-0.80, 0.0);
  profile.lineTo(0.66, 0.0);
  profile.lineTo(0.82, 0.22);
  profile.lineTo(0.54, 0.56);
  profile.lineTo(-0.40, 0.68);
  profile.lineTo(-0.84, 0.40);
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 1.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -0.6);
  const body = new THREE.Mesh(bodyGeo, M.turret);
  body.position.y = 0.08;
  t.add(body);

  // fuel drum lying across the back, banded and capped
  const drumGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.86, 18);
  const drum = new THREE.Mesh(drumGeo, M.metal);
  drum.position.set(-0.52, 0.62, 0);
  t.add(drum);
  const capGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.07, 18);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, M.ember);
    cap.position.set(-0.52, 0.62, side * 0.43);
    cap.rotation.x = Math.PI / 2;
    t.add(cap);
  }
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.06, 18), M.turret);
  band.position.set(-0.52, 0.62, 0);
  t.add(band);

  // heat shielding down the flanks
  const shieldGeo = new THREE.BoxGeometry(0.9, 0.34, 0.07);
  for (const side of [-1, 1]) {
    const shield = new THREE.Mesh(shieldGeo, M.turret);
    shield.position.set(0.12, 0.3, side * 0.63);
    shield.rotation.z = -0.06;
    t.add(shield);
  }

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.76, 0.36, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.72), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  // wide-bore barrel
  const boreGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.9, 12);
  boreGeo.rotateZ(Math.PI / 2);
  const bore = new THREE.Mesh(boreGeo, M.barrel);
  bore.position.set(0.55, 0.02, 0);
  gun.add(bore);

  // heat rings stepping down the barrel
  const ringGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.055, 12);
  ringGeo.rotateZ(Math.PI / 2);
  for (const x of [0.26, 0.58, 0.9]) {
    const ring = new THREE.Mesh(ringGeo, M.metal);
    ring.position.set(x, 0.02, 0);
    gun.add(ring);
  }

  // feed line from the drum
  const feedGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10);
  feedGeo.rotateZ(Math.PI / 2);
  const feed = new THREE.Mesh(feedGeo, M.ember);
  feed.position.set(0.3, -0.18, 0.16);
  gun.add(feed);

  // igniter prongs ringing the mouth
  const prongGeo = new THREE.BoxGeometry(0.28, 0.05, 0.05);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const prong = new THREE.Mesh(prongGeo, M.metal);
    prong.position.set(1.14, 0.02 + Math.cos(a) * 0.2, Math.sin(a) * 0.2);
    prong.rotation.x = a;
    gun.add(prong);
  }

  // pilot flame at the throat
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), M.ember);
  pilot.position.set(1.06, 0.02, 0);
  gun.add(pilot);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.32, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle };
}

// ---------------------------------------------------------------------------
// Dual Plasma: twin emitters set wide apart, fed from a charged accumulator
// sphere seated between them. A capacitor bank rides the roof, conduits run
// forward into acceleration coils, and each barrel ends in a focusing ring.
// ---------------------------------------------------------------------------
function buildPlasmaTurret(M) {
  const t = new THREE.Group();
  const SEP = 0.42; // horizontal separation of the two barrels

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  // faceted housing, wider than the cannon's to carry two barrels
  const profile = new THREE.Shape();
  profile.moveTo(-0.76, 0.0);
  profile.lineTo(0.64, 0.0);
  profile.lineTo(0.80, 0.19);
  profile.lineTo(0.56, 0.52);
  profile.lineTo(-0.42, 0.64);
  profile.lineTo(-0.80, 0.42);
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 1.34, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -0.67);
  const body = new THREE.Mesh(bodyGeo, M.turret);
  body.position.y = 0.08;
  t.add(body);

  // capacitor bank: four upright cylinders with glowing caps
  const canGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.26, 12);
  const capGeo = new THREE.CylinderGeometry(0.105, 0.105, 0.045, 12);
  for (const x of [-0.5, -0.24]) {
    for (const side of [-1, 1]) {
      const can = new THREE.Mesh(canGeo, M.metal);
      can.position.set(x, 0.76, side * 0.26);
      t.add(can);
      const cap = new THREE.Mesh(capGeo, M.plasma);
      cap.position.set(x, 0.91, side * 0.26);
      t.add(cap);
    }
  }
  // heat sink fins along the flanks
  const finGeo = new THREE.BoxGeometry(0.6, 0.18, 0.035);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(finGeo, M.metal);
      fin.position.set(-0.1, 0.24 + i * 0.12, side * (0.68 + 0.001 * i));
      t.add(fin);
    }
  }

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.78, 0.36, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.46, 1.06), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  // accumulator: the charged sphere the bolts are drawn from, seated in a
  // cradle between the barrels
  const accum = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 1), M.plasma);
  accum.position.set(0.16, 0.03, 0);
  gun.add(accum);
  const cradle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 16), M.metal);
  cradle.position.set(0.16, 0.03, 0);
  cradle.rotation.y = Math.PI / 2;
  gun.add(cradle);

  const muzzles = [];

  for (const side of [-1, 1]) {
    const z = side * SEP;

    // barrel
    const barrelGeo = new THREE.CylinderGeometry(0.088, 0.082, 1.26, 12, 1, true);
    barrelGeo.rotateZ(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, M.barrelOpen);
    barrel.position.set(0.68, 0.02, z);
    borePipe(gun, M, { r: 0.052, len: 1.05, x: 0.78, y: 0.02 }).position.z = z;
    gun.add(barrel);

    // acceleration coils stepping down the barrel, glowing brighter forward
    for (let i = 0; i < 4; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.125 - i * 0.008, 0.028, 8, 14),
        i > 1 ? M.plasma : M.metal
      );
      coil.position.set(0.36 + i * 0.26, 0.02, z);
      coil.rotation.y = Math.PI / 2;
      gun.add(coil);
    }

    // conduit from the accumulator into the breech
    const conduitGeo = new THREE.CylinderGeometry(0.045, 0.045, Math.abs(z) * 2, 8);
    conduitGeo.rotateX(Math.PI / 2);
    const conduit = new THREE.Mesh(conduitGeo, M.plasma);
    conduit.position.set(0.3, 0.02, z / 2);
    gun.add(conduit);

    // focusing ring at the mouth
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.032, 8, 18), M.metal);
    ring.position.set(1.3, 0.02, z);
    ring.rotation.y = Math.PI / 2;
    gun.add(ring);

    // the charged emitter core inside that ring
    const emitterGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.07, 12);
    emitterGeo.rotateZ(Math.PI / 2);
    const emitter = new THREE.Mesh(emitterGeo, M.plasma);
    emitter.position.set(1.3, 0.02, z);
    gun.add(emitter);

    // prongs guarding the mouth
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), M.metal);
      prong.position.set(1.4, 0.02 + Math.cos(a) * 0.12, z + Math.sin(a) * 0.12);
      prong.rotation.x = a;
      gun.add(prong);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(1.48, 0.02, z);
    gun.add(muzzle);
    muzzles.push(muzzle);
  }

  // muzzle stays the centre reference (smoke, beams); muzzles[] is what fires
  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.48, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle, muzzles };
}

// ---------------------------------------------------------------------------
// Aegis Emitter: a squat emitter body carrying two heavy prongs SIDE BY SIDE
// on a wide brass yoke. The working end is the gap between their tips, where
// a permanent arc jumps across — yellow at rest, red or green once it has
// hold of someone.
// ---------------------------------------------------------------------------
// gapZ, not gapY: the prongs sit left and right of the barrel line rather
// than stacked one above the other, and they are set four times as far apart
// as they were. The arc that bridges them is scaled to match (see arc.js).
//
// The horizontal layout also fixes the arc itself. createProngArc builds its
// ribbon by offsetting each path point +/- w in Y — with the tips stacked
// vertically that offset ran ALONG the arc, collapsing every quad to a
// sliver. Across a horizontal gap the same offset is perpendicular, so the
// ribbon has real area for the first time.
export const AEGIS_PRONG = { gapZ: 1.20, x: 1.62 };

function buildAegisTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  const profile = new THREE.Shape();
  profile.moveTo(-0.74, 0.0);
  profile.lineTo(0.62, 0.0);
  profile.lineTo(0.78, 0.18);
  profile.lineTo(0.52, 0.52);
  profile.lineTo(-0.40, 0.62);
  profile.lineTo(-0.78, 0.40);
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 1.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -0.58);
  const body = new THREE.Mesh(bodyGeo, M.turret);
  body.position.y = 0.08;
  t.add(body);

  // Brass feed lines running forward along each flank to the yoke. The
  // insulator stacks and glowing terminal spheres that used to stand on the
  // roof are gone — the deck is clean now.
  for (const side of [-1, 1]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.15, 10), M.brass);
    cable.rotation.z = Math.PI / 2;
    cable.position.set(0.34, 0.40, side * 0.44);
    t.add(cable);
    // a collar where each line leaves the body
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.09, 10), M.brass);
    ferrule.rotation.z = Math.PI / 2;
    ferrule.position.set(-0.16, 0.40, side * 0.44);
    t.add(ferrule);
  }

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.74, 0.36, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.46, 0.70), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  const half = AEGIS_PRONG.gapZ / 2;

  // emitter block, and the wide brass yoke that carries the prongs out to
  // their full spread
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.44, 0.62), M.barrel);
  block.position.set(0.32, 0.02, 0);
  gun.add(block);

  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, half * 2 + 0.22), M.brass);
  yoke.position.set(0.54, 0.02, 0);
  gun.add(yoke);

  // two thick prongs reaching forward, one either side, with the working gap
  // between their tips
  for (const dir of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.17, 0.21), M.barrel);
    arm.position.set(1.06, 0.02, dir * (half - 0.04));
    arm.rotation.y = -dir * 0.078; // a slight splay out toward the tips
    gun.add(arm);

    // a heavier root where each prong leaves the yoke
    const root = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), M.barrel);
    root.position.set(0.62, 0.02, dir * (half - 0.08));
    gun.add(root);

    // banded insulation along the prong
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.21, 0.25), M.metal);
      band.position.set(0.78 + i * 0.26, 0.02, dir * (half - 0.062 + i * 0.021));
      gun.add(band);
    }

    // the charged tip the arc springs from
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 12), M.brass);
    tip.position.set(AEGIS_PRONG.x, 0.02, dir * half);
    gun.add(tip);

    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 12), M.brass);
    cone.rotation.z = -Math.PI / 2;
    cone.position.set(AEGIS_PRONG.x - 0.17, 0.02, dir * half);
    gun.add(cone);
  }

  // the arc between the tips is created by the game and parented here
  const arcAnchor = new THREE.Object3D();
  gun.add(arcAnchor);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(AEGIS_PRONG.x + 0.1, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle, arcAnchor, prongGap: AEGIS_PRONG };
}

function buildRailgunTurret(M) {
  const t = new THREE.Group();
  const charge = []; // parts the wind-up animates

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  // tall pedestal: this turret sits high
  const pedGeo = new THREE.CylinderGeometry(0.46, 0.58, 0.52, 12);
  const pedestal = new THREE.Mesh(pedGeo, M.turret);
  pedestal.position.set(-0.06, 0.32, 0);
  t.add(pedestal);

  const profile = new THREE.Shape();
  profile.moveTo(-0.66, 0.0);
  profile.lineTo(0.54, 0.0);
  profile.lineTo(0.70, 0.20);
  profile.lineTo(0.46, 0.56);
  profile.lineTo(-0.38, 0.66);
  profile.lineTo(-0.70, 0.44);
  profile.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(profile, {
    depth: 1.00, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
  });
  bodyGeo.translate(0, 0, -0.50);
  const body = new THREE.Mesh(bodyGeo, M.turret);
  body.position.set(-0.06, 0.56, 0);
  t.add(body);

  // capacitor towers either side of the breech
  for (const side of [-1, 1]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 12), M.metal);
    tower.position.set(-0.34, 0.96, side * 0.42);
    t.add(tower);
    for (let i = 0; i < 3; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.026, 8, 16), M.plasma);
      band.position.set(-0.34, 0.78 + i * 0.18, side * 0.42);
      band.rotation.x = Math.PI / 2;
      t.add(band);
      charge.push(band);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 10), M.plasma);
    cap.position.set(-0.34, 1.30, side * 0.42);
    t.add(cap);
    charge.push(cap);
  }

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.52, 1.02, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.66), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  // breech block
  const breech = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), M.barrel);
  breech.position.set(0.34, 0.02, 0);
  gun.add(breech);

  // twin rails running the length of the barrel
  for (const side of [-1, 1]) {
    const railGeo = new THREE.BoxGeometry(2.9, 0.075, 0.075);
    const rail = new THREE.Mesh(railGeo, M.metal);
    rail.position.set(1.9, 0.02, side * 0.115);
    gun.add(rail);
  }

  // the channel the slug rides down, open at the muzzle
  borePipe(gun, M, { r: 0.088, len: 2.7, x: 2.0 });

  // accelerator rings threaded along the rails
  for (let i = 0; i < 9; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.028, 8, 16), i % 2 ? M.plasma : M.metal);
    ring.position.set(0.72 + i * 0.32, 0.02, 0);
    ring.rotation.y = Math.PI / 2;
    gun.add(ring);
    if (i % 2) charge.push(ring);
  }

  // a shroud over the rear half of the barrel
  const shroudGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 10);
  shroudGeo.rotateZ(Math.PI / 2);
  const shroud = new THREE.Mesh(shroudGeo, M.barrel);
  shroud.position.set(1.1, 0.02, 0);
  gun.add(shroud);

  // muzzle brake at the very end of a long barrel
  const brakeGeo = new THREE.CylinderGeometry(0.17, 0.13, 0.3, 10);
  brakeGeo.rotateZ(Math.PI / 2);
  const brake = new THREE.Mesh(brakeGeo, M.metal);
  brake.position.set(3.4, 0.02, 0);
  gun.add(brake);

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), M.plasma);
  core.position.set(3.4, 0.02, 0);
  gun.add(core);
  charge.push(core);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(3.6, 0.02, 0);
  gun.add(muzzle);

  // A translucent shell around each charged part: the same geometry blown up
  // a little and drawn back-face-first with additive blending, so the glow
  // reads as light in the air around the hardware rather than as a bigger
  // solid object.
  const chargeGlow = [];
  for (const part of charge) {
    const halo = new THREE.Mesh(part.geometry, M.plasmaGlow);
    halo.scale.setScalar(1.35);
    halo.renderOrder = 3;
    part.add(halo);
    chargeGlow.push(halo);
  }

  return { turret: t, pitchGroup, gun, muzzle, chargeParts: charge, chargeGlow };
}

// Thunderbolt: a squat, heavily braced gun with an induction coil stack
// wrapped round the breech. Short barrel, big muzzle brake — it is built to
// throw one very large round rather than many small ones.
// Flechette: a short, very wide bore over a drum, built to dump a cone of
// darts at close range rather than reach anything.
function buildFlechetteTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.46, 1.1), M.turret);
  body.position.set(0.0, 0.34, 0);
  t.add(body);

  // the drum the darts feed from, lying on its side across the breech
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.52, 20), M.metal);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(-0.34, 0.55, 0);
  t.add(drum);
  for (let i = 0; i < 8; i++) {
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.56), M.barrel);
    const a = (i / 8) * Math.PI * 2;
    lug.position.set(-0.34 + Math.cos(a) * 0.3, 0.55 + Math.sin(a) * 0.3, 0);
    lug.rotation.z = a;
    t.add(lug);
  }

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.66, 0.36, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.48, 0.66), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  // short and fat, opening out toward the muzzle
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.15, 1.0, 16, 1, true), M.barrelOpen
  );
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(0.56, 0.02, 0);
  gun.add(barrel);
  borePipe(gun, M, { r: 0.155, len: 0.9, x: 0.62 });

  // a flared choke, slotted round the rim
  const choke = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.2, 16, 1, true), M.metalOpen);
  choke.rotation.z = -Math.PI / 2;
  choke.position.set(1.12, 0.02, 0);
  gun.add(choke);
  for (let i = 0; i < 6; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), M.barrel);
    const a = (i / 6) * Math.PI * 2;
    slot.position.set(1.12, 0.02 + Math.sin(a) * 0.24, Math.cos(a) * 0.24);
    gun.add(slot);
  }

  // heat shroud over the top of the tube
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.34), M.metal);
  shroud.position.set(0.6, 0.22, 0);
  gun.add(shroud);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.3, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle };
}

function buildThunderTurret(M) {
  const t = new THREE.Group();

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.74, 0.12, 24), M.metal);
  collar.position.y = 0.06;
  t.add(collar);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.5, 1.22), M.turret);
  body.position.set(0.02, 0.35, 0);
  t.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.22, 0.98), M.turret);
  roof.position.set(-0.06, 0.68, 0);
  t.add(roof);

  // bracing ribs down each flank
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.08), M.metal);
      rib.position.set(-0.42 + i * 0.42, 0.36, side * 0.63);
      t.add(rib);
    }
  }

  // induction coils round the breech, banded in brass
  const coilGeo = new THREE.TorusGeometry(0.3, 0.055, 8, 20);
  for (let i = 0; i < 3; i++) {
    const coil = new THREE.Mesh(coilGeo, M.brass);
    coil.rotation.y = Math.PI / 2;
    coil.position.set(0.42 + i * 0.2, 0.38, 0);
    t.add(coil);
  }

  // spent-case hatch on the rear deck
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.34), M.metal);
  hatch.position.set(-0.5, 0.8, 0.18);
  t.add(hatch);

  const pitchGroup = new THREE.Group();
  pitchGroup.position.set(0.72, 0.38, 0);
  t.add(pitchGroup);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.54, 0.78), M.turret);
  pitchGroup.add(mantlet);

  const gun = new THREE.Group();
  pitchGroup.add(gun);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.72, 16, 1, true), M.barrelOpen);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(0.9, 0.02, 0);
  borePipe(gun, M, { r: 0.088, len: 1.55, x: 1.02 });
  gun.add(barrel);

  // heavy muzzle brake: a cuff with two vents cut either side
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 16), M.metal);
  brake.rotation.z = -Math.PI / 2;
  brake.position.set(1.82, 0.02, 0);
  gun.add(brake);
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), M.barrel);
    vent.position.set(1.82, 0.02, side * 0.19);
    gun.add(vent);
  }

  // a collar partway along, where the recuperator sits
  const collar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 16), M.metal);
  collar2.rotation.z = -Math.PI / 2;
  collar2.position.set(0.42, 0.02, 0);
  gun.add(collar2);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(2.02, 0.02, 0);
  gun.add(muzzle);

  return { turret: t, pitchGroup, gun, muzzle };
}

function buildTurret(M, kind) {
  if (kind === 'arctic') return buildArcticTurret(M);
  if (kind === 'inferno') return buildInfernoTurret(M);
  if (kind === 'plasma') return buildPlasmaTurret(M);
  if (kind === 'aegis') return buildAegisTurret(M);
  if (kind === 'railgun') return buildRailgunTurret(M);
  if (kind === 'thunder') return buildThunderTurret(M);
  if (kind === 'flechette') return buildFlechetteTurret(M);
  return buildCannonTurret(M);
}

// ---------------------------------------------------------------------------
// Treads: running gear + instanced link chain
// ---------------------------------------------------------------------------
function buildLinkGeometry(TR) {
  const L = TR.linkLen / 2;
  const T = TR.linkHalfT;
  const G = TR.grouserH;

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

  const geo = new THREE.ExtrudeGeometry(s, { depth: TR.linkW, bevelEnabled: false });
  geo.translate(0, 0, -TR.linkW / 2);
  return geo;
}

function buildTread(M, side, hull) {
  const TR = hull.tread;
  const g = new THREE.Group();
  g.position.z = side * TR.z;

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

  const roadY = TR.bottomY + TR.linkHalfT + TR.roadR;
  for (const x of TR.roadWheels) {
    addWheel(TR.roadR, TR.roadW, x, roadY, tyreMats);
  }

  addWheel(TR.endR, TR.endW, TR.runHalf, TR.centerY, tyreMats); // idler
  const sprocket = addWheel(TR.endR, TR.sprocketW, -TR.runHalf, TR.centerY, tyreMats);

  const toothR = TR.endR * 1.15;
  const toothGeo = new THREE.BoxGeometry(0.1, 0.075, TR.sprocketW * 1.05);
  for (let i = 0; i < TR.teeth; i++) {
    const a = (i / TR.teeth) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, M.metal);
    tooth.position.set(Math.cos(a) * toothR, Math.sin(a) * toothR, 0);
    tooth.rotation.z = a;
    sprocket.add(tooth);
  }

  for (const x of TR.rollers) {
    addWheel(TR.rollerR, TR.rollerW, x, TR.topY - TR.linkHalfT - TR.rollerR, rollerMats, 14);
  }

  const armGeo = new THREE.BoxGeometry(0.4, 0.09, 0.09);
  for (const x of TR.roadWheels) {
    const arm = new THREE.Mesh(armGeo, M.metal);
    arm.position.set(x - 0.16, TR.centerY, -side * (TR.linkW * 0.46));
    arm.rotation.z = -0.5;
    g.add(arm);
  }

  const links = new THREE.InstancedMesh(buildLinkGeometry(TR), M.track, TR.linkCount);
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  links.castShadow = true;
  links.frustumCulled = false;
  g.add(links);

  return { group: g, spin, links, tread: TR, offset: side * TR.runHalf };
}

const _dummy = new THREE.Object3D();

function updateTread(tread, dt, speed) {
  const TR = tread.tread;
  tread.offset += speed * dt;

  const pitch = TR.length / TR.linkCount;
  for (let i = 0; i < TR.linkCount; i++) {
    const p = pathPoint(TR, i * pitch + tread.offset);
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
export function createTankModel(palette = SKINS[0], turretId = 'cannon', hullId = DEFAULT_HULL) {
  let M = materialsFor(palette);
  let skinId = palette && palette.id ? palette.id : 'custom';
  const root = new THREE.Group();
  let hull = hullSpec(hullId);
  let hullMesh = null;
  let treadL = null;
  let treadR = null;

  function buildChassis() {
    hullMesh = buildHull(M, hull);
    treadL = buildTread(M, -1, hull);
    treadR = buildTread(M, 1, hull);
    root.add(hullMesh, treadL.group, treadR.group);
    // Lay the link chains out immediately — a tank that never drives would
    // otherwise render its wheels with no tracks
    updateTread(treadL, 0, 0);
    updateTread(treadR, 0, 0);
  }

  function disposeChassis() {
    for (const part of [hullMesh, treadL.group, treadR.group]) {
      root.remove(part);
      part.traverse((o) => {
        if (o.isMesh && !o.userData.fx) o.geometry.dispose();
      });
    }
  }

  buildChassis();

  let beam = null;
  let streaming = false;

  function attachTurret(kind) {
    const built = buildTurret(M, kind);
    built.turret.position.set(hull.turretX, hull.deckY, 0);
    root.add(built.turret);
    const spec = TURRET_SPECS[kind];
    if (spec && spec.mode === 'stream') {
      beam = createStreamBeam(spec.element);
      // effect meshes must never be repainted by skins or the husk swap
      beam.group.traverse((o) => { o.userData.fx = true; });
      built.muzzle.add(beam.group);
    }
    return built;
  }

  let parts = attachTurret(turretId);
  const parts_ = {
    get chargeParts() { return parts.chargeParts; },
    get chargeGlow() { return parts.chargeGlow; },
  };
  const { turret, pitchGroup, gun, muzzle } = parts;
  let nextMuzzle = 0;

  // Tag every mesh with the material role it was built from, so skins and the
  // freeze overlay can repaint without rebuilding any geometry.
  const meshes = [];
  function collectMeshes() {
    const roleOf = new Map([
      [M.hull, 'hull'], [M.turret, 'turret'], [M.barrel, 'barrel'],
      [M.track, 'track'], [M.metal, 'metal'], [M.tyre, 'tyre'],
      [M.hub, 'hub'], [M.cryo, 'cryo'], [M.ember, 'ember'], [M.plasma, 'plasma'],
      [M.brass, 'brass'], [M.plasmaGlow, 'plasmaGlow'], [M.bore, 'bore'],
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

  // Drop the material objects but NOT their maps: those live in the shared
  // texture cache and other tanks are still drawing with them. Disposing a
  // cached map here would blank every tank wearing that skin.
  function disposeMaterials(set) {
    for (const mat of Object.values(set)) mat.dispose();
  }

  let charred = false;
  let chill = 0;
  let burn = 0;

    const ICE = new THREE.Color('#7fc4ff');
  const ICE_GLOW = new THREE.Color('#2f79c8');
  const FIRE = new THREE.Color('#ff5436');
  const FIRE_GLOW = new THREE.Color('#c22006');

  // Frost and fire can both be on a tank at once; the stronger one leads.
  function applyStatusTint() {
    for (const mat of Object.values(M)) {
      const base = mat.userData.baseColor;
      if (!base) continue;
      mat.color.copy(base).lerp(ICE, 0.62 * chill).lerp(FIRE, 0.62 * burn);
      if (mat.emissive && mat.userData.baseEmissive) {
        mat.emissive
          .copy(mat.userData.baseEmissive)
          .lerp(ICE_GLOW, 0.75 * chill)
          .lerp(FIRE_GLOW, 0.75 * burn);
        if (mat.userData.baseEmissive.getHex() === 0) {
          mat.emissiveIntensity = 0.55 * Math.max(chill, burn);
        }
      }
    }
  }
  const applyChillTint = applyStatusTint;

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
    muzzles: parts.muzzles || null,
    get arcAnchor() { return parts.arcAnchor || null; },
    get prongGap() { return parts.prongGap || null; },
    turretId,
    hull,
    hullId: hull.id,
    // Multi-barrel turrets take it in turns; single-barrel ones always
    // return the one muzzle they have.
    nextMuzzle() {
      if (!this.muzzles || !this.muzzles.length) return this.muzzle;
      const m = this.muzzles[nextMuzzle % this.muzzles.length];
      nextMuzzle++;
      return m;
    },
    resetMuzzleCycle() {
      nextMuzzle = 0;
    },
    updateTreads(dt, sL, sR) {
      updateTread(treadL, dt, sL);
      updateTread(treadR, dt, sR);
    },
    get maxHp() { return hull.maxHp; },
    get move() { return hull.move; },
    get chassis() { return hull.chassis; },
    setCharred(flag) {
      charred = flag;
      if (flag) {
        chill = 0;
        burn = 0;
        applyStatusTint();
        streaming = false;
      }
      for (const [mesh, role] of meshes) {
        mesh.material = flag ? charredMat : materialFor(role);
      }
    },
    // Repaint the whole tank from a skin definition, in place
    setSkin(skin) {
      // Re-applying the skin already on the tank rebuilt every material for
      // nothing — and the garage did exactly that on every entry.
      const key = skin && skin.id ? skin.id : 'custom';
      if (key === skinId) return;
      skinId = key;
      // Textures are cached, so this is a pointer swap rather than paint.
      // Nothing is disposed: the set stays in the cache for the next time
      // this skin is chosen, which is what makes flicking through them
      // instant after the first look at each.
      const old = M;
      M = materialsFor(skin);
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
      this.muzzles = parts.muzzles || null;
      this.turretId = kind;
      nextMuzzle = 0;
      streaming = false;
      collectMeshes();
      if (charred) {
        for (const [mesh, role] of meshes) mesh.material = charredMat;
      }
      applyChillTint();
    },
    // 0 = idle, 1 = fully wound up. The charged parts brighten as the shot
    // builds — they used to physically swell (scale 1 -> 1.45), which read as
    // the hardware inflating rather than as energy going into it.
    //
    // Driving the shared plasma material is safe and cheap: M.plasma is only
    // ever used by turret hardware, and on the railgun every part built from
    // it is a charge part, so nothing else on the tank can be caught by the
    // brightening. Doing it with an added PointLight would look better still
    // but would change the scene's light count, and three.js recompiles every
    // shader when that happens — with a dozen railguns in a lobby that is a
    // hitch per spawn.
    setCharge(frac) {
      const mat = M.plasma;
      const parts = parts_.chargeParts;
      const f = Math.max(0, Math.min(1, frac));
      if (mat) {
        const base = mat.userData.baseEmissiveIntensity;
        if (base !== undefined) {
          // ramps hard at the top so the last quarter second really lights up
          // Brighter, not whiter: the emissive COLOUR is left alone so the
          // accents keep their blue all the way up, and only the intensity
          // climbs. Washing them toward white read as the parts turning grey.
          mat.emissiveIntensity = base * (1 + 16 * f * f);
        }
      }
      // the halo blooms with the charge
      const glow = parts_.chargeGlow;
      if (glow) {
        const gm = M.plasmaGlow;
        if (gm) gm.opacity = 0.62 * f * f;
        for (let i = 0; i < glow.length; i++) glow[i].scale.setScalar(1.35 + 0.55 * f);
      }
      if (!parts) return;
      // the rings still turn as it winds; only the swelling is gone
      for (let i = 0; i < parts.length; i++) {
        parts[i].rotation.z += f * 0.42;
      }
    },
    // 0 = normal, 1 = fully frozen (blue overlay) / fully alight (red overlay)
    setStatus(chillAmount, burnAmount) {
      const c = Math.max(0, Math.min(1, chillAmount || 0));
      const b = Math.max(0, Math.min(1, burnAmount || 0));
      if (Math.abs(c - chill) < 0.002 && Math.abs(b - burn) < 0.002) return;
      chill = c;
      burn = b;
      applyStatusTint();
    },
    setChill(amount) {
      this.setStatus(amount, burn);
    },
    getChill: () => chill,
    getBurn: () => burn,
    hasStream: () => !!beam,
    setStream(on) {
      streaming = !!on && !!beam;
    },
    // How far the stream may pour before something solid stops it. The game
    // works this out with a ray each frame and hands it down.
    setStreamReach(d) {
      if (beam && beam.setReach) beam.setReach(d);
    },
    updateStream(dt) {
      if (beam) beam.update(dt, streaming && !charred);
    },
    // Accurate two-box hit test: hull+treads in root space (follows ground
    // pitch/roll), turret in turret space (follows traverse).
    hitTest(worldPoint) {
      const H = hull.hit;
      _hb.copy(worldPoint);
      root.worldToLocal(_hb);
      if (
        Math.abs(_hb.x) < H.bodyX &&
        Math.abs(_hb.z) < H.bodyZ &&
        _hb.y > H.bodyY0 && _hb.y < H.bodyY1
      ) return true;

      _hb.copy(worldPoint);
      this.turret.worldToLocal(_hb);
      return (
        _hb.x > H.turretX0 && _hb.x < H.turretX1 &&
        Math.abs(_hb.z) < H.turretZ &&
        _hb.y > H.turretY0 && _hb.y < H.turretY1
      );
    },
    // Swap the chassis, keeping the turret. Everything dimensional — treads,
    // hit boxes, physics box, top speed, hull points — comes with it.
    setHull(id) {
      const next = hullSpec(id);
      if (next === hull) return;
      disposeChassis();
      hull = next;
      buildChassis();
      this.hull = hull;
      this.hullId = hull.id;
      this.turret.position.set(hull.turretX, hull.deckY, 0);
      collectMeshes();
      if (charred) {
        for (const [mesh] of meshes) mesh.material = charredMat;
      }
      applyStatusTint();
    },
  };
}
