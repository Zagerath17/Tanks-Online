import * as THREE from 'three';
import { createArena } from './map.js';
import { createTank } from './tank.js';
import { readInput } from './controls.js';

// ---------------------------------------------------------------------------
// Renderer + scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9c3cd');
scene.fog = new THREE.Fog('#b9c3cd', 70, 230);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

// ---------------------------------------------------------------------------
// Lighting — sun rig follows the tank so shadows stay crisp everywhere
// ---------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight('#dfe7ee', '#4d5158', 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fff4e0', 1.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -32;
sun.shadow.camera.right = 32;
sun.shadow.camera.top = 32;
sun.shadow.camera.bottom = -32;
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

const SUN_OFFSET = new THREE.Vector3(28, 42, 18);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
createArena(scene);

const tank = createTank();
scene.add(tank.root);

// ---------------------------------------------------------------------------
// Camera: classic Tanki feel — the view hangs behind the turret, so J/K
// swing the camera while WASD drives the hull underneath it.
// ---------------------------------------------------------------------------
let camYaw = 0;
const camPos = new THREE.Vector3(-10.5, 5.6, 0);
const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function updateCamera(dt) {
  camYaw = lerpAngle(camYaw, tank.aimAngle(), 1 - Math.exp(-5.5 * dt));
  const fx = Math.cos(camYaw);
  const fz = -Math.sin(camYaw);

  _desired.set(
    tank.root.position.x - fx * 10.5,
    5.6,
    tank.root.position.z - fz * 10.5
  );
  camPos.lerp(_desired, 1 - Math.exp(-9 * dt));
  camera.position.copy(camPos);

  _lookAt.set(
    tank.root.position.x + fx * 6,
    1.6,
    tank.root.position.z + fz * 6
  );
  camera.lookAt(_lookAt);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const elSpeed = document.getElementById('speed');
const elFps = document.getElementById('fps');
let fpsTime = 0;
let fpsFrames = 0;

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  tank.update(dt, readInput());
  updateCamera(dt);

  sun.position.copy(tank.root.position).add(SUN_OFFSET);
  sun.target.position.copy(tank.root.position);

  fpsTime += dt;
  fpsFrames += 1;
  if (fpsTime >= 0.5) {
    elFps.textContent = String(Math.round(fpsFrames / fpsTime));
    fpsTime = 0;
    fpsFrames = 0;
  }
  elSpeed.textContent = String(Math.round(Math.abs(tank.state.v) * 8));

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
