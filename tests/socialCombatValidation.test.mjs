import assert from "node:assert/strict";
import { socialCombatValidation } from "./socialVideoCapture.js";

const fighter = id => ({ id, alive: true, visible: true });
const shot = (from, to, atMs) => ({ kind: "production-shot", atMs, fighterId: from, targetId: to,
  weapon: "machine_gun", ammoBefore: 32, ammoAfter: 31, attacker: fighter(from), target: fighter(to),
  grappleActive: from === "p2", ropeVisible: true, grounded: false, anchor: [0, 42, 0], velocity: [4, 4, 0] });
const duel = () => ({ scene: "readable-duel", featuredBotId: "p2", featuredWeapon: "machine_gun", opponentIds: ["p1"],
  perspective: "outside-duel-showcase", cameraSource: "staged midpoint camera", concurrentShotCount: 900,
  events: [shot("p2", "p1", 101), shot("p1", "p2", 110),
    { kind: "production-damage", atMs: 100, attackerId: "p2", targetId: "p1", weapon: "machine_gun",
      healthBefore: 100, healthAfter: 93, fighters: [fighter("p1"), fighter("p2")] }] });
const validate = scene => socialCombatValidation(scene, 0, 18000, "p1");
assert.equal(socialCombatValidation({}, 0, 18000, "p1").valid, false, "legacy captures still need real explosions");
assert.equal(socialCombatValidation({}, 1, 18000, "p1").valid, true);
const good = validate(duel());
assert.equal(good.valid, true); assert.equal(good.actualDamageEvents, 1); assert.equal(good.concurrentVisibleShots, 1);
for (const mutate of [
  s => { s.events[0].ammoAfter = s.events[0].ammoBefore; },
  s => { s.events[1].targetId = "unrelated"; },
  s => { s.events[0].target.visible = false; },
  s => { s.events[2].healthAfter = 100; },
  s => { s.events[2].attackerId = "unrelated"; },
  s => { s.events[2].fighters[0].visible = false; },
  s => { s.events[2].atMs = 9000; },
  s => { s.events[0].atMs = -1; },
  s => { s.events[0].grappleActive = false; },
  s => { s.events[0].grounded = true; },
  s => { s.events[0].velocity = [0, 0, 0]; },
  s => { s.events[0].anchor = null; }
]) { const scene = duel(); mutate(scene); assert.equal(validate(scene).valid, false); }
const pov = duel(); pov.perspective = "production-player-camera"; pov.cameraSource = "bound unmodified Game.updateCamera";
for (const event of pov.events) {
  if (event.attacker?.id === "p1") event.attacker.visible = false;
  if (event.target?.id === "p1") event.target.visible = false;
  for (const p of event.fighters || []) if (p.id === "p1") p.visible = false;
  if (event.kind === "production-shot") event.grappleActive = false;
}
assert.equal(validate(pov).valid, true, "real player camera permits the local rig off-frame; outside cut supplies grapple/fire");
pov.cameraSource = "follow camera"; assert.equal(validate(pov).valid, false, "showcase is not normal player view");
pov.cameraSource = "bound unmodified Game.updateCamera"; pov.events[0].attacker.visible = false;
assert.equal(validate(pov).valid, false, "the enemy still must be visible in player view");
console.log("Scene-specific real duel combat evidence and unchanged legacy explosion gate passed.");
