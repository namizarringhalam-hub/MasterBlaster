import { GAME_CONFIG } from "../GAME_CONFIG.js";

export function projectileHitRadius(weapon) {
  return weapon.projectileRadius ?? (weapon.type === "rocket" ? .25 : weapon.type === "plasma" ? .42 : weapon.type === "grenade" ? .28 : .11);
}

// Reproduce each weapon family's gameplay firing line on the server. The
// forward muzzle offset does not change that line, so it need not be animated.
export function combatShotOrigin(player, weapon, direction) {
  const muzzle = weapon.hitscan || weapon.type === "flame";
  const flat = Math.hypot(direction.x, direction.z);
  return {
    x: player.position.x + (muzzle && flat > .001 ? direction.z / flat * .5 : 0),
    y: player.position.y + (muzzle ? 1.43 : weapon.type === "melee" ? 1.15 : 1.25),
    z: player.position.z - (muzzle && flat > .001 ? direction.x / flat * .5 : 0),
  };
}

// Matches the upper hit sphere used by hitscanTargets and reticleAim. The neck
// overlap remains a body hit; helmet animation never changes the gameplay hull.
export function headContact(target, point, projectileRadius = 0) {
  if (!point || target.isDecoy) return false;
  const y = point.y - target.position.y;
  return y >= 1.9 && Math.hypot(point.x - target.position.x, y - 2.08, point.z - target.position.z)
    <= .72 * .72 + projectileRadius + .001;
}

export function aimedHeadContact(target, origin, direction) {
  if (!origin || !direction || target.isDecoy) return null;
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (!magnitude) return null;
  const aim = { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude };
  let nearest = Infinity;
  for (const [height, radius] of [[.55, .72 * .72], [1.2, .72], [2.08, .72 * .72]]) {
    const x = target.position.x - origin.x, y = target.position.y + height - origin.y, z = target.position.z - origin.z;
    const along = x * aim.x + y * aim.y + z * aim.z;
    const discriminant = radius * radius - (x * x + y * y + z * z - along * along);
    if (discriminant < 0) continue;
    const entry = along - Math.sqrt(discriminant);
    if (entry >= 0) nearest = Math.min(nearest, entry);
  }
  if (!Number.isFinite(nearest)) return null;
  const point = { x: origin.x + aim.x * nearest, y: origin.y + aim.y * nearest, z: origin.z + aim.z * nearest };
  return headContact(target, point) ? point : null;
}

export function headshotDamage(damage, headshot) {
  return damage * (headshot ? GAME_CONFIG.headshotDamageMultiplier : 1);
}
