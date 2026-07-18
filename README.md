# Tank Remake — prototype 0.5

A from-scratch remake of classic Tanki Online with one core rule: not pay-to-win. Vanilla JS ES modules plus three.js and the Firebase SDK loaded from CDNs — no build step, no dependencies to install. The whole thing deploys as static files.

## Menu

Play holds the future modes (TDM / FFA / CTF — placeholders for now), Settings is a stub, and **Custom** is the working mode: online multiplayer on the arena map for up to 12 players. Create a lobby to get a 4-digit code, or join with a code someone gives you. Only the host can start the match.

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

Everyone drives the same tank: 1000 HP, 100 damage per shell. Projectiles are fast black darts that leave a thin, quickly fading smoke trail. Players spawn spread out on a ring of 12 pads around the central platform — at match start and on every respawn, the game picks the pad farthest from everyone still alive. Death is an explosion into a black smoking husk for 5 seconds, then you're back. Hulls are physics bodies: they climb the ramps, tip and fall off edges under gravity, collide with each other, and use accurate per-shape hitboxes.

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

`index.html` holds the menu markup and HUD; `css/style.css` styles both; `js/main.js` owns phases (menu → lobby → match), the local tank, combat, and the loop; `js/net.js` is the Firebase lobby/state/shot transport; `js/remote.js` mirrors the other players' tanks; `js/menu.js` drives the screens; `js/player.js` is local physics and turret traverse; `js/tank.js` the model, treads, and hitboxes; `js/bullets.js`, `js/fx.js`, `js/audio.js` shells, particles, positional sound; `js/map.js` the arena, platform, spawn ring, and terrain heights; `js/firebase-config.js` your credentials.

## Roadmap ideas

TDM / FFA / CTF, scoring, more hulls/turrets, better maps.
