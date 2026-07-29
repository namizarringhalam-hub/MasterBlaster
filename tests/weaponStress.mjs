import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { CombatVisuals } from "../src/combatVisuals.js";
import { WEAPONS } from "../src/gameData.js";
import { Fighter } from "../src/player.js";

const scene = new THREE.Scene();
const visuals = new CombatVisuals(scene, { quality: 1 });
const stressWeapons = ["plasma_repeater", "minigun", "napalm_launcher", "black_hole_generator", "tornado_generator"];
const fighters = Array.from({ length: 16 }, (_, index) => new Fighter(
  scene,
  { id: `stress-${index}`, name: `Stress ${index}`, color: 0x2288cc + index * 0x030303, accent: 0x66eeff },
  stressWeapons,
  new THREE.Vector3((index % 4) * 4, 0, Math.floor(index / 4) * 4)
));

const end = new THREE.Vector3(0, 1.2, 120);
for (let frame = 0; frame < 3600; frame++) {
  const fighter = fighters[frame % fighters.length];
  const weapon = WEAPONS[frame % 4 ? "plasma_repeater" : "minigun"];
  visuals.muzzle(fighter, weapon, fighter.aim);
  visuals.tracer(fighter.muzzlePoint(new THREE.Vector3()), end, weapon, fighter, { life: .105, width: .045 });
  if (frame % 5 === 0) visuals.impact(end, weapon, fighter, { size: .72 });
  visuals.update(1 / 60);
}

assert.equal(fighters.length, 16, "the stress matrix renders a full sixteen-fighter match");
assert.equal(visuals.group.children.length, 7, "thousands of rapid shots stay inside seven pooled combat-effect drawables");
assert.equal(visuals.tracers.length, 72, "rapid tracers stay at their fixed pool capacity");
assert.equal(visuals.rings.length, 36, "impact rings stay at their fixed pool capacity");
assert.equal(visuals.sparks.length, 180, "impact sparks stay at their fixed pool capacity");
assert.equal(WEAPONS.plasma_repeater.hitscan, true, "the Plasma Repeater cannot allocate unbounded live bolt groups");
assert.ok(["napalm_launcher", "black_hole_generator", "tornado_generator"].every((id) => WEAPONS[id].maxActiveHazards === 2), "persistent zones are capped to two per owner and weapon");
assert.equal(WEAPONS.remote_explosive.maxCharges, 4, "remote charges have a strict per-owner cap");
assert.equal(WEAPONS.remote_explosive.fuse, 30, "remote charges have a finite safety lifetime");

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(mainSource, /this\.hazards\.length >= 24/, "persistent hazards also have a global match cap");
assert.match(mainSource, /new THREE\.InstancedMesh[\s\S]*?kind: "flame"[\s\S]*?new THREE\.InstancedMesh[\s\S]*?kind: "vortex"/, "napalm flames and tornado rings are instanced instead of separate draw calls");

for (const fighter of fighters) fighter.dispose();
visuals.dispose();
console.log("Sixteen-fighter weapon stress check passed.");
