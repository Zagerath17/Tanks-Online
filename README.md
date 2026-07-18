# Tank Remake — prototype 0.2

A from-scratch remake of classic Tanki Online with one core rule: not pay-to-win. Vanilla JS ES modules plus three.js loaded from a CDN — no build step, no dependencies to install. The whole thing deploys as static files.

## Controls

W / S drive and reverse, A / D pivot the hull. Click the canvas to take aim: the mouse then steers the turret (with a little barrel elevation up and down) and left click fires — one shot every 3 seconds. Esc releases the mouse. The camera hangs behind the turret, Tanki-style, so aiming swings your view while WASD drives the hull underneath it.

## What's in the arena

A raised platform sits in the middle of the map with a drive-up ramp on each side. A red dummy tank holds the top: 1000 HP, tracks you with its turret, and fires constantly. Shells do 100 damage per hit — you also have 1000 HP. Destroy it and it explodes into a black smoking husk that burns for 5 seconds before it respawns and starts shooting again. The same happens to you.

## Sound

Real layered sound effects, not music: cannon shot, explosion, armor hit, and a diesel engine idle that follows your throttle. The WAVs are generated offline by `tools/make_sfx.py` (pure Python, no dependencies) and shipped in `assets/sfx/` — rerun the script if you want to tweak them.

## Run it locally

ES modules won't load from `file://`, so serve the folder with any static server and open the printed URL:

```
npx serve .
# or
python3 -m http.server 8000
```

## Deploy

**GitHub Pages** — push this folder as a repo, then Settings → Pages → "Deploy from a branch" → `main`, root folder. The site works from a repo subpath because all asset paths are relative.

**Netlify** — "Add new site → Import an existing project" and pick the repo (`netlify.toml` already sets the publish directory, there is no build command), or simply drag-drop this folder onto the Netlify dashboard.

**Firebase Hosting** — `npm i -g firebase-tools`, `firebase login`, create a project in the Firebase console, then `firebase deploy --only hosting --project YOUR_PROJECT_ID`. The included `firebase.json` serves this folder as-is. No Firebase SDK is loaded in-game yet; the Realtime Database enters the picture when multiplayer lands.

## Structure

`index.html` boots everything; `css/style.css` is the HUD; `js/main.js` owns the scene, camera, combat orchestration, and loop; `js/tank.js` is the tank model and tread animation; `js/player.js` drives your hull (including climbing ramps); `js/dummy.js` is the target's turret AI; `js/bullets.js`, `js/fx.js`, `js/audio.js` handle shells, particles, and positional sound; `js/map.js` builds the arena, platform, and terrain height function; `js/controls.js` reads the keyboard; `js/grid-texture.js` generates the procedural grid textures.

## Roadmap ideas

More hulls/turrets, pickups, better maps, and Firebase-backed multiplayer.
