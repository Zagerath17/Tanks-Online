import * as THREE from 'three';
import { SPEC } from './tank.js';
import { ARENA, heightAt } from './map.js';

const PITCH_MIN = -0.12; // minimal barrel depression
const PITCH_MAX = 0.17; // minimal barrel elevation
const YAW_SENS = 0.0032;
const PITCH_SENS = 0.002;
const TURRET_RATE = 2.2; // rad/s traverse limit — turret chases the mouse aim
const PITCH_RATE = 1.1;
const SLOPE_CLAMP = 0.32; // never tilt harder than the ramps
const FO = 1.6; // ground sample offsets: fore/aft of center...
const SO = 1.18; // ...and out to each tread

export function createPlayerController(model, spawn) {
  const state = {
    v: 0,
    omega: 0,
    heading: spawn.heading,
    aimYaw: 0, // where the mouse wants the turret
    turretYaw: 0, // where the turret actually is
    aimPitch: 0,
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
    state.aimYaw = 0;
    state.turretYaw = 0;
    state.aimPitch = 0;
    state.pitch = 0;
    state.groundPitch = 0;
    state.groundRoll = 0;
    model.root.position.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
    state.y = model.root.position.y;
    model.gun.position.x = 0;
    apply();
  }

  // Mouse deltas -> desired aim. Pitch is clamped, so the mouse is limited
  // vertically to the barrel's real travel.
  function addAim(dx, dy) {
    state.aimYaw -= dx * YAW_SENS;
    state.aimPitch = THREE.MathUtils.clamp(
      state.aimPitch - dy * PITCH_SENS, PITCH_MIN, PITCH_MAX
    );
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

    // --- move, refusing to drive into vertical faces ---
    const fx = Math.cos(state.heading);
    const fz = -Math.sin(state.heading);
    const p = model.root.position;
    const lim = ARENA.half - ARENA.margin;
    const nx = THREE.MathUtils.clamp(p.x + fx * state.v * dt, -lim, lim);
    const nz = THREE.MathUtils.clamp(p.z + fz * state.v * dt, -lim, lim);
    const hHere = heightAt(p.x, p.z);
    const dirSign = state.v >= 0 ? 1 : -1;
    const hProbe = heightAt(nx + fx * 2.1 * dirSign, nz + fz * 2.1 * dirSign);
    if (state.v !== 0 && hProbe - hHere > 0.8) {
      state.v *= 0.2; // nose bumped a ledge
    } else {
      p.x = nx;
      p.z = nz;
    }

    // --- terrain contact: sample under all four tread corners -------------
    const rx = Math.sin(state.heading);
    const rz = Math.cos(state.heading);
    const hC = heightAt(p.x, p.z);
    // Walls should block, never lift — ignore samples far above the hull
    const gate = (h) => (h - hC > 0.9 ? hC : h);
    const hFL = gate(heightAt(p.x + fx * FO - rx * SO, p.z + fz * FO - rz * SO));
    const hFR = gate(heightAt(p.x + fx * FO + rx * SO, p.z + fz * FO + rz * SO));
    const hBL = gate(heightAt(p.x - fx * FO - rx * SO, p.z - fz * FO - rz * SO));
    const hBR = gate(heightAt(p.x - fx * FO + rx * SO, p.z - fz * FO + rz * SO));

    const pitchT = THREE.MathUtils.clamp(
      Math.atan2((hFL + hFR) / 2 - (hBL + hBR) / 2, 2 * FO), -SLOPE_CLAMP, SLOPE_CLAMP
    );
    const rollT = THREE.MathUtils.clamp(
      Math.atan2((hFL + hBL) / 2 - (hFR + hBR) / 2, 2 * SO), -SLOPE_CLAMP, SLOPE_CLAMP
    );
    const k = Math.min(1, 12 * dt);
    state.groundPitch += (pitchT - state.groundPitch) * k;
    state.groundRoll += (rollT - state.groundRoll) * k;

    // Support height: with the current tilt, no corner may sink into the
    // ground. This is what stops the hull clipping at ramp edges.
    const sinP = Math.sin(state.groundPitch);
    const sinR = Math.sin(state.groundRoll);
    const need = (h, dx, dz) => h - (dx * sinP - dz * sinR);
    const yT = Math.max(
      hC,
      need(hFL, FO, -SO),
      need(hFR, FO, SO),
      need(hBL, -FO, -SO),
      need(hBR, -FO, SO)
    );
    const settle = yT > state.y ? 30 : 10; // snap up onto support, ease down
    state.y += (yT - state.y) * Math.min(1, settle * dt);
    p.y = state.y;

    // --- turret chases the mouse aim at a limited traverse rate -----------
    const yawErr = Math.atan2(
      Math.sin(state.aimYaw - state.turretYaw),
      Math.cos(state.aimYaw - state.turretYaw)
    );
    state.turretYaw += THREE.MathUtils.clamp(yawErr, -TURRET_RATE * dt, TURRET_RATE * dt);
    state.pitch += THREE.MathUtils.clamp(
      state.aimPitch - state.pitch, -PITCH_RATE * dt, PITCH_RATE * dt
    );

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
    // camera follows the mouse aim so the view stays responsive while the
    // turret catches up underneath it
    aimAngle: () => state.heading + state.aimYaw,
  };
}
