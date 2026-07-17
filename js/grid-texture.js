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
