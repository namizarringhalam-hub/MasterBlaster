import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { getCurrentStack, getNormalFromDepth, normalView, setCurrentStack, stack, uniform, vec2, vec4 } from "three/tsl";
import WebGPUPipelineUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js";
import { ArenaWorld, structuralPanelGeometry, structuralRouteGeometry } from "../src/world.js";
import { Fighter } from "../src/player.js";
import { graphicsProfile, swapStolenWeapon, WEAPONS } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import { NeonRenderPipeline, recoverInvalidAONormals } from "../src/renderPipeline.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { surfaceTextures } from "../src/surfaceTextures.js";

// Execute the fixture's actual wait helper with a stopped animation clock.
const graphicsFixture = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
// Execute the exact capture block: later frame counters must not alter evidence.
const captureSource = graphicsFixture.slice(graphicsFixture.indexOf("    const grapple = game.players[0]?.grapple;"), graphicsFixture.indexOf('    const link = select("canvas-capture");'));
const captureFrame = new Function("game", "renderedFrames", "sceneSerial", "select", "ropeRenders", "ropeRendersBefore", "errorCount", `let canvasCapture; ${captureSource}; return canvasCapture;`);
for (const renders of [0, 1]) {
  const captureGame = { players: [{ grapple: { anchor: new THREE.Vector3(1, 2, 3), line: { geometry: { instanceCount: 1 }, material: { blending: THREE.NoBlending } } } }],
    renderer: { info: { render: { drawCalls: 378, triangles: 169330 } } }, renderPipeline: { direct: false } };
  const captured = captureFrame(captureGame, 8, 1, () => ({ value: "effects" }), 4 + renders, 4, 0);
  captureGame.renderer.info.render.drawCalls = 1;
  assert.equal(captured.draws, 378);
  assert.equal(captured.rope.rendersThisFrame, renders, "a live grapple object alone cannot certify a rendered rope");
  assert.equal(captured.rope.segments, 1);
  captureGame.players = [];
  assert.equal(captureFrame(captureGame, 9, 1, () => ({ value: "effects" }), 4, 4, 0).rope, null);
}
const hideAOObjectSource = graphicsFixture.slice(graphicsFixture.indexOf("function hideAOObjectForReview("), graphicsFixture.indexOf("const requestedAOOutput"));
for (const hidden of [null, "grid", "route", "unknown"]) {
  const hide = new Function("hiddenAOObject", `${hideAOObjectSource}; return hideAOObjectForReview;`)(hidden);
  const objects = [{ type: "GridHelper", visible: true }, { name: "District route floor", visible: true }, { name: "Arena floor", visible: true }];
  objects.forEach(hide);
  assert.deepEqual(objects.map(object => object.visible), [hidden !== "grid", hidden !== "route", true], "QA visibility isolation changes only the requested object, never the ground");
}
const aoWrapperSource = graphicsFixture.slice(graphicsFixture.indexOf("function withAODiagnostics("), graphicsFixture.indexOf("// QA-only causal comparison"));
const geometryNormalToken = {}, colorOutputToken = {};
const makeAOWrapper = new Function("mrt", "normalViewGeometry", "output", "geometryAONormals", "aoOutput", "vec3", "vec4", "depthAONormals", "legacyAONormals", "normalView", "materialBlendAONormals", "THREE", "recoverAONormals", "singleSampleAO", "emulateCompatibilityAO", `${aoWrapperSource}; return withAODiagnostics;`);
const wrapAONormals = makeAOWrapper(value => value, geometryNormalToken, colorOutputToken, true, "final");
let aoOverrides = 0, aoBuildCalls = 0;
const aoFixture = { ensure: wrapAONormals(function (value) {
  aoBuildCalls++; this.aoPass = {};
  this.scenePass ??= { setMRT(value) { aoOverrides++; assert.ok(value.normal === geometryNormalToken && value.output === colorOutputToken); } };
  return value;
}) };
assert.equal(aoFixture.ensure(7), 7);
assert.equal(aoFixture.ensure(8), 8);
assert.equal(aoBuildCalls, 2); assert.equal(aoOverrides, 1, "QA normal comparison overrides only newly created AO scene passes");
const noAOFixture = { ensure: wrapAONormals(function () { this.scenePass = { setMRT() { throw new Error("non-AO pass changed"); } }; }) };
noAOFixture.ensure();
const depthAOFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, true)(function () {
  this.aoPass = { normalNode: {} }; this.scenePass = {};
}) };
depthAOFixture.ensure();
assert.equal(depthAOFixture.aoPass.normalNode, null, "depth-normal diagnostic changes only the AO normal source");
const legacyAOFixture = { ensure: makeAOWrapper(value => value, null, colorOutputToken, false, "final", null, null, false, true, normalView)(function () {
  this.aoPass = {}; this.scenePass = { setMRT(value) { assert.ok(value.normal === normalView && value.output === colorOutputToken); } };
}) };
legacyAOFixture.ensure();
let normalBlend;
const materialBlendFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, false, false, null, true, THREE)(function () {
  this.aoPass = {}; this.scenePass = { getMRT: () => ({ setBlendMode(name, blend) { assert.equal(name, "normal"); normalBlend = blend; } }) };
}) };
materialBlendFixture.ensure();
assert.equal(normalBlend.blending, THREE.MaterialBlending);

function assertCompatibleAONormals(root) {
  root.traverse(object => {
    for (const material of [].concat(object.material || [])) {
      if (material.depthWrite || !material.colorWrite) continue;
      assert.equal(material.transparent, true, "visible non-depth writers need alpha blending on compatibility GPUs");
      assert.equal(material.premultipliedAlpha, false, "a premultiplied normal needs separate coverage handling");
      assert.ok([THREE.NormalBlending, THREE.AdditiveBlending].includes(material.blending), "new blend modes need AO compatibility coverage");
      const blend = WebGPUPipelineUtils.prototype._getBlending.call({}, material);
      assert.equal(blend.color.srcFactor, "src-alpha");
      assert.ok(["one", "one-minus-src-alpha"].includes(blend.color.dstFactor));
      assert.equal(blend.color.operation, "add", "alpha zero preserves the destination normal in compatibility mode");
    }
  });
}
for (const mode of ["raw", "color"]) {
  const rawToken = {}, colorToken = {};
  const wrap = makeAOWrapper(() => { throw new Error("diagnostic changed material normals"); }, geometryNormalToken, colorOutputToken, false, mode,
    value => value, value => value);
  const target = { ensure: wrap(function () {
    this.aoPass = { getTextureNode: () => ({ r: rawToken }) };
    this.scenePass = { getTextureNode: () => colorToken };
    this.pipeline = {};
  }) };
  target.ensure();
  assert.ok(target.pipeline.outputNode === (mode === "raw" ? rawToken : colorToken));
  assert.equal(target.pipeline.needsUpdate, true);
}
const waitSource = graphicsFixture.slice(graphicsFixture.indexOf("function waitForReviewFrame("), graphicsFixture.indexOf("const stillMove"));
let timeoutCallback, frameCallback, cleared = 0, cancelled = 0, serial = 3;
const makeWait = new Function("setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "getSerial",
  waitSource.replaceAll("sceneSerial", "getSerial()") + "; return waitForReviewFrame;");
const waitReview = makeWait(callback => { timeoutCallback = callback; return 9; }, () => cleared++,
  callback => { frameCallback = callback; return 7; }, () => cancelled++, () => serial);
const stalledWait = waitReview(3, () => false);
timeoutCallback();
await assert.rejects(stalledWait, /timed out/, "a suspended rAF cannot prevent the independent timeout");
assert.equal(cleared, 1); assert.equal(cancelled, 1);
await waitReview(3, () => true);
assert.equal(cleared, 2); assert.equal(cancelled, 2);
const interruptedWait = waitReview(3, () => false);
serial = 4; frameCallback();
await assert.rejects(interruptedWait, /scene change/);

const traceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceStartupMethod("), graphicsFixture.indexOf("if (traceStartup) {"));
let traceClock = 0;
const startupCalls = {};
const traceMethod = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, startupCalls);
const tracedTarget = { offset: 4, draw(value) { return this.offset + value; } };
traceMethod(tracedTarget, "draw", "test");
for (let i = 0; i < 20; i++) assert.equal(tracedTarget.draw(i), i + 4, "timing preserves receiver, arguments and return values");
assert.equal(startupCalls["test.draw"].calls, 20, "startup totals include calls beyond the old twelve-pipeline sample");
assert.equal(startupCalls["test.draw"].totalMs, 20);
assert.equal(startupCalls["test.draw"].slowest.length, 8, "startup detail retention stays bounded");
const shaderTarget = { object: { name: "Fighter thruster pair" }, material: { type: "MeshBasicMaterial" }, build() { return this.object; } };
traceMethod(shaderTarget, "build", "nodeBuilder");
assert.ok(shaderTarget.build() === shaderTarget.object);
assert.equal(startupCalls["nodeBuilder.build"].calls, 1, "actual shader builds are counted separately from cache lookups");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].object, "Fighter thruster pair");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].material, "MeshBasicMaterial");
const expectedFailure = new Error("original failure");
tracedTarget.fail = () => { throw expectedFailure; };
traceMethod(tracedTarget, "fail", "test");
assert.throws(() => tracedTarget.fail(), error => error === expectedFailure, "instrumentation cannot swallow rendering errors");
assert.equal(startupCalls["test.fail"].calls, 1);
const inactiveTrace = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now() { throw new Error("inactive timing"); } }, null);
const inactiveTarget = { draw: value => value };
inactiveTrace(inactiveTarget, "draw", "test");
assert.equal(inactiveTarget.draw(7), 7, "timing stops after the bounded startup capture");

for (const [seed, expected] of [
  ["GRAPHICS-QA-structure", ["3fcaf9d84ec4401241287fef3d3288259e9493dd3171fc3d3bd7ccf8cec086ec", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "183e544aca3ae4ebc7b6ada691287b7adfd03daeab38bd51a0c6056b5153a381"]],
  ["FOUNDRY111-ground", ["8464cd7f25660d46d3c91713d3f67e7a41d2a473a713646b75f8c02a6c5ec38b", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "0ad986808bd82a92fd56401c5747bee252f9a867a786b82e462f4839fd7ca2bf"]]
]) {
  const maps = surfaceTextures(seed, 4);
  assert.deepEqual(maps.map(map => createHash("sha256").update(map.image.data).digest("hex")), expected, "height-field reuse preserves every texture byte");
  maps.forEach(map => map.dispose());
}

const coverMaps = surfaceTextures("COVER-TEST", 4, true);
const normalPixel = (x, y) => coverMaps[1].image.data[(y * 256 + x) * 4];
assert.equal(normalPixel(2, 24), 127, "machined plate is flat two texels from a narrow seam, not broadly rounded");
assert.equal(normalPixel(64, 24), 127, "cover has two large plates per axis, not a four-cell upholstered grid");
assert.ok(Math.abs(normalPixel(128, 24) - 127) > 15, "the narrow inter-plate seam remains visibly recessed");
for (const x of [20, 107, 148, 235]) for (const y of [20, 107, 148, 235]) {
  assert.ok(coverMaps[0].image.data[(y * 256 + x) * 4] < 170, "recessed fasteners stay inside the visible cover UV crop");
}
assert.deepEqual(coverMaps.map(map => map.image.width), [256, 256, 256]);
assert.deepEqual(coverMaps.map(map => map.colorSpace), [THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.NoColorSpace]);
coverMaps.forEach(map => map.dispose());

const plate = structuralPanelGeometry();
plate.computeBoundingBox();
assert.deepEqual(plate.boundingBox.min.toArray(), [-.5, -.5, -.5]);
assert.deepEqual(plate.boundingBox.max.toArray(), [.5, .5, .5]);
assert.ok(plate.index.count / 3 <= 108, "macro plates have a fixed small triangle budget");
assert.ok(Math.min(...plate.attributes.color.array) < .4, "frames and inset panels have distinct values");
const pillarPlate = structuralPanelGeometry(.25);
assert.equal(Math.max(...pillarPlate.attributes.uv.array), .25, "pillar service panels use a quarter of the previous repeat cadence");
for (const name of ["position", "normal", "color"]) assert.ok(
  Buffer.from(pillarPlate.attributes[name].array.buffer).equals(Buffer.from(plate.attributes[name].array.buffer)),
  "pillar UV cadence cannot change geometry, normals or frame values");
pillarPlate.dispose();
const route = new THREE.Mesh(structuralRouteGeometry(), new THREE.MeshBasicMaterial());
route.updateMatrixWorld();
const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
assert.equal(ray.intersectObject(route).length, 0, "route lighting leaves the deck material visible through its center");
route.geometry.dispose(); route.material.dispose(); plate.dispose();

const rendererStub = nativeWebGPU => ({
  backend: { isWebGPUBackend: nativeWebGPU }, xr: { enabled: false },
  getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
  getRenderObjectFunction: () => null, getPixelRatio: () => 1, getMRT: () => null,
  getClearColor: target => target.set(0), getClearAlpha: () => 1, getScissorTest: () => false
});
// Inspect the real TSL graph, including the lazy branch's real depth sampler.
for (const alpha of [0, 1]) {
  const previousStack = getCurrentStack(), shaderStack = stack();
  try {
    setCurrentStack(shaderStack);
    const coord = vec2(.5), stored = vec4(.2, .3, .4, alpha);
    const depth = { value: new THREE.DepthTexture(4, 4) }, inverse = uniform(new THREE.Matrix4());
    const sample = recoverInvalidAONormals({ sample(uv) { assert.ok(uv === coord); return stored; } }, depth, inverse);
    const result = sample.sample.shaderNode.jsFunc([coord]);
    const conditions = shaderStack.nodes.filter(node => node.constructor.name === "ConditionalNode");
    assert.equal(conditions.length, 1);
    const condition = conditions[0], operator = condition.condNode.node;
    assert.equal(operator.op, "<");
    assert.equal(operator.bNode.value, .5);
    assert.equal(operator.aNode.components, "w");
    assert.ok(operator.aNode.node.node === stored, "test the stored normal's alpha, not scene opacity");
    assert.equal(result.node.components, "xyz");
    assert.ok(result.node.node === operator.aNode.node, "valid normals keep their exact material RGB");
    assert.equal(condition.elseNode, null);
    const invalidStack = stack(); setCurrentStack(invalidStack);
    condition.ifNode.jsFunc();
    const assign = invalidStack.nodes.find(node => node.isAssignNode);
    assert.ok(assign.targetNode === result);
    assert.ok(assign.sourceNode.node.shaderNode === getNormalFromDepth.shaderNode);
    assert.deepEqual(assign.sourceNode.node.rawInputs, [coord, depth.value, inverse]);
    depth.value.dispose();
  } finally { setCurrentStack(previousStack); }
}
for (const compatibilityMode of [undefined, false, true]) {
  const renderer = rendererStub(true); renderer.backend.compatibilityMode = compatibilityMode;
  renderer.samples = compatibilityMode === true ? 0 : 4;
  const pipeline = new NeonRenderPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(pipeline.aoPass.normalNode === pipeline.scenePass.getTextureNode("normal"), compatibilityMode !== true,
    "only actual compatibility mode installs conditional recovery");
  assert.equal(renderer.samples, compatibilityMode === true ? 0 : 4, "normal recovery cannot change antialiasing");
  assert.equal(pipeline.scenePass.options.samples, undefined, "product leaves sample selection to the renderer");
  pipeline.dispose();
}
for (const nativeWebGPU of [true, false]) for (const quality of ["low", "medium", "high"]) {
  const pipeline = new NeonRenderPipeline(rendererStub(nativeWebGPU), new THREE.Scene(), new THREE.PerspectiveCamera(), { quality });
  assert.equal(Boolean(pipeline.pipeline), quality !== "low" && (!nativeWebGPU || quality === "high"));
  assert.equal(Boolean(pipeline.highLoadPipeline), nativeWebGPU && quality === "medium");
  assert.equal(Boolean(pipeline.aoPass), nativeWebGPU && quality === "high");
  pipeline.setQuality("high");
  if (nativeWebGPU) {
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("normal").blending, THREE.NormalBlending,
      "AO normals must preserve the opaque normal behind non-depth-writing decoration");
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("output").blending, THREE.MaterialBlending,
      "scene color keeps the original per-material blend modes");
    const makeNormal = pipeline.scenePass.getMRT().get("normal").node.shaderNode.jsFunc;
    for (const depthWrite of [true, false]) for (const transparent of [true, false]) for (const opacity of [0, .11, 1]) {
      const normal = makeNormal([], { material: { depthWrite, transparent, opacity } }).node;
      assert.ok(normal.nodes[0] === normalView, "solid surface normal mapping is preserved");
      assert.equal(normal.nodes[1].value, Number(depthWrite), "AO normal coverage follows depth writes, not opacity or color blend mode");
    }
    assert.deepEqual([pipeline.aoPass.resolutionScale, pipeline.aoPass.samples.value, pipeline.aoPass.radius.value,
      pipeline.aoPass.thickness.value, pipeline.aoPass.distanceExponent.value, pipeline.aoPass.distanceFallOff.value],
      [.5, 16, 1.6, 2.2, 1.35, .7], "depth-matched normals do not reduce AO quality");
  }
  const full = pipeline.pipeline;
  pipeline.setQuality("medium");
  const balanced = pipeline.highLoadPipeline;
  for (let i = 0; i < 5; i++) for (const level of ["low", "high", "medium"]) pipeline.setQuality(level);
  assert.ok(pipeline.pipeline === full, "tier toggles reuse the full graph without recompiling it");
  assert.ok(pipeline.highLoadPipeline === balanced, "tier toggles reuse the balanced graph");
  pipeline.dispose(); pipeline.dispose();
  assert.equal(pipeline.pipeline, null);
  assert.equal(pipeline.highLoadPipeline, null);
}

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const frameSource = main.slice(main.indexOf("  frame(time) {"), main.indexOf("  update(dt, realDt = dt) {"));
const firstFrameEvents = [];
const frameMethod = new Function("performance", `return ({${frameSource}}).frame`)({
  mark: name => firstFrameEvents.push(name), measure: name => firstFrameEvents.push(name)
});
const firstFrameState = {
  state: "play", paused: true, hideMatchLoadingAfterFrame: true,
  commitResize() {}, timer: { update() {}, getDelta: () => 1 / 60 },
  input: { tapped: () => false, endFrame() {} }, renderScene: () => false,
  setMatchLoading: value => firstFrameEvents.push(value)
};
frameMethod.call(firstFrameState, 100);
assert.equal(firstFrameState.hideMatchLoadingAfterFrame, true, "a skipped frame cannot dismiss the loader");
assert.equal(firstFrameEvents.length, 0);
firstFrameState.renderScene = () => true;
frameMethod.call(firstFrameState, 116);
assert.deepEqual(firstFrameEvents, ["blaster-arena-first-frame", "blaster-arena-first-render", false]);
frameMethod.call(firstFrameState, 133);
assert.equal(firstFrameEvents.length, 3, "first-render completion is emitted only once per match");
const resize = main.slice(main.indexOf("  commitResize() {"), main.indexOf("  applyGraphicsSettings() {"));
const commitResize = new Function(`return ({${resize}}).commitResize`)();
const submitted = [], renderer = { setDrawingBufferSize: (...args) => submitted.push(args) };
const resizeState = { renderer, pendingResize: { width: 1280, height: 720, pixelRatio: 1.65 } };
commitResize.call(resizeState);
resizeState.pendingResize = { width: 1280, height: 720, pixelRatio: 1.65 };
commitResize.call(resizeState);
assert.equal(submitted.length, 1, "same-size events never recreate framebuffer attachments");
resizeState.pendingResize = { width: 390, height: 844, pixelRatio: 1.3 };
commitResize.call(resizeState);
assert.deepEqual(submitted[1], [390, 844, 1.3]);
const qualityEvents = [];
Object.assign(resizeState, {
  pendingGraphics: true, graphics: graphicsProfile("low"),
  renderer: { ...renderer, getMaxAnisotropy: () => 8 },
  renderPipeline: { setQuality: level => qualityEvents.push(level) },
  world: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  combatVisuals: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  keyLight: { shadow: { mapSize: new THREE.Vector2(4096, 4096), map: { dispose: () => qualityEvents.push("dispose-shadow") } } }
});
commitResize.call(resizeState);
assert.deepEqual(qualityEvents, ["low", "low", "low", "dispose-shadow"]);
assert.equal(resizeState.keyLight.shadow.map, null);
commitResize.call(resizeState);
assert.equal(qualityEvents.length, 4, "graphics resources change only once at the frame boundary");

for (const [level, shadowMapSize, anisotropy] of [["low", 1024, 4], ["medium", 2048, 8], ["high", 4096, 16]]) {
  const profile = graphicsProfile(level, false, 3);
  assert.equal(profile.shadowMapSize, shadowMapSize);
  assert.equal(profile.anisotropy, anisotropy);
  assert.deepEqual(graphicsProfile(level, true, 3), profile, "touch input never silently lowers the selected tier");
  const effects = new CombatVisuals(new THREE.Scene(), { quality: profile.combatQuality });
  effects.setGraphicsProfile(profile);
  assert.equal(effects.rings.length, 128, "all tiers retain enough core impacts for the 112-hit maximum-player volley");
  assert.equal(effects.tracers.length, 128);
  assert.equal(effects.flashes.length, 64);
  const gameplayRandom = Math.random;
  let gameplayRandomCalls = 0;
  Math.random = () => { gameplayRandomCalls++; return .5; };
  try {
    for (const weapon of Object.values(WEAPONS)) {
      effects.impact(new THREE.Vector3(), weapon, { color: 0x129dba, accent: 0x6ff6ff }, { explosive: Boolean(weapon.radius) });
    }
    effects.burst(new THREE.Vector3(), 0x6ff6ff, 16);
    effects.blood(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  } finally { Math.random = gameplayRandom; }
  assert.equal(gameplayRandomCalls, 0, "visual density never consumes gameplay randomness");
  effects.dispose();
}
const scene = new THREE.Scene();
const createOnlineSource = main.slice(main.indexOf("  createOnlineFighter(data, position) {"), main.indexOf("  async startMatch("));
const createOnlineFighter = new Function("Fighter", `return ({${createOnlineSource}}).createOnlineFighter`)(Fighter);
const restoredWeapon = createOnlineFighter.call({ scene, controlsNetworkPlayer: () => true }, {
  id: "cache-online", name: "QA", color: 0x129dba, accent: 0x6ff6ff,
  loadout: ["blaster", "rocket_launcher"], slotIndex: 1, health: 37, ammo: { rocket_launcher: 1 }
}, new THREE.Vector3());
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "authoritative nonzero initial slot restores the corresponding model");
assert.equal(restoredWeapon.health, 37); assert.equal(restoredWeapon.ammo.rocket_launcher, 1);
const reconnectSource = main.slice(main.indexOf("  handleNetworkReconnect(welcome) {"), main.indexOf("  clearTransientNetworkCombat() {"));
const reconnect = new Function("THREE", "uniquePlayersById", `return ({${reconnectSource}}).handleNetworkReconnect`)(THREE, players => players);
restoredWeapon.switchSlot(0);
restoredWeapon.reloadTimer = .7; restoredWeapon.reloadWeaponId = "blaster";
reconnect.call({
  state: "play", world: {}, multiplayer: { playerId: restoredWeapon.id }, players: [restoredWeapon],
  hideNetworkReconnecting() {}, clearTransientNetworkCombat() {}, syncOnlineRoster() {}, updateCamera() {}
}, { players: [{ id: restoredWeapon.id, slotIndex: 1, health: 37, alive: true, ammo: { rocket_launcher: 1 } }] });
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "in-place reconnect restores the authoritative weapon visual");
assert.deepEqual([restoredWeapon.health, restoredWeapon.ammo.rocket_launcher, restoredWeapon.reloadTimer, restoredWeapon.reloadWeaponId], [37, 1, .7, "blaster"]);
restoredWeapon.dispose();
// Matrices/colors are captured from the full-capacity implementation before
// trimming dead draw tails. Stable slots keep transparent blending order intact.
const effectDigests = [];
const effectGroups = [
  ["flashes", "flashOuter", "flashInner"], ["tracers", "tracerOuter", "tracerInner"],
  ["rings", "ringOuter", "ringInner"], ["sparks", "sparkLayer"], ["bloodDecals", "bloodLayer"]
];
for (const quality of [.5, .75, 1]) {
  const effects = new CombatVisuals(new THREE.Scene(), { quality });
  assertCompatibleAONormals(effects.group);
  const digest = createHash("sha256");
  const start = new THREE.Vector3(1, 2, 3), end = new THREE.Vector3(5, 6, 7), normal = new THREE.Vector3(0, 1, 0);
  const owner = { color: 0x129dba, accent: 0x6ff6ff, aim: normal, muzzlePoint: target => target.copy(start) };
  for (let volley = 0; volley < 3; volley++) for (const weapon of Object.values(WEAPONS)) {
    effects.muzzle(owner, weapon); effects.tracer(start, end, weapon, owner);
    effects.impact(end, weapon, owner, { explosive: Boolean(weapon.radius) }); effects.blood(end, normal);
    for (const dt of [.008, .016, .09, .4]) {
      effects.update(dt);
      for (const [slots, ...names] of effectGroups) {
        const count = effects[slots].findLastIndex(slot => slot.life > 0) + 1;
        for (const name of names) assert.equal(effects[name].count, count, `${name} must retain every live slot through wrap/expiry`);
      }
      for (const [, ...names] of effectGroups) for (const name of names) {
        digest.update(new Uint8Array(effects[name].instanceMatrix.array.buffer));
        digest.update(new Uint8Array(effects[name].instanceColor.array.buffer));
      }
    }
  }
  effectDigests.push(digest.digest("hex"));
  for (const [slots] of effectGroups) {
    const pool = effects[slots];
    pool.forEach(slot => { slot.life = 0; });
    pool[0].life = .05; pool.at(-1).life = .01;
  }
  for (const [dt, bound] of [[.008, "full"], [.008, 1], [.05, 0], [.01, 0]]) {
    effects.update(dt);
    for (const [slots, ...names] of effectGroups) for (const name of names) {
      assert.equal(effects[name].count, bound === "full" ? effects[slots].length : bound, "sparse wrap retains the last slot until it expires, then keeps slot zero");
    }
  }
  effects.dispose();
}
assert.deepEqual(effectDigests, [
  "0210fb48d26f44d6745b45316c6f35b61c952e414de0e9ad78352308ef7279e4",
  "0f54f2d5a66f74c80741732d45bd2164a9ae59df2eb4c67b526163edbe1f5e77",
  "2a4ff06b7d57d1718b4a4ca63c6d3ccd0c8e5703ebe452b7a7fa50bf1fc6deaf"
], "all 47 weapons at all tiers retain byte-identical effect transforms and colours");
const emptyEffects = new CombatVisuals(new THREE.Scene());
for (const [, ...names] of effectGroups) for (const name of names) assert.equal(emptyEffects[name].count, 0, "countdown frames start with empty draw ranges");
emptyEffects.update(1 / 60);
assert.equal(emptyEffects.ringOuter.count, 0, "an empty impact pool must submit no triangles");
emptyEffects.dispose();
scene.environment = new THREE.Texture();
const lightingEnvironment = scene.environment;
const world = new ArenaWorld(scene, "GRAPHICS-QA");
assertCompatibleAONormals(world.group);
const coverLights = world.destructibles.map(obstacle => obstacle.mesh.children.find(child => child.isInstancedMesh));
assert.equal(coverLights.length, 34);
assert.equal(createHash("sha256").update(Buffer.concat(coverLights.map(mesh => Buffer.from(mesh.instanceMatrix.array.buffer)))).digest("hex"),
  "79e8a017067ce8ec1fed7ae87de457878322758c2d9d4c73c0128e90df5d8849", "symbol instances keep their authored positions, rotations and illuminated scale");
for (const light of coverLights) {
  const { position, normal, uv, color } = light.geometry.attributes;
  assert.equal((light.geometry.index?.count ?? position.count) / 3, 20, "closed light housing uses ten planar quads within its existing draw");
  assert.equal(light.count, 4);
  assert.equal(light.material.color.getHex(), 0xffffff, "vertex colors separate neutral housing from colored diffuser");
  assert.equal(light.material.emissiveIntensity, .3, "diffuser brightness is unchanged");
  assert.ok(light.material.emissiveMap === world.coverLightMask, "one shared mask keeps the neutral bezel unlit");
  const face = [];
  for (let i = 0; i < position.count; i++) if (uv.getX(i) > .5) {
    face.push(i);
    assert.ok(Math.abs(position.getZ(i) - .488) < 1e-6);
    assert.ok(Math.abs(normal.getZ(i) - 1) < 1e-6);
    assert.ok(Math.abs(Math.abs(position.getX(i)) - .445) < 1e-6 && Math.abs(Math.abs(position.getY(i)) - .445) < 1e-6, "colored face retains its exact old local bounds");
  }
  assert.equal(face.length, 6, "only the inset front diffuser emits light");
  for (let i = 0; i < position.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(color[axis](i), color[axis](i + 5), "bezel and diffuser colors never interpolate across a triangle");
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "light housing corners are planar without diagonal patches");
  }
}
assert.ok(scene.backgroundNode?.isNode, "arena sky has a continuous horizon-to-zenith background");
assert.equal(scene.fog.density, .0044, "sky treatment cannot hide content with extra fog");
assert.ok(scene.environment === lightingEnvironment, "background must not replace the scene lighting environment");
for (const segment of world.structures.flatMap(structure => structure.segments)) {
  const rails = segment.instanceVisuals.filter(visual => visual.mesh.name === "Instanced pillar load rails");
  assert.equal(rails.length, 4, "each destructible module retains its four owned load rails");
  for (const rail of rails) for (const [axis, span] of [["x", segment.w], ["z", segment.d]]) {
    const outer = Math.abs(rail.offset[axis]) + rail.scale[axis] / 2;
    assert.ok(outer > span / 2 + .005, "pillar rails must be visible beyond the opaque body, not buried inside it");
    assert.ok(outer <= span / 2 + .07, "decorative rail clearance remains under seven centimetres; collision envelope is unchanged");
  }
}
const centralDeck = world.platforms.find(platform => platform.x === 0 && platform.z === 0 && platform.top === 15);
assert.equal(centralDeck.mesh.material.color.getHexString(), "162b3b", "walking surfaces keep a neutral slate base");
assert.ok(centralDeck.mesh.material.envMap === scene.environment, "deck reflections share the existing environment texture");
assert.equal(centralDeck.mesh.material.envMapIntensity, .24, "deck reflection tuning actually overrides scene intensity");
assert.ok(world.structuralBatchMeshes.find(mesh => mesh.name === "Instanced destructible platform decks").material.envMap === scene.environment);
for (const texture of world.textures) {
  if (texture === world.coverLightMask) {
    assert.deepEqual(Array.from(texture.image.data), [0, 0, 0, 255, 255, 255, 255, 255]);
    assert.equal(texture.minFilter, THREE.NearestFilter);
    assert.equal(texture.magFilter, THREE.NearestFilter);
    assert.equal(texture.generateMipmaps, false, "constant per-face emission lookup must not average the unlit and lit texels");
    continue;
  }
  assert.ok(texture.generateMipmaps, "procedural filtered textures must generate their mip chain");
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
}
assert.ok(world.panelTexture.image.width >= 256);
assert.equal(world.panelTexture.colorSpace, THREE.SRGBColorSpace);
assert.equal(world.panelNormal.colorSpace, THREE.NoColorSpace);
assert.equal(world.panelRoughness.colorSpace, THREE.NoColorSpace);
for (const level of ["low", "medium", "high", "low", "high"]) {
  world.setGraphicsProfile(graphicsProfile(level), 8);
  assert.equal(world.panelTexture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8));
  for (const texture of world.coverTextures) assert.equal(texture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8), "cover filtering follows every selected tier and device limit");
  assert.equal(world.structures.length, 20, "tier changes never alter structural/collision content");
}
const gripFighter = new Fighter(scene, { id: "grip-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15.01, 8));
const cacheFighter = new Fighter(scene, { id: "cache-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff },
  ["blaster", "minigun", "punch_glove", "fireball", "plasma_cannon"], new THREE.Vector3());
const cachedChildren = [];
for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  cachedChildren[slot] = [...cacheFighter.weaponGroup.children];
}
cacheFighter.switchSlot(0);
assert.ok(cacheFighter.weaponGroup.children[0] === cachedChildren[0][0], "returning to a selected weapon must reuse its existing visual resources");
const cachedResources = new Map();
const recordResource = resource => {
  if (!resource || resource.userData?.sharedFighterGeometry || cachedResources.has(resource)) return;
  cachedResources.set(resource, 0);
  resource.addEventListener("dispose", () => cachedResources.set(resource, cachedResources.get(resource) + 1));
};
for (const root of [cacheFighter.group, ...[...cacheFighter.weaponModels.values()].map(model => model.group)]) root.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
for (let cycle = 0; cycle < 3; cycle++) for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  assert.ok(cacheFighter.weaponGroup.children.every((child, i) => child === cachedChildren[slot][i]));
  assert.equal(cacheFighter.weaponModelId, cacheFighter.loadout[slot]);
  const activeObjects = new Set();
  cacheFighter.group.traverse(object => activeObjects.add(object));
  for (const [id, model] of cacheFighter.weaponModels) if (id !== cacheFighter.weaponModelId) {
    model.group.traverse(object => assert.ok(!activeObjects.has(object), "inactive cached weapons cannot be cloned into decoys"));
  }
}
assert.ok([...cachedResources.values()].every(count => count === 0), "switching never disposes a retained resource");
cacheFighter.loadout[0] = "rocket_launcher";
cacheFighter.switchSlot(0);
assert.equal(cacheFighter.weaponModelId, "rocket_launcher");
assert.equal(cacheFighter.weaponModels.has("blaster"), false, "removed loadout models are evicted");
cacheFighter.weaponGroup.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
cacheFighter.dispose();
assert.ok([...cachedResources.values()].every(count => count === 1), "all original active, inactive and evicted owned resources dispose exactly once");
assert.equal(cacheFighter.weaponModels.size, 0);
for (const id of Object.keys(WEAPONS)) {
  const alternate = id === "blaster" ? "machine_gun" : "blaster";
  const fighter = new Fighter(scene, { id: "cache-parity", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [id, alternate], new THREE.Vector3());
  const model = fighter.weaponModels.get(id), originalChildren = [...fighter.weaponGroup.children];
  const geometryHash = () => {
    const hash = createHash("sha256");
    fighter.weaponGroup.traverse(object => {
      for (const attribute of Object.values(object.geometry?.attributes || {})) hash.update(new Uint8Array(attribute.array.buffer));
    });
    return hash.digest("hex");
  };
  const before = geometryHash();
  fighter.weaponGlowMaterial.emissiveIntensity = 3;
  fighter.weaponSpinner?.rotateZ(.7);
  if (fighter.weaponPiston) fighter.weaponPiston.position.z += .3;
  fighter.switchSlot(1); fighter.switchSlot(0);
  assert.ok(fighter.weaponGroup.children.every((child, i) => child === originalChildren[i]));
  assert.equal(geometryHash(), before, `${id}: cached geometry is byte-identical`);
  assert.deepEqual(fighter.weaponGrip.toArray(), model.grip.toArray());
  assert.deepEqual(fighter.weaponSupportGrip.toArray(), model.supportGrip.toArray());
  assert.equal(fighter.weaponMuzzleDistance, model.state.weaponMuzzleDistance);
  assert.equal(fighter.weaponGlowMaterial.emissiveIntensity, .25);
  if (fighter.weaponSpinner) assert.deepEqual(fighter.weaponSpinner.quaternion.toArray(), model.spinnerRotation.toArray());
  if (fighter.weaponPiston) assert.deepEqual(fighter.weaponPiston.position.toArray(), model.pistonPosition.toArray());
  fighter.health = 37; fighter.ammo[id] = 1; fighter.reloadTimer = .7; fighter.reloadWeaponId = id;
  fighter.updateWeaponModel();
  assert.deepEqual([fighter.health, fighter.ammo[id], fighter.reloadTimer, fighter.reloadWeaponId], [37, 1, .7, id], "visual refresh cannot reset authoritative or weapon state");
  fighter.dispose();
}
const stealingId = "weapon_stealing_projectile";
const stealingFighters = [[stealingId, "blaster", "minigun"], ["blaster", stealingId, "fireball"]].map((loadout, i) =>
  new Fighter(scene, { id: `cache-steal-${i}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, loadout, new THREE.Vector3()));
for (const fighter of stealingFighters) for (let slot = 0; slot < 3; slot++) fighter.switchSlot(slot);
swapStolenWeapon(...stealingFighters, stealingId, 0, 0);
for (const fighter of stealingFighters) {
  for (let slot = 0; slot < 3; slot++) { fighter.slotIndex = slot; fighter.updateWeaponModel(); assert.equal(fighter.weaponModelId, fighter.loadout[slot]); }
  fighter.dispose();
}
for (let frame = 0; frame < 60; frame++) gripFighter.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, world);
gripFighter.group.updateMatrixWorld(true);
const handCenter = new THREE.Vector3(0, -.58, .05).applyMatrix4(gripFighter.rightForearm.matrixWorld);
const gripCenter = new THREE.Vector3(.05, -.2, .11).applyMatrix4(gripFighter.weaponGroup.matrixWorld);
assert.ok(handCenter.distanceTo(gripCenter) < .03, `aiming hand must meet its grip, gap=${handCenter.distanceTo(gripCenter).toFixed(3)}m`);
gripFighter.dispose();
const poseWorld = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
const noMovement = new THREE.Vector3(), poseLook = new THREE.Vector3();
const posedHand = new THREE.Vector3(), posedGrip = new THREE.Vector3();
const wristAxis = new THREE.Vector3(), wristNormal = new THREE.Vector3(), barrelNormal = new THREE.Vector3();
for (const weaponId of ["blaster", "rocket_launcher", "machine_gun"]) for (const release of ["reload", "grapple"]) {
  const fighter = new Fighter(scene, { id: "transition-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  for (let frame = 0; frame < 60; frame++) {
    fighter.reloadTimer = release === "reload" ? 1 : 0;
    fighter.grapple = release === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
  }
  fighter.group.updateMatrixWorld(true);
  const rigInverse = fighter.rig.matrixWorld.clone().invert();
  const previousPalm = new THREE.Vector3(0, -.58, .05).applyMatrix4(fighter.leftForearm.matrixWorld).applyMatrix4(rigInverse);
  const localPalm = new THREE.Vector3();
  fighter.reloadTimer = 0; fighter.grapple = null;
  for (let frame = 0; frame < 24; frame++) {
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
    fighter.group.updateMatrixWorld(true);
    posedHand.set(0, -.58, .05).applyMatrix4(fighter.leftForearm.matrixWorld);
    // Isolate joint return from the existing grapple-release body roll/movement.
    rigInverse.copy(fighter.rig.matrixWorld).invert();
    localPalm.copy(posedHand).applyMatrix4(rigInverse);
    const jump = localPalm.distanceTo(previousPalm);
    assert.ok(jump < .2, `${weaponId}/${release}/${frame}: support-hand jump ${jump.toFixed(3)}m`);
    previousPalm.copy(localPalm);
  }
  posedGrip.copy(fighter.weaponSupportGrip).applyMatrix4(fighter.weaponGroup.matrixWorld);
  assert.ok(posedHand.distanceTo(posedGrip) < .03, "support hand returns exactly to the grip after its release transition");
  fighter.dispose();
}
for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: "pose-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  for (const pitch of [-.9, 0, .9]) for (const pose of ["aim", "fire", "reload", "grapple"]) {
    poseLook.set(0, Math.sin(pitch), -Math.cos(pitch));
    fighter.grapple = pose === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    for (let frame = 0; frame < 24; frame++) {
      fighter.reloadTimer = pose === "reload" ? 1 : 0;
      fighter.recoilVisual = pose === "fire" ? .9 : 0;
      fighter.attackTimer = pose === "fire" ? weapon.cooldown * .75 : 0;
      fighter.update(1 / 60, noMovement, poseLook, {}, poseWorld);
    }
    fighter.group.updateMatrixWorld(true);
    const hands = [[fighter.rightArm, fighter.rightForearm, fighter.weaponGrip]];
    if (fighter.weaponHasSupportGrip && pose !== "reload" && pose !== "grapple") hands.push([fighter.leftArm, fighter.leftForearm, fighter.weaponSupportGrip]);
    for (const [upper, forearm, grip] of hands) {
      posedHand.set(0, -.58, .05).applyMatrix4(forearm.matrixWorld);
      posedGrip.copy(grip).applyMatrix4(fighter.weaponGroup.matrixWorld);
      const gap = posedHand.distanceTo(posedGrip);
      assert.ok(gap < .04, `${weapon.id}/${pitch}/${pose}: grip gap ${gap.toFixed(3)}m`);
      assert.deepEqual(forearm.position.toArray(), [0, -.55, 0], "joint solve never stretches a limb");
      assert.ok(Math.abs(upper.quaternion.length() - 1) < .000001);
      assert.ok(Math.abs(forearm.quaternion.length() - 1) < .000001);
      wristAxis.set(0, -.58, .05).transformDirection(forearm.matrixWorld);
      wristNormal.set(0, 0, 1).transformDirection(forearm.matrixWorld).projectOnPlane(wristAxis).normalize();
      barrelNormal.set(0, 0, 1).transformDirection(fighter.weaponGroup.matrixWorld).projectOnPlane(wristAxis).normalize();
      assert.ok(wristNormal.dot(barrelNormal) > .998, `${weapon.id}/${pitch}/${pose}: wrist follows the weapon instead of twisting across its grip`);
    }
  }
  fighter.dispose();
}
for (const variant of [0, 1, 2, 3]) for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: `graphics-qa-${variant}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  assertCompatibleAONormals(fighter.group);
  assert.equal(fighter.visor.name, "Segmented inset visor");
  assert.equal(fighter.helmet.name, "Helmet and recessed visor housing");
  assert.ok(fighter.helmet.material === fighter.darkMaterial, "housing uses the existing dark batch material");
  fighter.visor.geometry.computeBoundingBox();
  assert.ok(fighter.visor.geometry.boundingBox.max.x < .33);
  assert.ok(fighter.visor.geometry.boundingBox.max.y < .05, "lens is smaller than its surrounding frame");
  assert.ok(fighter.visor.geometry.boundingBox.max.z + fighter.visor.position.z < .5, "lens sits behind housing front");
  assert.ok(fighter.accentMaterial.emissiveIntensity < 1, "idle armor keeps chroma and highlight detail");
  assert.ok(fighter.weaponGlowMaterial.emissiveIntensity < 1, "idle weapon casing is not a clipped light source");
  fighter.group.traverse(object => {
    if (!object.geometry) return;
    assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite), `${weapon.id}: finite authored geometry`);
  });
  fighter.dispose();
}
const outsideSprite = new THREE.Sprite();
for (const batch of world.destructibleBatches) {
  assert.ok(batch.material.map === world.coverTextures[0] && batch.material.normalMap === world.coverTextures[1] && batch.material.roughnessMap === world.coverTextures[2], "cover batches share one dedicated matched surface atlas");
  assert.ok(batch.material.map !== world.panelTexture, "cover tuning cannot alter pillar and deck textures");
  batch.geometry.computeBoundingBox();
  assert.deepEqual(batch.geometry.boundingBox.min.toArray(), [-.5, -.5, -.5]);
  assert.deepEqual(batch.geometry.boundingBox.max.toArray(), [.5, .5, .5]);
  assert.equal(batch.geometry.attributes.position.count / 3, 60, "cover uses four planar mitered rim sections and one panel per face");
  assert.ok(Math.abs(Math.max(...batch.geometry.attributes.uv.array) - .23625) < 1e-6, "infill retains its .25 UV cadence inside the 5.5% frame");
  assert.equal(batch.material.vertexColors, true, "cover perimeter retains its machined dark frame");
  const colors = batch.geometry.attributes.color;
  for (let i = 0; i < colors.count; i += 3) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(colors[axis](i), colors[axis](i + 1));
    assert.equal(colors[axis](i), colors[axis](i + 2), "each face triangle has a crisp frame/infill boundary");
  }
  const uv = batch.geometry.attributes.uv, normal = batch.geometry.attributes.normal;
  for (let i = 0; i < colors.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "each mitered frame quad is planar, without triangular corner patches");
  }
  for (let i = 0; i < colors.count; i += 3) {
    const area = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i));
    assert.ok(Math.abs(area) > 1e-10, "frame sampling keeps a valid tangent basis");
    for (const axis of ["getX", "getY", "getZ"]) {
      assert.equal(normal[axis](i), normal[axis](i + 1));
      assert.equal(normal[axis](i), normal[axis](i + 2), "split frame faces have geometric bevel normals");
    }
  }
}
scene.add(outsideSprite);
let sharedSpriteDisposals = 0;
const onSharedSpriteDispose = () => sharedSpriteDisposals++;
outsideSprite.geometry.addEventListener("dispose", onSharedSpriteDispose);
for (const arena of [world, new ArenaWorld(scene, "RESET-2"), new ArenaWorld(scene, "RESET-3")]) {
  let spriteMaterialsDisposed = 0, ownedGeometryDisposed = 0;
  const coverDisposals = new Map([...arena.coverTextures, arena.coverLightMask].map(texture => [texture, 0]));
  for (const texture of coverDisposals.keys()) texture.addEventListener("dispose", () => coverDisposals.set(texture, coverDisposals.get(texture) + 1));
  arena.group.traverse(object => {
    if (object.isSprite) object.material.addEventListener("dispose", () => spriteMaterialsDisposed++);
    else if (object.geometry) object.geometry.addEventListener("dispose", () => ownedGeometryDisposed++);
  });
  arena.dispose();
  assert.ok([...coverDisposals.values()].every(count => count === 1), "shared cover textures dispose exactly once per arena");
  assert.ok(scene.backgroundNode === arena.previousBackgroundNode, "teardown restores the previous sky expression without disposing Three's owned sky mesh");
  assert.equal(sharedSpriteDisposals, 0, "arena teardown must not destroy Three's shared Sprite quad used by the next arena");
  assert.ok(spriteMaterialsDisposed > 0, "owned sprite materials are still released");
  assert.ok(ownedGeometryDisposed > 0, "owned arena geometry is still released");
  assert.ok(!scene.children.includes(arena.group));
}
outsideSprite.geometry.removeEventListener("dispose", onSharedSpriteDispose);
scene.remove(outsideSprite); outsideSprite.material.dispose();
console.log("Graphics profiles, mip chains, texture color spaces, unchanged structures and all 47 authored weapons passed.");
