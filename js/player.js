import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SPEC } from './tank.js';
import { heightAt } from './map.js';
import { CHASSIS, MODEL_OFF_Y } from './physics.js';

// The barrel's real vertical travel — the turret aims within this
export const AIM_PITCH = { min: -0.12, max: 0.17 };

const TURRET_RATE = 2.2; // rad/s traverse — the turret chases the aim
const PITCH_RATE = 1.1;
const LAT_GRIP = 14; // how fast sideways slide is scrubbed off, 1/s
const HOLD_SPEED = 0.8; // below this, an idle tank parks instead of creeping
const HUSK_DRAG = 3; // a flipped hull slides to a stop on the slick ground
const RECOIL = 1.5; // impulse per unit of hull mass, straight back down the bore
const GROUND_REACH = CHASSIS.hy - CHASSIS.shapeOffY + 0.38;

export function createPlayerController(model, physics) {
  const body = physics.createChassis();

  const state = {
    v: 0, // forward ground speed (HUD, engine, treads)
    heading: 0, // hull yaw projected onto the ground plane
    turretYaw: 0,
    pitch: 0,
    grounded: false,
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
    _off.set(0, MODEL_OFF_Y, 0).applyQuaternion(_q);
    model.root.position.set(
      body.position.x + _off.x,
      body.position.y + _off.y,
      body.position.z + _off.z
    );
    model.root.quaternion.copy(_q);
  }

  function reset(spawn) {
    const gy = spawn.y !== undefined ? spawn.y : heightAt(spawn.x, spawn.z);
    body.position.set(spawn.x, gy - MODEL_OFF_Y + 0.06, spawn.z);
    body.quaternion.setFromAxisAngle(_yAxis, spawn.heading);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.wakeUp();
    state.v = 0;
    state.heading = spawn.heading;
    state.turretYaw = 0;
    state.pitch = 0;
    state.flipT = 0;
    model.gun.position.x = 0;
    model.turret.rotation.y = 0;
    model.pitchGroup.rotation.z = 0;
    syncModel();
  }

  // Recoil is a real impulse fired straight back down the barrel line, applied
  // at the muzzle. Because the barrel sits about a metre above the hull's
  // centre of mass, that offset turns into torque on its own and the tank
  // squats and rocks nose-up — no camera trickery involved. Any point on the
  // barrel axis gives the same torque, so the muzzle is as good as the breech.
  const _imp = new CANNON.Vec3();
  const _rel = new CANNON.Vec3();
  function applyRecoil(dir, muzzlePos) {
    const j = body.mass * RECOIL;
    _imp.set(-dir.x * j, -dir.y * j, -dir.z * j);
    if (muzzlePos) {
      _rel.set(
        muzzlePos.x - body.position.x,
        muzzlePos.y - body.position.y,
        muzzlePos.z - body.position.z
      );
      body.applyImpulse(_imp, _rel);
    } else {
      body.applyImpulse(_imp);
    }
    body.wakeUp();
  }

  // Pre-physics: read input, steer the body. The solver owns everything
  // else — slopes, edges, tumbling, and coming to rest upside down.
  function update(dt, input, aimWorldYaw, aimPitch) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _fwd.set(1, 0, 0).applyQuaternion(_q);
    _right.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);

    state.grounded = physics.groundedAt(body.position, GROUND_REACH);
    state.upright = _up.y > 0.55;
    if (_up.y < 0.25) state.flipT += dt;
    else state.flipT = 0;

    const vel = body.velocity;
    _vel.set(vel.x, vel.y, vel.z);
    let vF = _vel.dot(_fwd);

    if (state.grounded && state.upright) {
      // Work in the hull's own frame: forward / sideways / along its up axis.
      // Rebuilding the velocity from these three keeps the drive authoritative
      // while still reading back whatever the solver did (walls, ramps, hits).
      let vLat = _vel.dot(_right);
      const vUp = _vel.dot(_up);

      // throttle -> target forward speed (same curve as ever)
      if (input.throttle > 0) {
        vF += (vF < 0 ? SPEC.brakeAccel : SPEC.accel) * dt;
      } else if (input.throttle < 0) {
        vF -= (vF > 0 ? SPEC.brakeAccel : SPEC.accel) * dt;
      } else {
        const d = SPEC.drag * dt;
        vF = Math.abs(vF) <= d ? 0 : vF - Math.sign(vF) * d;
      }
      vF = THREE.MathUtils.clamp(vF, -SPEC.maxReverse, SPEC.maxForward);

      // treads don't slide sideways
      vLat -= vLat * Math.min(1, LAT_GRIP * dt);

      // parking brake: sitting still means sitting still, including on a slope
      if (input.throttle === 0 && Math.abs(vF) < HOLD_SPEED) {
        vF = 0;
        vLat = 0;
      }

      vel.x = _fwd.x * vF + _right.x * vLat + _up.x * vUp;
      vel.y = _fwd.y * vF + _right.y * vLat + _up.y * vUp;
      vel.z = _fwd.z * vF + _right.z * vLat + _up.z * vUp;

      // pivot: steer angular velocity about the hull's own up axis
      const av = body.angularVelocity;
      const avUp = av.x * _up.x + av.y * _up.y + av.z * _up.z;
      const dAv = (input.turn * SPEC.turnRate - avUp) * Math.min(1, SPEC.turnResponse * dt);
      av.x += _up.x * dAv;
      av.y += _up.y * dAv;
      av.z += _up.z * dAv;
    } else if (state.grounded) {
      // flipped or otherwise not driving — bleed the slide off by hand
      const k = Math.min(1, HUSK_DRAG * dt);
      vel.x -= vel.x * k;
      vel.z -= vel.z * k;
    }
    state.v = vF;

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
      state.turretYaw += THREE.MathUtils.clamp(yawErr, -TURRET_RATE * dt, TURRET_RATE * dt);
      state.turretYaw = Math.atan2(Math.sin(state.turretYaw), Math.cos(state.turretYaw));
      const pt = THREE.MathUtils.clamp(aimPitch, AIM_PITCH.min, AIM_PITCH.max);
      state.pitch += THREE.MathUtils.clamp(pt - state.pitch, -PITCH_RATE * dt, PITCH_RATE * dt);
    }
    model.turret.rotation.y = state.turretYaw;
    model.pitchGroup.rotation.z = state.pitch;

    // --- treads (counter-rotate on pivot turns) ---
    const av = body.angularVelocity;
    const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z;
    model.updateTreads(dt, state.v - yawRate * SPEC.halfTrack, state.v + yawRate * SPEC.halfTrack);
  }

  // Post-physics: pull the solved transform onto the visual model
  function postStep() {
    syncModel();
  }

  return { state, body, update, postStep, reset, applyRecoil };
}
