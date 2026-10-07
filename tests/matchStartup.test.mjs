import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAYER_TEXT } from "../PLAYER_TEXT.js";
import { SimulationTiming, RenderInterpolation } from "../src/simulationTiming.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const frames = [];
const journeys = [];
let markupWrites = 0, bootStatusPresent = true, menuBindings = 0;
const shell = { dataset: {} };
const bootButtons = [{ dataset: { bootMode: "quick" } }, { dataset: { bootScreen: "settings" } }];
const bootStatus = {
  textContent: "Loading",
  removeAttribute(name) { if (name === "data-boot-status") bootStatusPresent = false; },
  setAttribute() {}
};
const ui = {
  querySelector: selector => selector === "[data-boot-status]" ? bootStatusPresent && bootStatus : shell,
  querySelectorAll: () => bootButtons,
  set innerHTML(value) { markupWrites++; assert.match(value, /<h1>/); }
};
const Game = new Function("requestAnimationFrame", "performance", "TEXT", "setJourney", "matchLoading", "ui", "menuAtmosphereMarkup", "SimulationTiming", "RenderInterpolation", `return ${controller}`)(
  callback => frames.push(callback), { mark() {}, measure() {} }, PLAYER_TEXT, path => journeys.push(path), null, ui, () => "", SimulationTiming, RenderInterpolation);
const menu = Object.assign(Object.create(Game.prototype), {
  settings: { graphics: "low" },
  sound: Object.fromEntries(["resume", "setVolume", "setMix", "setPaused", "setMusicScene", "startMusic"].map(name => [name, () => {}])),
  stopGameplayPreparation() {}, clearMatch() {}, bindUi() { menuBindings++; }
});
menu.renderMain({ reuseShell: true });
assert.equal(markupWrites, 0, "engine readiness retains the painted heading and focused menu controls");
assert.equal(menuBindings, 1);
assert.equal(shell.dataset.menuQuality, "low");
assert.deepEqual(bootButtons.map(button => button.dataset), [{ mode: "quick" }, { screen: "settings" }], "ready buttons have one handler path, with no boot attributes");
assert.equal(bootStatus.textContent, PLAYER_TEXT.landing.highlights);
menu.renderMain();
assert.equal(markupWrites, 1, "returning from another game screen still renders the landing menu");
let submittedFrames = 0;
const scene = Object.assign(Object.create(Game.prototype), {
  state: "menu", world: null, updateCamera() {}, settings: {},
  renderPipeline: { render() { submittedFrames++; } }
});
assert.equal(scene.renderScene(), false, "the hidden game canvas does not consume GPU frames behind menus");
assert.equal(submittedFrames, 0);
let menuResizes = 0, menuSimulationUpdates = 0;
Object.assign(scene, {
  renderSize: { width: 800, height: 600, pixelRatio: 1 },
  commitResize() { menuResizes++; this.renderSize.width += 40; this.renderSize.height += 20; },
  timer: { update() {}, getDelta: () => 1 / 60 }, input: { endFrame() {} },
  update() { menuSimulationUpdates++; },
  queueGameplayPreparation() { assert.fail("menu resize frames must not restart arena construction or GPU warmup"); },
  prepareGameplayResources() { assert.fail("gameplay resources prepare only after an explicit match launch"); }
});
for (const [mode, state] of [["quick", "menu"], ["training", "menu"], ["private", "lobby"], ["global", "global"], ["global", "lobby"]]) {
  Object.assign(scene, { mode, state });
  scene.frame(menuResizes * 16);
  scene.frame(menuResizes * 16);
}
assert.equal(menuResizes, 10, "menu and lobby frames still apply viewport changes");
assert.equal(submittedFrames, 0, "resizing local or public loadout menus submits no gameplay GPU work");
assert.equal(menuSimulationUpdates, 0, "menu resize frames do not simulate gameplay");
scene.world = { updatePresentation() {} };
scene.state = "play"; scene.paused = true;
assert.equal(scene.renderScene(), true, "paused matches keep their visible arena background");
assert.equal(submittedFrames, 1);
const game = Object.create(Game.prototype);
const renderer = {}, sound = {}, pipeline = {}, settings = { loadout: ["a", "b"] };
let starts = 0, label;
Object.assign(game, { renderer, sound, renderPipeline: pipeline, settings, seed: "REPLAY", timeLimitMinutes: 7,
  setMatchLoading(visible, seed, sameSeed) { label = { visible, seed, sameSeed }; if (visible) this.setJourney("/loading"); },
  startMatch(welcome, painted) { assert.equal(painted, true); starts++; this.matchStartQueued = false; }
});
game.queueRematch(); game.queueRematch();
assert.deepEqual(label, { visible: true, seed: "REPLAY", sameSeed: true });
assert.equal(starts, 0);
frames.shift()(); assert.equal(starts, 0, "loader gets a paint before arena construction");
frames.shift()(); assert.equal(starts, 1, "duplicate launch clicks build only one match");
assert.equal(game.renderer, renderer); assert.equal(game.sound, sound);
assert.equal(game.renderPipeline, pipeline); assert.equal(game.settings, settings);
assert.equal(game.timeLimitMinutes, 7);
game.queueRematch(); game.matchStartQueued = false; game.queueRematch();
while (frames.length) frames.shift()();
assert.equal(starts, 2, "a cancelled launch cannot consume a later launch's ticket");

let resolveGpu, rejectGpu, updates = 0, renders = 0, countdowns = 0, failures = 0;
Object.assign(game, {
  state: "play", paused: false, world: {}, hideMatchLoadingAfterFrame: true,
  matchFrameReady: false, matchFramePending: false, matchTime: 420,
  renderer: { backend: { device: { queue: { onSubmittedWorkDone: () => new Promise((resolve, reject) => { resolveGpu = resolve; rejectGpu = reject; }) } } } },
  input: { tapped: () => false, endFrame() {} }, timer: { update() {}, getDelta: () => 6.5 },
  commitResize() {}, renderScene() { renders++; return true; },
  update() { updates++; this.matchTime--; }, updateAudio() {}, updateHud() {}, updatePerformanceSample() {},
  startMatchCountdown() { countdowns++; }, showRendererFailure() { failures++; }
});
game.frame(0);
game.preparingMatch = true;
game.frame(1);
assert.equal(renders, 1, "fighter warmup cannot submit a visible gameplay frame");
assert.equal(updates, 0, "fighter warmup cannot advance simulation");
game.preparingMatch = false;
for (let i = 0; i < 400; i++) game.frame(i * 16);
assert.equal(renders, 1, "do not enqueue more GPU work while the first frame is pending");
assert.equal(updates, 0); assert.equal(countdowns, 0); assert.equal(game.matchTime, 420);
assert.equal(journeys.at(-1), "/loading", "GPU preparation must not report playable gameplay");
resolveGpu(); await Promise.resolve();
assert.equal(countdowns, 0, "GPU completion alone does not start audio before the next browser frame");
game.frame(6500);
assert.equal(countdowns, 1); assert.equal(updates, 0); assert.equal(label.visible, false);
assert.equal(journeys.at(-1), "/game", "the first visible frame records gameplay");
const journeyCount = journeys.length;
game.frame(6516); assert.equal(updates, 1);
assert.equal(journeys.length, journeyCount, "normal gameplay frames do not repeat pageviews");

game.hideMatchLoadingAfterFrame = true; game.matchFrameReady = false;
game.waitForMatchFrame();
game.world = {}; game.matchFramePending = false;
resolveGpu(); await Promise.resolve();
assert.equal(game.matchFrameReady, false, "an old frame cannot unlock a replacement arena");
game.waitForMatchFrame(); game.hideMatchLoadingAfterFrame = false;
resolveGpu(); await Promise.resolve();
assert.equal(game.matchFrameReady, false, "returning to the menu cancels frame completion");
game.hideMatchLoadingAfterFrame = true; game.waitForMatchFrame();
rejectGpu(new Error("device lost")); await Promise.resolve();
assert.equal(failures, 1, "GPU failure surfaces the existing recovery UI");
game.renderer.backend = {}; game.waitForMatchFrame(); await Promise.resolve();
assert.equal(game.matchFrameReady, true, "WebGL's synchronous submission also waits for a subsequent browser frame");

let audioStarts = 0;
Object.assign(game, { hideMatchLoadingAfterFrame: true, awaitingAudioGesture: true, settings: {},
  sound: { resume: () => true, setVolume() {}, setMix() {}, startCountdown() { audioStarts++; } }
});
game.resumeAudioAfterReload();
assert.equal(audioStarts, 0, "an audio unlock gesture during GPU warmup cannot start the countdown");
assert.equal(game.awaitingAudioGesture, false);
game.hideMatchLoadingAfterFrame = false; game.preparingMatch = true;
game.resumeAudioAfterReload();
assert.equal(audioStarts, 0, "an audio unlock gesture during fighter preparation also waits");
game.preparingMatch = false;
let audioPaused;
Object.assign(game, { mode: "global", world: { theme: { id: "test" } },
  sound: { startAmbience() {}, setMusicIntensity() {}, setMusicScene() {}, startMusic() {}, setPaused(value) { audioPaused = value; } }
});
for (const paused of [true, false]) {
  game.paused = paused;
  Game.prototype.startMatchCountdown.call(game);
  assert.equal(audioPaused, paused, "finishing loading must respect a pause caused by switching tabs");
}
game.state = "lobby";
game.setJourney("/private-lobby");
Game.prototype.setMatchLoading.call(game, true);
Game.prototype.setMatchLoading.call(game, true);
Game.prototype.setMatchLoading.call(game, false);
assert.equal(game.journeyPath, "/private-lobby", "failed/timed-out lobby launches restore the waiting room journey");
console.log("In-memory replay, slow GPU countdown gating, journey readiness/recovery, cancellation, failure and WebGL startup checks passed.");
