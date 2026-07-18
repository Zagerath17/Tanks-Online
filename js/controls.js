// Keyboard state. W/S throttle, A/D hull pivot. Turret aim is mouse-driven
// (see main.js pointer lock handling).
const HANDLED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const down = new Set();

window.addEventListener('keydown', (e) => {
  if (!HANDLED.has(e.code)) return;
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
