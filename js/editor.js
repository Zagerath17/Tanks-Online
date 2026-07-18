import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { makeGridTexture } from './grid-texture.js';

// Editor sandbox: a flat ground and four placeable pieces — walls, platforms,
// slopes, and tank spawn points. Solid pieces get static physics and an exact
// point-in-solid test; spawns are markers the game (re)spawns tanks on.
// serialize()/loadData() speak the map file format.
const GROUND_HALF = 120;
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
};

const clamp = THREE.MathUtils.clamp;

function slopeHeight(d) {
  return Math.tan(d.angle) * d.L;
}

export function createEditor({ scene, physics }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // ---- flat build ground ---------------------------------------------------
  const groundTex = makeGridTexture({
    cells: 8,
    base: '#98a0a8',
    line: '#87909a',
    lineWidth: 2,
    major: 8,
    majorLine: '#747e88',
    majorWidth: 6,
    repeat: [GROUND_HALF / 2, GROUND_HALF / 2],
    anisotropy: 16,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- tool state ----------------------------------------------------------
  let tool = 'wall';
  const dims = {
    wall: { L: 8, H: 3, W: 1 },
    platform: { L: 8, H: 2, W: 8 },
    slope: { L: 8, W: 6, angle: (20 * Math.PI) / 180 },
    spawn: {},
    decal: {},
  };
  let ghostYaw = 0;

  // decal brush: shape + dimensions + colour, set from the toolbar
  const decal = { shape: 'rect', w: 2.5, h: 2.5, r: 1.4, s: 2, spin: 0, color: '#e8563a' };
  const DLIM = { w: [0.4, 24], h: [0.4, 24], r: [0.3, 14], s: [0.5, 16] };
  const DSTEP = { w: 0.4, h: 0.4, r: 0.25, s: 0.4 };

  const objects = []; // solids + spawns: { type, dims, yaw, pos, group, bodies, inv }
  const decals = [];  // { shape, dims, spin, color, mesh, owner, pos, quat }
  let pointedAt = null;     // solid/spawn under the crosshair
  let pointedDecal = null;  // decal under the crosshair (closer than any solid)

  // ---- part builders (origin at the base center) ---------------------------
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

  function buildDecalGeometry(dc) {
    if (dc.shape === 'circle') return new THREE.CircleGeometry(dc.r, 48);
    if (dc.shape === 'triangle') {
      const s = new THREE.Shape();
      const a = dc.s;
      s.moveTo(0, a);
      s.lineTo(-a * 0.866, -a * 0.5);
      s.lineTo(a * 0.866, -a * 0.5);
      s.closePath();
      return new THREE.ShapeGeometry(s);
    }
    return new THREE.PlaneGeometry(dc.w, dc.h);
  }

  function buildGeometries(type, d) {
    if (type === 'spawn') {
      const disc = new THREE.CylinderGeometry(2.1, 2.1, 0.08, 32);
      disc.translate(0, 0.04, 0);
      return [disc, spawnArrowGeometry()];
    }
    if (type === 'slope') {
      const H = slopeHeight(d);
      const s = new THREE.Shape();
      s.moveTo(-d.L / 2, 0);
      s.lineTo(d.L / 2, 0);
      s.lineTo(-d.L / 2, H); // vertical face at -L/2, incline down to +L/2
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: d.W, bevelEnabled: false });
      geo.translate(0, 0, -d.W / 2);
      return [geo];
    }
    const geo = new THREE.BoxGeometry(d.L, d.H, d.W);
    geo.translate(0, d.H / 2, 0);
    return [geo];
  }

  function buildMaterials(type, d) {
    if (type === 'spawn') {
      return [
        new THREE.MeshStandardMaterial({
          color: '#9cc36e', transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.8,
        }),
        new THREE.MeshStandardMaterial({ color: '#c8d9ae', roughness: 0.7 }),
      ];
    }
    const H = type === 'slope' ? slopeHeight(d) : d.H;
    const tex = makeGridTexture({
      cells: 6,
      base: COLORS[type][0],
      line: COLORS[type][1],
      lineWidth: 3,
      repeat: [Math.max(1, d.L / 3), Math.max(1, Math.max(H, d.W) / 3)],
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
    return buildGeometries(type, d).map(() => mat);
  }

  // ---- ghost ---------------------------------------------------------------
  const ghostMat = new THREE.MeshStandardMaterial({
    color: '#9cc36e',
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const ghost = new THREE.Group();
  ghost.visible = false;
  group.add(ghost);

  const decalGhostMat = new THREE.MeshBasicMaterial({
    color: '#e8563a', transparent: true, opacity: 0.6,
    side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  function rebuildGhost() {
    for (const c of [...ghost.children]) {
      ghost.remove(c);
      c.geometry.dispose();
    }
    if (tool === 'decal') {
      decalGhostMat.color.set(decal.color);
      ghost.add(new THREE.Mesh(buildDecalGeometry(decal), decalGhostMat));
      return;
    }
    for (const geo of buildGeometries(tool, dims[tool])) {
      ghost.add(new THREE.Mesh(geo, ghostMat));
    }
  }
  rebuildGhost();

  function setTool(t) {
    if (!dims[t] || t === tool) return;
    tool = t;
    rebuildGhost();
  }

  function rotateGhost() {
    if (tool === 'decal') decal.spin += Math.PI / 12;
    else ghostYaw += Math.PI / 12;
  }

  function setDecalShape(shape) {
    if (!['rect', 'circle', 'triangle'].includes(shape) || shape === decal.shape) return;
    decal.shape = shape;
    if (tool === 'decal') rebuildGhost();
  }

  function setDecalColor(hex) {
    decal.color = hex;
    if (tool === 'decal') { decalGhostMat.color.set(hex); }
  }

  // axis: 'l' | 'w' | 'h' — length / width / height, remapped per tool
  function adjust(axis, dir) {
    if (tool === 'spawn') return;
    if (tool === 'decal') {
      if (decal.shape === 'circle') decal.r = clamp(decal.r + dir * DSTEP.r, DLIM.r[0], DLIM.r[1]);
      else if (decal.shape === 'triangle') decal.s = clamp(decal.s + dir * DSTEP.s, DLIM.s[0], DLIM.s[1]);
      else if (axis === 'w') decal.h = clamp(decal.h + dir * DSTEP.h, DLIM.h[0], DLIM.h[1]);
      else decal.w = clamp(decal.w + dir * DSTEP.w, DLIM.w[0], DLIM.w[1]);
      rebuildGhost();
      return;
    }
    const d = dims[tool];
    if (axis === 'l') d.L = clamp(d.L + dir * STEP.L, LIMITS.L[0], LIMITS.L[1]);
    else if (axis === 'w') d.W = clamp(d.W + dir * STEP.W, LIMITS.W[0], LIMITS.W[1]);
    else if (tool === 'slope') d.angle = clamp(d.angle + dir * STEP.angle, LIMITS.angle[0], LIMITS.angle[1]);
    else d.H = clamp(d.H + dir * STEP.H, LIMITS.H[0], LIMITS.H[1]);
    rebuildGhost();
  }

  // ---- placement raycast ---------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const _center = new THREE.Vector2(0, 0);

  function ownerOf(node) {
    while (node) {
      if (node.userData && node.userData.owner) return node.userData.owner;
      node = node.parent;
    }
    return null;
  }

  const _n = new THREE.Vector3();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _projQuat = new THREE.Quaternion();
  const _spinQuat = new THREE.Quaternion();

  function updateGhost(camera) {
    raycaster.setFromCamera(_center, camera);
    const surfaces = [ground, ...objects.filter((o) => o.type !== 'spawn').map((o) => o.group)];
    const hits = raycaster.intersectObjects(surfaces, true);

    // track the decal under the crosshair (for deletion), nearest wins
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
      return;
    }
    const hit = hits[0];
    if (hit.object !== ground) pointedAt = ownerOf(hit.object);

    if (tool === 'decal') {
      // lay the decal flat on the surface it's pointed at, facing its normal
      _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      _projQuat.setFromUnitVectors(_zAxis, _n);
      _spinQuat.setFromAxisAngle(_zAxis, decal.spin);
      ghost.quaternion.copy(_projQuat).multiply(_spinQuat);
      ghost.position.copy(hit.point).addScaledVector(_n, 0.03);
      ghost.visible = true;
      return;
    }

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
    pointedAt = null;
  }

  // ---- place ---------------------------------------------------------------
  function placeAt(type, d, pos, yaw) {
    const objGroup = new THREE.Group();
    const geos = buildGeometries(type, d);
    const mats = buildMaterials(type, d);
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

    const bodies = [];
    if (type === 'wall' || type === 'platform') {
      const qYaw = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
      bodies.push(physics.addStaticBox(
        d.L / 2, d.H / 2, d.W / 2,
        new CANNON.Vec3(pos.x, pos.y + d.H / 2, pos.z),
        qYaw
      ));
    } else if (type === 'slope') {
      const H = slopeHeight(d);
      const theta = d.angle;
      const hyp = Math.hypot(d.L, H);
      const halfLen = hyp / 2 + 0.2;
      const halfT = 0.35;
      const cx = -Math.sin(theta) * halfT;
      const cy = H / 2 - Math.cos(theta) * halfT;
      const qYaw = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
      const qTilt = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -theta);
      bodies.push(physics.addStaticBox(
        halfLen, halfT, d.W / 2,
        new CANNON.Vec3(pos.x + Math.cos(yaw) * cx, pos.y + cy, pos.z - Math.sin(yaw) * cx),
        qYaw.mult(qTilt)
      ));
      const bx = -d.L / 2 + 0.3;
      bodies.push(physics.addStaticBox(
        0.3, H / 2, d.W / 2,
        new CANNON.Vec3(pos.x + Math.cos(yaw) * bx, pos.y + H / 2, pos.z - Math.sin(yaw) * bx),
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

  function placeDecal(dc, pos, quat, owner) {
    const mat = new THREE.MeshBasicMaterial({
      color: dc.color, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(buildDecalGeometry(dc), mat);
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.renderOrder = 2;
    group.add(mesh);
    const rec = { shape: dc.shape, dims: { w: dc.w, h: dc.h, r: dc.r, s: dc.s }, spin: dc.spin, color: dc.color, mesh, owner, pos: pos.clone(), quat: quat.clone() };
    mesh.userData.decal = rec;
    decals.push(rec);
    return rec;
  }

  function place() {
    if (!ghost.visible) return;
    if (tool === 'decal') {
      placeDecal(decal, ghost.position.clone(), ghost.quaternion.clone(), pointedAt);
      return;
    }
    placeAt(tool, { ...dims[tool] }, ghost.position.clone(), ghost.rotation.y);
  }

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
    // decals stuck to this piece go with it
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

  // Rebuild the board from map data. Throws on anything that isn't a map.
  function loadData(data) {
    if (!data || data.format !== MAP_FORMAT || !Array.isArray(data.objects)) {
      throw new Error('not a map');
    }
    clearAll();
    let count = 0;
    const placed = []; // parallel to data.objects, for decal parent lookup
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
        w: clamp(Number(e.w) || 2.5, DLIM.w[0], DLIM.w[1]),
        h: clamp(Number(e.h) || 2.5, DLIM.h[0], DLIM.h[1]),
        r: clamp(Number(e.r) || 1.4, DLIM.r[0], DLIM.r[1]),
        s: clamp(Number(e.s) || 2, DLIM.s[0], DLIM.s[1]),
      };
      const owner = Number.isInteger(e.parent) && e.parent >= 0 ? placed[e.parent] || null : null;
      placeDecal(
        dc,
        new THREE.Vector3(e.x, e.y, e.z),
        new THREE.Quaternion(e.qx, e.qy, e.qz, e.qw).normalize(),
        owner
      );
      count++;
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
    updateGhost, hideGhost, place, deleteAtCursor, clearAll,
    solidAt, getSpawns, serialize, loadData,
    getTool: () => tool,
    boundsHalf: GROUND_HALF - 1,
  };
}
