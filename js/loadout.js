// Garage rosters. Only the base turret and hull exist so far — the rest are
// reserved slots that show as locked until their models are built. Skins are
// palettes and all work today.
import { SKINS } from './tank.js';

export { SKINS };

export const TURRETS = [
  { id: 'cannon', name: 'Cannon', locked: false },
  { id: 'arctic', name: 'Arctic Snap', locked: false },
  { id: 'autocannon', name: 'Autocannon', locked: true },
  { id: 'railgun', name: 'Railgun', locked: true },
  { id: 'mortar', name: 'Mortar', locked: true },
  { id: 'laser', name: 'Laser', locked: true },
  { id: 'scatter', name: 'Scattergun', locked: true },
  { id: 'tesla', name: 'Tesla', locked: true },
  { id: 'missile', name: 'Missile', locked: true },
];

export const HULLS = [
  { id: 'standard', name: 'Standard', locked: false },
  { id: 'scout', name: 'Scout', locked: true },
  { id: 'hunter', name: 'Hunter', locked: true },
  { id: 'guardian', name: 'Guardian', locked: true },
  { id: 'vanguard', name: 'Vanguard', locked: true },
  { id: 'juggernaut', name: 'Juggernaut', locked: true },
];

const KEY = 'tank-loadout';

export const selection = { turret: 0, hull: 0, skin: 0 };

export function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      if (Number.isInteger(raw.turret) && TURRETS[raw.turret] && !TURRETS[raw.turret].locked) {
        selection.turret = raw.turret;
      }
      if (Number.isInteger(raw.hull) && HULLS[raw.hull] && !HULLS[raw.hull].locked) {
        selection.hull = raw.hull;
      }
      if (Number.isInteger(raw.skin) && SKINS[raw.skin]) selection.skin = raw.skin;
    }
  } catch { /* no saved loadout */ }
  return selection;
}

export function saveSelection() {
  try {
    localStorage.setItem(KEY, JSON.stringify(selection));
  } catch { /* storage unavailable */ }
}

export function currentSkin() {
  return SKINS[selection.skin] || SKINS[0];
}

export function currentTurret() {
  return (TURRETS[selection.turret] || TURRETS[0]).id;
}

export function skinIndexOf(id) {
  const i = SKINS.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}
