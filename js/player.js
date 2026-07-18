import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SPEC } from './tank.js';
import { heightAt } from './map.js';
import { CHASSIS, MODEL_OFF_Y } from './physics.js';

// The barrel's real vertical travel — the turret aims within this
export const AIM_PITCH = { min: -0.12, max: 0.17 };

const TURRET_RATE = 2.2; // rad/s traverse — the turret chases the aim
const PITCH_RATE = 1.1;
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

  // Recoil is a real impulse now — firing shoves the whole rigid body
  function applyRecoil(dir) {
    body.applyImpulse(new CANNON.Vec3(
      -dir.x * body.mass * 1.2,
      -Math.max(0, dir.y) * body.mass * 0.4,
      -dir.z * body.mass * 1.2
    ));
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

      const dvF = vF - _vel.dot(_fwd);
      vel.x += _fwd.x * dvF;
      vel.y += _fwd.y * dvF;
      vel.z += _fwd.z * dvF;

      // treads don't slide sideways
      const vLat = _vel.dot(_right);
      const kill = vLat * Math.min(1, 12 * dt);
      vel.x -= _right.x * kill;
      vel.y -= _right.y * kill;
      vel.z -= _right.z * kill;

      // pivot: steer angular velocity about the hull's own up axis
      const av = body.angularVelocity;
      const avUp = av.x * _up.x + av.y * _up.y + av.z * _up.z;
      const dAv = (input.turn * SPEC.turnRate - avUp) * Math.min(1, SPEC.turnResponse * dt);
      av.x += _up.x * dAv;
      av.y += _up.y * dAv;
      av.z += _up.z * dAv;
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
