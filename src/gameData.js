import TEXT, { formatText } from "./playerText.js";
import { clampMatchMinutes } from "./multiplayerProtocol.js";

const SAVE_KEY = "master-blaster-settings";
const LEGACY_SAVE_KEYS = ["blaster-battle-settings-v1"];
export const LOADOUT_PRESET_COUNT = 3;
const MATCH_SETTINGS_DEFAULTS = {
  quick: { botCount: 7, botDifficulty: "normal", seed: TEXT.loading.defaultSeed, timeLimitMinutes: 3 },
  private: { botCount: 0, botDifficulty: "normal", seed: "", timeLimitMinutes: 3 },
  training: { botCount: 1, botDifficulty: "normal", seed: TEXT.loading.defaultSeed, timeLimitMinutes: 3 }
};
const MATCH_SETTINGS_VERSION = 2;

export function topScoreIndices(scores, count = 3) {
  return scores.map((_, index) => index)
    .sort((left, right) => scores[right] - scores[left] || left - right)
    .slice(0, count);
}

export const MAP_THEMES = [
  { id: "foundry", name: TEXT.maps.foundry, ground: 0x102234, grid: 0x1fd7ff, accent: 0x67f4ff, danger: 0xff416c, haze: 0x173149 },
  { id: "solar", name: TEXT.maps.solar, ground: 0x2a1d24, grid: 0xffc857, accent: 0xffd166, danger: 0xff5d4a, haze: 0x4a2033 },
  { id: "ion", name: TEXT.maps.ion, ground: 0x11282a, grid: 0x54ffb4, accent: 0x6effcf, danger: 0xff4fd8, haze: 0x173b3d }
];

export const LOADOUT_SLOTS = [
  { id: "slot1", label: "1", key: "Digit1", defaultWeapon: "blaster" },
  { id: "slot2", label: "2", key: "Digit2", defaultWeapon: "shotgun" },
  { id: "slot3", label: "3", key: "Digit3", defaultWeapon: "rocket_launcher" },
  { id: "slot4", label: "4", key: "Digit4", defaultWeapon: "grenade_launcher" },
  { id: "slot5", label: "5", key: "Digit5", defaultWeapon: "railgun" }
];

function weapon(categoryId, id, type, color, stats = {}) {
  const copy = TEXT.weapons[id];
  const rangePolicy = {
    projectile: { preferredRange: 22, maxUsefulRange: 150 },
    spread: { preferredRange: 9, maxUsefulRange: 42 },
    burst: { preferredRange: 30, maxUsefulRange: 170 },
    rocket: { preferredRange: 28, minUsefulRange: 8, maxUsefulRange: 170 },
    grenade: { preferredRange: 22, minUsefulRange: 7, maxUsefulRange: 58 },
    mine: { preferredRange: 4, maxUsefulRange: 8, utilityIntent: "trap" },
    remote: { preferredRange: 10, maxUsefulRange: 60, utilityIntent: "trap" },
    rail: { preferredRange: 42, minUsefulRange: 10, maxUsefulRange: 400 },
    plasma: { preferredRange: 25, minUsefulRange: 6, maxUsefulRange: 150 },
    beam: { preferredRange: 32, maxUsefulRange: 400 },
    chain: { preferredRange: 20, maxUsefulRange: 34 },
    flame: { preferredRange: 7.5, maxUsefulRange: 11.5 },
    wall: { preferredRange: 15, maxUsefulRange: 80, utilityIntent: "cover" },
    decoy: { preferredRange: 18, maxUsefulRange: 80, utilityIntent: "distraction" },
    melee: { preferredRange: 3, maxUsefulRange: 6 }
  }[type] || { preferredRange: 20, maxUsefulRange: 150 };
  const value = {
    id, name: copy.name, category: TEXT.weaponGroups[categoryId], type, color, description: copy.description,
    damage: 20, projectileSpeed: 70, cooldown: .4, spread: .01,
    ammo: 8, reload: 1.2, recoil: 1,
    ...rangePolicy,
    ...stats
  };
  if (!("structureDamage" in stats)) {
    const scale = {
      projectile: .1, spread: .06, burst: .1, rocket: .36, grenade: .28,
      mine: .28, remote: .3, rail: .16, plasma: .18, beam: .15,
      chain: .12, flame: .18, melee: .22
    }[type] || 0;
    value.structureDamage = type === "wall" || type === "decoy" || stats.effect === "teleport" || value.damage <= 0
      ? 0
      : Math.max(type === "flame" ? .65 : .5, value.damage * scale);
  }
  if (type === "melee") {
    value.reload = 0;
    value.preferredRange = value.reach * .8;
    value.maxUsefulRange = value.reach + 1;
  }
  return value;
}

export const WEAPON_GROUPS = [
  { id: "rapid", name: TEXT.weaponGroups.rapid, color: "#5ff0a4", ids: ["burst_rifle", "machine_gun", "minigun", "needle_launcher", "plasma_repeater", "submachine_gun"] },
  { id: "explosive", name: TEXT.weaponGroups.explosive, color: "#ff9b4a", ids: ["bouncing_bomb", "cluster_grenade", "grenade_launcher", "implosion_bomb", "mine", "mortar", "napalm_launcher", "remote_explosive", "rocket_launcher", "sticky_launcher"] },
  { id: "energy", name: TEXT.weaponGroups.energy, color: "#51dcff", ids: ["arc_lightning", "blaster", "gravity_beam", "plasma_cannon", "pulse_cannon"] },
  { id: "precision", name: TEXT.weaponGroups.precision, color: "#9fb7ff", ids: ["charged_energy_rifle", "disintegration_weapon", "laser_beam", "railgun"] },
  { id: "close", name: TEXT.weaponGroups.close, color: "#ffd166", ids: ["flamethrower", "shotgun"] },
  { id: "unusual", name: TEXT.weaponGroups.unusual, color: "#d978ff", ids: ["black_hole_generator", "boomerang_blade", "decoy_launcher", "drill_missile", "fireball", "freeze_gun", "grapple_disrupting_pulse", "gravity_grenade", "ricochet_cannon", "teleport_projectile", "temporary_wall", "tornado_generator", "weapon_stealing_projectile"] },
  { id: "melee", name: TEXT.weaponGroups.melee, color: "#ff607d", ids: ["chainsaw", "energy_sword", "hammer", "knife", "punch_glove", "shock_baton", "spear"] }
];

const weaponList = [
  // Core arsenal
  weapon("energy", "blaster", "projectile", 0x50e8ff, { damage: 18, projectileSpeed: 75, cooldown: .3, spread: .012, ammo: 12, reload: 1.05, recoil: 1.1 }),
  weapon("close", "shotgun", "spread", 0xffd166, { damage: 8, pellets: 7, projectileSpeed: 165, cooldown: .78, spread: .24, ammo: 5, recoil: 4.8 }),
  weapon("rapid", "machine_gun", "projectile", 0xa3ff8f, { damage: 7, projectileSpeed: 210, cooldown: .085, spread: .025, ammo: 32, reload: 1.45, recoil: .42, hitscan: true, preferredRange: 34, maxUsefulRange: 180 }),
  weapon("explosive", "rocket_launcher", "rocket", 0xff6b5f, { damage: 56, projectileSpeed: 105, cooldown: 1.05, spread: .006, ammo: 3, reload: 1.6, recoil: 5.6, radius: 5.8, terrainRadius: 5.2, structureDamage: 20 }),
  weapon("explosive", "grenade_launcher", "grenade", 0xc993ff, { damage: 45, projectileSpeed: 82, cooldown: .88, spread: .02, ammo: 4, reload: 1.45, recoil: 2.2, radius: 5.1, terrainRadius: 4.4, fuse: 1.25, gravity: 17, bounces: 2, arcLift: 7.5 }),
  weapon("explosive", "mine", "mine", 0xff4fa0, { damage: 60, projectileSpeed: 0, cooldown: 1.05, spread: 0, ammo: 3, reload: 1.6, recoil: .5, radius: 4.7, terrainRadius: 3.8, fuse: 8 }),
  weapon("precision", "railgun", "rail", 0xffffff, { damage: 58, projectileSpeed: 520, cooldown: 1.1, spread: .002, ammo: 4, reload: 1.65, recoil: 3, hitscan: true }),
  weapon("energy", "plasma_cannon", "plasma", 0x57a0ff, { damage: 38, projectileSpeed: 110, cooldown: .9, spread: .008, ammo: 5, reload: 1.45, recoil: 3.6, radius: 3.6, terrainRadius: 2.7, projectileRadius: .42 }),

  // Full library: rapid fire
  weapon("rapid", "submachine_gun", "projectile", 0x7dff9c, { damage: 5, projectileSpeed: 190, cooldown: .06, spread: .055, ammo: 40, reload: 1.25, recoil: .24, hitscan: true, preferredRange: 11, maxUsefulRange: 32 }),
  weapon("rapid", "minigun", "projectile", 0xffc857, { damage: 4, projectileSpeed: 225, cooldown: .038, spread: .075, ammo: 80, reload: 2.4, recoil: .34, hitscan: true, spin: true, maintained: true, preferredRange: 24, maxUsefulRange: 72 }),
  weapon("rapid", "plasma_repeater", "projectile", 0x42f5e6, { damage: 9, projectileSpeed: 180, cooldown: .12, spread: .025, ammo: 24, reload: 1.35, recoil: .4, projectileRadius: .16, energy: true, hitscan: true }),
  weapon("rapid", "needle_launcher", "projectile", 0xdf9cff, { damage: 12, projectileSpeed: 260, cooldown: .16, spread: .009, ammo: 18, reload: 1.3, recoil: .35, penetration: 1, hitscan: true, preferredRange: 36, maxUsefulRange: 220 }),
  weapon("rapid", "burst_rifle", "burst", 0x8dffcf, { damage: 10, burstCount: 3, burstInterval: .065, projectileSpeed: 245, cooldown: .52, spread: .018, ammo: 24, reload: 1.45, recoil: 1.3, hitscan: true }),
  weapon("close", "flamethrower", "flame", 0xff6a24, { damage: 4, projectileSpeed: 0, cooldown: .115, spread: 0, ammo: 48, reload: 1.8, recoil: .08, reach: 11.5, coneAngle: .22, maintained: true }),

  // Full library: explosive
  weapon("explosive", "cluster_grenade", "grenade", 0xff9f68, { damage: 18, projectileSpeed: 15, cooldown: 1.15, ammo: 3, reload: 1.7, recoil: 2.2, radius: 2.8, terrainRadius: 2.3, fuse: 1.05, gravity: 17, bounces: 1, arcLift: 8.5, split: 6 }),
  weapon("explosive", "sticky_launcher", "grenade", 0xff5fa2, { damage: 54, projectileSpeed: 85, cooldown: .85, ammo: 5, reload: 1.55, recoil: 2.2, radius: 5, terrainRadius: 3.8, fuse: 2.4, gravity: 8, sticky: true, projectileRadius: .22 }),
  weapon("explosive", "remote_explosive", "remote", 0xff416c, { damage: 68, projectileSpeed: 82, cooldown: .7, ammo: 4, reload: 1.7, recoil: 1.3, radius: 6.2, terrainRadius: 5.4, gravity: 10, sticky: true, projectileRadius: .25, fuse: 30, maxCharges: 4 }),
  weapon("explosive", "mortar", "grenade", 0xd8b06b, { damage: 64, projectileSpeed: 82, cooldown: 1.45, ammo: 3, reload: 1.9, recoil: 4.2, radius: 6.6, terrainRadius: 6, fuse: 2.2, gravity: 18, bounces: 0, arcLift: 14, presentationPayload: "mortar" }),
  weapon("explosive", "bouncing_bomb", "grenade", 0x8ce6ff, { damage: 48, projectileSpeed: 25, cooldown: 1, ammo: 4, reload: 1.55, recoil: 2, radius: 4.8, terrainRadius: 3.4, fuse: 3.2, gravity: 14, bounces: 8, bounceEnergy: .88, arcLift: 9, presentationPayload: "ricochet" }),
  weapon("explosive", "napalm_launcher", "rocket", 0xff6a2a, { damage: 28, projectileSpeed: 100, cooldown: 1.1, ammo: 4, reload: 1.65, recoil: 3.8, radius: 4.2, terrainRadius: 2.5, hazard: "napalm", hazardDuration: 6, maxActiveHazards: 2 }),
  weapon("explosive", "implosion_bomb", "grenade", 0xa986ff, { damage: 38, projectileSpeed: 17, cooldown: 1.25, ammo: 3, reload: 1.8, recoil: 5, radius: 7.2, terrainRadius: 2, fuse: 1.5, gravity: 16, bounces: 1, arcLift: 8, pull: true }),

  // Full library: energy and precision
  weapon("precision", "laser_beam", "beam", 0xff365d, { damage: 24, projectileSpeed: 0, cooldown: .38, spread: .001, ammo: 10, reload: 1.35, recoil: 1.1 }),
  weapon("precision", "charged_energy_rifle", "rail", 0x79b8ff, { damage: 76, projectileSpeed: 610, cooldown: 1.65, spread: .001, ammo: 3, reload: 2, recoil: 5.4, penetration: 1, hitscan: true, chargeTime: 1.05, minCharge: .18 }),
  weapon("energy", "arc_lightning", "chain", 0x8df7ff, { damage: 27, projectileSpeed: 0, cooldown: .72, ammo: 8, reload: 1.4, recoil: .7, reach: 34, chains: 3 }),
  weapon("energy", "pulse_cannon", "plasma", 0x4c8dff, { damage: 31, projectileSpeed: 125, cooldown: .72, ammo: 7, reload: 1.4, recoil: 5.2, radius: 4.8, terrainRadius: 1.5, projectileRadius: .48, presentationPayload: "pulse" }),
  weapon("energy", "gravity_beam", "beam", 0xbf7cff, { damage: 3.5, projectileSpeed: 0, cooldown: .12, ammo: 30, reload: 1.5, recoil: 0, beamPull: 15, maintained: true, preferredRange: 20, maxUsefulRange: 65 }),
  weapon("precision", "disintegration_weapon", "beam", 0xf5f7ff, { damage: 44, projectileSpeed: 0, cooldown: 1.2, ammo: 4, reload: 1.8, recoil: 2.8, penetration: 4, terrainRadius: 4.5 }),

  // Full library: unusual
  weapon("unusual", "black_hole_generator", "plasma", 0x5d3b99, { damage: 18, projectileSpeed: 90, cooldown: 1.8, ammo: 2, reload: 2.2, recoil: 5, radius: 4, terrainRadius: 2, projectileRadius: .5, hazard: "black_hole", hazardDuration: 5, maxActiveHazards: 2 }),
  weapon("unusual", "freeze_gun", "projectile", 0xa9efff, { damage: 12, projectileSpeed: 92, cooldown: .32, ammo: 14, reload: 1.3, recoil: .5, effect: "freeze", effectDuration: 4.5, projectileRadius: .18 }),
  weapon("unusual", "fireball", "plasma", 0xff5a1f, { damage: 38, projectileSpeed: 32, cooldown: .85, ammo: 6, reload: 1.65, recoil: 2.8, projectileRadius: .36, gravity: 11, arcLift: 6.5, bounces: Infinity, bounceEnergy: 1, presentationPayload: "fireball", minUsefulRange: 3, preferredRange: 20, maxUsefulRange: 72, utilityIntent: "ricochet" }),
  weapon("unusual", "teleport_projectile", "projectile", 0x43ffd1, { damage: 5, projectileSpeed: 130, cooldown: 1.3, ammo: 4, reload: 1.6, recoil: 0, effect: "teleport", projectileRadius: .18 }),
  weapon("unusual", "drill_missile", "rocket", 0xffd45d, { damage: 42, projectileSpeed: 120, cooldown: 1.2, ammo: 3, reload: 1.8, recoil: 3.8, radius: 4.2, terrainRadius: 5, terrainPenetration: 4 }),
  weapon("unusual", "boomerang_blade", "projectile", 0xffa7e6, { damage: 24, projectileSpeed: 74, cooldown: .75, ammo: 6, reload: 1.25, recoil: .8, penetration: 5, returning: .8, projectileRadius: .24 }),
  weapon("unusual", "ricochet_cannon", "projectile", 0x8affc1, { damage: 23, projectileSpeed: 145, cooldown: .5, ammo: 9, reload: 1.35, recoil: 1.6, bounces: 10, bounceEnergy: .94, projectileRadius: .15 }),
  weapon("unusual", "gravity_grenade", "grenade", 0x7d65ff, { damage: 22, projectileSpeed: 15, cooldown: 1.1, ammo: 4, reload: 1.55, recoil: 7, radius: 8, terrainRadius: 1, fuse: 1.35, gravity: 17, bounces: 2, arcLift: 8, pull: true, presentationPayload: "gravity" }),
  weapon("unusual", "tornado_generator", "plasma", 0xb6f6ff, { damage: 10, projectileSpeed: 90, cooldown: 1.5, ammo: 3, reload: 1.9, recoil: 2.5, radius: 3.5, terrainRadius: 0, hazard: "tornado", hazardDuration: 6, hazardSpeed: 7.5, projectileRadius: .4, maxActiveHazards: 2 }),
  weapon("unusual", "temporary_wall", "wall", 0x69e7ff, { damage: 0, projectileSpeed: 85, cooldown: 1.4, ammo: 3, reload: 1.8, recoil: .5, wallDuration: 10, projectileRadius: .2 }),
  weapon("unusual", "decoy_launcher", "decoy", 0xff75d8, { damage: 0, projectileSpeed: 65, cooldown: 1.3, ammo: 3, reload: 1.7, recoil: .4, decoyDuration: 12, projectileRadius: .2 }),
  weapon("unusual", "weapon_stealing_projectile", "projectile", 0xf6ed72, { damage: 8, projectileSpeed: 105, cooldown: 1.1, ammo: 4, reload: 1.6, recoil: .8, effect: "steal", projectileRadius: .2 }),
  weapon("unusual", "grapple_disrupting_pulse", "plasma", 0xff4fb8, { damage: 16, projectileSpeed: 115, cooldown: .85, ammo: 6, reload: 1.45, recoil: 3.5, radius: 6.5, terrainRadius: 0, grappleDisrupt: true, projectileRadius: .4 }),

  // Full library: melee
  weapon("melee", "hammer", "melee", 0xffc05c, { damage: 46, projectileSpeed: 0, cooldown: .9, ammo: 6, reload: 1.25, recoil: 8, reach: 3.3, arc: .55, meleeMotion: "overhead" }),
  weapon("melee", "energy_sword", "melee", 0x53efff, { damage: 34, projectileSpeed: 0, cooldown: .42, ammo: 12, reload: 1.15, recoil: 3, reach: 3.7, arc: .7, meleeMotion: "sweep" }),
  weapon("melee", "chainsaw", "melee", 0xff6b49, { damage: 11, projectileSpeed: 0, cooldown: .13, ammo: 30, reload: 1.55, recoil: 1.2, reach: 2.5, arc: .42, spin: true, maintained: true, meleeMotion: "saw" }),
  weapon("melee", "spear", "melee", 0xd9e9ff, { damage: 39, projectileSpeed: 0, cooldown: .68, ammo: 9, reload: 1.3, recoil: 3.8, reach: 5.5, arc: .25, meleeMotion: "thrust" }),
  weapon("melee", "punch_glove", "melee", 0xff62a8, { damage: 19, projectileSpeed: 0, cooldown: .55, ammo: 10, reload: 1.25, recoil: 11, reach: 3.1, arc: .5, meleeMotion: "punch" }),
  weapon("melee", "shock_baton", "melee", 0x9d8cff, { damage: 24, projectileSpeed: 0, cooldown: .5, ammo: 10, reload: 1.3, recoil: 2.4, reach: 3.2, arc: .55, effect: "freeze", effectDuration: 1.5, meleeMotion: "shock" }),
  weapon("melee", "knife", "melee", 0xe7edf5, { damage: 27, projectileSpeed: 0, cooldown: .28, ammo: 16, reload: 1.1, recoil: 1.4, reach: 2.6, arc: .35, executeThreshold: 30, meleeMotion: "stab" })
];

export const WEAPONS = Object.fromEntries(weaponList.map((entry) => [entry.id, entry]));

export function swapStolenWeapon(attacker, target, stealingWeaponId, attackerSlot, targetSlot) {
  if (!attacker?.loadout || !target?.loadout || !WEAPONS[stealingWeaponId]) return null;
  if (attacker.loadout[attackerSlot] !== stealingWeaponId) return null;
  const stolenId = target.loadout[targetSlot];
  if (!WEAPONS[stolenId] || stolenId === stealingWeaponId) return null;
  const attackerDuplicateSlot = attacker.loadout.findIndex((id, index) => id === stolenId && index !== attackerSlot);
  const targetDuplicateSlot = target.loadout.findIndex((id, index) => id === stealingWeaponId && index !== targetSlot);
  const stolenAmmo = target.ammo[stolenId] ?? 0;
  const transferAmmo = attacker.ammo[stealingWeaponId] ?? 0;
  if (attackerDuplicateSlot >= 0) attacker.loadout[attackerDuplicateSlot] = stealingWeaponId;
  if (targetDuplicateSlot >= 0) target.loadout[targetDuplicateSlot] = stolenId;
  attacker.loadout[attackerSlot] = stolenId;
  target.loadout[targetSlot] = stealingWeaponId;
  attacker.ammo[stolenId] = stolenAmmo;
  target.ammo[stealingWeaponId] = transferAmmo;
  return { stolenId, attackerSlot, targetSlot };
}

export function excessOwnedProjectiles(projectiles, owner, weaponId, limit) {
  const owned = projectiles
    .filter((shot) => shot.owner === owner && shot.weapon?.id === weaponId)
    .sort((a, b) => b.age - a.age);
  return owned.slice(0, Math.max(0, owned.length - Math.max(0, limit)));
}

export const DEFAULT_LOADOUT = LOADOUT_SLOTS.map((slot) => slot.defaultWeapon);
const GRAPHICS_LEVELS = new Set(["low", "medium", "high"]);

export function graphicsProfile(level = "high", coarsePointer = false, deviceScale = 1) {
  const resolved = GRAPHICS_LEVELS.has(level) ? level : "high";
  const pixelCap = resolved === "low" ? 1 : resolved === "medium" ? 1.3 : 1.65;
  const combatQuality = resolved === "low" ? .5
    : resolved === "medium" ? .75 : 1;
  return { level: resolved, pixelRatio: Math.min(Math.max(.5, Number(deviceScale) || 1), pixelCap), combatQuality };
}

function validLoadout(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => WEAPONS[id]))].slice(0, LOADOUT_SLOTS.length) : [];
}

export function activePresetLoadout(settings) {
  const index = settings?.defaultLoadoutPreset;
  if (!Number.isInteger(index) || index < 0 || index >= LOADOUT_PRESET_COUNT) return null;
  const loadout = validLoadout(settings.loadoutPresets?.[index]?.weaponIds);
  return loadout.length === LOADOUT_SLOTS.length ? loadout : null;
}

export function randomLoadout(random = Math.random) {
  const pool = Object.keys(WEAPONS);
  for (let index = pool.length - 1; index >= pool.length - LOADOUT_SLOTS.length; index--) {
    const pick = Math.floor(random() * (index + 1));
    [pool[index], pool[pick]] = [pool[pick], pool[index]];
  }
  return pool.slice(-LOADOUT_SLOTS.length);
}

export function projectileLifetime(weapon) {
  return weapon.fuse ?? Infinity;
}

export function weaponFireMode(weapon) {
  if (["spread", "burst", "mine", "beam", "chain", "flame", "melee"].includes(weapon.type)) return weapon.type;
  return weapon.hitscan ? "hitscan" : "projectile";
}

export function weaponUsesAmmo(weapon) {
  return weapon?.type !== "melee";
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

const MAJOR_STRUCTURAL_TOWERS = [
  [42, 31, -22, 34, 26, 1.5], [-42, 47, 30, 32, 28, 1.5],
  [-52, 15, -48, 34, 26, 1.4], [53, 15, 49, 34, 26, 1.4],
  [54, 31, 33, 30, 22, 1.4], [-53, 47, -27, 30, 22, 1.4]
];
const SEEDED_STRUCTURAL_SITES = [
  [-84, -34], [84, 34], [-34, -82], [34, 82], [-84, 72],
  [84, -72], [-18, 62], [18, -62], [-67, -6], [67, 6]
];

export function structuralTowerBlueprints(seed, random = seededRandom(seedFromText(seed))) {
  const towers = MAJOR_STRUCTURAL_TOWERS.map(([x, top, z, w, d, thickness]) => ({
    x, z, top, w, d, thickness, segmentCount: Math.ceil(top / 6), pillarWidth: 8.4, major: true
  }));
  SEEDED_STRUCTURAL_SITES.forEach(([x, z], index) => {
    const segmentCount = 3 + Math.floor(random() * 6);
    const wideX = index % 2 === 0;
    towers.push({
      x, z, top: segmentCount * 4, w: wideX ? 14 : 11, d: wideX ? 11 : 14,
      thickness: 1.15, segmentCount, pillarWidth: 4.2 + (segmentCount % 2) * .7, major: false
    });
  });
  return towers;
}

export function structuralPartBounds(seed, partId) {
  const match = /^structure-(\d+)-(pillar|platform)-(\d+)$/.exec(String(partId || ""));
  if (!match) return null;
  const tower = structuralTowerBlueprints(seed)[Number(match[1]) - 1];
  if (!tower) return null;
  const partIndex = Number(match[3]) - 1;
  if (match[2] === "pillar") {
    if (partIndex < 0 || partIndex >= tower.segmentCount) return null;
    const h = tower.top / tower.segmentCount;
    return { x: tower.x, z: tower.z, baseY: partIndex * h, top: (partIndex + 1) * h, w: tower.pillarWidth, d: tower.pillarWidth };
  }
  const columns = Math.max(3, Math.min(5, Math.round(tower.w / 7)));
  const rows = Math.max(3, Math.min(5, Math.round(tower.d / 7)));
  if (partIndex < 0 || partIndex >= columns * rows) return null;
  const w = tower.w / columns, d = tower.d / rows;
  const column = partIndex % columns, row = Math.floor(partIndex / columns);
  return {
    x: tower.x - tower.w / 2 + w * (column + .5), z: tower.z - tower.d / 2 + d * (row + .5),
    baseY: tower.top - tower.thickness, top: tower.top, w, d
  };
}

function defaults() {
  return {
    displayName: TEXT.defaults.displayName,
    blood: "reduced",
    graphics: "high",
    shake: 60,
    reducedMotion: false,
    volume: 70,
    musicVolume: 70,
    effectsVolume: 85,
    ambienceVolume: 65,
    dynamicRange: "standard",
    botCount: 1,
    matchSettingsVersion: MATCH_SETTINGS_VERSION,
    matchSettings: structuredClone(MATCH_SETTINGS_DEFAULTS),
    loadout: [...DEFAULT_LOADOUT],
    loadoutPresets: Array(LOADOUT_PRESET_COUNT).fill(null),
    defaultLoadoutPreset: null
  };
}

export function loadSettings() {
  try {
    const current = localStorage.getItem(SAVE_KEY);
    const legacy = current == null ? LEGACY_SAVE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean) : null;
    const saved = JSON.parse(current ?? legacy ?? "{}");
    if (current == null && legacy) localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    const loadout = validLoadout(saved.loadout);
    for (const id of DEFAULT_LOADOUT) if (loadout.length < LOADOUT_SLOTS.length && !loadout.includes(id)) loadout.push(id);
    const loadoutPresets = Array.from({ length: LOADOUT_PRESET_COUNT }, (_, index) => {
      const preset = saved.loadoutPresets?.[index];
      const weaponIds = validLoadout(preset?.weaponIds);
      if (weaponIds.length !== LOADOUT_SLOTS.length) return null;
      return {
        name: String(preset.name || formatText(TEXT.defaults.presetName, { number: index + 1 })).trim().slice(0, 18) || formatText(TEXT.defaults.presetName, { number: index + 1 }),
        weaponIds
      };
    });
    const defaultLoadoutPreset = Number.isInteger(saved.defaultLoadoutPreset) && loadoutPresets[saved.defaultLoadoutPreset]
      ? saved.defaultLoadoutPreset
      : null;
    const graphics = GRAPHICS_LEVELS.has(saved.graphics) ? saved.graphics : "high";
    const matchSettings = Object.fromEntries(Object.entries(MATCH_SETTINGS_DEFAULTS).map(([mode, fallback]) => {
      const remembered = saved.matchSettings?.[mode] || {};
      const difficulty = remembered.botDifficulty === "hard" ? "veteran" : remembered.botDifficulty;
      const parsedBotCount = Number(remembered.botCount);
      const minimumBots = mode === "private" ? 0 : 1;
      const legacyPrivateDefault = mode === "private" && saved.matchSettingsVersion !== MATCH_SETTINGS_VERSION && parsedBotCount === 1;
      return [mode, {
        botCount: legacyPrivateDefault ? 0 : Math.max(minimumBots, Math.min(15, Math.trunc(Number.isFinite(parsedBotCount) ? parsedBotCount : fallback.botCount))),
        botDifficulty: ["rookie", "normal", "veteran"].includes(difficulty) ? difficulty : fallback.botDifficulty,
        seed: String(remembered.seed ?? fallback.seed).trim().toUpperCase().slice(0, 12),
        timeLimitMinutes: clampMatchMinutes(remembered.timeLimitMinutes, fallback.timeLimitMinutes)
      }];
    }));
    return { ...defaults(), ...saved, graphics, loadout, loadoutPresets, defaultLoadoutPreset, matchSettingsVersion: MATCH_SETTINGS_VERSION, matchSettings };
  } catch {
    return defaults();
  }
}

export { clampMatchMinutes };

export function saveSettings(settings) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(settings));
}
