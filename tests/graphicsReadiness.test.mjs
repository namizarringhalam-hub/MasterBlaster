import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const method = (name, next) => new Function("TEXT", `return ({${source.slice(source.indexOf(`  ${name}(`), source.indexOf(`\n  ${next}(`))}}).${name};`)({ errors: { graphicsReset: "Graphics reset" } });
const prepareRenderPipeline = method("prepareRenderPipeline", "applyGraphicsEffects");
const disposeAfterGraphicsWarmup = method("disposeAfterGraphicsWarmup", "clearMatch");
const frame = method("frame", "updateFrameInput");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture() {
  const compile = deferred(), started = deferred(), submitted = deferred(), events = [];
  const pipeline = { resetHistory: () => events.push("reset"), async prepareRender(valid) {
    events.push("compile"); started.resolve(); await compile.promise; return valid();
  } };
  const game = { world: {}, camera: {}, renderPipeline: pipeline, sceneDirty: false, simulationFrameActive: true,
    shadowRig: { update: () => events.push("shadow") }, renderer: { backend: { device: { queue: { onSubmittedWorkDone: () => submitted.promise } } } },
    showRendererFailure: message => events.push(message), prepareRenderPipeline, disposeAfterGraphicsWarmup };
  return { game, pipeline, compile, submitted, started, events };
}

// A live graphics edit cannot become a held frame until both shader discovery
// and submitted GPU work finish; resources remain owned during either await.
{
  const { game, pipeline, compile, submitted, started, events } = fixture();
  const pending = game.prepareRenderPipeline(pipeline);
  assert.equal(game.preparingGraphics, true, "gate is synchronous, including the resize transaction frame");
  await started.promise;
  let disposed = false;
  game.disposeAfterGraphicsWarmup(() => { disposed = true; });
  compile.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(disposed, false); assert.equal(game.preparingGraphics, true);
  submitted.resolve(); await pending;
  assert.equal(disposed, true); assert.equal(game.preparingGraphics, false);
  assert.equal(game.sceneDirty, true); assert.equal(game.simulationFrameActive, false);
  assert.deepEqual(events, ["shadow", "reset", "compile", "reset"]);
}

// Replacing the world while shaders compile cancels its result without resetting
// a new owner's history or displaying an obsolete error over a new match.
for (const failure of [false, true]) {
  const { game, pipeline, compile, submitted, started, events } = fixture();
  const pending = game.prepareRenderPipeline(pipeline); await started.promise;
  game.world = {};
  if (failure) compile.reject(new Error("obsolete shader")); else compile.resolve();
  submitted.resolve(); await pending;
  assert.deepEqual(events, ["shadow", "reset", "compile"]);
  assert.equal(game.preparingGraphics, false);
}

// A queued replacement retains the gate until the latest graph has settled.
{
  const { game, pipeline, compile, submitted, started, events } = fixture();
  const first = game.prepareRenderPipeline(pipeline); await started.promise;
  const nextCompile = deferred(), nextStarted = deferred();
  const next = { resetHistory() {}, async prepareRender() { nextStarted.resolve(); await nextCompile.promise; } };
  game.renderPipeline = next;
  const second = game.prepareRenderPipeline(next);
  compile.resolve(); submitted.resolve(); await first; await nextStarted.promise;
  assert.equal(game.preparingGraphics, true);
  nextCompile.resolve(); await second;
  assert.equal(game.preparingGraphics, false);
  assert.deepEqual(events, ["shadow", "reset", "compile", "shadow"]);
}

// Current compilation failures reach the user and release the preparation gate.
{
  const { game, pipeline, compile, started, events } = fixture();
  const pending = game.prepareRenderPipeline(pipeline); await started.promise;
  compile.reject(new Error("shader failed")); await pending;
  assert.equal(events.at(-1), "shader failed"); assert.equal(game.preparingGraphics, false);
}

// Re-check the gate after commitResize: the setting change starts preparation
// there, after the frame's first early-return test.
{
  let commits = 0;
  frame.call({ commitResize() { commits++; this.preparingGraphics = true; },
    timer: { update() { throw new Error("frame advanced while shaders were pending"); } } }, 0);
  assert.equal(commits, 1);
}
console.log("Graphics readiness waits for compilation/submission, protects owners, cancels stale results and holds live-setting frames.");
