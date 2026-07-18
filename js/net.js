// Multiplayer transport: Firebase Realtime Database.
// One lobby = /lobbies/{4-digit code} holding host, state, players, shots.
// Each client owns its own player node (position, turret, hp, alive) and
// pushes shot events; everyone else mirrors them.
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase, ref, get, set, update, remove, push,
  onValue, onChildAdded, onChildChanged, onChildRemoved,
  onDisconnect, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const MAX_PLAYERS = 12;

const myId = 'p' + Math.random().toString(36).slice(2, 10);
let db = null;
let lobbyCode = null;
let hostId = null;
const unsubs = [];

export function netConfigured() {
  return !!(
    firebaseConfig &&
    firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes('PASTE') &&
    firebaseConfig.databaseURL && !String(firebaseConfig.databaseURL).includes('PASTE')
  );
}

export function getMyId() { return myId; }
export function getLobbyCode() { return lobbyCode; }
export function isHost() { return hostId === myId; }
export function getHostId() { return hostId; }

function ensureDb() {
  if (!db) db = getDatabase(initializeApp(firebaseConfig));
  return db;
}

function lref(...parts) {
  return ref(ensureDb(), ['lobbies', lobbyCode, ...parts].join('/'));
}

export async function createLobby() {
  ensureDb();
  for (let tries = 0; tries < 25; tries++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const res = await runTransaction(ref(db, `lobbies/${code}`), (cur) => {
      if (cur !== null) return; // code taken — abort, try another
      return {
        host: myId,
        state: 'waiting',
        created: Date.now(),
        players: { [myId]: { joined: Date.now() } },
      };
    });
    if (res.committed) {
      lobbyCode = code;
      hostId = myId;
      onDisconnect(ref(db, `lobbies/${code}/players/${myId}`)).remove();
      return code;
    }
  }
  throw new Error('could not allocate a lobby code');
}

export async function joinLobby(code) {
  ensureDb();
  const snap = await get(ref(db, `lobbies/${code}`));
  if (!snap.exists()) throw new Error('lobby not found');
  const lobby = snap.val();
  if (lobby.state !== 'waiting') throw new Error('game already started');

  const res = await runTransaction(ref(db, `lobbies/${code}/players`), (players) => {
    players = players || {};
    if (players[myId]) return players;
    if (Object.keys(players).length >= MAX_PLAYERS) return; // abort: full
    players[myId] = { joined: Date.now() };
    return players;
  });
  if (!res.committed) throw new Error(`lobby is full (${MAX_PLAYERS} max)`);

  lobbyCode = code;
  hostId = lobby.host;
  onDisconnect(ref(db, `lobbies/${code}/players/${myId}`)).remove();
  return code;
}

// Wire all in-lobby listeners at once; leaveLobby() tears them down.
export function subscribe({ onState, onPlayer, onPlayerGone, onShot }) {
  const playerCb = (s) => onPlayer && onPlayer(s.key, s.val());
  unsubs.push(
    onValue(lref('state'), (s) => onState && onState(s.val())),
    onChildAdded(lref('players'), playerCb),
    onChildChanged(lref('players'), playerCb),
    onChildRemoved(lref('players'), (s) => onPlayerGone && onPlayerGone(s.key)),
    onChildAdded(lref('shots'), (s) => {
      const v = s.val();
      if (v && onShot) onShot(v.pid, v);
    })
  );
}

export async function startGame() {
  if (!isHost() || !lobbyCode) return;
  await update(lref(), { state: 'playing' });
}

export function sendState(state) {
  if (!lobbyCode) return;
  update(lref('players', myId), state).catch(() => {});
}

export function sendShot(shot) {
  if (!lobbyCode) return;
  const r = push(lref('shots'));
  set(r, { pid: myId, t: Date.now(), ...shot }).catch(() => {});
  // shots are transient events — the shooter prunes its own after a beat
  setTimeout(() => remove(r).catch(() => {}), 5000);
}

export async function leaveLobby() {
  for (const u of unsubs) {
    try { u(); } catch { /* already gone */ }
  }
  unsubs.length = 0;
  if (lobbyCode && db) {
    const code = lobbyCode;
    lobbyCode = null;
    try { await remove(ref(db, `lobbies/${code}/players/${myId}`)); } catch { /* ok */ }
  }
  lobbyCode = null;
  hostId = null;
}
