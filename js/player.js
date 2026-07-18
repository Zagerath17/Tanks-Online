import * as THREE from 'three';
import { SPEC } from './tank.js';
import { ARENA, heightAt } from './map.js';

// The barrel's real vertical travel — the mouse aim is clamped to this
export const AIM_PITCH = { min: -0.12, max: 0.17 };

const TURRET_RATE = 2.2; // rad/s traverse — the turret chases the aim
const PITCH_RATE = 1.1;
const TIP_CLAMP = 0.5; // steeper than the ramps, so edges read as tipping
const GRAVITY = 24;
const FO = 1.6; // ground sample offsets: fore/aft of center...
const SO = 1.18; // ...and out to each tread

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
    vy: 0,
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
    state.vy = 0;
    model.root.position.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
    state.y = model.root.position.y;
    model.gun.position.x = 0;
    apply();
  }

  function applyRecoil() {
    // Kick opposes the shot; strongest when firing along the hull axis
    state.v -= 1.3 * Math.cos(state.turretYaw);
  }

  // aimWorldYaw/aimPitch: the direction of the point under the crosshair.
  // The turret chases it at a limited rate — the view never waits for it.
  function update(dt, input, aimWorldYaw, aimPitch) {
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
    const wallGate = (h) => (h - hC > 0.9 ? hC : h);
    const hFL = wallGate(heightAt(p.x + fx * FO - rx * SO, p.z + fz * FO - rz * SO));
    const hFR = wallGate(heightAt(p.x + fx * FO + rx * SO, p.z + fz * FO + rz * SO));
    const hBL = wallGate(heightAt(p.x - fx * FO - rx * SO, p.z - fz * FO - rz * SO));
    const hBR = wallGate(heightAt(p.x - fx * FO + rx * SO, p.z - fz * FO + rz * SO));

    const pitchT = THREE.MathUtils.clamp(
      Math.atan2((hFL + hFR) / 2 - (hBL + hBR) / 2, 2 * FO), -TIP_CLAMP, TIP_CLAMP
    );
    const rollT = THREE.MathUtils.clamp(
      Math.atan2((hFL + hBL) / 2 - (hFR + hBR) / 2, 2 * SO), -TIP_CLAMP, TIP_CLAMP
    );
    const k = Math.min(1, 8 * dt);
    state.groundPitch += (pitchT - state.groundPitch) * k;
    state.groundRoll += (rollT - state.groundRoll) * k;

    // Support: with the current tilt, which corners could actually hold us?
    const sinP = Math.sin(state.groundPitch);
    const sinR = Math.sin(state.groundRoll);
    const need = (h, dx, dz) => h - (dx * sinP - dz * sinR);
    const nFL = need(hFL, FO, -SO);
    const nFR = need(hFR, FO, SO);
    const nBL = need(hBL, -FO, -SO);
    const nBR = need(hBR, -FO, SO);
    let cornerMax = Math.max(nFL, nFR, nBL, nBR);

    // A one-sided grip over an edge can't hold the tank: if the center is
    // over the drop and only one end/side still touches, it slips off.
    if (cornerMax > hC + 0.4) {
      const th = cornerMax - 0.05;
      let n = 0;
      let mx = 0;
      let mz = 0;
      if (nFL >= th) { n++; mx += FO; mz += -SO; }
      if (nFR >= th) { n++; mx += FO; mz += SO; }
      if (nBL >= th) { n++; mx += -FO; mz += -SO; }
      if (nBR >= th) { n++; mx += -FO; mz += SO; }
      mx /= n;
      mz /= n;
      if (Math.abs(mx) > 1.2 || Math.abs(mz) > 0.9) cornerMax = hC;
    }

    const yT = Math.max(hC, cornerMax);

    // Real vertical motion: fall under gravity when unsupported, climb
    // smoothly when the ground rises under us. No more hovering glides.
    if (state.y > yT + 0.04) {
      state.vy -= GRAVITY * dt;
      state.y += state.vy * dt;
      if (state.y <= yT) {
        if (state.vy < -7) state.v *= 0.7; // hard landing scrubs speed
        state.y = yT;
        state.vy = 0;
      }
    } else {
      state.vy = 0;
      state.y += (yT - state.y) * Math.min(1, 30 * dt);
    }
    p.y = state.y;

    // --- turret chases the crosshair point at a limited traverse rate -----
    const relTarget = aimWorldYaw - state.heading;
    const yawErr = Math.atan2(
      Math.sin(relTarget - state.turretYaw),
      Math.cos(relTarget - state.turretYaw)
    );
    state.turretYaw += THREE.MathUtils.clamp(yawErr, -TURRET_RATE * dt, TURRET_RATE * dt);
    state.turretYaw = Math.atan2(Math.sin(state.turretYaw), Math.cos(state.turretYaw));
    const pitchTarget = THREE.MathUtils.clamp(aimPitch, AIM_PITCH.min, AIM_PITCH.max);
    state.pitch += THREE.MathUtils.clamp(
      pitchTarget - state.pitch, -PITCH_RATE * dt, PITCH_RATE * dt
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
    reset,
    applyRecoil,
  };
}
