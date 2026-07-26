import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { heightAt } from './map.js';

// The barrel's real vertical travel — the turret aims within this
export const AIM_PITCH = { min: -0.12, max: 0.17 };

const TURRET_RATE = 2.2; // rad/s traverse — the turret chases the aim
const TURRET_DEADZONE = 0.0025; // rad (~0.14 deg): below this, hold still
const PITCH_RATE = 1.1;

export function createPlayerController(model, physics) {
  // every dimension and speed comes from whichever hull the model is wearing
  let hull = model.hull;
  const body = physics.createChassis(hull.chassis);
  // watched for NaN, runaway velocity and falling out of the world
  physics.guard(body);
  const gravity = physics.world.gravity;

  // called when the garage swaps hulls: new collision box, speeds, offsets
  function syncHull() {
    hull = model.hull;
    physics.reshapeBody(body, hull.chassis);
  }
  let slowMul = 1; // 1 = normal, 0.5 = fully frozen
  let airborne = 0; // seconds since the last confirmed ground contact
  let drive = 0;    // the speed the controller is commanding, in m/s

  const state = {
    v: 0, // measured forward ground speed (HUD, engine)
    tread: 0, // the speed the tracks are turning at — slips against walls
    heading: 0, // hull yaw projected onto the ground plane
    turretYaw: 0,
    pitch: 0,
    slip: 0,         // 0..1 how hard the tracks are sliding sideways
    grounded: false, // drive authority (survives brief contact dropouts)
    contact: false,  // tracks actually touching something this frame
    upright: true,
    flipT: 0, // seconds spent flipped over
  };

  const _q = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _vel = new THREE.Vector3();
  const _off = new THREE.Vector3();
  const _yAxis = new CANNON.Vec3(0, 1, 0);
  const _imp = new CANNON.Vec3();
  const _rel = new CANNON.Vec3();
  const _cn = new THREE.Vector3();
  const _fwdAxis = new THREE.Vector3();
  const _pitchAxis = new THREE.Vector3();

  // seconds after a shot during which the drive controller keeps its hands
  // off the forward velocity, so recoil is something you feel
  const RECOIL_FREE = 0.42;
  // Drift is a function of ACTUAL SPEED, in metres per second — not of how
  // close a tank is to its own top speed. Measuring it as a fraction meant an
  // Ironclad flat out at 7.3 m/s broke traction just as readily as a Falcon
  // doing 14, which is backwards: a slow heavy tank should not be able to do
  // this at all. Below DRIFT_FROM nothing happens, and a hull whose top speed
  // never reaches it simply cannot drift.
  const DRIFT_FROM = 7.6;   // m/s — above an Ironclad's 7.27 top speed
  const DRIFT_FULL = 13.0;  // m/s — a Falcon at full chat
  const DRIFT_LOSS = 0.62;
  // how much of a broadside shot's roll the suspension eats
  const ROLL_ABSORB = 0.82;
  // the hull the weapon kick figures were tuned against
  const RECOIL_REFERENCE_MASS = 6.5;
  const RECOIL_DV_CAP = 3.0;    // m/s of shove a shot may ever impart
  const PITCH_CAP = 0.75;       // rad/s: rears up, doesn't take off
  const RECOIL_LIFT_CAP = 0.6;  // m/s upward the kick may ever impart
  const RECOIL_DAMP = 0.45;     // how much of the damper survives the shot
  let recoilT = 0;



  function syncModel() {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _off.set(0, hull.chassis.modelOffY, 0).applyQuaternion(_q);
    model.root.position.set(
      body.position.x + _off.x,
      body.position.y + _off.y,
      body.position.z + _off.z
    );
    model.root.quaternion.copy(_q);
  }

  function reset(spawn) {
    const gy = spawn.y !== undefined ? spawn.y : heightAt(spawn.x, spawn.z);
    body.position.set(spawn.x, gy - hull.chassis.modelOffY + 0.06, spawn.z);
    body.quaternion.setFromAxisAngle(_yAxis, spawn.heading);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.wakeUp();
    state.v = 0;
    state.tread = 0;
    state.heading = spawn.heading;
    state.turretYaw = 0;
    state.pitch = 0;
    state.flipT = 0;
    airborne = 0;
    recoilT = 0;
    drive = 0;
    slowMul = 1;
    model.gun.position.x = 0;
    model.turret.rotation.y = 0;
    model.pitchGroup.rotation.z = 0;
    syncModel();
  }

  // Recoil: a modest backward shove plus a real rock of the hull. The old
  // version was pure linear velocity, which the drive controller read as
  // "briefly reversing" — this pitches the nose up around the axis
  // perpendicular to the shot, so the whole tank visibly bucks.
  function applyRecoil(dir, scale = 1, worldPoint = null) {
    const dh = Math.hypot(dir.x, dir.z) || 1;
    // A gun delivers the same impulse whatever it is bolted to, so recoil is a
    // fixed figure in the weapon's own terms rather than mass * scale — which
    // cancelled the mass out and gave every hull an identical shove. Referenced
    // to the Vanguard, so that hull feels exactly as it did.
    //
    // The resulting change in speed is capped, though: a light hull firing a
    // heavy gun would otherwise be thrown most of its top speed backwards. The
    // cap keeps the ordering (heavier really does resist more) while standing
    // in for the crew and suspension soaking up the worst of it.
    const wanted = (RECOIL_REFERENCE_MASS * scale) / body.mass;
    const kick = Math.min(wanted, RECOIL_DV_CAP) * body.mass;
    _imp.set(-dir.x / dh * kick, 0, -dir.z / dh * kick);
    if (worldPoint) {
      // Apply it where the gun actually is. The muzzle sits forward of and
      // well above the centre of mass, so the torque that stands the tank up
      // on its rear idlers falls out of the physics instead of being faked
      // with a hand-picked angular velocity.
      _rel.set(
        worldPoint.x - body.position.x,
        worldPoint.y - body.position.y,
        worldPoint.z - body.position.z
      );
      body.applyImpulse(_imp, _rel);
    } else {
      body.applyImpulse(_imp);
    }
    // A tank fired broadside leans on its suspension and settles; it does not
    // roll like a boat. The physical impulse produces far more roll than that
    // because the hull is a rigid box with no springs in it, so the component
    // of the kick that spins the tank about its own FORWARD axis is mostly
    // taken back out. Pitch (nose-up) is left alone — that part should read.
    _fwdAxis.set(1, 0, 0).applyQuaternion(
      _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
    );
    const av = body.angularVelocity;
    const roll = av.x * _fwdAxis.x + av.y * _fwdAxis.y + av.z * _fwdAxis.z;
    const shed = roll * ROLL_ABSORB;
    av.x -= _fwdAxis.x * shed;
    av.y -= _fwdAxis.y * shed;
    av.z -= _fwdAxis.z * shed;

    // Pitch is the component that reads, but it also has the longest lever:
    // the muzzle is metres forward of the centre of mass and well above it,
    // so a shot straight down the hull's axis puts everything into pitch and
    // used to throw the whole tank off the ground. Cap the rate so it rears
    // and settles instead of launching. (Firing across the hull barely
    // touches pitch, which is why only forward and back shots bucked.)
    _pitchAxis.set(0, 0, 1).applyQuaternion(_q);
    const pitch = av.x * _pitchAxis.x + av.y * _pitchAxis.y + av.z * _pitchAxis.z;
    // The cap is a safety limit, not the effect. It scales with the hull — a
    // lighter tank is allowed to rock further — but only on a square root and
    // within hard bounds, or a Falcon's ceiling ends up high enough to let a
    // shot flip it.
    const cap = THREE.MathUtils.clamp(
      PITCH_CAP * Math.sqrt(RECOIL_REFERENCE_MASS / body.mass), 0.4, 1.05
    );
    const over = Math.abs(pitch) - cap;
    if (over > 0) {
      const trim = Math.sign(pitch) * over;
      av.x -= _pitchAxis.x * trim;
      av.y -= _pitchAxis.y * trim;
      av.z -= _pitchAxis.z * trim;
    }

    // and never let a shot fling the hull upward off its tracks
    const liftCap = THREE.MathUtils.clamp(
      RECOIL_LIFT_CAP * Math.sqrt(RECOIL_REFERENCE_MASS / body.mass), 0.35, 0.9
    );
    if (body.velocity.y > liftCap) body.velocity.y = liftCap;

    // let the shove actually land: the drive controller is suppressed for a
    // moment so it does not immediately cancel the recoil velocity
    recoilT = RECOIL_FREE;
  }

  // Ground drag for a hull nobody is driving — a dead husk or a tank lying on
  // its roof. Contact friction is zero by design (see physics.js), so without
  // this the wreck would skate away across the arena forever.
  function scrub(dt) {
    const k = Math.min(1, hull.move.scrub * dt);
    const vel = body.velocity;
    vel.x -= vel.x * k;
    vel.z -= vel.z * k;
    if (vel.y > 0) vel.y -= vel.y * k; // never fight gravity, only bounce
    const av = body.angularVelocity;
    av.x -= av.x * k;
    av.y -= av.y * k;
    av.z -= av.z * k;
  }

  // Bleed off pitch and roll rate — everything that is NOT yaw about the
  // hull's own up axis — while the tracks are down. This is what stops a
  // nudge from an edge or another tank from winding up into a somersault,
  // without touching how the tank behaves once it is actually airborne.
  // scale lets the recoil window damp partially rather than not at all
  function dampTumble(dt, scale = 1) {
    const av = body.angularVelocity;
    const k = Math.min(1, hull.move.stabilize * scale * dt);
    const upComp = av.x * _up.x + av.y * _up.y + av.z * _up.z;
    av.x -= (av.x - _up.x * upComp) * k;
    av.y -= (av.y - _up.y * upComp) * k;
    av.z -= (av.z - _up.z * upComp) * k;
  }

  // Pre-physics: read input, steer the body. The solver owns everything
  // else — slopes, edges, tumbling, and coming to rest upside down.
  function update(dt, input, aimWorldYaw, aimPitch) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _fwd.set(1, 0, 0).applyQuaternion(_q);
    _right.set(0, 0, 1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);

    // coyote time: keep drive authority through brief contact dropouts
    // (cresting a ramp, rolling over a seam) instead of going inert
    const touching = physics.groundedAt(body.position, hull.chassis.groundReach, body);
    if (touching) airborne = 0;
    else airborne += dt;
    state.grounded = airborne < 0.16;
    state.contact = touching;
    state.upright = _up.y > 0.55;
    if (_up.y < 0.25) state.flipT += dt;
    else state.flipT = 0;

    const vel = body.velocity;
    _vel.set(vel.x, vel.y, vel.z);
    const measured = _vel.dot(_fwd);

    if (state.grounded && state.upright) {
      // The commanded speed lives here, not on the body. Reading it back off
      // the body each frame meant anything that bled velocity (a scrape, a
      // landing) also erased the throttle's progress.
      if (input.throttle > 0) {
        drive += (drive < 0 ? hull.move.brakeAccel : hull.move.accel) * slowMul * dt;
      } else if (input.throttle < 0) {
        drive -= (drive > 0 ? hull.move.brakeAccel : hull.move.accel) * slowMul * dt;
      } else {
        const d = hull.move.drag * dt;
        drive = Math.abs(drive) <= d ? 0 : drive - Math.sign(drive) * d;
      }
      drive = THREE.MathUtils.clamp(drive, -hull.move.maxReverse * slowMul, hull.move.maxForward * slowMul);

      // but stay honest about walls: bleed the command toward what the body
      // is actually managing, so the tracks spin against an obstacle instead
      // of the command running away to top speed
      drive += (measured - drive) * Math.min(1, hull.move.slipRate * dt);

      // Gravity the solver is about to add along the tread plane. Cancelling
      // it is what lets the tank sit still on a ramp: without this it inherits
      // a fresh downhill nudge every step and creeps to the bottom. Only when
      // the tracks are really down, so coyote time can't turn into hovering.
      const gF = touching ? gravity.x * _fwd.x + gravity.y * _fwd.y + gravity.z * _fwd.z : 0;
      const gR = touching ? gravity.x * _right.x + gravity.y * _right.y + gravity.z * _right.z : 0;

      // Cap the per-step correction. Pinned against a wall the gap between
      // commanded and actual can be the full top speed, and dumping that into
      // the body every frame makes the contact solver jitter.
      const maxStep = (hull.move.accel + hull.move.brakeAccel) * dt;
      const dvF = THREE.MathUtils.clamp(drive - measured - gF * dt, -maxStep, maxStep);
      vel.x += _fwd.x * dvF;
      vel.y += _fwd.y * dvF;
      vel.z += _fwd.z * dvF;

      // --- lateral grip, and losing it ---------------------------------
      //
      // Grip used to be a flat rate that scrubbed all sideways motion away in
      // a fraction of a second, so a tank could never slide: there was no
      // drift at any speed on any hull. Real tracks break away once the
      // sideways load gets high enough, and a light hull breaks away sooner
      // than a heavy one.
      //
      // Sideways demand is what the turn is asking of the tracks — turn rate
      // times forward speed. Past the hull's break-away figure, grip falls
      // off, the tank slides, and it keeps sliding until it slows or
      // straightens up.
      const vLat = _vel.dot(_right);
      const avUpNow = body.angularVelocity.x * _up.x
        + body.angularVelocity.y * _up.y
        + body.angularVelocity.z * _up.z;
      const speed = Math.abs(measured);
      // Absolute load, and a hard floor on speed: a tank pottering about can
      // never break traction however hard it is turned.
      const demand = speed < hull.move.driftFloor ? 0 : Math.abs(avUpNow * speed);
      const over = demand / hull.move.breakAway;
      // 1 while planted, easing to the hull's minimum grip once it lets go
      const slide = over <= 1 ? 1 : Math.max(hull.move.slideGrip, 1 / over);
      state.slip = Math.min(1, Math.abs(vLat) / 2.6);
      const dvR = -(vLat * Math.min(1, hull.move.gripRate * slide * dt) + gR * dt);
      vel.x += _right.x * dvR;
      vel.y += _right.y * dvR;
      vel.z += _right.z * dvR;

      // A slide COSTS speed. Sideways motion used to simply persist, so the
      // total velocity grew and drifting read as a boost; and nothing bled it
      // off, so a slide never settled. Scrubbing the commanded speed while
      // the tracks are sideways is what makes a drift a compromise rather
      // than a shortcut.
      if (state.slip > 0.02) {
        const scrub = hull.move.slideScrub * state.slip * dt;
        drive -= Math.sign(drive || 1) * Math.min(Math.abs(drive), scrub);
        // and take it out of what the hull is really doing, so the tank
        // genuinely washes off speed through the corner
        const bleed = Math.min(1, 0.9 * state.slip * dt);
        vel.x -= vel.x * bleed;
        vel.z -= vel.z * bleed;
      }

      // pivot: steer angular velocity about the hull's own up axis
      const av = body.angularVelocity;
      const avUp = av.x * _up.x + av.y * _up.y + av.z * _up.z;
      const dAv = (input.turn * hull.move.turnRate * slowMul - avUp) * Math.min(1, hull.move.turnResponse * dt);
      av.x += _up.x * dAv;
      av.y += _up.y * dAv;
      av.z += _up.z * dAv;

      // The tumble damper normally stops a clipped edge winding up into a
      // somersault, and it would also flatten the rear-up from a heavy gun.
      // It used to be switched off entirely while the recoil landed — which
      // left the hull pitching unopposed for the best part of half a second,
      // digging its rear in hard enough that the contact solver threw the
      // whole tank into the air. Easing it off instead keeps the rear-up
      // readable and still lets the shot settle.
      if (touching) dampTumble(dt, recoilT > 0 ? RECOIL_DAMP : 1);
    } else {
      drive = measured; // airborne or flipped: the body is on its own
      if (touching) scrub(dt); // ...but a hull on its roof still drags
    }
    state.v = measured; // what the tank is really doing, for HUD and engine
    state.tread = drive; // what the tracks are trying to do

    // --- turret chases the crosshair point within its own limits ----------
    if (Math.hypot(_fwd.x, _fwd.z) > 0.15) {
      state.heading = Math.atan2(-_fwd.z, _fwd.x);
    }
    // The turret traverses whatever attitude the hull is in. On your roof the
    // gun still slews and elevates, so a weapon with real recoil can be fired
    // into the ground to flip yourself back over.
    {
      const relTarget = aimWorldYaw - state.heading;
      const yawErr = Math.atan2(
        Math.sin(relTarget - state.turretYaw),
        Math.cos(relTarget - state.turretYaw)
      );
      // a frozen tank swings its turret sluggishly too
      const traverse = TURRET_RATE * slowMul * dt;
      // Anything smaller than a sliver of one frame's traverse is noise in the
      // aim solution, not an intent to move. Chasing it made the turret buzz
      // while the hull was turning underneath it.
      if (Math.abs(yawErr) > TURRET_DEADZONE) {
        state.turretYaw += THREE.MathUtils.clamp(yawErr, -traverse, traverse);
      }
      state.turretYaw = Math.atan2(Math.sin(state.turretYaw), Math.cos(state.turretYaw));
      const pt = THREE.MathUtils.clamp(aimPitch, AIM_PITCH.min, AIM_PITCH.max);
      const elevate = PITCH_RATE * slowMul * dt;
      state.pitch += THREE.MathUtils.clamp(pt - state.pitch, -elevate, elevate);
    }
    model.turret.rotation.y = state.turretYaw;
    model.pitchGroup.rotation.z = state.pitch;

    // --- treads (counter-rotate on pivot turns) ---
    // driven by the commanded speed, so the tracks visibly slip when the hull
    // is held up by a wall
    const av = body.angularVelocity;
    const yawRate = av.x * _up.x + av.y * _up.y + av.z * _up.z;
    model.updateTreads(dt, state.tread - yawRate * hull.move.halfTrack, state.tread + yawRate * hull.move.halfTrack);
  }

  // Called instead of update() when the tank is dead: no input, no traction,
  // just a wreck settling. Keeps the husk from sliding on frictionless ground.
  function coast(dt) {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    _up.set(0, 1, 0).applyQuaternion(_q);
    if (physics.groundedAt(body.position, hull.chassis.groundReach, body)) scrub(dt);
    drive = 0;
    state.v = 0;
    state.tread = 0;
    model.updateTreads(dt, 0, 0);
  }

  // No part of the hull may end a step below the ground. cannon-es resolves
  // penetration over several frames, which is fine for gentle contact but not
  // for a railgun's recoil — a hard enough impulse buries a corner of the
  // tank in the floor for long enough to see. This checks the four bottom
  // corners of the chassis box against the surface underneath and lifts the
  // body out. It can only ever push UP, so it cannot cause sinking itself.
  // Only SHALLOW penetration counts. The probe starts a few centimetres above
  // each corner and reaches barely further than that, so a corner buried in
  // the FLANK of a slope finds no surface within range and is left for the
  // solver to push out sideways. Probing from high above instead found the
  // slope's top face and lifted the whole tank onto it — which is exactly the
  // "clips in, then teleports above it" behaviour.
  const CLAMP_TOL = 0.012;  // ignore contact-solver noise
  const CLAMP_MAX = 0.10;   // deepest lift accepted as ground penetration
  const CLAMP_UP = 0.06;    // how far above the corner the probe starts
  function clampToGround() {
    _q.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    const c = model.chassis;
    const bottom = c.shapeOffY - c.hy;
    let worst = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _cn.set(sx * c.hx, bottom, sz * c.hz).applyQuaternion(_q);
        const wx = body.position.x + _cn.x;
        const wy = body.position.y + _cn.y;
        const wz = body.position.z + _cn.z;
        const gy = physics.surfaceY(wx, wy + CLAMP_UP, wz, CLAMP_UP + CLAMP_MAX);
        if (gy !== null && wy < gy - CLAMP_TOL) worst = Math.max(worst, gy - wy);
      }
    }
    if (worst > 0) {
      body.position.y += Math.min(worst, CLAMP_MAX);
      if (body.velocity.y < 0) body.velocity.y = 0;
    }
  }

  // Post-physics: pull the solved transform onto the visual model
  function postStep() {
    clampToGround();
    syncModel();
  }


  return {
    state, body, update, coast, postStep, reset, applyRecoil, syncHull,
    setSlow(mul) { slowMul = Number.isFinite(mul) ? Math.min(1, Math.max(0.35, mul)) : 1; },
  };
}
