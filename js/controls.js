// Keyboard state. W/S throttle, A/D hull pivot, J/K turret traverse.
const HANDLED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK']);
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
    turret: (down.has('KeyJ') ? 1 : 0) - (down.has('KeyK') ? 1 : 0),
  };
}
