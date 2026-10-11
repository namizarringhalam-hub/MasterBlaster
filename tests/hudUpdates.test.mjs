import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { WEAPONS, topScoreIndices, weaponUsesAmmo } from "../src/gameData.js";
import TEXT, { formatText } from "../src/playerText.js";

// Exercise the real controller and its text/style guards without a renderer.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function setText("), source.indexOf("const PLAYER_COLORS"));
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle")).replaceAll("import.meta.url", '"test"');
const bindings = {
  WEAPONS, topScoreIndices, weaponUsesAmmo, TEXT, formatText, clamp: THREE.MathUtils.clamp,
  WEAPON_CATEGORY_SLUG_BY_ID: Object.fromEntries(Object.values(WEAPONS).map(weapon => [weapon.id, weapon.category.toLowerCase().replaceAll(" ", "-")])),
  WEAPON_CSS_COLOR_BY_ID: Object.fromEntries(Object.values(WEAPONS).map(weapon => [weapon.id, `#${weapon.color.toString(16).padStart(6, "0")}`]))
};
const Game = new Function(...Object.keys(bindings), `${helpers}\nreturn ${controller}`)(...Object.values(bindings));
let hiddenWrites = 0;
function element(hidden = false) {
  const attributes = new Map(), styles = new Map(), classes = new Set();
  return {
    textContent: "", dataset: {},
    get hidden() { return hidden; }, set hidden(value) { hiddenWrites++; hidden = value; },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    style: { getPropertyValue: name => styles.get(name) || "", setProperty: (name, value) => styles.set(name, value) },
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) }
  };
}
const player = {
  name: "Pilot", alive: true, health: 100, grounded: true, slotIndex: 0,
  loadout: Object.keys(WEAPONS).slice(0, 5),
  controlMove: new THREE.Vector3(), velocity: new THREE.Vector3(), ammo: {},
  get weapon() { return WEAPONS[this.loadout[this.slotIndex]]; }
};
for (const weapon of Object.values(WEAPONS)) player.ammo[weapon.id] = weapon.ammo;
const hud = Object.fromEntries([
  "root", "health", "healthValue", "healthMeter", "score", "time", "grapple", "activeWeaponName",
  "activeWeaponAmmo", "scoreboard", "motionVignette", "respawnCause", "respawnCountdown", "respawnAnnouncement"
].map(key => [key, element()]));
for (const key of ["slots", "slotNames", "ammo"]) hud[key] = player.loadout.map(() => element());
for (const key of ["leaderRows", "leaderNames", "leaderScores"]) hud[key] = Array.from({ length: 3 }, () => element());
hud.respawnStatus = element(true); hud.boardScore = [element()]; hud.rankedScores = [NaN];
const game = Object.assign(Object.create(Game.prototype), {
  players: [player], scores: [0], hud, matchTime: 180, projectiles: [], armedCounts: new Map(),
  input: { down: () => false }, settings: {}, graphics: { level: "high" }, respawnTimers: [3]
});
game.updateHud();
hiddenWrites = 0;
for (let frame = 0; frame < 120; frame++) game.updateHud();
assert.equal(hiddenWrites, 0, "steady living HUD does not rewrite hidden attributes every frame");
assert.equal(hud.slots[0].getAttribute("aria-label"), player.weapon.name);

player.loadout[0] = Object.keys(WEAPONS)[5];
game.updateHud();
assert.equal(hud.slotNames[0].textContent, player.weapon.name, "a replacement weapon updates its visible slot name");
assert.equal(hud.slots[0].getAttribute("aria-label"), player.weapon.name, "a stolen/replaced weapon updates its accessible name in the same frame");
assert.equal(hud.activeWeaponName.textContent, player.weapon.name);

player.alive = false; game.localEliminatorName = "Rival";
game.updateHud();
assert.equal(hud.respawnStatus.hidden, false, "death reveals its panel immediately");
assert.equal(hiddenWrites, 1);
const announcement = hud.respawnAnnouncement.textContent;
for (let frame = 0; frame < 120; frame++) game.updateHud();
assert.equal(hiddenWrites, 1, "steady death HUD does not rewrite visibility");
assert.equal(hud.respawnAnnouncement.textContent, announcement);
game.respawnTimers[0] = 2; game.updateHud();
assert.equal(hud.respawnCountdown.textContent, formatText(TEXT.hud.respawningIn, { seconds: 2 }), "countdown continues updating while visible");
player.alive = true; player.health = 73; game.updateHud();
assert.equal(hud.respawnStatus.hidden, true);
assert.equal(hiddenWrites, 2, "respawn hides its panel once");
assert.equal(hud.respawnAnnouncement.textContent, TEXT.hud.controlRestored);
assert.equal(hud.healthMeter.getAttribute("aria-valuenow"), "73");
console.log("HUD updates: stable visibility, immediate death/respawn and synchronized replacement-weapon labels passed.");
