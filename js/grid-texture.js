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
