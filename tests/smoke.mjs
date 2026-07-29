import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { chooseBotSlot, botFireChance, clampBotCount, nearestTarget, safestSpawn } from "../src/botBrain.js";
import { createProjectileVisual } from "../src/combatVisuals.js";
import { DEFAULT_LOADOUT, LOADOUT_SLOTS, projectileLifetime, projectileStepCount, randomLoadout, seededRandom, seedFromText, WEAPON_GROUPS, WEAPONS } from "../src/gameData.js";
import { InputManager, shouldCaptureGameKey, touchLookDelta, updateOrbit } from "../src/input.js";
import { aimWithSpread, applyGrapplePhysics, boostGrappleRelease, cameraRelative, directionFromKeys, directionFromTouch, Fighter, grappleSightline, PROJECTILE_SPAWN_OFFSET, projectileTouchesPlayer, reticleAim } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";

const [mainSource, serviceWorkerSource] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8")
]);
assert.doesNotMatch(mainSource, /serviceWorker\.register/, "the game no longer installs the stale offline cache");
assert.match(mainSource, /reticleAim\(player, this\.camera\.position, this\.camera\.getWorldDirection/, "weapons fire through the visible camera's exact center ray");
assert.match(mainSource, /mode === "quick"[\s\S]*?settings\.botCount = 7;[\s\S]*?botDifficulty = "normal";/, "Quick Play defaults to seven normal-difficulty bots");
assert.match(serviceWorkerSource, /caches\.delete/, "the replacement worker clears old cached builds");
assert.match(serviceWorkerSource, /clients\.claim/, "the replacement worker takes control before refreshing old clients");
assert.match(serviceWorkerSource, /registration\.unregister/, "the replacement worker removes itself after cleanup");

const documentedWeaponIds = [
  "arc_lightning", "black_hole_generator", "blaster", "boomerang_blade", "bouncing_bomb", "burst_rifle",
  "chainsaw", "charged_energy_rifle", "cluster_grenade", "decoy_launcher", "disintegration_weapon", "drill_missile",
  "energy_sword", "freeze_gun", "grapple_disrupting_pulse", "gravity_beam", "gravity_grenade", "grenade_launcher",
  "hammer", "implosion_bomb", "knife", "laser_beam", "machine_gun", "mine", "minigun", "mortar",
  "napalm_launcher", "needle_launcher", "plasma_cannon", "plasma_repeater", "pulse_cannon", "punch_glove",
  "railgun", "remote_explosive", "ricochet_cannon", "rocket_launcher", "shock_baton", "shotgun", "spear",
  "sticky_launcher", "submachine_gun", "teleport_projectile", "temporary_wall", "tornado_generator", "weapon_stealing_projectile"
];
assert.equal(Object.keys(WEAPONS).length, 45, "the game exposes the prototype and complete documented weapon library");
assert.equal(LOADOUT_SLOTS.length, 5, "players carry five main weapons");
assert.equal(DEFAULT_LOADOUT.length, 5, "the default loadout is match-ready");
const visualOwner = { accent: 0x44eeff };
for (const id of ["machine_gun", "railgun", "rocket_launcher", "grenade_launcher", "plasma_cannon"]) {
  const projectileVisual = createProjectileVisual(WEAPONS[id], visualOwner, WEAPONS[id].projectileRadius || .11);
  assert.ok(projectileVisual.children.length >= 2 && projectileVisual.userData.combatVisual, `${id} has a layered, animated combat visual`);
  assert.ok(projectileVisual.children.every((part) => !part.material?.isShaderMaterial), `${id} uses camera-safe world-space projectile trails`);
}
const quickLoadout = randomLoadout(() => 0);
assert.equal(quickLoadout.length, 5, "Quick Play selects five random weapons");
assert.equal(new Set(quickLoadout).size, 5, "Quick Play never selects the same weapon twice");
assert.ok(quickLoadout.every((id) => WEAPONS[id]), "Quick Play only selects valid weapons");
assert.deepEqual(
  Object.keys(WEAPONS).sort(),
  documentedWeaponIds,
  "weapon IDs match the specification"
);
assert.equal(WEAPON_GROUPS.reduce((total, group) => total + group.ids.length, 0), 45, "every documented weapon belongs to one menu category");
assert.ok(WEAPON_GROUPS.every((group) => group.ids.every((id) => WEAPONS[id])), "weapon categories contain no missing entries");
assert.ok(Object.values(WEAPONS).every((weapon) => weapon.name && weapon.description && weapon.category), "every weapon has complete menu metadata");
assert.equal(WEAPONS.cluster_grenade.split, 6, "cluster grenades create secondary bomblets");
assert.equal(WEAPONS.sticky_launcher.sticky, true, "sticky charges adhere to surfaces");
assert.equal(WEAPONS.remote_explosive.type, "remote", "remote explosives use place-and-detonate behavior");
assert.equal(WEAPONS.laser_beam.type, "beam", "laser weapons use instant beams");
assert.equal(WEAPONS.arc_lightning.type, "chain", "arc lightning chains between targets");
assert.equal(WEAPONS.hammer.type, "melee", "the melee library uses direct close-range attacks");
assert.equal(WEAPONS.temporary_wall.type, "wall", "the wall projectile creates physical cover");
assert.equal(WEAPONS.decoy_launcher.type, "decoy", "decoy rounds deploy bot targets");
assert.equal(WEAPONS.teleport_projectile.effect, "teleport", "teleport projectiles relocate their shooter");
assert.equal(WEAPONS.grapple_disrupting_pulse.grappleDisrupt, true, "disrupting pulses release grapples");
assert.equal(WEAPONS.grenade_launcher.projectileSpeed, 13, "grenades keep their deliberate throwing arc");
assert.ok(WEAPONS.railgun.projectileSpeed >= WEAPONS.grenade_launcher.projectileSpeed * 30, "the railgun feels almost instant beside a grenade");
assert.ok(WEAPONS.machine_gun.projectileSpeed > WEAPONS.blaster.projectileSpeed, "rifle-class bullets outrun visible blaster bolts");
assert.ok(WEAPONS.blaster.projectileSpeed > WEAPONS.plasma_cannon.projectileSpeed, "heavy plasma remains slower than a standard bolt");
assert.ok(WEAPONS.plasma_cannon.projectileSpeed > WEAPONS.rocket_launcher.projectileSpeed, "rockets remain the slower guided explosive");
assert.ok(projectileStepCount(WEAPONS.railgun.projectileSpeed, 1 / 60, .11) > 1, "fast shots use swept stepping instead of tunnelling");
assert.ok(Object.values(WEAPONS).every((weapon) => !("range" in weapon)), "weapons have no artificial range limit");
assert.ok(Object.values(WEAPONS).filter((weapon) => !weapon.fuse).every((weapon) => projectileLifetime(weapon) === Infinity), "straight projectiles persist until they hit something");
assert.equal(projectileLifetime(WEAPONS.grenade_launcher), WEAPONS.grenade_launcher.fuse, "grenades keep their physical fuse");
assert.ok(WEAPONS.machine_gun.spread < .03, "machine-gun rounds remain accurate across the arena");

const randomA = seededRandom(seedFromText("BLAST-01"));
const randomB = seededRandom(seedFromText("BLAST-01"));
assert.deepEqual([randomA(), randomA(), randomA()], [randomB(), randomB(), randomB()], "map randomness is seed-reproducible");

assert.ok(shouldCaptureGameKey({ code: "KeyE", target: null }, true), "grapple input is captured in play");
assert.ok(shouldCaptureGameKey({ code: "Digit5", target: null }, true), "the fifth weapon slot is reachable");
assert.ok(!shouldCaptureGameKey({ code: "KeyR", ctrlKey: true, target: null }, true), "browser shortcuts are preserved");
assert.deepEqual(updateOrbit(0, 0, 100, -50), { yaw: -.22, pitch: .11 }, "mouse-right turns the third-person camera right without reversing vertical aim");
assert.equal(updateOrbit(0, .6, 0, -1000).pitch, .65, "vertical camera aim is clamped before it can flip");
assert.deepEqual(touchLookDelta(20, 30, 70, 5), { x: 50, y: -25 }, "dragging right and up produces rightward and upward touch look");
assert.ok(cameraRelative(directionFromTouch({ up: true }), 0).distanceTo(new THREE.Vector3(0, 0, 1)) < .001, "touch up moves forward with the camera");
assert.ok(cameraRelative(directionFromTouch({ down: true }), 0).distanceTo(new THREE.Vector3(0, 0, -1)) < .001, "touch down moves backward from the camera");
assert.ok(cameraRelative(directionFromTouch({ left: true }), 0).distanceTo(new THREE.Vector3(1, 0, 0)) < .001, "touch left follows screen-left relative to the camera");
assert.ok(cameraRelative(directionFromTouch({ right: true }), 0).distanceTo(new THREE.Vector3(-1, 0, 0)) < .001, "touch right follows screen-right relative to the camera");
assert.ok(cameraRelative(directionFromKeys({ down: (code) => code === "KeyA" }), 0).distanceTo(new THREE.Vector3(1, 0, 0)) < .001, "keyboard A follows screen-left");
assert.ok(cameraRelative(directionFromKeys({ down: (code) => code === "KeyD" }), 0).distanceTo(new THREE.Vector3(-1, 0, 0)) < .001, "keyboard D follows screen-right");

const sightCamera = new THREE.PerspectiveCamera();
const sightTarget = new THREE.Vector3(4, 7, 18);
sightCamera.position.set(-6, 5, -9);
sightCamera.lookAt(sightTarget);
sightCamera.updateMatrixWorld(true);
const sightline = grappleSightline({ isBot: false }, sightCamera);
const sightDistance = sightTarget.clone().sub(sightline.origin).dot(sightline.direction);
assert.ok(sightline.origin.clone().addScaledVector(sightline.direction, sightDistance).distanceTo(sightTarget) < .001, "the grapple follows the exact center-camera reticle ray");

const previousAddEventListener = globalThis.addEventListener;
const previousDocument = globalThis.document;
const windowListeners = {};
const canvasListeners = {};
globalThis.addEventListener = (type, listener) => { windowListeners[type] = listener; };
globalThis.document = { pointerLockElement: null, addEventListener() {} };
const touchInput = new InputManager({
  addEventListener(type, listener) { canvasListeners[type] = listener; },
  setPointerCapture() {}
});
canvasListeners.pointerdown({ pointerType: "touch", pointerId: 7, clientX: 20, clientY: 30, preventDefault() {} });
windowListeners.pointermove({ pointerType: "touch", pointerId: 7, clientX: 70, clientY: 5, preventDefault() {} });
assert.deepEqual(touchInput.consumeLook(), { x: 50, y: -25 }, "dragging the gameplay view feeds horizontal and vertical camera look");
assert.equal(touchInput.mouse.left, false, "touching the gameplay view does not fire the weapon");
windowListeners.pointerup({ pointerType: "touch", pointerId: 7 });
assert.equal(touchInput.touchLook, null, "lifting the look finger ends the drag");
if (previousAddEventListener) globalThis.addEventListener = previousAddEventListener;
else delete globalThis.addEventListener;
if (previousDocument) globalThis.document = previousDocument;
else delete globalThis.document;

assert.equal(chooseBotSlot(["shotgun", "railgun"], 5, () => 0), 0, "bot prefers shotgun up close");
assert.equal(chooseBotSlot(["shotgun", "railgun"], 30, () => 0), 1, "bot prefers railgun at range");
assert.ok(botFireChance(10, true, WEAPONS.blaster) > 0, "bot can fire visible projectiles");
assert.ok(botFireChance(100, true, WEAPONS.machine_gun) > 0, "bots do not treat straight weapons as range-limited");
assert.equal(clampBotCount(99), 15, "matches allow at most fifteen bots");
assert.equal(clampBotCount(0), 1, "matches always include at least one bot");
const botStub = { alive: true, position: new THREE.Vector3() };
const nearStub = { alive: true, position: new THREE.Vector3(2, 0, 0) };
const farStub = { alive: true, position: new THREE.Vector3(20, 0, 0) };
assert.equal(nearestTarget(botStub, [botStub, farStub, nearStub]), nearStub, "each bot targets its nearest living opponent");
assert.ok(safestSpawn([new THREE.Vector3(1, 0, 0), new THREE.Vector3(30, 0, 0)], [botStub, nearStub], botStub).x === 30, "respawns maximize distance from all living opponents");

const worldScene = new THREE.Scene();
const worldA = new ArenaWorld(worldScene, "SAME-SEED");
const obstacleLayoutA = worldA.obstacles.map(({ x, z, w, d }) => [x, z, w, d]);
worldA.dispose();
const worldB = new ArenaWorld(new THREE.Scene(), "SAME-SEED");
const obstacleLayoutB = worldB.obstacles.map(({ x, z, w, d }) => [x, z, w, d]);
assert.deepEqual(obstacleLayoutA, obstacleLayoutB, "seeded arenas generate the same collision layout");
assert.equal(worldB.spawnPoints().length, 16, "the arena provides one spawn candidate for every possible combatant");
assert.equal(worldB.movers.length, 4, "the arena has moving aerial routes");
assert.equal(worldB.group.getObjectByName("Animated atmospheric perimeter"), undefined, "no giant atmosphere shell can intersect the camera at the map edge");
const skylineMatrix = new THREE.Matrix4();
const skylinePosition = new THREE.Vector3();
worldB.group.traverse((object) => {
  if (!object.isInstancedMesh || !object.name.includes("layered bodies")) return;
  for (let index = 0; index < object.count; index++) {
    object.getMatrixAt(index, skylineMatrix);
    skylinePosition.setFromMatrixPosition(skylineMatrix);
    assert.ok(Math.hypot(skylinePosition.x, skylinePosition.z) >= worldB.size + 40, "decorative skyline stays clear of the camera orbit");
  }
});
assert.equal(worldB.portals.length, 4, "the arena has two paired teleport routes");
assert.equal(worldB.sweepers.length, 2, "the arena has active kinetic hazards");
const moverX = worldB.movers[2].obstacle.x;
worldB.update(.5, []);
assert.notEqual(worldB.movers[2].obstacle.x, moverX, "dynamic platforms move during play");
const traveller = { alive: true, grounded: true, position: worldB.portals[0].position.clone(), velocity: new THREE.Vector3() };
worldB.update(.016, [traveller]);
assert.ok(traveller.position.distanceTo(worldB.portals[0].pair.position) < 1, "portals move combatants between arena elevations");
const wallGrapple = worldB.grapplePoint(new THREE.Vector3(100, 10, 0), new THREE.Vector3(1, 0, 0));
assert.ok(wallGrapple && Math.abs(wallGrapple.x - 111.4) < .01 && wallGrapple.y === 10, "the grapple attaches exactly where aimed on a wall");
const blockGrapple = worldB.grapplePoint(new THREE.Vector3(12, 20, 0), new THREE.Vector3(-1, 0, 0));
assert.ok(blockGrapple && Math.abs(blockGrapple.x - 3.5) < .01 && blockGrapple.y === 20, "the grapple attaches to ordinary blocks, not only anchor spheres");
const ropeStart = new THREE.Vector3(-12, 20, 0);
const ropeEnd = new THREE.Vector3(12, 20, 0);
const ropeWrapA = worldB.ropeWrapPoint(ropeStart, ropeEnd);
const ropeWrapB = ropeWrapA && worldB.ropeWrapPoint(ropeWrapA, ropeEnd);
assert.ok(worldB.ropeBlocked(ropeStart, ropeEnd), "solid geometry blocks a straight grapple rope");
assert.ok(ropeWrapA && ropeWrapB && !worldB.ropeBlocked(ropeStart, ropeWrapA) && !worldB.ropeBlocked(ropeWrapA, ropeWrapB) && !worldB.ropeBlocked(ropeWrapB, ropeEnd), "the grapple routes around clear obstacle edges");
const lowWrap = worldB.ropeWrapPoint(new THREE.Vector3(-12, 1.4, 0), new THREE.Vector3(12, 1.4, 0));
assert.ok(lowWrap?.y >= .12, "rope routing never bends underneath the arena floor");
assert.equal(worldB.grapplePoint(new THREE.Vector3(90, 10, 90), new THREE.Vector3(0, 1, 0)), null, "a missed grapple does not snap to an unrelated anchor");
assert.ok(worldB.grapplePoint(new THREE.Vector3(-300, 10, 0), new THREE.Vector3(1, 0, 0)), "the grapple ray has no hidden distance cutoff");
const blockedCamera = worldB.constrainCamera(new THREE.Vector3(100, 10, 0), new THREE.Vector3(120, 10, 0));
assert.ok(Math.abs(blockedCamera.x - 110.95) < .01, "the camera stops before entering a wall");
assert.ok(worldB.constrainCamera(new THREE.Vector3(100, 10, 0), new THREE.Vector3(95, 10, 0)).equals(new THREE.Vector3(95, 10, 0)), "the camera keeps its full distance when the view is clear");
assert.ok(worldB.size >= 100, "the arena spans a large horizontal combat area");
assert.ok(worldB.height >= 70, "the arena spans a large vertical combat area");
assert.ok(Math.max(...worldB.platforms.map((platform) => platform.top)) >= 60, "combat platforms reach the upper arena");
assert.ok(Math.max(...worldB.anchors.map((anchor) => anchor.point.y)) >= 70, "grapple anchors use the full arena height");
assert.ok(worldB.spawnPoints().some((point) => point.y >= 30), "respawns include elevated combat levels");
const upperSpawn = worldB.spawnPoints().find((point) => point.y >= 30);
const fallingOntoUpperSpawn = upperSpawn.clone().setY(upperSpawn.y - .1);
assert.ok(worldB.resolve(fallingOntoUpperSpawn, .72, upperSpawn.clone().setY(upperSpawn.y + .2)).grounded, "players land on elevated platforms");
const risingIntoPlatform = new THREE.Vector3(10, 12, 10);
assert.ok(worldB.resolve(risingIntoPlatform, .72, new THREE.Vector3(10, 11, 10)).ceiling && risingIntoPlatform.y < 11.3, "grapple motion cannot pull players through a platform underside");
const embeddedInSpire = new THREE.Vector3(0, 20, 0);
worldB.resolve(embeddedInSpire, .72, embeddedInSpire.clone());
assert.ok(Math.abs(embeddedInSpire.x) >= 4.2 || Math.abs(embeddedInSpire.z) >= 4.2, "solid blocks eject overlapping players instead of trapping them inside");
const platformSide = new THREE.Vector3(21.5, 12.5, 10);
const ledgeCollision = worldB.resolve(platformSide, .72, new THREE.Vector3(22.2, 12.5, 10));
assert.ok(ledgeCollision.ledge?.top === 15 && ledgeCollision.ledge.inward.x < 0, "platform sides expose an inward ledge-climb direction");

const fighter = new Fighter(
  worldScene,
  { id: "p1", name: "Rookie", color: 0x26d9ff, accent: 0xd9fbff },
  DEFAULT_LOADOUT,
  new THREE.Vector3()
);
fighter.switchSlot(4);
assert.equal(fighter.weapon.id, "railgun", "weapon switching selects the expected loadout slot");
fighter.recoil(2);
assert.ok(fighter.velocity.z < 0, "weapon recoil contributes to movement");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, 1.15, 0)), "projectiles collide with the fighter volume");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, 2.4, 0), .11), "head shots remain inside the fighter collision capsule");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, .15, 0), .11), "low shots remain inside the fighter collision capsule");
assert.ok(projectileTouchesPlayer(fighter, fighter.forwardPoint(PROJECTILE_SPAWN_OFFSET + .6), .11), "a point-blank projectile cannot spawn beyond an overlapping fighter");
assert.ok(aimWithSpread(new THREE.Vector3(0, 0, 1), .02, () => .5).equals(new THREE.Vector3(0, 0, 1)), "centered spread preserves aim");

const closeTarget = { alive: true, radius: .72, position: new THREE.Vector3(0, 0, 2) };
const cameraOrigin = new THREE.Vector3(3, 3, -6);
const cameraDirection = closeTarget.position.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(cameraOrigin).normalize();
const convergedAim = reticleAim(fighter, cameraOrigin, cameraDirection, { grapplePoint: () => null }, [fighter, closeTarget]);
const convergedHit = new THREE.Ray(fighter.position.clone().add(new THREE.Vector3(0, 1.25, 0)), convergedAim)
  .intersectSphere(new THREE.Sphere(closeTarget.position.clone().add(new THREE.Vector3(0, 1.2, 0)), closeTarget.radius), new THREE.Vector3());
assert.ok(convergedHit, "the weapon converges on the exact third-person reticle target at close range");
const overlappingTarget = { alive: true, radius: .72, position: new THREE.Vector3(0, 0, .3) };
const overlapDirection = overlappingTarget.position.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(cameraOrigin).normalize();
assert.ok(reticleAim(fighter, cameraOrigin, overlapDirection, { grapplePoint: () => null }, [fighter, overlappingTarget]).dot(overlapDirection) > 0, "overlapping targets cannot make the muzzle aim backward");
fighter.velocity.set(0, 0, 8);
fighter.grapple = { anchor: new THREE.Vector3(20, 20, 0), ropeLength: 24 };
const ropeBefore = fighter.grapple.ropeLength;
applyGrapplePhysics(fighter, .1);
assert.ok(fighter.velocity.x > 0 && fighter.velocity.y > 0, "the grapple actively pulls toward elevated anchors");
assert.ok(ropeBefore - fighter.grapple.ropeLength >= 2.1, "the strengthened grapple reels in decisively while attached");
const wrappedPlayer = {
  position: new THREE.Vector3(), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
  grapple: { anchor: new THREE.Vector3(20, 10, 0), wraps: [new THREE.Vector3(0, 10, 10)], ropeLength: 25 }
};
applyGrapplePhysics(wrappedPlayer, .1);
assert.ok(wrappedPlayer.velocity.z > 0 && Math.abs(wrappedPlayer.velocity.x) < .001, "a bent rope pulls toward its nearest wrap point instead of through the obstacle");
const ledgePlayer = {
  position: new THREE.Vector3(21.72, 12.5, 10), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
  ledgeContact: ledgeCollision.ledge,
  grapple: { anchor: new THREE.Vector3(10, 15, 10), wraps: [], ropeLength: 14 }
};
applyGrapplePhysics(ledgePlayer, .1);
assert.ok(ledgePlayer.velocity.y >= 11 && ledgePlayer.velocity.dot(ledgeCollision.ledge.inward) >= 6.99, "grappling a platform top automatically lifts and pulls a stuck player over its ledge");
const speedBeforeRelease = fighter.velocity.length();
boostGrappleRelease(fighter);
assert.ok(fighter.velocity.length() > speedBeforeRelease, "releasing a fast swing adds a slingshot boost");

fighter.dispose();
worldB.dispose();
console.log("Blaster Battle smoke check passed.");
