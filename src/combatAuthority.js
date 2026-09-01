import { structuralPartBounds, structuralTowerBlueprints, weaponFireMode } from "./gameData.js";

const PLAYER_RADIUS = .72;
const TARGET_HEIGHT = 1.05;

function subtract(left, right) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector) {
  const magnitude = length(vector);
  return magnitude > .0001
    ? { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
    : { x: 0, y: 0, z: 1 };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function targetPoint(target) {
  return { x: target.position.x, y: target.position.y + TARGET_HEIGHT, z: target.position.z };
}

function segmentIntersectsBounds(start, end, bounds) {
  const direction = subtract(end, start);
  let minimum = 0;
  let maximum = 1;
  for (const [axis, low, high] of [
    ["x", bounds.x - bounds.w / 2, bounds.x + bounds.w / 2],
    ["y", bounds.baseY, bounds.top],
    ["z", bounds.z - bounds.d / 2, bounds.z + bounds.d / 2]
  ]) {
    if (Math.abs(direction[axis]) < .00001) {
      if (start[axis] < low || start[axis] > high) return false;
      continue;
    }
    const first = (low - start[axis]) / direction[axis];
    const second = (high - start[axis]) / direction[axis];
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return false;
  }
  return maximum > .001 && minimum < .985;
}

export function lineBlockedByStructure(start, end, seed, structuralHealth = new Map()) {
  const towers = structuralTowerBlueprints(seed);
  for (let towerIndex = 0; towerIndex < towers.length; towerIndex++) {
    const tower = towers[towerIndex];
    const structureId = `structure-${towerIndex + 1}`;
    const columns = Math.max(3, Math.min(5, Math.round(tower.w / 7)));
    const rows = Math.max(3, Math.min(5, Math.round(tower.d / 7)));
    for (const [kind, count] of [["pillar", tower.segmentCount], ["platform", columns * rows]]) {
      for (let part = 1; part <= count; part++) {
        const partId = `${structureId}-${kind}-${part}`;
        if ((structuralHealth.get(partId) ?? 1) <= 0) continue;
        const bounds = structuralPartBounds(seed, partId);
        if (bounds && segmentIntersectsBounds(start, end, bounds)) return true;
      }
    }
  }
  return false;
}

export function playerCapsuleIntersectsStructure(position, seed, structuralHealth = new Map()) {
  const towers = structuralTowerBlueprints(seed);
  for (let towerIndex = 0; towerIndex < towers.length; towerIndex++) {
    const tower = towers[towerIndex];
    const structureId = `structure-${towerIndex + 1}`;
    const columns = Math.max(3, Math.min(5, Math.round(tower.w / 7)));
    const rows = Math.max(3, Math.min(5, Math.round(tower.d / 7)));
    for (const [kind, count] of [["pillar", tower.segmentCount], ["platform", columns * rows]]) {
      for (let part = 1; part <= count; part++) {
        const partId = `${structureId}-${kind}-${part}`;
        if ((structuralHealth.get(partId) ?? 1) <= 0) continue;
        const bounds = structuralPartBounds(seed, partId);
        if (bounds && Math.abs(position.x - bounds.x) < bounds.w / 2 + PLAYER_RADIUS &&
          Math.abs(position.z - bounds.z) < bounds.d / 2 + PLAYER_RADIUS &&
          position.y < bounds.top && position.y + 2.25 > bounds.baseY) return true;
      }
    }
  }
  return false;
}

export function weaponAuthorityStrategy(weapon) {
  const mode = weaponFireMode(weapon);
  if (mode === "melee") return "melee";
  if (mode === "flame") return "cone";
  if (mode === "chain") return "chain";
  if (["hitscan", "beam", "burst"].includes(mode)) return "ray";
  return weapon.radius ? "explosive" : "projectile";
}

export function hitProposalLimit(weapon) {
  if (weapon.hazard) return 32;
  return Math.max(1, weapon.pellets || 0, weapon.burstCount || 0, weapon.chains || 0, (weapon.penetration || 0) + 1);
}

function shotLifetimeMs(weapon) {
  return Math.min(40_000, 1_800 + 1000 * Math.max(0, weapon.fuse || weapon.hazardDuration || 0));
}

function canonicalPush(weapon, from, to, factor = 1) {
  const direction = normalize(subtract(to, from));
  const signed = weapon.pull ? -1 : 1;
  const strength = Math.min(40, (weapon.radius ? 8 + weapon.recoil : weapon.recoil * 1.7) * factor);
  return { x: direction.x * strength * signed, y: Math.max(0, direction.y * strength + (weapon.radius ? .18 * strength : 0)), z: direction.z * strength * signed };
}

function followsAuthoritativeProjectilePath(shot, impact, weapon, ageMs) {
  const speed = Math.max(0, weapon.projectileSpeed || 0);
  if (!speed || weapon.bounces || weapon.returning) return true;
  const direction = normalize(shot.direction);
  const offset = subtract(impact, shot.origin);
  const maximumTime = Math.min(ageMs / 1000 + .25, 3.5);
  const tolerance = 3.5 + (weapon.projectileRadius || .2);
  if (!weapon.gravity && !weapon.arcLift) {
    const distanceAlongShot = Math.max(0, Math.min(speed * maximumTime, dot(offset, direction)));
    const nearest = {
      x: shot.origin.x + direction.x * distanceAlongShot,
      y: shot.origin.y + direction.y * distanceAlongShot,
      z: shot.origin.z + direction.z * distanceAlongShot
    };
    return length(subtract(impact, nearest)) <= tolerance + distanceAlongShot * (weapon.spread || 0);
  }
  const steps = 96;
  let nearestDistance = Infinity;
  for (let index = 0; index <= steps; index++) {
    const time = maximumTime * index / steps;
    const expected = {
      x: shot.origin.x + direction.x * speed * time,
      y: shot.origin.y + (direction.y * speed + (weapon.arcLift || 0)) * time - .5 * (weapon.gravity || 0) * time ** 2,
      z: shot.origin.z + direction.z * speed * time
    };
    nearestDistance = Math.min(nearestDistance, length(subtract(impact, expected)));
  }
  return nearestDistance <= tolerance + speed * maximumTime / steps;
}

export function validateImpactProposal({ shot, weapon, impact, now = Date.now() }) {
  if (!shot || !weapon || !impact || shot.weaponId !== weapon.id) return false;
  const ageMs = now - shot.firedAt;
  if (ageMs < 0 || ageMs > shotLifetimeMs(weapon)) return false;
  const offset = subtract(impact, shot.origin);
  const distance = length(offset);
  const direction = normalize(shot.direction);
  const strategy = weaponAuthorityStrategy(weapon);
  if (["ray", "melee", "cone", "chain"].includes(strategy)) {
    const allowedRange = strategy === "melee" || strategy === "cone"
      ? (weapon.reach || 3) + 1
      : strategy === "chain" ? (weapon.reach || 34) + 1 : (weapon.maxUsefulRange || 240) + 1;
    if (distance > allowedRange) return false;
    const allowedAngle = strategy === "melee"
      ? Math.acos(Math.max(-1, Math.min(1, 1 - (weapon.arc || .3))))
      : strategy === "cone" ? (weapon.coneAngle || .34) : (weapon.spread || 0) + .055;
    return distance < 1 || dot(direction, normalize(offset)) >= Math.cos(allowedAngle);
  }
  const speed = Math.max(0, weapon.projectileSpeed || 0);
  const possibleTravel = speed ? speed * (ageMs / 1000) + 3.5 + (weapon.radius || 0) : 4 + (weapon.radius || 0);
  const maximumRange = (weapon.maxUsefulRange || Math.max(16, speed * Math.max(1, weapon.fuse || 3))) + 20;
  return distance <= Math.min(maximumRange, possibleTravel) && followsAuthoritativeProjectilePath(shot, impact, weapon, ageMs);
}

export function validateHitProposal({ shot, attacker, target, weapon, impact, phase = "impact", now = Date.now(), seed = "", structuralHealth = new Map() }) {
  if (!shot || !attacker?.alive || !target?.alive || !(weapon?.damage > 0) || shot.playerId !== attacker.id || shot.weaponId !== weapon.id) return null;
  const ageMs = now - shot.firedAt;
  if (ageMs < 0 || ageMs > shotLifetimeMs(weapon)) return null;
  const origin = shot.origin;
  const targetCenter = targetPoint(target);
  const offset = subtract(targetCenter, origin);
  const distance = length(offset);
  const direction = normalize(shot.direction);
  const strategy = weaponAuthorityStrategy(weapon);
  const damageScale = shot.damageScale || 1;
  const canonicalDamage = weapon.damage * damageScale;

  if (strategy === "ray" || strategy === "melee" || strategy === "cone") {
    const allowedRange = strategy === "melee" || strategy === "cone"
      ? (weapon.reach || 3) + PLAYER_RADIUS
      : (weapon.maxUsefulRange || 240) + PLAYER_RADIUS;
    if (distance > allowedRange || lineBlockedByStructure(origin, targetCenter, seed, structuralHealth)) return null;
    const angularRadius = Math.asin(Math.min(.95, PLAYER_RADIUS / Math.max(PLAYER_RADIUS, distance)));
    const allowedAngle = strategy === "melee"
      ? Math.acos(Math.max(-1, Math.min(1, 1 - (weapon.arc || .3))))
      : strategy === "cone" ? (weapon.coneAngle || .34) : (weapon.spread || 0) + angularRadius + .035;
    if (dot(direction, normalize(offset)) < Math.cos(allowedAngle)) return null;
    const factor = strategy === "cone" ? Math.max(.18, 1 - distance / allowedRange) : 1;
    const damage = weapon.executeThreshold && target.health <= weapon.executeThreshold
      ? target.health
      : Math.max(1, Math.ceil(canonicalDamage * factor));
    return { damage, push: canonicalPush(weapon, origin, targetCenter, factor), strategy };
  }

  if (strategy === "chain") {
    const priorPositions = shot.hitPositions || [];
    const from = priorPositions.at(-1) || origin;
    const maximumDistance = priorPositions.length ? 14 + PLAYER_RADIUS : (weapon.reach || 34) + PLAYER_RADIUS;
    if (length(subtract(targetCenter, from)) > maximumDistance || lineBlockedByStructure(from, targetCenter, seed, structuralHealth)) return null;
    if (!priorPositions.length && dot(direction, normalize(offset)) <= .45) return null;
    const jump = priorPositions.length;
    return { damage: Math.max(1, Math.ceil(canonicalDamage * .72 ** jump)), push: canonicalPush(weapon, from, targetCenter, .72 ** jump), strategy };
  }

  if (!impact) return null;
  if (!validateImpactProposal({ shot, weapon, impact, now })) return null;

  const targetDistance = length(subtract(targetCenter, impact));
  if (strategy === "projectile") {
    if (targetDistance > PLAYER_RADIUS + (weapon.projectileRadius || .2) + .7) return null;
    return { damage: Math.max(1, Math.ceil(canonicalDamage)), push: canonicalPush(weapon, origin, targetCenter), strategy };
  }

  const radius = weapon.radius || 0;
  if (targetDistance > radius + PLAYER_RADIUS || lineBlockedByStructure(impact, targetCenter, seed, structuralHealth)) return null;
  const factor = Math.max(0, 1 - Math.max(0, targetDistance - PLAYER_RADIUS) / Math.max(.01, radius));
  if (phase === "hazard" && weapon.hazard) {
    const perTick = weapon.hazard === "napalm" ? 4 * (.35 + factor * .65)
      : weapon.hazard === "black_hole" ? 2 * (.35 + factor * .65)
        : .6 + factor * .8;
    return { damage: Math.max(1, Math.ceil(perTick * (target.id === attacker.id ? .35 : 1))), push: canonicalPush(weapon, impact, targetCenter, factor), strategy: "hazard" };
  }
  return {
    damage: Math.max(1, Math.ceil(canonicalDamage * factor * (target.id === attacker.id ? .35 : 1))),
    push: canonicalPush(weapon, impact, targetCenter, factor), strategy
  };
}
