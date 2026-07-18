# Tank Remake — prototype 0.3

A from-scratch remake of classic Tanki Online with one core rule: not pay-to-win. Vanilla JS ES modules plus three.js loaded from a CDN — no build step, no dependencies to install. The whole thing deploys as static files.

## Controls

W / S drive and reverse, A / D pivot the hull. Click the canvas to take aim: the mouse then steers the turret and left click fires — one shot every 2.5 seconds. Esc releases the mouse. The turret has a limited traverse speed, so the crosshair (which marks exactly where the barrel is pointing) swings to catch up when you whip the mouse around. Barrel elevation is minimal, so the mouse is limited vertically.

## What's in the arena

A raised platform sits in the middle of the map with a drive-up ramp on each side. An identical enemy tank holds the top: 1000 HP with a floating health bar, firing straight ahead on its interval — it doesn't track you, so its lane is the dangerous place to be. Shells do 100 damage per hit; you also have 1000 HP. Destroy it and it explodes into a black smoking husk that burns for 5 seconds before it respawns and starts shooting again. The same happens to you.

Hit detection uses the tanks' real shapes (hull box plus a rotating turret box), and the hulls follow the terrain properly — climbing ramps, tipping over crests, never sinking into the geometry — and can't drive through each other.

## Sound

Real layered sound effects, not music: cannon shot, explosion, a heavy armor-plate clank on hits, and a diesel engine idle that follows your throttle. The WAVs are generated offline by `tools/make_sfx.py` (pure Python, no dependencies) and shipped in `assets/sfx/` — rerun the script if you want to tweak them.

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

`index.html` boots everything; `css/style.css` is the HUD; `js/main.js` owns the scene, camera, combat orchestration, and loop; `js/tank.js` is the tank model, tread animation, and hitboxes; `js/player.js` drives your hull (terrain contact, turret traverse); `js/bullets.js`, `js/fx.js`, `js/audio.js` handle shells, particles, and positional sound; `js/map.js` builds the arena, platform, and terrain height function; `js/controls.js` reads the keyboard; `js/grid-texture.js` generates the procedural grid textures.

## Roadmap ideas

More hulls/turrets, pickups, better maps, and Firebase-backed multiplayer.
