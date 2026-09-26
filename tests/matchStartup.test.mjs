import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const frames = [];
const Game = new Function("requestAnimationFrame", "performance", "TEXT", `return ${controller}`)(
  callback => frames.push(callback), { mark() {}, measure() {} }, { errors: { graphicsReset: "GPU lost" } });
const game = Object.create(Game.prototype);
const renderer = {}, sound = {}, pipeline = {}, settings = { loadout: ["a", "b"] };
let starts = 0, label;
Object.assign(game, { renderer, sound, renderPipeline: pipeline, settings, seed: "REPLAY", timeLimitMinutes: 7,
  setMatchLoading(visible, seed, sameSeed) { label = { visible, seed, sameSeed }; },
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
  update() { updates++; this.matchTime--; }, updateHud() {}, updatePerformanceSample() {},
  startMatchCountdown() { countdowns++; }, showRendererFailure() { failures++; }
});
game.frame(0);
for (let i = 0; i < 400; i++) game.frame(i * 16);
assert.equal(renders, 1, "do not enqueue more GPU work while the first frame is pending");
assert.equal(updates, 0); assert.equal(countdowns, 0); assert.equal(game.matchTime, 420);
resolveGpu(); await Promise.resolve();
assert.equal(countdowns, 0, "GPU completion alone does not start audio before the next browser frame");
game.frame(6500);
assert.equal(countdowns, 1); assert.equal(updates, 0); assert.equal(label.visible, false);
game.frame(6516); assert.equal(updates, 1);

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
let audioPaused;
Object.assign(game, { mode: "global", world: { theme: { id: "test" } },
  sound: { startAmbience() {}, setMusicIntensity() {}, setMusicScene() {}, startMusic() {}, setPaused(value) { audioPaused = value; } }
});
for (const paused of [true, false]) {
  game.paused = paused;
  Game.prototype.startMatchCountdown.call(game);
  assert.equal(audioPaused, paused, "finishing loading must respect a pause caused by switching tabs");
}
console.log("In-memory replay, slow GPU countdown gating, cancellation, failure and WebGL startup checks passed.");
