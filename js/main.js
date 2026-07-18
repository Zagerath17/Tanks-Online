import * as THREE from 'three';
import { createArena, SPAWN_SLOTS, heightAt, ARENA } from './map.js';
import { createTankModel, SPEC } from './tank.js';
import { createPlayerController } from './player.js';
import { createBullets, BULLET } from './bullets.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { readInput } from './controls.js';
import { createMenu } from './menu.js';
import { createRemoteManager } from './remote.js';
import * as net from './net.js';

const FIRE_INTERVAL = 2.5;
const YAW_SENS = 0.0032;
const PITCH_SENS = 0.002;
const CAM_PITCH_LIM = 1.35; // the view goes (almost) anywhere vertically now

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
const bullets = createBullets(scene, fx);
const remote = createRemoteManager({ scene, fx, audio });

// Local player
const playerModel = createTankModel();
playerModel.root.visible = false; // hidden until a match starts
scene.add(playerModel.root);
const player = createPlayerController(playerModel);

const local = {
  id: net.getMyId(),
  isLocal: true,
  model: playerModel,
  alive: false,
  hp: 1000,
  maxHp: 1000,
  cooldown: 0,
  fireSmoke: 0,
  smokeAcc: 0,
  huskAcc: 0,
  deadT: 0,
  recoil: 0,
};

const engine = audio.engineLoop(playerModel.root);

// ---------------------------------------------------------------------------
// Phase + lobby bookkeeping
// ---------------------------------------------------------------------------
let phase = 'menu'; // 'menu' | 'lobby' | 'playing'
let lobbyPlayers = {}; // pid -> latest node value (stub or full state)
let stateAcc = 0;

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
  const f = Math.max(0, local.hp / local.maxHp);
  elHpFill.style.width = `${f * 100}%`;
  elHpFill.style.background =
    f > 0.5 ? 'linear-gradient(90deg,#7fae57,#9cc36e)'
      : f > 0.25 ? 'linear-gradient(90deg,#c9a24a,#dcb85e)'
        : 'linear-gradient(90deg,#b04a40,#d05a4e)';
  elHpNum.textContent = String(Math.max(0, Math.round(local.hp)));
}

// ---------------------------------------------------------------------------
// Menu + networking flow
// ---------------------------------------------------------------------------
const CONFIG_MSG = 'multiplayer needs firebase \u2014 fill in js/firebase-config.js (see README)';

const menu = createMenu({
  customNotice: () => (net.netConfigured() ? '' : CONFIG_MSG),
  onCreate: async () => {
    if (!net.netConfigured()) { menu.err('custom-err', CONFIG_MSG); return; }
    try {
      lobbyPlayers = {};
      await net.createLobby();
      enterLobby();
    } catch (e) {
      menu.err('custom-err', String(e.message || e));
    }
  },
  onJoin: async (code) => {
    if (!net.netConfigured()) { menu.err('join-err', CONFIG_MSG); return; }
    try {
      lobbyPlayers = {};
      await net.joinLobby(code);
      enterLobby();
    } catch (e) {
      menu.err('join-err', String(e.message || e));
    }
  },
  onStart: () => net.startGame(),
  onLeave: () => leaveToMenu(),
});

function refreshLobbyUi() {
  menu.setLobby({
    code: net.getLobbyCode() || '----',
    players: lobbyPlayers,
    hostId: net.getHostId(),
    myId: net.getMyId(),
    isHost: net.isHost(),
  });
}

function enterLobby() {
  phase = 'lobby';
  net.subscribe({
    onState: (state) => {
      if (state === 'playing' && phase !== 'playing') beginMatch();
    },
    onPlayer: (pid, data) => {
      lobbyPlayers[pid] = data;
      if (phase === 'lobby') refreshLobbyUi();
      if (phase === 'playing' && pid !== net.getMyId()) remote.applyState(pid, data);
    },
    onPlayerGone: (pid) => {
      delete lobbyPlayers[pid];
      if (phase === 'lobby') refreshLobbyUi();
      remote.removePlayer(pid);
    },
    onShot: (pid, s) => {
      if (pid === net.getMyId() || phase !== 'playing') return;
      const pos = new THREE.Vector3(s.x, s.y, s.z);
      const dir = new THREE.Vector3(s.dx, s.dy, s.dz).normalize();
      const ru = remote.shotFrom(pid);
      fx.muzzleFlash(pos.clone(), dir.clone());
      audio.playAt('shot', pos, { volume: 0.75, rate: 0.94 + Math.random() * 0.12 });
      bullets.fire(ru || {}, pos.clone().addScaledVector(dir, 0.15), dir);
    },
  });
  refreshLobbyUi();
  menu.show('scr-lobby');
}

function leaveToMenu() {
  net.leaveLobby();
  remote.clear();
  bullets.clear();
  lobbyPlayers = {};
  phase = 'menu';
  local.alive = false;
  playerModel.root.visible = false;
  playerModel.setCharred(false);
  elDeath.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  menu.show('scr-main');
}

// ---------------------------------------------------------------------------
// Spawning: even spread at match start, farthest-from-everyone on respawn
// ---------------------------------------------------------------------------
function startSlot() {
  const ids = Object.keys(lobbyPlayers).sort(
    (a, b) => ((lobbyPlayers[a] && lobbyPlayers[a].joined) || 0) - ((lobbyPlayers[b] && lobbyPlayers[b].joined) || 0)
  );
  const i = Math.max(0, ids.indexOf(net.getMyId()));
  const n = Math.max(1, ids.length);
  return SPAWN_SLOTS[Math.round((i * 12) / n) % 12];
}

function pickFarSlot() {
  const others = remote.alivePositions();
  if (!others.length) return SPAWN_SLOTS[Math.floor(Math.random() * 12)];
  let best = SPAWN_SLOTS[0];
  let bestD = -1;
  for (const s of SPAWN_SLOTS) {
    let dMin = Infinity;
    for (const o of others) dMin = Math.min(dMin, Math.hypot(s.x - o.x, s.z - o.z));
    if (dMin > bestD) {
      bestD = dMin;
      best = s;
    }
  }
  return best;
}

function spawnLocal(slot) {
  player.reset(slot);
  playerModel.root.visible = true;
  local.alive = true;
  local.hp = local.maxHp;
  local.cooldown = 0;
  local.fireSmoke = 0;
  local.recoil = 0;
  playerModel.setCharred(false);
  playerModel.gun.position.x = 0;
  viewYaw = slot.heading;
  viewPitch = 0;
  camYaw = viewYaw;
  camPitch = 0;
  updateHpHud();
  elDeath.style.display = 'none';
  pushState();
}

function beginMatch() {
  phase = 'playing';
  menu.hideAll();
  spawnLocal(startSlot());
}

// ---------------------------------------------------------------------------
// State sync
// ---------------------------------------------------------------------------
const r3 = (v) => Math.round(v * 1000) / 1000;

function pushState() {
  const p = playerModel.root.position;
  net.sendState({
    x: r3(p.x),
    y: r3(p.y),
    z: r3(p.z),
    h: r3(player.state.heading),
    gp: r3(player.state.groundPitch),
    gr: r3(player.state.groundRoll),
    ty: r3(player.state.turretYaw),
    tp: r3(player.state.pitch),
    hp: Math.max(0, Math.round(local.hp)),
    al: local.alive,
    t: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Mouse aim: camera IS the crosshair; the view goes anywhere, the turret
// does its best within its own limits
// ---------------------------------------------------------------------------
let viewYaw = 0;
let viewPitch = 0;

const canvas = renderer.domElement;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || phase !== 'playing') return;
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
  if (phase !== 'playing' || !local.alive) return;
  viewYaw -= e.movementX * YAW_SENS;
  viewPitch = THREE.MathUtils.clamp(
    viewPitch - e.movementY * PITCH_SENS, -CAM_PITCH_LIM, CAM_PITCH_LIM
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

function tryPlayerFire() {
  if (!local.alive || local.cooldown > 0) return;
  local.cooldown = FIRE_INTERVAL;
  local.fireSmoke = 2;
  local.recoil = 0.22;
  muzzleWorld(local, _fpos, _fdir);
  bullets.fire(local, _fpos.clone().addScaledVector(_fdir, 0.15), _fdir.clone());
  fx.muzzleFlash(_fpos.clone(), _fdir.clone());
  audio.playAt('shot', _fpos, { volume: 0.9, rate: 0.94 + Math.random() * 0.12 });
  player.applyRecoil();
  camKick = 0.55;
  net.sendShot({
    x: r3(_fpos.x), y: r3(_fpos.y), z: r3(_fpos.z),
    dx: r3(_fdir.x), dy: r3(_fdir.y), dz: r3(_fdir.z),
  });
}

// ---------------------------------------------------------------------------
// Local damage, death, husk, respawn
// ---------------------------------------------------------------------------
function localDamage(amount, at) {
  if (!local.alive) return;
  local.hp -= amount;
  audio.playAt('hit', at, { volume: 0.7, rate: 0.92 + Math.random() * 0.16 });
  updateHpHud();
  if (local.hp <= 0) localDie();
  else pushState();
}

function localDie() {
  local.alive = false;
  local.deadT = 5;
  local.hp = 0;
  local.fireSmoke = 0;
  const pos = playerModel.root.position.clone();
  pos.y += 1.2;
  fx.explosion(pos);
  audio.playAt('explosion', pos, { volume: 1, ref: 14 });
  playerModel.setCharred(true);
  playerModel.turret.rotation.y += (Math.random() - 0.5) * 1.4;
  playerModel.pitchGroup.rotation.z = -0.06;
  updateHpHud();
  elDeath.style.display = '';
  pushState();
}

function updateLocalUnit(dt) {
  if (local.alive) {
    if (local.cooldown > 0) local.cooldown -= dt;

    local.recoil = Math.max(0, local.recoil - dt * (0.4 + local.recoil * 9));
    playerModel.gun.position.x = -local.recoil;

    if (local.fireSmoke > 0) {
      local.fireSmoke -= dt;
      local.smokeAcc += dt;
      while (local.smokeAcc > 0.07) {
        local.smokeAcc -= 0.07;
        muzzleWorld(local, _fpos, _fdir);
        fx.barrelSmoke(_fpos, _fdir);
      }
    }
  } else if (phase === 'playing' && playerModel.root.visible) {
    local.deadT -= dt;
    local.huskAcc += dt;
    while (local.huskAcc > 0.13) {
      local.huskAcc -= 0.13;
      fx.huskSmoke(playerModel.root.position);
    }
    if (local.deadT <= 0) spawnLocal(pickFarSlot());
  }
}

// Push the local hull out of any remote hull (their client moves their own)
function resolveTankCollisions() {
  const a = playerModel.root.position;
  for (const ru of remote.targets()) {
    if (!ru.model.root.visible) continue;
    const dx = a.x - ru.cur.x;
    const dz = a.z - ru.cur.z;
    const d = Math.hypot(dx, dz);
    if (d < 3.8 && d > 1e-4 && Math.abs(a.y - ru.cur.y) < 1.8) {
      const push = 3.8 - d;
      a.x += (dx / d) * push;
      a.z += (dz / d) * push;
      player.state.v *= 0.5;
    }
  }
}

// ---------------------------------------------------------------------------
// Camera: locked to the center crosshair, vertically unlimited
// ---------------------------------------------------------------------------
let camYaw = 0;
let camPitch = 0;
const camPos = new THREE.Vector3(0, 26, 60);
const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3(0, 2, 0);

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
  // Aiming down lifts the camera, aiming up drops it toward the deck
  let camY = tp.y + 5.6 - sp * 9;
  _desired.set(tp.x - cy * dist, 0, tp.z - sy * dist);
  camY = Math.max(camY, heightAt(_desired.x, _desired.z) + 0.8, tp.y + 0.9);
  _desired.y = camY;

  camPos.lerp(_desired, 1 - Math.exp(-9 * dt));
  camera.position.copy(camPos);
  camera.lookAt(_lookAt);
}

let idleAngle = 0;
function updateIdleCamera(dt) {
  idleAngle += dt * 0.07;
  camera.position.set(Math.cos(idleAngle) * 46, 20, Math.sin(idleAngle) * 46);
  camera.lookAt(0, 2, 0);
  camPos.copy(camera.position);
}

// ---------------------------------------------------------------------------
// Aim: march the crosshair ray into the world — ground, wall, or enemy armor.
// The turret converges on that exact point (within its own limits).
// ---------------------------------------------------------------------------
const _rayDir = new THREE.Vector3();
const _rayPt = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _pivot = new THREE.Vector3();

function aimRaycast(out) {
  _rayDir.copy(_lookAt).sub(camera.position).normalize();
  const targets = remote.targets();
  for (let d = 2; d < 170; d += 0.6) {
    _rayPt.copy(camera.position).addScaledVector(_rayDir, d);
    if (
      Math.abs(_rayPt.x) > ARENA.half ||
      Math.abs(_rayPt.z) > ARENA.half ||
      _rayPt.y <= heightAt(_rayPt.x, _rayPt.z) ||
      _rayPt.y > 90
    ) break;
    let hit = false;
    for (const ru of targets) {
      if (!ru.alive || !ru.model.root.visible) continue;
      const ddx = _rayPt.x - ru.cur.x;
      const ddz = _rayPt.z - ru.cur.z;
      if (ddx * ddx + ddz * ddz < 30 && ru.model.hitTest(_rayPt)) {
        hit = true;
        break;
      }
    }
    if (hit) break;
  }
  out.copy(_rayPt);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (phase === 'playing') {
    const input = readInput();

    aimRaycast(_aimPoint);
    playerModel.pitchGroup.getWorldPosition(_pivot);
    const adx = _aimPoint.x - _pivot.x;
    const adz = _aimPoint.z - _pivot.z;
    const aimWorldYaw = Math.atan2(-adz, adx);
    const aimPitch = Math.atan2(
      _aimPoint.y - _pivot.y,
      Math.max(1, Math.hypot(adx, adz))
    );

    if (local.alive) {
      player.update(dt, input, aimWorldYaw, aimPitch);
      resolveTankCollisions();
    }

    updateLocalUnit(dt);
    remote.update(dt);

    bullets.update(
      dt,
      [local, ...remote.targets()],
      (unit, pos) => {
        fx.impact(pos.clone());
        if (unit === local) localDamage(BULLET.damage, pos);
        else audio.playAt('hit', pos, { volume: 0.5, rate: 0.92 + Math.random() * 0.16 });
      },
      (pos) => {
        fx.impact(pos.clone());
      }
    );

    fx.update(dt);
    updateCamera(dt);

    sun.position.copy(playerModel.root.position).add(SUN_OFFSET);
    sun.target.position.copy(playerModel.root.position);

    const speedFrac = Math.abs(player.state.v) / SPEC.maxForward;
    engine.update(
      0.72 + speedFrac * 0.65,
      local.alive ? 0.16 + speedFrac * 0.14 : 0
    );

    stateAcc += dt;
    if (stateAcc > 1 / 12) {
      stateAcc = 0;
      pushState();
    }

    elSpeed.textContent = String(Math.round(Math.abs(player.state.v) * 8));
    elReload.style.transform = `scaleX(${1 - Math.max(0, local.cooldown) / FIRE_INTERVAL})`;
    if (!local.alive) {
      elDeath.textContent = `destroyed \u00b7 respawning in ${Math.max(1, Math.ceil(local.deadT))}`;
    }
  } else {
    // menu / lobby: slow orbit over the arena
    updateIdleCamera(dt);
    fx.update(dt);
    remote.update(dt);
    engine.update(0.72, 0);
    sun.position.copy(SUN_OFFSET);
    sun.target.position.set(0, 0, 0);
  }

  fpsTime += dt;
  fpsFrames += 1;
  if (fpsTime >= 0.5) {
    elFps.textContent = String(Math.round(fpsFrames / fpsTime));
    fpsTime = 0;
    fpsFrames = 0;
  }

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
