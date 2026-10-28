import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { GRAPHICS_EFFECTS } from "../src/graphicsEffects.js";
import { GRAPHICS_OPTIONS, GRAPHICS_VERSION } from "../src/graphicsPresets.js";
import { MARKETING_GRAPHICS, MARKETING_GRAPHICS_SHA256, applyMarketingGraphics,
  marketingGraphicsEvidence, requireMarketingGraphics } from "./marketingGraphics.js";

assert.equal(createHash("sha256").update(JSON.stringify(MARKETING_GRAPHICS)).digest("hex"), MARKETING_GRAPHICS_SHA256);
assert.equal(MARKETING_GRAPHICS.graphicsVersion, GRAPHICS_VERSION, "review the saved capture profile after a settings migration");
assert.deepEqual(Object.keys(MARKETING_GRAPHICS.graphicsEffects).sort(), Object.keys(GRAPHICS_EFFECTS).sort());
for (const [key, value] of Object.entries(MARKETING_GRAPHICS.graphicsOptions))
  assert.ok(GRAPHICS_OPTIONS[key].includes(value), `saved option ${key} remains supported`);

const preferences = { displayName: "Brand", volume: 17, loadout: ["railgun"],
  graphics: "low", graphicsOptions: { renderScale: .25 }, graphicsEffects: { bloom: false } };
const settings = applyMarketingGraphics(preferences);
assert.equal(settings, preferences);
assert.equal(settings.volume, 17);
assert.deepEqual(settings.loadout, ["railgun"]);
assert.equal(settings.displayName, "Brand");
const game = { settings, renderer: { backend: { compatibilityMode: false } }, renderPipeline: {
  quality: "ultra", options: { ...MARKETING_GRAPHICS.graphicsOptions }, effects: { ...MARKETING_GRAPHICS.graphicsEffects },
  reducedMotion: false, motionBlurStrength: 35, nativeWebGPU: true, direct: false,
  ...Object.fromEntries(["temporal", "aoPass", "reflectionPass", "bloomPass", "contactShadows",
    "localFog", "particleDepth", "heatDistortion", "motionBlur"].map(key => [key, {}]))
} };
assert.equal(requireMarketingGraphics(game).matches, true);
settings.graphicsOptions.renderScale = .75;
assert.equal(MARKETING_GRAPHICS.graphicsOptions.renderScale, 1, "applying the snapshot does not share mutable option objects");
assert.throws(() => requireMarketingGraphics(game), /Marketing capture requires/);
applyMarketingGraphics(settings);
for (const [key, badValue] of [["nativeWebGPU", false], ["direct", true], ["temporal", null],
  ["reducedMotion", true], ["motionBlurStrength", 0]]) {
  const saved = game.renderPipeline[key]; game.renderPipeline[key] = badValue;
  assert.equal(marketingGraphicsEvidence(game).matches, false, `reject effective mismatch ${key}`);
  game.renderPipeline[key] = saved;
}
game.renderer.backend.compatibilityMode = true;
assert.throws(() => requireMarketingGraphics(game), /Marketing capture requires/);
game.renderer.backend.compatibilityMode = false;
game.renderPipeline.options.aoSamples = 16;
assert.throws(() => requireMarketingGraphics(game), /Marketing capture requires/);

const harness = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
const initialize = harness.indexOf("if (marketingCapture) saveSettings(applyMarketingGraphics(loadSettings()))");
assert.ok(initialize >= 0 && initialize < harness.indexOf('await import("../src/main.js")'), "capture settings precede renderer construction");
const reset = harness.slice(harness.indexOf("async function reset()"), harness.indexOf('select("view").onchange = setView'));
assert.ok(reset.indexOf("restoreMarketingGraphics();") >= 0
  && reset.indexOf("restoreMarketingGraphics();") < reset.indexOf("game.applyGraphicsSettings();"), "resets preserve the exact marketing profile");
assert.match(harness, /marketingCapture.*=== "1".*socialVideo.*=== "1"/);
assert.match(harness, /marketingGraphics: marketingCapture \? marketingGraphicsEvidence\(game\) : null/);
console.log("Marketing snapshot, unrelated preferences, effective-pipeline rejection and pre-render/reset capture wiring passed.");
