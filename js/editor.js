import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { makeGridTexture, makeDecalTexture, DECAL_SURFACES } from './grid-texture.js';

// Editor sandbox: flat ground, placeable walls / platforms / slopes / spawns,
// and surface-conforming decals. All solid pieces carry corner-origin UVs in
// world units so every surface shares the same aligned 1-unit grid.
const GROUND_HALF = 120;
// The ground lays one 4-unit texture tile with 4 cells in it, and a heavier
// line every 8 cells. Every placed piece uses exactly the same numbers, so
// walls, platforms and slopes all carry the same grid as the floor.
const GRID_TILE = 4;
const GRID_CELLS = 4;
const GRID_MAJOR = 8;
export const MAP_FORMAT = 'tank-remake-map';

const LIMITS = {
  L: [2, 40],
  H: [1, 14],
  W: [1, 40],
  angle: [(5 * Math.PI) / 180, (45 * Math.PI) / 180],
};

const STEP = { L: 1, H: 0.5, W: 1, angle: (2.5 * Math.PI) / 180 };

const COLORS = {
  wall: ['#5a626c', '#4c545e'],
  platform: ['#7d8894', '#6d7884'],
  slope: ['#747f8b', '#65707c'],
  // the practice targets get a ghost too, tinted by side
  enemy: ['#8e3a30', '#75302a'],
  ally: ['#3f7a52', '#356745'],
};

const clamp = THREE.MathUtils.clamp;

// A slope is defined by its HEIGHT, not its angle — the angle falls out of
// the run. Walls and platforms step their height by STEP.H, so defining a
// ramp the same way is what lets its crest land exactly on a platform top
// instead of somewhere near it.
function slopeHeight(d) {
  if (d.H !== undefined) return d.H;
  return Math.tan(d.angle) * d.L; // older saves still carry an angle
}

function slopeAngle(d) {
  return Math.atan2(slopeHeight(d), d.L);
}

// ---------------------------------------------------------------------------
// Grid-aligned geometry: every face gets UVs in world units measured from its
// own corner, and the material tiles a single 1x1-unit grid cell — so cells
// are the same size everywhere and lines land on piece edges.
// ---------------------------------------------------------------------------
// Re-project a placed piece's UVs from WORLD position rather than from its
// own corner. One texture tile is one world unit, so grid lines land on world
// integers on every face of every piece — two pieces sitting side by side at
// the same height have lines that carry straight across the join.
const _wp = new THREE.Vector3();
const _wn = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _nm = new THREE.Matrix3();

function worldAlignUVs(mesh) {
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  if (!pos || !nor || !uv) return;
  _nm.getNormalMatrix(mesh.matrixWorld);

  for (let i = 0; i < pos.count; i++) {
    _wp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    _wn.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
    const ax = Math.abs(_wn.x);
    const ay = Math.abs(_wn.y);
    const az = Math.abs(_wn.z);
    // project along whichever world axis the face points down most
    // One texture tile is GRID_TILE world units, exactly as on the ground, so
    // cells are the same size and land on the same world lines everywhere.
    //
    // Flat and vertical faces can just drop an axis. A SLOPE cannot: dropping
    // Y projects its incline from above, which stretches every cell by
    // 1 / cos(angle) along the gradient and is why ramps never matched the
    // walls next to them. Tilted faces get a proper in-plane frame instead —
    // one axis horizontal across the slope, one running up it — so the cells
    // come out square and still line up with the floor along the bottom edge.
    const tilted = ay > 0.08 && ay < 0.985;
    if (tilted) {
      _t1.set(0, 1, 0).cross(_wn).normalize();     // across the slope
      _t2.copy(_wn).cross(_t1).normalize();        // up the slope
      uv.setXY(i, _wp.dot(_t1) / GRID_TILE, _wp.dot(_t2) / GRID_TILE);
    } else if (ay >= ax && ay >= az) uv.setXY(i, _wp.x / GRID_TILE, _wp.z / GRID_TILE);
    else if (ax >= az) uv.setXY(i, _wp.z / GRID_TILE, _wp.y / GRID_TILE);
    else uv.setXY(i, _wp.x / GRID_TILE, _wp.y / GRID_TILE);
  }
  uv.needsUpdate = true;
}

function makeFaceGeometry(build) {
  const pos = [];
  const nor = [];
  const uv = [];
  const emit = (p, n, u) => {
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    uv.push(u[0], u[1]);
  };
  const quad = (a, b, c, d, n, ua, ub, uc, ud) => {
    emit(a, n, ua); emit(b, n, ub); emit(c, n, uc);
    emit(a, n, ua); emit(c, n, uc); emit(d, n, ud);
  };
  const tri = (a, b, c, n, ua, ub, uc) => {
    emit(a, n, ua); emit(b, n, ub); emit(c, n, uc);
  };
  build(quad, tri);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

function buildBoxGridGeometry(L, H, W) {
  const x = L / 2;
  const z = W / 2;
  return makeFaceGeometry((quad) => {
    quad([x, 0, z], [x, 0, -z], [x, H, -z], [x, H, z], [1, 0, 0],
      [0, 0], [W, 0], [W, H], [0, H]);
    quad([-x, 0, -z], [-x, 0, z], [-x, H, z], [-x, H, -z], [-1, 0, 0],
      [0, 0], [W, 0], [W, H], [0, H]);
    quad([-x, 0, z], [x, 0, z], [x, H, z], [-x, H, z], [0, 0, 1],
      [0, 0], [L, 0], [L, H], [0, H]);
    quad([x, 0, -z], [-x, 0, -z], [-x, H, -z], [x, H, -z], [0, 0, -1],
      [0, 0], [L, 0], [L, H], [0, H]);
    quad([-x, H, z], [x, H, z], [x, H, -z], [-x, H, -z], [0, 1, 0],
      [0, 0], [L, 0], [L, W], [0, W]);
    quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [0, -1, 0],
      [0, 0], [L, 0], [L, W], [0, W]);
  });
}

function buildWedgeGridGeometry(L, W, angle) {
  const H = Math.tan(angle) * L;
  const x = L / 2;
  const z = W / 2;
  const hyp = Math.hypot(L, H);
  const inx = H / hyp;
  const iny = L / hyp;
  return makeFaceGeometry((quad, tri) => {
    // bottom
    quad([-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [0, -1, 0],
      [0, 0], [L, 0], [L, W], [0, W]);
    // tall back face
    quad([-x, 0, -z], [-x, 0, z], [-x, H, z], [-x, H, -z], [-1, 0, 0],
      [0, 0], [W, 0], [W, H], [0, H]);
    // incline: u runs down the slope from the top edge, in surface units
    quad([-x, H, -z], [-x, H, z], [x, 0, z], [x, 0, -z], [inx, iny, 0],
      [0, 0], [0, W], [hyp, W], [hyp, 0]);
    // triangular sides
    tri([-x, 0, -z], [-x, H, -z], [x, 0, -z], [0, 0, -1],
      [0, 0], [0, H], [L, 0]);
    tri([-x, 0, z], [x, 0, z], [-x, H, z], [0, 0, 1],
      [0, 0], [L, 0], [0, H]);
  });
}

export function createEditor({ scene, physics, onPlaceTarget }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // ---- flat build ground (1-unit minor cells, 4-unit majors) ---------------
  const groundTex = makeGridTexture({
    cells: GRID_CELLS,
    base: '#98a0a8',
    line: '#87909a',
    lineWidth: 2,
    major: GRID_MAJOR,
    majorLine: '#747e88',
    majorWidth: 6,
    repeat: [GROUND_HALF * 2 / GRID_TILE, GROUND_HALF * 2 / GRID_TILE],
    anisotropy: 16,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  ground.updateMatrixWorld(true);

  // ---- shared 1-unit-cell materials ---------------------------------------
  const solidMats = {};
  function solidMaterial(type) {
    if (!solidMats[type]) {
      solidMats[type] = new THREE.MeshStandardMaterial({
        map: makeGridTexture({
          cells: GRID_CELLS,
          base: COLORS[type][0],
          line: COLORS[type][1],
          lineWidth: 2,
          major: GRID_MAJOR,
          majorLine: COLORS[type][1],
          majorWidth: 6,
          repeat: [1, 1],
          anisotropy: 16,
        }),
        roughness: 0.92,
      });
    }
    return solidMats[type];
  }

  // ---- tool state ----------------------------------------------------------
  let tool = 'wall';
  const dims = {
    wall: { L: 8, H: 3, W: 1 },
    platform: { L: 8, H: 2, W: 8 },
    slope: { L: 8, H: 3, W: 6 },
    enemy: { L: 4, H: 1.6, W: 3 },
    ally: { L: 4, H: 1.6, W: 3 },
    spawn: {},
    decal: {},
  };
  let ghostYaw = 0;

  // decal brush — steps sit on the same half/quarter-unit grid as placement
  const decal = {
    shape: 'rect', w: 2, h: 2, r: 1, s: 2, spin: 0, color: '#e8563a',
    surface: 'matte',   // which preset sheet it is painted on
    metalness: 0,       // ...and how much it catches the light, on a slider
  };
  const DLIM = { w: [0.5, 24], h: [0.5, 24], r: [0.25, 14], s: [0.5, 16] };
  const DSTEP = { w: 0.5, h: 0.5, r: 0.25, s: 0.5 };

  const objects = []; // solids + spawns
  const decals = [];
  let pointedAt = null;
  let pointedDecal = null;

  // ---- decal shape masks + sizes -------------------------------------------
  function shapeAlpha(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#fff';
    if (kind === 'circle') {
      ctx.beginPath();
      ctx.arc(128, 128, 126, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(128, 2);
      ctx.lineTo(2, 254);
      ctx.lineTo(254, 254);
      ctx.closePath();
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }
  const alphaTex = { circle: shapeAlpha('circle'), triangle: shapeAlpha('triangle') };

  function decalSize(dc) {
    if (dc.shape === 'circle') return new THREE.Vector3(dc.r * 2, dc.r * 2, 1.4);
    if (dc.shape === 'triangle') return new THREE.Vector3(dc.s * 1.732, dc.s * 1.5, 1.4);
    return new THREE.Vector3(dc.w, dc.h, 1.4);
  }

  // Lit, not flat. These were MeshBasicMaterial, which ignores every light in
  // the scene — so a decal could never look like concrete or plate, only like
  // a sticker. Standard material means the surface preset and the metalness
  // slider actually do something.
  function decalMaterial(dc, ghostly) {
    const surf = DECAL_SURFACES[dc.surface] || DECAL_SURFACES.matte;
    const map = makeDecalTexture(dc.surface || 'matte');
    return new THREE.MeshStandardMaterial({
      color: dc.color,
      map,
      alphaMap: dc.shape === 'rect' ? null : alphaTex[dc.shape],
      alphaTest: dc.shape === 'rect' ? 0 : 0.5,
      transparent: ghostly,
      opacity: ghostly ? 0.55 : 1,
      depthWrite: !ghostly,
      roughness: surf.roughness,
      metalness: dc.metalness !== undefined ? dc.metalness : surf.metalness,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  // ---- geometry per type ---------------------------------------------------
  function spawnArrowGeometry() {
    const s = new THREE.Shape();
    s.moveTo(2.0, 0);
    s.lineTo(0.9, 0.72);
    s.lineTo(0.9, -0.72);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.1, 0);
    return geo;
  }

  function buildGeometries(type, d) {
    if (type === 'spawn') {
      const disc = new THREE.CylinderGeometry(2.1, 2.1, 0.08, 32);
      disc.translate(0, 0.04, 0);
      return [disc, spawnArrowGeometry()];
    }
    if (type === 'slope') return [buildWedgeGridGeometry(d.L, d.W, slopeAngle(d))];
    if (type === 'enemy' || type === 'ally') {
      // roughly tank shaped, so you can see how it will sit before placing
      const hull = new THREE.BoxGeometry(d.L, d.H * 0.55, d.W);
      hull.translate(0, d.H * 0.28, 0);
      const turret = new THREE.BoxGeometry(d.L * 0.42, d.H * 0.34, d.W * 0.5);
      turret.translate(-d.L * 0.05, d.H * 0.72, 0);
      const gun = new THREE.BoxGeometry(d.L * 0.5, d.H * 0.1, d.H * 0.1);
      gun.translate(d.L * 0.42, d.H * 0.72, 0);
      return [hull, turret, gun];
    }
    return [buildBoxGridGeometry(d.L, d.H, d.W)];
  }

  function buildMaterials(type) {
    if (type === 'spawn') {
      return [
        new THREE.MeshStandardMaterial({
          color: '#9cc36e', transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.8,
        }),
        new THREE.MeshStandardMaterial({ color: '#c8d9ae', roughness: 0.7 }),
      ];
    }
    const mat = solidMaterial(type);
    return type === 'slope' ? [mat] : [mat];
  }

  // ---- ghosts --------------------------------------------------------------
  const ghostMat = new THREE.MeshStandardMaterial({
    color: '#9cc36e',
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const ghost = new THREE.Group();
  ghost.visible = false;
  group.add(ghost);

  const decalGhost = new THREE.Mesh(new THREE.BufferGeometry(), decalMaterial(decal, true));
  decalGhost.visible = false;
  group.add(decalGhost);
  let decalGhostKey = '';
  let lastDecalHit = null;

  function rebuildGhost() {
    for (const c of [...ghost.children]) {
      ghost.remove(c);
      c.geometry.dispose();
    }
    if (tool === 'decal') return; // decal ghost is projected per-frame
    for (const geo of buildGeometries(tool, dims[tool])) {
      ghost.add(new THREE.Mesh(geo, ghostMat));
    }
  }
  rebuildGhost();

  function refreshDecalGhostMaterial() {
    decalGhost.material.dispose();
    decalGhost.material = decalMaterial(decal, true);
    decalGhostKey = '';
  }

  function setTool(t) {
    if (!dims[t] || t === tool) return;
    tool = t;
    ghost.visible = false;
    decalGhost.visible = false;
    decalGhostKey = '';
    rebuildGhost();
  }

  function rotateGhost() {
    if (tool === 'decal') decal.spin += Math.PI / 12;
    else ghostYaw += Math.PI / 12;
  }

  function setDecalShape(shape) {
    if (!['rect', 'circle', 'triangle'].includes(shape) || shape === decal.shape) return;
    decal.shape = shape;
    refreshDecalGhostMaterial();
  }

  function setDecalSurface(name) {
    if (!DECAL_SURFACES[name] || name === decal.surface) return;
    decal.surface = name;
    // adopt the preset's own metalness, which the slider can then override
    decal.metalness = DECAL_SURFACES[name].metalness;
    decalGhost.material.dispose();
    decalGhost.material = decalMaterial(decal, true);
  }

  function setDecalMetalness(v) {
    decal.metalness = clamp(v, 0, 1);
    decalGhost.material.metalness = decal.metalness;
  }

  function decalBrush() {
    return { surface: decal.surface, metalness: decal.metalness, color: decal.color };
  }

  function setDecalColor(hex) {
    decal.color = hex;
    decalGhost.material.color.set(hex);
  }

  function adjust(axis, dir) {
    if (tool === 'spawn') return;
    if (tool === 'decal') {
      if (decal.shape === 'circle') decal.r = clamp(decal.r + dir * DSTEP.r, DLIM.r[0], DLIM.r[1]);
      else if (decal.shape === 'triangle') decal.s = clamp(decal.s + dir * DSTEP.s, DLIM.s[0], DLIM.s[1]);
      else if (axis === 'w') decal.h = clamp(decal.h + dir * DSTEP.h, DLIM.h[0], DLIM.h[1]);
      else decal.w = clamp(decal.w + dir * DSTEP.w, DLIM.w[0], DLIM.w[1]);
      return;
    }
    const d = dims[tool];
    if (axis === 'l') d.L = clamp(d.L + dir * STEP.L, LIMITS.L[0], LIMITS.L[1]);
    else if (axis === 'w') d.W = clamp(d.W + dir * STEP.W, LIMITS.W[0], LIMITS.W[1]);
    else d.H = clamp(d.H + dir * STEP.H, LIMITS.H[0], LIMITS.H[1]);
    rebuildGhost();
  }

  // ---- placement raycast ---------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const _center = new THREE.Vector2(0, 0);
  const _n = new THREE.Vector3();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _projQuat = new THREE.Quaternion();
  const _spinQuat = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _euler = new THREE.Euler();

  function ownerOf(node) {
    while (node) {
      if (node.userData && node.userData.owner) return node.userData.owner;
      node = node.parent;
    }
    return null;
  }

  function updateGhost(camera) {
    raycaster.setFromCamera(_center, camera);
    const surfaces = [ground, ...objects.filter((o) => o.type !== 'spawn').map((o) => o.group)];
    const hits = raycaster.intersectObjects(surfaces, true);

    pointedDecal = null;
    if (decals.length) {
      const dHits = raycaster.intersectObjects(decals.map((d) => d.mesh), false);
      if (dHits.length && (!hits.length || dHits[0].distance <= hits[0].distance + 0.05)) {
        pointedDecal = dHits[0].object.userData.decal;
      }
    }

    pointedAt = null;
    if (!hits.length || hits[0].distance > 130) {
      ghost.visible = false;
      decalGhost.visible = false;
      return;
    }
    const hit = hits[0];
    if (hit.object !== ground) pointedAt = ownerOf(hit.object);

    if (tool === 'decal') {
      ghost.visible = false;
      _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      _projQuat.setFromUnitVectors(_zAxis, _n);
      _spinQuat.setFromAxisAngle(_zAxis, decal.spin);
      _q.copy(_projQuat).multiply(_spinQuat);
      // half-unit grid snap keeps decals on the same grid as everything else
      const px = Math.round(hit.point.x * 2) / 2;
      const py = Math.round(hit.point.y * 2) / 2;
      const pz = Math.round(hit.point.z * 2) / 2;

      const key = [
        hit.object.id, decal.shape, decal.w, decal.h, decal.r, decal.s,
        Math.round(decal.spin * 200), px, py, pz,
        Math.round(_n.x * 100), Math.round(_n.y * 100), Math.round(_n.z * 100),
      ].join('|');
      if (key !== decalGhostKey) {
        decalGhostKey = key;
        _euler.setFromQuaternion(_q);
        let geo = new DecalGeometry(
          hit.object,
          new THREE.Vector3(px, py, pz),
          _euler,
          decalSize(decal)
        );
        geo = clipDecalToFace(geo, _n);
        decalGhost.geometry.dispose();
        decalGhost.geometry = geo;
        lastDecalHit = {
          mesh: hit.object,
          owner: pointedAt,
          pos: new THREE.Vector3(px, py, pz),
          quat: _q.clone(),
        };
      }
      decalGhost.visible = decalGhost.geometry.getAttribute('position')?.count > 0;
      return;
    }

    decalGhost.visible = false;
    ghost.quaternion.identity();
    ghost.rotation.y = ghostYaw;
    ghost.position.set(
      Math.round(hit.point.x),
      Math.max(0, Math.round(hit.point.y * 2) / 2),
      Math.round(hit.point.z)
    );
    ghost.visible = true;
  }

  function hideGhost() {
    ghost.visible = false;
    decalGhost.visible = false;
    decalGhostKey = '';
    pointedAt = null;
    pointedDecal = null;
  }

  // ---- place ---------------------------------------------------------------
  // DecalGeometry happily wraps a projection around a corner onto the
  // neighbouring face. Drop any triangle whose normal has turned away from
  // the face we aimed at, so the decal stops dead at the edge.
  const _fn = new THREE.Vector3();
  const _vn = new THREE.Vector3();

  function clipDecalToFace(geo, dir) {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    if (!pos || !nor) return geo;
    const LIMIT = Math.cos(0.7); // ~40 degrees off the face before it's cut
    const kp = [];
    const kn = [];
    const ku = [];
    for (let i = 0; i < pos.count; i += 3) {
      _fn.set(0, 0, 0);
      for (let k = 0; k < 3; k++) {
        _vn.fromBufferAttribute(nor, i + k);
        _fn.add(_vn);
      }
      if (_fn.lengthSq() === 0) continue;
      _fn.normalize();
      if (_fn.dot(dir) < LIMIT) continue; // curled onto another face
      for (let k = 0; k < 3; k++) {
        _vn.fromBufferAttribute(pos, i + k);
        kp.push(_vn.x, _vn.y, _vn.z);
        _vn.fromBufferAttribute(nor, i + k);
        kn.push(_vn.x, _vn.y, _vn.z);
        if (uv) ku.push(uv.getX(i + k), uv.getY(i + k));
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(kn, 3));
    if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(ku, 2));
    geo.dispose();
    return out;
  }

  // every decal placed sits one layer above the last, so stacking them never
  // z-fights or stitches through what is underneath
  let decalSeq = 0;

  const _projDir = new THREE.Vector3();

  function makeDecalRecord(dc, targetMesh, owner, pos, quat) {
    _euler.setFromQuaternion(quat);
    let geo = new DecalGeometry(targetMesh, pos, _euler, decalSize(dc));
    if (!geo.getAttribute('position') || geo.getAttribute('position').count === 0) {
      geo.dispose();
      return null;
    }
    // the decal faces along its own +Z; anything that has bent away from
    // that has wrapped onto a neighbouring face and gets cut
    _projDir.set(0, 0, 1).applyQuaternion(quat).normalize();
    geo = clipDecalToFace(geo, _projDir);
    if (geo.getAttribute('position').count === 0) {
      geo.dispose();
      return null;
    }

    const layer = ++decalSeq;
    const mat = decalMaterial(dc, false);
    // Stacking order comes from renderOrder and a hair of physical lift along
    // the surface normal — NOT from an ever-growing depth bias.
    //
    // It used to ramp polygonOffset up to -52 per layer. That factor is
    // multiplied by the polygon's depth slope, so on a slope (where the slope
    // term is large) the decal was pushed so far toward the camera that it
    // beat walls standing in front of it — which is why a decal on a ramp
    // could be seen straight through other objects.
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3 + (layer % 128);
    // lift later decals a fraction further off the face they sit on, which is
    // what separates a stack without touching depth bias at all
    _projDir.set(0, 0, 1).applyQuaternion(quat).normalize();
    mesh.position.addScaledVector(_projDir, 0.004 + (layer % 24) * 0.0015);
    group.add(mesh);
    const rec = {
      shape: dc.shape,
      dims: { w: dc.w, h: dc.h, r: dc.r, s: dc.s },
      spin: dc.spin,
      color: dc.color,
      surface: dc.surface,
      metalness: dc.metalness,
      mesh,
      owner,
      pos: pos.clone(),
      quat: quat.clone(),
    };
    mesh.userData.decal = rec;
    decals.push(rec);
    return rec;
  }

  function placeAt(type, d, pos, yaw) {
    const objGroup = new THREE.Group();
    const geos = buildGeometries(type, d);
    const mats = buildMaterials(type);
    for (let i = 0; i < geos.length; i++) {
      const mesh = new THREE.Mesh(geos[i], mats[i]);
      if (type !== 'spawn') {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else {
        mesh.receiveShadow = true;
      }
      objGroup.add(mesh);
    }
    objGroup.position.copy(pos);
    objGroup.rotation.y = yaw;
    group.add(objGroup);
    objGroup.updateMatrixWorld(true);

    // every solid shares one world grid, so neighbouring pieces line up
    if (type !== 'spawn') {
      for (const mesh of objGroup.children) worldAlignUVs(mesh);
    }

    const bodies = [];
    if (type === 'wall' || type === 'platform') {
      const qYaw = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
      bodies.push(physics.addStaticBox(
        d.L / 2, d.H / 2, d.W / 2,
        new CANNON.Vec3(pos.x, pos.y + d.H / 2, pos.z),
        qYaw
      ));
    } else if (type === 'slope') {
      // One convex wedge, exactly the shape that is drawn. This used to be a
      // tilted slab with a filler box under the tall end, and the filler's
      // minimum height meant that on a shallow ramp it stood proud of the
      // incline — an invisible hump you climbed before reaching the slope.
      const H = slopeHeight(d);
      const x = d.L / 2;
      const z = d.W / 2;
      const verts = [
        [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], // 0..3 base
        [-x, H, -z], [-x, H, z],                        // 4,5 crest
      ];
      // Wound so every normal points OUT of the solid. cannon-es takes the
      // winding at face value — get it backwards and the normals face inward,
      // which makes every surface a backface: rays pass straight through and
      // contacts resolve the wrong way.
      const faces = [
        [1, 2, 3, 0],   // bottom
        [5, 2, 1, 4],   // the incline itself
        [3, 5, 4, 0],   // tall back face
        [4, 1, 0],      // -Z side
        [2, 5, 3],      // +Z side
      ];
      const qYaw = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
      bodies.push(physics.addStaticConvex(
        verts, faces,
        new CANNON.Vec3(pos.x, pos.y, pos.z),
        qYaw
      ));
    }

    const obj = {
      type,
      dims: { ...d },
      yaw,
      pos: pos.clone(),
      group: objGroup,
      bodies,
      inv: type === 'spawn' ? null : objGroup.matrixWorld.clone().invert(),
    };
    objGroup.userData.owner = obj;
    objects.push(obj);
    return obj;
  }

  function place() {
    if (tool === 'decal') {
      if (!decalGhost.visible || !lastDecalHit) return;
      makeDecalRecord(decal, lastDecalHit.mesh, lastDecalHit.owner, lastDecalHit.pos, lastDecalHit.quat);
      return;
    }
    if (!ghost.visible) return;
    // the practice targets are live tanks, not scenery: hand them off
    if (tool === 'enemy' || tool === 'ally') {
      if (onPlaceTarget) onPlaceTarget(tool === 'ally', ghost.position.clone(), ghost.rotation.y);
      return;
    }
    placeAt(tool, { ...dims[tool] }, ghost.position.clone(), ghost.rotation.y);
  }

  // ---- delete --------------------------------------------------------------
  function removeDecal(rec) {
    const i = decals.indexOf(rec);
    if (i === -1) return;
    group.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    rec.mesh.material.dispose();
    decals.splice(i, 1);
    if (pointedDecal === rec) pointedDecal = null;
  }

  function removeObject(obj) {
    const i = objects.indexOf(obj);
    if (i === -1) return;
    for (const b of obj.bodies) physics.removeBody(b);
    group.remove(obj.group);
    for (const c of obj.group.children) c.geometry.dispose();
    objects.splice(i, 1);
    for (const rec of decals.filter((d) => d.owner === obj)) removeDecal(rec);
    if (pointedAt === obj) pointedAt = null;
  }

  function deleteAtCursor() {
    if (pointedDecal) removeDecal(pointedDecal);
    else if (pointedAt) removeObject(pointedAt);
  }

  function clearAll() {
    for (const rec of [...decals]) removeDecal(rec);
    for (const o of [...objects]) removeObject(o);
  }

  // ---- exact solid test (bullets + aim ray) --------------------------------
  const _lp = new THREE.Vector3();
  // Height of the highest placed surface over a world column, or null if the
  // column is over bare ground. The tread-mark system uses this to decide
  // whether a mark would be resting on something or floating in the air.
  const _sp = new THREE.Vector3();
  function surfaceAt(x, z) {
    let top = null;
    for (const o of objects) {
      if (o.type === 'spawn') continue;
      _sp.set(x, o.pos.y, z).applyMatrix4(o.inv);
      const d = o.dims;
      if (Math.abs(_sp.z) > d.W / 2 || Math.abs(_sp.x) > d.L / 2) continue;
      let h;
      if (o.type === 'slope') {
        // the incline falls from the tall face to the toe
        h = o.pos.y + slopeHeight(d) * ((d.L / 2 - _sp.x) / d.L);
      } else {
        h = o.pos.y + d.H;
      }
      if (top === null || h > top) top = h;
    }
    return top;
  }

  function solidAt(p) {
    for (const o of objects) {
      if (o.type === 'spawn') continue;
      _lp.copy(p).applyMatrix4(o.inv);
      const d = o.dims;
      if (Math.abs(_lp.z) > d.W / 2 || _lp.y < 0) continue;
      if (o.type === 'slope') {
        const H = slopeHeight(d);
        if (
          _lp.x >= -d.L / 2 && _lp.x <= d.L / 2 &&
          _lp.y <= H * ((d.L / 2 - _lp.x) / d.L)
        ) return true;
      } else if (Math.abs(_lp.x) <= d.L / 2 && _lp.y <= d.H) {
        return true;
      }
    }
    return false;
  }

  // ---- spawns --------------------------------------------------------------
  function getSpawns() {
    return objects
      .filter((o) => o.type === 'spawn')
      .map((o) => ({ x: o.pos.x, y: o.pos.y, z: o.pos.z, heading: o.yaw }));
  }

  // ---- map (de)serialization ----------------------------------------------
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function serialize() {
    return {
      format: MAP_FORMAT,
      version: 2,
      objects: objects.map((o) => {
        const e = { type: o.type, x: r3(o.pos.x), y: r3(o.pos.y), z: r3(o.pos.z), yaw: r3(o.yaw) };
        if (o.type === 'slope') {
          e.L = o.dims.L; e.W = o.dims.W; e.angle = r3(o.dims.angle);
        } else if (o.type !== 'spawn') {
          e.L = o.dims.L; e.H = o.dims.H; e.W = o.dims.W;
        }
        return e;
      }),
      decals: decals.map((d) => {
        const e = {
          shape: d.shape, color: d.color, spin: r3(d.spin),
          parent: objects.indexOf(d.owner),
          x: r3(d.pos.x), y: r3(d.pos.y), z: r3(d.pos.z),
          qx: r3(d.quat.x), qy: r3(d.quat.y), qz: r3(d.quat.z), qw: r3(d.quat.w),
        };
        if (d.shape === 'circle') e.r = d.dims.r;
        else if (d.shape === 'triangle') e.s = d.dims.s;
        else { e.w = d.dims.w; e.h = d.dims.h; }
        return e;
      }),
    };
  }

  function loadData(data) {
    if (!data || data.format !== MAP_FORMAT || !Array.isArray(data.objects)) {
      throw new Error('not a map');
    }
    clearAll();
    let count = 0;
    const placed = [];
    for (const e of data.objects) {
      if (!e || !dims[e.type] || e.type === 'decal' || ![e.x, e.y, e.z].every(Number.isFinite)) {
        placed.push(null);
        continue;
      }
      const yaw = Number.isFinite(e.yaw) ? e.yaw : 0;
      let d = {};
      if (e.type === 'slope') {
        d = {
          L: clamp(Number(e.L) || 8, LIMITS.L[0], LIMITS.L[1]),
          W: clamp(Number(e.W) || 6, LIMITS.W[0], LIMITS.W[1]),
          angle: clamp(Number(e.angle) || LIMITS.angle[0], LIMITS.angle[0], LIMITS.angle[1]),
        };
      } else if (e.type !== 'spawn') {
        d = {
          L: clamp(Number(e.L) || 8, LIMITS.L[0], LIMITS.L[1]),
          H: clamp(Number(e.H) || 2, LIMITS.H[0], LIMITS.H[1]),
          W: clamp(Number(e.W) || 8, LIMITS.W[0], LIMITS.W[1]),
        };
      }
      placed.push(placeAt(e.type, d, new THREE.Vector3(e.x, Math.max(0, e.y), e.z), yaw));
      count++;
    }

    for (const e of (Array.isArray(data.decals) ? data.decals : [])) {
      if (!e || !['rect', 'circle', 'triangle'].includes(e.shape)) continue;
      if (![e.x, e.y, e.z, e.qx, e.qy, e.qz, e.qw].every(Number.isFinite)) continue;
      const dc = {
        shape: e.shape,
        color: typeof e.color === 'string' ? e.color : '#e8563a',
        spin: Number(e.spin) || 0,
        w: clamp(Number(e.w) || 2, DLIM.w[0], DLIM.w[1]),
        h: clamp(Number(e.h) || 2, DLIM.h[0], DLIM.h[1]),
        r: clamp(Number(e.r) || 1, DLIM.r[0], DLIM.r[1]),
        s: clamp(Number(e.s) || 2, DLIM.s[0], DLIM.s[1]),
      };
      const owner = Number.isInteger(e.parent) && e.parent >= 0 ? placed[e.parent] || null : null;
      const targetMesh = owner ? owner.group.children[0] : ground;
      const made = makeDecalRecord(
        dc,
        targetMesh,
        owner,
        new THREE.Vector3(e.x, e.y, e.z),
        new THREE.Quaternion(e.qx, e.qy, e.qz, e.qw).normalize()
      );
      if (made) count++;
    }
    return count;
  }

  // ---- enter / exit --------------------------------------------------------
  let active = false;
  function enter() {
    if (active) return;
    active = true;
    group.visible = true;
    for (const o of objects) for (const b of o.bodies) physics.addBody(b);
  }

  function exit() {
    if (!active) return;
    active = false;
    group.visible = false;
    hideGhost();
    for (const o of objects) for (const b of o.bodies) physics.removeBody(b);
  }

  return {
    enter, exit,
    setTool, rotateGhost, adjust, setDecalShape, setDecalColor,
    setDecalSurface, setDecalMetalness, decalBrush,
    // where the placement ghost is sitting, so other systems can drop things
    // at the spot the player is actually aiming at
    ghostPoint: () => (ghost.visible ? ghost.position.clone() : null),
    ghostYaw: () => ghost.rotation.y,
    updateGhost, hideGhost, place, deleteAtCursor, clearAll,
    solidAt, surfaceAt,
    pickRoot: () => group, getSpawns, serialize, loadData,
    getTool: () => tool,
    boundsHalf: GROUND_HALF - 1,
  };
}
