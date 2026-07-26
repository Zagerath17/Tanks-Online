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

// Fixed simulation step. Everything below is tuned for this rate; running the
// solver at whatever the display happens to manage makes contact behaviour
// frame-rate dependent, which is the usual reason a tank that rests quietly at
// 144 fps jitters at 30.
const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 8;

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -24, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  // Solver quality. The default 10 iterations leaves a hull resting on several
  // contacts visibly working against itself; 18 with a tighter tolerance
  // settles it. This is cheap here because there are only ever a handful of
  // dynamic bodies in the world.
  world.solver.iterations = 18;
  world.solver.tolerance = 0.0005;

  // Contact softness. Stiff-but-relaxed keeps a tank sitting still on a slope
  // without the shivering that a stiffer, less relaxed contact produces, and
  // stops shallow penetrations being answered with a shove.
  world.defaultContactMaterial.contactEquationStiffness = 5e6;
  world.defaultContactMaterial.contactEquationRelaxation = 4;
  world.defaultContactMaterial.frictionEquationStiffness = 5e6;
  world.defaultContactMaterial.frictionEquationRelaxation = 4;

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
      contactEquationStiffness: 5e6,
      contactEquationRelaxation: 4,
    })
  );

  // Tank against tank is a different problem from tank against ground: here
  // friction SHOULD exist, or hulls slide off each other like wet soap, and
  // there must be no bounce at all. Without an explicit pairing these contacts
  // fell through to the world default, which is neither of those things.
  const remoteMat = new CANNON.Material('remote');
  world.addContactMaterial(
    new CANNON.ContactMaterial(chassisMat, remoteMat, {
      friction: 0.45,
      restitution: 0.0,
      contactEquationStiffness: 4e6,
      contactEquationRelaxation: 4,
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
      // The hull's own mass, derived from its chassis volume — see tank.js.
      // Every tank used to weigh exactly 6 regardless of size.
      mass: (dims && dims.mass) || 6,
      material: chassisMat,
      collisionFilterGroup: GROUP_LOCAL,
      collisionFilterMask: GROUP_STATIC | GROUP_REMOTE,
      linearDamping: 0.02,
      angularDamping: 0.32,
      allowSleep: false,
      // stops a resting hull creeping on a slope from solver noise
      sleepSpeedLimit: 0.08,
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
      material: remoteMat,
      collisionFilterGroup: GROUP_REMOTE,
      collisionFilterMask: GROUP_LOCAL,
    });
    const b = boxFor(dims);
    body.addShape(b.shape, new CANNON.Vec3(0, b.offY, 0));
    world.addBody(body);
    return body;
  }

  // Replace a body's collision box in place — used when a hull is swapped.
  // Swapping a hull changes its mass as well as its size; setting the shape
  // alone left an Ironclad with a Falcon's weight.
  function reshapeBody(body, dims) {
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    const b = boxFor(dims);
    body.addShape(b.shape, new CANNON.Vec3(0, b.offY, 0));
    if (body.mass > 0 && dims && dims.mass) body.mass = dims.mass;
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

  // Height of the first solid surface under a point, or null. Used by the
  // hull clamp so no part of the tank can ever end a step below the ground.
  // A static convex solid. Slopes need this: approximating a wedge with a
  // tilted slab plus a filler box leaves seams and steps between the two,
  // which is what the invisible hump at the foot of a ramp was.
  function addStaticConvex(vertices, faces, pos, quat) {
    const shape = new CANNON.ConvexPolyhedron({
      vertices: vertices.map((v) => new CANNON.Vec3(v[0], v[1], v[2])),
      faces,
    });
    const body = new CANNON.Body({
      mass: 0,
      material: groundMat,
      collisionFilterGroup: GROUP_STATIC,
      collisionFilterMask: GROUP_LOCAL | GROUP_REMOTE,
    });
    body.addShape(shape);
    body.position.copy(pos);
    if (quat) body.quaternion.copy(quat);
    world.addBody(body);
    return body;
  }

  // First solid surface along a segment, or null. Everything that fires
  // needs this: walls, slopes and platforms are physics bodies, so one query
  // covers the arena and anything built in the editor alike.
  const _losFrom = new CANNON.Vec3();
  const _losTo = new CANNON.Vec3();
  function rayHit(fx, fy, fz, tx, ty, tz) {
    _losFrom.set(fx, fy, fz);
    _losTo.set(tx, ty, tz);
    _ray.from.copy(_losFrom);
    _ray.to.copy(_losTo);
    _rayResult.reset();
    _ray.intersectWorld(world, {
      mode: CANNON.Ray.CLOSEST,
      result: _rayResult,
      skipBackfaces: true,
      collisionFilterMask: GROUP_STATIC,
    });
    if (!_rayResult.hasHit) return null;
    const p = _rayResult.hitPointWorld;
    const n = _rayResult.hitNormalWorld;
    const dx = p.x - fx;
    const dy = p.y - fy;
    const dz = p.z - fz;
    return {
      x: p.x, y: p.y, z: p.z,
      nx: n.x, ny: n.y, nz: n.z,
      dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
    };
  }

  // is there anything solid between these two points?
  function blocked(fx, fy, fz, tx, ty, tz) {
    return rayHit(fx, fy, fz, tx, ty, tz) !== null;
  }

  function surfaceY(x, y, z, drop) {
    _ray.from.set(x, y, z);
    _ray.to.set(x, y - drop, z);
    _rayResult.reset();
    _ray.intersectWorld(world, {
      mode: CANNON.Ray.CLOSEST,
      result: _rayResult,
      skipBackfaces: true,
      collisionFilterMask: GROUP_STATIC | GROUP_REMOTE,
    });
    return _rayResult.hasHit ? _rayResult.hitPointWorld.y : null;
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

  // ---- robustness ----------------------------------------------------------
  // A rigid-body sim has a small number of ways it goes wrong, and all of them
  // end with the tank somewhere it should never be. Watch the dynamic bodies
  // every step and pull them back before any of it becomes visible.
  const guarded = [];
  const MAX_SPEED = 90;      // nothing here should ever move this fast
  const MAX_SPIN = 14;       // rad/s; past this a hull is in a solver spiral
  const FLOOR_Y = -60;       // below this it has left the world entirely

  function guard(body) {
    guarded.push({ body, lastGood: body.position.clone(), lastQuat: body.quaternion.clone() });
  }

  function unguard(body) {
    const i = guarded.findIndex((g) => g.body === body);
    if (i >= 0) guarded.splice(i, 1);
  }

  function finite(v) {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }

  function sanitise() {
    for (const g of guarded) {
      const b = g.body;

      // 1. NaN. One bad contact can poison position, velocity and quaternion in
      //    a single step, and once any of them is NaN the body is gone for good
      //    — every later step propagates it. Restore the last sane pose.
      if (!finite(b.position) || !finite(b.velocity) || !finite(b.angularVelocity)
        || !Number.isFinite(b.quaternion.x) || !Number.isFinite(b.quaternion.w)) {
        b.position.copy(g.lastGood);
        b.quaternion.copy(g.lastQuat);
        b.velocity.setZero();
        b.angularVelocity.setZero();
        continue;
      }

      // 2. Runaway speed. Deep penetration recovery can hand a body an enormous
      //    impulse; clamping keeps that as a shove rather than a launch.
      const sp = b.velocity.length();
      if (sp > MAX_SPEED) b.velocity.scale(MAX_SPEED / sp, b.velocity);
      const sq = b.angularVelocity.length();
      if (sq > MAX_SPIN) b.angularVelocity.scale(MAX_SPIN / sq, b.angularVelocity);

      // 3. Left the world. Falling through a seam used to mean falling forever.
      if (b.position.y < FLOOR_Y) {
        b.position.copy(g.lastGood);
        b.position.y += 2;
        b.velocity.setZero();
        b.angularVelocity.setZero();
        continue;
      }

      // 4. Drifting quaternion. Repeated integration denormalises it, which
      //    shears the collision box a little more every second.
      b.quaternion.normalize();

      // this pose is sane, so it becomes the one we fall back to
      g.lastGood.copy(b.position);
      g.lastQuat.copy(b.quaternion);
    }
  }

  // Fixed-step integration with an accumulator, so the simulation advances by
  // the same amount of time per second of real time regardless of frame rate.
  // cannon-es does this internally, but only up to its substep cap; feeding it
  // a clamped dt keeps a long stall (a tab switch, a shader compile) from
  // trying to catch up in one enormous jump.
  let accumulator = 0;
  function step(dt) {
    accumulator += Math.min(dt, FIXED_STEP * MAX_SUBSTEPS);
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
      world.step(FIXED_STEP);
      sanitise();
      accumulator -= FIXED_STEP;
      steps++;
    }
    // whatever is left over is dropped rather than banked, so a stall cannot
    // accumulate into a burst of catch-up steps later
    if (steps === MAX_SUBSTEPS) accumulator = 0;
  }

  return {
    world, createChassis, createRemoteBody, reshapeBody, removeBody, addBody,
    guard, unguard,
    addStaticBox, addStaticConvex, setArenaActive, rayHit, blocked, groundedAt, surfaceY, step,
  };
}
