import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { damageIndicatorAngle } from "../src/player.js";
import { headContact, headshotDamage } from "../src/headshots.js";
import { WEAPONS } from "../src/gameData.js";
import TEXT, { formatText } from "../src/playerText.js";
import { MultiplayerClient } from "../src/multiplayer.js";

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: expected ${expected}, got ${actual}`);

// Derive screen-right from Three's real camera basis, independently of the HUD math.
const camera = new THREE.PerspectiveCamera(70, 1, .1, 100);
for (const yaw of [0, .73, Math.PI, -2.4]) {
  const ahead = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  camera.lookAt(ahead);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  for (const degrees of [0, 45, -65, 90, -90, 135, -135]) {
    const radians = THREE.MathUtils.degToRad(degrees);
    const source = ahead.clone().multiplyScalar(Math.cos(radians)).addScaledVector(right, Math.sin(radians));
    near(damageIndicatorAngle(yaw, source), degrees, `yaw ${yaw}, screen bearing ${degrees}`);
    if (Math.abs(degrees) < 90 && degrees !== 0) {
      assert.equal(Math.sign(source.clone().multiplyScalar(10).project(camera).x), Math.sign(degrees), "HUD left/right agrees with the actual rendered camera");
    }
  }
  near(Math.abs(damageIndicatorAngle(yaw, ahead.clone().negate())), 180, "rear damage stays behind the player");
}

// Execute the controller methods without constructing a renderer or browser.
const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = mainSource.slice(mainSource.indexOf("class BlasterBattle"), mainSource.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", JSON.stringify(import.meta.url));
const setStyle = (node, name, value) => node.style.setProperty(name, value);
const ui = {
  innerHTML: "", querySelector: () => element(),
  querySelectorAll(selector) { return selector === "[data-incoming-hit]" ? Array.from({ length: (this.innerHTML.match(/data-incoming-hit/g) || []).length }, element) : []; }
};
const bindings = {
  THREE, damageIndicatorAngle, setStyle, headContact, headshotDamage, WEAPONS, TEXT, formatText, ui,
  clamp: THREE.MathUtils.clamp, escapeHtml: String,
  performance: { now: () => 1000 }, setTimeout: () => 1, clearTimeout() {},
  STRUCTURAL_COLLAPSE: { id: "structural_collapse" }
};
const Game = new Function(...Object.keys(bindings), `return ${controller}`)(...Object.values(bindings));
function element() {
  const styles = new Map();
  const classes = new Set();
  return {
    style: { setProperty: (name, value) => styles.set(name, String(value)), getPropertyValue: name => styles.get(name) || "" },
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); return force; }
    }
  };
}
function fixture() {
  const target = { id: "target", alive: true, health: 100, radius: .72, position: new THREE.Vector3(2, 0, 3), accent: 0xff6b82, takeHit: () => false };
  const attacker = { id: "attacker", position: new THREE.Vector3(-6, 0, 3), accent: 0xff6b82 };
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    players: [target, attacker], cameraYaw: 0, settings: { reducedMotion: false },
    damageDirection: new THREE.Vector3(), damageIndicators: [],
    hud: { incomingDirection: element(), incomingHits: Array.from({ length: 6 }, element), damageVignette: element() },
    sound: { play() {} }, spawnImpact() {}, isOnlineMatch: () => false, combatMusicPulse: 0
  });
  const visible = () => game.hud.incomingHits.filter(node => node.classList.contains("visible"));
  const angle = node => parseFloat(node.style.getPropertyValue("--incoming-angle"));
  return { game, target, attacker, visible, angle };
}

{
  const { game, target, attacker, visible, angle } = fixture();
  game.addDamageIndicator(target, attacker, { point: target.position.clone() }, 1000);
  game.updateDamageIndicators(1000);
  assert.equal(visible().length, 1);
  near(angle(visible()[0]), 90, "a victim impact point is not the incoming source");
  attacker.position.set(10, 0, 3);
  game.updateDamageIndicators(1100);
  near(angle(visible()[0]), 90, "marker retains the source at the time of the hit after the attacker moves");
  game.cameraYaw = Math.PI / 4;
  game.updateDamageIndicators(1200);
  near(angle(visible()[0]), 135, "marker updates continuously when the camera turns");
  game.cameraYaw = 0;
  target.position.z -= 8;
  game.updateDamageIndicators(1300);
  near(angle(visible()[0]), 45, "marker also follows the victim's changed position");
}

{
  const { game, target, attacker, visible, angle } = fixture();
  const blast = target.position.clone().add(new THREE.Vector3(-10, 0, 10));
  game.addDamageIndicator(target, attacker, { source: blast, point: target.position.clone() }, 1000);
  blast.set(50, 0, 50);
  game.updateDamageIndicators(1000);
  near(angle(visible()[0]), 45, "explosion origin takes precedence and is copied instead of tracking a mutable position");
  const left65 = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(65)), 0, Math.cos(THREE.MathUtils.degToRad(65)));
  game.addDamageIndicator(target, attacker, { incomingDirection: left65 }, 1100);
  left65.set(0, 0, -1);
  game.updateDamageIndicators(1100);
  assert.equal(visible().length, 2, "a second incoming direction does not replace the first");
  near(angle(visible()[1]), -65, "arbitrary left bearing stays precise");
  game.updateDamageIndicators(1750);
  near(parseFloat(visible()[0].style.getPropertyValue("--incoming-opacity")), .5, "the first indicator fades smoothly during its final 300ms");
  game.updateDamageIndicators(1950);
  assert.equal(visible().length, 1, "indicators expire independently");
  near(angle(visible()[0]), -65, "the newer direction remains after the first expires");
  game.updateDamageIndicators(2001);
  assert.equal(visible().length, 0, "the final indicator expires");
  assert.equal(game.damageIndicators.length, 0, "expired sources are removed");
}

{
  const { game, target, attacker, visible, angle } = fixture();
  game.addDamageIndicator(target, attacker, { direction: new THREE.Vector3(1, 0, 0) }, 1000);
  game.updateDamageIndicators(1000);
  near(angle(visible()[0]), 90, "projectile travel direction is inverted to point toward its source");
}

{
  const { game, target, attacker, visible, angle } = fixture();
  const source = target.position.clone().add(new THREE.Vector3(-10, 0, 10));
  game.addDamageIndicator(target, attacker, { source, direction: new THREE.Vector3(1, 0, 0) }, 1000);
  near(angle(visible()[0]), 45, "an explicit source takes precedence over fallback projectile travel direction");
  game.addDamageIndicator(target, attacker, { source, incomingDirection: new THREE.Vector3(1, 0, 1) }, 1100);
  near(angle(visible()[1]), -45, "an explicit last incoming bearing takes precedence over the launch source");
}

{
  const { game, target, attacker, visible } = fixture();
  game.addDamageIndicator(target, null, {}, 1000);
  game.addDamageIndicator(target, attacker, { directionalSourceKnown: true }, 1000);
  game.addDamageIndicator(target, target, {}, 1000);
  game.addDamageIndicator(target, attacker, { source: target.position.clone().add(new THREE.Vector3(0, 20, 0)) }, 1000);
  game.addDamageIndicator(target, attacker, { incomingDirection: new THREE.Vector3() }, 1000);
  game.addDamageIndicator(target, attacker, { directionalSourceKnown: true, source: { x: NaN, y: 0, z: 1 } }, 1000);
  game.addDamageIndicator(target, attacker, { directionalSourceKnown: true, incomingDirection: { x: 1, y: 0, z: Infinity } }, 1000);
  game.updateDamageIndicators(1000);
  assert.equal(visible().length, 0, "unknown, self and vertically coincident hits do not invent an incoming bearing");
  game.addDamageIndicator(target, target, { source: target.position.clone().add(new THREE.Vector3(0, 0, 5)) }, 1100);
  game.updateDamageIndicators(1100);
  assert.equal(visible().length, 1, "self damage can still indicate a known explosion origin");
}

{
  const { game, target, attacker, visible, angle } = fixture();
  const source = target.position.clone().add(new THREE.Vector3(-10, 0, 10));
  game.damagePlayer(target, 5, new THREE.Vector3(), attacker, { id: "grenade" }, { source, point: target.position.clone() });
  assert.equal(visible().length, 1, "the offline damage path forwards its source to HUD feedback");
  near(angle(visible()[0]), 45, "the real damage/feedback path points to the blast origin");
}

{
  const { game, target, attacker, visible } = fixture();
  game.world = { drainStructuralEvents: () => [{ type: "crush", player: target, attackerId: attacker.id }] };
  game.processStructuralEvents();
  assert.equal(visible().length, 0, "structural collapse cannot indicate the remote player who destroyed the building as its damage bearing");
  assert.equal(game.hud.damageVignette.classList.contains("visible"), true, "environmental damage still provides ordinary hit feedback");
}

{
  const { game, target, attacker, visible } = fixture();
  for (let index = 0; index < 20; index++) game.addDamageIndicator(target, attacker, {}, 1000 + index);
  game.updateDamageIndicators(1020);
  assert.equal(visible().length, 6, "incoming damage has a bounded six-element HUD pool");
  assert.equal(game.damageIndicators.length, 6, "source history stays bounded under sustained fire");
  game.updateDamageIndicators(3000);
  assert.equal(visible().length, 0);
}

{
  const { game, target, attacker, visible } = fixture();
  game.addDamageIndicator(target, attacker, {}, 1000);
  const previousElement = visible()[0];
  Object.assign(target, { name: "Player", loadout: [], weapon: { name: "Blaster" } });
  attacker.name = "Opponent";
  Object.assign(game, {
    world: { theme: { name: "Arena" } }, mode: "training", seed: "HUD", targetScore: 10,
    scores: [0, 0], bindUi() {}, bindTouch() {}
  });
  game.renderHud();
  assert.equal(game.damageIndicators.length, 0, "rebuilding the HUD clears references to its old damage elements");
  assert.equal(game.hud.incomingHits.length, 6, "the rebuilt HUD supplies its new indicator pool");
  assert.equal(game.hud.incomingHits.includes(previousElement), false);
  game.addDamageIndicator(target, attacker, {}, 1100);
  assert.equal(visible().length, 1, "new damage uses the rebuilt HUD elements");
}

{
  const sent = [];
  const client = Object.create(MultiplayerClient.prototype);
  client.send = (type, payload) => { sent.push({ type, payload }); return true; };
  const attacker = { id: "attacker", networkShotId: "latest-shot" };
  const target = { id: "target" };
  const weapon = { id: "blaster" };
  const push = new THREE.Vector3(1, 0, 1);
  const point = new THREE.Vector3(2, 1.2, 3);
  const travel = new THREE.Vector3(3, -1, 4);
  assert.equal(client.reportHit(attacker, target, weapon, 18, push, { shotId: "ricochet-shot", point, direction: travel }), true);
  assert.deepEqual(sent[0].payload.incomingDirection, { x: -3, y: 1, z: -4 }, "the production client transmits the inverse of the actual projectile approach");
  assert.deepEqual(travel.toArray(), [3, -1, 4], "reporting damage does not mutate the projectile velocity");
  assert.equal(sent[0].type, "hit");
  assert.equal(sent[0].payload.shotId, "ricochet-shot");
  assert.equal(sent[0].payload.impact, point, "the hit proposal keeps its original impact");
  assert.equal(sent[0].payload.push, push);
  assert.equal(sent[0].payload.damage, 18);
  const incomingDirection = { x: -1, y: 0, z: 1 };
  client.reportHit(attacker, target, weapon, 18, push, { incomingDirection, direction: travel });
  assert.equal(sent[1].payload.incomingDirection, incomingDirection, "an explicit incoming source bearing takes precedence over travel direction");
  client.reportHit(attacker, target, weapon, 18, push);
  assert.equal(sent[2].payload.incomingDirection, null, "a proposal with no approach context does not invent one");
  assert.equal(sent[2].payload.shotId, "latest-shot", "the original shot-ID fallback remains intact");
  assert.equal(sent[2].payload.impact, null);
}

console.log("Damage indicator: rendered camera bearings, turn/movement tracking, damage sources and network proposals, independent fading/expiry and bounded HUD markers passed.");
