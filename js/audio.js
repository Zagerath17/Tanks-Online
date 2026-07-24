import * as THREE from 'three';

// Real sampled-style WAV effects (generated offline in tools/make_sfx.py),
// played back positionally so distance and direction read naturally.
export function createAudio(camera, scene) {
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const buffers = {};
  const loader = new THREE.AudioLoader();
  for (const name of [
    'shot', 'explosion', 'hit', 'engine', 'engine_drive', 'workshop',
    'cryo', 'flame', 'plasma', 'rail', 'aegis',
  ]) {
    loader.load(`./assets/sfx/${name}.wav`, (b) => { buffers[name] = b; });
  }

  // Browsers keep the AudioContext suspended until a user gesture
  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (listener.context.state === 'suspended') listener.context.resume();
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function playAt(name, pos, { volume = 1, rate = 1, ref = 10 } = {}) {
    const buffer = buffers[name];
    if (!buffer || !unlocked) return;
    const holder = new THREE.Object3D();
    holder.position.copy(pos);
    scene.add(holder);
    const audio = new THREE.PositionalAudio(listener);
    audio.setBuffer(buffer);
    audio.setRefDistance(ref);
    audio.setVolume(volume);
    audio.setPlaybackRate(rate);
    holder.add(audio);
    audio.play();
    audio.source.onended = () => scene.remove(holder);
  }

  // Generic positional loop (engine rumble, cryo stream, ...)
  function loopOn(object3d, name) {
    let audio = null;
    return {
      update(rate, volume) {
        const buffer = buffers[name];
        if (!buffer || !unlocked) return;
        if (!audio) {
          audio = new THREE.PositionalAudio(listener);
          audio.setBuffer(buffer);
          audio.setLoop(true);
          audio.setRefDistance(8);
          object3d.add(audio);
          audio.play();
        }
        audio.setPlaybackRate(rate);
        audio.setVolume(volume);
      },
      stop() {
        if (audio) {
          audio.stop();
          object3d.remove(audio);
          audio = null;
        }
      },
    };
  }

  // The engine is two loops running at once — a lumpy idle and a harder
  // drive note — crossfaded by how hard the tracks are turning. That reads
  // far better than pitching one clip up and down, and it means the tank is
  // always audibly ticking over even at a standstill.
  function dieselLoop(object3d) {
    let idle = null;
    let drive = null;
    let master = 1;

    function attach(name, ref) {
      const buffer = buffers[name];
      if (!buffer || !unlocked) return null;
      const a = new THREE.PositionalAudio(listener);
      a.setBuffer(buffer);
      a.setLoop(true);
      a.setRefDistance(ref);
      a.setVolume(0);
      object3d.add(a);
      a.play();
      return a;
    }

    return {
      setMaster(v) { master = v; },
      // frac: 0 at a standstill, 1 at full track speed
      update(frac, alive) {
        if (!idle) idle = attach('engine', 14);
        if (!drive) drive = attach('engine_drive', 14);
        if (!idle || !drive) return;
        const f = Math.max(0, Math.min(1, frac));
        const on = alive ? 1 : 0;
        // the idle never drops away entirely; the drive note rides on top
        idle.setVolume(master * on * (0.62 - 0.30 * f));
        idle.setPlaybackRate(0.94 + f * 0.22);
        drive.setVolume(master * on * (0.10 + 0.78 * f * f));
        drive.setPlaybackRate(0.82 + f * 0.55);
      },
      stop() {
        for (const a of [idle, drive]) {
          if (a) { a.stop(); object3d.remove(a); }
        }
        idle = null;
        drive = null;
      },
    };
  }

  // Looping engine attached to the player's hull; rate/volume follow speed
  function engineLoop(object3d) {
    let audio = null;
    return {
      update(rate, volume) {
        const buffer = buffers.engine;
        if (!buffer || !unlocked) return;
        if (!audio) {
          audio = new THREE.PositionalAudio(listener);
          audio.setBuffer(buffer);
          audio.setLoop(true);
          audio.setRefDistance(6);
          object3d.add(audio);
          audio.play();
        }
        audio.setPlaybackRate(rate);
        audio.setVolume(volume);
      },
      stop() {
        if (audio) {
          audio.stop();
          object3d.remove(audio);
          audio = null;
        }
      },
    };
  }

  return { playAt, engineLoop, dieselLoop, loopOn };
}
