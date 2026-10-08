import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSettings, saveSettings } from "../src/gameData.js";
import { GRAPHICS_EFFECTS, normalizeGraphicsEffects, graphicsEffectUnavailable } from "../src/graphicsEffects.js";
import { GRAPHICS_PRESETS, GRAPHICS_OPTIONS, applyGraphicsPreset, isCustomGraphics } from "../src/graphicsPresets.js";
import TEXT from "../src/playerText.js";

// Exercise the actual menu handlers without creating a renderer or AudioContext.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const previousStorage = globalThis.localStorage, storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };

function fixture() {
  const settings = loadSettings(), nodes = new Map(), calls = [];
  const ui = { innerHTML: "", querySelector: selector => nodes.get(selector) ?? null, querySelectorAll: () => [] };
  const document = { documentElement: { classList: { toggle(name, enabled) { calls.push(["class", name, enabled]); } } } };
  const bindings = { TEXT, ui, document, saveSettings, GRAPHICS_EFFECTS, normalizeGraphicsEffects, graphicsEffectUnavailable, GRAPHICS_PRESETS, GRAPHICS_OPTIONS, applyGraphicsPreset, isCustomGraphics };
  const Game = new Function(...Object.keys(bindings), `return ${controller}`)(...Object.values(bindings));
  const game = Object.assign(Object.create(Game.prototype), {
    settings, state: "menu", paused: true, renderer: { samples: 0 },
    renderPipeline: { nativeWebGPU: true,
      setReducedMotion(value) { calls.push(["reducedMotion", value]); },
      setMotionBlur(value) { calls.push(["motionBlur", value]); }
    },
    setJourney() {}, pulseMenuEnergy() {}, menuAccent: () => "#52e9ff",
    renderMain() { calls.push(["back"]); ui.innerHTML = "<main>Menu</main>"; },
    applyGraphicsSettings() { calls.push(["graphics"]); },
    showModal(html, options) { game.modal = { html, options }; },
    sound: {
      resume() {}, startMusic() {}, play() {}, accentMenuAction() {},
      setVolume(value) { calls.push(["volume", value]); },
      setMix(value) { calls.push(["mix", value]); },
      setDynamicRange(value) { calls.push(["dynamicRange", value]); }
    }
  });
  for (const key of ["graphics", "blood", "shake", "volume", "musicVolume", "effectsVolume", "ambienceVolume", "dynamicRange", "reducedMotion", "motionBlur"]) {
    const output = { textContent: "", replaceChildren(value) { this.textContent = value; } };
    const label = { querySelector: selector => selector === "output" ? output : null };
    const node = { dataset: { setting: key }, value: String(settings[key]), checked: settings[key] === true,
      output, previousElementSibling: output, hasAttribute: () => false,
      closest: selector => selector === "label" ? label : selector === ".settings-grid" ? ui : null,
      querySelector: () => ({ hidden: true }) };
    nodes.set(`[data-setting="${key}"]`, node);
  }
  const input = (key, value) => {
    const target = nodes.get(`[data-setting="${key}"]`); target.value = String(value);
    ui.oninput({ target }); return target;
  };
  const change = (key, value) => {
    const target = nodes.get(`[data-setting="${key}"]`); target.value = String(value);
    if (typeof settings[key] === "boolean") target.checked = value;
    ui.onchange({ target });
  };
  const click = dataset => {
    const button = { dataset, hasAttribute: () => false };
    ui.onclick({ target: { closest: () => button } });
  };
  game.renderSettings();
  return { game, ui, nodes, calls, input, change, click };
}

function renderedValue(html, key) {
  const input = html.match(new RegExp(`<input\\b[^>]*data-setting="${key}"[^>]*>`))?.[0];
  if (input) return /type="checkbox"/.test(input) ? String(/\bchecked\b/.test(input)) : input.match(/value="([^"]*)"/)?.[1];
  const select = html.match(new RegExp(`<select\\b[^>]*data-setting="${key}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1];
  return select?.match(/<option\b[^>]*value="([^"]*)"[^>]*\bselected\b/)?.[1];
}

try {
  const { game, ui, nodes, calls, input, change, click } = fixture();
  const expected = { volume: 23, musicVolume: 34, effectsVolume: 45, ambienceVolume: 56, shake: 17 };
  for (const [key, value] of Object.entries(expected)) {
    calls.length = 0;
    const control = input(key, value);
    assert.equal(game.settings[key], value, `${key} changes before blur or change`);
    assert.equal(loadSettings()[key], value, `${key} saves on input alone`);
    assert.equal(control.output.textContent, `${value}%`, `${key} updates its visible value immediately`);
    if (key === "volume") assert.deepEqual(calls, [["volume", value]], "master gain applies during slider input");
    else if (key.endsWith("Volume")) assert.deepEqual(calls, [["mix", { music: game.settings.musicVolume, effects: game.settings.effectsVolume, ambience: game.settings.ambienceVolume }]], "bus gains apply during slider input");
    else assert.deepEqual(calls, [], "camera shake does not change the audio mix");
  }
  change("blood", "off");
  assert.equal(game.settings.blood, "off");
  assert.equal(loadSettings().blood, "off", "blood selection saves without a confirmation action");
  for (const dynamicRange of ["night", "wide", "standard"]) {
    calls.length = 0; change("dynamicRange", dynamicRange);
    assert.equal(loadSettings().dynamicRange, dynamicRange, "dynamic range selection persists immediately");
    assert.deepEqual(calls, [["dynamicRange", dynamicRange]], "dynamic range applies to the current mix immediately");
  }
  change("dynamicRange", "night");
  Object.assign(expected, { blood: "off", dynamicRange: "night" });

  const retainedScreen = ui.innerHTML;
  calls.length = 0;
  const blurControl = input("motionBlur", 79);
  assert.equal(loadSettings().motionBlur, 79, "motion blur intensity saves on input before change or blur");
  assert.equal(blurControl.output.textContent, "79%");
  assert.equal(game.pendingGraphicsEffects, true, "motion changes queue live application at the next frame boundary");
  game.commitResize();
  assert.deepEqual(calls, [["reducedMotion", false], ["motionBlur", 79], ["class", "reduce-motion", false]], "the next frame applies intensity through the shared live graphics path");
  for (const enabled of [true, false, true]) {
    calls.length = 0; change("reducedMotion", enabled);
    assert.equal(loadSettings().reducedMotion, enabled, "Reduce motion saves immediately on change");
    game.commitResize();
    assert.deepEqual(calls, [["reducedMotion", enabled], ["motionBlur", 79], ["class", "reduce-motion", enabled]], "the next frame updates the renderer and reduced-motion UI class without Save");
    assert.equal(nodes.get('[data-setting="motionBlur"]').disabled, enabled, "Reduce motion controls blur availability without losing its saved intensity");
    assert.equal(game.pendingGraphicsEffects, false, "the frame consumes the pending preference change");
  }
  assert.equal(ui.innerHTML, retainedScreen, "live motion changes keep the current Settings screen open");
  Object.assign(expected, { motionBlur: 79, reducedMotion: true });

  assert.equal(Object.getPrototypeOf(game).saveSettingsForm, undefined, "the obsolete confirmation method is removed");
  assert.doesNotMatch(ui.innerHTML, /data-action="save-settings"/, "there is no Save button");
  assert.doesNotThrow(() => click({ action: "save-settings" }), "a stale Save action has no removed-method dispatch");
  click({ screen: "main" });
  assert.ok(calls.some(([action]) => action === "back"), "Back still returns to the menu");
  game.renderSettings();
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(game.settings[key], value, `${key} survives returning to Settings`);
    assert.equal(renderedValue(ui.innerHTML, key), String(value), `${key} reopens with its saved value in the rendered form`);
  }

  const reloaded = fixture();
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(reloaded.game.settings[key], value, `${key} survives a fresh controller reload`);
    assert.equal(renderedValue(reloaded.ui.innerHTML, key), String(value), `${key} restores its rendered form value after reload`);
  }
  const html = reloaded.ui.innerHTML;
  assert.equal((html.match(/data-action="reset-graphics-effects"/g) ?? []).length, 1, "full Settings has one reset action");
  const soundStart = html.indexOf(`<summary>${TEXT.settings.groups.sound}</summary>`);
  const soundEnd = html.indexOf("</details>", soundStart);
  assert.ok(soundStart >= 0 && html.indexOf('data-action="reset-graphics-effects"') > soundEnd, "reset follows the complete Sound & volume cluster");
  reloaded.click({ action: "reset-graphics-effects" });
  for (const [key, value] of Object.entries(expected)) if (key !== "motionBlur") assert.equal(loadSettings()[key], value, "restoring graphics defaults preserves sound, combat and reduced-motion preferences");
  reloaded.game.showGraphicsSettings();
  assert.equal((reloaded.game.modal.html.match(/data-action="reset-graphics-effects"/g) ?? []).length, 1, "paused Graphics retains its own reset action");
  assert.equal(reloaded.game.modal.options.kind, "graphics");
  assert.doesNotMatch(reloaded.game.modal.html, /data-action="save-settings"/);
} finally {
  globalThis.localStorage = previousStorage;
}

console.log("Live settings input/change application, Back/reload persistence, reset placement and obsolete Save removal passed.");
