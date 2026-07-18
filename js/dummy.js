import * as THREE from 'three';
import { heightAt } from './map.js';

const TRACK_RATE = 1.5; // rad/s turret traverse
const PITCH_MIN = -0.14;
const PITCH_MAX = 0.17;
const AIM_TOLERANCE = 0.22;

export function createDummyController(model, spawn) {
  const state = { turretYaw: 0, pitch: 0 };

  model.root.position.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
  model.root.rotation.y = spawn.heading;

  function reset() {
    state.turretYaw = 0;
    state.pitch = 0;
    model.turret.rotation.y = 0;
    model.pitchGroup.rotation.z = 0;
    model.gun.position.x = 0;
    model.root.rotation.set(0, spawn.heading, 0);
  }

  const _muzzlePos = new THREE.Vector3();

  // Swings the turret toward the player; returns true when lined up
  function update(dt, playerPos) {
    const dx = playerPos.x - model.root.position.x;
    const dz = playerPos.z - model.root.position.z;
    const worldYaw = Math.atan2(-dz, dx);
    const target = worldYaw - spawn.heading;

    const err = Math.atan2(
      Math.sin(target - state.turretYaw),
      Math.cos(target - state.turretYaw)
    );
    state.turretYaw += THREE.MathUtils.clamp(err, -TRACK_RATE * dt, TRACK_RATE * dt);

    // Minimal elevation toward the player's hull
    model.muzzle.getWorldPosition(_muzzlePos);
    const dist = Math.max(1, Math.hypot(dx, dz));
    const pitchT = THREE.MathUtils.clamp(
      Math.atan2(playerPos.y + 0.8 - _muzzlePos.y, dist),
      PITCH_MIN,
      PITCH_MAX
    );
    state.pitch += (pitchT - state.pitch) * Math.min(1, 3 * dt);

    model.turret.rotation.y = state.turretYaw;
    model.pitchGroup.rotation.z = state.pitch;

    return Math.abs(err) < AIM_TOLERANCE;
  }

  return { update, reset };
}
