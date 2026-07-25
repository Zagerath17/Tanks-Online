import * as THREE from 'three';
import { createTankModel, TURRET_SPECS, SKINS } from './tank.js';

// Practice targets for the editor: tanks you can place, shoot, and be shot by.
//
// A hostile dummy tracks you with its turret and fires on a timer; a friendly
// one just sits there and takes it. Both are solid — real physics bodies in
// the remote collision group — so you can drive into them, and both answer
// model.hitTest(), which is all the bullet system needs to score a hit.
const HOSTILE_SKIN = 'crimson';
const FRIENDLY_SKIN = 'forest';

const AIM_RATE = 1.6;      // radians per second of turret traverse
const FIRE_EVERY = 3.2;    // seconds between shots
const RANGE = 70;          // won't bother shooting past this
const HEALTH = 400;

export function createDummies({ scene, physics, fx, audio, bullets }) {
  const list = [];

  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _mp = new THREE.Vector3();
  const _md = new THREE.Vector3();
  const _q = new THREE.Quaternion();

  // SKINS is a list of palette objects, not ids — look the palette up rather
  // than testing membership, or both targets come out the same colour.
  function skinFor(id) {
    return SKINS.find((s) => s.id === id) || SKINS[0];
  }

  // x, z on the ground; friendly ones never shoot
  function add(x, z, heading = 0, friendly = false) {
    const model = createTankModel(
      skinFor(friendly ? FRIENDLY_SKIN : HOSTILE_SKIN),
      'cannon',
      'vanguard'
    );
    model.root.position.set(x, 0, z);
    model.root.rotation.y = heading;
    scene.add(model.root);

    const body = physics.createRemoteBody(model.chassis);
    body.position.set(x, model.chassis.hy - model.chassis.shapeOffY, z);
    body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);

    const unit = {
      id: `dummy-${list.length}-${Math.random().toString(36).slice(2, 7)}`,
      friendly,
      alive: true,
      hp: HEALTH,
      model,
      body,
      heading,
      turretYaw: 0,
      cooldown: 1 + Math.random() * FIRE_EVERY,
      deadT: 0,
    };
    list.push(unit);
    return unit;
  }

  function damage(unit, amount) {
    if (!unit.alive) return;
    unit.hp -= amount;
    if (unit.hp <= 0) {
      unit.alive = false;
      unit.deadT = 0;
      unit.model.setCharred(true);
      unit.model.root.getWorldPosition(_p);
      fx.explosion(_p.clone());
      audio.playAt('explosion', _p, { volume: 1 });
    }
  }

  // targets the bullet system can score against
  function targets() {
    return list.filter((u) => u.alive);
  }

  function update(dt, playerPos, playerAlive) {
    for (const u of list) {
      const root = u.model.root;

      if (!u.alive) {
        u.deadT += dt;
        // smoulder for a while, then get back up so the range stays useful
        if (u.deadT > 6) {
          u.alive = true;
          u.hp = HEALTH;
          u.deadT = 0;
          u.model.setCharred(false);
        } else if (Math.random() < dt * 6) {
          root.getWorldPosition(_p);
          fx.huskSmoke(_p);
        }
        continue;
      }

      // sit on whatever the solver decided
      root.position.set(u.body.position.x, u.body.position.y, u.body.position.z);
      _q.set(u.body.quaternion.x, u.body.quaternion.y, u.body.quaternion.z, u.body.quaternion.w);
      root.quaternion.copy(_q);
      root.position.y -= u.model.chassis.hy - u.model.chassis.shapeOffY;

      if (u.friendly || !playerAlive || !playerPos) {
        u.model.turret.rotation.y = u.turretYaw;
        continue;
      }

      // traverse toward the player, then fire when it's lined up
      _d.copy(playerPos).sub(root.position);
      const dist = Math.hypot(_d.x, _d.z);
      const want = Math.atan2(-_d.z, _d.x) - root.rotation.y;
      let delta = ((want - u.turretYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (delta < -Math.PI) delta += Math.PI * 2;
      const step = Math.min(Math.abs(delta), AIM_RATE * dt) * Math.sign(delta);
      u.turretYaw += step;
      const pitch = Math.atan2(_d.y + 0.6, Math.max(0.5, dist));
      u.model.turret.rotation.y = u.turretYaw;
      u.model.pitchGroup.rotation.z = THREE.MathUtils.clamp(pitch, -0.2, 0.35);

      u.cooldown -= dt;
      if (u.cooldown <= 0 && dist < RANGE && Math.abs(delta) < 0.06) {
        u.cooldown = FIRE_EVERY;
        u.model.muzzle.getWorldPosition(_mp);
        u.model.muzzle.getWorldQuaternion(_q);
        _md.set(1, 0, 0).applyQuaternion(_q);
        bullets.fire(u, _mp.clone().addScaledVector(_md, 0.2), _md.clone(), 'shell');
        fx.muzzleFlash(_mp.clone(), _md.clone(), 'fire');
        audio.playAt('shot', _mp, { volume: 0.9 });
        u.model.pitchGroup.rotation.z -= 0.05; // a token flinch
      }
    }
  }

  function clear() {
    for (const u of list) {
      scene.remove(u.model.root);
      physics.removeBody(u.body);
    }
    list.length = 0;
  }

  function count() {
    return list.length;
  }

  return { add, update, targets, damage, clear, count, list };
}
