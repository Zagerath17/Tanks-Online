# Tank Remake — prototype 0.9

A from-scratch remake of classic Tanki Online with one core rule: not pay-to-win. Vanilla JS ES modules plus three.js, cannon-es (physics), and the Firebase SDK loaded from CDNs — no build step, no dependencies to install. The whole thing deploys as static files.

## Menu

Play holds the future modes (TDM / FFA / CTF — placeholders for now), Settings is a stub, and **Custom** is the working mode: online multiplayer on the arena map for up to 12 players. Create a lobby to get a 4-digit code, or join with a code someone gives you. Only the host can start the match.

## Editor

The Editor button drops your tank onto a big flat build ground — this is the map-making pipeline for the game. Drive and shoot exactly like a match, or press **F** for the free build cam: WASD flies (Space rises), and the crosshair becomes your placement cursor. **1 / 2 / 3 / 4** pick wall, platform, slope, or **spawn point**; a green ghost previews the piece on whatever surface you're pointing at (they stack, and spawns can sit on top of platforms). **5** is the decal tool — flat rectangular, circular, or triangular markers you paint onto any surface. **Scroll** adjusts length/size, **Shift+Scroll** the second dimension, **Ctrl+Scroll** height — or slope angle (5°–45°) when the slope tool is out. **R** rotates in 15° steps and **Ctrl+R** rotates back the other way (a spawn's arrow is the direction tanks will face; for decals it spins them in place), **LMB** places, **X** deletes the piece — or decal — under the crosshair. **Esc** opens the pause menu (resume, or exit back to the main menu) — it works mid-match too.

Pick a decal's shape and colour from the toolbar: the three shape buttons choose rect / circle / triangle, and the colour swatch opens a full-spectrum HSV wheel (hue by angle, saturation by radius, with a brightness slider beside it). Decals project onto whatever face you point at — walls, platform tops, the sloped face of a ramp — conforming to that surface. They snap to the same grid the solid pieces use but ten times finer, and they are trimmed at the edge of the face they are painted on, so an oversized decal stops at the border of the piece instead of hanging off into the air. They stick to their piece, so deleting the piece takes its decals with it. Everything solid is fully real — the tank climbs it, shells hit it — and once you've placed spawn points, dying or falling off the world respawns you on one of them, so you can playtest spawn placement immediately.

The toolbar along the top saves maps: name the map, **save** it in the browser, **load** any saved map from the list, or **export** it as a `.json` file — that file is the game's map format, and **import** reads one back in. Browser saves survive reloads; exported files are the ones to keep and share.

## Multiplayer setup (one time, ~2 minutes)

Multiplayer syncs through Firebase Realtime Database, which works from any static host on the free tier.

1. Go to console.firebase.google.com → Add project (any name; Analytics off is fine).
2. Build → **Realtime Database** → Create database → start in test mode, or use these rules (Rules tab) to scope writes to lobbies only:

```json
{
  "rules": {
    "lobbies": { ".read": true, ".write": true },
    ".read": false,
    ".write": false
  }
}
```

3. Project settings (gear) → Your apps → Web app (`</>`) → Register.
4. Copy the config object over the placeholders in `js/firebase-config.js`. Make sure `databaseURL` is filled in — grab it from the Realtime Database page if the snippet omits it.

Until the config is filled in, the Custom screen tells you what's missing. Note the test-mode/lobby rules are wide open — fine for playing with friends, not hardened against griefers. Stale lobbies are cheap junk data; clear `/lobbies` from the Firebase console whenever you like.

## Controls

W / S drive and reverse, A / D pivot the hull. Click the canvas to take aim: the crosshair sits fixed at the center of the screen and the camera is locked to it — the view swings anywhere, vertically included. The game finds the exact point under the crosshair (ground, wall, or enemy armor) and the turret converges on it as best it can within its barrel limits, at a limited traverse speed. Left click fires — one shot every 2.5 seconds. Esc releases the mouse.

## The match

Everyone drives the same tank: 1000 HP, 200 damage per shell — five hits and you're scrap. Projectiles are very fast black darts that leave a thin, quickly fading smoke trail. Players spawn spread out on a ring of 12 pads around the central platform — at match start and on every respawn, the game picks the pad farthest from everyone still alive. Death is an explosion into a black smoking husk for 5 seconds, then you're back.

Tanks are real rigid bodies (cannon-es): no forced leveling — momentum carries you off edges, you can tumble, land on your side, and flip over completely. A flipped tank has no drive; stay upside down for 4 seconds and the crew bails — it cooks off and you respawn. Firing recoil is a genuine physics impulse, tank-vs-tank contact is solved by the engine, and everything precompiles during the menu so the first shot of a match doesn't hitch.

## Run it locally

ES modules won't load from `file://`, so serve the folder with any static server and open the printed URL:

```
npx serve .
# or
python3 -m http.server 8000
```

Two browser windows (or a window + a phone on the same deploy) make a quick two-player test.

## Deploy

**GitHub Pages** — push this folder as a repo, then Settings → Pages → "Deploy from a branch" → `main`, root folder. All asset paths are relative, so a repo subpath works.

**Netlify** — "Add new site → Import an existing project" and pick the repo (`netlify.toml` already sets the publish directory, there is no build command), or drag-drop the folder onto the dashboard.

**Firebase Hosting** — `npm i -g firebase-tools`, `firebase login`, then `firebase deploy --only hosting --project YOUR_PROJECT_ID`. Hosting and the Realtime Database can live in the same project you made for multiplayer.

## Structure

`index.html` holds the menu markup and HUD; `css/style.css` styles both; `js/main.js` owns phases (menu → lobby → match), the local tank, combat, and the loop; `js/net.js` is the Firebase lobby/state/shot transport; `js/remote.js` mirrors the other players' tanks; `js/menu.js` drives the screens; `js/player.js` is local physics and turret traverse; `js/tank.js` the model, treads, and hitboxes; `js/bullets.js`, `js/fx.js`, `js/audio.js` shells, particles, positional sound; `js/map.js` the arena, platform, spawn ring, and terrain heights; `js/physics.js` the cannon-es world and colliders; `js/editor.js` the build mode; `js/firebase-config.js` your credentials.

## Roadmap ideas

TDM / FFA / CTF, scoring, more hulls/turrets, better maps.
