import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { clampBotCount } from "../src/botBrain.js";
import TEXT from "../src/playerText.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const Game = new Function("THREE", "TEXT", "ui", "clearTouchActions", "clampBotCount", `return ${controller}`)(THREE, TEXT, { querySelector: () => null }, () => {}, clampBotCount);
for (const mode of ["training", "quick", "private", "global"]) {
  const game = Object.create(Game.prototype);
  const local = ["training", "quick"].includes(mode);
  let connections = 0;
  const arenaReached = new Error("local arena construction reached");
  Object.assign(game, {
    mode, freshSessionReady: true, timeLimitMinutes: 3, settings: { botCount: 3 }, sound: {},
    clearMatch() { this.multiplayer = null; }, setMatchLoading() {},
    connectOnlineMatch: async () => { connections++; return { phase: "lobby" }; },
    renderPrivateLobby: () => "online lobby",
    renderPipeline: { setHighLoadMode() { throw arenaReached; } }
  });
  if (local) await assert.rejects(game.startMatch(), error => error === arenaReached);
  else assert.equal(await game.startMatch(), "online lobby");
  assert.equal(connections, local ? 0 : 1, `${mode}: only multiplayer modes contact the server`);
  game.multiplayer = {};
  assert.equal(game.isOnlineMatch(), !local);
  if (!local) continue;
  Object.assign(game, {
    state: "play", paused: false, matchTime: 90, matchStartDelay: 0,
    players: [{ id: "human", alive: true }, { id: "bot", isBot: true, alive: true }],
    scores: [0, 0], targetScore: 10, multiplayer: null,
    input: { releasePointer() {} }, sound: { play() {}, setPaused() {}, updateWeaponLoop() {}, stopChargeLoop() {} },
    touch: {}, world: { update() {} },
    showModal() {}, closeModal() {}, bindUi() {}, trainingControlsMarkup: () => "",
    updateBot: () => { game.botSteps++; }, botSteps: 0, awaitingAudioGesture: false
  });
  for (const method of ["syncGrappleTarget", "handleWeaponSwitch", "updateHuman", "updateBotPlanner", "updateBurst", "updateProjectiles", "updateHazards", "updateDecoys", "processStructuralEvents", "updateEffects", "updateRespawns", "updateAudio", "updateHud"]) game[method] = () => {};
  game.togglePause();
  for (let i = 0; i < 1000; i++) game.update(.033, .25);
  assert.equal(game.matchTime, 90);
  assert.equal(game.botSteps, 0);
  game.togglePause();
  game.update(.033);
  assert.equal(game.botSteps, 1);
  assert.equal(game.matchTime, 90 - .033, "resume spends only the current frame, never paused wall time");
}
console.log("Quick Play and Training launch without matchmaking, freeze while paused, and resume local time; multiplayer modes still connect.");
