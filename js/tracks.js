import * as THREE from 'three';

// Tread marks pressed into the ground. Each segment is one instanced quad
// carrying its own age, so hundreds of them cost a single draw call. They
// hold at full strength for HOLD seconds, then fade out over FADE.
// Sized so one tank at the fastest hull's top speed can lay a full-length
// trail without recycling (Falcon needs ~1330). With several tanks moving at
// once the oldest marks are reused early, which just shortens trails rather
// than breaking them.
const MAX = 2000;
const HOLD = 20;
const FADE = 6;
// stamp length is set per hull from its own link pitch (see trail below)

// WHY THE EARLIER "FIXES" TO THIS FILE DREW NOTHING.
//
// Three attempts made the bars lie across the track and closed the gaps, and
// all three rendered nothing. The texture and the geometry were never the
// problem — the emitter was. Every one of those attempts anchored the trail
// to the last stamp's position and reset that anchor whenever the tank lost
// ground contact:
//
//     if (!onGround) { anchor = tankPosition; return; }
//
// player.js defines state.contact as "tracks actually touching something THIS
// frame", and it flickers — that is exactly why drive authority needs coyote
// time. So the anchor was being yanked back to the tank several times a
// second and never got a full stamp-length away from it. Below about one
// dropout in five frames the output falls off a cliff to zero marks. Not
// fewer marks: none. Hence invisible.
//
// The rule this file now follows: a dropout SKIPS stamping, it never moves
// the anchor. Only a real teleport does that.
//
// One track imprint, three grousers long. The quad's baked rotations put
// texture v along the direction of travel and u across the track, so the
// grouser bands are stacked up the canvas and span its width.
const BARS = 2;  // shorter stamps follow a turning arc far more closely

function makeTreadTexture() {
  const w = 96;   // across the track
  const h = 192;  // along travel: 64 px per grouser
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // ground scuffed up between the bars
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(3, 0, w - 6, h);
  for (let i = 0; i < 1100; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.06})`;
    ctx.fillRect(3 + Math.random() * (w - 6), Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // the grousers: one band per link, across the full width of the track
  const pitch = h / BARS;
  for (let i = 0; i < BARS; i++) {
    const y = i * pitch;
    const barH = pitch * 0.42; // the raised ridge is about this much of a link
    const g = ctx.createLinearGradient(0, y, 0, y + barH);
    g.addColorStop(0, 'rgba(0,0,0,0.34)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.66)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(4, y, w - 8, barH);

    // the fine detail: each link's cleats, lying with the bar so they run
    // across the track rather than along it
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let k = 0; k < 7; k++) {
      const x = 6 + k * ((w - 12) / 6.4);
      ctx.fillRect(x, y - pitch * 0.04, 1.5, barH + pitch * 0.08);
    }
    // worn ends, so no two imprints read identically
    ctx.clearRect(4, y + Math.random() * barH * 0.6, 3 + Math.random() * 5, 2);
    ctx.clearRect(w - 8, y + Math.random() * barH * 0.6, 3 + Math.random() * 5, 2);
  }

  // darker down the centre line, where the road wheels press hardest
  const centre = ctx.createLinearGradient(0, 0, w, 0);
  centre.addColorStop(0, 'rgba(0,0,0,0)');
  centre.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  centre.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = centre;
  ctx.fillRect(0, 0, w, h);

  // soften the outer edges of the track
  const edge = ctx.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.10, 'rgba(0,0,0,0)');
  edge.addColorStop(0.90, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping; // across the track: no repeat
  tex.wrapT = THREE.RepeatWrapping;      // along travel: tiles link to link
  tex.anisotropy = 8;
  return tex;
}

const VERT = `
attribute float aAge;
attribute vec2 aUv;   // x: u offset, y: u scale — the slice of the track this
                      // instance represents, for partial-width marks
varying vec2 vUv;
varying float vAge;
void main() {
  vUv = vec2(uv.x * aUv.y + aUv.x, uv.y);
  vAge = aAge;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform sampler2D uMap;
uniform float uHold;
uniform float uFade;
varying vec2 vUv;
varying float vAge;
void main() {
  if (vAge < 0.0) discard;
  float k = 1.0 - clamp((vAge - uHold) / uFade, 0.0, 1.0);
  if (k <= 0.001) discard;
  vec4 t = texture2D(uMap, vUv);
  // 0.85 -> 0.6 -> 0.4: pressed ground, barely there, not paint
  gl_FragColor = vec4(0.04, 0.035, 0.03, t.a * k * 0.4);
}
`;

export function createTreadMarks(scene) {
  const tex = makeTreadTexture();
  // lie flat with the quad's LENGTH along local X — the same axis a heading
  // rotation maps forward onto — and its width across local Z
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 2);

  const ages = new Float32Array(MAX).fill(-1);
  geo.setAttribute('aAge', new THREE.InstancedBufferAttribute(ages, 1));
  // default u window is the whole track width
  const uvs = new Float32Array(MAX * 2);
  for (let i = 0; i < MAX; i++) {
    uvs[i * 2] = 0;
    uvs[i * 2 + 1] = 1;
  }
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvs, 2));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMap: { value: tex },
      uHold: { value: HOLD },
      uFade: { value: FADE },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  let next = 0;
  const emitters = new Map(); // per tank, per side: distance since last mark

  const _m = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _euler = new THREE.Euler();

  // uFrom/uTo select which part of the track's width this instance draws, so
  // a track hanging half off a platform prints only the half that is carrying
  // weight instead of a full-width mark or nothing at all.
  function stamp(x, y, z, heading, width, length, tilt = 0, uFrom = 0, uTo = 1) {
    const i = next % MAX;
    next++;
    _pos.set(x, y, z);
    // yaw to face the way the track was going, then pitch to lie ON the
    // slope rather than hovering flat over it
    _euler.set(0, heading, tilt, 'YZX');
    _quat.setFromEuler(_euler);
    _scale.set(length, 1, width * (uTo - uFrom));
    _m.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(i, _m);
    ages[i] = 0;
    uvs[i * 2] = uFrom;
    uvs[i * 2 + 1] = uTo - uFrom;
    mesh.instanceMatrix.needsUpdate = true;
    geo.attributes.aAge.needsUpdate = true;
    geo.attributes.aUv.needsUpdate = true;
  }

  // Lay marks under both tracks of a tank that's actually on the ground.
  // key identifies the tank so each one keeps its own spacing counter.
  // Marks are laid along the ground actually covered, at exact intervals, so
  // the trail is continuous and its spacing doesn't depend on framerate.
  //
  // Read the note at the top of this file before touching the anchor logic:
  // losing ground contact must SKIP a stamp, never move the anchor, or the
  // emitter starves and draws nothing at all.
  function trail(key, model, groundY, heading, moved, onGround) {
    const tread = model.hull.tread;
    // one stamp covers exactly BARS links, so the printed grousers land at
    // the tread's own pitch and consecutive stamps butt up
    const span = (tread.length / tread.linkCount) * BARS;
    const width = tread.linkW;

    // right vector for this heading, to find where each track actually is
    const rx = Math.sin(heading);
    const rz = Math.cos(heading);

    let e = emitters.get(key);
    if (!e) {
      e = { rails: [null, null] };
      emitters.set(key, e);
    }

    // Airborne, or standing still: hold the anchors exactly where they are
    // and wait. Distance keeps accruing across the dropout, which is what
    // makes this survive the contact signal flickering.
    // GROUND ONLY, no grace period. There used to be a fraction of a second
    // of coyote time here to ride out the contact signal flickering over
    // seams and crests — but distance kept accruing across it, so a real jump
    // banked its whole flight and painted it on landing.
    //
    // Contact is no longer the gate on its own, because bailing the instant it
    // dropped is what cut the trail at a slope transition: the tracks lift
    // clear for a few frames as the hull tips onto the ramp. The per-slice
    // probe further down decides for itself whether there is ground close
    // enough to press a mark onto, so the only thing worth bailing on here is
    // a real flight — nothing within reach underneath at all.
    if (!onGround) {
      const under = probe
        ? probe(model.root.position.x, model.root.position.z)
        : null;
      const airborne = under === null || under === undefined
        || model.root.position.y - under > 1.4;
      if (airborne) {
        for (let i = 0; i < 2; i++) {
          const r = e.rails[i];
          if (!r) continue;
          const az = (i === 0 ? -1 : 1) * tread.z;
          r.x = model.root.position.x + rx * az;
          r.z = model.root.position.z + rz * az;
          r.y = groundY;
        }
        return;
      }
    }
    if (moved <= 0) return;

    // EACH TRACK KEEPS ITS OWN ANCHOR.
    //
    // Spacing used to be measured from the hull's centre and then the pair of
    // marks offset sideways to either track. That is only correct in a
    // straight line. In a turn the inner track covers less ground than the
    // centre and the outer covers more, but both were getting the same number
    // of stamps at the same intervals — so the inside bunched up into an
    // overlapping smear and the outside pulled apart into gaps, worse the
    // tighter the turn. Measuring each track against the ground it personally
    // covered lays fewer marks on the inside and more on the outside, exactly
    // as real tracks do, and both rails stay butted up at any steering angle.
    for (let i = 0; i < 2; i++) {
      const oz = (i === 0 ? -1 : 1) * tread.z;
      const tx = model.root.position.x + rx * oz;
      const tz = model.root.position.z + rz * oz;

      let a = e.rails[i];
      if (!a) {
        e.rails[i] = { x: tx, z: tz, y: groundY };
        continue;
      }

      const dx = tx - a.x;
      const dz = tz - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < span) continue;

      const ux = dx / dist;
      const uz = dz / dist;

      // A jump far larger than a few frames of driving means a respawn, a
      // teleport, or a long flight — resume a span behind the tank rather
      // than painting a stripe across everything in between.
      if (dist > span * 5) {
        a.x = tx - ux * span;
        a.z = tz - uz * span;
        a.y = groundY;
      }

      const total = Math.hypot(tx - a.x, tz - a.z);
      // Lay each stamp along the direction this track ACTUALLY travelled over
      // the span, not along the hull's heading. Consecutive rectangles then
      // share an edge instead of each pivoting about its own centre, which is
      // what made a turn read as a run of loose blocks.
      const segHeading = Math.atan2(-uz, ux);
      // ...and pitch it onto the slope it crossed, so marks lie on a ramp
      // instead of hovering flat above it
      const climb = groundY - a.y;
      const tilt = Math.atan2(climb, Math.max(total, 0.001));
      let walked = 0;
      while (total - walked >= span) {
        walked += span;
        const t = walked / total;
        const cx = a.x + ux * walked;
        const cz = a.z + uz * walked;
        const cy = a.y + climb * t;
        stampSupported(cx, cy, cz, segHeading, width, span * 1.14, tilt, rx, rz, ux, uz);
      }
      // carry the remainder, so the next mark lands exactly one span on
      a.y += (groundY - a.y) * (walked / total);
      a.x += ux * walked;
      a.z += uz * walked;
    }
  }

  // How many slices across the track width get tested for ground support.
  const SLICES = 6;
  // Within this much of the track, a mark is pressed on where it is.
  const CONTACT_TOL = 0.22;
  // Beyond that but still within reach, the mark is PUSHED DOWN onto the
  // surface rather than dropped. Crossing onto a slope the hull tips and the
  // tracks lift clear for a few frames; those marks used to be discarded,
  // leaving a gap exactly at the transition. Now they land on the floor, so
  // the trail runs unbroken onto the ramp. Past this the tank really is in the
  // air and nothing is drawn.
  const SNAP_REACH = 2.4;

  // Lay a mark only where there is actually ground under it. The width is
  // sampled in slices: unsupported slices are skipped entirely, and runs of
  // supported ones are merged into as few instances as possible. That covers
  // the three cases at once — a mark that would float draws nothing, a track
  // hanging off a platform edge draws only its inner part, and a track
  // straddling an edge draws only the part that is carried.
  function stampSupported(cx, cy, cz, segHeading, width, length, tiltIn, rx, rz, ux, uz) {
    if (!probe) {
      stamp(cx, cy + 0.015, cz, segHeading, width, length, tiltIn);
      return;
    }

    // Lie the mark ON the ground it covers. The tilt used to come from how far
    // the ANCHOR had climbed over the whole span, which is an average — so a
    // mark laid right at the foot of a ramp sat at the wrong angle with one end
    // buried and the other in the air. Sampling the surface at this stamp's own
    // front and back gives the local gradient instead.
    let tilt = tiltIn;
    if (ux !== undefined) {
      const half = length * 0.5;
      const gf = probe(cx + ux * half, cz + uz * half);
      const gb = probe(cx - ux * half, cz - uz * half);
      if (gf !== null && gf !== undefined && gb !== null && gb !== undefined) {
        tilt = Math.atan2(gf - gb, length);
      }
    }
    // Which surface is this track actually riding? The highest one at or below
    // it that is within reach. Slices whose ground is far below THAT are over a
    // drop and get nothing — otherwise a track hanging off a platform edge
    // would press its overhanging half onto the floor two metres down, and the
    // averaged height would put the mark in mid-air between the two.
    let ref = null;
    for (let s = 0; s < SLICES; s++) {
      const f = (s + 0.5) / SLICES - 0.5;
      const g = probe(cx + rx * f * width, cz + rz * f * width);
      if (g === null || g === undefined) continue;
      if (g > cy + CONTACT_TOL) continue;      // above the track: not ours
      if (cy - g > SNAP_REACH) continue;       // too far below to press onto
      if (ref === null || g > ref) ref = g;
    }
    if (ref === null) return;                  // genuinely nothing underneath
    const BAND = 0.35;                         // one surface per mark

    let runStart = -1;
    let runY = 0;   // surface height the current run of slices rests on
    let runN = 0;

    const flush = (endSlice) => {
      if (runStart < 0) return;
      const uFrom = runStart / SLICES;
      const uTo = endSlice / SLICES;
      const mid = (uFrom + uTo) / 2 - 0.5;
      // sit the mark on the surface the slices actually found — this is what
      // presses a lifted track back down onto the floor
      const y = runN > 0 ? runY / runN : cy;
      stamp(
        cx + rx * mid * width,
        y + 0.015,
        cz + rz * mid * width,
        segHeading, width, length, tilt, uFrom, uTo
      );
      runStart = -1;
      runY = 0;
      runN = 0;
    };

    for (let s = 0; s <= SLICES; s++) {
      let ok = false;
      let surface = cy;
      if (s < SLICES) {
        // centre of this slice, measured out from the track's own centreline
        const f = (s + 0.5) / SLICES - 0.5;
        const sx = cx + rx * f * width;
        const sz = cz + rz * f * width;
        const g = probe(sx, sz);
        // only the surface this track is riding counts; anything a step below
        // it is a drop the track is hanging over
        if (g !== null && g !== undefined && Math.abs(g - ref) <= BAND) {
          ok = true;
          surface = g;
        }
      }
      if (ok) {
        if (runStart < 0) runStart = s;
        runY += surface;
        runN++;
      } else {
        flush(s);
      }
    }
  }

  // main.js supplies this: the height of whatever solid surface is under a
  // world column, or null if there is nothing there at all.
  let probe = null;
  function setProbe(fn) {
    probe = fn;
  }

  function forget(key) {
    emitters.delete(key);
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      if (ages[i] < 0) continue;
      ages[i] += dt;
      if (ages[i] > HOLD + FADE) ages[i] = -1;
      dirty = true;
    }
    if (dirty) geo.attributes.aAge.needsUpdate = true;
  }

  function clear() {
    ages.fill(-1);
    emitters.clear();
    geo.attributes.aAge.needsUpdate = true;
  }

  return { trail, update, clear, forget, setProbe, mesh };
}
