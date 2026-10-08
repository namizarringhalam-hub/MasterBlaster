import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAYER_TEXT } from "../PLAYER_TEXT.js";
import { SimulationTiming, RenderInterpolation } from "../src/simulationTiming.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const frames = [];
const journeys = [];
const openDialogs = [];
const loadingLabels = { "[data-match-seed]": {}, "[data-match-kind]": {} };
const matchLoading = { hidden: true, querySelector: selector => loadingLabels[selector] };
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
  querySelectorAll: selector => selector === "dialog[open]" ? [...openDialogs] : bootButtons,
  set innerHTML(value) { markupWrites++; assert.match(value, /<h1>/); }
};
const Game = new Function("requestAnimationFrame", "performance", "TEXT", "setJourney", "matchLoading", "ui", "menuAtmosphereMarkup", "SimulationTiming", "RenderInterpolation", `return ${controller}`)(
  callback => frames.push(callback), { mark() {}, measure() {} }, PLAYER_TEXT, path => journeys.push(path), matchLoading, ui, () => "", SimulationTiming, RenderInterpolation);
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
const loadingMusicStates = [];
const renderer = {}, sound = { setLoadingMusic: visible => loadingMusicStates.push(visible) }, pipeline = {}, settings = { loadout: ["a", "b"] };
let starts = 0, label;
Object.assign(game, { renderer, sound, renderPipeline: pipeline, settings, seed: "REPLAY", timeLimitMinutes: 7,
  setMatchLoading(visible, seed, sameSeed) { label = { visible, seed, sameSeed }; Game.prototype.setMatchLoading.call(this, visible, seed, sameSeed); },
  startMatch(welcome, painted) { assert.equal(painted, true); starts++; this.matchStartQueued = false; }
});
function openMatchDialog(path, returnPath) {
  const dialog = { open: true, journeyPath: path, journeyReturnPath: returnPath,
    close() { this.open = false; }, remove() { openDialogs.splice(openDialogs.indexOf(this), 1); }
  };
  openDialogs.push(dialog);
  game.setJourney(path);
  return dialog;
}
const results = openMatchDialog("/results", "/game");
game.queueRematch(); game.queueRematch();
assert.deepEqual(label, { visible: true, seed: "REPLAY", sameSeed: true });
assert.equal(results.open, false, "results leave the top layer synchronously, before preparation starts");
assert.equal(openDialogs.length, 0);
assert.equal(matchLoading.hidden, false);
assert.equal(game.journeyPath, "/loading", "closing results cannot restore the old game journey");
const queuedFrame = Object.assign(Object.create(Game.prototype), {
  matchStartQueued: game.matchStartQueued,
  commitResize() { assert.fail("queued launches must give the loader a paint before resize work"); },
  renderScene() { assert.fail("queued launches must not render the old arena"); }
});
queuedFrame.frame(0);
assert.equal(starts, 0);
frames.shift()(); assert.equal(starts, 0, "loader gets a paint before arena construction");
frames.shift()(); assert.equal(starts, 1, "duplicate launch clicks build only one match");
assert.equal(game.renderer, renderer); assert.equal(game.sound, sound);
assert.equal(game.renderPipeline, pipeline); assert.equal(game.settings, settings);
assert.equal(game.timeLimitMinutes, 7);
const pause = openMatchDialog("/pause", "/game");
const controls = openMatchDialog("/controls", "/pause");
game.queueRematch(); game.matchStartQueued = false; game.queueRematch();
assert.equal(pause.open, false, "pause restart also uncovers the loader");
assert.equal(controls.open, false, "nested match dialogs cannot cover the loader");
assert.equal(openDialogs.length, 0);
assert.equal(game.journeyPath, "/loading");
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
  sound: { setLoadingMusic: visible => loadingMusicStates.push(visible), startAmbience() {}, setMusicIntensity() {}, setMusicScene() {}, startMusic() {}, setPaused(value) { audioPaused = value; } }
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
assert.deepEqual(loadingMusicStates.slice(-3), [true, true, false], "shared loading protects music and releases it when a launch is cancelled");

// Exercise the real controller cleanup while native shader compilation owns
// resources. Navigation stays synchronous; only resource disposal waits.
const OwnershipGame = new Function("clearTouchActions", "disposeGameplaySamples", "uniquePlayersById", `return ${controller}`)(
  () => {}, (_game, entry) => entry?.dispose(), players => players);
function ownershipFixture() {
  const disposed = [], immediate = [];
  const owner = name => ({ disposed: false, dispose() { this.disposed = true; disposed.push(name); } });
  const player = Object.assign(owner("player"), { id: "departing", group: { removeFromParent() { immediate.push("detach"); } } });
  const fixture = Object.assign(Object.create(OwnershipGame.prototype), {
    state: "loading", preparingGraphics: true, resourceLaunchToken: {}, preparingMatch: true,
    combatVisuals: owner("visuals"), matchPreparation: owner("samples"), world: owner("world"), players: [player],
    projectiles: [], hazards: [], decoys: [], effects: [], scores: [0], touch: {},
    botTargets: new Map(), networkTargets: new Map([[player.id, {}]]), networkRespawnRequests: new Map(),
    input: { releasePointer() { immediate.push("pointer"); } }, renderPipeline: { motionBlur: { reset() {} } },
    sound: { stopOwner() { immediate.push("audio"); }, stopAll() { immediate.push("all-audio"); } },
    releaseGrapple(current) { assert.equal(current.disposed, false, "grapples release before fighter resources are disposed"); immediate.push("grapple"); },
    removeOwnedCombat() {}, hideNetworkReconnecting() {}, removeObject() {},
    multiplayer: { playerId: "local", close() { immediate.push("network"); } }
  });
  return { fixture, disposed, immediate, player };
}
for (const reject of [false, true]) {
  const { fixture, disposed, immediate, player } = ownershipFixture();
  let finish;
  fixture.graphicsWarmup = new Promise((resolve, fail) => { finish = reject ? () => fail(Error("shader cancelled")) : resolve; });
  const oldWorld = fixture.world;
  fixture.clearMatch();
  assert.equal(fixture.resourceLaunchToken, null, "navigation cancels the launch before compilation settles");
  assert.equal(fixture.preparingMatch, false);
  assert.equal(fixture.world, null); assert.equal(fixture.combatVisuals, null); assert.equal(fixture.matchPreparation, null);
  assert.deepEqual(fixture.players, []);
  assert.equal(fixture.multiplayer, null, "network cleanup does not wait for compilation");
  assert.ok(immediate.includes("audio") && immediate.includes("grapple") && immediate.includes("all-audio"));
  assert.deepEqual(disposed, [], "cancellation keeps every captured resource alive while compilation is pending");
  const replacement = { dispose() { assert.fail("old cleanup must not dispose replacement resources"); } };
  Object.assign(fixture, { world: replacement, combatVisuals: replacement, matchPreparation: replacement, players: [replacement] });
  finish();
  await fixture.graphicsWarmup.catch(() => {});
  await Promise.resolve();
  assert.deepEqual(disposed, ["visuals", "samples", "world", "player"], "both success and failure release only captured owners");
  assert.equal(oldWorld.disposed, true); assert.equal(player.disposed, true);
  assert.equal(fixture.world, replacement); assert.deepEqual(fixture.players, [replacement]);
}
const immediateCleanup = ownershipFixture();
immediateCleanup.fixture.preparingGraphics = false;
immediateCleanup.fixture.clearMatch();
assert.deepEqual(immediateCleanup.disposed, ["visuals", "samples", "world", "player"], "ordinary match cleanup remains synchronous");

const departed = ownershipFixture();
let finishRosterWarmup;
departed.fixture.graphicsWarmup = new Promise(resolve => { finishRosterWarmup = resolve; });
departed.fixture.syncOnlineRoster({ players: [] });
assert.deepEqual(departed.fixture.players, [], "authoritative departures update the live roster immediately");
assert.equal(departed.fixture.networkTargets.has(departed.player.id), false);
assert.ok(departed.immediate.includes("detach") && departed.immediate.includes("grapple") && departed.immediate.includes("audio"));
assert.deepEqual(departed.disposed, [], "departing fighters retain shader resources until compilation settles");
finishRosterWarmup(); await departed.fixture.graphicsWarmup; await Promise.resolve();
assert.deepEqual(departed.disposed, ["player"]);

for (const outcome of ["resolved", "rejected", "ordinary"]) {
  const removals = [], released = [];
  const cleanup = Object.create(OwnershipGame.prototype);
  let settle;
  cleanup.scene = { remove(object) { removals.push(object); } };
  cleanup.preparingGraphics = outcome !== "ordinary";
  cleanup.graphicsWarmup = new Promise((resolve, reject) => { settle = outcome === "rejected" ? () => reject(Error("native pipeline failed")) : resolve; });
  const object = { traverse(callback) {
    callback({ geometry: { userData: {}, dispose() { released.push("geometry"); } }, material: { dispose() { released.push("material"); } } });
    callback({ geometry: { userData: { sharedProjectile: true }, dispose() { assert.fail("shared projectile geometry must survive removal"); } },
      material: ["array-1", "array-2"].map(name => ({ dispose() { released.push(name); } })) });
  } };
  cleanup.removeObject(object);
  cleanup.removeObject(null);
  assert.deepEqual(removals, [object], "transient objects leave the scene immediately during native preparation");
  assert.deepEqual(released, outcome === "ordinary" ? ["geometry", "material", "array-1", "array-2"] : [], "pending native preparation retains transient geometry and materials");
  settle(); await cleanup.graphicsWarmup.catch(() => {}); await Promise.resolve();
  assert.deepEqual(released, ["geometry", "material", "array-1", "array-2"], "transient resources dispose exactly once after success or failure");
}
console.log("In-memory replay, slow GPU countdown gating, journey readiness/recovery, cancellation, failure and WebGL startup checks passed.");
