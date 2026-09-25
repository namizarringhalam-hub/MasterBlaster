import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { clampBotCount } from "../src/botBrain.js";
import TEXT from "../src/playerText.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const ui = { querySelector: () => null };
const Game = new Function("THREE", "TEXT", "ui", "clearTouchActions", "clampBotCount", "escapeHtml", `return ${controller}`)(THREE, TEXT, ui, () => {}, clampBotCount, String);
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

// The controls modal returns to its paused parent; Escape must never resume it.
const game = Object.create(Game.prototype);
let markup, options, focused = false, prevented = false;
Object.assign(game, { paused: true, showModal(html, config) { markup = html; options = config; } });
game.showControls();
assert.equal(options.kind, "controls");
assert.equal(options.cancel, "close");
assert.match(markup, /data-action="close-controls" autofocus/);
assert.doesNotMatch(markup, /class="controls-touch" open/);
game.coarsePointer = true;
game.showControls();
assert.match(markup, /class="controls-touch" open/);
const handlers = {};
const dialog = {
  open: false, querySelector: () => null,
  addEventListener(type, handler) { handlers[type] = handler; },
  showModal() { this.open = true; }, close() { this.open = false; }, remove() {},
};
const previousDocument = globalThis.document;
try {
  globalThis.document = { activeElement: { focus() { focused = true; } } };
  ui.insertAdjacentHTML = () => {};
  ui.querySelector = () => dialog;
  Game.prototype.showModal.call(game, markup, options);
  handlers.keydown({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
  assert.equal(focused, true, "focus returns to the Controls button");
  assert.equal(game.paused, true, "closing Controls preserves the paused match");
} finally {
  globalThis.document = previousDocument;
}
console.log("Controls supports keyboard and touch help; Escape returns focus without resuming gameplay.");
