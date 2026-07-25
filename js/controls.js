// Keyboard state. W/S throttle, A/D hull pivot when driving; in the editor's
// free cam the same WASD moves the camera, with Space/Shift for up/down.
const HANDLED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
const down = new Set();

function inField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}

window.addEventListener('keydown', (e) => {
  if (inField(e) || !HANDLED.has(e.code)) return;
  down.add(e.code);
  e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  down.delete(e.code);
});

// Don't leave keys stuck when the tab loses focus mid-press
window.addEventListener('blur', () => down.clear());

// An on-screen stick can stand in for the keys. Whichever is pushed further
// wins, so a controller and the keyboard can both be live without fighting.
let stick = null;

export function setMoveStick(fn) {
  stick = fn;
}

function blend(keys, pad) {
  if (!pad) return keys;
  return {
    throttle: Math.abs(pad.throttle) > Math.abs(keys.throttle) ? pad.throttle : keys.throttle,
    turn: Math.abs(pad.turn) > Math.abs(keys.turn) ? pad.turn : keys.turn,
  };
}

export function readInput() {
  const keys = {
    throttle: (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0),
    turn: (down.has('KeyA') ? 1 : 0) - (down.has('KeyD') ? 1 : 0),
  };
  return blend(keys, stick ? stick() : null);
}

export function readFly() {
  const pad = stick ? stick() : null;
  const fwd = (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0);
  const strafe = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0);
  return {
    fwd: pad && Math.abs(pad.throttle) > Math.abs(fwd) ? pad.throttle : fwd,
    strafe: pad && Math.abs(pad.turn) > Math.abs(strafe) ? -pad.turn : strafe,
    up: (down.has('Space') ? 1 : 0) - (down.has('ShiftLeft') || down.has('ShiftRight') ? 1 : 0),
  };
}
