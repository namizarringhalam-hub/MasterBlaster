import { WEAPONS } from "./gameData.js";

export function clampBotCount(value) {
  return Math.min(15, Math.max(1, Math.round(Number(value) || 1)));
}

export function nearestTarget(bot, players) {
  let target = null;
  let closest = Infinity;
  for (const player of players) {
    if (player === bot || !player.alive) continue;
    const distance = bot.position.distanceToSquared(player.position);
    if (distance < closest) {
      closest = distance;
      target = player;
    }
  }
  return target;
}

export function safestSpawn(spawns, players, respawningPlayer) {
  const opponents = players.filter((player) => player !== respawningPlayer && player.alive);
  if (!opponents.length) return spawns[0];
  const safety = (spawn) => Math.min(...opponents.map((player) => spawn.distanceToSquared(player.position)));
  return [...spawns].sort((a, b) => safety(b) - safety(a))[0];
}

function fallbackPolicy(weapon) {
  if (weapon.type === "melee") return { min: 0, preferred: weapon.reach * .78, max: weapon.reach + 1, intent: "melee" };
  if (weapon.type === "flame") return { min: 0, preferred: weapon.reach * .62, max: weapon.reach, intent: "flame" };
  if (weapon.id === "shotgun") return { min: 0, preferred: 7, max: 16, intent: "close" };
  if (weapon.id === "submachine_gun") return { min: 0, preferred: 12, max: 34, intent: "close" };
  if (weapon.id === "minigun") return { min: 5, preferred: 19, max: 46, intent: "suppress" };
  if (weapon.id === "ricochet_cannon") return { min: 4, preferred: 22, max: 70, intent: "ricochet" };
  if (weapon.type === "mine") return { min: 0, preferred: 3, max: 7, intent: "trap" };
  if (weapon.type === "wall") return { min: 3, preferred: 14, max: 36, intent: "cover" };
  if (weapon.type === "decoy") return { min: 3, preferred: 18, max: 42, intent: "decoy" };
  if (weapon.type === "remote") return { min: 6, preferred: 18, max: 40, intent: "remote" };
  if (weapon.type === "grenade") return { min: 7, preferred: 18, max: 34, intent: "area" };
  if (weapon.type === "rocket" || weapon.type === "plasma") return { min: 7, preferred: 25, max: 70, intent: "area" };
  if (weapon.type === "rail" || weapon.type === "beam") return { min: 8, preferred: 38, max: 140, intent: "precision" };
  if (weapon.type === "chain") return { min: 4, preferred: 22, max: weapon.reach || 34, intent: "control" };
  if (weapon.type === "spread") return { min: 3, preferred: 18, max: 58, intent: "burst" };
  return { min: 0, preferred: 24, max: 120, intent: "damage" };
}

function finiteRange(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizedIntent(intent, fallback) {
  const value = typeof intent === "string" ? intent.trim().toLowerCase() : "";
  return ({ distraction: "decoy", defence: "cover", defense: "cover", bankshot: "ricochet" })[value] || value || fallback;
}

export function botWeaponPolicy(weapon) {
  const fallback = fallbackPolicy(weapon);
  const min = finiteRange(weapon.minUsefulRange, fallback.min);
  const max = Math.max(min, finiteRange(weapon.maxUsefulRange, fallback.max));
  const preferred = Math.min(max, Math.max(min, finiteRange(weapon.preferredRange, fallback.preferred)));
  const intent = normalizedIntent(weapon.utilityIntent, fallback.intent);
  return { min, preferred, max, intent };
}

export function shouldBotPlaceWall(weapon, {
  distance = Infinity,
  visible = false,
  healthFraction = 1,
  underPressure = false,
  wallNearby = false,
  ammo = 0
} = {}) {
  if (!weapon || (weapon.type !== "wall" && botWeaponPolicy(weapon).intent !== "cover")) return false;
  const policy = botWeaponPolicy(weapon);
  if (!visible || wallNearby || ammo <= 0 || distance < policy.min || distance > policy.max) return false;
  return underPressure || healthFraction <= .58 || distance <= policy.preferred * 1.2;
}

export function botRemoteChargeAction(weapon, {
  targetDistance = Infinity,
  visible = false,
  armedChargeDistances = [],
  ammo = 0,
  maxCharges = 3
} = {}) {
  if (!weapon || weapon.type !== "remote") return "hold";
  const armed = armedChargeDistances.filter(Number.isFinite);
  const blastRadius = Math.max(.1, weapon.radius || 5);
  if (armed.some((distance) => distance <= blastRadius * .92)) return "detonate";
  const policy = botWeaponPolicy(weapon);
  const usefulPlacement = visible && targetDistance >= policy.min && targetDistance <= policy.max;
  return usefulPlacement && ammo > 0 && armed.length < Math.max(1, maxCharges) ? "place" : "hold";
}

function rangeScore(distance, { min, preferred, max }) {
  if (distance < min) return -1.15 - (min - distance) / Math.max(2, min);
  if (distance > max) return -1.25 - (distance - max) / Math.max(8, max * .5);
  const span = Math.max(4, distance <= preferred ? preferred - min : max - preferred);
  return 1.15 - Math.abs(distance - preferred) / span * .55;
}

export function chooseBotSlot(loadout, distance, random = Math.random) {
  const scored = loadout.map((id, index) => {
    const weapon = WEAPONS[id];
    const policy = botWeaponPolicy(weapon);
    let score = random() * .25 + rangeScore(distance, policy);
    if (policy.intent === "melee") score += distance <= weapon.reach + 1 ? .75 : -.65;
    else if (policy.intent === "flame") score += distance <= weapon.reach ? .65 : -.75;
    else if (policy.intent === "close") score += distance <= policy.preferred ? .38 : 0;
    else if (policy.intent === "trap") score += distance < 7 ? .38 : -.18;
    else if (["cover", "decoy", "remote", "ricochet"].includes(policy.intent)) score += .18;
    else if (["area", "control", "suppress"].includes(policy.intent)) score += .12;
    return { index, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].index;
}

export function botFireChance(distance, visible, weapon) {
  if (!visible && weapon.type !== "grenade") return 0;
  const policy = botWeaponPolicy(weapon);
  if (distance < policy.min || distance > policy.max) return 0;
  const rangeFactor = .55 + Math.max(0, 1 - Math.abs(distance - policy.preferred) / Math.max(4, policy.max - policy.min)) * .45;
  if (policy.intent === "melee") return distance <= weapon.reach + 1 ? .28 * rangeFactor : 0;
  if (policy.intent === "flame") return distance <= weapon.reach ? .24 * rangeFactor : 0;
  if (policy.intent === "trap") return .045 * rangeFactor;
  if (policy.intent === "cover" || policy.intent === "decoy") return .03 * rangeFactor;
  if (policy.intent === "remote") return .04 * rangeFactor;
  if (policy.intent === "ricochet") return .06 * rangeFactor;
  if (weapon.type === "spread") return .18 * rangeFactor;
  if (["rail", "beam", "chain"].includes(weapon.type)) return .025 * rangeFactor;
  return .09 * rangeFactor;
}
