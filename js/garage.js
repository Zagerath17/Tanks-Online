import * as THREE from 'three';
import { createTankModel } from './tank.js';
import { TURRET_SPECS } from './tank.js';
import { createProngArc } from './arc.js';
import { currentSkin, currentTurret, currentHull } from './loadout.js';

// The garage: your tank on a workshop platform at the back of a bay whose
// roller door stands open, an orbiting camera you drag with the mouse, and a
// gun that fires for real — muzzle flash, smoke, sound, a live shell, and a
// hull that rocks on its suspension. The tank itself never leaves the deck:
// every recoil motion is a spring that returns to zero.
const STAND = { y: 1.3, halfX: 6.5, halfZ: 5.5 };
const RAMP = { len: 4.2, halfW: 2.6 }; // off the back of the deck to the floor
const DOOR = { w: 9, h: 6.4 };
// the tank sits nose-on to the door, which is in the +Z wall
const FACING = -Math.PI / 2;
const FIRE_INTERVAL = 2.5;
const CAM = { dist: 12.5, height: 4.6, look: 1.9 };

export function createGarage({ scene, fx, audio, bullets, railBeam }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // ---- the bay -------------------------------------------------------------
  const BAY = { w: 30, d: 34, h: 11 };

  const concrete = new THREE.MeshStandardMaterial({ color: '#33383f', roughness: 0.96 });
  const painted = new THREE.MeshStandardMaterial({ color: '#3d444c', roughness: 0.85, metalness: 0.1 });
  const steel = new THREE.MeshStandardMaterial({ color: '#4a5159', roughness: 0.5, metalness: 0.75 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#23272c', roughness: 0.6, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1d2024', roughness: 0.9 });
  const hazard = new THREE.MeshStandardMaterial({ color: '#b9962c', roughness: 0.8 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(BAY.w, BAY.d), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // walls — the +Z wall is built in three pieces around the door opening
  const wallGeoLong = new THREE.BoxGeometry(BAY.w, BAY.h, 0.4);
  const wallGeoSide = new THREE.BoxGeometry(0.4, BAY.h, BAY.d);
  for (const [geo, x, y, z] of [
    [wallGeoLong, 0, BAY.h / 2, -BAY.d / 2],
    [wallGeoSide, -BAY.w / 2, BAY.h / 2, 0],
    [wallGeoSide, BAY.w / 2, BAY.h / 2, 0],
  ]) {
    const wall = new THREE.Mesh(geo, painted);
    wall.position.set(x, y, z);
    wall.receiveShadow = true;
    group.add(wall);
  }

  // ---- the door end -------------------------------------------------------
  {
    const z = BAY.d / 2;
    const jambW = (BAY.w - DOOR.w) / 2;
    const lintelH = BAY.h - DOOR.h;
    const jambGeo = new THREE.BoxGeometry(jambW, BAY.h, 0.4);
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(jambGeo, painted);
      jamb.position.set(s * (DOOR.w / 2 + jambW / 2), BAY.h / 2, z);
      jamb.receiveShadow = true;
      group.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w, lintelH, 0.4), painted);
    lintel.position.set(0, DOOR.h + lintelH / 2, z);
    lintel.receiveShadow = true;
    group.add(lintel);

    // the shutter is up: its curtain is coiled on a drum under the lintel,
    // with the bottom rail hanging just clear of the opening
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, DOOR.w + 0.3, 18), darkSteel);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, DOOR.h + 0.72, z - 0.55);
    group.add(drum);
    for (let i = 0; i < 5; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.62 - i * 0.055, 0.035, 6, 24), steel
      );
      coil.rotation.y = Math.PI / 2;
      coil.position.set(-DOOR.w / 2 + 0.5 + i * (DOOR.w - 1) / 4, DOOR.h + 0.72, z - 0.55);
      group.add(coil);
    }
    const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w + 0.2, 0.22, 0.3), steel);
    bottomRail.position.set(0, DOOR.h + 0.06, z - 0.55);
    group.add(bottomRail);
    // guide channels either side of the opening
    for (const s of [-1, 1]) {
      const guide = new THREE.Mesh(new THREE.BoxGeometry(0.22, DOOR.h + 0.8, 0.34), steel);
      guide.position.set(s * (DOOR.w / 2 + 0.11), (DOOR.h + 0.8) / 2, z - 0.55);
      group.add(guide);
    }
    // worn threshold plate across the opening
    const sill = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w, 0.04, 1.1), steel);
    sill.position.set(0, 0.02, z - 0.5);
    group.add(sill);
  }

  // ceiling with exposed beams
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(BAY.w, BAY.d), painted);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = BAY.h;
  group.add(ceiling);
  for (let i = -2; i <= 2; i++) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(BAY.w, 0.5, 0.42), darkSteel);
    beam.position.set(0, BAY.h - 0.4, i * 6);
    group.add(beam);
  }

  // overhead gantry crane on rails, hook hanging over the tank
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, BAY.d - 1), steel);
  railL.position.set(-7.5, BAY.h - 1.1, 0);
  const railR = railL.clone();
  railR.position.x = 7.5;
  group.add(railL, railR);

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.55, 0.9), steel);
  bridge.position.set(0, BAY.h - 1.6, -1.5);
  group.add(bridge);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.3), darkSteel);
  trolley.position.set(1.2, BAY.h - 2.2, -1.5);
  group.add(trolley);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 6), darkSteel);
  cable.position.set(1.2, BAY.h - 4.3, -1.5);
  group.add(cable);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 14), steel);
  hook.position.set(1.2, BAY.h - 6.2, -1.5);
  group.add(hook);

  // strip lights under the beams
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fff6e2', emissive: '#ffeccb', emissiveIntensity: 1.5, roughness: 0.4,
  });
  for (const z of [-9, -3, 3, 9]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(9, 0.16, 0.5), lampMat);
    lamp.position.set(0, BAY.h - 0.75, z);
    group.add(lamp);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.3, 0.8), darkSteel);
    housing.position.set(0, BAY.h - 0.6, z);
    group.add(housing);
  }

  // --- workbenches, racks and clutter round the walls ----------------------
  function bench(x, z, ry, len) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 1.1), steel);
    top.position.y = 0.95;
    top.castShadow = true;
    g.add(top);
    for (const sx of [-len / 2 + 0.3, len / 2 - 0.3]) {
      for (const sz of [-0.42, 0.42]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), darkSteel);
        leg.position.set(sx, 0.47, sz);
        g.add(leg);
      }
    }
    // pegboard behind it with hanging tools
    const board = new THREE.Mesh(new THREE.BoxGeometry(len, 1.5, 0.08), painted);
    board.position.set(0, 1.85, -0.5);
    g.add(board);
    for (let i = 0; i < Math.floor(len); i++) {
      const tool = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.3 + Math.random() * 0.4, 0.06), darkSteel
      );
      tool.position.set(-len / 2 + 0.6 + i * 0.9, 1.75 + Math.random() * 0.3, -0.44);
      g.add(tool);
    }
    // a couple of boxes on the top
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.3 + Math.random() * 0.3, 0.22, 0.28), hazard
      );
      box.position.set(-len / 2 + 1 + Math.random() * (len - 2), 1.12, Math.random() * 0.4 - 0.2);
      box.rotation.y = Math.random();
      g.add(box);
    }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    return g;
  }

  group.add(bench(-11, -6, Math.PI / 2, 7));
  group.add(bench(-11, 6, Math.PI / 2, 6));
  group.add(bench(11, 2, -Math.PI / 2, 8));

  // parts racks
  function rack(x, z, ry) {
    const g = new THREE.Group();
    for (let s = 0; s < 4; s++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.09, 1.0), steel);
      shelf.position.y = 0.5 + s * 0.85;
      g.add(shelf);
      for (let i = 0; i < 3; i++) {
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(0.7 + Math.random() * 0.3, 0.45, 0.7),
          Math.random() < 0.4 ? hazard : darkSteel
        );
        crate.position.set(-1.2 + i * 1.1, 0.78 + s * 0.85, 0);
        crate.rotation.y = (Math.random() - 0.5) * 0.3;
        g.add(crate);
      }
    }
    for (const sx of [-1.7, 1.7]) {
      for (const sz of [-0.45, 0.45]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.6, 0.1), darkSteel);
        post.position.set(sx, 1.8, sz);
        g.add(post);
      }
    }
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    return g;
  }

  group.add(rack(-6, -15.5, 0));
  group.add(rack(6, -15.5, 0));
  group.add(rack(12, -9, -Math.PI / 2));

  // oil drums and spare track links
  for (const [x, z] of [[-13, 12], [-12.1, 13], [-13.2, 13.9], [12.6, 12.4], [13.4, 11.2]]) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 16), hazard);
    drum.position.set(x, 0.55, z);
    drum.castShadow = true;
    group.add(drum);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.07, 16), darkSteel);
    lid.position.set(x, 1.12, z);
    group.add(lid);
  }

  for (let i = 0; i < 7; i++) {
    const link = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.66), rubber);
    link.position.set(-9 + Math.random() * 1.2, 0.06 + i * 0.115, 11 + Math.random() * 0.6);
    link.rotation.y = (Math.random() - 0.5) * 0.4;
    group.add(link);
  }

  // a spare turret barrel on a trestle
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 4.4, 12), darkSteel);
  spare.rotation.z = Math.PI / 2;
  spare.position.set(9.5, 1.15, 7);
  spare.rotation.y = 0.3;
  group.add(spare);
  for (const dx of [-1.5, 1.5]) {
    const trestle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, 0.9), steel);
    trestle.position.set(9.5 + dx * Math.cos(0.3), 0.52, 7 - dx * Math.sin(0.3));
    group.add(trestle);
  }

  // toolbox trolleys either side of the stand
  for (const [x, z, ry] of [[-8.6, 6.5, 0.4], [8.8, 6.2, -0.5]]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.8), hazard);
    box.position.set(x, 0.68, z);
    box.rotation.y = ry;
    box.castShadow = true;
    group.add(box);
    for (let d = 0; d < 3; d++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.06), darkSteel);
      drawer.position.set(x, 0.35 + d * 0.32, z + 0.42 * Math.cos(ry));
      drawer.rotation.y = ry;
      group.add(drawer);
    }
  }

  // ---- the workshop platform ----------------------------------------------
  // A welded steel service deck rather than a display plinth: plated top,
  // channel-section edge beams, legs, hazard-striped nosing, and a ramp off
  // the back the tank could actually have driven up.
  const deckMat = new THREE.MeshStandardMaterial({
    color: '#59616b', roughness: 0.62, metalness: 0.55,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    color: '#3b424b', roughness: 0.9, metalness: 0.12,
  });

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(STAND.halfX * 2, 0.22, STAND.halfZ * 2), deckMat
  );
  deck.position.y = STAND.y - 0.11;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // the mass under the deck, inset so the top plate reads as an overhang
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(STAND.halfX * 2 - 0.5, STAND.y - 0.22, STAND.halfZ * 2 - 0.5),
    plinthMat
  );
  plinth.position.y = (STAND.y - 0.22) / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // edge beams round the deck, with hazard nosing on the two long sides
  for (const s of [-1, 1]) {
    const beamX = new THREE.Mesh(
      new THREE.BoxGeometry(STAND.halfX * 2 + 0.12, 0.3, 0.16), steel
    );
    beamX.position.set(0, STAND.y - 0.16, s * STAND.halfZ);
    group.add(beamX);
    const beamZ = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.3, STAND.halfZ * 2 + 0.12), steel
    );
    beamZ.position.set(s * STAND.halfX, STAND.y - 0.16, 0);
    group.add(beamZ);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.05, STAND.halfZ * 2), hazard
    );
    nose.position.set(s * (STAND.halfX - 0.2), STAND.y + 0.005, 0);
    group.add(nose);
  }

  // legs at the corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, STAND.y, 0.3), darkSteel
      );
      leg.position.set(sx * (STAND.halfX - 0.35), STAND.y / 2, sz * (STAND.halfZ - 0.35));
      group.add(leg);
    }
  }

  // service pit lighting under the deck lip, and a cable run along the floor
  const underGlow = new THREE.Mesh(
    new THREE.BoxGeometry(STAND.halfX * 2 - 1.2, 0.05, 0.1),
    new THREE.MeshStandardMaterial({
      color: '#cfe6ff', emissive: '#6ea8dc', emissiveIntensity: 0.8, roughness: 0.5,
    })
  );
  underGlow.position.set(0, STAND.y - 0.34, STAND.halfZ - 0.02);
  group.add(underGlow);

  // ---- ramps off both ends of the deck ------------------------------------
  // dir -1 runs out of the back of the bay, dir +1 runs out toward the door,
  // so the tank can drive straight in off the apron, up onto the deck, and
  // out the other side.
  function buildRamp(dir) {
    const g = new THREE.Group();
    g.name = dir < 0 ? 'ramp-rear' : 'ramp-door';
    group.add(g);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(RAMP.len, 0);
    shape.lineTo(0, STAND.y);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: RAMP.halfW * 2, bevelEnabled: false });
    // the profile is drawn with +X running down the slope; turn it so the
    // slope runs out of the chosen end of the deck
    geo.rotateY(dir < 0 ? Math.PI / 2 : -Math.PI / 2);
    geo.translate(dir < 0 ? -RAMP.halfW : RAMP.halfW, 0, 0);
    const ramp = new THREE.Mesh(geo, plinthMat);
    ramp.position.set(0, 0, dir * STAND.halfZ);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    g.add(ramp);

    // tread strips up the slope, and hazard edging down each side
    const rise = Math.atan2(STAND.y, RAMP.len);
    for (let i = 0; i < 7; i++) {
      const f = (i + 0.5) / 7;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(RAMP.halfW * 2 - 0.3, 0.035, 0.16), steel);
      strip.position.set(0, STAND.y * (1 - f) + 0.03, dir * (STAND.halfZ + RAMP.len * f));
      strip.rotation.x = dir * rise;
      g.add(strip);
    }
    for (const s of [-1, 1]) {
      const kerb = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, Math.hypot(RAMP.len, STAND.y)), hazard
      );
      kerb.position.set(
        s * (RAMP.halfW - 0.08), STAND.y / 2 + 0.05, dir * (STAND.halfZ + RAMP.len / 2)
      );
      kerb.rotation.x = dir * rise;
      g.add(kerb);
    }
  }

  buildRamp(-1);
  buildRamp(1);

  // hazard stripe painted on the floor around the working area
  {
    const paint = new THREE.MeshBasicMaterial({
      color: '#b9962c', transparent: true, opacity: 0.5,
    });
    const outX = STAND.halfX + 1.9;
    const outZ = STAND.halfZ + 2.4;
    for (const s of [-1, 1]) {
      const long = new THREE.Mesh(new THREE.PlaneGeometry(outX * 2, 0.28), paint);
      long.rotation.x = -Math.PI / 2;
      long.position.set(0, 0.012, s * outZ);
      group.add(long);
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.28, outZ * 2), paint);
      side.rotation.x = -Math.PI / 2;
      side.position.set(s * outX, 0.012, 0);
      group.add(side);
    }
  }

  // work light straight down onto the stand, plus soft fill from the strips
  const key = new THREE.SpotLight('#fff4e0', 320, 40, Math.PI / 5, 0.5, 1.4);
  key.position.set(3.5, 9.5, 4);
  key.target.position.set(0, STAND.y + 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  group.add(key, key.target);

  for (const z of [-9, -3, 3, 9]) {
    const strip = new THREE.PointLight('#ffeccb', 26, 22, 2);
    strip.position.set(0, BAY.h - 1.2, z);
    group.add(strip);
  }

  const fill = new THREE.PointLight('#8fb8e8', 22, 30, 2);
  fill.position.set(-9, 5, -8);
  group.add(fill);

  const bounce = new THREE.HemisphereLight('#8f9aa8', '#2a2f35', 0.55);
  group.add(bounce);

  // ---- daylight through the open door -------------------------------------
  // A soft blob that fades to nothing on EVERY edge. The previous shafts used
  // a gradient that only faded along their length, so their long sides ended
  // as hard straight cuts — and where those flat cards passed through a wall
  // or the floor they left a crisp diagonal seam across it. That is what made
  // them read as grey cardboard rather than as light.
  function makeSoftBlob() {
    const s = 128;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const shafts = [];
  const sunDir = new THREE.Vector3();

  {
    const z = BAY.d / 2;

    // blown-out daylight filling the opening
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(DOOR.w + 0.6, DOOR.h + 0.4),
      new THREE.MeshBasicMaterial({ color: '#fff4dc' })
    );
    sky.position.set(0, DOOR.h / 2, z + 0.3);
    sky.rotation.y = Math.PI;
    group.add(sky);

    // the sun itself: low and outside, angled in across the deck so the tank
    // is rim-lit from the front and throws its shadow back into the bay
    const sun = new THREE.DirectionalLight('#ffe6bd', 2.6);
    sun.position.set(3.5, 7.5, z + 16);
    sun.target.position.set(-1.5, 0.6, -3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -6;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0012;
    group.add(sun, sun.target);
    sunDir.subVectors(sun.target.position, sun.position).normalize();

    // warm fill just inside the threshold, so the doorway wall glows
    const doorFill = new THREE.PointLight('#ffdfb0', 34, 26, 2);
    doorFill.position.set(0, 3.2, z - 2.2);
    group.add(doorFill);

    // The shafts: soft streaks of lit air lying along the sun's own axis.
    // Each one is spun about that axis every frame to face the camera, so it
    // never flattens out or shows a silhouette — and because the sprite fades
    // to zero all round, where it does pass through the floor there is no
    // edge to see.
    const blob = makeSoftBlob();
    const shaftMat = new THREE.MeshBasicMaterial({
      map: blob, color: '#ffe0ac', transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = -1; i <= 1; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 13), shaftMat);
      // spaced across the opening and pushed back along the sun's direction
      mesh.position.set(i * 2.9, DOOR.h / 2, z).addScaledVector(sunDir, 6.5);
      mesh.renderOrder = 2;
      group.add(mesh);
      shafts.push(mesh);
    }

    // the pool of light it lays on the concrete, soft on every edge for the
    // same reason
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(DOOR.w + 4, 17),
      new THREE.MeshBasicMaterial({
        map: blob, color: '#ffe9c6', transparent: true, opacity: 0.26,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0.6, 0.02, z - 8.5);
    group.add(pool);
  }

  // Cylindrical billboard: keep each shaft's length on the sun axis while
  // rolling it about that axis to present its face to the camera.
  const _sx = new THREE.Vector3();
  const _sz = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  const _basis = new THREE.Matrix4();

  function aimShafts(camera) {
    for (const s of shafts) {
      _toCam.copy(camera.position).sub(s.position);
      _sx.crossVectors(sunDir, _toCam);
      if (_sx.lengthSq() < 1e-6) continue; // camera on the axis: leave it be
      _sx.normalize();
      _sz.crossVectors(_sx, sunDir).normalize();
      _basis.makeBasis(_sx, sunDir, _sz);
      s.quaternion.setFromRotationMatrix(_basis);
    }
  }

  // ---- the tank ------------------------------------------------------------
  const model = createTankModel(currentSkin(), currentTurret(), currentHull());
  model.root.position.set(0, STAND.y, 0);
  model.root.rotation.y = FACING; // nose-on to the open door
  group.add(model.root);

  // ---- camera orbit --------------------------------------------------------
  // Opens on a rear three-quarter, which puts the lit doorway in frame beyond
  // the tank — about 25 degrees off the view axis, well inside the frustum.
  let yaw = -Math.PI * 0.26;
  let yawVel = 0;

  function orbit(dx) {
    yaw -= dx * 0.008;
    yawVel = 0;
  }

  function nudgeIdle(dt) {
    // gentle drift when the player isn't dragging
    yaw += yawVel * dt;
    yawVel *= Math.exp(-2.2 * dt);
  }

  function flingOrbit(vx) {
    yawVel = -vx * 0.5;
  }

  // ---- recoil springs (never translate the tank) ---------------------------
  let cooldown = 0;
  let hazeAcc = 0;
  const _haze = new THREE.Vector3();
  const _hazeDir = new THREE.Vector3(-0.25, 1, 0).normalize();
  let gunRecoil = 0;
  let smokeLeft = 0;
  let smokeAcc = 0;
  let pitch = 0;
  let pitchVel = 0;
  let squat = 0;
  let squatVel = 0;

  const _mp = new THREE.Vector3();
  const _md = new THREE.Vector3();
  const _mq = new THREE.Quaternion();

  function muzzle(outPos, outDir, node) {
    const m = node || model.muzzle;
    m.getWorldPosition(outPos);
    m.getWorldQuaternion(_mq);
    outDir.set(1, 0, 0).applyQuaternion(_mq);
  }

  function gunSpec() {
    const s = TURRET_SPECS[model.turretId];
    return s && s.mode === 'projectile' ? s : null;
  }

  // The railgun and the Aegis are neither projectile nor stream weapons, so
  // the old fire() — which only accepted mode 'projectile' — refused both of
  // them outright and nothing happened when you pulled the trigger. They get
  // their own handling below.
  function railSpec() {
    const s = TURRET_SPECS[model.turretId];
    return s && s.mode === 'railgun' ? s : null;
  }

  function beamSpec() {
    const s = TURRET_SPECS[model.turretId];
    return s && s.mode === 'beam' ? s : null;
  }

  function isBeamWeapon() {
    return !!beamSpec();
  }

  // the stream weapons need to be audible on the stand too
  const cryoSound = audio.loopOn(model.root, 'cryo');
  const flameSound = audio.loopOn(model.root, 'flame');
  const aegisSound = audio.loopOn(model.root, 'aegis');
  // The bay itself. Non-positional: it is the room, not an object in it, and
  // as a positional source at refDistance 8 it sat 17 dB under the tank's
  // own idle by the time it reached an orbiting camera 12.5 m out.
  const roomSound = audio.ambientLoop('workshop');
  const idleSound = audio.dieselLoop(model.root);

  // ---- railgun and Aegis state --------------------------------------------
  const rail = { wind: 0, winding: false, trigger: false };
  let aegisActive = false;
  let prongArc = null;
  let prongArcOwner = null;
  const _pgA = new THREE.Vector3();
  const _pgB = new THREE.Vector3();
  const AEGIS_YELLOW = 0xffd23d;

  function fire() {
    if (model.hasStream()) return false; // stream weapons fire by holding
    // A tap is enough to commit the railgun: it spins up on its own from
    // here, exactly as it does in a match.
    if (railSpec()) {
      rail.trigger = true;
      return true;
    }
    if (beamSpec()) return false; // the emitter runs while the trigger is held
    if (cooldown > 0) return false;
    const spec = gunSpec();
    if (!spec) return false;
    if (spec.fuelPerShot) {
      if (fuel < spec.fuelPerShot) return false;
      fuel = Math.max(0, fuel - spec.fuelPerShot);
    }
    const plasma = spec.projectile === 'plasma';

    cooldown = spec.fireInterval;
    gunRecoil = spec.recoil !== undefined ? spec.recoil : 0.22;
    smokeLeft = spec.smokeTime !== undefined ? spec.smokeTime : 2;

    const node = spec.dual ? model.nextMuzzle() : model.muzzle;
    muzzle(_mp, _md, node);
    bullets.fire({}, _mp.clone().addScaledVector(_md, 0.15), _md.clone(), spec.projectile);
    fx.muzzleFlash(_mp.clone(), _md.clone(), plasma ? 'plasma' : 'fire');
    audio.playAt(plasma ? 'plasma' : 'shot', _mp, {
      volume: plasma ? 0.62 : 0.9,
      rate: 0.94 + Math.random() * 0.12,
    });
    // the whole hull bucks: nose lifts, suspension compresses, both settle
    const kick = plasma ? 0.35 : 1;
    pitchVel += 2.4 * kick;
    squatVel -= 1.1 * kick;
    return true;
  }

  function applySkin(skin) {
    model.setSkin(skin);
  }

  function applyHull(id) {
    model.setHull(id);
    model.resetMuzzleCycle();
  }

  function applyTurret(id) {
    model.setTurret(id);
    model.resetMuzzleCycle();
    cooldown = 0;
    fuel = 100;
    streaming = false;
    rail.wind = 0;
    rail.winding = false;
    rail.trigger = false;
    aegisActive = false;
    model.setCharge(0);
    if (prongArc) prongArc.setVisible(false);
    if (railBeam) railBeam.hide();
  }

  // ---- cryo stream (test-fire in the bay) ---------------------------------
  let fuel = 100;
  let streaming = false;

  function activeSpec() {
    const s = TURRET_SPECS[model.turretId];
    return s && s.mode === 'stream' ? s : null;
  }

  function setStream(on) {
    const spec = activeSpec();
    if (!spec) return;
    streaming = on && fuel > (streaming ? 0 : spec.restartAt);
  }

  let triggerHeld = false;

  function setTrigger(on) {
    triggerHeld = on;
    if (model.hasStream()) setStream(on);
  }

  // ---- railgun on the stand ------------------------------------------------
  const _rp = new THREE.Vector3();
  const _rd = new THREE.Vector3();
  const _rq = new THREE.Quaternion();

  function updateRail(dt) {
    const spec = railSpec();
    if (!spec) {
      rail.wind = 0;
      rail.winding = false;
      rail.trigger = false;
      return;
    }
    const ready = fuel >= 99.5;
    if (!rail.winding && rail.trigger && ready) rail.winding = true;
    rail.trigger = false;

    if (rail.winding) {
      rail.wind = Math.min(spec.windUp, rail.wind + dt);
      if (rail.wind >= spec.windUp) {
        model.muzzle.getWorldPosition(_rp);
        model.muzzle.getWorldQuaternion(_rq);
        _rd.set(1, 0, 0).applyQuaternion(_rq);
        if (railBeam) railBeam.fire(_rp, _rd, spec.range);
        fx.muzzleFlash(_rp.clone(), _rd.clone(), 'plasma');
        audio.playAt('rail', _rp, { volume: 1, rate: 0.97 + Math.random() * 0.07 });
        // it kicks the stand hard
        pitchVel += 4.2;
        squatVel -= 1.9;
        fuel = 0;
        rail.wind = 0;
        rail.winding = false;
      }
    } else {
      rail.wind = Math.max(0, rail.wind - dt * 2.5);
      fuel = Math.min(100, fuel + spec.fuelRecharge * dt);
    }
    model.setCharge(rail.wind / spec.windUp);
  }

  // ---- Aegis on the stand --------------------------------------------------
  // There is nothing in the bay to lock onto, so it does what it does in a
  // match with an empty sky: powers up, burns charge, hums, and cracks hard
  // across the prong gap. No lifeline without a target.
  function updateAegis(dt) {
    const spec = beamSpec();
    const anchor = model.arcAnchor;
    if (!spec || !anchor) {
      aegisActive = false;
      if (prongArc) prongArc.setVisible(false);
      aegisSound.update(1, 0);
      return;
    }

    if (aegisActive) {
      if (!triggerHeld || fuel <= 0) aegisActive = false;
    } else if (triggerHeld && fuel >= spec.restartAt) {
      aegisActive = true;
    }
    if (aegisActive) {
      fuel = Math.max(0, fuel - spec.fuelDrain * dt);
      // the emitter shoves back a little while it draws
      pitchVel += 0.9 * dt;
    } else {
      fuel = Math.min(100, fuel + spec.fuelRecharge * dt);
    }

    const gap = model.prongGap;
    if (prongArcOwner !== anchor) {
      prongArc = createProngArc(anchor, gap ? gap.gapZ / 0.30 : 1);
      prongArcOwner = anchor;
    }
    _pgA.set(gap.x, 0.02, gap.gapZ / 2);
    _pgB.set(gap.x, 0.02, -gap.gapZ / 2);
    const pulse = aegisActive ? 0.5 + 0.5 * Math.sin(performance.now() * 0.012) : 0;
    prongArc.setVisible(true);
    prongArc.update(
      dt, _pgA, _pgB, AEGIS_YELLOW,
      aegisActive ? 0.75 + 0.45 * pulse : 0.4, pulse
    );
    aegisSound.update(1, aegisActive ? 0.5 : 0);
  }

  function updateStream(dt) {
    const spec = activeSpec();
    if (!spec) {
      model.setStream(false);
      model.updateStream(dt);
      cryoSound.update(1, 0);
      flameSound.update(1, 0);
      const gun = gunSpec();
      if (gun && gun.auto && triggerHeld) fire();
      if (gun && gun.fuelPerShot && !triggerHeld) {
        fuel = Math.min(100, fuel + gun.fuelRecharge * dt);
      }
      return;
    }
    if (streaming && fuel > 0) {
      fuel = Math.max(0, fuel - spec.fuelDrain * dt);
      if (fuel === 0) streaming = false;
      // the projector shoves back gently while it pours
      pitchVel += 1.1 * dt;
      squatVel -= 0.35 * dt;
    } else {
      fuel = Math.min(100, fuel + spec.fuelRecharge * dt);
    }
    const pouring = streaming && fuel > 0;
    model.setStream(pouring);
    model.updateStream(dt);
    const isFlame = spec.element === 'flame';
    cryoSound.update(1, pouring && !isFlame ? 0.5 : 0);
    flameSound.update(1, pouring && isFlame ? 0.55 : 0);
  }

  // ---- per-frame -----------------------------------------------------------
  function update(dt, camera) {
    if (cooldown > 0) cooldown -= dt;
    updateStream(dt);
    updateRail(dt);
    updateAegis(dt);
    if (railBeam) railBeam.update(dt);

    // ambience: the room hum, and the tank idling where it stands. The bay
    // tone is deliberately well down in the mix — it is background, not a
    // feature.
    roomSound.update(0.34);
    idleSound.update(0, true);
    aimShafts(camera);

    // exhaust haze drifting off the deck
    hazeAcc += dt;
    while (hazeAcc > 0.34) {
      hazeAcc -= 0.34;
      _haze.set(
        model.root.position.x - 1.7 + (Math.random() - 0.5) * 0.5,
        model.root.position.y + 0.9,
        model.root.position.z + (Math.random() - 0.5) * 1.2
      );
      fx.barrelSmoke(_haze, _hazeDir);
    }

    // barrel slides back and returns
    gunRecoil = Math.max(0, gunRecoil - dt * (0.4 + gunRecoil * 9));
    model.gun.position.x = -gunRecoil;

    // hull rock: damped springs, so the tank always comes back to exactly
    // where it started — it rocks, it never rolls off the deck
    pitchVel += (-58 * pitch - 8.5 * pitchVel) * dt;
    pitch += pitchVel * dt;
    squatVel += (-90 * squat - 11 * squatVel) * dt;
    squat += squatVel * dt;
    model.root.rotation.z = pitch;
    model.root.rotation.y = FACING; // the springs must never spin it off-axis
    model.root.position.set(0, STAND.y + squat, 0);

    if (smokeLeft > 0) {
      smokeLeft -= dt;
      smokeAcc += dt;
      while (smokeAcc > 0.07) {
        smokeAcc -= 0.07;
        muzzle(_mp, _md);
        fx.barrelSmoke(_mp, _md);
      }
    }

    nudgeIdle(dt);

    const cx = Math.cos(yaw) * CAM.dist;
    const cz = Math.sin(yaw) * CAM.dist;
    camera.position.set(cx, STAND.y + CAM.height, cz);
    camera.lookAt(0, STAND.y + CAM.look, 0);

    key.target.updateMatrixWorld();
  }

  function enter() {
    group.visible = true;
    model.setSkin(currentSkin());
    model.setHull(currentHull());
    model.setTurret(currentTurret());
    fuel = 100;
    streaming = false;
    cooldown = 0;
    gunRecoil = 0;
    pitch = 0;
    pitchVel = 0;
    squat = 0;
    squatVel = 0;
    smokeLeft = 0;
    rail.wind = 0;
    rail.winding = false;
    rail.trigger = false;
    aegisActive = false;
    model.setCharge(0);
    if (railBeam) railBeam.hide();
    model.gun.position.x = 0;
    model.root.rotation.set(0, FACING, 0);
    model.root.position.set(0, STAND.y, 0);
  }

  function exit() {
    group.visible = false;
    streaming = false;
    triggerHeld = false;
    aegisActive = false;
    rail.winding = false;
    rail.trigger = false;
    rail.wind = 0;
    model.setStream(false);
    model.setCharge(0);
    if (prongArc) prongArc.setVisible(false);
    if (railBeam) railBeam.hide();
    cryoSound.update(1, 0);
    flameSound.update(1, 0);
    aegisSound.update(1, 0);
    roomSound.update(0);
    idleSound.update(0, false);
  }

  return {
    enter, exit, update, fire, orbit, flingOrbit, applySkin, applyTurret, applyHull, setStream, setTrigger,
    reloadFrac: () => 1 - Math.max(0, cooldown) / ((gunSpec() || { fireInterval: FIRE_INTERVAL }).fireInterval),
    fuelFrac: () => fuel / 100,
    isStreamWeapon: () => model.hasStream(),
    isBeamWeapon,
    // Anything that spends the charge bar rather than reloading between shots.
    // The railgun was missing here, so its bar sat permanently full.
    usesCharge: () => {
      const g = gunSpec();
      return model.hasStream() || isBeamWeapon() || !!railSpec() || !!(g && g.fuelPerShot);
    },
  };
}
