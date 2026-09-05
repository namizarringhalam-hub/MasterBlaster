import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";
import { structuralPartBounds, structuralTowerBlueprints, WEAPONS } from "../src/gameData.js";
import { lineBlockedByStructure, playerCapsuleIntersectsStructure, validateHitProposal } from "../src/combatAuthority.js";

const corners = [[-72, -66, 40], [72, 66, 54], [70, -62, 72], [-68, 66, 62]];
const seed = "CORNER-PILLARS";
const world = new ArenaWorld(new THREE.Scene(), seed);
const blueprints = structuralTowerBlueprints(seed);
const structuralState = {};
assert.deepEqual(blueprints.slice(0, 16), structuralTowerBlueprints(seed, undefined, 1), "rollout preserves all original geometry and RNG results");
const cornerHit = (arenaRevision, health = new Map(), failures, now = 1_001) => validateHitProposal({
  shot: { id: "corner-shot", playerId: "a", weaponId: "machine_gun", firedAt: now - 1, origin: { x: 65, y: 69, z: -62 }, direction: { x: 1, y: 0, z: 0 } },
  attacker: { id: "a", alive: true }, target: { id: "b", alive: true, health: 100, position: { x: 75, y: 67.95, z: -62 } },
  weapon: WEAPONS.machine_gun, seed, now, arenaRevision, structuralHealth: health, structuralFailures: failures
});
assert.ok(cornerHit(1), "cached legacy clients retain their former damage authority while draining");
assert.equal(cornerHit(2), null, "the updated corner blocks a real combat hit proposal");
const fallingHealth = new Map([["structure-19-pillar-1", 0]]), failures = new Map([["structure-19-pillar-1", 1_000]]);
assert.equal(cornerHit(2, fallingHealth, failures, 1_100), null, "visible upper cover still blocks damage during its fall");
assert.ok(cornerHit(2, fallingHealth, failures, 2_650), "old-height cover disappears after the canonical collapse window");
for (const y of [3, 69]) {
  assert.equal(playerCapsuleIntersectsStructure({ x: 70, y, z: -62 }, seed, fallingHealth, 2, failures, 1_100), true, "capsule validation covers the moving stack's swept height");
}
assert.equal(blueprints.length, 20, "all four corner landmarks have authoritative structural blueprints");
for (const [index, [x, z, top]] of corners.entries()) {
  const structure = world.structures.find((entry) => entry.x === x && entry.z === z);
  assert.ok(structure, `corner ${x},${z} must be destructible, not static cover`);
  assert.equal(structure.id, `structure-${17 + index}`, "existing sixteen tower IDs stay stable");
  assert.equal(structure.segments.at(-1).top, top);
  assert.equal(structure.platformChunks.length, 0, "no new deck or footprint is added to a corner pillar");
  for (const part of structure.segments) {
    const bounds = structuralPartBounds(seed, part.structuralId);
    for (const [key, value] of Object.entries({ x, z, baseY: part.baseY, top: part.top, w: 7, d: 7 })) assert.ok(Math.abs(bounds[key] - value) < 1e-9);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const origin = new THREE.Vector3(x + dx * 4.5, (part.baseY + part.top) / 2, z + dz * 4.5);
      const hit = world.grapplePoint(origin, new THREE.Vector3(-dx, 0, -dz));
      assert.equal(world.structuralPartAt(hit, .35)?.structuralId, part.structuralId, "visible faces resolve the actual server part");
    }
  }
  assert.equal(structuralPartBounds(seed, `${structure.id}-platform-1`), null, "the server must not invent an invisible corner deck");
  while (structure.segments.length) {
    const part = structure.segments[0];
    const previousCrownY = structure.landmark.position.y;
    structuralState[part.structuralId] = 0;
    const hit = world.grapplePoint(new THREE.Vector3(x + 4.5, part.baseY + part.h / 2, z), new THREE.Vector3(-1, 0, 0));
    assert.equal(world.structuralPartAt(hit, .35)?.structuralId, part.structuralId, "fallen sections remain hittable");
    assert.equal(world.destroy(hit, 0, { structuralDamage: WEAPONS.rocket_launcher.structureDamage }), 1);
    world.settleStructuralChanges();
    assert.ok(!world.obstacles.includes(part), "destroyed corner sections leave no invisible collision");
    if (structure.segments.length) {
      assert.equal(structure.landmark.visible, true);
      assert.ok(Math.abs(structure.landmark.position.y - (previousCrownY - part.h)) < 1e-9, "the original crown follows the collapsing pillar");
      assert.equal(structure.anchor.point.y, structure.landmark.position.y);
      world.group.updateMatrixWorld(true);
      assert.ok(Math.abs(new THREE.Vector3().setFromMatrixPosition(structure.landmark.matrixWorld).y - structure.landmark.position.y) < 1e-9, "the frozen crown matrix really moves on screen");
    }
    const health = new Map(Object.entries(structuralState));
    const settledTop = structure.segments.at(-1)?.top || 0;
    for (const y of [top - .1, settledTop + .1, ...(settledTop > 1 ? [settledTop - 1] : [])]) {
      const start = new THREE.Vector3(x - 4.5, y, z), end = new THREE.Vector3(x + 4.5, y, z);
      assert.equal(lineBlockedByStructure(start, end, seed, health), y < settledTop, "server sightlines follow the settled stack, not its old height");
      assert.equal(playerCapsuleIntersectsStructure({ x, y, z }, seed, health), y < settledTop, "no invisible authoritative collision above the demolished pillar");
    }
    const restored = new ArenaWorld(new THREE.Scene(), seed);
    restored.applyStructuralState(structuralState);
    const restoredCorner = restored.structures[16 + index];
    assert.equal(restoredCorner.landmark.visible, structure.landmark.visible);
    if (structure.segments.length) {
      assert.ok(Math.abs(restoredCorner.landmark.position.y - structure.landmark.position.y) < 1e-9);
      assert.equal(restoredCorner.anchor.point.y, restoredCorner.landmark.position.y);
    } else assert.equal(restoredCorner.anchor, null);
    assert.equal(restored.structuralChanges.length, 0, "reconnect restoration does not replay collapse effects");
    restored.dispose();
  }
  assert.equal(structure.anchor, null, "a demolished corner leaves no floating grapple target");
  assert.equal(structure.landmark.visible, false, "the unsupported crown disappears with its final support");
}
assert.ok(world.obstacles.some((part) => part.x === 0 && part.z === 0 && part.h === 70 && !part.structure), "the central spire stays protected");
world.dispose();
for (const index of [16, 17, 18, 19]) {
  const topWorld = new ArenaWorld(new THREE.Scene(), seed), tower = topWorld.structures[index];
  const top = tower.segments.at(-1), before = tower.landmark.position.y;
  topWorld.destroy(topWorld.structuralCenter(top), 0, { structuralDamage: WEAPONS.rocket_launcher.structureDamage });
  topWorld.updateStructuralChanges(.53, []);
  assert.equal(tower.landmark.position.y, before, "a crown must not snap down at the top-section break threshold");
  assert.equal(tower.activeChange.phase, "falling");
  topWorld.updateStructuralChanges(.25, []);
  assert.ok(tower.landmark.position.y < before && tower.landmark.position.y > before - top.h, "the unsupported crown falls smoothly with the existing collapse curve");
  assert.equal(tower.anchor.point.y, tower.landmark.position.y);
  topWorld.settleStructuralChanges();
  assert.ok(Math.abs(tower.landmark.position.y - (before - top.h)) < 1e-9);
  topWorld.dispose();
}
// Two same-frame hits must use successive server slots, including after a
// mid-collapse reconnect. The client clock is deliberately unrelated to UTC.
const scheduledState = { "structure-19-pillar-1": 0, "structure-19-pillar-2": 0 };
const scheduledFailures = { "structure-19-pillar-1": 10_000, "structure-19-pillar-2": 11_650 };
const scheduledWorld = new ArenaWorld(new THREE.Scene(), seed);
for (const [partId, collapseStartsAt] of Object.entries(scheduledFailures)) {
  const part = scheduledWorld.structuralPartById(partId);
  scheduledWorld.destroy(scheduledWorld.structuralCenter(part), 0, { partId, structuralDamage: 8, collapseStartsAt, serverTime: 10_000 });
}
for (const now of [10_100, 10_520, 10_800, 11_400, 11_649, 11_800, 12_300, 13_300]) {
  for (let frame = 0; frame < 6; frame++) scheduledWorld.updateStructuralChanges(0, [], now);
  const rejoined = new ArenaWorld(new THREE.Scene(), seed);
  rejoined.applyStructuralState(scheduledState, { structuralFailures: scheduledFailures, serverTime: now });
  const actual = scheduledWorld.structures[18], recovered = rejoined.structures[18];
  assert.deepEqual(recovered.segments.map((part) => [part.structuralId, part.baseY, part.top]), actual.segments.map((part) => [part.structuralId, part.baseY, part.top]), `snapshot colliders match at ${now}`);
  assert.equal(recovered.landmark.position.y, actual.landmark.position.y, `snapshot crown matches at ${now}`);
  assert.equal(recovered.anchor.point.y, actual.anchor.point.y);
  assert.equal(rejoined.drainStructuralEvents().length, 0, "snapshot never replays audio/crush events");
  assert.equal(rejoined.debrisParticles.some((p) => p.active), false);
  assert.equal(rejoined.dustParticles.some((p) => p.active), false);
  const count = recovered.pendingFailures.length + Number(Boolean(recovered.activeChange));
  rejoined.applyStructuralState(scheduledState, { structuralFailures: scheduledFailures, serverTime: now });
  assert.equal(recovered.pendingFailures.length + Number(Boolean(recovered.activeChange)), count, "in-place resume does not duplicate/reorder failures");
  assert.equal(recovered.anchor.point.y, actual.anchor.point.y, "an active collapse keeps its grapple anchor on resume");
  rejoined.dispose();
}
scheduledWorld.dispose();
// Even when the entire corner has zero health, queued sections remain physical
// cover until their own warning/fall has completed.
const allFailed = new Map(), allStarts = new Map();
for (let part = 1; part <= 12; part++) {
  const id = `structure-19-pillar-${part}`;
  allFailed.set(id, 0); allStarts.set(id, 10_000 + (part - 1) * 1_650);
}
assert.equal(playerCapsuleIntersectsStructure({ x: 70, y: 69, z: -62 }, seed, allFailed, 2, allStarts, 10_100), true);
assert.equal(playerCapsuleIntersectsStructure({ x: 70, y: 9, z: -62 }, seed, allFailed, 2, allStarts, 26_600), true, "last queued sections still block at their lowered height");
assert.equal(playerCapsuleIntersectsStructure({ x: 70, y: 1, z: -62 }, seed, allFailed, 2, allStarts, 29_800), false);
const contactWorld = new ArenaWorld(new THREE.Scene(), seed), contactTower = contactWorld.structures[18];
const contactPart = contactTower.segments[5], contactY = contactPart.baseY;
contactWorld.destroy(contactWorld.structuralCenter(contactPart), 0, { structuralDamage: 8 });
contactWorld.updateStructuralChanges(.53, []);
contactWorld.updateStructuralChanges(1, []);
assert.equal(contactWorld.drainStructuralEvents().find((event) => event.type === "land").position.y, contactY, "elevated impacts keep their actual spatial audio/effects position");
contactWorld.dispose();
const lastWorld = new ArenaWorld(new THREE.Scene(), seed), lastTower = lastWorld.structures[18];
lastWorld.applyStructuralState(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`structure-19-pillar-${i + 1}`, 0])));
const lastPart = lastTower.segments[0], lastCrownY = lastTower.landmark.position.y;
lastWorld.destroy(lastWorld.structuralCenter(lastPart), 0, { structuralDamage: 8 });
lastWorld.updateStructuralChanges(.53, []);
assert.equal(lastTower.anchor, null, "a final unsupported crown is no longer a grapple target");
assert.equal(lastTower.landmark.visible, true, "the last crown does not pop out at break time");
assert.equal(lastTower.landmark.position.y, lastCrownY);
lastWorld.updateStructuralChanges(.25, []);
assert.ok(lastTower.landmark.position.y < lastCrownY && lastTower.landmark.position.y > .55);
assert.ok(lastTower.landmark.scale.x > 0 && lastTower.landmark.scale.x < 1);
lastWorld.settleStructuralChanges();
assert.equal(lastTower.landmark.visible, false);
assert.equal(lastWorld.rotors.some(({ object }) => object.parent === lastTower.landmark), false);
assert.equal(lastWorld.pulsers.some(({ object }) => object.parent === lastTower.landmark), false);
lastWorld.dispose();
const pausedWorld = new ArenaWorld(new THREE.Scene(), seed);
for (const tower of pausedWorld.structures.slice(16)) {
  // Keep one NW section for the subsequent current, audible collapse.
  for (const [index, part] of tower.segments.slice(0, tower === pausedWorld.structures[16] ? -1 : undefined).entries()) {
    pausedWorld.destroy(pausedWorld.structuralCenter(part), 0, { partId: part.structuralId, structuralDamage: 8, collapseStartsAt: 10_000 + index * 1_650, serverTime: 10_000 });
  }
}
pausedWorld.updateStructuralChanges(.016, [], 30_000);
assert.equal(pausedWorld.structuralChanges.length, 0, "one resumed frame catches up all completed canonical slots");
assert.equal(pausedWorld.drainStructuralEvents().length, 0, "pause catch-up cannot replay a burst of historical sounds");
assert.equal(pausedWorld.debrisParticles.some((p) => p.active), false);
assert.equal(pausedWorld.dustParticles.some((p) => p.active), false);
for (const tower of pausedWorld.structures.slice(17)) assert.equal(tower.landmark.visible, false);
const audiblePart = pausedWorld.structures[16].segments[0];
pausedWorld.destroy(pausedWorld.structuralCenter(audiblePart), 0, { partId: audiblePart.structuralId, structuralDamage: 8, collapseStartsAt: 30_000, serverTime: 30_000 });
pausedWorld.updateStructuralChanges(.016, [], 30_016);
assert.equal(pausedWorld.drainStructuralEvents().filter((event) => event.type === "warning").length, 1, "a new collapse remains audible after catch-up");
pausedWorld.updateStructuralChanges(.016, [], 30_032);
assert.equal(pausedWorld.drainStructuralEvents().length, 0);
pausedWorld.dispose();
console.log("Corner pillar destruction regression passed.");
