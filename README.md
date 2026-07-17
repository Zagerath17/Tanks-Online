# Tank Remake — prototype 0.1

A from-scratch remake of classic Tanki Online with one core rule: not pay-to-win. Vanilla JS ES modules plus three.js loaded from a CDN — no build step, no dependencies to install. The whole thing deploys as static files.

## Controls

W / S drive and reverse, A / D pivot the hull, J / K rotate the turret. The camera hangs behind the turret, Tanki-style, so J/K also swing your view.

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

`index.html` boots everything; `css/style.css` is the HUD; `js/main.js` owns the scene, camera, and loop; `js/tank.js` is the tank model, physics, and tread animation; `js/map.js` builds the arena; `js/controls.js` reads the keyboard; `js/grid-texture.js` generates the procedural grid textures used on both the map and the tank.

## Roadmap ideas

Shooting with muzzle flash (a muzzle anchor already exists on the barrel), health and damage, more hulls/turrets, and Firebase-backed multiplayer.
