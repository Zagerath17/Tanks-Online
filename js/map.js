import * as THREE from 'three';
import { makeGridTexture } from './grid-texture.js';

export const ARENA = {
  size: 160,
  half: 80,
  margin: 3.2, // keeps the tank's nose off the walls
};

// Central raised platform with a drive-up ramp on each of the four sides
export const PLATFORM = {
  half: 8,      // platform is 16 x 16
  h: 2,         // top surface height
  rampLen: 7,   // ramp reaches this far out from the platform edge
  rampHalfW: 3, // ramp is 6 wide
};

// 12 spawn slots on a ring around the platform, each facing the center.
// Match spacing keeps players apart at game start; respawns pick the slot
// farthest from everyone still alive.
export const SPAWN_SLOTS = [];
{
  const R = 58;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    SPAWN_SLOTS.push({
      x: Math.cos(a) * R,
      z: Math.sin(a) * R,
      heading: Math.PI - a, // forward = toward the platform
    });
  }
}

// Ground height at any point — drives tank climbing and bullet impacts
export function heightAt(x, z) {
  const { half, h, rampLen, rampHalfW } = PLATFORM;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax <= half && az <= half) return h;
  if (az <= rampHalfW && ax > half && ax <= half + rampLen) {
    return h * (1 - (ax - half) / rampLen);
  }
  if (ax <= rampHalfW && az > half && az <= half + rampLen) {
    return h * (1 - (az - half) / rampLen);
  }
  return 0;
}

export function createArena(scene) {
  const group = new THREE.Group();
  scene.add(group);
  // ---- floor -------------------------------------------------------------
  const floorTex = makeGridTexture({
    cells: 8,
    base: '#8b939d',
    line: '#7a828c',
    lineWidth: 2,
    major: 8,
    majorLine: '#68707a',
    majorWidth: 6,
    repeat: [ARENA.size / 4, ARENA.size / 4],
    anisotropy: 16,
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.size, ARENA.size),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ---- central platform + ramps -----------------------------------------
  const platTex = makeGridTexture({
    cells: 8,
    base: '#7d8894',
    line: '#6d7884',
    lineWidth: 2,
    major: 8,
    majorLine: '#5d6874',
    majorWidth: 6,
    repeat: [PLATFORM.half / 2, PLATFORM.half / 2],
  });
  const platMat = new THREE.MeshStandardMaterial({ map: platTex, roughness: 0.92 });

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(PLATFORM.half * 2, PLATFORM.h, PLATFORM.half * 2),
    platMat
  );
  platform.position.y = PLATFORM.h / 2;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // Ramp: right-triangle profile extruded to width, vertical face against
  // the platform. Local +X points away from the platform.
  const rampShape = new THREE.Shape();
  rampShape.moveTo(0, 0);
  rampShape.lineTo(PLATFORM.rampLen, 0);
  rampShape.lineTo(0, PLATFORM.h);
  rampShape.closePath();
  const rampGeo = new THREE.ExtrudeGeometry(rampShape, {
    depth: PLATFORM.rampHalfW * 2,
    bevelEnabled: false,
  });
  rampGeo.translate(0, 0, -PLATFORM.rampHalfW);

  const rampTex = makeGridTexture({
    cells: 6,
    base: '#747f8b',
    line: '#65707c',
    lineWidth: 3,
    repeat: [0.5, 0.5],
  });
  const rampMat = new THREE.MeshStandardMaterial({ map: rampTex, roughness: 0.92 });

  const rampAngles = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // +x, +z?, -x, -z
  for (const a of rampAngles) {
    const ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.rotation.y = a;
    ramp.position.set(
      Math.cos(a) * PLATFORM.half,
      0,
      -Math.sin(a) * PLATFORM.half
    );
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    group.add(ramp);
  }

  // ---- spawn pads: one small ring per slot -------------------------------
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#c2cbd6',
    transparent: true,
    opacity: 0.55,
  });
  const padGeo = new THREE.RingGeometry(1.9, 2.12, 40);
  for (const s of SPAWN_SLOTS) {
    const pad = new THREE.Mesh(padGeo, ringMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.x, 0.02, s.z);
    group.add(pad);
  }

  // ---- perimeter walls ---------------------------------------------------
  const wallTex = makeGridTexture({
    cells: 8,
    base: '#5a626c',
    line: '#4c545e',
    lineWidth: 3,
    repeat: [ARENA.size / 4, 1],
  });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0.05 });

  const t = 2;
  const h = 4;
  const long = ARENA.size + t * 2;

  const geoNS = new THREE.BoxGeometry(long, h, t);
  const geoEW = new THREE.BoxGeometry(t, h, long);

  const walls = [
    new THREE.Mesh(geoNS, wallMat),
    new THREE.Mesh(geoNS, wallMat),
    new THREE.Mesh(geoEW, wallMat),
    new THREE.Mesh(geoEW, wallMat),
  ];
  walls[0].position.set(0, h / 2, -(ARENA.half + t / 2));
  walls[1].position.set(0, h / 2, ARENA.half + t / 2);
  walls[2].position.set(-(ARENA.half + t / 2), h / 2, 0);
  walls[3].position.set(ARENA.half + t / 2, h / 2, 0);

  for (const w of walls) {
    w.castShadow = true;
    w.receiveShadow = true;
    group.add(w);
  }

  // ---- corner pillars ----------------------------------------------------
  const pillarTex = makeGridTexture({
    cells: 6,
    base: '#646d78',
    line: '#545d67',
    lineWidth: 3,
    repeat: [1, 1],
  });
  const pillarMat = new THREE.MeshStandardMaterial({ map: pillarTex, roughness: 0.9 });
  const pillarGeo = new THREE.BoxGeometry(3.6, 5.4, 3.6);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(sx * (ARENA.half + t / 2), 2.7, sz * (ARENA.half + t / 2));
      p.castShadow = true;
      p.receiveShadow = true;
      group.add(p);
    }
  }

  return group;
}
