const SAVE_KEY = "blaster-battle-settings-v1";

export const MAP_THEMES = [
  { id: "foundry", name: "Neon Foundry", description: "Vertical cover, blastable crates, and bright grapple anchors." }
];

export const LOADOUT_SLOTS = [
  { id: "slot1", label: "1", key: "Digit1", defaultWeapon: "blaster" },
  { id: "slot2", label: "2", key: "Digit2", defaultWeapon: "shotgun" },
  { id: "slot3", label: "3", key: "Digit3", defaultWeapon: "rocket_launcher" },
  { id: "slot4", label: "4", key: "Digit4", defaultWeapon: "grenade_launcher" },
  { id: "slot5", label: "5", key: "Digit5", defaultWeapon: "railgun" }
];

export const WEAPONS = {
  blaster: {
    id: "blaster", name: "Blaster", type: "projectile", color: 0x50e8ff,
    damage: 18, projectileSpeed: 75, range: 42, cooldown: .3, spread: .012,
    ammo: 12, reload: 1.05, recoil: 1.1, description: "Medium-speed visible bolt."
  },
  shotgun: {
    id: "shotgun", name: "Shotgun", type: "spread", color: 0xffd166,
    damage: 8, pellets: 7, projectileSpeed: 165, range: 18, cooldown: .78, spread: .24,
    ammo: 5, reload: 1.2, recoil: 4.8, description: "Fast close-range pellet burst."
  },
  machine_gun: {
    id: "machine_gun", name: "Machine Gun", type: "projectile", color: 0xa3ff8f,
    damage: 7, projectileSpeed: 210, range: 40, cooldown: .085, spread: .075,
    ammo: 32, reload: 1.45, recoil: .42, description: "Near-instant rapid physical rounds."
  },
  rocket_launcher: {
    id: "rocket_launcher", name: "Rocket Launcher", type: "rocket", color: 0xff6b5f,
    damage: 56, projectileSpeed: 36, range: 45, cooldown: 1.05, spread: .006,
    ammo: 3, reload: 1.6, recoil: 5.6, radius: 5.8, terrainRadius: 5.2,
    description: "Slow, heavy terrain blast."
  },
  grenade_launcher: {
    id: "grenade_launcher", name: "Grenade Launcher", type: "grenade", color: 0xc993ff,
    damage: 45, projectileSpeed: 13, range: 34, cooldown: .88, spread: .02,
    ammo: 4, reload: 1.45, recoil: 2.2, radius: 5.1, terrainRadius: 4.4,
    fuse: 1.25, description: "Arcing, bouncing fuse."
  },
  mine: {
    id: "mine", name: "Mine", type: "mine", color: 0xff4fa0,
    damage: 60, projectileSpeed: 0, range: 8, cooldown: 1.05, spread: 0,
    ammo: 3, reload: 1.6, recoil: .5, radius: 4.7, terrainRadius: 3.8,
    fuse: 8, description: "Persistent proximity trap."
  },
  railgun: {
    id: "railgun", name: "Railgun", type: "rail", color: 0xffffff,
    damage: 58, projectileSpeed: 520, range: 66, cooldown: 1.1, spread: .002,
    ammo: 4, reload: 1.65, recoil: 3, description: "Almost-instant precision line shot."
  },
  plasma_cannon: {
    id: "plasma_cannon", name: "Plasma Cannon", type: "plasma", color: 0x57a0ff,
    damage: 38, projectileSpeed: 58, range: 38, cooldown: .9, spread: .008,
    ammo: 5, reload: 1.45, recoil: 3.6, radius: 3.6, terrainRadius: 2.7,
    description: "Large charged energy orb."
  }
};

export const DEFAULT_LOADOUT = LOADOUT_SLOTS.map((slot) => slot.defaultWeapon);

export function projectileStepCount(speed, dt, radius = .11) {
  return Math.max(1, Math.ceil(Math.max(0, speed * dt) / Math.max(.6, radius * 2)));
}

export function seedFromText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function defaults() {
  return {
    displayName: "Rookie",
    blood: "reduced",
    shake: 60,
    reducedMotion: false,
    volume: 70,
    loadout: [...DEFAULT_LOADOUT]
  };
}

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
    const loadout = Array.isArray(saved.loadout)
      ? [...new Set(saved.loadout.filter((id) => WEAPONS[id]))].slice(0, 5)
      : [];
    for (const id of DEFAULT_LOADOUT) if (loadout.length < 5 && !loadout.includes(id)) loadout.push(id);
    return { ...defaults(), ...saved, loadout };
  } catch {
    return defaults();
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(settings));
}
