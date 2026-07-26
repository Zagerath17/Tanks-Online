import * as THREE from 'three';
import { createTankModel } from './tank.js';
import { TURRET_SPECS } from './tank.js';
import { createProngArc } from './arc.js';
import { makeGridTexture, makeMetalTexture } from './grid-texture.js';
import { currentSkin, currentTurret, currentHull } from './loadout.js';

// The garage: your tank on a workshop platform at the back of a bay whose
// roller door stands open, an orbiting camera you drag with the mouse, and a
// gun that fires for real — muzzle flash, smoke, sound, a live shell, and a
// hull that rocks on its suspension. The tank itself never leaves the deck:
// every recoil motion is a spring that returns to zero.
const STAND = { y: 1.3, halfX: 6.5, halfZ: 5.5 };
const RAMP = { len: 4.2, halfW: 2.6 }; // off the back of the deck to the floor
const DOOR = { w: 9, h: 6.4 };
// one concrete slab per 2 m of floor
const BAY_TILES_X = 15;
const BAY_TILES_Z = 17;
// the tank sits nose-on to the door, which is in the +Z wall
const FACING = -Math.PI / 2;
// Hard stops on the display rig. The tank is a model standing on a solid
// deck, so neither the drop nor the rock may ever carry a corner of it below
// the plate — a heavy gun used to drive it most of a metre down, through the
// platform and out the bottom.
const SQUAT_LIMIT = 0.07;
const PITCH_LIMIT = 0.055; // radians, about 3.2 degrees
const FIRE_INTERVAL = 2.5;
const CAM = { dist: 12.5, height: 4.6, look: 1.9 };

export function createGarage({ scene, fx, audio, bullets, railBeam }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // ---- the bay -------------------------------------------------------------
  const BAY = { w: 30, d: 34, h: 11 };

  // Worn bay concrete, laid out in 2 m slabs, and a chequer-plate deck. The
  // floor and the platform were both flat colour before, which made the room
  // read as cardboard next to the tank standing on it.
  // Poured concrete: grain and staining, no ruled lines. It was a grid
  // before, which made the floor read as tiling rather than as a slab.
  const concrete = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({
      base: '#3a3f46', shade: '#31363c', grain: 0.7, wear: 2.8,
      repeat: [BAY_TILES_X, BAY_TILES_Z], anisotropy: 16,
    }),
    roughness: 0.98, metalness: 0.03,
  });
  // Painted blockwork: coursed, so the walls read as built rather than as
  // flat panels standing behind the tank.
  // Painted steel panelling. Metal, not a ruled grid.
  const painted = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({
      base: '#464e57', shade: '#3a414a', grain: 2.2, wear: 1.5,
      repeat: [7, 3], anisotropy: 16,
    }),
    roughness: 0.62, metalness: 0.55,
  });
  const steel = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({ base: '#4a5159', shade: '#3e444b', grain: 1.4, wear: 1.2, repeat: [2, 2] }),
    roughness: 0.5, metalness: 0.75,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({ base: '#23272c', shade: '#1c2024', grain: 1.1, wear: 1.6, repeat: [2, 2] }),
    roughness: 0.6, metalness: 0.6,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1d2024', roughness: 0.9 });
  // Was hazard yellow; now dark machined steel, which sits better against
  // the concrete and stops the bay reading as a construction site.
  const hazard = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({ base: '#3c4148', shade: '#2e3238', grain: 1.4, wear: 1.8, repeat: [3, 1] }),
    roughness: 0.42, metalness: 0.8,
  });

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

  // the two extractors set into the back wall, turning at half the pace of
  // the big ceiling fan
  const ductFans = [];

  // ---- wall furniture ------------------------------------------------------
  // Ribbed panelling low down, services run high, and the sort of fittings
  // that accumulate on the walls of somewhere tanks actually get worked on.
  {
    const HALF_W = BAY.w / 2 - 0.22;
    const HALF_D = BAY.d / 2 - 0.22;

    const rib = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#454c55', shade: '#3b414a', grain: 1.3, wear: 1.1, repeat: [1, 3] }),
      roughness: 0.8, metalness: 0.2,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#5a626b', shade: '#4b525a', grain: 2.0, wear: 0.9, repeat: [1, 6] }),
      roughness: 0.45, metalness: 0.7,
    });
    const ductMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#6a7078', shade: '#5b6169', grain: 2.4, wear: 0.8, repeat: [1, 8] }),
      roughness: 0.6, metalness: 0.4,
    });
    const boxMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#3a4048', shade: '#31363d', grain: 1.2, wear: 1.4, repeat: [2, 2] }),
      roughness: 0.7, metalness: 0.35,
    });
    const redMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#8e2f26', shade: '#762720', grain: 1.0, wear: 1.8, repeat: [2, 2] }),
      roughness: 0.6, metalness: 0.2,
    });
    const signMat = new THREE.MeshStandardMaterial({
      color: '#c8b34a', emissive: '#4a4020', emissiveIntensity: 0.4, roughness: 0.7,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#9fb6c6', emissive: '#8fa8bd', emissiveIntensity: 0.55,
      roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.5,
    });

    // dado rail and a kick plate along each side wall
    for (const sx of [-1, 1]) {
      const dado = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, BAY.d - 1), rib);
      dado.position.set(sx * HALF_W, 2.5, 0);
      group.add(dado);
      const kick = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, BAY.d - 1), boxMat);
      kick.position.set(sx * HALF_W, 0.25, 0);
      group.add(kick);
      // vertical ribs between floor and dado
      for (let i = -7; i <= 7; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.0, 0.16), rib);
        r.position.set(sx * HALF_W, 1.45, i * 2.1);
        group.add(r);
      }
    }

    // back wall gets the same treatment
    {
      const dado = new THREE.Mesh(new THREE.BoxGeometry(BAY.w - 1, 0.14, 0.1), rib);
      dado.position.set(0, 2.5, -HALF_D);
      group.add(dado);
      const kick = new THREE.Mesh(new THREE.BoxGeometry(BAY.w - 1, 0.5, 0.14), boxMat);
      kick.position.set(0, 0.25, -HALF_D);
      group.add(kick);
      for (let i = -6; i <= 6; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.09), rib);
        r.position.set(i * 2.2, 1.45, -HALF_D);
        group.add(r);
      }
    }

    // service runs high up: a fat duct with a pair of pipes under it
    for (const sx of [-1, 1]) {
      const duct = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, BAY.d - 2), ductMat);
      duct.position.set(sx * (HALF_W - 0.45), BAY.h - 2.3, 0);
      group.add(duct);
      // banding along the duct
      for (let i = -6; i <= 6; i++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.68, 0.07), boxMat);
        band.position.set(sx * (HALF_W - 0.45), BAY.h - 2.3, i * 2.4);
        group.add(band);
      }
      for (const [dy, r] of [[-0.62, 0.11], [-0.9, 0.08]]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, BAY.d - 2, 10), pipeMat);
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(sx * (HALF_W - 0.3), BAY.h - 2.3 + dy, 0);
        group.add(pipe);
      }
      // brackets holding the run
      for (let i = -5; i <= 5; i++) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), boxMat);
        br.position.set(sx * (HALF_W - 0.28), BAY.h - 1.9, i * 2.9);
        group.add(br);
      }
    }

    // clerestory windows high on the side walls, letting a little light in
    for (const sx of [-1, 1]) {
      for (let i = -2; i <= 2; i++) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 3.0), glassMat);
        pane.position.set(sx * HALF_W, BAY.h - 4.4, i * 5.4);
        group.add(pane);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.72, 3.24), boxMat);
        frame.position.set(sx * (HALF_W + 0.02), BAY.h - 4.4, i * 5.4);
        group.add(frame);
        // mullions
        for (const mz of [-1, 0, 1]) {
          const mull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.08), boxMat);
          mull.position.set(sx * (HALF_W - 0.01), BAY.h - 4.4, i * 5.4 + mz);
          group.add(mull);
        }
        const spill = new THREE.PointLight('#a8c4d8', 5, 12, 2);
        spill.position.set(sx * (HALF_W - 1.4), BAY.h - 4.4, i * 5.4);
        group.add(spill);
      }
    }

    // consumer units and junction boxes, with conduit dropping to them
    for (const [x, z, sx] of [[-HALF_W, -8.5, -1], [-HALF_W, 4.0, -1], [HALF_W, -3.0, 1], [HALF_W, 10.0, 1]]) {
      const unit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.6), boxMat);
      unit.position.set(x - sx * 0.1, 2.05, z);
      group.add(unit);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.48), rib);
      door.position.set(x - sx * 0.23, 2.05, z);
      group.add(door);
      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, BAY.h - 4.6, 8), pipeMat);
      conduit.position.set(x - sx * 0.1, 2.05 + 0.42 + (BAY.h - 4.6) / 2, z);
      group.add(conduit);
    }

    // fire points: extinguisher pairs on a backboard
    for (const [x, z, sx] of [[-HALF_W, 12.0, -1], [HALF_W, -12.0, 1]]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.1), redMat);
      board.position.set(x - sx * 0.06, 1.1, z);
      group.add(board);
      for (const dz of [-0.28, 0.28]) {
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.72, 12), redMat);
        bottle.position.set(x - sx * 0.28, 0.95, z + dz);
        bottle.castShadow = true;
        group.add(bottle);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 8), boxMat);
        neck.position.set(x - sx * 0.28, 1.4, z + dz);
        group.add(neck);
      }
    }

    // hose reel on a drum
    {
      const x = -HALF_W;
      const z = -2.0;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 20), redMat);
      drum.rotation.z = Math.PI / 2;
      drum.position.set(x + 0.3, 2.6, z);
      group.add(drum);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 12), boxMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x + 0.3, 2.6, z);
      group.add(hub);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.1), boxMat);
      arm.position.set(x + 0.16, 2.6, z);
      group.add(arm);
    }

    // wall cabinets over the benches
    for (const [x, z, sx] of [[-HALF_W, -6.0, -1], [-HALF_W, 6.0, -1], [HALF_W, 2.0, 1]]) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 2.4), rib);
      cab.position.set(x - sx * 0.24, 3.5, z);
      cab.castShadow = true;
      group.add(cab);
      for (const dz of [-0.6, 0.6]) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), pipeMat);
        handle.position.set(x - sx * 0.47, 3.5, z + dz);
        group.add(handle);
      }
    }

    // notice board and hazard signage
    for (const [x, z, sx, w] of [[-HALF_W, 0.5, -1, 1.9], [HALF_W, -8.0, 1, 1.5]]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.2, w), boxMat);
      board.position.set(x - sx * 0.05, 3.4, z);
      group.add(board);
      for (let i = 0; i < 5; i++) {
        const sheet = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.3 + Math.random() * 0.16, 0.24), rib
        );
        sheet.position.set(
          x - sx * 0.1,
          3.15 + Math.random() * 0.5,
          z - w / 2 + 0.25 + Math.random() * (w - 0.5)
        );
        group.add(sheet);
      }
    }
    for (const [x, z, sx] of [[-HALF_W, -14.0, -1], [HALF_W, 14.0, 1], [HALF_W, -15.0, 1]]) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.55), signMat);
      sign.position.set(x - sx * 0.04, 3.9, z);
      sign.rotation.x = Math.PI / 4;
      group.add(sign);
    }

    // a caged inspection lamp on a lead, hooked on the wall
    {
      const x = HALF_W;
      const z = 6.5;
      const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 10), boxMat);
      lampBody.position.set(x - 0.3, 2.9, z);
      group.add(lampBody);
      const cage = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), pipeMat);
      cage.position.set(x - 0.3, 2.68, z);
      group.add(cage);
      const glow = new THREE.PointLight('#ffe7bd', 8, 7, 2);
      glow.position.set(x - 0.5, 2.6, z);
      group.add(glow);
      const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), boxMat);
      lead.position.set(x - 0.22, 3.7, z);
      lead.rotation.z = 0.12;
      group.add(lead);
    }

    // wall-mounted ladder up to the gantry
    {
      const x = -HALF_W;
      const z = -13.0;
      for (const dz of [-0.32, 0.32]) {
        const stile = new THREE.Mesh(new THREE.BoxGeometry(0.09, BAY.h - 2.4, 0.09), pipeMat);
        stile.position.set(x + 0.28, (BAY.h - 2.4) / 2, z + dz);
        group.add(stile);
      }
      for (let i = 0; i < 12; i++) {
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.64, 8), pipeMat);
        rung.rotation.x = Math.PI / 2;
        rung.position.set(x + 0.28, 0.5 + i * 0.72, z);
        group.add(rung);
      }
    }

    // extractor fans set into the back wall
    for (const dx of [-9.5, 9.5]) {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 0.3), boxMat);
      housing.position.set(dx, BAY.h - 3.2, -HALF_D + 0.08);
      group.add(housing);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.16, 10), pipeMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(dx, BAY.h - 3.2, -HALF_D + 0.2);
      group.add(hub);
      // The blades used to be dropped straight into the bay and never moved.
      // Parent them to a spinner at the hub so they can actually turn.
      const spin = new THREE.Group();
      spin.position.set(dx, BAY.h - 3.2, -HALF_D + 0.22);
      group.add(spin);
      ductFans.push(spin);
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.04), pipeMat);
        blade.position.set(
          Math.cos(b * Math.PI / 2) * 0.34,
          Math.sin(b * Math.PI / 2) * 0.34,
          0
        );
        blade.rotation.z = b * Math.PI / 2 + 0.5;
        spin.add(blade);
      }
      // louvres over the housing
      for (let i = 0; i < 5; i++) {
        const lv = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.14), rib);
        lv.position.set(dx, BAY.h - 3.85 + i * 0.32, -HALF_D + 0.24);
        lv.rotation.x = 0.4;
        group.add(lv);
      }
    }

    // stains and scorch where things get leaned against the wall
    const stainMat = new THREE.MeshBasicMaterial({
      color: '#1c1a18', transparent: true, opacity: 0.16, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    for (let i = 0; i < 10; i++) {
      const sx = Math.random() < 0.5 ? -1 : 1;
      const h = 0.7 + Math.random() * 1.8;
      const w = 0.5 + Math.random() * 1.6;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), stainMat);
      s.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      s.position.set(sx * (HALF_W - 0.03), h / 2, (Math.random() - 0.5) * (BAY.d - 4));
      group.add(s);
    }
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

  // (the ceiling surface itself is built with the rest of the roof services
  // further down — there used to be a second, untextured plane here sitting
  // 2 cm behind it, and the two flickered against each other)
  // Roof beams, with a proper bottom flange rather than a bare rectangle —
  // the old bare boxes caught the light along their lower edge and read as a
  // row of spikes from underneath.
  const BEAM_Z = [-12, -6, 0, 6, 12];
  for (const bz of BEAM_Z) {
    const web = new THREE.Mesh(new THREE.BoxGeometry(BAY.w, 0.5, 0.2), darkSteel);
    web.position.set(0, BAY.h - 0.4, bz);
    group.add(web);
    for (const fy of [BAY.h - 0.15, BAY.h - 0.66]) {
      const flange = new THREE.Mesh(new THREE.BoxGeometry(BAY.w, 0.09, 0.5), steel);
      flange.position.set(0, fy, bz);
      group.add(flange);
    }
  }

  // (the overhead gantry used to live here; the extractor fan owns this
  // space now, and the two fouled each other)

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
  // Racking: slotted-angle uprights, a lipped deck on each shelf, and cross
  // bracing at the back. The crates on them are painted parts bins with a
  // label card, in a few colours, rather than plain grey blocks.
  const shelfMat = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({ base: '#575f68', shade: '#474e56', grain: 2.4, wear: 1.7, repeat: [4, 1] }),
    roughness: 0.5, metalness: 0.78,
  });
  const BIN_COLOURS = ['#7a3b2e', '#2f5568', '#5c6b33', '#6a5a2c', '#4a3f52'];
  const binMats = BIN_COLOURS.map((c) => new THREE.MeshStandardMaterial({
    map: makeMetalTexture({ base: c, shade: c, grain: 1.1, wear: 2.2, repeat: [1, 1] }),
    roughness: 0.72, metalness: 0.22,
  }));
  const labelMat = new THREE.MeshStandardMaterial({ color: '#d9d3c2', roughness: 0.9 });

  function rack(x, z, ry) {
    const g = new THREE.Group();
    for (let s = 0; s < 4; s++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.07, 1.0), shelfMat);
      shelf.position.y = 0.5 + s * 0.85;
      g.add(shelf);
      // front and back lip, so the deck reads as folded sheet
      for (const lz of [-0.5, 0.5]) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.11, 0.05), shelfMat);
        lip.position.set(0, 0.53 + s * 0.85, lz);
        g.add(lip);
      }
      for (let i = 0; i < 3; i++) {
        const w = 0.7 + Math.random() * 0.3;
        const bin = new THREE.Mesh(
          new THREE.BoxGeometry(w, 0.45, 0.7),
          binMats[Math.floor(Math.random() * binMats.length)]
        );
        const bx = -1.2 + i * 1.1;
        bin.position.set(bx, 0.78 + s * 0.85, 0);
        bin.rotation.y = (Math.random() - 0.5) * 0.24;
        g.add(bin);
        // label card on the front face
        const card = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.42, 0.14), labelMat);
        card.position.set(
          bx + Math.sin(bin.rotation.y) * 0.36,
          0.74 + s * 0.85,
          Math.cos(bin.rotation.y) * 0.36
        );
        card.rotation.y = bin.rotation.y;
        g.add(card);
      }
    }
    // diagonal bracing across the back
    for (const dsign of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.05, 0.05), shelfMat);
      brace.position.set(0, 1.8, -0.45);
      brace.rotation.z = dsign * 0.75;
      g.add(brace);
    }
    for (const sx of [-1.7, 1.7]) {
      for (const sz of [-0.45, 0.45]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.6, 0.1), shelfMat);
        post.position.set(sx, 1.8, sz);
        g.add(post);
        // foot plate
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.24), darkSteel);
        foot.position.set(sx, 0.02, sz);
        g.add(foot);
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
    box.position.set(x, 0.55, z); // 1.1 tall, so this sits it ON the floor
    box.rotation.y = ry;
    box.castShadow = true;
    group.add(box);
    for (let d = 0; d < 3; d++) {
      const drawer = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.06), darkSteel);
      // the face of the box, found through its own rotation — using cos(ry)
      // alone left these hanging in space next to a turned trolley
      drawer.position.set(
        x + Math.sin(ry) * 0.41,
        0.22 + d * 0.32,
        z + Math.cos(ry) * 0.41
      );
      drawer.rotation.y = ry;
      group.add(drawer);
    }
  }

  // ---- ceiling ------------------------------------------------------------
  // Painted deck panels between the beams, with the services that would run
  // up there: trunking, conduit, a sprinkler main, and a big slow extractor
  // fan turning over the middle of the bay.
  const fanBlades = [];
  {
    const ceilMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({
        base: '#6d6a60', shade: '#585449', grain: 2.6, wear: 1.6,
        repeat: [8, 9], anisotropy: 16,
      }),
      roughness: 0.74, metalness: 0.32, side: THREE.DoubleSide,
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(BAY.w, BAY.d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = BAY.h - 0.02;
    group.add(ceil);

    // stained panels, so it is not one flat sheet of colour
    const stainMat = new THREE.MeshBasicMaterial({
      color: '#2a2f36', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const [sx, sz, w, d] of [[-8, -9, 5, 4], [7, 4, 6, 5], [-3, 11, 4, 3], [10, -12, 4, 4]]) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stainMat);
      patch.rotation.x = Math.PI / 2;
      patch.position.set(sx, BAY.h - 0.05, sz);
      group.add(patch);
    }

    // cable trunking and a sprinkler main running the length of the bay
    const trunkMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#6b7079', shade: '#585d65', grain: 2.2, wear: 0.7, repeat: [1, 10] }),
      roughness: 0.55, metalness: 0.6,
    });
    for (const sx of [-5.5, 5.5]) {
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, BAY.d - 2), trunkMat);
      trunk.position.set(sx, BAY.h - 0.42, 0);
      group.add(trunk);
      for (let i = -6; i <= 6; i++) {
        const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), darkSteel);
        hanger.position.set(sx, BAY.h - 0.2, i * 2.5);
        group.add(hanger);
      }
    }
    const pipeRed = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#8e2f26', shade: '#762720', grain: 1.0, wear: 1.5, repeat: [1, 8] }),
      roughness: 0.6, metalness: 0.25,
    });
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, BAY.d - 1.5, 12), pipeRed);
    main.rotation.x = Math.PI / 2;
    // slung clear beneath the beams rather than buried in them
    main.position.set(0.9, BAY.h - 1.0, 0);
    group.add(main);
    // a bracket where the run passes under each beam, so the crossing looks
    // hung rather than clipped
    for (const bz of [-12, -6, 0, 6, 12]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.07), steel);
      strap.position.set(0.9, BAY.h - 0.72, bz);
      group.add(strap);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 6, 14), steel);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0.9, BAY.h - 1.0, bz);
      group.add(collar);
    }
    // Sprinkler heads. These were bare downward cones, which read as a row of
    // spikes driven through the pipe rather than plumbing. A real head is a
    // short threaded boss with a flat deflector under it, so build that: a
    // stub off the main, a hex body, and a disc.
    for (let i = -5; i <= 5; i++) {
      const z = i * 3;
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), steel);
      stub.position.set(0.9, BAY.h - 1.14, z);
      group.add(stub);
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.07, 6), steel);
      boss.position.set(0.9, BAY.h - 1.22, z);
      group.add(boss);
      const deflector = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 10), steel);
      deflector.position.set(0.9, BAY.h - 1.27, z);
      group.add(deflector);
    }

    // a painted service strip down the centre of the roof, so the ceiling
    // reads as a room and not one flat sheet
    const stripMat = new THREE.MeshStandardMaterial({
      color: '#3f4a52', roughness: 0.8, metalness: 0.25, side: THREE.DoubleSide,
    });
    for (const sx of [-9.5, 9.5]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.2, BAY.d - 2), stripMat);
      strip.rotation.x = Math.PI / 2;
      strip.position.set(sx, BAY.h - 0.04, 0);
      group.add(strip);
    }

    // ---- the extractor fan ------------------------------------------------
    const fan = new THREE.Group();
    fan.position.set(-1.2, BAY.h - 1.15, -1.5);
    group.add(fan);

    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.95, 10), darkSteel);
    drop.position.y = 0.55;
    fan.add(drop);
    const fanPaint = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#4f6a63', shade: '#3f5651', grain: 1.6, wear: 1.9, repeat: [2, 2] }),
      roughness: 0.6, metalness: 0.55,
    });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 16), fanPaint);
    plate.position.y = 1.03;
    fan.add(plate);

    const spinner = new THREE.Group();
    spinner.name = 'ceiling-fan';
    fan.add(spinner);
    fanBlades.push(spinner);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.26, 18), fanPaint);
    spinner.add(hub);
    const capNut = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), darkSteel);
    capNut.position.y = -0.16;
    spinner.add(capNut);

    const bladeMat = new THREE.MeshStandardMaterial({
      map: makeMetalTexture({ base: '#7e8a86', shade: '#67716e', grain: 2.0, wear: 1.4, repeat: [4, 1] }),
      roughness: 0.5, metalness: 0.62,
    });
    // contrasting tips, the way a real extractor is painted so you can see
    // at a glance that it is turning
    const tipMat = new THREE.MeshStandardMaterial({
      color: '#b8563a', roughness: 0.7, metalness: 0.3,
    });

    // five long blades, pitched so they read as moving air
    const bladeGeo = new THREE.BoxGeometry(3.1, 0.05, 0.62);
    for (let i = 0; i < 5; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i / 5) * Math.PI * 2;
      spinner.add(arm);
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.set(1.72, -0.03, 0);
      blade.rotation.x = 0.22; // pitch
      arm.add(blade);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.055, 0.63), tipMat);
      tip.position.set(3.02, -0.03, 0);
      tip.rotation.x = 0.22;
      arm.add(tip);
      const root = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.2), fanPaint);
      root.position.set(0.42, -0.03, 0);
      arm.add(root);
    }

    // a guard cage under it, so it reads as industrial rather than domestic
    for (const r of [1.0, 1.9]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.028, 6, 32), darkSteel);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.3;
      fan.add(ring);
    }
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.03, 0.03), darkSteel);
      spoke.rotation.y = (i / 6) * Math.PI;
      spoke.position.y = -0.3;
      fan.add(spoke);
    }
  }

  // ---- the workshop platform ----------------------------------------------
  // A welded steel service deck rather than a display plinth: plated top,
  // channel-section edge beams, legs, hazard-striped nosing, and a ramp off
  // the back the tank could actually have driven up.
  const deckMat = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({
      base: '#59616b', shade: '#474e57', grain: 1.6, wear: 1.5,
      repeat: [STAND.halfX, STAND.halfZ], anisotropy: 16,
    }),
    roughness: 0.62, metalness: 0.55,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    map: makeMetalTexture({
      base: '#3b424b', shade: '#333944', grain: 1.2, wear: 1.9, repeat: [3, 2],
    }),
    roughness: 0.9, metalness: 0.12,
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

  // ---- tread marks worn into the floor -------------------------------------
  // A busy bay: the current tank's route in, plus older lanes from everything
  // that has been through before, crossing and overlapping each other.
  //
  // Each run gets its OWN texture instance. Sharing one and calling
  // markTex.repeat.set() per run doesn't work — repeat lives on the texture,
  // not the mesh, so whichever run set it last won and every other lane got
  // its grousers stretched into a few long dashes.
  {
    // 25 lanes were each generating their own canvas on entry, which is a
    // large slice of the pause when the garage opens. Lanes of similar length
    // want the same texture, so bucket by grouser count and reuse.
    const markCache = new Map();
    function makeMarkTexture(grousers) {
      const cached = markCache.get(grousers);
      if (cached) return cached;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 128;
      const g = c.getContext('2d');
      g.clearRect(0, 0, 64, 128);
      // scuffed band the width of the track
      g.fillStyle = 'rgba(18,17,16,0.30)';
      g.fillRect(3, 0, 58, 128);
      for (let i = 0; i < 500; i++) {
        g.fillStyle = `rgba(12,11,10,${0.02 + Math.random() * 0.07})`;
        g.fillRect(3 + Math.random() * 58, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      // grousers ACROSS the track, stacked along the direction of travel
      const pitch = 128 / grousers;
      for (let i = 0; i < grousers; i++) {
        const y = i * pitch;
        g.fillStyle = `rgba(13,12,11,${0.46 + Math.random() * 0.3})`;
        g.fillRect(2, y, 60, pitch * 0.44);
        // cleat detail along each bar
        g.fillStyle = 'rgba(9,8,8,0.22)';
        for (let k = 0; k < 6; k++) {
          g.fillRect(6 + k * 9.2, y - 1, 1.5, pitch * 0.44 + 2);
        }
      }
      // feather the two long edges of the track
      const fade = g.createLinearGradient(0, 0, 64, 0);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.14, 'rgba(0,0,0,0)');
      fade.addColorStop(0.86, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = fade;
      g.fillRect(0, 0, 64, 128);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 16;
      markCache.set(grousers, tex);
      return tex;
    }

    const GAUGE = 2.36;  // centre-to-centre of the two tracks
    const WIDE = 0.62;   // track width
    const PITCH = 0.42;  // metres of floor per printed grouser

    // One pair of tracks from (x0,z0) to (x1,z1). Its own texture, its own
    // repeat, so the grouser pitch is the same on every lane whatever its
    // length. Runs slightly past both ends so joined segments never gap.
    function lane(x0, z0, x1, z1, y0, y1, opacity, gauge = GAUGE) {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const flat = Math.hypot(dx, dz);
      if (flat < 0.05) return;
      const len = Math.hypot(flat, y1 - y0);
      const heading = Math.atan2(dx, dz); // rotation about Y for a +Z quad
      const tilt = Math.atan2(y1 - y0, flat);
      const grousers = Math.max(2, Math.round(len / PITCH));
      const tex = makeMarkTexture(grousers);
      tex.repeat.set(1, grousers);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity, depthWrite: false,
        side: THREE.DoubleSide, polygonOffset: true,
        polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const ux = dx / flat;
      const uz = dz / flat;
      // perpendicular, for the two track centres
      const px = uz;
      const pz = -ux;
      for (const side of [-1, 1]) {
        // No overhang on sloped runs: the +0.3 that hides seams on the flat
        // carries a tilted quad straight off the end of the ramp and leaves
        // it hanging in the air above the deck.
        const geo = new THREE.PlaneGeometry(WIDE, len + (Math.abs(tilt) > 0.01 ? -0.06 : 0.08));
        const m = new THREE.Mesh(geo, mat);
        m.rotation.order = 'YXZ';
        m.rotation.y = heading;
        m.rotation.x = -Math.PI / 2 + tilt;
        m.position.set(
          (x0 + x1) / 2 + px * side * gauge / 2,
          (y0 + y1) / 2 + 0.012,
          (z0 + z1) / 2 + pz * side * gauge / 2
        );
        m.renderOrder = 1;
        group.add(m);
      }
    }

    // the route the tank on the stand took: in off the apron, up the ramp,
    // onto the deck — one continuous set of tracks
    const rise = Math.atan2(STAND.y, RAMP.len);
    const zApron = BAY.d / 2 - 0.4;
    const zRampBase = STAND.halfZ + RAMP.len;
    lane(0, zApron, 0, zRampBase, 0, 0, 0.85);
    lane(0, zRampBase, 0, STAND.halfZ, 0, STAND.y, 0.85);
    lane(0, STAND.halfZ - 0.3, 0, -STAND.halfZ + 1.4, STAND.y, STAND.y, 0.85);

    // more traffic across the deck itself: shunted about, turned around, and
    // reversed off the back at some point
    const deckLanes = [
      [-2.6, STAND.halfZ - 0.4, 3.4, -STAND.halfZ + 0.6, 0.42],
      [3.8, STAND.halfZ - 0.6, -3.2, -STAND.halfZ + 1.0, 0.36],
      [-5.2, 2.4, 5.4, 0.6, 0.30],
      [5.0, -3.2, -5.0, -1.4, 0.28],
      [0.8, -STAND.halfZ + 0.3, -1.2, STAND.halfZ - 0.3, 0.32],
    ];
    for (const [ax, az, bx, bz, op] of deckLanes) {
      lane(ax, az, bx, bz, STAND.y, STAND.y, op, GAUGE * (0.9 + Math.random() * 0.25));
    }
    pivotArc(0.4, -1.0, 2.3, 0.4, 2.6, 0.26, STAND.y);

    // older lanes across the bay floor, criss-crossing at angles and fading
    // with age — machines have been in and out of here for years
    const older = [
      [-11.5, 15.5, 8.0, -13.0, 0.34],
      [10.5, 15.8, -9.5, -11.0, 0.30],
      [-13.0, 6.0, 13.0, 11.5, 0.26],
      [12.5, 3.0, -12.5, 8.5, 0.24],
      [-8.0, 16.0, -12.5, -6.0, 0.30],
      [7.5, 16.2, 12.8, 1.0, 0.28],
      [-13.2, -8.5, 6.0, 16.0, 0.22],
      [13.0, -6.0, -4.0, 16.2, 0.22],
    ];
    for (const [ax, az, bx, bz, op] of older) {
      lane(ax, az, bx, bz, 0, 0, op, GAUGE * (0.86 + Math.random() * 0.3));
    }

    // a couple of tight turning scuffs, laid as short chords round an arc
    function pivotArc(cx, cz, radius, from, to, opacity, y = 0) {
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const a0 = from + (to - from) * (i / steps);
        const a1 = from + (to - from) * ((i + 1) / steps);
        lane(
          cx + Math.cos(a0) * radius, cz + Math.sin(a0) * radius,
          cx + Math.cos(a1) * radius, cz + Math.sin(a1) * radius,
          y, y, opacity
        );
      }
    }
    pivotArc(-6.5, 11.0, 4.2, -0.5, 1.5, 0.26);
    pivotArc(8.0, 8.5, 3.4, 2.2, 4.1, 0.22);
  }

  // hazard stripe painted on the floor around the working area
  {
    const paint = new THREE.MeshBasicMaterial({
      color: '#4a5058', transparent: true, opacity: 0.55,
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

  // ---- light haze ----------------------------------------------------------
  // A workshop this size always has something in the air. Big soft additive
  // billboards, very faint, drifting slowly: enough to catch the strip lights
  // and give the bay some depth without fogging the tank itself.
  const hazePuffs = [];
  {
    const s = 256;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,244,224,0.20)');
    grad.addColorStop(0.45, 'rgba(255,240,215,0.09)');
    grad.addColorStop(1, 'rgba(255,236,205,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const hazeTex = new THREE.CanvasTexture(c);
    hazeTex.colorSpace = THREE.SRGBColorSpace;

    const hazeMat = new THREE.SpriteMaterial({
      map: hazeTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });

    for (let i = 0; i < 16; i++) {
      const puff = new THREE.Sprite(hazeMat);
      const scale = 7 + Math.random() * 7;
      puff.scale.set(scale, scale * 0.7, 1);
      puff.position.set(
        (Math.random() - 0.5) * (BAY.w - 6),
        2.4 + Math.random() * (BAY.h - 4.5),
        (Math.random() - 0.5) * (BAY.d - 6)
      );
      puff.renderOrder = 2;
      group.add(puff);
      hazePuffs.push({
        puff,
        // each one drifts on its own slow path, so the haze never looks tiled
        ox: puff.position.x,
        oz: puff.position.z,
        rate: 0.05 + Math.random() * 0.09,
        phase: Math.random() * Math.PI * 2,
        sway: 1.2 + Math.random() * 1.8,
      });
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
  let hazeTime = 0;
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

  // a gun that goes off on the release rather than the press
  function boltSpec() {
    const g = gunSpec();
    return g && g.releaseFire ? g : null;
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
  // Thunderbolt on the stand: same hold-to-bank behaviour as in a match.
  const bolt = { held: 0, armed: false, suppress: false };
  let releasing = false;
  let lastInterval = 0;
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
    // A release-fire gun is driven by setTrigger(false); the press does
    // nothing, or a tap would shoot twice.
    if (boltSpec() && !releasing) return false;
    if (cooldown > 0) return false;
    const spec = gunSpec();
    if (!spec) return false;
    if (spec.fuelPerShot) {
      if (fuel < spec.fuelPerShot) return false;
      fuel = Math.max(0, fuel - spec.fuelPerShot);
    }
    const plasma = spec.projectile === 'plasma';
    const charged = !!(spec.releaseFire && bolt.armed);
    if (charged) bolt.armed = false;

    cooldown = charged ? spec.chargedCooldown : spec.fireInterval;
    lastInterval = cooldown;
    gunRecoil = spec.recoil !== undefined ? spec.recoil : 0.22;
    smokeLeft = spec.smokeTime !== undefined ? spec.smokeTime : 2;

    const node = spec.dual ? model.nextMuzzle() : model.muzzle;
    muzzle(_mp, _md, node);
    bullets.fireSpread(
      {}, _mp.clone().addScaledVector(_md, 0.15), _md.clone(), spec,
      charged ? spec.chargedDamage : spec.damage
    );
    fx.muzzleFlash(_mp.clone(), _md.clone(), plasma ? 'plasma' : 'fire');
    audio.playAt(plasma ? 'plasma' : 'shot', _mp, {
      volume: plasma ? 0.62 : 0.9,
      rate: 0.94 + Math.random() * 0.12,
    });
    // the whole hull bucks: nose lifts, suspension compresses, both settle.
    // Scaled off the same recoil figure the match uses, so a gun that shoves
    // the tank about out there shoves it about on the stand too.
    const kick = (charged && spec.chargedKick !== undefined
      ? spec.chargedKick
      : (spec.recoilKick !== undefined ? spec.recoilKick : 1)) / 2.4;
    pitchVel += 2.6 * kick;
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
    bolt.held = 0;
    bolt.armed = false;
    bolt.suppress = false;
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
    const wasHeld = triggerHeld;
    triggerHeld = on;
    if (model.hasStream()) setStream(on);
    if (!on && wasHeld) releaseBolt();
  }

  // ---- railgun on the stand ------------------------------------------------
  const _rp = new THREE.Vector3();
  const _rd = new THREE.Vector3();
  const _rq = new THREE.Quaternion();

  function updateBolt(dt) {
    const spec = boltSpec();
    if (!spec) {
      bolt.held = 0;
      bolt.armed = false;
      bolt.suppress = false;
      return;
    }
    if (triggerHeld) {
      bolt.held += dt;
      if (!bolt.armed && bolt.held >= spec.chargeTime && cooldown <= 0) {
        bolt.armed = true;
        bolt.suppress = true; // this pull was spent charging, not shooting
        audio.playAt('rail', model.root.position, { volume: 0.5, rate: 1.5 });
      }
    } else {
      bolt.held = 0;
    }
  }

  // what the reload bar should show for a release-fire gun
  function boltState() {
    const spec = boltSpec();
    if (!spec) return null;
    const frac = bolt.armed
      ? 1
      : (cooldown > 0
        ? 1 - Math.max(0, cooldown) / (lastInterval || spec.fireInterval)
        : Math.min(1, bolt.held / spec.chargeTime));
    return { frac, armed: bolt.armed, held: bolt.held };
  }

  function releaseBolt() {
    const spec = boltSpec();
    if (!spec) return;
    const wasCharging = bolt.suppress;
    bolt.suppress = false;
    bolt.held = 0;
    if (!wasCharging) {
      releasing = true;
      fire();
      releasing = false;
    }
  }

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
        // it kicks the stand very hard indeed
        const rk = (spec.recoilKick !== undefined ? spec.recoilKick : 7) / 2.4;
        pitchVel += 2.6 * rk;
        squatVel -= 1.1 * rk;
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
    updateBolt(dt);
    updateRail(dt);
    updateAegis(dt);
    if (railBeam) railBeam.update(dt);

    // ambience: the room hum, and the tank idling where it stands. The bay
    // tone is deliberately well down in the mix — it is background, not a
    // feature.
    roomSound.update(0.109);
    idleSound.update(0, true);
    aimShafts(camera);
    // the extractor turns over slowly all the time
    for (const spinner of fanBlades) spinner.rotation.y += dt * 5.75;
    // the wall extractors run at half that, and about their own axis
    for (const spinner of ductFans) spinner.rotation.z += dt * 2.875;

    // haze drifts across the bay and breathes very slightly
    hazeTime += dt;
    for (const h of hazePuffs) {
      h.puff.position.x = h.ox + Math.sin(hazeTime * h.rate + h.phase) * h.sway;
      h.puff.position.z = h.oz + Math.cos(hazeTime * h.rate * 0.7 + h.phase) * h.sway * 0.6;
    }

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
    // The deck is solid. A heavy gun's kick used to drive the hull most of a
    // metre down, straight through the platform; the suspension has a bump
    // stop now and the tank simply cannot go below it.
    if (squat < -SQUAT_LIMIT) { squat = -SQUAT_LIMIT; if (squatVel < 0) squatVel = 0; }
    if (squat > SQUAT_LIMIT) { squat = SQUAT_LIMIT; if (squatVel > 0) squatVel = 0; }
    model.root.rotation.z = pitch;
    model.root.rotation.y = FACING; // the springs must never spin it off-axis
    // The deck is solid, so the tank pivots on whichever end is still down
    // and lifts the other — it cannot rotate THROUGH the plate. Rotating
    // about the model origin swings the far end below the deck by
    // halfLength * sin(pitch), which at any useful rock is far more than the
    // squat bump stop was ever going to catch on its own.
    const halfLen = model.hull.hit.bodyX;
    const sag = Math.abs(Math.sin(pitch)) * halfLen;
    model.root.position.set(0, STAND.y + Math.max(squat, sag), 0);

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
    bolt.held = 0;
    bolt.armed = false;
    bolt.suppress = false;
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
    enter, exit, update, fire, orbit, boltState, flingOrbit, applySkin, applyTurret, applyHull, setStream, setTrigger,
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
