import * as THREE from 'three';
import { createArena, SPAWN_SLOTS, heightAt, ARENA } from './map.js';
import { createTankModel, SPEC, TURRET_SPECS, HULLS as HULL_STATS } from './tank.js';
import { createPlayerController } from './player.js';
import { createBullets, BULLET } from './bullets.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { readInput, readFly } from './controls.js';
import { createMenu } from './menu.js';
import { createRemoteManager } from './remote.js';
import { createPhysics } from './physics.js';
import { createTreadMarks } from './tracks.js';
import { createArcBeam, createRailBeam, createProngArc } from './arc.js';
import { createEditor } from './editor.js';
import { createColorWheel } from './colorwheel.js';
import { createGarage } from './garage.js';
import { TURRETS, HULLS, SKINS, selection, loadSelection, saveSelection, currentSkin, currentTurret, currentHull } from './loadout.js';
import * as net from './net.js';
import * as accounts from './auth.js';

const FIRE_INTERVAL = 2.5; // fallback when a turret doesn't say otherwise

// the projectile weapon a tank is carrying (null if it's a stream)
function gunSpecOf(turretId) {
  const s = TURRET_SPECS[turretId];
  return s && s.mode === 'projectile' ? s : null;
}

function fireIntervalOf(turretId) {
  const s = gunSpecOf(turretId);
  return s ? s.fireInterval : FIRE_INTERVAL;
}
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
const tracks = createTreadMarks(scene);
const arcBeam = createArcBeam(scene);
const railBeam = createRailBeam(scene);
const editor = createEditor({ scene, physics });
loadSelection();
const garage = createGarage({ scene, fx, audio, bullets, railBeam });

// compile every shader / effect during the menu so the first shot in a
// match never hitches
fx.prewarm();
bullets.prewarm();

// Local player
const playerModel = createTankModel(currentSkin(), currentTurret(), currentHull());
playerModel.root.visible = false; // hidden until a match starts
scene.add(playerModel.root);
const player = createPlayerController(playerModel, physics);

const local = {
  id: net.getMyId(),
  isLocal: true,
  model: playerModel,
  alive: false,
  hp: playerModel.maxHp,
  maxHp: playerModel.maxHp,
  cooldown: 0,
  fireSmoke: 0,
  smokeAcc: 0,
  huskAcc: 0,
  deadT: 0,
  recoil: 0,
  chill: 0,
  chillOff: 99,
  burn: 0,
  burnOff: 99,
  cryoTick: 0,
  flameTick: 0,
  emberAcc: 0,
};

const engine = audio.dieselLoop(playerModel.root);
const cryoSound = audio.loopOn(playerModel.root, 'cryo');
const flameSound = audio.loopOn(playerModel.root, 'flame');
const aegisSound = audio.loopOn(playerModel.root, 'aegis');

// Arctic Snap trigger + fuel
let firingHeld = false;
let lastTrackX = 0;
let lastTrackZ = 0;
const _trackFwd = new THREE.Vector3();
const _dustPos = new THREE.Vector3();
let dustAcc = 0;
const cryo = { fuel: 100, streaming: false };

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
const ENV_GARAGE = { groundAt: () => 0, half: 150, solidAt: null };

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
const elCryoFill = document.getElementById('cryofill');
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
  onGuest: () => {
    menu.show('scr-main');
  },
  onLogin: async ({ username, password }) => {
    if (!accounts.authConfigured()) { menu.err('login-err', CONFIG_MSG); return; }
    menu.err('login-err', 'signing in...');
    try {
      const p = await accounts.signIn({ username, password });
      menu.setAccount(p.username);
      await adoptCloudLoadout();
      menu.err('login-err', '');
      menu.show('scr-main');
    } catch (e) {
      menu.err('login-err', String(e.message || e));
    }
  },
  onSignUp: async ({ email, username, password }) => {
    if (!accounts.authConfigured()) { menu.err('signup-err', CONFIG_MSG); return; }
    menu.err('signup-err', 'creating account...');
    try {
      const res = await accounts.signUp({ email, username, password });
      menu.show('scr-login');
      menu.err('login-err', res.sent
        ? `verification sent to ${res.email} — check your spam folder, then log in`
        : `account made, but the email failed: ${res.sendError}. Use "resend" below.`);
    } catch (e) {
      menu.err('signup-err', String(e.message || e));
    }
  },
  onResend: async ({ username, password }) => {
    if (!accounts.authConfigured()) { menu.err('login-err', CONFIG_MSG); return; }
    if (!username || !password) {
      menu.err('login-err', 'enter your username and password first');
      return;
    }
    try {
      const to = await accounts.resendVerification({ username, password });
      menu.err('login-err', `verification resent to ${to} — check spam`);
    } catch (e) {
      menu.err('login-err', String(e.message || e));
    }
  },
  onForgot: async (username) => {
    if (!accounts.authConfigured()) { menu.err('login-err', CONFIG_MSG); return; }
    if (!username) { menu.err('login-err', 'type your username first'); return; }
    try {
      const to = await accounts.resetPassword(username);
      menu.err('login-err', `reset link sent to ${to}`);
    } catch (e) {
      menu.err('login-err', String(e.message || e));
    }
  },
  onLogout: async () => {
    if (!accounts.currentProfile()) { menu.show('scr-auth'); return; }
    await accounts.logOut();
    menu.setAccount(null);
    menu.show('scr-auth');
  },
  onDeleteAccount: async () => {
    const p = accounts.currentProfile();
    if (!p) return;
    if (!confirm(`Delete the account "${p.username}"? This erases the account, its email and its loadout for good.`)) return;
    const pw = prompt('Confirm your password to delete the account:');
    if (!pw) return;
    try {
      await accounts.deleteAccount(pw);
      menu.setAccount(null);
      menu.show('scr-auth');
      alert('Account deleted.');
    } catch (e) {
      alert(String(e.message || e));
    }
  },
  onGarage: () => enterGarage(),
});

async function adoptCloudLoadout() {
  const saved = await accounts.loadCloudLoadout();
  if (!saved) {
    // first sign-in on this account: seed it from whatever is set locally
    accounts.saveCloudLoadout(loadoutSnapshot());
    return;
  }
  applyLoadout(saved);
}

function loadoutSnapshot() {
  return {
    turret: (TURRETS[selection.turret] || TURRETS[0]).id,
    hull: (HULLS[selection.hull] || HULLS[0]).id,
    skin: (SKINS[selection.skin] || SKINS[0]).id,
  };
}

function applyLoadout(saved) {
  const ti = TURRETS.findIndex((x) => x.id === saved.turret);
  const hi = HULLS.findIndex((x) => x.id === saved.hull);
  const si = SKINS.findIndex((x) => x.id === saved.skin);
  if (ti >= 0 && !TURRETS[ti].locked) {
    selection.turret = ti;
    playerModel.setTurret(TURRETS[ti].id);
  }
  if (hi >= 0 && !HULLS[hi].locked) {
    selection.hull = hi;
    playerModel.setHull(HULLS[hi].id);
    player.syncHull();
    local.maxHp = playerModel.maxHp;
    local.hp = Math.min(local.hp, local.maxHp);
  }
  if (si >= 0) {
    selection.skin = si;
    playerModel.setSkin(SKINS[si]);
  }
  saveSelection();
  refreshWeaponHud();
  renderGarageItems();
}

// Boot: show the account gate, and keep the chip in step with Firebase.
if (accounts.authConfigured()) {
  accounts.watchAuth();
  accounts.onProfileChange((p) => menu.setAccount(p ? p.username : null));
} else {
  menu.setAccount(null);
  menu.err('auth-err', 'accounts need firebase \u2014 see the README');
}
menu.show('scr-auth');

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
      if (pid === net.getMyId() && Number.isInteger(data.team)) myTeam = data.team;
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
      if (s.k === 'rail') {
        const rspec = TURRET_SPECS.railgun;
        const rp = new THREE.Vector3(s.x, s.y, s.z);
        const rd = new THREE.Vector3(s.dx, s.dy, s.dz).normalize();
        railBeam.fire(rp, rd, rspec.range);
        fx.muzzleFlash(rp.clone(), rd.clone(), 'plasma');
        audio.playAt('rail', rp, { volume: 0.85, rate: 0.97 + Math.random() * 0.07 });
        resolveRailShot(rp, rd, remote.shotFrom(pid, 'rail'), rspec);
        return;
      }
      const kind = s.k === 'plasma' ? 'plasma' : 'shell';
      const ru = remote.shotFrom(pid, kind);
      fx.muzzleFlash(pos.clone(), dir.clone(), kind === 'plasma' ? 'plasma' : 'fire');
      audio.playAt(kind === 'plasma' ? 'plasma' : 'shot', pos, {
        volume: kind === 'plasma' ? 0.5 : 0.75,
        rate: 0.94 + Math.random() * 0.12,
      });
      bullets.fire(ru || {}, pos.clone().addScaledVector(dir, 0.15), dir, kind);
    },
  });
  refreshLobbyUi();
  menu.show('scr-lobby');
}

function stopStreaming() {
  firingHeld = false;
  cryo.streaming = false;
  playerModel.setStream(false);
  cryoSound.update(1, 0);
  flameSound.update(1, 0);
  aegis.active = false;
  aegis.lock = null;
  arcBeam.hide();
  aegisSound.update(1, 0);
}

function leaveToMenu() {
  stopStreaming();
  tracks.clear();
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
// Garage
// ---------------------------------------------------------------------------
const SKY = { bg: '#b9c3cd', fogNear: 70, fogFar: 230 };
const elGarageItems = document.getElementById('garage-items');
const elGarageReload = document.getElementById('garage-reload-fill');
let garageTab = 'turrets';

function rosterFor(tab) {
  return tab === 'hulls' ? HULLS : tab === 'skins' ? SKINS : TURRETS;
}

function selectedIndex(tab) {
  return tab === 'hulls' ? selection.hull : tab === 'skins' ? selection.skin : selection.turret;
}

function renderGarageItems() {
  const roster = rosterFor(garageTab);
  const sel = selectedIndex(garageTab);
  elGarageItems.innerHTML = roster
    .map((item, i) => {
      const locked = !!item.locked;
      const spec = garageTab === 'hulls' ? HULL_STATS[item.id] : null;
      const chip = garageTab === 'skins'
        ? `<span class="gchip" style="background:${item.hull[0]};border-color:${item.hull[1]}"></span>`
        : spec && !locked
          ? `<span class="gstat">${spec.maxHp}<em>hp</em></span>`
          : `<span class="gnum">${String(i + 1).padStart(2, '0')}</span>`;
      return `<button class="gitem${i === sel ? ' on' : ''}${locked ? ' locked' : ''}" data-i="${i}">
        ${chip}<span class="gname">${item.name}</span>
        ${locked ? '<span class="glock">locked</span>' : ''}
      </button>`;
    })
    .join('');
}

function setGarageTab(tab) {
  garageTab = tab;
  for (const btn of document.querySelectorAll('.gtab')) {
    btn.classList.toggle('on', btn.dataset.tab === tab);
  }
  renderGarageItems();
  elGarageItems.scrollLeft = 0;
}

elGarageItems.addEventListener('click', (e) => {
  const btn = e.target.closest('.gitem');
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const roster = rosterFor(garageTab);
  if (!roster[i] || roster[i].locked) return;
  if (garageTab === 'hulls') {
    selection.hull = i;
    garage.applyHull(roster[i].id);
    playerModel.setHull(roster[i].id);
    player.syncHull();
    local.maxHp = playerModel.maxHp;
    local.hp = Math.min(local.hp, local.maxHp);
    updateHpHud();
  } else if (garageTab === 'skins') {
    selection.skin = i;
    garage.applySkin(SKINS[i]);
    playerModel.setSkin(SKINS[i]);
  } else {
    selection.turret = i;
    garage.applyTurret(roster[i].id);
    playerModel.setTurret(roster[i].id);
    refreshWeaponHud();
  }
  saveSelection();
  accounts.saveCloudLoadout(loadoutSnapshot());
  renderGarageItems();
});

// horizontal wheel scrolling over the strip, like a shelf
elGarageItems.addEventListener('wheel', (e) => {
  if (!e.deltaY) return;
  e.preventDefault();
  elGarageItems.scrollLeft += e.deltaY;
}, { passive: false });

for (const btn of document.querySelectorAll('.gtab')) {
  btn.addEventListener('click', () => setGarageTab(btn.dataset.tab));
}

document.getElementById('garage-exit').addEventListener('click', () => {
  if (phase === 'garage') leaveGarage();
});

function enterGarage() {
  phase = 'garage';
  document.body.classList.add('garage');
  menu.hideAll();
  arenaGroup.visible = false;
  physics.setArenaActive(false);
  playerModel.root.visible = false;
  scene.background.set('#1b1f24');
  scene.fog.color.set('#1b1f24');
  scene.fog.near = 40;
  scene.fog.far = 150;
  garage.enter();
  setGarageTab(garageTab);
}

function leaveGarage() {
  garage.exit();
  bullets.clear();
  arenaGroup.visible = true;
  physics.setArenaActive(true);
  document.body.classList.remove('garage');
  scene.background.set(SKY.bg);
  scene.fog.color.set(SKY.bg);
  scene.fog.near = SKY.fogNear;
  scene.fog.far = SKY.fogFar;
  phase = 'menu';
  menu.show('scr-main');
}

// drag to spin the view; a click without dragging pulls the trigger
let gDrag = null;

renderer.domElement.addEventListener('mousedown', (e) => {
  if (phase !== 'garage' || e.button !== 0) return;
  gDrag = { lastX: e.clientX, moved: 0, vx: 0, streaming: false };
  garage.setTrigger(true);
  if (garage.isStreamWeapon()) gDrag.streaming = true;
});

window.addEventListener('mousemove', (e) => {
  if (!gDrag) return;
  const dx = e.clientX - gDrag.lastX;
  gDrag.lastX = e.clientX;
  gDrag.moved += Math.abs(dx);
  gDrag.vx = dx;
  // once it's clearly a drag, stop pouring and just spin the stand
  if (gDrag.moved >= 5) {
    // once it's clearly a drag, stop firing and just spin the stand
    garage.setTrigger(false);
    gDrag.streaming = false;
  }
  garage.orbit(dx);
});

window.addEventListener('mouseup', () => {
  if (!gDrag) return;
  garage.setTrigger(false);
  if (gDrag.moved < 5) garage.fire();
  else garage.flingOrbit(gDrag.vx);
  gDrag = null;
});

window.addEventListener('keydown', (e) => {
  if (phase !== 'garage' || e.code !== 'Space') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  garage.setTrigger(true);
  if (!garage.isStreamWeapon()) garage.fire();
});

window.addEventListener('keyup', (e) => {
  if (phase === 'garage' && e.code === 'Space') garage.setTrigger(false);
});

// ---------------------------------------------------------------------------
// Editor mode
// ---------------------------------------------------------------------------
function enterEditor() {
  phase = 'editor';
  playerModel.root.visible = true;
  editorMode = 'drive';
  document.body.classList.add('editor');
  menu.hideAll();
  arenaGroup.visible = false;
  physics.setArenaActive(false);
  editor.enter();
  spawnLocal(editorSpawnPoint());
}

function leaveEditor() {
  stopStreaming();
  tracks.clear();
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
  else if (e.code === 'KeyR') editor.rotateGhost();
  else if (e.code === 'KeyX') editor.deleteAtCursor();
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
  local.chill = 0;
  local.chillOff = 99;
  local.burn = 0;
  local.burnOff = 99;
  local.cryoTick = 0;
  local.flameTick = 0;
  playerModel.setStatus(0, 0);
  player.setSlow(1);
  cryo.fuel = 100;
  cryo.streaming = false;
  cryo.dry = false;
  aegis.lock = null;
  aegis.active = false;
  aegis.tick = 0;
  arcBeam.hide();
  rail.wind = 0;
  railBeam.hide();
  playerModel.setCharge(0);
  lastTrackX = playerModel.root.position.x;
  lastTrackZ = playerModel.root.position.z;
  playerModel.setStream(false);
  refreshWeaponHud();
  playerModel.root.visible = true;
  local.alive = true;
  local.maxHp = playerModel.maxHp;
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
    ch: Math.round(local.chill * 100) / 100,
    bn: Math.round(local.burn * 100) / 100,
    sk: selection.skin,
    tr: playerModel.turretId,
    hl: playerModel.hullId,
    st: cryo.streaming || aegis.active,
    tm: myTeam,
    lk: aegis.lock ? aegis.lock.id : null,
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
  firingHeld = true;
  rail.trigger = true;
  if (!playerModel.hasStream()) tryPlayerFire();
});

// automatic guns keep firing for as long as the trigger is down
function updateAutoFire() {
  if (!firingHeld || !local.alive) return;
  const spec = gunSpecOf(playerModel.turretId);
  if (spec && spec.auto) tryPlayerFire();
}

window.addEventListener('mouseup', () => { firingHeld = false; });
window.addEventListener('blur', () => { firingHeld = false; });

document.addEventListener('pointerlockchange', () => {
  elHint.style.display = document.pointerLockElement === canvas ? 'none' : '';
  if (document.pointerLockElement !== canvas) firingHeld = false;
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
// Weapon mode: the cannon reloads between shots, Arctic Snap burns fuel
// ---------------------------------------------------------------------------
// Any weapon that spends a charge bar rather than reloading between shots
function energySpecOf(turretId) {
  const s = TURRET_SPECS[turretId];
  if (!s) return null;
  if (s.mode === 'stream' || s.mode === 'beam' || s.mode === 'railgun') return s;
  if (s.fuelPerShot) return s; // the plasma repeater burns charge per bolt
  return null;
}

function railSpecOf(turretId) {
  const s = TURRET_SPECS[turretId];
  return s && s.mode === 'railgun' ? s : null;
}

function beamSpecOf(turretId) {
  const s = TURRET_SPECS[turretId];
  return s && s.mode === 'beam' ? s : null;
}

// my team; everyone in a lobby is alternated onto one of two sides
let myTeam = 0;

function refreshWeaponHud() {
  const spec = energySpecOf(playerModel.turretId);
  const stream = streamSpecOf(playerModel.turretId);
  document.body.classList.toggle('streamweapon', !!spec);
  document.body.classList.toggle('flameweapon', !!stream && stream.element === 'flame');
  const beam = beamSpecOf(playerModel.turretId);
  document.body.classList.toggle('plasmaweapon', !!spec && !stream && !beam);
  document.body.classList.toggle('aegisweapon', !!beam);
  document.body.classList.toggle('railweapon', !!railSpecOf(playerModel.turretId));
}
refreshWeaponHud();

const ARCTIC = TURRET_SPECS.arctic;
const INFERNO = TURRET_SPECS.inferno;
// the burn ticks for a share of the flamethrower's own damage output
const INFERNO_DPS = INFERNO.tickDamage / INFERNO.tickInterval;
const BURN_DPS = INFERNO.burnFrac * INFERNO_DPS;

// the spec of whatever stream weapon a tank is carrying (null if it's a gun)
function streamSpecOf(turretId) {
  const s = TURRET_SPECS[turretId];
  return s && s.mode === 'stream' ? s : null;
}

const _bp = new THREE.Vector3();
const _bd = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _bv = new THREE.Vector3();
const _tgt = new THREE.Vector3();

// Is `targetPos` inside the cone pouring from this model's nozzle?
function pointInStream(model, point, spec) {
  model.muzzle.getWorldPosition(_bp);
  model.muzzle.getWorldQuaternion(_bq);
  _bd.set(1, 0, 0).applyQuaternion(_bq);
  _bv.copy(point).sub(_bp);
  const along = _bv.dot(_bd);
  if (along < -0.6 || along > spec.range) return false;
  const perp = Math.sqrt(Math.max(0, _bv.lengthSq() - along * along));
  const t = Math.max(0, along) / spec.range;
  return perp <= 0.95 + (spec.coneR - 0.95) * t; // the spray widens with range
}

// Sample points spread over the target's actual hull. Testing only its centre
// meant a six-metre tank had to have its MIDDLE inside the cone before it took
// any damage — the stream would visibly wash over a tank's front and do
// nothing, which is what made the range feel far shorter than it looked.
const _sampQ = new THREE.Quaternion();
const _sampV = new THREE.Vector3();
const SAMPLES = [
  [0, 0.55, 0], [0.62, 0.35, 0], [-0.62, 0.35, 0],
  [0.3, 0.5, 0.6], [0.3, 0.5, -0.6], [-0.3, 0.5, 0.6], [-0.3, 0.5, -0.6],
];

function streamHitsBody(sourceModel, targetModel, targetPos, targetQuat, spec) {
  const H = targetModel.hull.hit;
  _sampQ.copy(targetQuat);
  for (const [fx_, fy_, fz_] of SAMPLES) {
    _sampV.set(fx_ * H.bodyX, fy_ * H.bodyY1, fz_ * H.bodyZ).applyQuaternion(_sampQ);
    _sampV.add(targetPos);
    if (pointInStream(sourceModel, _sampV, spec)) return true;
  }
  return false;
}

// Both status effects build while their stream lands, hold for a moment, and
// then fade at the rate they came on.
function rampStatus(value, hit, offTimer, spec, dt) {
  if (hit) return [Math.min(1, value + spec.statusRise * dt), 0];
  const off = offTimer + dt;
  const next = off > spec.statusDelay
    ? Math.max(0, value - spec.statusFall * dt)
    : value;
  return [next, off];
}

function tickStatus(unit, dt, hitCryo, hitFlame) {
  [unit.chill, unit.chillOff] = rampStatus(unit.chill, hitCryo, unit.chillOff, ARCTIC, dt);
  [unit.burn, unit.burnOff] = rampStatus(unit.burn, hitFlame, unit.burnOff, INFERNO, dt);

  // Each tank is the authority on its own status, and broadcasts it — that's
  // how you see a tank someone ELSE is freezing or burning. What we work out
  // locally is only a prediction for the beam we're holding ourselves, so it
  // shows up instantly instead of waiting for the next snapshot.
  const chill = unit.chillNet !== undefined ? Math.max(unit.chill, unit.chillNet) : unit.chill;
  const burn = unit.burnNet !== undefined ? Math.max(unit.burn, unit.burnNet) : unit.burn;
  unit.model.setStatus(chill, burn);

  // a tank well alight throws embers
  if (burn > 0.25) {
    unit.emberAcc = (unit.emberAcc || 0) + dt * burn;
    while (unit.emberAcc > 0.09) {
      unit.emberAcc -= 0.09;
      fx.ember(unit.model.root.position);
    }
  }
}

function updateStreamWeapon(dt) {
  const spec = streamSpecOf(playerModel.turretId);
  const energy = energySpecOf(playerModel.turretId);
  const wants = firingHeld && local.alive && !!spec;

  if (cryo.streaming) {
    if (!wants || cryo.fuel <= 0) cryo.streaming = false;
  } else if (wants && cryo.fuel >= spec.restartAt) {
    cryo.streaming = true;
  }

  if (spec) {
    if (cryo.streaming) {
      cryo.fuel = Math.max(0, cryo.fuel - spec.fuelDrain * dt);
    } else {
      // recharging starts the instant the trigger is released
      cryo.fuel = Math.min(100, cryo.fuel + spec.fuelRecharge * dt);
    }
  } else if (energy) {
    // the repeater spends its charge in tryPlayerFire; here it just refills
    // whenever the trigger is up
    if (!firingHeld || local.cooldown > 0) {
      cryo.fuel = Math.min(100, cryo.fuel + energy.fuelRecharge * dt);
    }
  } else {
    cryo.fuel = 100;
  }

  playerModel.setStream(cryo.streaming);
  playerModel.updateStream(dt);
  const isFlame = spec && spec.element === 'flame';
  cryoSound.update(1, cryo.streaming && !isFlame ? 0.5 : 0);
  flameSound.update(1, cryo.streaming && isFlame ? 0.55 : 0);
  elCryoFill.style.transform = `scaleX(${cryo.fuel / 100})`;
}

// Damage arrives in half-second bites; the first lands the moment the stream
// touches you, so contact reads immediately.
function tickDamage(unit, key, hit, spec, dt) {
  if (!hit) {
    unit[key] = 0;
    return;
  }
  if (unit[key] <= 0) {
    localDrain(spec.tickDamage);
    unit[key] = spec.tickInterval;
  } else {
    unit[key] -= dt;
  }
}

// ---------------------------------------------------------------------------
// Railgun: hold to spin it up, and after a second it lets go. The shot is
// instant and punches straight through everything in its path, shedding
// damage with each tank it passes.
// ---------------------------------------------------------------------------
const rail = { wind: 0, winding: false, trigger: false };
const _rp = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rs = new THREE.Vector3();

// Every tank the line passes through, nearest first.
function raycastTanks(origin, dir, range, units) {
  const found = [];
  for (const u of units) {
    const model = u.isLocal ? playerModel : u.model;
    if (!u.alive || !model.root.visible) continue;
    const pos = u.isLocal ? playerModel.root.position : u.pos;
    _rs.copy(pos).sub(origin);
    const along = _rs.dot(dir);
    if (along < 0 || along > range) continue;
    // cheap reject before the exact test
    if (Math.sqrt(Math.max(0, _rs.lengthSq() - along * along)) > 5) continue;
    for (let d = Math.max(0, along - 4); d <= along + 4; d += 0.35) {
      _rs.copy(origin).addScaledVector(dir, d);
      if (model.hitTest(_rs)) {
        found.push({ unit: u, dist: d });
        break;
      }
    }
  }
  found.sort((a, b) => a.dist - b.dist);
  return found;
}

// Resolve a rail shot: only the local tank's own health is applied here,
// since every tank owns its own hit points.
function resolveRailShot(origin, dir, shooter, spec) {
  const units = [local, ...remote.targets()].filter((u) => u !== shooter);
  const hits = raycastTanks(origin, dir, spec.range, units);
  hits.forEach((h, i) => {
    const dmg = Math.max(0, spec.damage - spec.falloff * i);
    if (dmg <= 0) return;
    _rs.copy(origin).addScaledVector(dir, h.dist);
    fx.plasmaImpact(_rs.clone());
    if (h.unit === local) localDrain(dmg);
  });
}

function updateRailgun(dt) {
  const spec = railSpecOf(playerModel.turretId);
  if (!spec) {
    rail.wind = 0;
    rail.winding = false;
    rail.trigger = false;
    playerModel.setCharge(0);
    return;
  }

  const ready = cryo.fuel >= 99.5;
  // A tap is enough: pressing the trigger latches the wind-up, and it runs
  // to completion on its own whether or not the button is still down.
  if (!rail.winding && rail.trigger && local.alive && ready) rail.winding = true;
  rail.trigger = false;
  if (!local.alive) rail.winding = false;
  const wants = rail.winding;

  if (wants) {
    rail.wind = Math.min(spec.windUp, rail.wind + dt);
    if (rail.wind >= spec.windUp) {
      // let go
      playerModel.muzzle.getWorldPosition(_rp);
      playerModel.muzzle.getWorldQuaternion(_rq);
      _rd.set(1, 0, 0).applyQuaternion(_rq);
      railBeam.fire(_rp, _rd, spec.range);
      fx.muzzleFlash(_rp.clone(), _rd.clone(), 'plasma');
      audio.playAt('rail', _rp, { volume: 1, rate: 0.97 + Math.random() * 0.07 });
      player.applyRecoil(_rd, 2.2);
      resolveRailShot(_rp, _rd, local, spec);
      cryo.fuel = 0;
      rail.wind = 0;
      rail.winding = false;
      if (phase === 'playing') {
        net.sendShot({
          x: r3(_rp.x), y: r3(_rp.y), z: r3(_rp.z),
          dx: r3(_rd.x), dy: r3(_rd.y), dz: r3(_rd.z),
          k: 'rail',
        });
      }
    }
  } else {
    rail.wind = Math.max(0, rail.wind - dt * 2.5);
    cryo.fuel = Math.min(100, cryo.fuel + spec.fuelRecharge * dt);
  }

  playerModel.setCharge(rail.wind / spec.windUp);
  elCryoFill.style.transform = `scaleX(${cryo.fuel / 100})`;
}

// ---------------------------------------------------------------------------
// Aegis Emitter: the beam picks its own target inside a cone around your aim,
// then either mends a teammate or drains an enemy.
// ---------------------------------------------------------------------------
const aegis = { lock: null, tick: 0, active: false };
const _amz = new THREE.Vector3();
const _adir = new THREE.Vector3();
const _atv = new THREE.Vector3();
const _aq = new THREE.Quaternion();
const AEGIS_GREEN = 0x53e07a;
const AEGIS_RED = 0xff4a3d;
const AEGIS_YELLOW = 0xffd23d;

// The prong arc belongs to the turret, so it is rebuilt whenever the turret
// changes and lives in the emitter's own local space.
let prongArc = null;
let prongArcOwner = null;
const _pgA = new THREE.Vector3();
const _pgB = new THREE.Vector3();

function updateProngArc(dt, powered, colour) {
  const anchor = playerModel.arcAnchor;
  if (!anchor) {
    if (prongArc) prongArc.setVisible(false);
    return;
  }
  const gap = playerModel.prongGap;
  if (prongArcOwner !== anchor) {
    // the arc is drawn for a 0.30 gap, so hand it the ratio to scale by
    prongArc = createProngArc(anchor, gap ? gap.gapZ / 0.30 : 1);
    prongArcOwner = anchor;
  }
  // the tips sit either side of the barrel line now, not above and below it
  _pgA.set(gap.x, 0.02, gap.gapZ / 2);
  _pgB.set(gap.x, 0.02, -gap.gapZ / 2);
  // idles steadily; pulses hard while the emitter is drawing power
  const pulse = powered ? 0.5 + 0.5 * Math.sin(performance.now() * 0.012) : 0;
  prongArc.setVisible(true);
  prongArc.update(dt, _pgA, _pgB, colour, powered ? 0.75 + 0.45 * pulse : 0.4, pulse);
}

function pickAegisTarget(spec) {
  playerModel.muzzle.getWorldPosition(_amz);
  playerModel.muzzle.getWorldQuaternion(_aq);
  _adir.set(1, 0, 0).applyQuaternion(_aq);

  let best = null;
  let bestAngle = spec.lockAngle;
  for (const ru of remote.targets()) {
    if (!ru.alive || !ru.model.root.visible) continue;
    _atv.copy(ru.pos);
    _atv.y += 1.0;
    _atv.sub(_amz);
    const dist = _atv.length();
    if (dist < 0.5 || dist > spec.range) continue;
    _atv.divideScalar(dist);
    const angle = Math.acos(THREE.MathUtils.clamp(_atv.dot(_adir), -1, 1));
    if (angle < bestAngle) {
      bestAngle = angle;
      best = ru;
    }
  }
  return best;
}

function updateAegis(dt) {
  const spec = beamSpecOf(playerModel.turretId);
  if (!spec) {
    aegis.lock = null;
    aegis.active = false;
    arcBeam.hide();
    if (prongArc) prongArc.setVisible(false);
    aegisSound.update(1, 0);
    return;
  }

  const wants = firingHeld && local.alive;
  if (aegis.active) {
    if (!wants || cryo.fuel <= 0) aegis.active = false;
  } else if (wants && cryo.fuel >= spec.restartAt) {
    aegis.active = true;
  }
  // The emitter runs whenever it's switched on — an empty sky just means it
  // burns charge and crackles across the prongs with nothing to hold.
  const powered = aegis.active;

  // hold a lock while it stays valid, otherwise look for a new one
  if (aegis.active) {
    const held = aegis.lock;
    const stillGood = held && held.alive && held.model.root.visible
      && pickAegisTargetIsValid(held, spec);
    aegis.lock = stillGood ? held : pickAegisTarget(spec);
  } else {
    aegis.lock = null;
  }

  const firing = powered && !!aegis.lock;
  if (powered) {
    cryo.fuel = Math.max(0, cryo.fuel - spec.fuelDrain * dt);
  } else {
    cryo.fuel = Math.min(100, cryo.fuel + spec.fuelRecharge * dt);
  }

  const friendly = firing && aegis.lock.team === myTeam;

  // ticks land ten times a second while the beam is connected
  if (firing) {
    aegis.tick -= dt;
    if (aegis.tick <= 0) {
      aegis.tick = spec.tickInterval;
      if (!friendly) {
        // the victim applies the damage themselves; we take the lifesteal
        localHeal(spec.damageTick * spec.lifestealFrac);
      }
    }
  } else {
    aegis.tick = 0;
  }

  playerModel.muzzle.getWorldPosition(_amz);
  if (firing) {
    _atv.copy(aegis.lock.pos);
    _atv.y += 1.0;
  }
  arcBeam.update(dt, camera, _amz, _atv, firing, friendly ? AEGIS_GREEN : AEGIS_RED);

  // the arc across the prong tips: yellow idle, and it takes the beam's
  // colour once the emitter has hold of somebody
  updateProngArc(dt, powered, firing ? (friendly ? AEGIS_GREEN : AEGIS_RED) : AEGIS_YELLOW);
  aegisSound.update(1, powered ? 0.5 : 0);
  elCryoFill.style.transform = `scaleX(${cryo.fuel / 100})`;
}

function pickAegisTargetIsValid(ru, spec) {
  playerModel.muzzle.getWorldPosition(_amz);
  playerModel.muzzle.getWorldQuaternion(_aq);
  _adir.set(1, 0, 0).applyQuaternion(_aq);
  _atv.copy(ru.pos);
  _atv.y += 1.0;
  _atv.sub(_amz);
  const dist = _atv.length();
  if (dist < 0.5 || dist > spec.range) return false;
  _atv.divideScalar(dist);
  // a held lock is allowed to drift a little wider before it breaks
  return Math.acos(THREE.MathUtils.clamp(_atv.dot(_adir), -1, 1)) < spec.lockAngle * 1.35;
}

// Someone else's Aegis is on me: apply their tick to myself, since each tank
// is the authority on its own health.
function receiveAegis(dt) {
  for (const ru of remote.targets()) {
    if (!ru.streaming || ru.lockId !== net.getMyId()) continue;
    const spec = beamSpecOf(ru.turretId);
    if (!spec || !local.alive) continue;
    ru.beamTick = (ru.beamTick || 0) - dt;
    if (ru.beamTick <= 0) {
      ru.beamTick = spec.tickInterval;
      if (ru.team === myTeam) localHeal(spec.healTick);
      else localDrain(spec.damageTick);
    }
  }
}

function localHeal(amount) {
  if (!local.alive) return;
  local.hp = Math.min(local.maxHp, local.hp + amount);
  updateHpHud();
}

// Resolve every live stream — frost and fire — against every tank
function resolveStreams(dt) {
  const remotes = phase === 'playing' ? remote.targets() : [];
  const mySpec = cryo.streaming ? streamSpecOf(playerModel.turretId) : null;
  let hitByCryo = false;
  let hitByFlame = false;

  for (const ru of remotes) {
    const visible = ru.alive && ru.model.root.visible;

    // their stream on me
    if (visible && ru.streaming && local.alive) {
      const theirs = streamSpecOf(ru.turretId);
      if (theirs && streamHitsBody(
        ru.model, playerModel, playerModel.root.position, playerModel.root.quaternion, theirs
      )) {
        if (theirs.element === 'flame') hitByFlame = true;
        else hitByCryo = true;
      }
    }

    // my stream on them (their client owns their damage; this is the look)
    let cryoOnThem = false;
    let flameOnThem = false;
    if (mySpec && visible && streamHitsBody(playerModel, ru.model, ru.pos, ru.quat, mySpec)) {
      if (mySpec.element === 'flame') flameOnThem = true;
      else cryoOnThem = true;
    }
    tickStatus(ru, dt, cryoOnThem, flameOnThem);
  }

  tickDamage(local, 'cryoTick', hitByCryo, ARCTIC, dt);
  tickDamage(local, 'flameTick', hitByFlame, INFERNO, dt);
  tickStatus(local, dt, hitByCryo, hitByFlame);

  // burning keeps eating hull even after the stream moves off
  if (local.burn > 0 && local.alive) {
    localDrain(BURN_DPS * local.burn * dt);
  }
  player.setSlow(1 - ARCTIC.maxSlow * local.chill);
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
const _fpos = new THREE.Vector3();
const _fdir = new THREE.Vector3();
const _fq = new THREE.Quaternion();

function muzzleWorld(unit, outPos, outDir, node) {
  const m = node || unit.model.muzzle;
  m.getWorldPosition(outPos);
  m.getWorldQuaternion(_fq);
  outDir.set(1, 0, 0).applyQuaternion(_fq);
}

function tryPlayerFire() {
  if (!local.alive || local.cooldown > 0) return;
  const spec = gunSpecOf(playerModel.turretId);
  if (!spec) return;

  // charge-fed guns need enough in the bar for another bolt
  if (spec.fuelPerShot) {
    const floor = cryo.dry ? spec.restartAt : spec.fuelPerShot;
    if (cryo.fuel < floor) {
      cryo.dry = true;
      return;
    }
    cryo.dry = false;
    cryo.fuel = Math.max(0, cryo.fuel - spec.fuelPerShot);
  }

  const plasma = spec.projectile === 'plasma';
  local.cooldown = spec.fireInterval;
  local.fireSmoke = spec.smokeTime !== undefined ? spec.smokeTime : 2;
  local.recoil = spec.recoil !== undefined ? spec.recoil : 0.22;

  // dual-barrel turrets alternate; the barrel that fired is what everyone sees
  const node = spec.dual ? playerModel.nextMuzzle() : playerModel.muzzle;
  const barrel = spec.dual && playerModel.muzzles
    ? playerModel.muzzles.indexOf(node)
    : -1;

  muzzleWorld(local, _fpos, _fdir, node);
  bullets.fire(local, _fpos.clone().addScaledVector(_fdir, 0.15), _fdir.clone(), spec.projectile);
  fx.muzzleFlash(_fpos.clone(), _fdir.clone(), plasma ? 'plasma' : 'fire');
  audio.playAt(plasma ? 'plasma' : 'shot', _fpos, {
    volume: plasma ? 0.62 : 0.9,
    rate: 0.94 + Math.random() * 0.12,
  });
  player.applyRecoil(_fdir, plasma ? 0.35 : 1);
  if (phase === 'playing') {
    net.sendShot({
      x: r3(_fpos.x), y: r3(_fpos.y), z: r3(_fpos.z),
      dx: r3(_fdir.x), dy: r3(_fdir.y), dz: r3(_fdir.z),
      k: spec.projectile,
      b: barrel,
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

// Sustained damage (cryo stream): no impact clank, no forced net push
function localDrain(amount) {
  if (!local.alive) return;
  local.hp -= amount;
  updateHpHud();
  if (local.hp <= 0) localDie();
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
      // (plasma turrets set smokeTime 0, so this never runs for them)
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
const _lookAt = new THREE.Vector3(0, 2, 0);

// Rig geometry: the camera sits on a sphere of fixed radius around the tank,
// so its distance never changes — pitching just walks it around the arc.
const CAM_BACK = 10.5;
const CAM_UP = 5.6;
const CAM_R = Math.hypot(CAM_BACK, CAM_UP);
const CAM_BASE_ELEV = Math.atan2(CAM_UP, CAM_BACK);

// Hulls now range from 3.5 m to 6.3 m long, so one fixed distance frames the
// heavy ones far tighter than the light ones. The rig backs off in
// proportion to hull length — damped, so it's a nudge rather than a zoom.
// It stays rigidly fixed while you drive; only picking a different hull
// changes it.
const CAM_REF_LEN = 4.90; // the Vanguard, i.e. the distance tuned by hand
function camRadius() {
  const len = playerModel.hull.hit.bodyX * 2;
  return CAM_R * (0.65 + 0.35 * (len / CAM_REF_LEN));
}

function updateCamera() {
  // no easing: the rig is rigidly bolted to the aim
  camYaw = viewYaw;
  camPitch = viewPitch;

  const cy = Math.cos(camYaw);
  const sy = -Math.sin(camYaw);
  const tp = playerModel.root.position;

  const elev = THREE.MathUtils.clamp(CAM_BASE_ELEV - camPitch, -0.18, 1.30);
  const ce = Math.cos(elev);
  const se = Math.sin(elev);

  const radius = camRadius();
  camera.position.set(
    tp.x - cy * radius * ce,
    tp.y + radius * se,
    tp.z - sy * radius * ce
  );
  // the only thing that ever moves it: refusing to sink into the ground
  const minY = groundYAt(camera.position.x, camera.position.z) + 0.8;
  if (camera.position.y < minY) camera.position.y = minY;

  const cp = Math.cos(camPitch);
  const sp = Math.sin(camPitch);
  const D = 45;
  _lookAt.set(tp.x + cp * cy * D, tp.y + 2.0 + sp * D, tp.z + cp * sy * D);
  camera.lookAt(_lookAt);
  camPos.copy(camera.position);
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
      else player.coast(dt);
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
      else player.coast(dt);
    }

    physics.step(dt);
    player.postStep();

    // stuck upside down long enough -> the crew bails and it cooks off
    if (local.alive && player.state.flipT > 4) {
      localDie();
    }

    // press tread marks into the ground under whoever is driving
    if (local.alive) {
      const p = playerModel.root.position;
      const movedLocal = Math.hypot(p.x - lastTrackX, p.z - lastTrackZ);
      tracks.trail(
        'local', playerModel, p.y, player.state.heading,
        movedLocal, player.state.contact
      );
      lastTrackX = p.x;
      lastTrackZ = p.z;

      // dust off the back of both tracks, the faster the heavier
      const spdFrac = Math.min(1, Math.abs(player.state.tread) / playerModel.hull.move.maxForward);
      if (player.state.contact && spdFrac > 0.06) {
        dustAcc += dt * (1.1 + spdFrac * 3.5);
        const tread = playerModel.hull.tread;
        const h = player.state.heading;
        const fx_ = Math.cos(h);
        const fz_ = -Math.sin(h);
        const rx_ = Math.sin(h);
        const rz_ = Math.cos(h);
        const back = player.state.tread >= 0 ? -1 : 1;
        while (dustAcc > 0.06) {
          dustAcc -= 0.06;
          const side = Math.random() < 0.5 ? -1 : 1;
          _dustPos.set(
            p.x + fx_ * back * tread.runHalf + rx_ * side * tread.z,
            p.y,
            p.z + fz_ * back * tread.runHalf + rz_ * side * tread.z
          );
          fx.dust(_dustPos, fx_ * back, fz_ * back, spdFrac);
        }
      }
    }
    for (const ru of remote.targets()) {
      if (!ru.alive || !ru.model.root.visible) continue;
      const moved = Math.hypot(ru.pos.x - (ru.trackX || ru.pos.x), ru.pos.z - (ru.trackZ || ru.pos.z));
      _trackFwd.set(1, 0, 0).applyQuaternion(ru.quat);
      const heading = Math.atan2(-_trackFwd.z, _trackFwd.x);
      tracks.trail(ru.id, ru.model, ru.pos.y, heading, moved, true);
      ru.trackX = ru.pos.x;
      ru.trackZ = ru.pos.z;
    }
    tracks.update(dt);

    updateLocalUnit(dt);
    updateAutoFire();
    updateStreamWeapon(dt);
    updateAegis(dt);
    updateRailgun(dt);
    railBeam.update(dt);
    receiveAegis(dt);
    resolveStreams(dt);

    bullets.update(
      dt,
      phase === 'playing' ? [local, ...remote.targets()] : [local],
      (unit, pos, damage, kind) => {
        if (kind === 'plasma') fx.plasmaImpact(pos.clone());
        else fx.impact(pos.clone());
        if (unit === local) localDamage(damage, pos);
        else audio.playAt('hit', pos, { volume: 0.5, rate: 0.92 + Math.random() * 0.16 });
      },
      (pos, kind) => {
        if (kind === 'plasma') fx.plasmaImpact(pos.clone());
        else fx.impact(pos.clone());
      },
      phase === 'editor' ? ENV_EDITOR : ENV_ARENA
    );

    fx.update(dt);
    if (!flying) updateCamera(dt);

    const sunAnchor = flying ? camera.position : playerModel.root.position;
    sun.intensity = 1.9;
    sun.position.copy(sunAnchor).add(SUN_OFFSET);
    sun.target.position.copy(sunAnchor);

    // the engine note follows the tracks (it roars while they slip against a
    // wall), the speedo below follows how fast the hull is actually moving
    const speedFrac = Math.abs(player.state.tread) / playerModel.hull.move.maxForward;
    engine.update(speedFrac, local.alive && !flying);

    if (phase === 'playing') {
      stateAcc += dt;
      if (stateAcc > 1 / 12) {
        stateAcc = 0;
        pushState();
      }
    }

    elSpeed.textContent = String(Math.round(Math.abs(player.state.v) * 8));
    elReload.style.transform = `scaleX(${1 - Math.max(0, local.cooldown) / fireIntervalOf(playerModel.turretId)})`;
    if (!local.alive) {
      elDeath.textContent = `destroyed \u00b7 respawning in ${Math.max(1, Math.ceil(local.deadT))}`;
    }
  } else if (phase === 'garage') {
    garage.update(dt, camera);
    bullets.update(dt, [], () => {}, (pos) => fx.impact(pos.clone()), ENV_GARAGE);
    fx.update(dt);
    engine.update(0, false);
    // the bay is lit by its own fittings; keep the sun out of it
    sun.position.set(18, 30, 14);
    sun.target.position.set(0, 0, 0);
    sun.intensity = 0.25;
    elGarageReload.style.transform = `scaleX(${garage.usesCharge() ? garage.fuelFrac() : garage.reloadFrac()})`;
  } else {
    updateIdleCamera(dt);
    fx.update(dt);
    remote.update(dt);
    engine.update(0, false);
    sun.intensity = 1.9;
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
