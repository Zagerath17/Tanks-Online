import * as THREE from 'three';
import { createArena, SPAWN, heightAt, ARENA } from './map.js';
import { createTankModel, SPEC } from './tank.js';
import { createPlayerController, AIM_PITCH } from './player.js';
import { createBullets, BULLET } from './bullets.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { readInput } from './controls.js';

const FIRE_INTERVAL = 2.5;
const YAW_SENS = 0.0032;
const PITCH_SENS = 0.002;

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
// World + systems
// ---------------------------------------------------------------------------
createArena(scene);
const fx = createFx(scene);
const audio = createAudio(camera, scene);
const bullets = createBullets(scene);

function makeUnit(name, model, isPlayer) {
  return {
    name,
    model,
    isPlayer,
    alive: true,
    hp: 1000,
    maxHp: 1000,
    cooldown: isPlayer ? 0 : 1.2,
    fireSmoke: 0,
    smokeAcc: 0,
    huskAcc: 0,
    deadT: 0,
    recoil: 0,
  };
}

// Player and enemy are design replicas of each other
const playerModel = createTankModel();
scene.add(playerModel.root);
const player = createPlayerController(playerModel, SPAWN.player);
const playerUnit = makeUnit('player', playerModel, true);

const dummyModel = createTankModel();
scene.add(dummyModel.root);
dummyModel.root.position.set(
  SPAWN.dummy.x,
  heightAt(SPAWN.dummy.x, SPAWN.dummy.z),
  SPAWN.dummy.z
);
dummyModel.root.rotation.y = SPAWN.dummy.heading;
const dummyUnit = makeUnit('dummy', dummyModel, false);

function resetDummyPose() {
  dummyModel.root.rotation.set(0, SPAWN.dummy.heading, 0);
  dummyModel.turret.rotation.y = 0;
  dummyModel.pitchGroup.rotation.z = 0;
  dummyModel.gun.position.x = 0;
}

const units = [playerUnit, dummyUnit];

const engine = audio.engineLoop(playerModel.root);

// ---------------------------------------------------------------------------
// Dummy's floating health bar
// ---------------------------------------------------------------------------
const barCanvas = document.createElement('canvas');
barCanvas.width = 256;
barCanvas.height = 28;
const barCtx = barCanvas.getContext('2d');
const barTex = new THREE.CanvasTexture(barCanvas);
barTex.colorSpace = THREE.SRGBColorSpace;
const barSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: barTex, transparent: true, depthTest: false })
);
barSprite.scale.set(3.0, 0.33, 1);
barSprite.position.set(0, 4.3, 0);
dummyModel.root.add(barSprite);

function drawDummyBar() {
  barCtx.clearRect(0, 0, 256, 28);
  barCtx.fillStyle = 'rgba(10,12,14,0.72)';
  barCtx.fillRect(0, 0, 256, 28);
  barCtx.strokeStyle = 'rgba(220,225,230,0.5)';
  barCtx.lineWidth = 3;
  barCtx.strokeRect(1.5, 1.5, 253, 25);
  const f = Math.max(0, dummyUnit.hp / dummyUnit.maxHp);
  barCtx.fillStyle = '#d9534a';
  barCtx.fillRect(4, 4, 248 * f, 20);
  barTex.needsUpdate = true;
}
drawDummyBar();

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const elSpeed = document.getElementById('speed');
const elFps = document.getElementById('fps');
const elHpFill = document.getElementById('hpfill');
const elHpNum = document.getElementById('hpnum');
const elReload = document.getElementById('reload');
const elHint = document.getElementById('lockhint');
const elDeath = document.getElementById('deathmsg');
let fpsTime = 0;
let fpsFrames = 0;

function updateHpHud() {
  const f = Math.max(0, playerUnit.hp / playerUnit.maxHp);
  elHpFill.style.width = `${f * 100}%`;
  elHpFill.style.background =
    f > 0.5 ? 'linear-gradient(90deg,#7fae57,#9cc36e)'
      : f > 0.25 ? 'linear-gradient(90deg,#c9a24a,#dcb85e)'
        : 'linear-gradient(90deg,#b04a40,#d05a4e)';
  elHpNum.textContent = String(Math.max(0, Math.round(playerUnit.hp)));
}
updateHpHud();

// ---------------------------------------------------------------------------
// Mouse aim: the camera IS the crosshair. Moving the mouse swings the view
// immediately; the turret lags behind, catching up at its traverse rate.
// ---------------------------------------------------------------------------
let viewYaw = SPAWN.player.heading;
let viewPitch = 0;

const canvas = renderer.domElement;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    return;
  }
  tryPlayerFire();
});

document.addEventListener('pointerlockchange', () => {
  elHint.style.display = document.pointerLockElement === canvas ? 'none' : '';
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (!playerUnit.alive) return;
  viewYaw -= e.movementX * YAW_SENS;
  viewPitch = THREE.MathUtils.clamp(
    viewPitch - e.movementY * PITCH_SENS, AIM_PITCH.min, AIM_PITCH.max
  );
});

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
const _fpos = new THREE.Vector3();
const _fdir = new THREE.Vector3();
const _fq = new THREE.Quaternion();

function muzzleWorld(unit, outPos, outDir) {
  unit.model.muzzle.getWorldPosition(outPos);
  unit.model.muzzle.getWorldQuaternion(_fq);
  outDir.set(1, 0, 0).applyQuaternion(_fq);
}

let camKick = 0;

function fireGun(unit) {
  unit.cooldown = FIRE_INTERVAL;
  unit.fireSmoke = 2;
  unit.recoil = 0.22;
  muzzleWorld(unit, _fpos, _fdir);
  bullets.fire(unit, _fpos.clone().addScaledVector(_fdir, 0.15), _fdir.clone());
  fx.muzzleFlash(_fpos.clone(), _fdir.clone());
  audio.playAt('shot', _fpos, {
    volume: unit.isPlayer ? 0.9 : 0.75,
    rate: 0.94 + Math.random() * 0.12,
  });
  if (unit.isPlayer) {
    player.applyRecoil();
    camKick = 0.55;
  }
}

function tryPlayerFire() {
  if (!playerUnit.alive || playerUnit.cooldown > 0) return;
  fireGun(playerUnit);
}

// ---------------------------------------------------------------------------
// Damage, death, husk, respawn
// ---------------------------------------------------------------------------
function damage(unit, amount, at) {
  if (!unit.alive) return;
  unit.hp -= amount;
  audio.playAt('hit', at, { volume: 0.7, rate: 0.92 + Math.random() * 0.16 });
  if (unit === dummyUnit) drawDummyBar();
  if (unit.isPlayer) updateHpHud();
  if (unit.hp <= 0) die(unit);
}

function die(unit) {
  unit.alive = false;
  unit.deadT = 5;
  unit.hp = 0;
  unit.fireSmoke = 0;
  const pos = unit.model.root.position.clone();
  pos.y += 1.2;
  fx.explosion(pos);
  audio.playAt('explosion', pos, { volume: 1, ref: 14 });
  // black smoking husk
  unit.model.setCharred(true);
  unit.model.turret.rotation.y += (Math.random() - 0.5) * 1.4;
  unit.model.pitchGroup.rotation.z = -0.06;
  if (unit === dummyUnit) barSprite.visible = false;
  if (unit.isPlayer) {
    updateHpHud();
    elDeath.style.display = '';
  }
}

function respawn(unit) {
  unit.alive = true;
  unit.hp = unit.maxHp;
  unit.model.setCharred(false);
  unit.model.gun.position.x = 0;
  if (unit.isPlayer) {
    player.reset();
    viewYaw = SPAWN.player.heading;
    viewPitch = 0;
    camYaw = viewYaw;
    camPitch = 0;
    updateHpHud();
    elDeath.style.display = 'none';
  } else {
    resetDummyPose();
    dummyUnit.cooldown = 1.0;
    drawDummyBar();
    barSprite.visible = true;
  }
}

const _smokePos = new THREE.Vector3();
const _smokeDir = new THREE.Vector3();

function updateUnitCommon(unit, dt) {
  if (unit.alive) {
    if (unit.cooldown > 0) unit.cooldown -= dt;

    // barrel recoil spring
    unit.recoil = Math.max(0, unit.recoil - dt * (0.4 + unit.recoil * 9));
    unit.model.gun.position.x = -unit.recoil;

    // smoke drifts from the barrel for a couple seconds after each shot
    if (unit.fireSmoke > 0) {
      unit.fireSmoke -= dt;
      unit.smokeAcc += dt;
      while (unit.smokeAcc > 0.07) {
        unit.smokeAcc -= 0.07;
        muzzleWorld(unit, _smokePos, _smokeDir);
        fx.barrelSmoke(_smokePos, _smokeDir);
      }
    }
  } else {
    unit.deadT -= dt;
    unit.huskAcc += dt;
    while (unit.huskAcc > 0.13) {
      unit.huskAcc -= 0.13;
      fx.huskSmoke(unit.model.root.position);
    }
    if (unit.deadT <= 0) respawn(unit);
  }
}

// Keep the two hulls from overlapping (dummy is static; push the player out)
function resolveTankCollision() {
  const a = playerModel.root.position;
  const b = dummyModel.root.position;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 3.8 && d > 1e-4 && Math.abs(a.y - b.y) < 1.8) {
    const push = 3.8 - d;
    a.x += (dx / d) * push;
    a.z += (dz / d) * push;
    player.state.v *= 0.5;
  }
}

// ---------------------------------------------------------------------------
// Camera: locked to the crosshair at screen center. The view aims where the
// mouse says; the tank and turret do their best underneath it.
// ---------------------------------------------------------------------------
let camYaw = viewYaw;
let camPitch = 0;
const camPos = new THREE.Vector3(SPAWN.player.x - 10.5, 5.6, SPAWN.player.z);
const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function updateCamera(dt) {
  camKick = Math.max(0, camKick - camKick * 7 * dt - 0.05 * dt);
  camYaw = lerpAngle(camYaw, viewYaw, 1 - Math.exp(-16 * dt));
  camPitch += (viewPitch - camPitch) * (1 - Math.exp(-16 * dt));

  const cy = Math.cos(camYaw);
  const sy = -Math.sin(camYaw);
  const cp = Math.cos(camPitch);
  const sp = Math.sin(camPitch);
  const tp = playerModel.root.position;

  // Far focus point along the aim direction, from turret height
  const D = 45;
  _lookAt.set(
    tp.x + cp * cy * D,
    tp.y + 2.0 + sp * D,
    tp.z + cp * sy * D
  );

  const dist = 10.5 + camKick * 2.4;
  _desired.set(tp.x - cy * dist, tp.y + 5.6, tp.z - sy * dist);
  camPos.lerp(_desired, 1 - Math.exp(-9 * dt));
  camera.position.copy(camPos);
  camera.lookAt(_lookAt);
}

updateCamera(0.02);

// ---------------------------------------------------------------------------
// Aim: march the crosshair's center ray into the world to find the exact
// point under it — ground, wall, or enemy armor. The turret converges on
// that point, so settled shots land on the crosshair.
// ---------------------------------------------------------------------------
const _rayDir = new THREE.Vector3();
const _rayPt = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _pivot = new THREE.Vector3();

function aimRaycast(out) {
  _rayDir.copy(_lookAt).sub(camera.position).normalize();
  for (let d = 2; d < 150; d += 0.6) {
    _rayPt.copy(camera.position).addScaledVector(_rayDir, d);
    if (
      Math.abs(_rayPt.x) > ARENA.half ||
      Math.abs(_rayPt.z) > ARENA.half ||
      _rayPt.y <= heightAt(_rayPt.x, _rayPt.z) ||
      (dummyUnit.alive && dummyModel.hitTest(_rayPt)) ||
      _rayPt.y > 60
    ) break;
  }
  out.copy(_rayPt);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const input = readInput();

  // where is the crosshair pointing, and what angles does the turret need?
  aimRaycast(_aimPoint);
  playerModel.pitchGroup.getWorldPosition(_pivot);
  const adx = _aimPoint.x - _pivot.x;
  const adz = _aimPoint.z - _pivot.z;
  const aimWorldYaw = Math.atan2(-adz, adx);
  const aimPitch = Math.atan2(
    _aimPoint.y - _pivot.y,
    Math.max(1, Math.hypot(adx, adz))
  );

  if (playerUnit.alive) {
    player.update(dt, input, aimWorldYaw, aimPitch);
    resolveTankCollision();
  }

  // The dummy doesn't track — it just fires straight ahead on its interval
  if (dummyUnit.alive && playerUnit.alive && dummyUnit.cooldown <= 0) {
    fireGun(dummyUnit);
  }

  updateUnitCommon(playerUnit, dt);
  updateUnitCommon(dummyUnit, dt);

  bullets.update(
    dt,
    units,
    (unit, pos) => {
      fx.impact(pos.clone());
      damage(unit, BULLET.damage, pos);
    },
    (pos) => {
      fx.impact(pos.clone());
    }
  );

  fx.update(dt);
  updateCamera(dt);

  sun.position.copy(playerModel.root.position).add(SUN_OFFSET);
  sun.target.position.copy(playerModel.root.position);

  // engine follows throttle
  const speedFrac = Math.abs(player.state.v) / SPEC.maxForward;
  engine.update(
    0.72 + speedFrac * 0.65,
    playerUnit.alive ? 0.16 + speedFrac * 0.14 : 0
  );

  // HUD
  fpsTime += dt;
  fpsFrames += 1;
  if (fpsTime >= 0.5) {
    elFps.textContent = String(Math.round(fpsFrames / fpsTime));
    fpsTime = 0;
    fpsFrames = 0;
  }
  elSpeed.textContent = String(Math.round(Math.abs(player.state.v) * 8));
  elReload.style.transform = `scaleX(${1 - Math.max(0, playerUnit.cooldown) / FIRE_INTERVAL})`;
  if (!playerUnit.alive) {
    elDeath.textContent = `destroyed \u00b7 respawning in ${Math.max(1, Math.ceil(playerUnit.deadT))}`;
  }

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
