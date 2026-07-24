import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { heightAt } from './map.js';

// The barrel's real vertical travel — the turret aims within this
export const AIM_PITCH = { min: -0.12, max: 0.17 };

const TURRET_RATE = 2.2; // rad/s traverse — the turret chases the aim
const PITCH_RATE = 1.1;

export function createPlayerController(model, physics) {
  // every dimension and speed comes from whichever hull the model is wearing
  let hull = model.hull;
  const body = physics.createChassis(hull.chassis);
  const gravity = physics.world.gravity;

  // called when the garage swaps hulls: new collision box, speeds, offsets
  function syncHull() {
    hull = model.hull;
    physics.reshapeBody(body, hull.chassis);
  }
  let slowMul = 1; // 1 = normal, 0.5 = fully frozen
  let airborne = 0; // seconds since the last confirmed ground contact
  let drive = 0;    // the speed the controller is commanding, in m/s

  const state = {
    v: 0, // measured forward ground speed (HUD, engine)
    tread: 0, // the speed the tracks are turning at — slips against walls
    heading: 0, // hull yaw projected onto the ground plane
    turretYaw: 0,
    pitch: 0,
    grounded: false, // drive authority (survives brief contact dropouts)
    contact: false,  // tracks actually touching something this frame
    upright: true,
    flipT: 0, // seconds spent flipped over
  };

  const _q = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _vel = new THREE.Vector3();
  const _off = new THREE.Vector3();
  const _yAxis = new CANNON.Vec3(0, 1, 0);

  function syncModel() {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _off.set(0, hull.chassis.modelOffY, 0).applyQuaternion(_q);
    model.root.position.set(
      body.position.x + _off.x,
      body.position.y + _off.y,
      body.position.z + _off.z
    );
    model.root.quaternion.copy(_q);
  }

  function reset(spawn) {
    const gy = spawn.y !== undefined ? spawn.y : heightAt(spawn.x, spawn.z);
    body.position.set(spawn.x, gy - hull.chassis.modelOffY + 0.06, spawn.z);
    body.quaternion.setFromAxisAngle(_yAxis, spawn.heading);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.wakeUp();
    state.v = 0;
    state.tread = 0;
    state.heading = spawn.heading;
    state.turretYaw = 0;
    state.pitch = 0;
    state.flipT = 0;
    airborne = 0;
    drive = 0;
    slowMul = 1;
    model.gun.position.x = 0;
    model.turret.rotation.y = 0;
    model.pitchGroup.rotation.z = 0;
    syncModel();
  }

  // Recoil: a modest backward shove plus a real rock of the hull. The old
  // version was pure linear velocity, which the drive controller read as
  // "briefly reversing" — this pitches the nose up around the axis
  // perpendicular to the shot, so the whole tank visibly bucks.
  function applyRecoil(dir, scale = 1) {
    const dh = Math.hypot(dir.x, dir.z) || 1;
    const dx = dir.x / dh;
    const dz = dir.z / dh;
    body.applyImpulse(new CANNON.Vec3(
      -dx * body.mass * 0.45 * scale,
      0,
      -dz * body.mass * 0.45 * scale
    ));
    // nose-up axis = shotDir x worldUp = (-dz, 0, dx)
    const rock = 1.05 * scale;
    body.angularVelocity.x += -dz * rock;
    body.angularVelocity.z += dx * rock;
  }

  // Ground drag for a hull nobody is driving — a dead husk or a tank lying on
  // its roof. Contact friction is zero by design (see physics.js), so without
  // this the wreck would skate away across the arena forever.
  function scrub(dt) {
    const k = Math.min(1, hull.move.scrub * dt);
    const vel = body.velocity;
    vel.x -= vel.x * k;
    vel.z -= vel.z * k;
    if (vel.y > 0) vel.y -= vel.y * k; // never fight gravity, only bounce
    const av = body.angularVelocity;
    av.x -= av.x * k;
    av.y -= av.y * k;
    av.z -= av.z * k;
  }

  // Bleed off pitch and roll rate — everything that is NOT yaw about the
  // hull's own up axis — while the tracks are down. This is what stops a
  // nudge from an edge or another tank from winding up into a somersault,
  // without touching how the tank behaves once it is actually airborne.
  function dampTumble(dt) {
    const av = body.angularVelocity;
    const k = Math.min(1, hull.move.stabilize * dt);
    const upComp = av.x * _up.x + av.y * _up.y + av.z * _up.z;
    av.x -= (av.x - _up.x * upComp) * k;
    av.y -= (av.y - _up.y * upComp) * k;
    av.z -= (av.z - _up.z * upComp) * k;
  }

  // Pre-physics: read input, steer the body. The solver owns everything
  // else — slopes, edges, tumbling, and coming to rest upside down.
  function update(dt, input, aimWorldYaw, aimPitch) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _fwd.set(1, 0, 0).applyQuaternion(_q);
    _right.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);

    // coyote time: keep drive authority through brief contact dropouts
    // (cresting a ramp, rolling over a seam) instead of going inert
    const touching = physics.groundedAt(body.position, hull.chassis.groundReach, body);
    if (touching) airborne = 0;
    else airborne += dt;
    state.grounded = airborne < 0.16;
    state.contact = touching;
    state.upright = _up.y > 0.55;
    if (_up.y < 0.25) state.flipT += dt;
    else state.flipT = 0;

    const vel = body.velocity;
    _vel.set(vel.x, vel.y, vel.z);
    const measured = _vel.dot(_fwd);

    if (state.grounded && state.upright) {
      // The commanded speed lives here, not on the body. Reading it back off
      // the body each frame meant anything that bled velocity (a scrape, a
      // landing) also erased the throttle's progress.
      if (input.throttle > 0) {
        drive += (drive < 0 ? hull.move.brakeAccel : hull.move.accel) * slowMul * dt;
      } else if (input.throttle < 0) {
        drive -= (drive > 0 ? hull.move.brakeAccel : hull.move.accel) * slowMul * dt;
      } else {
        const d = hull.move.drag * dt;
        drive = Math.abs(drive) <= d ? 0 : drive - Math.sign(drive) * d;
      }
      drive = THREE.MathUtils.clamp(drive, -hull.move.maxReverse * slowMul, hull.move.maxForward * slowMul);

      // but stay honest about walls: bleed the command toward what the body
      // is actually managing, so the tracks spin against an obstacle instead
      // of the command running away to top speed
      drive += (measured - drive) * Math.min(1, hull.move.slipRate * dt);

      // Gravity the solver is about to add along the tread plane. Cancelling
      // it is what lets the tank sit still on a ramp: without this it inherits
      // a fresh downhill nudge every step and creeps to the bottom. Only when
      // the tracks are really down, so coyote time can't turn into hovering.
      const gF = touching ? gravity.x * _fwd.x + gravity.y * _fwd.y + gravity.z * _fwd.z : 0;
      const gR = touching ? gravity.x * _right.x + gravity.y * _right.y + gravity.z * _right.z : 0;

      // Cap the per-step correction. Pinned against a wall the gap between
      // commanded and actual can be the full top speed, and dumping that into
      // the body every frame makes the contact solver jitter.
      const maxStep = (hull.move.accel + hull.move.brakeAccel) * dt;
      const dvF = THREE.MathUtils.clamp(drive - measured - gF * dt, -maxStep, maxStep);
      vel.x += _fwd.x * dvF;
      vel.y += _fwd.y * dvF;
      vel.z += _fwd.z * dvF;

      // treads don't slide sideways
      const vLat = _vel.dot(_right);
      const dvR = -(vLat * Math.min(1, hull.move.gripRate * dt) + gR * dt);
      vel.x += _right.x * dvR;
      vel.y += _right.y * dvR;
      vel.z += _right.z * dvR;

      // pivot: steer angular velocity about the hull's own up axis
      const av = body.angularVelocity;
      const avUp = av.x * _up.x + av.y * _up.y + av.z * _up.z;
      const dAv = (input.turn * hull.move.turnRate * slowMul - avUp) * Math.min(1, hull.move.turnResponse * dt);
      av.x += _up.x * dAv;
      av.y += _up.y * dAv;
      av.z += _up.z * dAv;

      if (touching) dampTumble(dt);
    } else {
      drive = measured; // airborne or flipped: the body is on its own
      if (touching) scrub(dt); // ...but a hull on its roof still drags
    }
    state.v = measured; // what the tank is really doing, for HUD and engine
    state.tread = drive; // what the tracks are trying to do

    // --- turret chases the crosshair point within its own limits ----------
    if (Math.hypot(_fwd.x, _fwd.z) > 0.15) {
      state.heading = Math.atan2(-_fwd.z, _fwd.x);
    }
    if (state.upright) {
      const relTarget = aimWorldYaw - state.heading;
      const yawErr = Math.atan2(
        Math.sin(relTarget - state.turretYaw),
        Math.cos(relTarget - state.turretYaw)
      );
      // a frozen tank swings its turret sluggishly too
      const traverse = TURRET_RATE * slowMul * dt;
      state.turretYaw += THREE.MathUtils.clamp(yawErr, -traverse, traverse);
      state.turretYaw = Math.atan2(Math.sin(state.turretYaw), Math.cos(state.turretYaw));
      const pt = THREE.MathUtils.clamp(aimPitch, AIM_PITCH.min, AIM_PITCH.max);
      const elevate = PITCH_RATE * slowMul * dt;
      state.pitch += THREE.MathUtils.clamp(pt - state.pitch, -elevate, elevate);
    }
    model.turret.rotation.y = state.turretYaw;
    model.pitchGroup.rotation.z = state.pitch;

    // --- treads (counter-rotate on pivot turns) ---
    // driven by the commanded speed, so the tracks visibly slip when the hull
    // is held up by a wall
    const av = body.angularVelocity;
    const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z;
    model.updateTreads(dt, state.tread - yawRate * hull.move.halfTrack, state.tread + yawRate * hull.move.halfTrack);
  }

  // Called instead of update() when the tank is dead: no input, no traction,
  // just a wreck settling. Keeps the husk from sliding on frictionless ground.
  function coast(dt) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    if (physics.groundedAt(body.position, hull.chassis.groundReach, body)) scrub(dt);
    drive = 0;
    state.v = 0;
    state.tread = 0;
    model.updateTreads(dt, 0, 0);
  }

  // Post-physics: pull the solved transform onto the visual model
  function postStep() {
    syncModel();
  }

  return {
    state, body, update, coast, postStep, reset, applyRecoil, syncHull,
    setSlow(mul) { slowMul = Number.isFinite(mul) ? Math.min(1, Math.max(0.35, mul)) : 1; },
  };
}
