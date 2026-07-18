import * as THREE from 'three';

// Real sampled-style WAV effects (generated offline in tools/make_sfx.py),
// played back positionally so distance and direction read naturally.
export function createAudio(camera, scene) {
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const buffers = {};
  const loader = new THREE.AudioLoader();
  for (const name of ['shot', 'explosion', 'hit', 'engine']) {
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

  return { playAt, engineLoop };
}
