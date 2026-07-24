// Rigid-body physics on cannon-es. The local tank is a dynamic box that can
// tip, tumble, and land upside down; remote tanks are kinematic boxes the
// local chassis collides with; the arena is static geometry matching map.js.
import * as CANNON from 'cannon-es';
import { ARENA, PLATFORM } from './map.js';

export const GROUP_STATIC = 1;
export const GROUP_LOCAL = 2;
export const GROUP_REMOTE = 4;

// Chassis box roughly hull + treads. The shape sits high relative to the
// body origin so the center of mass rides low — stable, but flippable.
// Chassis dimensions now come from the equipped hull (see HULLS in tank.js),
// which derives them from its own model so collision can't drift from the
// geometry. These stay as the Vanguard fallback for any older call site.
export const CHASSIS = {
  hx: 2.41,
  hy: 0.5825,
  hz: 1.49,
  shapeOffY: 0.0932,
};
export const MODEL_OFF_Y = CHASSIS.shapeOffY - CHASSIS.hy;

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -24, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  const groundMat = new CANNON.Material('ground');
  const chassisMat = new CANNON.Material('chassis');
  // Traction is handled ENTIRELY by the controller: it sets forward speed,
  // kills lateral slip, holds slopes, and scrubs off speed when nobody is
  // driving. Solver friction here must therefore be exactly zero, not merely
  // small, for two reasons:
  //
  //  1. cannon-es clamps a friction equation's lambda against `maxForce`
  //     directly, and maxForce = mu * |g| * reducedMass. That is an IMPULSE
  //     limit that does not scale with dt, so each contact point could erase
  //     mu * |g| = 1.44 m/s per step at mu=0.06 — six times what the throttle
  //     adds in the same step. The tank could never build speed.
  //  2. Worse, that friction is applied at the tread patch, 0.52 m BELOW the
  //     centre of mass, while the controller's drive correction is applied at
  //     the centre of mass. The pair forms a couple that pitches the nose down
  //     a little more every frame; once the nose dug in, the solver's
  //     penetration recovery kicked the hull up and the tank somersaulted.
  //
  // Zero here means the ONLY thing moving the chassis along the ground is the
  // controller, which is the whole design. See player.js.
  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, chassisMat, {
      friction: 0,
      restitution: 0.0,
    })
  );

  function addStaticBox(hx, hy, hz, pos, quat) {
    const body = new CANNON.Body({
      mass: 0,
      material: groundMat,
      collisionFilterGroup: GROUP_STATIC,
      collisionFilterMask: GROUP_LOCAL,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    body.position.copy(pos);
    if (quat) body.quaternion.copy(quat);
    world.addBody(body);
    return body;
  }

  // ---- arena colliders (mirror the visuals in map.js) ----------------------
  // The floor is universal (the editor's flat ground uses it too); the
  // platform, ramps, and walls only exist while the arena is active.
  const arenaBodies = [];
  const arenaBox = (...args) => arenaBodies.push(addStaticBox(...args));

  addStaticBox(120, 1, 120, new CANNON.Vec3(0, -1, 0)); // floor, permanent
  arenaBox(PLATFORM.half, PLATFORM.h / 2, PLATFORM.half, new CANNON.Vec3(0, PLATFORM.h / 2, 0));

  // ramps: a rotated box whose top face lies exactly on the incline plane,
  // extended a bit past both ends to seal the seams
  {
    const theta = Math.atan2(PLATFORM.h, PLATFORM.rampLen); // slope angle
    const hyp = Math.hypot(PLATFORM.h, PLATFORM.rampLen);
    const ext = 0.7; // extend past the BOTTOM only — the top must not rise
    const halfLen = (hyp + ext) / 2; // above the crest (invisible lip bug)
    const halfT = 0.4;
    // slab top face runs from the crest exactly, down past the ground line
    const dX = Math.cos(theta); // downhill direction along the incline
    const dY = -Math.sin(theta);
    const nx = Math.sin(theta);
    const ny = Math.cos(theta);
    const cLocalX = PLATFORM.half + dX * halfLen - nx * halfT;
    const cY = PLATFORM.h + dY * halfLen - ny * halfT;

    const zAxis = new CANNON.Vec3(0, 0, 1);
    const yAxis = new CANNON.Vec3(0, 1, 0);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const qYaw = new CANNON.Quaternion().setFromAxisAngle(yAxis, a);
      const qTilt = new CANNON.Quaternion().setFromAxisAngle(zAxis, -theta);
      const q = qYaw.mult(qTilt);
      const pos = new CANNON.Vec3(
        Math.cos(a) * cLocalX,
        cY,
        -Math.sin(a) * cLocalX
      );
      arenaBox(halfLen, halfT, PLATFORM.rampHalfW, pos, q);
    }
  }

  // perimeter walls
  {
    const t = 1.2;
    const h = 3;
    const off = ARENA.half + t;
    arenaBox(ARENA.half + t * 2, h, t, new CANNON.Vec3(0, h, -off));
    arenaBox(ARENA.half + t * 2, h, t, new CANNON.Vec3(0, h, off));
    arenaBox(t, h, ARENA.half + t * 2, new CANNON.Vec3(-off, h, 0));
    arenaBox(t, h, ARENA.half + t * 2, new CANNON.Vec3(off, h, 0));
  }

  // ---- tank bodies ---------------------------------------------------------
  function boxFor(dims) {
    const d = dims || CHASSIS;
    return {
      shape: new CANNON.Box(new CANNON.Vec3(d.hx, d.hy, d.hz)),
      offY: d.shapeOffY,
    };
  }

  function createChassis(dims) {
    const body = new CANNON.Body({
      mass: 6,
      material: chassisMat,
      collisionFilterGroup: GROUP_LOCAL,
      collisionFilterMask: GROUP_STATIC | GROUP_REMOTE,
      linearDamping: 0.03,
      angularDamping: 0.35,
      allowSleep: false,
    });
    const b = boxFor(dims);
    body.addShape(b.shape, new CANNON.Vec3(0, b.offY, 0));
    world.addBody(body);
    return body;
  }

  function createRemoteBody(dims) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      collisionFilterGroup: GROUP_REMOTE,
      collisionFilterMask: GROUP_LOCAL,
    });
    const b = boxFor(dims);
    body.addShape(b.shape, new CANNON.Vec3(0, b.offY, 0));
    world.addBody(body);
    return body;
  }

  // Replace a body's collision box in place — used when a hull is swapped.
  function reshapeBody(body, dims) {
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    const b = boxFor(dims);
    body.addShape(b.shape, new CANNON.Vec3(0, b.offY, 0));
    body.updateMassProperties();
  }

  function removeBody(body) {
    world.removeBody(body);
  }

  // ---- grounded test -------------------------------------------------------
  // Contacts from the solver are the authoritative answer: if the chassis is
  // resting on anything with a roughly upward normal, it's on the ground. A
  // downward ray is only a backup for the frame after a teleport, when no
  // contact has been generated yet. (A lone ray used to be the only test —
  // one missed frame silently cut all drive force and froze the tank.)
  const _ray = new CANNON.Ray();
  const _rayResult = new CANNON.RaycastResult();

  function contactGrounded(body) {
    for (const c of world.contacts) {
      if (c.bi === body) {
        if (c.ni.y < -0.4) return true; // normal points body -> ground
      } else if (c.bj === body) {
        if (c.ni.y > 0.4) return true; // normal points ground -> body
      }
    }
    return false;
  }

  function rayHits(x, y, z, reach) {
    _ray.from.set(x, y, z);
    _ray.to.set(x, y - reach, z);
    _rayResult.reset();
    _ray.intersectWorld(world, {
      mode: CANNON.Ray.CLOSEST,
      result: _rayResult,
      skipBackfaces: true,
      collisionFilterMask: GROUP_STATIC | GROUP_REMOTE,
    });
    return _rayResult.hasHit;
  }

  function groundedAt(pos, reach, body) {
    if (body && contactGrounded(body)) return true;
    // start the probe just inside the hull so a resting tank always registers
    const y = pos.y + 0.25;
    const r = reach + 0.25;
    return (
      rayHits(pos.x, y, pos.z, r) ||
      rayHits(pos.x + 1.4, y, pos.z, r) ||
      rayHits(pos.x - 1.4, y, pos.z, r) ||
      rayHits(pos.x, y, pos.z + 1.0, r) ||
      rayHits(pos.x, y, pos.z - 1.0, r)
    );
  }

  let arenaActive = true;
  function setArenaActive(on) {
    if (on === arenaActive) return;
    arenaActive = on;
    for (const b of arenaBodies) {
      if (on) world.addBody(b);
      else world.removeBody(b);
    }
  }

  function addBody(body) {
    world.addBody(body);
  }

  function step(dt) {
    world.step(1 / 60, dt, 4);
  }

  return {
    world, createChassis, createRemoteBody, reshapeBody, removeBody, addBody,
    addStaticBox, setArenaActive, groundedAt, step,
  };
}
