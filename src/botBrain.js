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

export function chooseBotSlot(loadout, distance, random = Math.random) {
  const scored = loadout.map((id, index) => {
    const weapon = WEAPONS[id];
    let score = random() * .25;
    if (weapon.type === "melee") score += distance <= weapon.reach + 1 ? 1.7 : -1.2;
    else if (weapon.type === "spread") score += distance < 11 ? 1.4 : -.6;
    else if (weapon.type === "mine") score += distance < 8 ? .9 : -.8;
    else if (weapon.type === "grenade") score += distance > 9 && distance < 24 ? 1.05 : 0;
    else if (weapon.type === "rocket" || weapon.type === "plasma") score += distance > 10 ? .9 : -.7;
    else if (["rail", "beam", "chain"].includes(weapon.type)) score += distance > 16 ? 1.15 : 0;
    else if (["wall", "decoy", "remote"].includes(weapon.type)) score += .35;
    else score += .65;
    return { index, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].index;
}

export function botFireChance(distance, visible, weapon) {
  if (!visible && weapon.type !== "grenade") return 0;
  if (weapon.type === "melee") return distance <= weapon.reach + 1 ? .28 : 0;
  if (weapon.type === "mine") return distance < 7 ? .045 : 0;
  if (weapon.type === "spread") return distance < 15 ? .18 : .015;
  if (["rail", "beam", "chain"].includes(weapon.type)) return .025;
  if (["wall", "decoy", "remote"].includes(weapon.type)) return .035;
  return .09;
}
