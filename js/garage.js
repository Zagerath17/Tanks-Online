import * as THREE from 'three';
import { createTankModel } from './tank.js';
import { TURRET_SPECS } from './tank.js';
import { currentSkin, currentTurret, currentHull } from './loadout.js';

// The garage: your tank on a lit pedestal, an orbiting camera you drag with
// the mouse, and a gun that fires for real — muzzle flash, smoke, sound, a
// live shell, and a hull that rocks on its suspension. The tank itself never
// leaves the turntable: every recoil motion is a spring that returns to zero.
const STAND = { y: 1.3, radius: 6.4 };
const FIRE_INTERVAL = 2.5;
const CAM = { dist: 12.5, height: 4.6, look: 1.9 };

export function createGarage({ scene, fx, audio, bullets }) {
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

  // hazard stripe ringing the working area
  const ring = new THREE.Mesh(new THREE.RingGeometry(8.2, 8.7, 64), hazard);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  group.add(ring);

  // walls
  const wallGeoLong = new THREE.BoxGeometry(BAY.w, BAY.h, 0.4);
  const wallGeoSide = new THREE.BoxGeometry(0.4, BAY.h, BAY.d);
  for (const [geo, x, z] of [
    [wallGeoLong, 0, -BAY.d / 2], [wallGeoLong, 0, BAY.d / 2],
    [wallGeoSide, -BAY.w / 2, 0], [wallGeoSide, BAY.w / 2, 0],
  ]) {
    const wall = new THREE.Mesh(geo, painted);
    wall.position.set(x, BAY.h / 2, z);
    wall.receiveShadow = true;
    group.add(wall);
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
  for (const [x, z, ry] of [[-5.5, 6.5, 0.4], [5.8, 6.2, -0.5]]) {
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

  // roller shutter at the far end
  const shutter = new THREE.Mesh(new THREE.BoxGeometry(9, 6.4, 0.25), steel);
  shutter.position.set(0, 3.2, BAY.d / 2 - 0.3);
  group.add(shutter);
  for (let i = 0; i < 14; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.32), darkSteel);
    slat.position.set(0, 0.5 + i * 0.45, BAY.d / 2 - 0.42);
    group.add(slat);
  }

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(STAND.radius, STAND.radius + 0.5, STAND.y, 48),
    new THREE.MeshStandardMaterial({ color: '#3b424b', roughness: 0.85, metalness: 0.15 })
  );
  pedestal.position.y = STAND.y / 2;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(STAND.radius + 0.06, 0.07, 10, 64),
    new THREE.MeshStandardMaterial({
      color: '#9cc36e', emissive: '#5d7a3d', emissiveIntensity: 0.7, roughness: 0.5,
    })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = STAND.y + 0.01;
  group.add(rim);

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

  // ---- the tank ------------------------------------------------------------
  const model = createTankModel(currentSkin(), currentTurret(), currentHull());
  model.root.position.set(0, STAND.y, 0);
  group.add(model.root);

  // ---- camera orbit --------------------------------------------------------
  let yaw = Math.PI * 0.78;
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

  // the Aegis has nothing to lock onto in the bay, so it just idles there
  function isBeamWeapon() {
    const s = TURRET_SPECS[model.turretId];
    return !!(s && s.mode === 'beam');
  }

  // the stream weapons need to be audible on the stand too
  const cryoSound = audio.loopOn(model.root, 'cryo');
  const flameSound = audio.loopOn(model.root, 'flame');
  // the bay itself, and the tank ticking over on the stand
  const roomSound = audio.loopOn(group, 'workshop');
  const idleSound = audio.dieselLoop(model.root);

  function fire() {
    if (model.hasStream()) return false; // stream weapons fire by holding
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

    // ambience: the room hum, and the tank idling where it stands
    roomSound.update(1, 0.5);
    idleSound.update(0, true);

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
    // where it started — it rocks, it never drives off the turntable
    pitchVel += (-58 * pitch - 8.5 * pitchVel) * dt;
    pitch += pitchVel * dt;
    squatVel += (-90 * squat - 11 * squatVel) * dt;
    squat += squatVel * dt;
    model.root.rotation.z = pitch;
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
    model.gun.position.x = 0;
    model.root.rotation.set(0, 0, 0);
    model.root.position.set(0, STAND.y, 0);
  }

  function exit() {
    group.visible = false;
    streaming = false;
    triggerHeld = false;
    model.setStream(false);
    cryoSound.update(1, 0);
    flameSound.update(1, 0);
    roomSound.update(1, 0);
    idleSound.update(0, false);
  }

  return {
    enter, exit, update, fire, orbit, flingOrbit, applySkin, applyTurret, applyHull, setStream, setTrigger,
    reloadFrac: () => 1 - Math.max(0, cooldown) / ((gunSpec() || { fireInterval: FIRE_INTERVAL }).fireInterval),
    fuelFrac: () => fuel / 100,
    isStreamWeapon: () => model.hasStream(),
    isBeamWeapon,
    usesCharge: () => {
      const g = gunSpec();
      return model.hasStream() || isBeamWeapon() || !!(g && g.fuelPerShot);
    },
  };
}
