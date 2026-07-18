import * as THREE from 'three';
import { createArena, SPAWN_SLOTS, heightAt, ARENA } from './map.js';
import { createTankModel, SPEC } from './tank.js';
import { createPlayerController } from './player.js';
import { createBullets, BULLET } from './bullets.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { readInput, readFly } from './controls.js';
import { createMenu } from './menu.js';
import { createRemoteManager } from './remote.js';
import { createPhysics } from './physics.js';
import { createEditor } from './editor.js';
import { createColorWheel } from './colorwheel.js';
import * as net from './net.js';

const FIRE_INTERVAL = 2.5;
const YAW_SENS = 0.0032;
const PITCH_SENS = 0.002;
const CAM_PITCH_LIM = 1.35;
const FLY_SPEED = 26;
const EDITOR_SPAWN = { x: 0, z: -14, heading: Math.PI / 2, y: 0 };

// ---------------------------------------------------------------------------
// Renderer + scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true; // decals are trimmed to the face they sit on
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
const arenaGroup = createArena(scene);
const physics = createPhysics();
const fx = createFx(scene);
const audio = createAudio(camera, scene);
const bullets = createBullets(scene, fx);
const remote = createRemoteManager({ scene, fx, audio, physics });
const editor = createEditor({ scene, physics });

// compile every shader / effect during the menu so the first shot in a
// match never hitches
fx.prewarm();
bullets.prewarm();

// Local player
const playerModel = createTankModel();
playerModel.root.visible = false; // hidden until a match starts
scene.add(playerModel.root);
const player = createPlayerController(playerModel, physics);

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
let phase = 'menu'; // 'menu' | 'lobby' | 'playing' | 'editor'
let editorMode = 'drive'; // 'drive' | 'fly'
let lobbyPlayers = {}; // pid -> latest node value (stub or full state)
let stateAcc = 0;

function groundYAt(x, z) {
  return phase === 'editor' ? 0 : heightAt(x, z);
}

// bullet environments: the arena vs the editor's flat build ground
const ENV_ARENA = { groundAt: heightAt, half: ARENA.half - 0.4, solidAt: null };
const ENV_EDITOR = {
  groundAt: () => 0,
  half: editor.boundsHalf,
  solidAt: (p) => editor.solidAt(p),
};

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
const elExit = document.getElementById('editor-exit');
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
  onEditor: () => enterEditor(),
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
// Editor mode
// ---------------------------------------------------------------------------
function enterEditor() {
  phase = 'editor';
  editorMode = 'drive';
  document.body.classList.add('editor');
  menu.hideAll();
  arenaGroup.visible = false;
  physics.setArenaActive(false);
  editor.enter();
  spawnLocal(editorSpawnPoint());
}

function leaveEditor() {
  editor.exit();
  arenaGroup.visible = true;
  physics.setArenaActive(true);
  document.body.classList.remove('editor');
  bullets.clear();
  phase = 'menu';
  local.alive = false;
  playerModel.root.visible = false;
  playerModel.setCharred(false);
  elDeath.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  menu.show('scr-main');
}

elExit.addEventListener('click', () => {
  if (phase === 'editor') leaveEditor();
});

// ---------------------------------------------------------------------------
// Map save / load toolbar — this is the map-making pipeline for the game
// ---------------------------------------------------------------------------
const elMapName = document.getElementById('map-name');
const elMapList = document.getElementById('map-list');
const elMapStatus = document.getElementById('map-status');
const elMapFile = document.getElementById('map-file');
const MAP_PREFIX = 'tankmap:';
let statusTimer = 0;

function mapStatus(msg) {
  elMapStatus.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { elMapStatus.textContent = ''; }, 2800);
}

function cleanName(raw, fallback) {
  const name = String(raw || '').trim().replace(/[^\w\- ]/g, '').slice(0, 24);
  return name || fallback;
}

function refreshMapList(selectName) {
  const names = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(MAP_PREFIX)) names.push(k.slice(MAP_PREFIX.length));
    }
  } catch { /* storage unavailable */ }
  names.sort();
  elMapList.innerHTML = names.length
    ? names.map((n) => `<option value="${n}">${n}</option>`).join('')
    : '<option value="">no saved maps</option>';
  if (selectName && names.includes(selectName)) elMapList.value = selectName;
}
refreshMapList();

function currentMapData(name) {
  return { name, ...editor.serialize() };
}

document.getElementById('map-save').addEventListener('click', () => {
  const name = cleanName(elMapName.value, 'untitled');
  elMapName.value = name;
  try {
    localStorage.setItem(MAP_PREFIX + name, JSON.stringify(currentMapData(name)));
    refreshMapList(name);
    mapStatus(`saved "${name}"`);
  } catch {
    mapStatus('storage unavailable');
  }
});

document.getElementById('map-load').addEventListener('click', () => {
  const name = elMapList.value;
  if (!name) { mapStatus('nothing to load'); return; }
  if (!confirm(`Load "${name}"? Unsaved changes will be lost.`)) return;
  try {
    const data = JSON.parse(localStorage.getItem(MAP_PREFIX + name));
    const n = editor.loadData(data);
    elMapName.value = name;
    mapStatus(`loaded "${name}" \u00b7 ${n} pieces`);
  } catch {
    mapStatus('could not load that map');
  }
});

document.getElementById('map-export').addEventListener('click', () => {
  const name = cleanName(elMapName.value, 'map');
  const blob = new Blob(
    [JSON.stringify(currentMapData(name), null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  mapStatus(`exported ${name}.json`);
});

document.getElementById('map-import').addEventListener('click', () => elMapFile.click());

elMapFile.addEventListener('change', () => {
  const file = elMapFile.files && elMapFile.files[0];
  elMapFile.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm(`Import "${file.name}"? Unsaved changes will be lost.`)) return;
      const n = editor.loadData(data);
      elMapName.value = cleanName(data.name || file.name.replace(/\.json$/i, ''), 'imported');
      mapStatus(`imported \u00b7 ${n} pieces`);
    } catch {
      mapStatus('not a valid map file');
    }
  };
  reader.readAsText(file);
});

document.getElementById('map-clear').addEventListener('click', () => {
  if (!confirm('Clear the whole board?')) return;
  editor.clearAll();
  mapStatus('cleared');
});

// ---- decal brush: shape buttons + colour wheel popover --------------------
const decalShapeBtns = {
  rect: document.getElementById('decal-rect'),
  circle: document.getElementById('decal-circle'),
  triangle: document.getElementById('decal-triangle'),
};
function selectDecalShape(shape) {
  editor.setDecalShape(shape);
  for (const [s, btn] of Object.entries(decalShapeBtns)) {
    btn.classList.toggle('on', s === shape);
  }
}
for (const [shape, btn] of Object.entries(decalShapeBtns)) {
  btn.addEventListener('click', () => selectDecalShape(shape));
}
selectDecalShape('rect');

const wheelPop = document.getElementById('wheel-pop');
const decalSwatch = document.getElementById('decal-swatch');
createColorWheel(
  document.getElementById('wheel-canvas'),
  document.getElementById('wheel-value'),
  decalSwatch,
  (hex) => editor.setDecalColor(hex)
);
decalSwatch.addEventListener('click', (e) => {
  e.stopPropagation();
  wheelPop.classList.toggle('hidden');
});
document.addEventListener('mousedown', (e) => {
  if (!wheelPop.classList.contains('hidden') &&
      !wheelPop.contains(e.target) && e.target !== decalSwatch) {
    wheelPop.classList.add('hidden');
  }
});


// fly cam
let flyYaw = 0;
let flyPitch = 0;
const flyPos = new THREE.Vector3();
const _flyDir = new THREE.Vector3();

function toggleFly() {
  if (editorMode === 'drive') {
    editorMode = 'fly';
    flyPos.copy(camera.position);
    flyYaw = camYaw;
    flyPitch = camPitch;
  } else {
    editorMode = 'drive';
    editor.hideGhost();
    viewYaw = flyYaw;
    viewPitch = THREE.MathUtils.clamp(flyPitch, -CAM_PITCH_LIM, CAM_PITCH_LIM);
    camYaw = viewYaw;
    camPitch = viewPitch;
    camPos.copy(camera.position);
  }
}

function updateFly(dt) {
  const f = readFly();
  const cy = Math.cos(flyYaw);
  const sy = -Math.sin(flyYaw);
  const cp = Math.cos(flyPitch);
  const sp = Math.sin(flyPitch);
  _flyDir.set(cp * cy, sp, cp * sy);
  // move along the view, strafe on the horizontal right, rise on world up
  flyPos.x += (_flyDir.x * f.fwd + Math.sin(flyYaw) * f.strafe) * FLY_SPEED * dt;
  flyPos.y += (_flyDir.y * f.fwd + f.up) * FLY_SPEED * dt;
  flyPos.z += (_flyDir.z * f.fwd + Math.cos(flyYaw) * f.strafe) * FLY_SPEED * dt;
  flyPos.y = Math.max(0.6, Math.min(90, flyPos.y));
  camera.position.copy(flyPos);
  _lookAt.copy(flyPos).add(_flyDir);
  camera.lookAt(_lookAt);
}

window.addEventListener('keydown', (e) => {
  if (phase !== 'editor') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.code === 'KeyF') {
    toggleFly();
    return;
  }
  if (editorMode !== 'fly' || document.pointerLockElement !== canvas) return;
  if (e.code === 'Digit1') editor.setTool('wall');
  else if (e.code === 'Digit2') editor.setTool('platform');
  else if (e.code === 'Digit3') editor.setTool('slope');
  else if (e.code === 'Digit4') editor.setTool('spawn');
  else if (e.code === 'Digit5') editor.setTool('decal');
  else if (e.code === 'KeyR') editor.rotateGhost(e.ctrlKey ? -1 : 1);
  else if (e.code === 'KeyX') editor.deleteAtCursor();
  else return;
  e.preventDefault(); // ctrl+R is a page reload otherwise
});

window.addEventListener('wheel', (e) => {
  if (phase !== 'editor' || editorMode !== 'fly') return;
  if (document.pointerLockElement !== canvas) return;
  e.preventDefault();
  const dir = e.deltaY < 0 ? 1 : -1;
  editor.adjust(e.ctrlKey ? 'h' : e.shiftKey ? 'w' : 'l', dir);
}, { passive: false });

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

function editorSpawnPoint() {
  const spawns = editor.getSpawns();
  if (!spawns.length) return EDITOR_SPAWN;
  return spawns[Math.floor(Math.random() * spawns.length)];
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
  if (phase === 'playing') pushState();
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
  const q = playerModel.root.quaternion;
  net.sendState({
    x: r3(p.x),
    y: r3(p.y),
    z: r3(p.z),
    qx: r3(q.x),
    qy: r3(q.y),
    qz: r3(q.z),
    qw: r3(q.w),
    ty: r3(player.state.turretYaw),
    tp: r3(player.state.pitch),
    hp: Math.max(0, Math.round(local.hp)),
    al: local.alive,
    t: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Mouse aim: camera IS the crosshair
// ---------------------------------------------------------------------------
let viewYaw = 0;
let viewPitch = 0;
let lastAimYaw = 0;
let lastAimPitch = 0;

const canvas = renderer.domElement;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (phase !== 'playing' && phase !== 'editor') return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    return;
  }
  if (phase === 'editor' && editorMode === 'fly') {
    editor.place();
    return;
  }
  tryPlayerFire();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    elHint.style.display = 'none';
    hidePause();
  } else if (phase === 'playing' || phase === 'editor') {
    // Esc (or anything else) broke pointer lock mid-game: offer a way out.
    // The browser reserves Esc while locked, so this is the only hook.
    showPause();
  } else {
    elHint.style.display = '';
    hidePause();
  }
});

// ---------------------------------------------------------------------------
// Pause menu: appears whenever pointer lock drops in a match or the editor
// ---------------------------------------------------------------------------
const elPause = document.getElementById('pausemenu');
let pauseShownAt = 0;

function showPause() {
  elPause.classList.remove('hidden');
  elHint.style.display = 'none';
  pauseShownAt = performance.now();
}

function hidePause() {
  elPause.classList.add('hidden');
}

document.getElementById('pause-resume').addEventListener('click', () => {
  // pointerlockchange hides the menu once the lock actually lands
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => { /* browser cooldown — click again */ });
});

document.getElementById('pause-exit').addEventListener('click', () => {
  hidePause();
  if (phase === 'editor') leaveEditor();
  else if (phase === 'playing') leaveToMenu();
});

// Esc while already unlocked (e.g. after using the editor toolbar) toggles it
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (phase !== 'playing' && phase !== 'editor') return;
  if (document.pointerLockElement === canvas) return; // browser handles that Esc
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  // swallow the same Esc press that just broke pointer lock (some browsers
  // deliver it after the pointerlockchange that opened the menu)
  if (performance.now() - pauseShownAt < 250) return;
  if (elPause.classList.contains('hidden')) showPause();
  else hidePause();
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (phase === 'editor' && editorMode === 'fly') {
    flyYaw -= e.movementX * YAW_SENS;
    flyPitch = THREE.MathUtils.clamp(flyPitch - e.movementY * PITCH_SENS, -1.5, 1.5);
    return;
  }
  if ((phase !== 'playing' && phase !== 'editor') || !local.alive) return;
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

function tryPlayerFire() {
  if (!local.alive || local.cooldown > 0) return;
  local.cooldown = FIRE_INTERVAL;
  local.fireSmoke = 2;
  local.recoil = 0.22;
  muzzleWorld(local, _fpos, _fdir);
  bullets.fire(local, _fpos.clone().addScaledVector(_fdir, 0.15), _fdir.clone());
  fx.muzzleFlash(_fpos.clone(), _fdir.clone());
  audio.playAt('shot', _fpos, { volume: 0.9, rate: 0.94 + Math.random() * 0.12 });
  player.applyRecoil(_fdir, _fpos);
  if (phase === 'playing') {
    net.sendShot({
      x: r3(_fpos.x), y: r3(_fpos.y), z: r3(_fpos.z),
      dx: r3(_fdir.x), dy: r3(_fdir.y), dz: r3(_fdir.z),
    });
  }
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
  else if (phase === 'playing') pushState();
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
  if (phase === 'playing') pushState();
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

    // fell off the world (editor edges) — quiet reset
    if (playerModel.root.position.y < -40) {
      spawnLocal(phase === 'editor' ? editorSpawnPoint() : pickFarSlot());
    }
  } else if (playerModel.root.visible) {
    local.deadT -= dt;
    local.huskAcc += dt;
    while (local.huskAcc > 0.13) {
      local.huskAcc -= 0.13;
      fx.huskSmoke(playerModel.root.position);
    }
    if (local.deadT <= 0) {
      spawnLocal(phase === 'editor' ? editorSpawnPoint() : pickFarSlot());
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

function updateCamera() {
  // no easing, no fire kick: the camera is the crosshair, so it goes exactly
  // where the mouse says, this frame. Recoil is felt through the hull moving
  // under it, not by shoving the viewpoint around.
  camYaw = viewYaw;
  camPitch = viewPitch;

  const cy = Math.cos(camYaw);
  const sy = -Math.sin(camYaw);
  const cp = Math.cos(camPitch);
  const sp = Math.sin(camPitch);
  const tp = playerModel.root.position;

  const D = 45;
  _lookAt.set(
    tp.x + cp * cy * D,
    tp.y + 2.0 + sp * D,
    tp.z + cp * sy * D
  );

  const dist = 10.5;
  let camY = tp.y + 5.6 - sp * 9;
  _desired.set(tp.x - cy * dist, 0, tp.z - sy * dist);
  camY = Math.max(camY, groundYAt(_desired.x, _desired.z) + 0.8, tp.y + 0.9);
  _desired.y = camY;

  camPos.copy(_desired);
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
// Aim: march the crosshair ray into the world — ground, wall, placed piece,
// or enemy armor. The turret converges on that exact point.
// ---------------------------------------------------------------------------
const _rayDir = new THREE.Vector3();
const _rayPt = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _pivot = new THREE.Vector3();

function aimRaycast(out) {
  _rayDir.copy(_lookAt).sub(camera.position).normalize();
  const inEditor = phase === 'editor';
  const half = inEditor ? editor.boundsHalf : ARENA.half;
  const targets = inEditor ? [] : remote.targets();
  for (let d = 2; d < 170; d += 0.6) {
    _rayPt.copy(camera.position).addScaledVector(_rayDir, d);
    if (
      Math.abs(_rayPt.x) > half ||
      Math.abs(_rayPt.z) > half ||
      _rayPt.y <= groundYAt(_rayPt.x, _rayPt.z) ||
      _rayPt.y > 90 ||
      (inEditor && editor.solidAt(_rayPt))
    ) break;
    let hit = false;
    for (const ru of targets) {
      if (!ru.alive || !ru.model.root.visible) continue;
      const ddx = _rayPt.x - ru.pos.x;
      const ddz = _rayPt.z - ru.pos.z;
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
  const inGame = phase === 'playing' || phase === 'editor';

  if (inGame) {
    const input = readInput();
    const flying = phase === 'editor' && editorMode === 'fly';

    if (phase === 'playing') remote.update(dt); // interpolate + kinematic colliders

    if (flying) {
      updateFly(dt);
      editor.updateGhost(camera);
      if (local.alive) player.update(dt, { throttle: 0, turn: 0 }, lastAimYaw, lastAimPitch);
    } else {
      aimRaycast(_aimPoint);
      playerModel.pitchGroup.getWorldPosition(_pivot);
      const adx = _aimPoint.x - _pivot.x;
      const adz = _aimPoint.z - _pivot.z;
      lastAimYaw = Math.atan2(-adz, adx);
      lastAimPitch = Math.atan2(
        _aimPoint.y - _pivot.y,
        Math.max(1, Math.hypot(adx, adz))
      );
      if (local.alive) player.update(dt, input, lastAimYaw, lastAimPitch);
    }

    physics.step(dt);
    player.postStep();

    // stuck upside down long enough -> the crew bails and it cooks off
    if (local.alive && player.state.flipT > 4) {
      localDie();
    }

    updateLocalUnit(dt);

    bullets.update(
      dt,
      phase === 'playing' ? [local, ...remote.targets()] : [local],
      (unit, pos) => {
        fx.impact(pos.clone());
        if (unit === local) localDamage(BULLET.damage, pos);
        else audio.playAt('hit', pos, { volume: 0.5, rate: 0.92 + Math.random() * 0.16 });
      },
      (pos) => {
        fx.impact(pos.clone());
      },
      phase === 'editor' ? ENV_EDITOR : ENV_ARENA
    );

    fx.update(dt);
    if (!flying) updateCamera();

    const sunAnchor = flying ? camera.position : playerModel.root.position;
    sun.position.copy(sunAnchor).add(SUN_OFFSET);
    sun.target.position.copy(sunAnchor);

    const speedFrac = Math.abs(player.state.v) / SPEC.maxForward;
    engine.update(
      0.72 + speedFrac * 0.65,
      local.alive && !flying ? 0.16 + speedFrac * 0.14 : 0
    );

    if (phase === 'playing') {
      stateAcc += dt;
      if (stateAcc > 1 / 12) {
        stateAcc = 0;
        pushState();
      }
    }

    elSpeed.textContent = String(Math.round(Math.abs(player.state.v) * 8));
    elReload.style.transform = `scaleX(${1 - Math.max(0, local.cooldown) / FIRE_INTERVAL})`;
    if (!local.alive) {
      elDeath.textContent = `destroyed \u00b7 respawning in ${Math.max(1, Math.ceil(local.deadT))}`;
    }
  } else {
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
