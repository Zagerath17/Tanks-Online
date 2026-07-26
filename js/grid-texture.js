import * as THREE from 'three';

/**
 * Procedural dev-grid texture. Everything in the prototype — floor, walls,
 * hull, turret, tread links — is skinned with a variant of this.
 */
export function makeGridTexture({
  size = 512,
  cells = 8,
  base = '#3f4750',
  line = '#5a636e',
  lineWidth = 2,
  major = 0,
  majorLine = '#77828f',
  majorWidth = 5,
  repeat = [1, 1],
  anisotropy = 8,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const step = size / cells;

  ctx.strokeStyle = line;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let i = 0; i <= cells; i++) {
    const p = Math.round(i * step) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  if (major > 0) {
    ctx.strokeStyle = majorLine;
    ctx.lineWidth = majorWidth;
    ctx.beginPath();
    for (let i = 0; i <= cells; i += major) {
      const p = Math.round(i * step) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Wheel hub cap with spokes and bolts, so wheel spin reads clearly.
 * Cylinder caps map their circle to the center of the UV square.
 */
/**
 * Procedural rolled-steel plate. Brushed grain, faint rolling bands, mottled
 * patina and a scattering of scuffs — what the tanks wear instead of the dev
 * grid. `wear` and `grain` scale how beaten and how coarse the finish looks.
 */
export function makeMetalTexture({
  size = 512,
  base = '#4d6039',
  shade = '#41522f',
  wear = 1,
  grain = 1,
  repeat = [1, 1],
  anisotropy = 8,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // broad mottling, so large flat panels aren't dead uniform
  for (let i = 0; i < 26; i++) {
    const r = size * (0.10 + Math.random() * 0.26);
    const g = ctx.createRadialGradient(
      Math.random() * size, Math.random() * size, 0,
      Math.random() * size, Math.random() * size, r
    );
    const dark = Math.random() < 0.5;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // brushed grain: long fine streaks along the roll direction
  const streaks = Math.round(1500 * grain);
  for (let i = 0; i < streaks; i++) {
    const y = Math.random() * size;
    const x = Math.random() * size;
    const len = size * (0.04 + Math.random() * 0.30);
    const light = Math.random() < 0.5;
    ctx.strokeStyle = light
      ? `rgba(255,255,255,${0.014 + Math.random() * 0.030})`
      : `rgba(0,0,0,${0.016 + Math.random() * 0.038})`;
    ctx.lineWidth = Math.random() < 0.85 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (Math.random() - 0.5) * 1.5);
    ctx.stroke();
  }

  // faint rolling bands across the plate
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let y = 0; y < size; y += Math.round(size / 9)) {
    ctx.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#000000';
    ctx.fillRect(0, y + Math.random() * 4, size, 1 + Math.random() * 3);
  }
  ctx.restore();

  // scuffs and nicks, heavier the more wear is asked for
  const marks = Math.round(90 * wear);
  for (let i = 0; i < marks; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 2 + Math.random() * 16 * wear;
    const a = Math.random() * Math.PI * 2;
    ctx.strokeStyle = Math.random() < 0.6
      ? `rgba(0,0,0,${0.10 + Math.random() * 0.16})`
      : `rgba(255,255,255,${0.07 + Math.random() * 0.12})`;
    ctx.lineWidth = Math.random() < 0.7 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // darkened edges, so adjoining panels read as separate plates
  const edge = ctx.createLinearGradient(0, 0, 0, size);
  edge.addColorStop(0, 'rgba(0,0,0,0.16)');
  edge.addColorStop(0.08, 'rgba(0,0,0,0)');
  edge.addColorStop(0.92, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = shade;
  ctx.globalAlpha = 0.10;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  return tex;
}

export function makeHubTexture({
  size = 256,
  bg = '#22262c',
  spoke = '#3a424c',
  hub = '#4d5762',
  bolt = '#6a7581',
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // spokes
  ctx.save();
  ctx.translate(c, c);
  ctx.fillStyle = spoke;
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.fillRect(-size * 0.045, -size * 0.46, size * 0.09, size * 0.46);
  }
  ctx.restore();

  // outer rim ring
  ctx.strokeStyle = '#161a1f';
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.445, 0, Math.PI * 2);
  ctx.stroke();

  // hub
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1e23';
  ctx.lineWidth = size * 0.02;
  ctx.stroke();

  // bolts
  ctx.fillStyle = bolt;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * size * 0.28, c + Math.sin(a) * size * 0.28, size * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}


// A single, fully laid-out armour sheet — panel divisions, weld seams, rivet
// rows, edge wear and grime — meant to be used at repeat [1, 1]. The old hull
// skin was a small noise tile repeated a couple of times over each surface,
// which read as wallpaper: the same smudge in four places.
export function makeArmourTexture({
  size = 1024,
  base = '#4d6039',
  shade = '#41522f',
  wear = 1,
  seed = 1,
  anisotropy = 16,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // deterministic per-skin, so a given palette always paints the same sheet
  let n = seed * 9301 + 49297;
  const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // broad tonal drift, so no two areas read the same
  for (let i = 0; i < 26; i++) {
    const r = size * (0.12 + rnd() * 0.3);
    const g = ctx.createRadialGradient(rnd() * size, rnd() * size, 0, rnd() * size, rnd() * size, r);
    g.addColorStop(0, `rgba(0,0,0,${0.02 + rnd() * 0.05})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // panel layout: recursive splits, so plates come out different sizes
  const panels = [];
  (function split(x, y, w, h, depth) {
    if (depth <= 0 || w < size * 0.16 || h < size * 0.16) {
      panels.push([x, y, w, h]);
      return;
    }
    const vertical = w > h ? rnd() < 0.75 : rnd() < 0.25;
    const t = 0.34 + rnd() * 0.32;
    if (vertical) {
      split(x, y, w * t, h, depth - 1);
      split(x + w * t, y, w * (1 - t), h, depth - 1);
    } else {
      split(x, y, w, h * t, depth - 1);
      split(x, y + h * t, w, h * (1 - t), depth - 1);
    }
  })(0, 0, size, size, 4);

  for (const [x, y, w, h] of panels) {
    // each plate a shade off its neighbours
    ctx.fillStyle = rnd() < 0.5 ? shade : base;
    ctx.globalAlpha = 0.25 + rnd() * 0.35;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;

    // weld seam, with a lit edge on one side
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);

    // rivets round the plate
    const step = 34 + rnd() * 22;
    for (let px = x + 12; px < x + w - 10; px += step) {
      for (const py of [y + 11, y + h - 11]) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.arc(px, py + 1, 2.6, 0, 6.3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath(); ctx.arc(px, py - 0.6, 2.1, 0, 6.3); ctx.fill();
      }
    }
    for (let py = y + 30; py < y + h - 26; py += step) {
      for (const px of [x + 11, x + w - 11]) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.arc(px, py + 1, 2.6, 0, 6.3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath(); ctx.arc(px, py - 0.6, 2.1, 0, 6.3); ctx.fill();
      }
    }
  }

  // grime running down from the seams
  for (let i = 0; i < 90 * wear; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 20 + rnd() * 140;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, `rgba(0,0,0,${0.05 + rnd() * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 2 + rnd() * 7, len);
  }

  // scratches and chipped paint
  for (let i = 0; i < 150 * wear; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.strokeStyle = rnd() < 0.35
      ? `rgba(255,255,255,${0.04 + rnd() * 0.08})`
      : `rgba(0,0,0,${0.06 + rnd() * 0.12})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 40);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}


// Surface presets for decals. Each returns a greyscale-ish sheet that gets
// multiplied by the decal's own colour, so one texture serves every hue.
const _decalCache = new Map();
export function makeDecalTexture(kind) {
  if (_decalCache.has(kind)) return _decalCache.get(kind);
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  let n = 12345;
  const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const speck = (count, alpha, max) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `rgba(0,0,0,${alpha * rnd()})`;
      const r = 1 + rnd() * max;
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, r, 0, 6.3);
      ctx.fill();
    }
  };

  if (kind === 'concrete') {
    speck(5200, 0.28, 3.2);
    for (let i = 0; i < 30; i++) { // hairline cracks
      ctx.strokeStyle = `rgba(0,0,0,${0.1 + rnd() * 0.18})`;
      ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath();
      let x = rnd() * size; let y = rnd() * size;
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  } else if (kind === 'plating') {
    const cell = size / 2;
    for (let gx = 0; gx < 2; gx++) {
      for (let gy = 0; gy < 2; gy++) {
        const x = gx * cell; const y = gy * cell;
        ctx.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.07})`;
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 5;
        ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 8, y + 8, cell - 16, cell - 16);
        for (let i = 0; i < 8; i++) { // rivets
          const rx = x + 20 + (i % 4) * (cell - 40) / 3;
          const ry = y + (i < 4 ? 20 : cell - 20);
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.beginPath(); ctx.arc(rx, ry + 1, 4.5, 0, 6.3); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath(); ctx.arc(rx, ry - 1, 3.4, 0, 6.3); ctx.fill();
        }
      }
    }
    speck(900, 0.12, 2);
  } else if (kind === 'metal') {
    for (let i = 0; i < 2600; i++) { // brushed grain
      ctx.strokeStyle = rnd() < 0.5
        ? `rgba(0,0,0,${0.03 + rnd() * 0.09})`
        : `rgba(255,255,255,${0.03 + rnd() * 0.09})`;
      ctx.lineWidth = 0.5 + rnd() * 1.4;
      const y = rnd() * size;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (rnd() - 0.5) * 6); ctx.stroke();
    }
  } else if (kind === 'tread') {
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, size, size);
    const step = size / 6;
    for (let gy = 0; gy < 6; gy++) {
      for (let gx = 0; gx < 6; gx++) {
        const cx = gx * step + step / 2;
        const cy = gy * step + step / 2;
        const dir = (gx + gy) % 2 ? 1 : -1;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(dir * 0.6);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(-step * 0.34, -step * 0.1, step * 0.68, step * 0.2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(-step * 0.34, step * 0.06, step * 0.68, step * 0.06);
        ctx.restore();
      }
    }
  } else if (kind === 'rust') {
    speck(4200, 0.3, 5);
    for (let i = 0; i < 240; i++) { // bloom patches and streaks
      const x = rnd() * size; const y = rnd() * size;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 12 + rnd() * 55);
      g.addColorStop(0, `rgba(0,0,0,${0.12 + rnd() * 0.2})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    for (let i = 0; i < 70; i++) {
      const x = rnd() * size; const y = rnd() * size; const len = 30 + rnd() * 150;
      const g = ctx.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, `rgba(0,0,0,${0.1 + rnd() * 0.15})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 3 + rnd() * 10, len);
    }
  } else if (kind === 'tile') {
    const cell = size / 8;
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.09})`;
        ctx.fillRect(gx * cell, gy * cell, cell, cell);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
    }
    speck(600, 0.1, 1.6);
  } else if (kind === 'matte') {
    speck(2200, 0.07, 2.4); // barely anything: flat paint
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  _decalCache.set(kind, tex);
  return tex;
}

// preset name -> how the surface behaves under light
export const DECAL_SURFACES = {
  matte: { roughness: 0.95, metalness: 0.0 },
  concrete: { roughness: 0.94, metalness: 0.04 },
  plating: { roughness: 0.42, metalness: 0.85 },
  metal: { roughness: 0.3, metalness: 0.95 },
  tread: { roughness: 0.45, metalness: 0.8 },
  rust: { roughness: 0.88, metalness: 0.35 },
  tile: { roughness: 0.25, metalness: 0.1 },
};
