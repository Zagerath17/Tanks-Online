// On-screen controls for touch devices: a left stick for the hull, a right
// stick for the turret, and a fire button.
//
// Both sticks use a floating origin — the stick centres itself wherever your
// thumb lands inside its half of the screen, rather than making you find a
// fixed circle you can't see under your hand. Every touch is tracked by its
// own pointerId so the two sticks and the fire button all work at once.

const RADIUS = 62; // px of travel from centre to full deflection
const DEAD = 0.16; // fraction of travel ignored, so a resting thumb reads zero

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// Only assume touch-only when there is NO fine pointer at all.
//
// The old test was `maxTouchPoints > 0 && (pointer: coarse)`, which a laptop
// with a touchscreen can satisfy. That turned the on-screen sticks on and,
// far worse, made the canvas skip requestPointerLock — so the mouse stopped
// aiming with no way to get it back. Requiring the absence of a fine pointer
// keeps hybrids on mouse and keyboard where they belong.
export function touchDeviceLikely() {
  if (typeof window === 'undefined') return false;
  const points = navigator.maxTouchPoints || 0;
  if (points <= 0) return false;
  if (!window.matchMedia) return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const anyFine = window.matchMedia('(any-pointer: fine)').matches;
  return coarse && !anyFine;
}

function createStick(root, side) {
  const el = document.createElement('div');
  el.className = `tstick ${side}`;
  const knob = document.createElement('div');
  knob.className = 'tknob';
  el.appendChild(knob);
  root.appendChild(el);

  const state = { x: 0, y: 0, id: null, ox: 0, oy: 0 };

  function place(cx, cy) {
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
  }

  function rest() {
    el.classList.remove('on');
    knob.style.transform = 'translate(-50%, -50%)';
    state.x = 0;
    state.y = 0;
    state.id = null;
  }

  function begin(id, cx, cy) {
    state.id = id;
    state.ox = cx;
    state.oy = cy;
    place(cx, cy);
    el.classList.add('on');
    knob.style.transform = 'translate(-50%, -50%)';
  }

  function move(cx, cy) {
    let dx = cx - state.ox;
    let dy = cy - state.oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      // drag the origin along, so the stick never feels stuck at the rim
      const k = (len - RADIUS) / len;
      state.ox += dx * k;
      state.oy += dy * k;
      place(state.ox, state.oy);
      dx *= RADIUS / len;
      dy *= RADIUS / len;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const nx = dx / RADIUS;
    const ny = dy / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag <= DEAD) {
      state.x = 0;
      state.y = 0;
    } else {
      // rescale past the dead zone so the usable range still reaches 1
      const s = (mag - DEAD) / (1 - DEAD) / mag;
      state.x = nx * s;
      state.y = ny * s;
    }
  }

  rest();
  return { el, state, begin, move, rest };
}

export function createTouchControls({ onFireDown, onFireUp }) {
  const root = document.createElement('div');
  root.id = 'touchui';
  document.body.appendChild(root);

  const left = createStick(root, 'left');
  const right = createStick(root, 'right');

  const fire = document.createElement('button');
  fire.id = 'tfire';
  fire.textContent = 'FIRE';
  root.appendChild(fire);

  let firing = false;
  let enabled = false;

  // ---- fire button ---------------------------------------------------------
  fire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fire.setPointerCapture(e.pointerId);
    fire.classList.add('on');
    firing = true;
    if (onFireDown) onFireDown();
  });
  const release = (e) => {
    if (e) e.preventDefault();
    if (!firing) return;
    fire.classList.remove('on');
    firing = false;
    if (onFireUp) onFireUp();
  };
  fire.addEventListener('pointerup', release);
  fire.addEventListener('pointercancel', release);

  // ---- sticks -------------------------------------------------------------
  // Which half of the screen a touch starts in decides which stick it drives.
  function stickFor(x) {
    return x < window.innerWidth * 0.5 ? left : right;
  }

  function onDown(e) {
    if (!enabled || e.pointerType === 'mouse') return;
    if (e.target === fire || fire.contains(e.target)) return;
    // leave anything with its own UI alone
    if (e.target.closest && e.target.closest('#menu, #editorbar, #garage-bar, #account, button, input, select')) return;
    const s = stickFor(e.clientX);
    if (s.state.id !== null) return; // that stick is already in use
    s.begin(e.pointerId, e.clientX, e.clientY);
    e.preventDefault();
  }

  function onMove(e) {
    if (!enabled) return;
    for (const s of [left, right]) {
      if (s.state.id === e.pointerId) {
        s.move(e.clientX, e.clientY);
        e.preventDefault();
        return;
      }
    }
  }

  function onUp(e) {
    for (const s of [left, right]) {
      if (s.state.id === e.pointerId) s.rest();
    }
  }

  window.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', () => {
    left.rest();
    right.rest();
    release();
  });

  function setEnabled(on) {
    enabled = on;
    root.classList.toggle('on', on);
    if (!on) {
      left.rest();
      right.rest();
      release();
    }
  }
  setEnabled(false);

  return {
    setEnabled,
    isEnabled: () => enabled,
    // left stick: forward/back and pivot, in the same shape readInput uses
    readMove() {
      if (!enabled) return null;
      return { throttle: -left.state.y, turn: -left.state.x };
    },
    // right stick: a rate, not a delta — holding it keeps the turret turning
    readAim() {
      if (!enabled) return null;
      return { x: right.state.x, y: right.state.y };
    },
    isFiring: () => firing && enabled,
    setFireLabel(text) {
      fire.textContent = text;
    },
  };
}
