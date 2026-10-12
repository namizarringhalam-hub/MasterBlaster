import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three/webgpu";
import { CombatVisuals, FIREBALL_INSTANCE_CAPACITY } from "../src/combatVisuals.js";
import { projectileLifetime, WEAPONS } from "../src/gameData.js";
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

const synchronizedTracerStart = visuals.cursors.tracer;
for (let burst = 0; burst < 45; burst++) {
  for (let index = 0; index < fighters.length; index++) {
    const fighter = fighters[index];
    const weapon = index % 2 ? WEAPONS.minigun : WEAPONS.arc_lightning;
    const start = fighter.muzzlePoint(new THREE.Vector3());
    const burstEnd = end.clone().add(new THREE.Vector3(index - 8, index % 3, burst % 5));
    visuals.muzzle(fighter, weapon, fighter.aim);
    visuals.tracer(start, burstEnd, weapon, fighter, { life: .11, width: .05 });
    visuals.impact(burstEnd, weapon, fighter, { size: .8 });
  }
  visuals.update(1 / 60);
}
assert.ok(visuals.cursors.tracer - synchronizedTracerStart >= fighters.length * 45, "synchronized sixteen-player Arc Lightning and minigun bursts stay active without dropping their presentation events");

for (const quality of [.25, .5, .75, 1]) {
  const blastScene = new THREE.Scene();
  const blastVisuals = new CombatVisuals(blastScene, { quality });
  blastVisuals.setGraphicsProfile({ combatQuality: quality, combatLights: 4 });
  const fixedGroupCount = blastVisuals.group.children.length;
  for (let index = 0; index < fighters.length; index++) {
    const center = new THREE.Vector3((index % 4) * 8, 2, Math.floor(index / 4) * 8);
    blastVisuals.impact(center, WEAPONS.mortar, fighters[index], { size: 3.6, explosive: true });
    for (let child = 0; child < 6; child++) {
      const angle = child / 6 * Math.PI * 2;
      const position = center.clone().add(new THREE.Vector3(Math.cos(angle) * 1.6, child % 2 * .55, Math.sin(angle) * 1.6));
      blastVisuals.impact(position, WEAPONS.cluster_grenade, fighters[index], { size: 1.52, explosive: true });
    }
  }
  blastVisuals.update(1 / 60);
  assert.equal(blastVisuals.cursors.ring, fighters.length * 7, `${quality} quality processes every mortar and six-child cluster impact in a synchronized 16-player volley`);
  assert.equal(blastVisuals.rings.filter((ring) => ring.life > 0).length, fighters.length * 7, `${quality} quality preserves every one of the 112 critical impact cues without overwriting earlier hits`);
  assert.ok(Math.max(...blastVisuals.rings.map((ring) => ring.size || 0)) > 3, `${quality} quality preserves the enlarged mortar shockwave instead of covertly scaling it down`);
  assert.equal(blastVisuals.group.children.length, fixedGroupCount, `${quality} quality adds no drawable groups during a synchronized volley`);
  assert.equal(blastVisuals.surfaceFront.count, 0, "explosions submit no surface-front instances");
  assert.equal(blastVisuals.surfaceCore.count, 0, "explosions submit no surface-core instances");
  blastVisuals.dispose();
}

assert.equal(fighters.length, 16, "the stress matrix renders a full sixteen-fighter match");
assert.equal(visuals.group.children.length, 17, "rapid effects, surface layers, pooled sparks and explosions stay in fixed render groups");
assert.equal(visuals.surfaceFront.count, 0); assert.equal(visuals.surfaceCore.count, 0);
assert.ok(!visuals.group.getObjectByName("Momentum speed streaks"), "the local cone shower has been removed from the grapple presentation");
const speedPresentationCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const speedPresentationMain = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(speedPresentationMain, /updatePresentation\?\.\(\{ speed, motion: clamp\(\(speed - 14\) \/ 30, 0, 1\)/, "rendered speed drives the in-engine peripheral motion effect");
assert.match(await readFile(new URL("../src/cinematicPresentation.js", import.meta.url), "utf8"), /this\.motion\.value = active && !reducedMotion \? clamp01\(motion\) : 0[\s\S]*?Only the periphery smears/, "speed streaking and blur stay centered on gameplay aim and honor reduced motion");
assert.doesNotMatch(speedPresentationCss, /environment-blur|grapple-speed-pulse/, "gameplay speed effects no longer depend on continuous DOM backdrop filters");
assert.equal(visuals.flashes.length, 64, "sixteen-fighter muzzle flashes stay below the fixed pool capacity");
assert.equal(visuals.tracers.length, 128, "sixteen-fighter rapid tracers stay below the fixed pool capacity");
assert.equal(visuals.rings.length, 128, "sixteen-fighter impact rings retain the bounded 112-hit volley capacity");
assert.equal(visuals.sparks.length, 512, "sixteen-fighter impact particles stay below the fixed pool capacity");
assert.equal(WEAPONS.plasma_repeater.hitscan, true, "the Plasma Repeater cannot allocate unbounded live bolt groups");
assert.ok(["napalm_launcher", "black_hole_generator", "tornado_generator"].every((id) => WEAPONS[id].maxActiveHazards === 2), "persistent zones are capped to two per owner and weapon");
assert.equal(WEAPONS.remote_explosive.maxCharges, 4, "remote charges have a strict per-owner cap");
assert.equal(WEAPONS.remote_explosive.fuse, 30, "remote charges have a finite safety lifetime");
assert.equal(projectileLifetime(WEAPONS.fireball), Infinity, "Fireballs have no time-based disappearance");
assert.equal(WEAPONS.fireball.bounces, Infinity, "Fireballs never exhaust their wall and floor ricochets");
assert.equal(WEAPONS.fireball.bounceEnergy, 1, "Fireballs preserve their bounce speed instead of settling");
assert.ok(WEAPONS.fireball.gravity > 0 && WEAPONS.fireball.arcLift > 0, "Fireballs follow a thrown bouncing-ball arc");
assert.equal(WEAPONS.fireball.radius, undefined, "Fireballs disappear on direct fighter contact rather than a proximity blast");

const maximumMatchFireballs = 16 * Math.ceil(180 / WEAPONS.fireball.cooldown);
assert.ok(FIREBALL_INSTANCE_CAPACITY >= maximumMatchFireballs, "the Fireball batch covers the absolute cooldown-limited maximum for a full sixteen-player match");
const accumulatedFireballs = Array.from({ length: 2100 }, (_, index) => {
  const mesh = visuals.createProjectile(fighters[index % fighters.length], WEAPONS.fireball, WEAPONS.fireball.projectileRadius);
  mesh.position.set(index % 70, 1 + index % 5, Math.floor(index / 70));
  const shot = { mesh, velocity: new THREE.Vector3(18, 3, 24) };
  mesh.userData.projectileVelocity = shot.velocity;
  visuals.updateProjectile(shot, 1 / 60);
  return shot;
});
visuals.update(1 / 60);
visuals.syncPresentation(new THREE.PerspectiveCamera());
assert.equal(visuals.fireballs.size, 2100, "persistent Fireballs remain registered without expiring or being deleted");
assert.ok(accumulatedFireballs.every((shot) => shot.mesh.children.length === 0 && shot.mesh.parent === null), "persistent Fireballs add no per-shot drawable or scene node");
assert.equal(visuals.fireballGroup.children.length, 7, "all Fireballs share seven instanced visual layers");
assert.ok(visuals.fireballLayerList.every((layer) => layer.count === 2100), "2,100 simultaneous Fireballs render through the fixed batch");
assert.deepEqual(Object.keys(visuals.fireballLayers), ["aura", "shell", "core", "flameA", "flameB", "flameC", "cinder"], "the batched Fireball silhouette uses only fire-specific layers");
assert.ok(["flameA", "flameB", "flameC"].every((name) => visuals.fireballLayers[name].geometry.type === "ConeGeometry"), "three independently animated flame tongues replace plasma rings");

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.match(mainSource, /this\.hazards\.length >= 24/, "persistent hazards also have a global match cap");
assert.doesNotMatch(mainSource, /setHighLoadMode|fighterCount[^\n]*renderPipeline/, "maximum-size matches keep the selected graphics tier without a separate high-load graph");
assert.match(await readFile(new URL("../src/renderPipeline.js", import.meta.url), "utf8"), /setQuality\(quality = 'high'\)[\s\S]*?this\.ensureQualityPipeline\(\)/, "pipeline selection follows explicit graphics quality, independent of fighter count");
assert.match(await readFile(new URL("../src/hazardVisuals.js", import.meta.url), "utf8"), /new THREE\.InstancedMesh[\s\S]*?kind: "flame"[\s\S]*?vortexRibbonGeometry[\s\S]*?kind: "ribbon"/, "napalm stays instanced while tornadoes use one authored helical ribbon draw");
assert.match(mainSource, /shot\.bounces < \(shot\.weapon\.bounces \|\| 0\)[\s\S]*?bounceProjectile\(shot, previous\)/, "infinite Fireball ricochets stay on the swept world-collision path");

for (const fighter of fighters) fighter.dispose();
visuals.dispose();
console.log("Sixteen-fighter weapon stress check passed.");
