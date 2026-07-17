import * as THREE from 'three';
import { makeGridTexture } from './grid-texture.js';

export const ARENA = {
  size: 160,
  half: 80,
  margin: 3.2, // keeps the tank's nose off the walls
};

export function createArena(scene) {
  // ---- floor -------------------------------------------------------------
  // One texture tile = 4 units, 8 cells per tile -> 0.5 u cells,
  // with a heavier major line every 4 units.
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
  scene.add(floor);

  // ---- spawn pad ---------------------------------------------------------
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#c2cbd6',
    transparent: true,
    opacity: 0.75,
  });
  const outerRing = new THREE.Mesh(new THREE.RingGeometry(2.35, 2.6, 48), ringMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.02;
  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.82, 32), ringMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.02;
  scene.add(outerRing, innerRing);

  // ---- perimeter walls ---------------------------------------------------
  const wallTex = makeGridTexture({
    cells: 8,
    base: '#5a626c',
    line: '#4c545e',
    lineWidth: 3,
    repeat: [ARENA.size / 4, 1],
  });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0.05 });

  const t = 2; // wall thickness
  const h = 4; // wall height
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
    scene.add(w);
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
      scene.add(p);
    }
  }
}
