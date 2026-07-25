// Garage rosters. Only the base turret and hull exist so far — the rest are
// reserved slots that show as locked until their models are built. Skins are
// palettes and all work today.
import { SKINS } from './tank.js';

export { SKINS };

export const TURRETS = [
  // The id stays 'cannon' on purpose: it is what saved loadouts and every
  // network state message already carry. Only the label changed.
  { id: 'cannon', name: 'Striker', locked: false },
  { id: 'thunder', name: 'Thunderbolt', locked: false },
  { id: 'arctic', name: 'Arctic Snap', locked: false },
  { id: 'inferno', name: 'Torrential Inferno', locked: false },
  { id: 'plasma', name: 'Dual Plasma', locked: false },
  { id: 'aegis', name: 'Aegis Emitter', locked: false },
  { id: 'railgun', name: 'Railgun', locked: false },
  { id: 'scatter', name: 'Scattergun', locked: true },
  { id: 'tesla', name: 'Tesla', locked: true },
  { id: 'missile', name: 'Missile', locked: true },
];

export const HULLS = [
  { id: 'vanguard', name: 'Vanguard', locked: false },
  { id: 'pioneer', name: 'Pioneer', locked: false },
  { id: 'falcon', name: 'Falcon', locked: false },
  { id: 'paladin', name: 'Paladin', locked: false },
  { id: 'ironclad', name: 'Ironclad', locked: false },
  { id: 'juggernaut', name: 'Juggernaut', locked: true },
];

const KEY = 'tank-loadout';

export const selection = { turret: 0, hull: 0, skin: 0 };

// Selections are stored by id. They used to be stored as array indices,
// which meant adding or reordering a roster entry silently changed what a
// player had equipped — old numeric saves are still read, once.
function resolve(list, value, allowLocked) {
  let i = -1;
  if (typeof value === 'string') i = list.findIndex((x) => x.id === value);
  else if (Number.isInteger(value)) i = value; // legacy index format
  if (i < 0 || !list[i]) return -1;
  if (!allowLocked && list[i].locked) return -1;
  return i;
}

export function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      const t = resolve(TURRETS, raw.turret, false);
      if (t >= 0) selection.turret = t;
      const h = resolve(HULLS, raw.hull, false);
      if (h >= 0) selection.hull = h;
      const s = resolve(SKINS, raw.skin, true);
      if (s >= 0) selection.skin = s;
    }
  } catch { /* no saved loadout */ }
  return selection;
}

export function saveSelection() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      turret: (TURRETS[selection.turret] || TURRETS[0]).id,
      hull: (HULLS[selection.hull] || HULLS[0]).id,
      skin: (SKINS[selection.skin] || SKINS[0]).id,
    }));
  } catch { /* storage unavailable */ }
}

export function currentSkin() {
  return SKINS[selection.skin] || SKINS[0];
}

export function currentTurret() {
  return (TURRETS[selection.turret] || TURRETS[0]).id;
}

export function currentHull() {
  return (HULLS[selection.hull] || HULLS[0]).id;
}

export function skinIndexOf(id) {
  const i = SKINS.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}
