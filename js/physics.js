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
export const CHASSIS = {
  hx: 2.4,
  hy: 0.62,
  hz: 1.51,
  shapeOffY: 0.1,
};
// model origin (ground contact under the hull) in body-local space
export const MODEL_OFF_Y = CHASSIS.shapeOffY - CHASSIS.hy; // -0.52

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -24, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  const groundMat = new CANNON.Material('ground');
  const chassisMat = new CANNON.Material('chassis');
  // The chassis is a plain box, so solver friction treats it like a crate:
  // it drives contact-point slip to zero every step and completely eats the
  // drive velocity the controller writes each frame. Grip is done in code
  // instead (player.js owns forward drive, lateral bite, and the parking
  // brake), so the contact itself is left almost slick.
  world.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, chassisMat, {
      friction: 0.02,
      restitution: 0.0,
    })
  );
  world.defaultContactMaterial.friction = 0.05;

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
    const halfLen = hyp / 2 + 0.35;
    const halfT = 0.4;
    const midX = PLATFORM.half + PLATFORM.rampLen / 2; // along local outward axis
    const midY = PLATFORM.h / 2;
    const nx = Math.sin(theta);
    const ny = Math.cos(theta);
    const cLocalX = midX - nx * halfT;
    const cY = midY - ny * halfT;

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
  const chassisShape = new CANNON.Box(new CANNON.Vec3(CHASSIS.hx, CHASSIS.hy, CHASSIS.hz));

  function createChassis() {
    const body = new CANNON.Body({
      mass: 6,
      material: chassisMat,
      collisionFilterGroup: GROUP_LOCAL,
      collisionFilterMask: GROUP_STATIC | GROUP_REMOTE,
      linearDamping: 0.03,
      angularDamping: 0.35,
      allowSleep: false,
    });
    body.addShape(chassisShape, new CANNON.Vec3(0, CHASSIS.shapeOffY, 0));
    world.addBody(body);
    return body;
  }

  function createRemoteBody() {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      collisionFilterGroup: GROUP_REMOTE,
      collisionFilterMask: GROUP_LOCAL,
    });
    body.addShape(chassisShape, new CANNON.Vec3(0, CHASSIS.shapeOffY, 0));
    world.addBody(body);
    return body;
  }

  function removeBody(body) {
    world.removeBody(body);
  }

  // Ray straight down from a point — used for the grounded check
  const _ray = new CANNON.Ray();
  const _rayResult = new CANNON.RaycastResult();
  function groundedAt(pos, reach) {
    _ray.from.copy(pos);
    _ray.to.set(pos.x, pos.y - reach, pos.z);
    _rayResult.reset();
    _ray.intersectWorld(world, {
      mode: CANNON.Ray.CLOSEST,
      result: _rayResult,
      skipBackfaces: true,
      collisionFilterMask: GROUP_STATIC | GROUP_REMOTE,
    });
    return _rayResult.hasHit;
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
    world, createChassis, createRemoteBody, removeBody, addBody,
    addStaticBox, setArenaActive, groundedAt, step,
  };
}
