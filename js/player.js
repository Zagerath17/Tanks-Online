import * as THREE from 'three';
import { SPEC } from './tank.js';
import { ARENA, heightAt } from './map.js';

const PITCH_MIN = -0.12; // minimal barrel depression
const PITCH_MAX = 0.17; // minimal barrel elevation
const YAW_SENS = 0.0032;
const PITCH_SENS = 0.002;

export function createPlayerController(model, spawn) {
  const state = {
    v: 0,
    omega: 0,
    heading: spawn.heading,
    turretYaw: 0,
    pitch: 0,
    groundPitch: 0,
    groundRoll: 0,
    y: 0,
  };

  // Yaw first, then pitch about local Z, then roll about local X
  model.root.rotation.order = 'YZX';

  function apply() {
    model.root.rotation.y = state.heading;
    model.root.rotation.z = state.groundPitch;
    model.root.rotation.x = state.groundRoll;
    model.turret.rotation.y = state.turretYaw;
    model.pitchGroup.rotation.z = state.pitch;
  }

  function reset() {
    state.v = 0;
    state.omega = 0;
    state.heading = spawn.heading;
    state.turretYaw = 0;
    state.pitch = 0;
    state.groundPitch = 0;
    state.groundRoll = 0;
    model.root.position.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
    state.y = model.root.position.y;
    model.gun.position.x = 0;
    apply();
  }

  // Mouse deltas -> turret yaw + minimal barrel elevation
  function addAim(dx, dy) {
    state.turretYaw -= dx * YAW_SENS;
    state.pitch = THREE.MathUtils.clamp(state.pitch - dy * PITCH_SENS, PITCH_MIN, PITCH_MAX);
  }

  function applyRecoil() {
    // Kick opposes the shot; strongest when firing along the hull axis
    state.v -= 1.3 * Math.cos(state.turretYaw);
  }

  function update(dt, input) {
    // --- throttle ---
    if (input.throttle > 0) {
      state.v += (state.v < 0 ? SPEC.brakeAccel : SPEC.accel) * dt;
    } else if (input.throttle < 0) {
      state.v -= (state.v > 0 ? SPEC.brakeAccel : SPEC.accel) * dt;
    } else {
      const d = SPEC.drag * dt;
      state.v = Math.abs(state.v) <= d ? 0 : state.v - Math.sign(state.v) * d;
    }
    state.v = THREE.MathUtils.clamp(state.v, -SPEC.maxReverse, SPEC.maxForward);

    // --- hull yaw ---
    const targetOmega = input.turn * SPEC.turnRate;
    state.omega += (targetOmega - state.omega) * Math.min(1, SPEC.turnResponse * dt);
    state.heading += state.omega * dt;

    // --- move, blocking vertical faces (platform sides without ramps) ---
    const fx = Math.cos(state.heading);
    const fz = -Math.sin(state.heading);
    const p = model.root.position;
    const lim = ARENA.half - ARENA.margin;
    const nx = THREE.MathUtils.clamp(p.x + fx * state.v * dt, -lim, lim);
    const nz = THREE.MathUtils.clamp(p.z + fz * state.v * dt, -lim, lim);
    if (heightAt(nx, nz) - heightAt(p.x, p.z) > 0.6) {
      state.v *= 0.2; // bumped a ledge
    } else {
      p.x = nx;
      p.z = nz;
    }

    // --- follow the terrain: sample around the hull for pitch and roll ---
    const rx = Math.sin(state.heading);
    const rz = Math.cos(state.heading);
    const hC = heightAt(p.x, p.z);
    const hF = heightAt(p.x + fx * 1.7, p.z + fz * 1.7);
    const hB = heightAt(p.x - fx * 1.7, p.z - fz * 1.7);
    const hR = heightAt(p.x + rx * 1.3, p.z + rz * 1.3);
    const hL = heightAt(p.x - rx * 1.3, p.z - rz * 1.3);

    const pitchT = Math.atan2(hF - hB, 3.4);
    const rollT = Math.atan2(hL - hR, 2.6);
    const k = Math.min(1, 10 * dt);
    state.groundPitch += (pitchT - state.groundPitch) * k;
    state.groundRoll += (rollT - state.groundRoll) * k;
    state.y += (hC - state.y) * Math.min(1, 12 * dt);
    p.y = state.y;

    apply();

    // --- treads (counter-rotate on pivot turns) ---
    const sR = state.v + state.omega * SPEC.halfTrack;
    const sL = state.v - state.omega * SPEC.halfTrack;
    model.updateTreads(dt, sL, sR);
  }

  reset();

  return {
    state,
    update,
    addAim,
    reset,
    applyRecoil,
    aimAngle: () => state.heading + state.turretYaw,
  };
}
