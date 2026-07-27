import { WEAPONS } from "./gameData.js";

export function chooseBotSlot(loadout, distance, random = Math.random) {
  const scored = loadout.map((id, index) => {
    const weapon = WEAPONS[id];
    let score = random() * .25;
    if (weapon.type === "spread") score += distance < 11 ? 1.4 : -.6;
    else if (weapon.type === "mine") score += distance < 8 ? .9 : -.8;
    else if (weapon.type === "grenade") score += distance > 9 && distance < 24 ? 1.05 : 0;
    else if (weapon.type === "rocket" || weapon.type === "plasma") score += distance > 10 ? .9 : -.7;
    else if (weapon.type === "rail") score += distance > 18 ? 1.15 : 0;
    else score += .65;
    return { index, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].index;
}

export function botFireChance(distance, visible, weapon) {
  if (!visible && weapon.type !== "grenade") return 0;
  if (weapon.type === "mine") return distance < 7 ? .045 : 0;
  if (weapon.type === "spread") return distance < 15 ? .18 : .015;
  if (weapon.type === "rail") return .025;
  return .09;
}
