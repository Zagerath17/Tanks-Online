import * as THREE from 'three';
import { createTankModel, TURRET_SPECS, SKINS } from './tank.js';
import { createHealthBar } from './fx.js';

// Practice targets for the editor: tanks you can place, shoot, and be shot by.
//
// A hostile dummy tracks you with its turret and fires on a timer; a friendly
// one just sits there and takes it. Both are solid — real physics bodies in
// the remote collision group — so you can drive into them, and both answer
// model.hitTest(), which is all the bullet system needs to score a hit.
const HOSTILE_SKIN = 'crimson';
const FRIENDLY_SKIN = 'forest';

const FIRE_EVERY = 3.2;    // seconds between shots
const HEALTH = 1000; // same as a real hull, so they take a proper beating

export function createDummies({ scene, physics, fx, audio, bullets }) {
  const list = [];

  const _p = new THREE.Vector3();
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

    const bar = createHealthBar();
    bar.sprite.position.set(0, 2.5, 0);
    model.root.add(bar.sprite);

    const unit = {
      bar,
      id: `dummy-${list.length}-${Math.random().toString(36).slice(2, 7)}`,
      friendly,
      // the Aegis picks its lock out of a list of units, so a dummy has to
      // look like one: a live world position, a team, and a health pool it
      // can actually be topped back up into
      pos: new THREE.Vector3(x, 0, z),
      team: friendly ? 0 : 1,
      maxHp: HEALTH,
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

  function heal(unit, amount) {
    if (!unit || !unit.alive) return;
    unit.hp = Math.min(HEALTH, unit.hp + amount);
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
        u.bar.sprite.visible = false;
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

      u.pos.copy(root.position);
      u.bar.set(u.hp / HEALTH);
      u.bar.sprite.visible = true;

      // The turret is welded straight ahead. It does not track you: this is a
      // range target that puts a round down its own centreline on a timer, so
      // where you choose to stand relative to it is your problem. Point one
      // at a friendly and it will shoot that instead — the shells are solid
      // against anything in the target list bar the tank that fired them.
      u.model.turret.rotation.y = 0;
      u.model.pitchGroup.rotation.z = 0;
      if (u.friendly) continue;

      u.cooldown -= dt;
      if (u.cooldown <= 0) {
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

  return { add, update, targets, damage, heal, clear, count, list };
}
