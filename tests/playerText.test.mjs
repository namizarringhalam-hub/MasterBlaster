import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PLAYER_TEXT } from "../PLAYER_TEXT.js";
import { WEAPON_GROUPS, WEAPONS } from "../src/gameData.js";

const [indexSource, mainSource, bootSource, gameDataSource, stylesSource, viteSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/boot.js", import.meta.url), "utf8"),
  readFile(new URL("../src/gameData.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../vite.config.js", import.meta.url), "utf8")
]);

for (const section of ["site", "landing", "boot", "loading", "setup", "settings", "credits", "errors", "hud", "pause", "results", "defaults", "maps", "weaponGroups", "weapons"]) {
  assert.ok(PLAYER_TEXT[section], `PLAYER_TEXT.js includes the ${section} section`);
}

assert.equal(Object.keys(PLAYER_TEXT.weapons).length, 47, "all 47 weapon names and descriptions live in PLAYER_TEXT.js");
assert.deepEqual(Object.keys(PLAYER_TEXT.weapons).sort(), Object.keys(WEAPONS).sort(), "editable weapon copy matches the complete live weapon library");
for (const [id, weapon] of Object.entries(WEAPONS)) {
  assert.equal(weapon.name, PLAYER_TEXT.weapons[id].name, `${id} reads its name from PLAYER_TEXT.js`);
  assert.equal(weapon.description, PLAYER_TEXT.weapons[id].description, `${id} reads its description from PLAYER_TEXT.js`);
}
for (const group of WEAPON_GROUPS) assert.equal(group.name, PLAYER_TEXT.weaponGroups[group.id], `${group.id} category reads its name from PLAYER_TEXT.js`);

assert.match(indexSource, /\{\{site\.title\}\}[\s\S]*?\{\{landing\.kicker\}\}[\s\S]*?\{\{landing\.headlineLine1\}\}[\s\S]*?\{\{loading\.title\}\}/, "the server-rendered shell contains editable text tokens instead of a second copy");
assert.match(viteSource, /PLAYER_TEXT[\s\S]*?transformIndexHtml[\s\S]*?manifest/, "HTML metadata, the landing shell, and the install manifest are generated from PLAYER_TEXT.js");
assert.match(mainSource, /import TEXT, \{ formatText \} from "\.\/playerText\.js"/, "interactive menus and HUD use the editable text source");
assert.match(bootSource, /import TEXT from "\.\/playerText\.js"/, "boot messages use the editable text source");
assert.match(gameDataSource, /import TEXT, \{ formatText \} from "\.\/playerText\.js"/, "maps, defaults, categories, and weapons use the editable text source");
assert.doesNotMatch(stylesSource, /content:\s*["'][^"']*[A-Za-z][^"']*["']/, "CSS cannot hide player-facing copy outside PLAYER_TEXT.js");

console.log("Master Blaster editable player text check passed.");
