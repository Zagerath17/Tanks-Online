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

export function readInput() {
  return {
    throttle: (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0),
    turn: (down.has('KeyA') ? 1 : 0) - (down.has('KeyD') ? 1 : 0),
  };
}

export function readFly() {
  return {
    fwd: (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0),
    strafe: (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0),
    up: (down.has('Space') ? 1 : 0) - (down.has('ShiftLeft') || down.has('ShiftRight') ? 1 : 0),
  };
}
