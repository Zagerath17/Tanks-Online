import * as THREE from 'three';

// Tread marks pressed into the ground.
//
// REBUILT FROM SCRATCH. The previous version was an InstancedMesh driven by a
// custom ShaderMaterial with a per-instance age attribute. Every piece of that
// checked out in isolation — transforms, UVs, texture alpha, winding — and it
// still would not show on screen, which says the machinery was at fault rather
// than the maths. So none of that machinery is here any more. This is the
// dullest thing that can possibly work:
//
//   * ONE ordinary THREE.Mesh, no instancing;
//   * ONE ordinary MeshBasicMaterial with a map — no custom shader, no custom
//     attributes, nothing depending on USE_INSTANCING or a varying;
//   * quads written straight into a plain position buffer in WORLD space, so
//     no per-object matrix is involved at all;
//   * per-corner RGBA vertex colours for the fade, which is stock three.js.
//
// If it can be drawn at all, this will draw.

const MAX = 1400;   // quads (two per stamp, so ~700 stamps of trail)
const HOLD = 20;    // seconds at full strength
const FADE = 6;     // then fades out over this long
const BARS = 3;     // grousers per stamp; a stamp is BARS link-pitches long

// The imprint. Canvas u runs ALONG the direction of travel, so the bars lie
// across the track the way real links land; v runs across the track width.
function makeTreadTexture() {
  const w = 192; // 64 px per grouser, along travel
  const h = 128; // across the track
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // Near-black but not pure black: with no shader in the path the texture
  // carries the colour as well as the alpha.
  const INK = '14, 13, 12';

  // ground scuffed up between the bars
  ctx.fillStyle = `rgba(${INK}, 0.24)`;
  ctx.fillRect(0, 2, w, h - 4);
  for (let i = 0; i < 1200; i++) {
    ctx.fillStyle = `rgba(${INK}, ${0.03 + Math.random() * 0.1})`;
    ctx.fillRect(Math.random() * w, 2 + Math.random() * (h - 4), 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // the grousers, one per link, spanning the full width of the track
  const pitch = w / BARS;
  for (let i = 0; i < BARS; i++) {
    const x = i * pitch;
    const barW = pitch * 0.54;
    const g = ctx.createLinearGradient(x, 0, x + barW, 0);
    g.addColorStop(0, `rgba(${INK}, 0.48)`);
    g.addColorStop(0.45, `rgba(${INK}, 0.86)`);
    g.addColorStop(1, `rgba(${INK}, 0.44)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, 3, barW, h - 6);

    // cleat detail along each bar
    ctx.fillStyle = `rgba(${INK}, 0.3)`;
    for (let k = 0; k < 7; k++) {
      const y = 6 + k * ((h - 12) / 6.4);
      ctx.fillRect(x - pitch * 0.05, y, barW + pitch * 0.1, 1.5);
    }
    // worn ends, so no two imprints read identically
    ctx.clearRect(x + Math.random() * barW * 0.6, 3, 2, 3 + Math.random() * 5);
    ctx.clearRect(x + Math.random() * barW * 0.6, h - 8, 2, 3 + Math.random() * 5);
  }

  // pressed hardest down the centre, where the road wheels ride
  const centre = ctx.createLinearGradient(0, 0, 0, h);
  centre.addColorStop(0, `rgba(${INK}, 0)`);
  centre.addColorStop(0.5, `rgba(${INK}, 0.2)`);
  centre.addColorStop(1, `rgba(${INK}, 0)`);
  ctx.fillStyle = centre;
  ctx.fillRect(0, 0, w, h);

  // feather the two SIDES of the track (v), never the ends (u) — the ends
  // have to meet the next stamp cleanly
  const edge = ctx.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.09, 'rgba(0,0,0,0)');
  edge.addColorStop(0.91, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // the bars repeat along the axis a chase camera foreshortens most, which is
  // exactly where trilinear mipmapping smears worst
  tex.anisotropy = 16;
  return tex;
}

export function createTreadMarks(scene) {
  const tex = makeTreadTexture();

  // ---- one plain mesh, quads written in world space ------------------------
  const geo = new THREE.BufferGeometry();
  const position = new Float32Array(MAX * 4 * 3);
  const uv = new Float32Array(MAX * 4 * 2);
  const color = new Float32Array(MAX * 4 * 4); // RGBA; alpha carries the fade
  const index = new Uint32Array(MAX * 6);

  for (let q = 0; q < MAX; q++) {
    const v = q * 4;
    // corner order: (u0,v0) (u1,v0) (u1,v1) (u0,v1)
    uv[(v + 0) * 2] = 0; uv[(v + 0) * 2 + 1] = 0;
    uv[(v + 1) * 2] = 1; uv[(v + 1) * 2 + 1] = 0;
    uv[(v + 2) * 2] = 1; uv[(v + 2) * 2 + 1] = 1;
    uv[(v + 3) * 2] = 0; uv[(v + 3) * 2 + 1] = 1;
    for (let k = 0; k < 4; k++) {
      color[(v + k) * 4] = 1;
      color[(v + k) * 4 + 1] = 1;
      color[(v + k) * 4 + 2] = 1;
      color[(v + k) * 4 + 3] = 0; // invisible until the quad is used
    }
    const o = q * 6;
    index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
    index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
  }

  const posAttr = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', colAttr);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    vertexColors: true,   // itemSize 4 -> three enables USE_COLOR_ALPHA
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the buffer is world space; the mesh never moves
  mesh.renderOrder = 2;
  scene.add(mesh);

  const ages = new Float32Array(MAX).fill(-1);
  let next = 0;
  let live = 0; // high-water mark, so drawRange only covers written quads
  const emitters = new Map();

  function setAlpha(q, a) {
    const v = q * 4;
    color[v * 4 + 3] = a;
    color[(v + 1) * 4 + 3] = a;
    color[(v + 2) * 4 + 3] = a;
    color[(v + 3) * 4 + 3] = a;
  }

  // One imprint, laid flat, written straight into world space.
  function stamp(x, y, z, heading, width, length) {
    const q = next % MAX;
    next++;
    if (next > live) live = Math.min(next, MAX);

    // heading maps local +X onto forward = (cos h, 0, -sin h)
    const ch = Math.cos(heading);
    const sh = Math.sin(heading);
    const hl = length / 2;
    const hw = width / 2;
    const fx = ch * hl, fz = -sh * hl;   // half a stamp along travel
    const rx = sh * hw, rz = ch * hw;    // half a stamp across the track

    const v = q * 4;
    const p = position;
    // u runs along travel, v across the width — matching the texture
    p[(v + 0) * 3] = x - fx - rx; p[(v + 0) * 3 + 1] = y; p[(v + 0) * 3 + 2] = z - fz - rz;
    p[(v + 1) * 3] = x + fx - rx; p[(v + 1) * 3 + 1] = y; p[(v + 1) * 3 + 2] = z + fz - rz;
    p[(v + 2) * 3] = x + fx + rx; p[(v + 2) * 3 + 1] = y; p[(v + 2) * 3 + 2] = z + fz + rz;
    p[(v + 3) * 3] = x - fx + rx; p[(v + 3) * 3 + 1] = y; p[(v + 3) * 3 + 2] = z - fz + rz;

    ages[q] = 0;
    setAlpha(q, 1);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.setDrawRange(0, live * 6);
  }

  // Lay marks under both tracks of a tank that's on the ground. Spacing is
  // measured from where the last pair actually went down, so the trail is
  // continuous at any frame rate and any speed.
  function trail(key, model, groundY, heading, moved, onGround) {
    const tread = model.hull.tread;
    const span = (tread.length / tread.linkCount) * BARS;

    const px = model.root.position.x;
    const pz = model.root.position.z;

    let e = emitters.get(key);
    if (!e) {
      e = { x: px, z: pz, primed: false };
      emitters.set(key, e);
    }
    if (!onGround || moved <= 0) {
      e.x = px; e.z = pz; e.primed = onGround;
      return;
    }
    if (!e.primed) {
      e.x = px; e.z = pz; e.primed = true;
      return;
    }

    const dx = px - e.x;
    const dz = pz - e.z;
    const gap = Math.hypot(dx, dz);
    if (gap < span) return;
    if (gap > span * 24) { e.x = px; e.z = pz; return; } // respawned elsewhere

    const width = tread.linkW;
    const rx = Math.sin(heading);
    const rz = Math.cos(heading);
    const n = Math.floor(gap / span);
    const ux = dx / gap;
    const uz = dz / gap;
    for (let k = 1; k <= n; k++) {
      const sx = e.x + ux * span * k;
      const sz = e.z + uz * span * k;
      for (const side of [-1, 1]) {
        const oz = side * tread.z;
        stamp(
          sx + rx * oz,
          groundY + 0.02,
          sz + rz * oz,
          heading,
          width,
          span * 1.12 // overlap, so a turn cannot open a wedge on the outside
        );
      }
    }
    e.x += ux * span * n;
    e.z += uz * span * n;
  }

  function forget(key) {
    emitters.delete(key);
  }

  function update(dt) {
    let dirty = false;
    for (let q = 0; q < live; q++) {
      const a = ages[q];
      if (a < 0) continue;
      const t = a + dt;
      ages[q] = t;
      if (t > HOLD + FADE) {
        ages[q] = -1;
        setAlpha(q, 0);
        dirty = true;
      } else if (t > HOLD) {
        setAlpha(q, 1 - (t - HOLD) / FADE);
        dirty = true;
      }
    }
    if (dirty) colAttr.needsUpdate = true;
  }

  function clear() {
    ages.fill(-1);
    for (let q = 0; q < MAX; q++) setAlpha(q, 0);
    colAttr.needsUpdate = true;
    emitters.clear();
    next = 0;
    live = 0;
    geo.setDrawRange(0, 0);
  }

  return { trail, update, clear, forget, mesh, geometry: geo, material: mat };
}
