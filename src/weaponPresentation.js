const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const profileCache = new WeakMap();

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deliveryOf(weapon) {
  if (weapon.returning) return "disc";
  if (weapon.type === "remote") return "grenade";
  return weapon.type || "projectile";
}

function payloadOf(weapon) {
  if (weapon.presentationPayload) return weapon.presentationPayload;
  if (weapon.hazard === "black_hole" || weapon.beamPull) return "gravity";
  if (weapon.pull) return "implosion";
  if (weapon.hazard) return weapon.hazard;
  if (weapon.effect) return weapon.effect;
  if (weapon.grappleDisrupt) return "disrupt";
  if (weapon.type === "wall") return "wall";
  if (weapon.type === "decoy") return "decoy";
  if (weapon.split) return "cluster";
  if (weapon.sticky || weapon.type === "remote") return "sticky";
  if (weapon.terrainPenetration) return "drill";
  if (weapon.returning) return "returning";
  if (weapon.bounces && weapon.type === "projectile") return "ricochet";
  if (weapon.penetration) return "penetrator";
  if (weapon.energy || weapon.category === "Energy") return "energy";
  if (weapon.type === "projectile" && weapon.projectileRadius >= .16) return "energy";
  if (weapon.type === "chain") return "arc";
  if (weapon.type === "melee") return "melee";
  if (weapon.radius) return "blast";
  if (["plasma", "beam", "rail"].includes(weapon.type)) return "energy";
  return "kinetic";
}

export function weaponPresentation(weapon = {}) {
  const cached = weapon && typeof weapon === "object" ? profileCache.get(weapon) : null;
  if (cached) return cached;
  const delivery = deliveryOf(weapon);
  const payload = payloadOf(weapon);
  const signatureHash = stableHash(weapon.id || `${delivery}-${payload}`);
  const signature = (signatureHash & 0xffff) / 0xffff;
  const tempo = weapon.cooldown <= .13 ? "rapid" : weapon.cooldown >= 1 ? "heavy" : "standard";
  const speed = Math.max(0, weapon.projectileSpeed || 0);
  const blast = Math.max(0, weapon.radius || 0);
  const weight = clamp((weapon.damage || 0) / 92 + (weapon.recoil || 0) / 16 + blast / 15, .12, 1.35);
  const energy = ["plasma", "beam", "rail", "chain"].includes(delivery)
    || ["gravity", "implosion", "freeze", "fireball", "teleport", "steal", "disrupt", "energy", "arc"].includes(payload);
  const precision = delivery === "rail" || delivery === "beam" || payload === "penetrator";
  const rapid = tempo === "rapid" || speed >= 180;
  const trailLength = clamp((.55 + speed * .021 + weight * .55) * (.92 + signature * .16), .65, precision ? 7.2 : 5.6);
  const trailWidth = clamp((.075 + weight * .07 + (rapid ? .025 : 0)) * (.94 + signature * .12), .08, .24);
  const muzzleLength = clamp(.78 + weight * .92 + (precision ? .7 : 0), .78, 2.45);
  const muzzleWidth = clamp(.12 + weight * .17 + (delivery === "grenade" ? .06 : 0), .12, .4);
  const impactScale = clamp(.82 + weight * 1.15 + blast * .05, .85, 2.7);
  const audioPitch = clamp(210 + speed * 1.35 + signature * 95 - weight * 105, 80, 980);
  const audioDuration = clamp(.045 + weight * .13 + (tempo === "heavy" ? .08 : 0), .045, .28);
  const audioNoise = clamp(.18 + (energy ? -.08 : .2) + weight * .34, .08, .72);

  const profile = Object.freeze({
    delivery, payload, tempo, weight, energy, precision, rapid,
    signature, variant: signatureHash % 3,
    trailLength, trailWidth, muzzleLength, muzzleWidth, impactScale,
    audioPitch, audioDuration, audioNoise,
    audioSlide: energy ? 1.35 + signature * .55 : .32 + signature * .24
  });
  if (weapon && typeof weapon === "object") profileCache.set(weapon, profile);
  return profile;
}
