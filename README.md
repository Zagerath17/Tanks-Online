# Tank Remake — prototype 0.55

A from-scratch remake of classic Tanki Online with one core rule: not pay-to-win. Vanilla JS ES modules plus three.js, cannon-es (physics), and the Firebase SDK loaded from CDNs — no build step, no dependencies to install. The whole thing deploys as static files.

## Menu

Play holds the future modes (TDM / FFA / CTF — placeholders for now), Settings is a stub, and **Custom** is the working mode: online multiplayer on the arena map for up to 12 players. Create a lobby to get a 4-digit code, or join with a code someone gives you. Only the host can start the match.

## Flechette

A shotgun. One pull throws a tight cone of 26 darts at 20 damage each — 520 if the whole group lands — from a short, very wide bore fed by a drum across the breech. The darts are spent by 40 m, so it is devastating in someone's face and useless across the arena. About two metres of group at twenty metres.

## Thunderbolt

A heavy assault gun that goes off when you **let go**, not when you press. Tap it and the round leaves on the release for 350, with two seconds between shots. Hold the trigger for three seconds instead and it banks the shot rather than throwing it — nothing fires on that release, the wide bottom bar — the same one the stream weapons use — goes a deep ember red, and the *next* shot is a 600. That one costs three seconds to recover from and kicks exactly twice as hard as a normal round — heavier than anything else on the roster bar the railgun, which still just edges it. Its round is 35% quicker off the muzzle than the Striker's shell, so it leads less at range.

## HUD

Hull strength sits bottom left as well as under the crosshair. Beside the crosshair a running tally shows what you are doing to people: damage in red, health in green. Both accumulate while the hits keep landing and clear a moment after they stop, so a burst reads as one number. The Aegis puts both up at once — the burn in red, the health it steals back and the health it hands a team mate in green.

## Cover

Walls, slopes and platforms stop shots. Shells and darts always did; the railgun's lance is now cut short at the first thing in its way, the streams stop dead against it — the cone itself is re-cut to end at the wall, keeping its true taper rather than being squashed, and throws spray back off the surface, and the Aegis needs line of sight before it can take hold of anyone — no reaching through a wall. Anything that lands on solid ground leaves a burn mark lying flat against whatever it hit, wall or floor or ramp, which fades away over ten seconds.

## Practice targets

In the editor, **6** and **7** select the hostile and friendly target tools; a tank-shaped ghost shows where it will land and left click places it, exactly like a wall or a slope. **8** clears them all. Every tank on the field carries a health bar above it, targets included. The hostile one's turret is welded straight ahead: it does not track you, it just puts a round down its own centreline every three seconds, so where you stand relative to it is your problem. Those rounds are solid against anything but the tank that fired them, so it will hit you or a friendly target alike. The Aegis works on them too — lock a friendly one and it heals, lock a hostile one and it burns it down. Both are solid — you can drive into them — and both carry a full 1000 hull, take damage properly, brew up when killed, and pick themselves back up a few seconds later so the range stays useful. They vanish when you leave the editor.

## Garage

A working tank bay with the roller door standing open at the far end. Daylight pours through the opening, throws a pool across the concrete and rim-lights the tank from the front, and the shutter's curtain is coiled on its drum overhead. The shafts of light are soft-edged all round and roll about the sun's own axis to face you as you orbit, so they never flatten into cards or leave a seam where they cross the floor. Inside: a gantry crane on rails with the hook slung over the stand, strip lights under exposed roof beams, benches with pegboards and tools, parts racks, oil drums, stacked spare track links, a barrel up on trestles and toolbox trolleys. Overhead there are painted steel deck panels between the beams, cable trunking on hangers, a red sprinkler main with its heads, and a five-bladed extractor fan turning slowly over the middle of the bay inside its guard cage. The walls are painted steel panelling, the floor poured concrete, the platform chequer plate, and every fitting on the walls — ribs, pipe runs, ducting, junction boxes, the extinguisher board — is textured steel rather than flat colour. The bay floor is laid in worn two-metre concrete slabs and the platform is chequer plate, with the tank's own tracks worn into the floor where it drove in off the apron and up the ramp. The walls carry ribbed panelling and kick plates, ducting and pipe runs high up, consumer units on dropped conduit, wall cabinets, a notice board, fire points, a hose reel, a caged inspection lamp, a ladder to the gantry, extractor fans in the back wall and clerestory windows letting a little daylight in. Tracks are worn into the floor everywhere — the current tank's route in off the apron and up the ramp, plus older lanes criss-crossing from everything that's been through before. The room hums quietly under everything — extractor fans, a compressor line and the odd distant clank of tools, all of it tuneless by design: no mains-hum chord, and the clanks are noise driven through inharmonic resonances so they land as struck metal rather than as notes. Your tank sits there idling with exhaust haze drifting off the deck.

The tank stands on a welded steel service platform: plated deck, channel edge beams, corner legs, hazard nosing, and a ramp at each end — one out the back of the bay, one toward the door — so it can be driven straight in off the apron, up onto the deck and out the other side. It faces the open door, nose out, ready to roll. Drag anywhere to spin the camera around it, and click (or hit space) to actually fire — full muzzle flash, smoke, sound, a live shell downrange, and the hull rearing back on its suspension. The recoil is spring-driven, so the tank rocks hard and settles back to exactly where it stood; it never drifts off the deck.

Every weapon test-fires on the stand, not just the shell guns, and the Thunderbolt charges there exactly as it does in a match: the stream weapons pour while you hold, the plasma repeater runs on its charge bar, the railgun spins up on a tap and lets its lance go down the bay, and the Aegis powers up and cracks across its prongs — with nothing in the bay to lock onto it does exactly what it does under an empty sky, burning charge and holding no lifeline.

The bar along the bottom has three tabs. **Turrets** lists nine slots — Cannon and **Arctic Snap** work today, the rest are reserved. **Hulls** lists six, three of them working: **Vanguard** is the standard chassis at 1000 hull; **Pioneer** is a compact scout — smaller in every dimension, 800 hull, 20% quicker; **Falcon** is smaller again at 650 hull and another 12% on top of that, a stripped-down runner on four tight road wheels; **Paladin** goes the other way — a heavy chassis at 1250 hull, 10% slower, larger in every dimension, riding on six road wheels and a third return roller; and **Ironclad** is the heaviest of the lot at 1500 hull, slower again, on seven road wheels and the widest track the arena ramps will take.

The five working hulls span 1.8x in length, 2.3x in health and 1.8x in speed:

| hull | hull points | mass | top speed | size (L x W x H) |
| --- | --- | --- | --- | --- |
| Ironclad | 1500 | 13.5 t | 7.27 | 6.30 x 3.84 x 1.48 |
| Paladin | 1250 | 8.6 t | 8.55 | 5.36 x 3.34 x 1.28 |
| Vanguard | 1000 | 6.5 t | 9.50 | 4.90 x 3.02 x 1.16 |
| Pioneer | 800 | 4.5 t | 11.40 | 4.20 x 2.74 x 1.02 |
| Falcon | 650 | 3.1 t | 14.04 | 3.50 x 2.56 x 0.90 | A hull carries its own silhouette, tread layout, hit boxes, collision body, health pool and top speed, all derived from its own model so they can never disagree. **Skins** are all live: sixteen repaints — eight military finishes plus a full ROYGBIV set and black, each with its own colour scheme and grid pattern. Everything you pick applies instantly to the tank on the stand, carries into matches and the editor, is visible to other players online, and is remembered between sessions.

## Arctic Snap

A cryo projector: finned heat-exchanger barrel, twin coolant bottles, a flared nozzle. Instead of shells it pours a blizzard about a tank and a half in front of you — three layered noise-shaded cone shells with ice motes tumbling through them, so the plume has real depth and never repeats.

Hold fire to pour. A thin bar at the bottom middle of the screen is your charge: it drains over about ten seconds of continuous stream and starts refilling the instant you release, taking around eighteen seconds to come back. The stream does 100 damage a second in tenth-second ticks, and freezes what it touches — the slow builds gradually, reaching its full 50% after roughly three seconds of unbroken contact — it slows driving, hull pivot, and turret traverse alike, and a frozen tank turns visibly blue in proportion to how frozen it is. Break contact and the ice holds for a couple of seconds before thawing at the same rate it built.

## Torrential Inferno

The Arctic Snap's opposite number: a flamethrower with an armoured fuel drum across the back, heat-shielded flanks, a wide-bore barrel and igniter prongs ringing a pilot flame. Same fuel bar, same range, same hold-to-pour handling — but it hits for 60 a second in tenth-second ticks and sets tanks alight.

The burn builds exactly like the freeze does: a few seconds of unbroken contact to reach full, holding a couple of seconds after you break off before it cools at the rate it came on. While it's alight it keeps eating hull on its own — at full burn, 20% of the flamethrower's own output, so 12 a second — so a solid burn keeps working long after you've stopped firing. Burning tanks glow red in proportion to how alight they are and throw embers.

It sounds nothing like the Arctic Snap either, which took some doing: both loops started life as filtered noise under a smooth tremolo, which is a recipe for wind whichever way you tilt it. The Inferno is built instead around what actually identifies fire — dense irregular crackle, gusting driven by random contours rather than sine waves, and a resonant low throat over a pressurised gas jet — and it deliberately stays out of the midrange band where the blizzard howls.

## Dual Plasma

Twin emitters set wide apart, fed from a charged accumulator sphere cradled between them, with a capacitor bank on the roof and acceleration coils stepping down each barrel. The barrels alternate: hold the trigger and it pours out a bolt every eighth of a second, each side firing four times a second. It runs off a charge bar like the stream weapons — about three seconds of continuous fire, then roughly nine to build back.

The bolts are layered — an unlit blazing core inside a pulsing plasma shell, a soft halo, and a billboarded corona, shedding glowing motes as they fly. They travel at half the cannon shell's speed, fly perfectly flat with no drop, and burn out at 70 m. Each one does 25 damage, and impacts burst blue instead of orange.

## Tracks and dust

Tanks throw up grey dust behind their tracks as they drive — concrete grit, not soil, and sized so it reads as dust rather than as fog over the ground — and press tread marks into the ground behind them. Firing broadside leans the tank on its tracks rather than rolling it like a boat: most of the roll a rigid box would take from an off-centre impulse is absorbed, while the nose-up from firing forward is left alone. Each mark is laid along the direction that track actually travelled and pitched onto whatever slope it crossed, so consecutive stamps share an edge instead of pivoting about their own centres — a turn reads as a curve rather than a run of blocks, and marks lie on a ramp instead of hovering flat above it. Nothing is drawn while the tank is off the ground. Each track paces itself against the ground it personally covered, so in a turn the inside lays fewer marks and the outside more — neither rail bunches up or pulls apart at any steering angle. Each mark is one imprint three links long, with the grouser bars lying **across** the track the way real links land, laid under both tracks and spaced by distance covered rather than by frame, so the trail is continuous at any frame rate and at any hull's top speed. They hold for twenty seconds before fading away.

## Aegis Emitter

A squat emitter body carrying two heavy prongs set wide apart on a brass yoke, one either side of the barrel line, with a permanent electric arc jumping the gap between their tips. The arc is a real three-dimensional bolt — three nested tubes that writhe and stay pinned to both electrodes — so it reads the same from any angle instead of turning edge-on as you orbit. The brass gear — yoke, feed lines, tips and cones — keeps its finish on every skin; the deck above the breech is bare. The arc sits yellow at rest. Hold the trigger and the emitter powers up whether or not anything is in range — it burns charge, hums, and the arc pulses hard across the gap. When it does find someone, a lifeline strikes from the gap to whichever tank sits closest to your aim — built from the same nested tubes as the arc across the prongs, so it holds its shape from any angle instead of swinging about as a flat card, inside a 24-degree cone out to 26 m, and holds the lock until it drifts well outside.

On a teammate both arcs run green and it mends 50 health a second. On an enemy they run red, draining 75 a second and feeding a fifth of that back into your own hull. Both tick ten times a second, and it runs off the same charge bar as the other sustained weapons.

Because it needs to tell friend from foe, players in a Custom lobby are now alternated onto two sides as they join, shown in the lobby list.

## Railgun

A tall mount carrying a very long twin-rail barrel, flanked by capacitor towers. Tap the trigger and it spins up for a second — you don't need to keep holding — the accelerator rings turn and the capacitor bands, the tower caps and the muzzle core all brighten — seventeen times over, and a translucent shell blooms in the air around each of them. They get brighter, never whiter: the blue holds all the way up. Nothing swells or changes size; the energy shows as light. Then it releases an instant blue lance 120 m long. The shot **pierces**: the first tank takes 650, the next 500, then 350, 200, 50. Then seven seconds on the bar before it will fire again.

## Editor

The Editor button drops your tank onto a big flat build ground — this is the map-making pipeline for the game. Drive and shoot exactly like a match, or press **F** for the free build cam: WASD flies (Space/Shift for up and down), and the crosshair becomes your placement cursor. **1 / 2 / 3 / 4** pick wall, platform, slope, or **spawn point**; a green ghost previews the piece on whatever surface you're pointing at (they stack, and spawns can sit on top of platforms). **5** is the decal tool — flat rectangular, circular, or triangular markers you paint onto any surface. **Scroll** adjusts length/size, **Shift+Scroll** the second dimension, **Ctrl+Scroll** height — or slope angle (5°–45°) when the slope tool is out. **R** rotates in 15° steps (a spawn's arrow is the direction tanks will face; for decals it spins them in place), **LMB** places, **X** deletes the piece — or decal — under the crosshair.

Pick a decal's shape and colour from the toolbar: the three shape buttons choose rect / circle / triangle, and the colour swatch opens a full-spectrum HSV wheel (hue by angle, saturation by radius, with a brightness slider beside it). Decals are projected and clipped against the piece itself, so they wrap the surface exactly — flush with no gap, never hanging off an edge or a slope — and they stick to their piece, so deleting the piece takes its decals with it. Placement snaps to the half-unit grid, and every surface (ground, walls, platforms, slopes) shares the same aligned one-unit grid texture. Everything solid is fully real — the tank climbs it, shells hit it — and once you've placed spawn points, dying or falling off the world respawns you on one of them, so you can playtest spawn placement immediately.

The toolbar along the top saves maps: name the map, **save** it in the browser, **load** any saved map from the list, or **export** it as a `.json` file — that file is the game's map format, and **import** reads one back in. Browser saves survive reloads; exported files are the ones to keep and share.

## Firebase setup (one time, ~5 minutes)

Accounts and multiplayer both run on Firebase, free tier, no server of your own. Do all of this once.

### 1. Create the project
console.firebase.google.com → **Add project**. Any name. Analytics can be off.

### 2. Turn on email accounts
Build → **Authentication** → Get started → **Sign-in method** → enable **Email/Password**. Leave "Email link" off; the game uses passwords.

Firebase sends the verification and password-reset emails itself, from a `firebaseapp.com` address. If you want them to come from your own domain, that's Authentication → Templates, but it isn't needed to play.

### 3. Create the database
Build → **Realtime Database** → Create database → start in **test mode** (you'll replace the rules in a moment).

### 4. Paste in these rules
Realtime Database → **Rules** tab → replace everything → Publish:

```json
{
  "rules": {
    "lobbies": {
      ".read": true,
      ".write": "auth != null || true"
    },
    "usernames": {
      ".read": true,
      "$name": {
        ".write": "!data.exists() && newData.child('uid').val() === auth.uid || data.child('uid').val() === auth.uid"
      }
    },
    "users": {
      "$uid": {
        ".read": "$uid === auth.uid",
        ".write": "$uid === auth.uid"
      }
    }
  }
}
```

What these do: anyone can read the username directory (that's how logging in by username finds the right account) and claim a name **only if nobody holds it already** — that single rule is what makes usernames exclusive, enforced by the server rather than trusted from the client. A profile can only ever be read or written by the account it belongs to.

### 5. Register a web app and copy the config
Project settings (gear icon) → Your apps → **Web app** (`</>`) → Register. Copy `apiKey`, `authDomain`, `databaseURL`, `projectId` and `appId` over the placeholders in `js/firebase-config.js`. If the snippet doesn't show `databaseURL`, take it from the Realtime Database page.

### 6. Authorise your domain
Authentication → Settings → **Authorized domains** → add wherever you host it (`yourname.github.io`, `yoursite.netlify.app`, …). `localhost` is already allowed.

Until the config is filled in the game still runs — the account screen and the Custom screen just tell you what's missing, and you can play the Garage and Editor as a guest.

**One privacy note worth knowing:** the username directory stores the email behind each name so that logging in by username can work at all, and it's publicly readable. That's the standard trade for username logins without a server. If you'd rather not expose emails, the fix is a Cloud Function that does the username→email lookup privately, which needs the Blaze plan.

## Accounts

Sign up with an email, a username and a password. Firebase emails you a verification link, and the game refuses to sign you in until you've clicked it — if you try, it resends the link. Usernames are 3–16 characters of letters, numbers or underscores, are claimed the moment you sign up, and can't be taken by anyone else; an email can only back one account.

Log in with your **username** and password. If the verification email hasn't turned up, check your spam folder first — Firebase sends from a `firebaseapp.com` address and it often lands there. There's a **resend verification** button on the login screen, and if a send ever fails the game now says so rather than telling you to check an inbox nothing was sent to. "Forgot password" emails a reset link to whatever address is behind that username.

Your name sits in the top-left of the menu. Clicking it offers **Log out** and **Delete account** — deleting asks for your password, then erases the profile, releases the username, and removes the login itself.

Your garage loadout is saved to your account and follows you to any machine you sign in on. Playing as a guest keeps it in the browser instead.

## Controls

W / S drive and reverse, A / D pivot the hull. Click the canvas to take aim: the crosshair sits fixed at the center of the screen and the camera is locked to it — the view swings anywhere, vertically included. The game finds the exact point under the crosshair (ground, wall, or enemy armor) and the turret converges on it as best it can within its barrel limits, at a limited traverse speed. Left click fires — one shot every 2.5 seconds. Esc releases the mouse.

### On a phone or tablet

Touch controls appear automatically on a touchscreen: a stick on the left for the hull (push forward to drive, sideways to pivot), a stick on the right for the turret, and a fire button. Both sticks centre themselves wherever your thumb lands rather than making you find a fixed circle, and the two sticks and the button all work at once. In the editor's build cam the sticks fly the camera and the button becomes PLACE.

Add `?touch=1` to the URL to force the on-screen controls on a desktop for testing.

## The match

Everyone drives the same tank: 1000 HP, 200 damage per shell — five hits and you're scrap. Projectiles are very fast black darts that leave a thin, quickly fading smoke trail. Players spawn spread out on a ring of 12 pads around the central platform — at match start and on every respawn, the game picks the pad farthest from everyone still alive. Death is an explosion into a black smoking husk for 5 seconds, then you're back.

Throw a tank into a corner fast enough and the back end steps out — the tracks give up some of their sideways bite, but only when there is real speed AND real steering, and never all of it. Drift is keyed to actual metres per second rather than to how close a hull is to its own top speed, so an Ironclad, which tops out at 7.27 m/s against a 7.6 m/s threshold, physically cannot do it, while a Falcon at 14 m/s can. Tanks are real rigid bodies (cannon-es): momentum carries you off edges, you can tumble, land on your side, and flip over completely. Nothing rotates the hull upright for you — while the tracks are down the controller only bleeds off pitch and roll *rate*, enough that a clipped edge can't wind up into a somersault, and the moment you leave the ground it lets go entirely. A flipped tank has no drive, but the turret still traverses and elevates — a gun with real recoil can be fired into the ground to right yourself; stay upside down for 4 seconds and the crew bails — it cooks off and you respawn.

Ground grip is entirely the controller's job — the solver's own friction between hull and ground is zero on purpose. It sets forward speed, kills sideways slide, cancels the gravity that would otherwise creep it down a ramp, and drags a wreck to a halt when nobody's driving. The tracks are animated from the commanded speed rather than the measured one, so they visibly slip when a wall is holding you and the speedo reads zero. Firing recoil is a genuine physics impulse applied at the muzzle rather than at the centre of mass, so the rear-up falls out of the lever arm instead of being faked — the cannon shoves the hull back at nearly 4 m/s and the railgun at 5, standing it up on its rear idlers. The drive controller and the tumble damper both stand down for the fraction of a second the shove is landing, so you feel it. Nothing may end a step below the ground: the four bottom corners of the chassis are checked against the surface underneath every frame and lifted out if a hard enough impulse has driven them in, so the tracks never sink into the floor. Tank-vs-tank contact is solved by the engine, tank-vs-tank contact is solved by the engine, and everything precompiles during the menu so the first shot of a match doesn't hitch.

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

`index.html` holds the menu markup and HUD; `css/style.css` styles both; `js/main.js` owns phases (menu → lobby → match), the local tank, combat, and the loop; `js/net.js` is the Firebase lobby/state/shot transport; `js/remote.js` mirrors the other players' tanks; `js/menu.js` drives the screens; `js/player.js` is local physics and turret traverse; `js/tank.js` the model, treads, and hitboxes; `js/garage.js` the bay and everything test-fired in it; `js/bullets.js`, `js/fx.js`, `js/audio.js` shells, particles, positional sound; `js/tracks.js` the tread marks pressed into the ground; `js/arc.js` the Aegis lifeline, its prong arc and the railgun lance; `js/map.js` the arena, platform, spawn ring, and terrain heights; `js/physics.js` the cannon-es world and colliders; `js/editor.js` the build mode, where decals are lit surfaces you pick a preset for — matte, concrete, plating, metal, tread, rust or tile — then colour and set the metalness of on a slider, where slopes are sized by HEIGHT on the same half-metre steps as walls and platforms so their crests land exactly on each other, and collide as a single convex wedge rather than an approximated slab; `js/firebase-config.js` your credentials.

## Roadmap ideas

TDM / FFA / CTF, scoring, more hulls/turrets, better maps.
