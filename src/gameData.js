const SAVE_KEY = "blaster-battle-settings-v1";

export const MAP_THEMES = [
  { id: "foundry", name: "Neon Foundry", ground: 0x102234, grid: 0x1fd7ff, accent: 0x67f4ff, danger: 0xff416c, haze: 0x173149 },
  { id: "solar", name: "Solar Rift", ground: 0x2a1d24, grid: 0xffc857, accent: 0xffd166, danger: 0xff5d4a, haze: 0x4a2033 },
  { id: "ion", name: "Ion Garden", ground: 0x11282a, grid: 0x54ffb4, accent: 0x6effcf, danger: 0xff4fd8, haze: 0x173b3d }
];

export const LOADOUT_SLOTS = [
  { id: "slot1", label: "1", key: "Digit1", defaultWeapon: "blaster" },
  { id: "slot2", label: "2", key: "Digit2", defaultWeapon: "shotgun" },
  { id: "slot3", label: "3", key: "Digit3", defaultWeapon: "rocket_launcher" },
  { id: "slot4", label: "4", key: "Digit4", defaultWeapon: "grenade_launcher" },
  { id: "slot5", label: "5", key: "Digit5", defaultWeapon: "railgun" }
];

function weapon(category, id, name, type, color, description, stats = {}) {
  return {
    id, name, category, type, color, description,
    damage: 20, projectileSpeed: 70, cooldown: .4, spread: .01,
    ammo: 8, reload: 1.2, recoil: 1,
    ...stats
  };
}

export const WEAPON_GROUPS = [
  { id: "prototype", name: "Prototype", ids: ["blaster", "shotgun", "machine_gun", "rocket_launcher", "grenade_launcher", "mine", "railgun", "plasma_cannon"] },
  { id: "rapid", name: "Rapid Fire", ids: ["submachine_gun", "minigun", "plasma_repeater", "needle_launcher", "burst_rifle"] },
  { id: "explosive", name: "Explosive", ids: ["cluster_grenade", "sticky_launcher", "remote_explosive", "mortar", "bouncing_bomb", "napalm_launcher", "implosion_bomb"] },
  { id: "energy", name: "Energy", ids: ["laser_beam", "charged_energy_rifle", "arc_lightning", "pulse_cannon", "gravity_beam", "disintegration_weapon"] },
  { id: "unusual", name: "Unusual", ids: ["black_hole_generator", "freeze_gun", "teleport_projectile", "drill_missile", "boomerang_blade", "ricochet_cannon", "gravity_grenade", "tornado_generator", "temporary_wall", "decoy_launcher", "weapon_stealing_projectile", "grapple_disrupting_pulse"] },
  { id: "melee", name: "Melee", ids: ["hammer", "energy_sword", "chainsaw", "spear", "punch_glove", "shock_baton", "knife"] }
];

const weaponList = [
  // Prototype set
  weapon("Prototype", "blaster", "Blaster", "projectile", 0x50e8ff, "Medium-speed visible bolt.", { damage: 18, projectileSpeed: 75, cooldown: .3, spread: .012, ammo: 12, reload: 1.05, recoil: 1.1 }),
  weapon("Prototype", "shotgun", "Shotgun", "spread", 0xffd166, "Fast close-range pellet burst.", { damage: 8, pellets: 7, projectileSpeed: 165, cooldown: .78, spread: .24, ammo: 5, recoil: 4.8 }),
  weapon("Prototype", "machine_gun", "Machine Gun", "projectile", 0xa3ff8f, "Near-instant rapid physical rounds.", { damage: 7, projectileSpeed: 210, cooldown: .085, spread: .025, ammo: 32, reload: 1.45, recoil: .42 }),
  weapon("Prototype", "rocket_launcher", "Rocket Launcher", "rocket", 0xff6b5f, "Slow, heavy terrain blast.", { damage: 56, projectileSpeed: 36, cooldown: 1.05, spread: .006, ammo: 3, reload: 1.6, recoil: 5.6, radius: 5.8, terrainRadius: 5.2 }),
  weapon("Prototype", "grenade_launcher", "Grenade Launcher", "grenade", 0xc993ff, "Arcing, bouncing fuse.", { damage: 45, projectileSpeed: 13, cooldown: .88, spread: .02, ammo: 4, reload: 1.45, recoil: 2.2, radius: 5.1, terrainRadius: 4.4, fuse: 1.25, gravity: 17, bounces: 2, arcLift: 7.5 }),
  weapon("Prototype", "mine", "Mine", "mine", 0xff4fa0, "Persistent proximity trap.", { damage: 60, projectileSpeed: 0, cooldown: 1.05, spread: 0, ammo: 3, reload: 1.6, recoil: .5, radius: 4.7, terrainRadius: 3.8, fuse: 8 }),
  weapon("Prototype", "railgun", "Railgun", "rail", 0xffffff, "Almost-instant precision line shot.", { damage: 58, projectileSpeed: 520, cooldown: 1.1, spread: .002, ammo: 4, reload: 1.65, recoil: 3 }),
  weapon("Prototype", "plasma_cannon", "Plasma Cannon", "plasma", 0x57a0ff, "Large charged energy orb.", { damage: 38, projectileSpeed: 58, cooldown: .9, spread: .008, ammo: 5, reload: 1.45, recoil: 3.6, radius: 3.6, terrainRadius: 2.7, projectileRadius: .42 }),

  // Full library: rapid fire
  weapon("Rapid Fire", "submachine_gun", "Submachine Gun", "projectile", 0x7dff9c, "Mobile close-range bullet stream.", { damage: 5, projectileSpeed: 190, cooldown: .06, spread: .055, ammo: 40, reload: 1.25, recoil: .24 }),
  weapon("Rapid Fire", "minigun", "Minigun", "projectile", 0xffc857, "Extreme fire rate with heavy movement recoil.", { damage: 4, projectileSpeed: 225, cooldown: .038, spread: .075, ammo: 80, reload: 2.4, recoil: .2 }),
  weapon("Rapid Fire", "plasma_repeater", "Plasma Repeater", "projectile", 0x42f5e6, "Rapid glowing energy bolts.", { damage: 9, projectileSpeed: 105, cooldown: .12, spread: .025, ammo: 24, reload: 1.35, recoil: .4, projectileRadius: .16 }),
  weapon("Rapid Fire", "needle_launcher", "Needle Launcher", "projectile", 0xdf9cff, "Needles pierce through two targets.", { damage: 12, projectileSpeed: 260, cooldown: .16, spread: .009, ammo: 18, reload: 1.3, recoil: .35, penetration: 2 }),
  weapon("Rapid Fire", "burst_rifle", "Burst Rifle", "spread", 0x8dffcf, "Tight three-round precision burst.", { damage: 10, pellets: 3, projectileSpeed: 245, cooldown: .48, spread: .018, ammo: 24, reload: 1.45, recoil: 1.3 }),

  // Full library: explosive
  weapon("Explosive", "cluster_grenade", "Cluster Grenade", "grenade", 0xff9f68, "Splits into six secondary bomblets.", { damage: 18, projectileSpeed: 15, cooldown: 1.15, ammo: 3, reload: 1.7, recoil: 2.2, radius: 2.8, terrainRadius: 2.3, fuse: 1.05, gravity: 17, bounces: 1, arcLift: 8.5, split: 6 }),
  weapon("Explosive", "sticky_launcher", "Sticky Launcher", "grenade", 0xff5fa2, "Adheres to the first surface before detonation.", { damage: 54, projectileSpeed: 30, cooldown: .85, ammo: 5, reload: 1.55, recoil: 2.2, radius: 5, terrainRadius: 3.8, fuse: 2.4, gravity: 8, sticky: true, projectileRadius: .22 }),
  weapon("Explosive", "remote_explosive", "Remote Explosive", "remote", 0xff416c, "Fire to place; fire again to detonate every charge.", { damage: 68, projectileSpeed: 26, cooldown: .7, ammo: 4, reload: 1.7, recoil: 1.3, radius: 6.2, terrainRadius: 5.4, gravity: 10, sticky: true, projectileRadius: .25 }),
  weapon("Explosive", "mortar", "Mortar", "grenade", 0xd8b06b, "High arcing shell with a broad blast.", { damage: 64, projectileSpeed: 20, cooldown: 1.45, ammo: 3, reload: 1.9, recoil: 4.2, radius: 6.6, terrainRadius: 6, fuse: 2.2, gravity: 18, bounces: 0, arcLift: 14 }),
  weapon("Explosive", "bouncing_bomb", "Bouncing Bomb", "grenade", 0x8ce6ff, "High-energy bomb ricochets before exploding.", { damage: 48, projectileSpeed: 25, cooldown: 1, ammo: 4, reload: 1.55, recoil: 2, radius: 4.8, terrainRadius: 3.4, fuse: 3.2, gravity: 14, bounces: 8, bounceEnergy: .88, arcLift: 9 }),
  weapon("Explosive", "napalm_launcher", "Napalm Launcher", "rocket", 0xff6a2a, "Ignites a persistent damaging fire zone.", { damage: 28, projectileSpeed: 42, cooldown: 1.1, ammo: 4, reload: 1.65, recoil: 3.8, radius: 4.2, terrainRadius: 2.5, hazard: "napalm", hazardDuration: 6 }),
  weapon("Explosive", "implosion_bomb", "Implosion Bomb", "grenade", 0xa986ff, "Collapses its blast inward and drags fighters together.", { damage: 38, projectileSpeed: 17, cooldown: 1.25, ammo: 3, reload: 1.8, recoil: 5, radius: 7.2, terrainRadius: 2, fuse: 1.5, gravity: 16, bounces: 1, arcLift: 8, pull: true }),

  // Full library: energy
  weapon("Energy", "laser_beam", "Laser Beam", "beam", 0xff365d, "Instant straight beam with no travel cutoff.", { damage: 24, projectileSpeed: 0, cooldown: .38, spread: .001, ammo: 10, reload: 1.35, recoil: 1.1 }),
  weapon("Energy", "charged_energy_rifle", "Charged Energy Rifle", "rail", 0x79b8ff, "Slow-cadence charged shot with huge impact.", { damage: 76, projectileSpeed: 610, cooldown: 1.65, spread: .001, ammo: 3, reload: 2, recoil: 5.4, penetration: 1 }),
  weapon("Energy", "arc_lightning", "Arc Lightning", "chain", 0x8df7ff, "Lightning jumps between nearby opponents.", { damage: 27, projectileSpeed: 0, cooldown: .72, ammo: 8, reload: 1.4, recoil: .7, reach: 34, chains: 3 }),
  weapon("Energy", "pulse_cannon", "Pulse Cannon", "plasma", 0x4c8dff, "Wide impulse pulse for controlling space.", { damage: 31, projectileSpeed: 72, cooldown: .72, ammo: 7, reload: 1.4, recoil: 5.2, radius: 4.8, terrainRadius: 1.5, projectileRadius: .48 }),
  weapon("Energy", "gravity_beam", "Gravity Beam", "beam", 0xbf7cff, "A tractor beam pulls its target toward you.", { damage: 5, projectileSpeed: 0, cooldown: .18, ammo: 22, reload: 1.5, recoil: 0, beamPull: 15 }),
  weapon("Energy", "disintegration_weapon", "Disintegration Weapon", "beam", 0xf5f7ff, "Piercing beam erases cover in its path.", { damage: 44, projectileSpeed: 0, cooldown: 1.2, ammo: 4, reload: 1.8, recoil: 2.8, penetration: 4, terrainRadius: 4.5 }),

  // Full library: unusual
  weapon("Unusual", "black_hole_generator", "Black-Hole Generator", "plasma", 0x5d3b99, "Creates a singularity that pulls and damages nearby fighters.", { damage: 18, projectileSpeed: 34, cooldown: 1.8, ammo: 2, reload: 2.2, recoil: 5, radius: 4, terrainRadius: 2, projectileRadius: .5, hazard: "black_hole", hazardDuration: 5 }),
  weapon("Unusual", "freeze_gun", "Freeze Gun", "projectile", 0xa9efff, "Slows movement and grappling after a hit.", { damage: 12, projectileSpeed: 92, cooldown: .32, ammo: 14, reload: 1.3, recoil: .5, effect: "freeze", effectDuration: 2.8, projectileRadius: .18 }),
  weapon("Unusual", "teleport_projectile", "Teleport Projectile", "projectile", 0x43ffd1, "Teleports the shooter to the first impact point.", { damage: 5, projectileSpeed: 130, cooldown: 1.3, ammo: 4, reload: 1.6, recoil: 0, effect: "teleport", projectileRadius: .18 }),
  weapon("Unusual", "drill_missile", "Drill Missile", "rocket", 0xffd45d, "Bores through destructible cover before exploding.", { damage: 42, projectileSpeed: 48, cooldown: 1.2, ammo: 3, reload: 1.8, recoil: 3.8, radius: 4.2, terrainRadius: 5, terrainPenetration: 4 }),
  weapon("Unusual", "boomerang_blade", "Boomerang Blade", "projectile", 0xffa7e6, "Piercing blade returns to its owner.", { damage: 24, projectileSpeed: 74, cooldown: .75, ammo: 6, reload: 1.25, recoil: .8, penetration: 5, returning: .8, projectileRadius: .24 }),
  weapon("Unusual", "ricochet_cannon", "Ricochet Cannon", "projectile", 0x8affc1, "Rounds rebound repeatedly from arena surfaces.", { damage: 23, projectileSpeed: 145, cooldown: .5, ammo: 9, reload: 1.35, recoil: 1.6, bounces: 10, bounceEnergy: .94, projectileRadius: .15 }),
  weapon("Unusual", "gravity_grenade", "Gravity Grenade", "grenade", 0x7d65ff, "A wide implosive grenade with extreme pull.", { damage: 22, projectileSpeed: 15, cooldown: 1.1, ammo: 4, reload: 1.55, recoil: 7, radius: 8, terrainRadius: 1, fuse: 1.35, gravity: 17, bounces: 2, arcLift: 8, pull: true }),
  weapon("Unusual", "tornado_generator", "Tornado Generator", "plasma", 0xb6f6ff, "Spawns a moving vortex that throws fighters upward.", { damage: 10, projectileSpeed: 40, cooldown: 1.5, ammo: 3, reload: 1.9, recoil: 2.5, radius: 3.5, terrainRadius: 0, hazard: "tornado", hazardDuration: 6, projectileRadius: .4 }),
  weapon("Unusual", "temporary_wall", "Temporary Wall", "wall", 0x69e7ff, "Builds a solid energy wall at the impact point.", { damage: 0, projectileSpeed: 85, cooldown: 1.4, ammo: 3, reload: 1.8, recoil: .5, wallDuration: 10, projectileRadius: .2 }),
  weapon("Unusual", "decoy_launcher", "Decoy Launcher", "decoy", 0xff75d8, "Deploys a hologram that distracts enemy bots.", { damage: 0, projectileSpeed: 65, cooldown: 1.3, ammo: 3, reload: 1.7, recoil: .4, decoyDuration: 12, projectileRadius: .2 }),
  weapon("Unusual", "weapon_stealing_projectile", "Weapon-Stealing Projectile", "projectile", 0xf6ed72, "Drains the target's current magazine and refills yours.", { damage: 8, projectileSpeed: 105, cooldown: 1.1, ammo: 4, reload: 1.6, recoil: .8, effect: "steal", projectileRadius: .2 }),
  weapon("Unusual", "grapple_disrupting_pulse", "Grapple-Disrupting Pulse", "plasma", 0xff4fb8, "A pulse forcibly releases grapples in its blast.", { damage: 16, projectileSpeed: 76, cooldown: .85, ammo: 6, reload: 1.45, recoil: 3.5, radius: 6.5, terrainRadius: 0, grappleDisrupt: true, projectileRadius: .4 }),

  // Full library: melee
  weapon("Melee", "hammer", "Hammer", "melee", 0xffc05c, "Slow overhead smash with enormous knockback.", { damage: 46, projectileSpeed: 0, cooldown: .9, ammo: 6, reload: 1.25, recoil: 8, reach: 3.3, arc: .55 }),
  weapon("Melee", "energy_sword", "Energy Sword", "melee", 0x53efff, "Fast sweeping energy blade.", { damage: 34, projectileSpeed: 0, cooldown: .42, ammo: 12, reload: 1.15, recoil: 3, reach: 3.7, arc: .7 }),
  weapon("Melee", "chainsaw", "Chainsaw", "melee", 0xff6b49, "Rapid close contact damage.", { damage: 11, projectileSpeed: 0, cooldown: .13, ammo: 30, reload: 1.55, recoil: 1.2, reach: 2.5, arc: .42 }),
  weapon("Melee", "spear", "Spear", "melee", 0xd9e9ff, "Long narrow thrust with strong precision damage.", { damage: 39, projectileSpeed: 0, cooldown: .68, ammo: 9, reload: 1.3, recoil: 3.8, reach: 5.5, arc: .25 }),
  weapon("Melee", "punch_glove", "Punch Glove", "melee", 0xff62a8, "Spring-loaded punch with massive launch force.", { damage: 19, projectileSpeed: 0, cooldown: .55, ammo: 10, reload: 1.25, recoil: 11, reach: 3.1, arc: .5 }),
  weapon("Melee", "shock_baton", "Shock Baton", "melee", 0x9d8cff, "Stuns and slows the struck fighter.", { damage: 24, projectileSpeed: 0, cooldown: .5, ammo: 10, reload: 1.3, recoil: 2.4, reach: 3.2, arc: .55, effect: "freeze", effectDuration: 1.5 }),
  weapon("Melee", "knife", "Knife", "melee", 0xe7edf5, "Very fast short-range finishing strike.", { damage: 27, projectileSpeed: 0, cooldown: .28, ammo: 16, reload: 1.1, recoil: 1.4, reach: 2.6, arc: .35 })
];

export const WEAPONS = Object.fromEntries(weaponList.map((entry) => [entry.id, entry]));

export const DEFAULT_LOADOUT = LOADOUT_SLOTS.map((slot) => slot.defaultWeapon);

export function projectileLifetime(weapon) {
  return weapon.fuse ?? Infinity;
}

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
    botCount: 1,
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
