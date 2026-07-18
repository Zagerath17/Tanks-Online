// A full-spectrum HSV colour wheel: hue by angle, saturation by radius, plus
// a value (brightness) slider. Pure canvas + pointer events, no dependencies.

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function createColorWheel(wheel, slider, swatch, onChange) {
  const R = wheel.width / 2;
  const wctx = wheel.getContext('2d');
  const sctx = slider.getContext('2d');

  const state = { h: 14, s: 0.78, v: 0.9 };

  // Hue/saturation disc — drawn once (independent of value; value tints the
  // slider and the final colour, keeping the wheel readable at all times).
  const img = wctx.createImageData(wheel.width, wheel.height);
  for (let y = 0; y < wheel.height; y++) {
    for (let x = 0; x < wheel.width; x++) {
      const dx = x - R;
      const dy = y - R;
      const dist = Math.hypot(dx, dy);
      const i = (y * wheel.width + x) * 4;
      if (dist > R) { img.data[i + 3] = 0; continue; }
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const sat = Math.min(1, dist / (R - 1));
      const [r, g, b] = hsvToRgb(hue, sat, 1);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  wctx.putImageData(img, 0, 0);

  function drawWheelCursor() {
    // repaint disc, then the selection ring
    wctx.putImageData(img, 0, 0);
    const ang = (state.h * Math.PI) / 180;
    const rad = state.s * (R - 1);
    const cx = R + Math.cos(ang) * rad;
    const cy = R + Math.sin(ang) * rad;
    wctx.beginPath();
    wctx.arc(cx, cy, 6, 0, Math.PI * 2);
    wctx.lineWidth = 2;
    wctx.strokeStyle = state.v > 0.55 ? '#111' : '#fff';
    wctx.stroke();
  }

  function drawSlider() {
    const h = slider.height;
    for (let y = 0; y < h; y++) {
      const v = 1 - y / (h - 1);
      const [r, g, b] = hsvToRgb(state.h, state.s, v);
      sctx.fillStyle = `rgb(${r},${g},${b})`;
      sctx.fillRect(0, y, slider.width, 1);
    }
    const yy = (1 - state.v) * (h - 1);
    sctx.beginPath();
    sctx.rect(0, Math.max(0, yy - 2), slider.width, 4);
    sctx.lineWidth = 2;
    sctx.strokeStyle = state.v > 0.55 ? '#111' : '#fff';
    sctx.stroke();
  }

  function emit() {
    const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
    const hex = toHex(r, g, b);
    if (swatch) swatch.style.background = hex;
    if (onChange) onChange(hex);
  }

  function redraw() {
    drawWheelCursor();
    drawSlider();
    emit();
  }

  function pickWheel(e) {
    const rect = wheel.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * wheel.width - R;
    const y = ((e.clientY - rect.top) / rect.height) * wheel.height - R;
    state.h = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    state.s = Math.min(1, Math.hypot(x, y) / (R - 1));
    redraw();
  }

  function pickSlider(e) {
    const rect = slider.getBoundingClientRect();
    const t = (e.clientY - rect.top) / rect.height;
    state.v = Math.min(1, Math.max(0, 1 - t));
    redraw();
  }

  function drag(el, handler) {
    let on = false;
    const move = (e) => { if (on) { handler(e); e.preventDefault(); } };
    el.addEventListener('pointerdown', (e) => {
      on = true;
      el.setPointerCapture(e.pointerId);
      handler(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => { on = false; });
    el.addEventListener('pointercancel', () => { on = false; });
  }

  drag(wheel, pickWheel);
  drag(slider, pickSlider);
  redraw();

  return {
    getHex() {
      const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
      return toHex(r, g, b);
    },
  };
}
