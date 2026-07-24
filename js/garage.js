import * as THREE from 'three';
import { createTankModel } from './tank.js';
import { TURRET_SPECS } from './tank.js';
import { currentSkin, currentTurret } from './loadout.js';

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

  // ---- stand ---------------------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(46, 64),
    new THREE.MeshStandardMaterial({ color: '#2b3037', roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

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

  const key = new THREE.SpotLight('#fff4e0', 260, 60, Math.PI / 5, 0.45, 1.6);
  key.position.set(9, 17, 11);
  key.target.position.set(0, STAND.y + 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  group.add(key, key.target);

  const fill = new THREE.PointLight('#8fb8e8', 55, 44, 2);
  fill.position.set(-11, 7, -9);
  group.add(fill);

  // ---- the tank ------------------------------------------------------------
  const model = createTankModel(currentSkin(), currentTurret());
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

  function muzzle(outPos, outDir) {
    model.muzzle.getWorldPosition(outPos);
    model.muzzle.getWorldQuaternion(_mq);
    outDir.set(1, 0, 0).applyQuaternion(_mq);
  }

  function fire() {
    if (model.hasStream()) return false; // stream weapons fire by holding
    if (cooldown > 0) return false;
    cooldown = FIRE_INTERVAL;
    gunRecoil = 0.22;
    smokeLeft = 2;
    muzzle(_mp, _md);
    bullets.fire({}, _mp.clone().addScaledVector(_md, 0.15), _md.clone());
    fx.muzzleFlash(_mp.clone(), _md.clone());
    audio.playAt('shot', _mp, { volume: 0.9, rate: 0.94 + Math.random() * 0.12 });
    // the whole hull bucks: nose lifts, suspension compresses, both settle
    pitchVel += 2.4;
    squatVel -= 1.1;
    return true;
  }

  function applySkin(skin) {
    model.setSkin(skin);
  }

  function applyTurret(id) {
    model.setTurret(id);
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

  function updateStream(dt) {
    const spec = activeSpec();
    if (!spec) {
      model.setStream(false);
      model.updateStream(dt);
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
    model.setStream(streaming && fuel > 0);
    model.updateStream(dt);
  }

  // ---- per-frame -----------------------------------------------------------
  function update(dt, camera) {
    if (cooldown > 0) cooldown -= dt;
    updateStream(dt);

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
    model.setStream(false);
  }

  return {
    enter, exit, update, fire, orbit, flingOrbit, applySkin, applyTurret, setStream,
    reloadFrac: () => 1 - Math.max(0, cooldown) / FIRE_INTERVAL,
    fuelFrac: () => fuel / 100,
    isStreamWeapon: () => model.hasStream(),
  };
}
