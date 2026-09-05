import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import * as data from "../src/gameData.js";
import * as brain from "../src/botBrain.js";
import { Fighter, aimWithSpread } from "../src/player.js";
import TEXT from "../src/playerText.js";

// Exercise the actual controller methods without starting its browser renderer.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const bindings = { THREE, ...data, ...brain, TEXT, aimWithSpread, clamp: THREE.MathUtils.clamp };
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", JSON.stringify(new URL("../src/main.js", import.meta.url).href));
const Game = new Function(...Object.keys(bindings), `return ${controller}`)(...Object.values(bindings));
const oldStorage = globalThis.localStorage, storage = new Map();
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const settings = data.loadSettings();
assert.equal(settings.matchSettings.training.botsStandStill, false);
assert.equal(settings.matchSettings.training.botsDontAttack, false);
data.saveSettings({ ...settings, matchSettings: { ...settings.matchSettings, training: { ...settings.matchSettings.training, botsStandStill: "true", botsDontAttack: 1 } } });
assert.equal(data.loadSettings().matchSettings.training.botsStandStill, false);
assert.equal(data.loadSettings().matchSettings.training.botsDontAttack, false);
storage.clear();

function fixture(weaponId = "machine_gun", mode = "training") {
  const game = Object.create(Game.prototype), scene = new THREE.Scene();
  const human = new Fighter(scene, { id: "human", name: "Human", color: 0xffffff, accent: 0xffffff }, ["machine_gun"], new THREE.Vector3(20, 0, 0));
  const bot = new Fighter(scene, { id: "bot-1", name: "Bot", color: 0xff0000, accent: 0xff0000 }, [weaponId], new THREE.Vector3(), true);
  const emissions = [], loops = [];
  Object.assign(game, {
    mode, state: "play", settings: data.loadSettings(), players: [human, bot], botTargets: new Map(), botDifficulty: "normal", combatMusicPulse: 0,
    projectiles: [], hazards: [], decoys: [], respawnTimers: [0, 0],
    world: { ropeBlocked: () => false, surfaceHeightAt: () => 0, boostAt: () => null, temporaryWalls: [],
      resolve: (position) => { position.y = 0; return { grounded: true }; }, spawnPoints: () => [new THREE.Vector3(9, 0, 9)] },
    sound: { play: () => {}, playWeapon: () => emissions.push("audio"), updateWeaponLoop: (id, weapon, active) => loops.push(active), stopChargeLoop: () => {}, updateChargeLoop: () => emissions.push("charge") },
    combatVisuals: { muzzle: () => emissions.push("muzzle") },
    controlsNetworkPlayer: () => false, isOnlineMatch: () => false,
    releaseGrapple: (player) => { player.grapple = null; },
    toggleGrapple: (player) => { player.grapple = { anchor: new THREE.Vector3(50, 20, 0) }; }, updateGrapple: () => {},
    removeProjectile: (index) => game.projectiles.splice(index, 1), removeHazard: (index) => game.hazards.splice(index, 1), removeDecoy: (decoy) => game.decoys.splice(game.decoys.indexOf(decoy), 1)
  });
  for (const method of ["spawnProjectile", "spawnMine", "fireBeam", "fireChain", "fireFlame", "fireMelee", "fireHitscan", "explode"]) game[method] = () => emissions.push(method);
  const dispose = () => game.players.forEach((player) => player.dispose());
  return { game, bot, human, emissions, loops, dispose };
}

for (const still of [false, true]) for (const passive of [false, true]) {
  const { game, bot, human, emissions, loops, dispose } = fixture();
  game.setTrainingBotOption("botsStandStill", still);
  game.setTrainingBotOption("botsDontAttack", passive);
  const original = bot.position.clone(), aim = bot.aim.clone(), ammo = bot.ammo.machine_gun;
  const random = Math.random;
  try { Math.random = () => 0; game.updateBot(bot, .1); } finally { Math.random = random; }
  if (still) { assert.deepEqual(bot.position, original); assert.equal(bot.controlMove.lengthSq(), 0); assert.equal(bot.grapple, null); }
  else assert.ok(bot.position.distanceTo(original) > .01, "both normal and non-attacking bots keep moving");
  assert.ok(bot.aim.distanceTo(aim) > .01, "stationary bots still aim normally");
  assert.equal(emissions.length > 0, !passive, "standing still must not suppress attack logic");
  assert.equal(bot.ammo.machine_gun < ammo, !passive);
  if (passive) assert.equal(loops.at(-1), false);
  assert.equal(human.trainingStandStill, false);
  assert.equal(human.trainingDontAttack, false);
  assert.equal(game.trainingControlsMarkup().match(/aria-pressed="true"/g)?.length || 0, Number(still) + Number(passive));
  dispose();
}

for (const weapon of Object.values(data.WEAPONS)) {
  const { game, bot, emissions, dispose } = fixture(weapon.id);
  game.setTrainingBotOption("botsDontAttack", true);
  const before = { ...bot.ammo };
  game.tryFire(bot, true);
  game.beginBurst(bot, data.WEAPONS.burst_rifle);
  bot.pendingBurst = { weaponId: "burst_rifle", remaining: 2, timer: 0 };
  game.updateBurst(bot, 1);
  game.fireBurstRound(bot, data.WEAPONS.burst_rifle);
  game.updateCharge(bot, true, 4);
  bot.chargingWeaponId = "charged_energy_rifle"; bot.chargeTimer = 4;
  game.releaseCharge(bot);
  assert.deepEqual(bot.ammo, before, `${weapon.id}: disabling attacks never consumes ammunition`);
  assert.equal(bot.pendingBurst, null);
  assert.equal(bot.chargingWeaponId, null);
  assert.deepEqual(emissions, [], `${weapon.id}: no projectile, hit, charged shot, burst or weapon audio escapes`);
  dispose();
}

const { game, bot, human, dispose } = fixture("charged_energy_rifle");
game.setTrainingBotOption("botsDontAttack", false);
game.updateCharge(bot, true, 1);
assert.equal(bot.chargingWeaponId, "charged_energy_rifle");
bot.pendingBurst = { remaining: 2 };
game.projectiles = [{ owner: bot }, { owner: human }]; game.hazards = [{ owner: bot }, { owner: human }]; game.decoys = [{ owner: bot }, { owner: human }];
game.setTrainingBotOption("botsDontAttack", true);
assert.equal(bot.chargingWeaponId, null); assert.equal(bot.pendingBurst, null);
for (const collection of [game.projectiles, game.hazards, game.decoys]) assert.deepEqual(collection.map((entry) => entry.owner), [human], "only bot-owned active combat is cleared");
game.setTrainingBotOption("botsStandStill", true);
bot.position.set(9, 5, 7); bot.velocity.set(8, 6, 2); bot.grapple = {};
game.lockTrainingBot(bot);
assert.deepEqual(bot.position, new THREE.Vector3()); assert.equal(bot.velocity.lengthSq(), 0); assert.equal(bot.grapple, null);
bot.takeHit(100); game.respawnTimers[1] = .1;
game.updateRespawns(.2);
assert.equal(bot.alive, true); assert.deepEqual(bot.position, new THREE.Vector3(9, 0, 9));
game.lockTrainingBot(bot); assert.deepEqual(bot.position, new THREE.Vector3(9, 0, 9), "respawn uses the new anchor, never the old spawn");
game.setTrainingBotOption("botsStandStill", false); assert.equal(bot.trainingAnchor, null);
bot.position.set(4, 0, 4); game.setTrainingBotOption("botsStandStill", true); assert.deepEqual(bot.trainingAnchor, bot.position);
const restored = data.loadSettings().matchSettings.training;
assert.equal(restored.botsStandStill, true); assert.equal(restored.botsDontAttack, true);
for (const mode of ["quick", "private"]) {
  game.mode = mode;
  game.applyTrainingBotControls(bot);
  assert.equal(bot.trainingStandStill, false); assert.equal(bot.trainingDontAttack, false);
  assert.equal(game.trainingControlsMarkup(), "");
  game.setTrainingBotOption("botsDontAttack", false);
  assert.equal(game.settings.matchSettings.training.botsDontAttack, true, "online modes cannot change Training-only controls");
}
dispose();
const cleanup = fixture();
let endCues = 0, stoppedLoops = 0, removedObjects = 0;
cleanup.game.removeHazard = Game.prototype.removeHazard;
cleanup.game.removeObject = () => removedObjects++;
cleanup.game.sound.play = (type) => { if (type === "hazardEnd") endCues++; };
cleanup.game.sound.updateHazardLoop = (id, weapon, active) => { assert.equal(active, false); stoppedLoops++; };
cleanup.game.hazards = Array.from({ length: 24 }, (_, index) => ({ owner: cleanup.bot, audioId: `hazard-${index}`, weapon: data.WEAPONS.napalm_launcher, mesh: { position: new THREE.Vector3() } }));
cleanup.game.setTrainingBotOption("botsDontAttack", true);
assert.equal(cleanup.game.hazards.length, 0); assert.equal(stoppedLoops, 24); assert.equal(removedObjects, 24);
assert.equal(endCues, 0, "administrative removal never floods the mix with 24 hazard-end cues");
cleanup.game.hazards.push({ audioId: "normal", weapon: data.WEAPONS.napalm_launcher, mesh: { position: new THREE.Vector3() } });
cleanup.game.removeHazard(0);
assert.equal(endCues, 1, "ordinary gameplay hazard completion remains audible");
cleanup.dispose();
globalThis.localStorage = oldStorage;
console.log("Training controls: four independent states, all 47 attack paths, live cancellation, respawn, persistence and online isolation passed.");
