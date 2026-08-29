import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three/webgpu";
import { chooseBotSlot, botFireChance, botWeaponPolicy, clampBotCount, nearestTarget, safestSpawn } from "../src/botBrain.js";
import { CombatVisuals, createProjectileVisual } from "../src/combatVisuals.js";
import { activePresetLoadout, clampMatchMinutes, DEFAULT_LOADOUT, excessOwnedProjectiles, graphicsProfile, LOADOUT_PRESET_COUNT, LOADOUT_SLOTS, loadSettings, projectileLifetime, projectileStepCount, randomLoadout, saveSettings, seededRandom, seedFromText, structuralPartBounds, swapStolenWeapon, topScoreIndices, weaponFireMode, weaponUsesAmmo, WEAPON_GROUPS, WEAPONS } from "../src/gameData.js";
import { InputManager, TOUCH_LOOK_GAIN, clearTouchActions, deliberateTouchTap, shouldCaptureGameKey, touchLookDelta, touchMoveDelta, updateOrbit } from "../src/input.js";
import { aimWithSpread, applyGrapplePhysics, applyWeaponStatus, boostGrappleRelease, cameraCollisionFirstPerson, cameraRelative, damageIndicatorAngle, directionFromKeys, directionFromTouch, Fighter, flameConeFactor, GRAPPLE_SPEED_CAP, grappleSightline, PROJECTILE_SPAWN_OFFSET, projectileTouchesPlayer, reticleAim } from "../src/player.js";
import { NeonRenderPipeline } from "../src/renderPipeline.js";
import { ArenaWorld } from "../src/world.js";
import { weaponPresentation } from "../src/weaponPresentation.js";

const [mainSource, bootSource, renderPipelineSource, worldSource, serviceWorkerSource, stylesSource, indexSource, multiplayerWorkerSource] = await Promise.all([
  readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  readFile(new URL("../src/boot.js", import.meta.url), "utf8"),
  readFile(new URL("../src/renderPipeline.js", import.meta.url), "utf8"),
  readFile(new URL("../src/world.js", import.meta.url), "utf8"),
  readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../multiplayer/worker.js", import.meta.url), "utf8")
]);
assert.doesNotMatch(mainSource, /serviceWorker\.register/, "the renderer does not own service-worker startup");
assert.match(bootSource, /serviceWorker\.register\("\/sw\.js"/, "the lightweight shell starts immutable caching without waiting for the engine");
assert.deepEqual(topScoreIndices([2, 7, 7, 4, 9]), [4, 1, 2], "the HUD ranks the top three scores with stable tie ordering");
assert.match(mainSource, /\[0, 1, 2\]\.map[\s\S]*data-leader-row/, "the top-right HUD renders three leaderboard rows");
assert.match(mainSource, /dialog-lead[^]*?<button class="launch primary" data-action="start">\$\{TEXT\.setup\.start\}<\/button>[^]*?<div class="setup-form">/, "every setup sheet puts one editable start action above its controls");
assert.doesNotMatch(mainSource, /FIND MATCH|CREATE ROOM|START TRAINING/, "setup actions no longer change labels by mode");
assert.match(mainSource, /reticleAim\(player, this\.camera\.position, this\.camera\.getWorldDirection/, "weapons fire through the visible camera's exact center ray");
assert.match(mainSource, /remembered = this\.settings\.matchSettings\[mode\][\s\S]*?botCount = remembered\.botCount[\s\S]*?botDifficulty = remembered\.botDifficulty/, "each setup mode restores its own saved bot settings");
assert.doesNotMatch(mainSource, /EffectComposer|UnrealBloomPass|composer\.render/, "the game avoids unstable post-processing framebuffers");
assert.match(mainSource, /new THREE\.WebGPURenderer/, "the game uses Three.js's WebGPU renderer");
assert.match(mainSource, /await this\.renderer\.init\(\)/, "WebGPU initializes before environment generation");
assert.match(mainSource, /this\.renderPipeline\.render\(\)/, "the game renders through the node-based HDR pipeline");
assert.match(renderPipelineSource, /RenderPipeline[\s\S]*?bloom\([\s\S]*?ao\(/, "the HDR pipeline combines bloom with ambient grounding");
assert.match(renderPipelineSource, /this\.direct = coarsePointer[\s\S]*?if \(!nativeWebGPU\)[\s\S]*?bloom\([\s\S]*?renderer\.render\(this\.scene, this\.camera\)/, "desktop WebGL2 keeps lightweight bloom while coarse devices retain a framebuffer-safe direct path");
assert.match(renderPipelineSource, /catch \(error\)[\s\S]*?degradeToDirect\(error\)/, "post-processing failures degrade to direct rendering");
const recoveryRenderer = {
  backend: { isWebGPUBackend: false }, toneMapping: "ACES", toneMappingExposure: 1.02, outputColorSpace: "sRGB", xr: { enabled: false }, target: null, cubeFace: 0, mipLevel: 0,
  mrt: null, renderObjectFunction: null, pixelRatio: 1.5, clearColor: new THREE.Color(0x07111d), clearAlpha: 1, autoClear: true, scissorTest: false,
  transparent: true, opaque: true, contextNode: "baseline-context", directFrames: 0,
  getRenderTarget() { return this.target; }, getActiveCubeFace() { return this.cubeFace; }, getActiveMipmapLevel() { return this.mipLevel; },
  getRenderObjectFunction() { return this.renderObjectFunction; }, getPixelRatio() { return this.pixelRatio; }, getMRT() { return this.mrt; },
  getClearColor(target) { return target.copy(this.clearColor); }, getClearAlpha() { return this.clearAlpha; }, getScissorTest() { return this.scissorTest; },
  setRenderTarget(target, cubeFace = 0, mipLevel = 0) { this.target = target; this.cubeFace = cubeFace; this.mipLevel = mipLevel; },
  setRenderObjectFunction(value) { this.renderObjectFunction = value; }, setPixelRatio(value) { this.pixelRatio = value; }, setMRT(value) { this.mrt = value; },
  setClearColor(value, alpha) { this.clearColor.set(value); this.clearAlpha = alpha; }, setScissorTest(value) { this.scissorTest = value; },
  render() {
    assert.equal(this.target, null, "direct recovery renders to the visible canvas");
    assert.equal(this.mrt, null, "direct recovery cannot inherit the failed pass MRT");
    assert.equal(this.renderObjectFunction, null, "direct recovery uses the normal scene draw function");
    assert.equal(this.autoClear, true, "direct recovery clears the visible framebuffer");
    assert.equal(this.scissorTest, false, "direct recovery is not trapped in a post-effect scissor rectangle");
    assert.equal(this.transparent, true); assert.equal(this.opaque, true); assert.equal(this.contextNode, "baseline-context");
    this.directFrames++;
  }
};
const recoveryScene = { name: "Arena", overrideMaterial: null };
const recoveryCamera = { layers: { mask: 7 } };
const recoveryPipeline = new NeonRenderPipeline(recoveryRenderer, recoveryScene, recoveryCamera, { coarsePointer: true });
recoveryPipeline.direct = false;
const disposedRenderResources = [];
recoveryPipeline.pipeline = {
  render() {
    recoveryRenderer.setRenderTarget("stale-offscreen-target", 3, 2); recoveryRenderer.setMRT("stale-mrt"); recoveryRenderer.setRenderObjectFunction(() => {});
    recoveryRenderer.setClearColor(0x000000, 0); recoveryRenderer.autoClear = false; recoveryRenderer.setScissorTest(true);
    recoveryRenderer.transparent = false; recoveryRenderer.opaque = false; recoveryRenderer.contextNode = "stale-context";
    recoveryScene.name = "Broken pass"; recoveryScene.overrideMaterial = "stale-material"; recoveryCamera.layers.mask = 0;
    recoveryRenderer.toneMapping = "corrupt"; recoveryRenderer.outputColorSpace = "corrupt"; recoveryRenderer.xr.enabled = true;
    throw new Error("simulated rematch pass failure");
  },
  dispose() { disposedRenderResources.push("pipeline"); }
};
for (const name of ["scenePass", "highLoadScenePass", "bloomPass", "highLoadBloom", "aoPass"]) recoveryPipeline[name] = { dispose() { disposedRenderResources.push(name); } };
const originalWarn = console.warn;
console.warn = () => {};
try { recoveryPipeline.render(); } finally { console.warn = originalWarn; }
assert.equal(recoveryRenderer.directFrames, 1, "a failed rematch pass immediately produces a visible direct frame");
assert.equal(recoveryRenderer.toneMapping, "ACES");
assert.equal(recoveryRenderer.outputColorSpace, "sRGB");
assert.equal(recoveryRenderer.xr.enabled, false);
assert.equal(recoveryScene.name, "Arena");
assert.equal(recoveryScene.overrideMaterial, null);
assert.equal(recoveryCamera.layers.mask, 7);
assert.deepEqual(disposedRenderResources.sort(), ["aoPass", "bloomPass", "highLoadBloom", "highLoadScenePass", "pipeline", "scenePass"].sort(), "fallback releases every post-processing render target");
recoveryPipeline.dispose();
assert.equal(disposedRenderResources.length, 6, "repeated match cleanup is idempotent and cannot leak old GPU targets");
assert.match(mainSource, /dataset\.action === "rematch"\) return this\.queueRematch\(\)/, "the results button uses the clean renderer rematch path");
assert.match(mainSource, /queueRematch\(\)\s*\{\s*this\.queueMatchStart\(true\)/, "rematches preserve the same-seed label while using the shared clean launch path");
assert.match(mainSource, /startMatch\(\)\s*\{\s*if \(!this\.freshSessionReady\) return this\.queueMatchStart\(false\)/, "every direct game launch is forced through a fresh page and graphics device");
assert.match(mainSource, /queueMatchStart\(sameSeed = false\)[\s\S]*?sessionStorage\.setItem\(MATCH_SESSION_KEY[\s\S]*?location\.reload\(\)/, "all match types preserve their setup and restart with a fresh graphics device");
assert.match(mainSource, /resumePendingMatch\(\)[\s\S]*?sessionStorage\.removeItem\(MATCH_SESSION_KEY\)[\s\S]*?freshSessionReady = true;[\s\S]*?this\.startMatch\(\)/, "the reload consumes the match ticket exactly once and enters the guarded initializer");
assert.match(indexSource, /id="match-loading"[\s\S]*?sessionStorage\.getItem\("blaster-pending-match"\)[\s\S]*?type="module"/, "the match loader appears before the new renderer module starts");
assert.match(indexSource, /data-boot-mode="quick"[\s\S]*?\/src\/boot\.js/, "the functional menu shell is present before the deferred Three.js engine downloads");
assert.match(indexSource, /\{\{landing\.kicker\}\}[\s\S]*?\{\{landing\.headlineLine1\}\}[\s\S]*?\{\{landing\.lead\}\}[\s\S]*?\{\{landing\.highlights\}\}/, "the lightweight landing shell is generated from the editable player-text source");
assert.match(mainSource, /TEXT\.landing\.kicker[\s\S]*?TEXT\.landing\.headlineLine1[\s\S]*?TEXT\.landing\.features/, "the interactive landing page uses the same editable player-text source after the engine loads");
assert.match(indexSource, /\{\{loading\.kicker\}\}[\s\S]*?\{\{loading\.title\}\}[\s\S]*?\{\{loading\.description\}\}[\s\S]*?\{\{loading\.freshArena\}\}/, "match loading copy comes from the editable player-text source");
assert.match(indexSource, /master-blaster-settings[\s\S]*?dataset\.menuQuality[\s\S]*?reducedMotion/, "the lightweight shell applies saved graphics and motion preferences before the engine downloads");
assert.match(indexSource, /menu-atmosphere[\s\S]*?arena-grid[\s\S]*?arena-towers[\s\S]*?arena-rings[\s\S]*?grapple-arc[\s\S]*?arena-streaks/, "the lightweight shell paints the complete arena-energy atmosphere before the engine downloads");
assert.match(indexSource, /preload" as="image" href="\/menu-arena-v2\.webp"[\s\S]*?battle-drum\.wav\?bank=orchestra-2[\s\S]*?cello-trem\.wav\?bank=orchestra-2[\s\S]*?horn-sustain\.wav\?bank=orchestra-2/, "the arena plate and core menu orchestra begin loading with the shell");
assert.match(mainSource, /data-menu-quality="\$\{this\.settings\.graphics\}"/, "menu animation density follows the saved graphics quality");
assert.match(mainSource, /pulseMenuEnergy[\s\S]*?setMusicIntensity/, "menu visuals and adaptive orchestral intensity share one bounded action signal");
assert.match(mainSource, /accentMenuAction\(menuLevel[\s\S]*?dataset\.action === "start"/, "real menu clicks trigger an immediate recorded musical accent, including Start before navigation");
assert.match(mainSource, /pulseMenuEnergy\(\.48, MENU_ACCENTS\[mode\], 2300\)/, "setup navigation preserves menu energy for at least one complete orchestral bar");
assert.match(stylesSource, /\.menu-atmosphere[\s\S]*?transform[\s\S]*?opacity/, "the menu atmosphere is implemented with compositor-friendly transform and opacity motion");
assert.match(stylesSource, /\.arena-towers[\s\S]*?url\("\/menu-arena-v2\.webp"\)[\s\S]*?arena-camera-drift[\s\S]*?infinite alternate/, "the menu uses a cinematic arena plate with reversible parallax instead of chart-like procedural columns");
assert.match(stylesSource, /\.menu-shell \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?max-height: none;[\s\S]*?\.menu-shell::before \{[\s\S]*?position: fixed;[\s\S]*?width: min\(1480px, calc\(100% - 48px\)\)/, "the arena fills every viewport while the glass UI frame scales independently above it");
assert.match(stylesSource, /@media \(max-height: 520px\) and \(min-width: 600px\)[\s\S]*?grid-template-columns: minmax\(0, 720px\)[\s\S]*?\.primary-actions \{ grid-template-columns: 1\.25fr 1fr 1fr[\s\S]*?\.secondary-actions button \{ min-height: 44px/, "short landscape screens keep all menu actions visible without falling back to the portrait stack or undersized touch targets");
assert.match(stylesSource, /-webkit-text-size-adjust: 100%; text-size-adjust: 100%[\s\S]*?@media \(max-width: 600px\) and \(max-height: 700px\) and \(orientation: portrait\)[\s\S]*?\.primary-actions button \{ min-height: 58px[\s\S]*?\.capabilities \{ display: none/, "short portrait phones render the core menu at device scale without Safari text inflation or requiring an initial zoom-out");
assert.doesNotMatch(stylesSource, /arena-grid-drift|repeating-linear-gradient\(117deg/, "no translating grid or repeating streak texture can expose a visible loop reset");
assert.match(stylesSource, /@keyframes projectile-sweep[\s\S]*?0%, 12% \{ opacity: 0[\s\S]*?82%, 100% \{ opacity: 0/, "projectile sweeps reset only while fully invisible");
assert.match(stylesSource, /@media \(pointer: coarse\)[\s\S]*?\.menu-scene \.grapple-arc[\s\S]*?arena-ring-mobile[\s\S]*?filter: none/, "every coarse-pointer quality tier keeps motion but removes sustained animated filters");
assert.match(stylesSource, /weapon-categories[\s\S]*?scroll-snap-type: x mandatory[\s\S]*?scrollbar-width: none/, "mobile weapon categories use compact touch snapping without a desktop scrollbar");
assert.match(indexSource, /Number\.isFinite\(queuedAt\)[\s\S]*?age >= 0 && age <= 30000[\s\S]*?sessionStorage\.removeItem\("blaster-pending-match"\)/, "only a fresh, valid match can reveal the bootstrap loader");
assert.match(mainSource, /queueMatchStart\(sameSeed = false\)[\s\S]*?setMatchLoading\(true[\s\S]*?requestAnimationFrame\(\(\) => requestAnimationFrame/, "the loading screen receives a paint before every match navigation");
assert.match(mainSource, /startMatch\(\)[\s\S]*?this\.state = "play";[\s\S]*?this\.renderHud\(\);[\s\S]*?this\.sound\.setPaused\(false\);[\s\S]*?this\.hideMatchLoadingAfterFrame = true/, "the loader is armed for dismissal only after the arena and gameplay HUD are ready");
assert.doesNotMatch(mainSource, /this\.startMatch\(\);\s*this\.hideMatchLoadingAfterFrame = true/, "the async match initializer cannot dismiss the loader from an earlier menu frame");
assert.match(mainSource, /frame\(time\)[\s\S]*?this\.renderScene\(\);[\s\S]*?hideMatchLoadingAfterFrame[\s\S]*?setMatchLoading\(false\)/, "the loading screen clears only after the first restored arena frame");
assert.match(mainSource, /const cameraTarget = this\.world\.constrainCamera\(pivot, desired[\s\S]*?this\.camera\.position\.lerp\(cameraTarget[\s\S]*?this\.world\.constrainCamera\(pivot, this\.camera\.position/, "camera collision retracts the existing view boom smoothly without changing the player's aim angle");
assert.doesNotMatch(mainSource, /CAMERA_ALTERNATIVE_ANGLES|candidateDesired|actualDistance < 3\.2/, "camera collision cannot alternate escape sides or teleport across rounded obstacles");
assert.equal(cameraCollisionFirstPerson(2.5, false), true, "a body-width camera gap switches to the unobstructed eye-line view");
assert.equal(cameraCollisionFirstPerson(3, true), true, "camera mode hysteresis prevents flicker beside curved pillars");
assert.equal(cameraCollisionFirstPerson(3.5, true), false, "the normal third-person boom returns when enough clearance is restored");
assert.match(mainSource, /cameraCollisionFirstPerson\(availableDistance[\s\S]*?cameraTarget\.copy\(pivot\)[\s\S]*?actualDistance >= 3\.2/, "a collapsed camera boom follows the player's eye line and keeps the local body hidden throughout the transition");
assert.match(stylesSource, /\.rematch-loading\[hidden\] \{ display: none; \}[\s\S]*?@keyframes rematch-track/, "the loading screen has a deterministic hidden state and animated progress treatment");
assert.match(mainSource, /game\.init\(\)\.then[\s\S]*?sessionStorage\.removeItem\(MATCH_SESSION_KEY\)[\s\S]*?matchLoading\.hidden = true[\s\S]*?TEXT\.errors\.rendererSection/, "renderer startup errors cannot remain trapped behind a persistent match loader");
assert.doesNotMatch(mainSource, /startMatch\(\)\s*\{\s*this\.clearMatch\(\);\s*this\.rebuildRenderPipeline\(\)/, "no rematch can rebuild post-processing on a live graphics device");
assert.match(mainSource, /addEventListener\("pointerdown", this\.resumeAudioGesture, \{ passive: true, capture: true \}\)/, "the first canvas or HUD gesture restores browser-gated rematch audio on every device");
assert.match(mainSource, /resumeAudioAfterReload\(\)[\s\S]*?startAmbience\(this\.world\?\.theme\.id\)[\s\S]*?startMusic\("combat", this\.seed\)[\s\S]*?return true/, "rematch audio restoration includes the full ambience and music mix");
assert.match(renderPipelineSource, /disposePipelineResources\(\)[\s\S]*?scenePass[\s\S]*?highLoadScenePass[\s\S]*?bloomPass[\s\S]*?highLoadBloom[\s\S]*?aoPass/, "rematches release scene, bloom, and ambient-occlusion render targets");
assert.match(mainSource, /sessionStorage\.setItem\("blaster-force-webgl", "1"\)[\s\S]*?location\.reload\(\)/, "WebGPU device loss restarts through the WebGL2 recovery path");
assert.match(mainSource, /renderPipeline\.setReducedMotion\(this\.settings\.reducedMotion\)/, "reduced-motion changes immediately retune the active pipeline");
assert.match(mainSource, /data-setting="graphics"[\s\S]*?"low", "medium", "high"/, "settings expose low, medium, and high graphics quality");
assert.match(mainSource, /renderPipeline\?\.setQuality\(this\.graphics\.level\)/, "graphics changes immediately retune the active render pipeline");
assert.match(renderPipelineSource, /this\.reducedMotion = Boolean\(reducedMotion\)[\s\S]*?highLoadBloom = bloom\(sceneColor, this\.reducedMotion \? \.16 : \.3/, "a newly-created sixteen-player bloom profile inherits Reduced Motion");
assert.match(mainSource, /damageVignetteTimer = setTimeout\([\s\S]*?classList\.remove\("visible"\)[\s\S]*?reducedMotion \? 120 : 520/, "the damage vignette clears explicitly even when CSS animations are disabled");
assert.equal(damageIndicatorAngle(0, new THREE.Vector3(0, 0, 1)), 0, "incoming fire from ahead points to the top of the HUD");
assert.equal(damageIndicatorAngle(0, new THREE.Vector3(1, 0, 0)), 90, "incoming fire from the right points right");
assert.equal(damageIndicatorAngle(Math.PI, new THREE.Vector3(1, 0, 0)), -90, "the incoming-fire indicator remains camera-relative after turning around");
assert.match(mainSource, /data-incoming-direction[\s\S]*?data-target-health[\s\S]*?data-target-fill/, "the combat HUD includes directional damage and enemy-health feedback");
assert.match(mainSource, /attacker === this\.players\[0\][\s\S]*?targetValue[\s\S]*?targetFill[\s\S]*?targetHealth/, "confirmed hits reveal the struck enemy's remaining health");
assert.match(mainSource, /damageIndicatorAngle\(this\.cameraYaw[\s\S]*?incomingDirection/, "damage feedback rotates from the current camera heading toward the attacker");
assert.match(stylesSource, /\.incoming-direction\.visible[\s\S]*?\.target-health\.visible[\s\S]*?@keyframes incoming-direction-pulse/, "combat feedback has distinct readable motion and health-bar treatments");
assert.doesNotMatch(mainSource, /grapple\.line\.geometry\.setFromPoints/, "grapple rope updates reuse fixed GPU buffers");
assert.doesNotMatch(worldSource, /new THREE\.ShaderMaterial/, "the arena has no legacy GLSL-only material");
assert.match(worldSource, /MeshBasicNodeMaterial[\s\S]*?colorNode[\s\S]*?opacityNode/, "the animated route floor uses an MRT-compatible TSL node material");
assert.doesNotMatch(mainSource, /data-touch="(?:up|down|left|right)"/, "mobile movement has no directional-button overlay");
assert.match(mainSource, /active-weapon-readout[\s\S]*?data-active-weapon-name[\s\S]*?data-active-weapon-ammo/, "mobile HUD exposes the selected weapon name and its current magazine state");
assert.match(mainSource, /if \(button\.dataset\.touch\) return;/, "gameplay touch actions cannot leak generic menu confirmation sounds or clicks");
assert.match(mainSource, /touchPointers\?\.clear\(\)/, "blur, visibility, and pause clear pending action-pointer ownership");
assert.match(mainSource, /lostpointercapture", cancel/, "lost touch capture cannot leave fire or another action held indefinitely");
assert.match(stylesSource, /\.weapon-strip \{[\s\S]*?pointer-events: none[\s\S]*?\.weapon-strip button \{[\s\S]*?pointer-events: auto/, "gaps around compact weapon slots remain usable as movement and look surface");
assert.match(stylesSource, /grid-template: "swap hook" 58px "jump fire" 86px \/ 58px 86px;[\s\S]*?gap: 14px 18px/, "mobile action controls isolate the large fire target from swap, hook, and jump");
assert.match(stylesSource, /max-height: 500px[\s\S]*?\.pause \{[^}]*min-width: 44px; min-height: 44px;[\s\S]*?grid-template-columns: repeat\(5, 48px\); gap: 6px;[\s\S]*?\.weapon-strip button \{ min-height: 48px/, "compact-landscape pause and weapon slots retain separated 44px-plus touch targets");
assert.match(stylesSource, /safe-area-inset-right[\s\S]*?safe-area-inset-bottom/, "mobile combat controls respect notches and home-indicator safe areas");
assert.match(indexSource, /viewport-fit=cover/, "the viewport exposes device safe areas to the mobile HUD");
assert.match(mainSource, /document\.addEventListener\("visibilitychange"/, "page visibility resets are attached to the document that dispatches them");
assert.match(mainSource, /if \(this\.paused\) \{[\s\S]*?clearTouchActions\(this\.touch\)/, "pausing clears held and queued touch actions");
assert.match(mainSource, /pointercancel", cancel/, "cancelled action touches cannot replay queued actions");
assert.match(serviceWorkerSource, /pathname\.startsWith\("\/assets\/"\)/, "content-hashed engine assets use the local immutable cache");
assert.match(serviceWorkerSource, /pathname\.startsWith\("\/audio\/"\).*searchParams\.has\("bank"\)/s, "only versioned audio enters the immutable cache");
assert.match(serviceWorkerSource, /cache\.match\(event\.request\)[\s\S]*if \(cached\) return cached/, "repeat sessions read immutable assets without revalidation");
assert.doesNotMatch(serviceWorkerSource, /index\.html|navigate\(/, "HTML and navigation requests stay network-managed so new releases cannot go stale");
assert.match(serviceWorkerSource, /clients\.claim/, "the cache takes control without forcing a disruptive refresh");

const documentedWeaponIds = [
  "arc_lightning", "black_hole_generator", "blaster", "boomerang_blade", "bouncing_bomb", "burst_rifle",
  "chainsaw", "charged_energy_rifle", "cluster_grenade", "decoy_launcher", "disintegration_weapon", "drill_missile",
  "energy_sword", "fireball", "flamethrower", "freeze_gun", "grapple_disrupting_pulse", "gravity_beam", "gravity_grenade", "grenade_launcher",
  "hammer", "implosion_bomb", "knife", "laser_beam", "machine_gun", "mine", "minigun", "mortar",
  "napalm_launcher", "needle_launcher", "plasma_cannon", "plasma_repeater", "pulse_cannon", "punch_glove",
  "railgun", "remote_explosive", "ricochet_cannon", "rocket_launcher", "shock_baton", "shotgun", "spear",
  "sticky_launcher", "submachine_gun", "teleport_projectile", "temporary_wall", "tornado_generator", "weapon_stealing_projectile"
];
assert.equal(Object.keys(WEAPONS).length, 47, "the game exposes the complete documented library, Flamethrower, and Fireball");
assert.equal(LOADOUT_SLOTS.length, 5, "players carry five main weapons");
assert.equal(DEFAULT_LOADOUT.length, 5, "the default loadout is match-ready");
assert.equal(LOADOUT_PRESET_COUNT, 3, "players can save exactly three weapon sets");
const savedSet = ["railgun", "fireball", "shotgun", "freeze_gun", "grapple_disrupting_pulse"];
assert.deepEqual(activePresetLoadout({ defaultLoadoutPreset: 1, loadoutPresets: [null, { weaponIds: savedSet }, null] }), savedSet, "the chosen default preset preserves exact weapon order");
assert.equal(activePresetLoadout({ defaultLoadoutPreset: 0, loadoutPresets: [{ weaponIds: ["railgun"] }] }), null, "incomplete presets cannot override a match loadout");
const releaseStableStorage = new Map([["blaster-battle-settings-v1", JSON.stringify({ displayName: "Veteran", loadout: savedSet })]]);
globalThis.localStorage = {
  getItem: (key) => releaseStableStorage.get(key) ?? null,
  setItem: (key, value) => releaseStableStorage.set(key, value)
};
assert.equal(loadSettings().displayName, "Veteran", "existing device preferences migrate from the retired brand key");
assert.ok(releaseStableStorage.has("master-blaster-settings"), "preferences move to a stable unversioned key that future builds reuse");
let settingsStorage = JSON.stringify({ loadout: savedSet });
globalThis.localStorage = {
  getItem: () => settingsStorage,
  setItem: (_key, value) => { settingsStorage = value; }
};
const legacySettings = loadSettings();
assert.equal(legacySettings.graphics, "high", "existing players migrate to High graphics without changing the current default appearance");
assert.deepEqual(graphicsProfile("high", false, 3), { level: "high", pixelRatio: 1.65, combatQuality: 1 }, "High preserves the current desktop resolution and effect density");
assert.ok(graphicsProfile("medium", false, 3).pixelRatio < 1.65 && graphicsProfile("medium", false, 3).combatQuality < 1, "Medium reduces resolution and effect density");
assert.ok(graphicsProfile("low", false, 3).pixelRatio < graphicsProfile("medium", false, 3).pixelRatio && graphicsProfile("low", false, 3).combatQuality < graphicsProfile("medium", false, 3).combatQuality, "Low applies the lightest render profile");
assert.deepEqual(legacySettings.loadout, savedSet, "legacy loadout-only settings migrate without changing weapon order");
assert.deepEqual(legacySettings.loadoutPresets, [null, null, null], "legacy settings gain three empty preset slots");
legacySettings.loadoutPresets[0] = { name: "Control", weaponIds: [...savedSet] };
legacySettings.defaultLoadoutPreset = 0;
saveSettings(legacySettings);
const persistedPresetSettings = loadSettings();
settingsStorage = JSON.stringify({ loadoutPresets: [{ name: "Broken", weaponIds: ["railgun", "railgun", "missing"] }], defaultLoadoutPreset: 0 });
const repairedPresetSettings = loadSettings();
settingsStorage = JSON.stringify({ matchSettings: {
  quick: { botCount: 15, botDifficulty: "hard", seed: "quick-15", timeLimitMinutes: 12 },
  private: { botCount: 4, botDifficulty: "rookie", seed: "room42", timeLimitMinutes: 8 },
  training: { botCount: 9, botDifficulty: "normal", seed: "practice", timeLimitMinutes: 5 }
} });
const persistedMatchSettings = loadSettings();
delete globalThis.localStorage;
assert.deepEqual(persistedPresetSettings.loadoutPresets[0], { name: "Control", weaponIds: savedSet }, "saved weapon sets survive a settings reload without losing order");
assert.equal(persistedPresetSettings.defaultLoadoutPreset, 0, "the default-set choice survives a settings reload");
assert.deepEqual(repairedPresetSettings.loadoutPresets, [null, null, null], "corrupt and partial presets are discarded safely");
assert.equal(repairedPresetSettings.defaultLoadoutPreset, null, "an invalid preset cannot remain the default");
settingsStorage = JSON.stringify({ matchSettings: { private: { botCount: 1, botDifficulty: "normal", seed: "" } } });
const migratedPrivateSettings = loadSettings();
assert.equal(migratedPrivateSettings.matchSettings.private.botCount, 0, "the former one-bot private default migrates to zero once");
assert.deepEqual(persistedMatchSettings.matchSettings.quick, { botCount: 15, botDifficulty: "veteran", seed: "QUICK-15", timeLimitMinutes: 12 }, "Quick Play remembers its last device-local count, difficulty, seed, and time limit");
assert.deepEqual(persistedMatchSettings.matchSettings.private, { botCount: 4, botDifficulty: "rookie", seed: "ROOM42", timeLimitMinutes: 8 }, "Private Room keeps an independent setup profile including its time limit");
assert.deepEqual(persistedMatchSettings.matchSettings.training, { botCount: 9, botDifficulty: "normal", seed: "PRACTICE", timeLimitMinutes: 5 }, "Training keeps an independent setup profile including its time limit");
assert.equal(clampMatchMinutes(45), 30, "saved time limits cannot exceed the supported thirty-minute match length");
assert.match(mainSource, /id="time-limit" type="number" min="1" max="30"[\s\S]*?timeLimitMinutes: this\.timeLimitMinutes/, "every setup exposes and saves a one-to-thirty-minute match limit");
assert.match(mainSource, /queueMatchStart[\s\S]*?timeLimitMinutes: this\.timeLimitMinutes[\s\S]*?resumePendingMatch[\s\S]*?clampMatchMinutes\(saved\.timeLimitMinutes\)/, "fresh-session loading preserves the selected time limit");
assert.match(mainSource, /client\.connect\([\s\S]*?timeLimitMinutes: this\.timeLimitMinutes[\s\S]*?this\.matchTime = welcome \?[^\n]+: this\.timeLimitMinutes \* 60/, "offline and online matches both start with the selected duration");
assert.match(multiplayerWorkerSource, /timeLimitMinutes = clampMatchMinutes\(input\.timeLimitMinutes\)[\s\S]*?open:\$\{targetSize\}:\$\{difficulty\}:\$\{timeLimitMinutes\}[\s\S]*?endsAt: now \+ 4_000 \+ timeLimitMinutes \* 60_000/, "online matchmaking separates durations and makes the room server authoritative for the chosen limit");
assert.match(mainSource, /closest\?\.\("\.setup-form"\)\) this\.captureSetupPreferences\(\)/, "committed setup changes persist even when the player returns to another menu");
assert.match(mainSource, /event\.target\.id === "display-name"[\s\S]*?saveSettings\(this\.settings\)/, "display-name edits persist locally without requiring a match start");
assert.match(mainSource, /toggleLoadout\(id\)[\s\S]*?this\.settings\.loadout = current;[\s\S]*?saveSettings\(this\.settings\)/, "weapon selection changes persist locally as they are made");
assert.match(mainSource, /closest\?\.\("\.settings-grid"\)\) this\.captureSettingsPreferences\(\)/, "graphics, accessibility, audio, and effects preferences persist when changed");
assert.match(mainSource, /savedDefault = activePresetLoadout\(this\.settings\)[\s\S]*?if \(savedDefault\) this\.settings\.loadout = \[\.\.\.savedDefault\]/, "saved defaults apply to every setup mode");
assert.match(mainSource, /mode === "quick" && !savedDefault\) this\.settings\.loadout = randomLoadout\(\)/, "Quick Play randomizes only when no default preset exists");
assert.match(mainSource, /confirm\(formatText\(TEXT\.setup\.loadout\.replaceConfirm/, "overwriting a saved preset requires editable confirmation copy");
assert.match(mainSource, /confirm\(formatText\(TEXT\.setup\.loadout\.clearConfirm/, "clearing a saved preset requires editable confirmation copy");
assert.match(mainSource, /aria-live="polite"/, "loadout changes are announced to assistive technology");
assert.match(mainSource, /aria-pressed="\$\{isDefault\}"/, "default preset controls expose their active state");
assert.match(stylesSource, /minmax\(160px, 1fr\)[\s\S]*?min-height: 44px/, "mobile reorder controls retain reliable touch dimensions");
const visualOwner = { accent: 0x44eeff };
for (const id of ["machine_gun", "railgun", "rocket_launcher", "grenade_launcher", "plasma_cannon"]) {
  const projectileVisual = createProjectileVisual(WEAPONS[id], visualOwner, WEAPONS[id].projectileRadius || .11);
  assert.ok(projectileVisual.children.length >= 2 && projectileVisual.userData.combatVisual, `${id} has a layered, animated combat visual`);
  assert.ok(projectileVisual.children.every((part) => !part.material?.isShaderMaterial), `${id} uses camera-safe world-space projectile trails`);
}
const quickLoadout = randomLoadout(() => 0);
assert.equal(quickLoadout.length, 5, "Quick Play selects five random weapons");
assert.equal(new Set(quickLoadout).size, 5, "Quick Play never selects the same weapon twice");
assert.ok(quickLoadout.every((id) => WEAPONS[id]), "Quick Play only selects valid weapons");
assert.deepEqual(
  Object.keys(WEAPONS).sort(),
  documentedWeaponIds,
  "weapon IDs match the specification"
);
assert.equal(WEAPON_GROUPS.reduce((total, group) => total + group.ids.length, 0), 47, "every weapon belongs to one menu category");
assert.equal(new Set(WEAPON_GROUPS.flatMap((group) => group.ids)).size, 47, "every weapon belongs to exactly one menu category");
assert.ok(WEAPON_GROUPS.every((group) => group.ids.every((id) => WEAPONS[id])), "weapon categories contain no missing entries");
assert.ok(!WEAPON_GROUPS.some((group) => group.id === "prototype" || group.name === "Prototype"), "legacy Prototype category is removed");
assert.ok(WEAPON_GROUPS.every((group) => group.ids.every((id) => WEAPONS[id].category === group.name)), "menu groups and weapon category metadata agree");
assert.ok(WEAPON_GROUPS.every((group) => /^#[0-9a-f]{6}$/i.test(group.color)), "every weapon category has a stable menu color");
assert.ok(WEAPON_GROUPS.every((group) => group.ids.map((id) => WEAPONS[id].name).every((name, index, names) => !index || names[index - 1].localeCompare(name) <= 0)), "weapons are alphabetized inside every category");
assert.match(mainSource, /weapon-categories[\s\S]*?weaponCategoriesMarkup\(\)[\s\S]*?WEAPON_GROUPS\.map/, "Quick Play, Private Room, and Training share the categorized weapon selector");
assert.match(mainSource, /<small>\$\{weapon\.description\}<\/small><span class="weapon-capacity">\$\{weaponUsesAmmo/, "weapon cards place capacity metadata after their description for bottom alignment");
assert.match(stylesSource, /\.weapon-choice \.weapon-capacity \{ position: absolute; right: 10px; bottom: 9px;[\s\S]*?font-size: 8px;[\s\S]*?text-align: right/, "weapon capacity is a readable bottom-right classification-style label");
assert.match(mainSource, /weaponUsesAmmo\(player\.weapon\) && fireHeld && player\.ammo\[player\.weapon\.id\] <= 0/, "holding fire automatically begins a reload only for weapons with magazines");
assert.match(mainSource, /new MultiplayerClient\(\)[\s\S]*?mode: this\.mode[\s\S]*?roomCode: this\.seed/, "online match modes connect through the multiplayer room client");
assert.ok(Object.values(WEAPONS).every((weapon) => weapon.name && weapon.description && weapon.category), "every weapon has complete menu metadata");
const presentationSignatures = new Set();
const modelScene = new THREE.Scene();
const presentationScene = new THREE.Scene();
const presentationVisuals = new CombatVisuals(presentationScene, { quality: 1 });
const matrixOwner = {
  id: "matrix-owner", accent: 0x44eeff, aim: new THREE.Vector3(0, 0, 1),
  muzzlePoint: (target = new THREE.Vector3()) => target.set(0, 1, 0),
  forwardPoint: (distance = 1) => new THREE.Vector3(0, 1, distance)
};
const expectedImpactFamilies = {
  plasma_repeater: "plasma",
  railgun: "precision",
  charged_energy_rifle: "precision",
  laser_beam: "precision",
  disintegration_weapon: "precision",
  arc_lightning: "arc"
};
for (const [id, weapon] of Object.entries(WEAPONS)) {
  const profile = weaponPresentation(weapon);
  const policy = botWeaponPolicy(weapon);
  const fireMode = weaponFireMode(weapon);
  assert.ok(profile.delivery && profile.payload && profile.tempo, `${id} has a complete projectile, impact, and audio presentation profile`);
  assert.ok(profile.trailLength > 0 && profile.trailWidth > 0 && profile.muzzleLength > 0 && profile.impactScale > 0 && profile.audioDuration > 0, `${id} has tuned presentation dimensions and audio timing`);
  assert.ok(!presentationSignatures.has(profile.signature), `${id} has a weapon-specific presentation signature`);
  presentationSignatures.add(profile.signature);
  assert.ok(Number.isFinite(policy.min) && Number.isFinite(policy.preferred) && Number.isFinite(policy.max), `${id} has finite bot-use ranges`);
  assert.ok(policy.min <= policy.preferred && policy.preferred <= policy.max && policy.intent, `${id} has a coherent bot range and utility policy`);
  assert.ok(["spread", "burst", "mine", "beam", "chain", "flame", "melee", "hitscan", "projectile"].includes(fireMode), `${id} resolves to an implemented firing path`);

  const model = new Fighter(modelScene, { id: `model-${id}`, name: id, color: weapon.color, accent: 0xffffff }, [id], new THREE.Vector3());
  assert.ok(model.weaponGroup.children.length >= 3, `${id} has a layered held-weapon model`);
  assert.ok(model.weaponMuzzleDistance > .3, `${id} exposes a valid muzzle or strike origin`);
  assert.equal(model.group.getObjectByProperty("castShadow", true), undefined, `${id} cannot create blocky per-fighter shadow-map patches`);
  assert.equal(model.group.getObjectByName("Soft contact shadow"), undefined, `${id} has no transparent floor quad that can leak into WebGPU ambient occlusion`);
  assert.equal(model.group.getObjectByProperty("isSprite", true), undefined, `${id} has no camera-facing sprite quad that can leak rectangular normals into WebGPU ambient occlusion`);
  assert.equal(model.group.getObjectByName("Identity beacon")?.geometry?.type, "OctahedronGeometry", `${id} keeps a real 3D identity beacon without a transparent quad`);
  if (id === "boomerang_blade") assert.equal(model.weaponSpinner?.geometry?.type, "TorusGeometry", "the equipped Boomerang reaches its authored spinning-disc bracer branch");
  model.dispose();

  presentationVisuals.muzzle(matrixOwner, weapon, matrixOwner.aim);
  const flash = presentationVisuals.flashes[(presentationVisuals.cursors.flash - 1 + presentationVisuals.flashes.length) % presentationVisuals.flashes.length];
  assert.equal(flash.profile, profile, `${id} drives its muzzle flash from its presentation profile`);
  presentationVisuals.impact(new THREE.Vector3(), weapon, matrixOwner, { explosive: Boolean(weapon.radius) });
  const ring = presentationVisuals.rings[(presentationVisuals.cursors.ring - 1 + presentationVisuals.rings.length) % presentationVisuals.rings.length];
  assert.equal(ring.profile, profile, `${id} drives its impact effect from its presentation profile`);
  if (expectedImpactFamilies[id]) assert.equal(ring.family, expectedImpactFamilies[id], `${id} retains its correct impact family instead of inheriting generic plasma`);
  if (!["beam", "chain", "flame", "melee"].includes(fireMode) && fireMode !== "hitscan") {
    const projectile = createProjectileVisual(weapon, matrixOwner, weapon.projectileRadius || .14, { mine: fireMode === "mine" });
    assert.equal(projectile.userData.combatVisual.profile, profile, `${id} has a profile-driven world projectile`);
    assert.ok(projectile.children.length >= 3, `${id} has a readable layered projectile silhouette`);
  } else if (["beam", "chain", "melee", "hitscan"].includes(fireMode)) {
    presentationVisuals.tracer(new THREE.Vector3(), new THREE.Vector3(0, 1, 12), weapon, matrixOwner);
    const tracer = presentationVisuals.tracers[(presentationVisuals.cursors.tracer - 1 + presentationVisuals.tracers.length) % presentationVisuals.tracers.length];
    assert.equal(tracer.profile, profile, `${id} has a profile-driven tracer or melee sweep`);
  } else {
    presentationVisuals.flameStream(new THREE.Vector3(), matrixOwner.aim, weapon, matrixOwner, weapon.reach);
  }
}
const fireballVisual = createProjectileVisual(WEAPONS.fireball, visualOwner, WEAPONS.fireball.projectileRadius);
assert.ok(fireballVisual.children.filter((child) => child.geometry?.type === "ConeGeometry").length >= 4, "the Fireball projectile has multiple tapered flame tongues and a wake");
assert.equal(fireballVisual.children.filter((child) => child.geometry?.type === "TorusGeometry").length, 0, "the Fireball projectile no longer reads as an orbiting plasma device");
assert.equal(presentationSignatures.size, 47, "all 47 weapons retain distinct audiovisual signatures");
assert.match(mainSource, /data-weapon="\$\{id\}"[\s\S]*?weaponPreviewVariables\(weapon, WEAPON_INDEX_BY_ID\[id\]\)/, "every categorized menu card retains weapon-specific procedural preview variables");
assert.ok(["boomerang_blade", "fireball", "plasma_cannon", "temporary_wall", "decoy_launcher", "black_hole_generator", "tornado_generator"].every((id) => stylesSource.includes(`data-weapon="${id}"`)), "signature and unusual weapons receive authored menu silhouettes beyond their generic type");
assert.ok(presentationVisuals.tracers.length <= 128 && presentationVisuals.sparks.length <= 512 && presentationVisuals.rings.length <= 80, "the complete 47-weapon effects matrix remains fixed and sized for sixteen-player bursts");
const meleeTraceCounts = { hammer: 2, energy_sword: 2, chainsaw: 2, spear: 1, punch_glove: 2, shock_baton: 4, knife: 1 };
for (const [id, expectedSegments] of Object.entries(meleeTraceCounts)) {
  const before = presentationVisuals.cursors.tracer;
  presentationVisuals.tracer(new THREE.Vector3(), new THREE.Vector3(0, 1, WEAPONS[id].reach), WEAPONS[id], matrixOwner);
  assert.equal(presentationVisuals.cursors.tracer - before, expectedSegments, `${id} renders its own ${WEAPONS[id].meleeMotion} strike grammar`);
}
presentationVisuals.dispose();
assert.equal(WEAPONS.cluster_grenade.split, 6, "cluster grenades create secondary bomblets");
assert.equal(WEAPONS.sticky_launcher.sticky, true, "sticky charges adhere to surfaces");
assert.equal(WEAPONS.remote_explosive.type, "remote", "remote explosives use place-and-detonate behavior");
assert.equal(WEAPONS.laser_beam.type, "beam", "laser weapons use instant beams");
assert.equal(WEAPONS.arc_lightning.type, "chain", "arc lightning chains between targets");
assert.equal(WEAPONS.hammer.type, "melee", "the melee library uses direct close-range attacks");
assert.ok(WEAPON_GROUPS.find((group) => group.id === "melee").ids.every((id) => WEAPONS[id].reload === 0 && !weaponUsesAmmo(WEAPONS[id])), "every melee weapon attacks indefinitely without ammunition or reload time");
assert.equal(WEAPONS.temporary_wall.type, "wall", "the wall projectile creates physical cover");
assert.equal(WEAPONS.decoy_launcher.type, "decoy", "decoy rounds deploy bot targets");
assert.equal(WEAPONS.teleport_projectile.effect, "teleport", "teleport projectiles relocate their shooter");
assert.equal(WEAPONS.grapple_disrupting_pulse.grappleDisrupt, true, "disrupting pulses release grapples");
assert.equal(WEAPONS.freeze_gun.effectDuration, 4.5, "Freeze Gun slows for 4.5 seconds after the latest hit");
assert.equal(WEAPONS.shock_baton.effectDuration, 1.5, "Shock Baton keeps its separate short stun duration");
assert.equal(WEAPONS.flamethrower.type, "flame", "the Flamethrower uses its own cone-fire behavior");
assert.equal(WEAPONS.flamethrower.reach, 11.5, "the Flamethrower is deliberately limited to a short cone");
assert.ok(WEAPONS.flamethrower.damage / WEAPONS.flamethrower.cooldown >= 30 && WEAPONS.flamethrower.damage / WEAPONS.flamethrower.cooldown <= 35, "centre-line Flamethrower DPS stays within the balanced 30-35 band");
assert.equal(botFireChance(WEAPONS.flamethrower.reach + .01, true, WEAPONS.flamethrower), 0, "bots never fire the Flamethrower beyond its reach");
assert.equal(chooseBotSlot(["flamethrower", "railgun"], 8, () => 0), 0, "bots prefer the Flamethrower at close range");
assert.ok(WEAPONS.grenade_launcher.projectileSpeed >= GRAPPLE_SPEED_CAP * 1.7, "the Grenade Launcher fires a launcher-grade shell rather than a hand-thrown arc");
assert.ok(WEAPONS.railgun.hitscan && WEAPONS.railgun.projectileSpeed >= 500, "the railgun remains an effectively instant hitscan weapon");
assert.ok(WEAPONS.machine_gun.projectileSpeed > WEAPONS.blaster.projectileSpeed, "rifle-class bullets outrun visible blaster bolts");
const heavyProjectileIds = ["rocket_launcher", "plasma_cannon", "mortar", "napalm_launcher", "pulse_cannon", "black_hole_generator", "drill_missile", "tornado_generator", "grapple_disrupting_pulse"];
assert.ok(heavyProjectileIds.every((id) => WEAPONS[id].projectileSpeed >= GRAPPLE_SPEED_CAP * 1.7), "every heavy shell, rocket, missile, and energy payload decisively outruns a maximum-speed grapple");
assert.ok(WEAPONS.rocket_launcher.projectileSpeed >= GRAPPLE_SPEED_CAP * 2, "the standard rocket crosses the arena at least twice as fast as a grapple swing");
assert.ok(120 / Math.min(...heavyProjectileIds.map((id) => WEAPONS[id].projectileSpeed)) < 120 / GRAPPLE_SPEED_CAP * .6, "even the slowest heavy projectile wins a 120-metre race against a grappling player by a wide margin");
assert.ok(["cluster_grenade", "implosion_bomb", "gravity_grenade"].every((id) => WEAPONS[id].projectileSpeed <= 20) && WEAPONS.bouncing_bomb.projectileSpeed === 25 && WEAPONS.fireball.projectileSpeed === 32, "hand-thrown and bouncing payloads retain readable slow arcs");
assert.ok(WEAPONS.sticky_launcher.projectileSpeed >= GRAPPLE_SPEED_CAP * 1.7 && WEAPONS.remote_explosive.projectileSpeed >= GRAPPLE_SPEED_CAP * 1.7, "launched placement charges decisively outrun a release-boosted grappling player");
const acceleratedProjectileIds = [...heavyProjectileIds, "grenade_launcher", "sticky_launcher", "remote_explosive"];
assert.ok(acceleratedProjectileIds.every((id) => projectileStepCount(WEAPONS[id].projectileSpeed, 1 / 30, WEAPONS[id].projectileRadius || .2) >= 3), "accelerated heavy projectiles retain swept collision at a slow rendered frame rate");
assert.ok(projectileStepCount(WEAPONS.railgun.projectileSpeed, 1 / 60, .11) > 1, "fast shots use swept stepping instead of tunnelling");
assert.ok(Object.values(WEAPONS).every((weapon) => !("range" in weapon)), "weapons have no artificial range limit");
assert.ok(Object.values(WEAPONS).filter((weapon) => !weapon.fuse).every((weapon) => projectileLifetime(weapon) === Infinity), "straight projectiles persist until they hit something");
assert.equal(projectileLifetime(WEAPONS.grenade_launcher), WEAPONS.grenade_launcher.fuse, "grenades keep their physical fuse");
assert.ok(WEAPONS.machine_gun.spread < .03, "machine-gun rounds remain accurate across the arena");
assert.ok(["machine_gun", "submachine_gun", "minigun", "needle_launcher", "burst_rifle", "railgun", "charged_energy_rifle"].every((id) => WEAPONS[id].hitscan), "near-instant rifle, needle, and rail shots use target-swept hit-scan collision");
assert.equal(WEAPONS.burst_rifle.type, "burst", "the Burst Rifle uses the timed burst scheduler instead of shotgun pellets");
assert.equal(WEAPONS.burst_rifle.burstCount, 3, "the Burst Rifle emits exactly three scheduled rounds");
assert.ok(WEAPONS.burst_rifle.burstInterval > 0 && WEAPONS.burst_rifle.burstInterval < WEAPONS.burst_rifle.cooldown / 3, "burst rounds have a readable intra-burst cadence");
assert.ok(WEAPONS.charged_energy_rifle.chargeTime >= 1 && WEAPONS.charged_energy_rifle.minCharge > 0, "the Charged Energy Rifle requires a deliberate hold and release");
assert.equal(WEAPONS.needle_launcher.penetration, 1, "the Needle Launcher can pierce its first fighter and hit a second");
assert.ok(WEAPONS.disintegration_weapon.penetration >= 4 && WEAPONS.disintegration_weapon.terrainRadius > 0, "the Disintegration Weapon cuts through multiple cover pieces");
assert.ok(WEAPONS.tornado_generator.hazardSpeed > 0, "the Tornado Generator creates a moving vortex");
assert.ok(WEAPONS.knife.executeThreshold > WEAPONS.knife.damage, "the Knife has a real low-health execution window");
assert.ok(["minigun", "gravity_beam", "chainsaw"].every((id) => WEAPONS[id].maintained), "maintained weapons opt into sustained handling and audio");
assert.equal(new Set(WEAPON_GROUPS.find((group) => group.id === "melee").ids.map((id) => WEAPONS[id].meleeMotion)).size, 7, "every melee weapon has its own sweep, thrust, strike, or contact grammar");
assert.match(mainSource, /updateBurst\(player, dt\)[\s\S]*?burst\.timer -= dt[\s\S]*?fireBurstRound/, "burst rounds are scheduled across update frames");
assert.match(mainSource, /updateCharge\(player, wantsFire, dt\)[\s\S]*?releaseCharge\(player\)/, "charged shots use an explicit hold and release lifecycle");
assert.match(mainSource, /effectBlocked\(position, targetPoint\)/, "radial blasts and hazards respect solid cover");
assert.match(mainSource, /fireMelee\([\s\S]*?ropeBlocked\(origin, targetPoint\)/, "melee strikes cannot pass through arena geometry");
assert.match(mainSource, /fireChain\([\s\S]*?point\.distanceTo\(from\) <= 14[\s\S]*?ropeBlocked\(from, point\)/, "every Arc Lightning hop performs its own distance and cover check");
const stealAttacker = {
  loadout: ["weapon_stealing_projectile", "blaster", "shotgun", "railgun", "laser_beam"],
  ammo: { weapon_stealing_projectile: 2, railgun: 1 }
};
const stealTarget = {
  loadout: ["railgun", "rocket_launcher", "weapon_stealing_projectile", "mine", "plasma_cannon"],
  ammo: { weapon_stealing_projectile: 4, railgun: 3 }
};
assert.deepEqual(swapStolenWeapon(stealAttacker, stealTarget, "weapon_stealing_projectile", 0, 0), { stolenId: "railgun", attackerSlot: 0, targetSlot: 0 }, "the stealing projectile swaps real active inventory slots");
assert.equal(new Set(stealAttacker.loadout).size, 5, "stealing a weapon already held by the attacker preserves unique slots");
assert.equal(new Set(stealTarget.loadout).size, 5, "giving the target a weapon already in its loadout preserves unique slots");
assert.equal(stealAttacker.ammo.railgun, 3, "the stolen weapon brings the target's exact ammo pool");
assert.equal(stealTarget.ammo.weapon_stealing_projectile, 2, "the exchanged weapon brings the attacker's exact ammo pool");
const remoteOwner = { id: "remote-owner" };
const transferredCharges = Array.from({ length: 8 }, (_, age) => ({ owner: remoteOwner, weapon: WEAPONS.remote_explosive, age }));
assert.deepEqual(excessOwnedProjectiles(transferredCharges, remoteOwner, "remote_explosive", 4).map((shot) => shot.age), [7, 6, 5, 4], "a 4+4 remote-charge ownership transfer selects every oldest excess charge and restores the four-charge cap");
assert.match(mainSource, /hazard\.weapon\.hazard === "tornado"[\s\S]*?addScaledVector\(hazard\.velocity, dt\)[\s\S]*?hazard\.mesh\.position\.copy\(next\)/, "tornado hazards travel after impact rather than remaining a flat stationary ring");
assert.match(mainSource, /updateWeaponLoop\(player\.id, player\.weapon, fireHeld && player\.weapon\.maintained/, "maintained human weapons keep a continuous audiovisual loop while held");
assert.match(mainSource, /updateChargeLoop\(player\.id, weapon, player\.chargeLevel, this\.audioSpatial\(/, "charged shots escalate a continuous spatial wind-up cue with their charge level");
assert.match(mainSource, /if \(!bot\.alive\)[\s\S]*?stopChargeLoop\(bot\.id\)[\s\S]*?if \(!target\)[\s\S]*?stopChargeLoop\(bot\.id\)/, "dead and targetless bots always stop charged-rifle wind-up audio");
assert.match(mainSource, /stolenId === "remote_explosive"[\s\S]*?trimRemoteCharges\(attacker, WEAPONS\[stolenId\], WEAPONS\[stolenId\]\.maxCharges\)/, "stealing Remote Explosives immediately restores the receiver's charge cap");
assert.match(mainSource, /weapon\.type === "remote"[\s\S]*?\$\{armed\} \$\{TEXT\.hud\.armed\}/, "the Remote Explosive HUD displays its live armed-charge count with editable copy");
assert.match(mainSource, /presentationPayload === "mortar"[\s\S]*?RingGeometry\([\s\S]*?shot\.telegraph = telegraph/, "mortar shells show a predicted landing telegraph");
const flameOrigin = new THREE.Vector3();
const flameDirection = new THREE.Vector3(0, 0, 1);
const centreFlame = flameConeFactor(flameOrigin, flameDirection, new THREE.Vector3(0, 0, 5), .72, WEAPONS.flamethrower.reach, WEAPONS.flamethrower.coneAngle);
const edgeFlame = flameConeFactor(flameOrigin, flameDirection, new THREE.Vector3(1.5, 0, 5), .72, WEAPONS.flamethrower.reach, WEAPONS.flamethrower.coneAngle);
assert.equal(centreFlame, 1, "the centre of the flame cone receives full damage");
assert.ok(edgeFlame > 0 && edgeFlame < centreFlame, "the flame cone has readable edge falloff");
assert.equal(flameConeFactor(flameOrigin, flameDirection, new THREE.Vector3(3, 0, 5), .72, WEAPONS.flamethrower.reach, WEAPONS.flamethrower.coneAngle), 0, "targets outside the flame cone take no damage");
assert.equal(flameConeFactor(flameOrigin, flameDirection, new THREE.Vector3(0, 0, 13), .72, WEAPONS.flamethrower.reach, WEAPONS.flamethrower.coneAngle), 0, "targets beyond the flame jet take no damage");
const flameVisualScene = new THREE.Scene();
const flameVisuals = new CombatVisuals(flameVisualScene, { quality: 1 });
flameVisuals.flameStream(flameOrigin, flameDirection, WEAPONS.flamethrower, visualOwner, WEAPONS.flamethrower.reach);
assert.ok(flameVisuals.tracers.filter((slot) => slot.life > 0).length >= 3, "the flame jet uses layered pooled streams");
assert.ok(flameVisuals.sparks.filter((slot) => slot.life > 0).length >= 2, "the flame jet includes pooled rising embers");
assert.ok(flameVisuals.tracers.length <= 128 && flameVisuals.sparks.length <= 512, "Flamethrower effects remain strictly bounded for sixteen-player combat");
flameVisuals.dispose();

const randomA = seededRandom(seedFromText("BLAST-01"));
const randomB = seededRandom(seedFromText("BLAST-01"));
assert.deepEqual([randomA(), randomA(), randomA()], [randomB(), randomB(), randomB()], "map randomness is seed-reproducible");

assert.ok(shouldCaptureGameKey({ code: "KeyE", target: null }, true), "grapple input is captured in play");
assert.ok(shouldCaptureGameKey({ code: "Digit5", target: null }, true), "the fifth weapon slot is reachable");
assert.ok(!shouldCaptureGameKey({ code: "KeyR", ctrlKey: true, target: null }, true), "browser shortcuts are preserved");
assert.deepEqual(updateOrbit(0, 0, 100, -50), { yaw: -.22, pitch: .11 }, "mouse-right turns the third-person camera right without reversing vertical aim");
const verticalPitch = updateOrbit(0, 0, 0, -1000).pitch;
assert.ok(verticalPitch > Math.PI / 2 - .001 && Math.sin(verticalPitch) > .99999999, "the camera can aim functionally straight up without flipping");
assert.equal(updateOrbit(0, 0, 0, 1000).pitch, -verticalPitch, "the camera has the same full vertical range downward");
assert.match(mainSource, /focus\.copy\(this\.camera\.position\)\.addScaledVector\(forward, 28\)/, "the reticle ray stays parallel to the selected pitch instead of converging early on the player");
assert.equal(TOUCH_LOOK_GAIN, 3.5, "right-side touch aiming is substantially faster than mouse aiming");
assert.deepEqual(touchLookDelta(20, 30, 70, 5), { x: 175, y: -87.5 }, "right-side dragging applies fast horizontal and vertical touch look");
assert.deepEqual(touchMoveDelta(20, 30, 24, 34), { x: 0, y: 0 }, "small left-side touch motion stays inside the walking dead zone");
assert.deepEqual(touchMoveDelta(20, 30, 92, 30), { x: 1, y: 0 }, "a full left-side drag reaches full walking input");
const heldTouchActions = { fire: true, fireTap: true, jumpTap: true, grappleTap: true, weaponTap: true };
assert.deepEqual(clearTouchActions(heldTouchActions), { fire: false, fireTap: false, jumpTap: false, grappleTap: false, weaponTap: false }, "blur and pause can clear every held or queued touch action");
const touchButtonBounds = { left: 80, right: 140, top: 80, bottom: 140 };
assert.equal(deliberateTouchTap({ x: 100, y: 100 }, { x: 111, y: 108 }, touchButtonBounds), true, "a deliberate release inside the same action target registers once");
assert.equal(deliberateTouchTap({ x: 100, y: 100 }, { x: 145, y: 110 }, touchButtonBounds), false, "sliding from swap toward fire cannot trigger the accidentally touched action");
assert.equal(deliberateTouchTap({ x: 100, y: 100 }, { x: 130, y: 130 }, touchButtonBounds), false, "a large aim correction over a button is not mistaken for an action tap");
assert.ok(cameraRelative(directionFromTouch({ x: 0, y: -1 }), 0).distanceTo(new THREE.Vector3(0, 0, 1)) < .001, "left-side drag up moves forward with the camera");
assert.ok(cameraRelative(directionFromTouch({ x: 0, y: 1 }), 0).distanceTo(new THREE.Vector3(0, 0, -1)) < .001, "left-side drag down moves backward from the camera");
assert.ok(cameraRelative(directionFromTouch({ x: -1, y: 0 }), 0).distanceTo(new THREE.Vector3(1, 0, 0)) < .001, "left-side drag left follows screen-left relative to the camera");
assert.ok(cameraRelative(directionFromTouch({ x: 1, y: 0 }), 0).distanceTo(new THREE.Vector3(-1, 0, 0)) < .001, "left-side drag right follows screen-right relative to the camera");
assert.ok(cameraRelative(directionFromKeys({ down: (code) => code === "KeyA" }), 0).distanceTo(new THREE.Vector3(1, 0, 0)) < .001, "keyboard A follows screen-left");
assert.ok(cameraRelative(directionFromKeys({ down: (code) => code === "KeyD" }), 0).distanceTo(new THREE.Vector3(-1, 0, 0)) < .001, "keyboard D follows screen-right");

const sightCamera = new THREE.PerspectiveCamera();
const sightTarget = new THREE.Vector3(4, 7, 18);
sightCamera.position.set(-6, 5, -9);
sightCamera.lookAt(sightTarget);
sightCamera.updateMatrixWorld(true);
const sightline = grappleSightline({ isBot: false }, sightCamera);
const sightDistance = sightTarget.clone().sub(sightline.origin).dot(sightline.direction);
assert.ok(sightline.origin.clone().addScaledVector(sightline.direction, sightDistance).distanceTo(sightTarget) < .001, "the grapple follows the exact center-camera reticle ray");

const previousAddEventListener = globalThis.addEventListener;
const previousDocument = globalThis.document;
const windowListeners = {};
const canvasListeners = {};
globalThis.addEventListener = (type, listener) => { windowListeners[type] = listener; };
globalThis.document = { pointerLockElement: null, addEventListener() {} };
const touchInput = new InputManager({
  clientWidth: 200,
  addEventListener(type, listener) { canvasListeners[type] = listener; },
  setPointerCapture() {}
});
canvasListeners.pointerdown({ pointerType: "touch", pointerId: 7, clientX: 160, clientY: 80, preventDefault() {} });
canvasListeners.pointerdown({ pointerType: "touch", pointerId: 8, clientX: 40, clientY: 80, preventDefault() {} });
windowListeners.pointermove({ pointerType: "touch", pointerId: 7, clientX: 190, clientY: 55, preventDefault() {} });
windowListeners.pointermove({ pointerType: "touch", pointerId: 8, clientX: 112, clientY: 80, preventDefault() {} });
assert.deepEqual(touchInput.consumeLook(), { x: 105, y: -87.5 }, "right-side dragging feeds accelerated horizontal and vertical camera look");
assert.deepEqual(touchInput.touchDirection(), { x: 1, y: 0 }, "left-side dragging feeds walking direction while look remains active");
assert.equal(touchInput.mouse.left, false, "touching the gameplay view does not fire the weapon");
windowListeners.pointerup({ pointerType: "touch", pointerId: 7, preventDefault() {} });
assert.equal(touchInput.touchLook, null, "lifting the look finger ends the drag");
assert.deepEqual(touchInput.touchDirection(), { x: 1, y: 0 }, "lifting look does not interrupt the walking finger");
windowListeners.pointerup({ pointerType: "touch", pointerId: 8, preventDefault() {} });
assert.deepEqual(touchInput.touchDirection(), { x: 0, y: 0 }, "lifting the walking finger stops movement");
canvasListeners.pointerdown({ pointerType: "touch", pointerId: 9, clientX: 20, clientY: 80, preventDefault() {} });
canvasListeners.pointerdown({ pointerType: "touch", pointerId: 10, clientX: 70, clientY: 80, preventDefault() {} });
windowListeners.pointermove({ pointerType: "touch", pointerId: 10, clientX: 95, clientY: 40, preventDefault() {} });
assert.equal(touchInput.touchMove.id, 9, "the first left-side finger owns walking");
assert.equal(touchInput.touchLook, null, "an extra left-side finger cannot take ownership of camera look");
assert.deepEqual(touchInput.consumeLook(), { x: 0, y: 0 }, "same-side overflow cannot rotate the camera");
windowListeners.pointercancel({ pointerType: "touch", pointerId: 10 });
assert.equal(touchInput.touchMove.id, 9, "cancelling an ignored finger preserves the active walking finger");
windowListeners.pointercancel({ pointerType: "touch", pointerId: 9 });
assert.deepEqual(touchInput.touchDirection(), { x: 0, y: 0 }, "cancelling the walking finger clears movement");
let lockRequests = 0;
const desktopCanvas = {
  addEventListener(type, listener) { canvasListeners[type] = listener; },
  requestPointerLock() { lockRequests++; }
};
const desktopInput = new InputManager(desktopCanvas);
canvasListeners.pointerdown({ pointerType: "mouse", button: 0, preventDefault() {} });
assert.equal(lockRequests, 1, "the first gameplay click requests mouse capture");
assert.equal(desktopInput.mouse.left, false, "the click used to capture the mouse is consumed instead of firing");
assert.equal(desktopInput.tapped("MouseLeft"), false, "the capture click never queues a projectile shot");
globalThis.document.pointerLockElement = desktopCanvas;
canvasListeners.pointerdown({ pointerType: "mouse", button: 0, preventDefault() {} });
assert.equal(desktopInput.mouse.left, true, "left click fires normally after mouse capture is active");
assert.equal(desktopInput.tapped("MouseLeft"), true, "captured clicks still queue normal weapon input");
if (previousAddEventListener) globalThis.addEventListener = previousAddEventListener;
else delete globalThis.addEventListener;
if (previousDocument) globalThis.document = previousDocument;
else delete globalThis.document;

assert.equal(chooseBotSlot(["shotgun", "railgun"], 5, () => 0), 0, "bot prefers shotgun up close");
assert.equal(chooseBotSlot(["shotgun", "railgun"], 30, () => 0), 1, "bot prefers railgun at range");
assert.ok(botFireChance(10, true, WEAPONS.blaster) > 0, "bot can fire visible projectiles");
assert.ok(botFireChance(100, true, WEAPONS.machine_gun) > 0, "bots do not treat straight weapons as range-limited");
assert.equal(clampBotCount(99), 15, "matches allow at most fifteen bots");
assert.equal(clampBotCount(0, 0), 0, "private rooms may start without bot fillers");
assert.equal(clampBotCount(0), 1, "matches always include at least one bot");
const botStub = { alive: true, position: new THREE.Vector3() };
const nearStub = { alive: true, position: new THREE.Vector3(2, 0, 0) };
const farStub = { alive: true, position: new THREE.Vector3(20, 0, 0) };
assert.equal(nearestTarget(botStub, [botStub, farStub, nearStub]), nearStub, "each bot targets its nearest living opponent");
assert.ok(safestSpawn([new THREE.Vector3(1, 0, 0), new THREE.Vector3(30, 0, 0)], [botStub, nearStub], botStub).x === 30, "respawns maximize distance from all living opponents");

const worldScene = new THREE.Scene();
const worldA = new ArenaWorld(worldScene, "SAME-SEED");
const obstacleLayoutA = worldA.obstacles.map(({ x, z, w, d }) => [x, z, w, d]);
worldA.dispose();
const worldB = new ArenaWorld(new THREE.Scene(), "SAME-SEED");
const obstacleLayoutB = worldB.obstacles.map(({ x, z, w, d }) => [x, z, w, d]);
assert.deepEqual(obstacleLayoutA, obstacleLayoutB, "seeded arenas generate the same collision layout");
assert.equal(worldB.structures.length, 16, "the arena makes six major towers and ten seeded routes structural");
assert.equal(worldB.structures.slice(0, 6).filter((structure) => structure.major).length, 6, "all six outer tower floors and stands use the major destruction model");
assert.deepEqual(worldB.structures.slice(0, 6).map(({ x, z }) => [x, z]), [[42, -22], [-42, 30], [-52, -48], [53, 49], [54, 33], [-53, -27]], "the structural major towers cover every non-central tower floor");
assert.ok(worldB.structures.slice(0, 6).every((structure) => structure.platformChunks.length >= 12 && structure.platformChunks.every((chunk) => chunk.maxHealth === 8) && structure.segments.every((segment) => segment.maxHealth === 8)), "large tower decks use sturdy but one-rocket structural chunks and segmented stands");
assert.ok(worldB.platforms.filter((platform) => !platform.structuralKind && platform.x === 0 && platform.z === 0).some((platform) => platform.top === 15), "the middle lower tower floor remains indestructible");
assert.ok(worldB.platforms.filter((platform) => !platform.structuralKind && platform.x === 0 && platform.z === 0).some((platform) => platform.top === 66), "the middle upper tower floor remains indestructible");
assert.ok(new Set(worldB.structures.map((structure) => structure.platformChunks[0].top)).size >= 4, "structural platforms create varied combat elevations");
assert.ok(WEAPONS.rocket_launcher.structureDamage >= 8, "one canonical rocket destroys any outer deck or stand section");
assert.ok(Object.values(WEAPONS).filter((weapon) => weapon.structureDamage > 0).length >= 35, "most combat weapons can damage tower structures");
assert.equal(WEAPONS.temporary_wall.structureDamage, 0, "pure utility projectiles cannot damage towers");
const firstChunk = worldB.structures[0].platformChunks[0];
const authoritativeChunk = structuralPartBounds("SAME-SEED", firstChunk.structuralId);
assert.deepEqual(
  [authoritativeChunk.x, authoritativeChunk.z, authoritativeChunk.baseY, authoritativeChunk.top, authoritativeChunk.w, authoritativeChunk.d],
  [firstChunk.x, firstChunk.z, firstChunk.baseY, firstChunk.top, firstChunk.w, firstChunk.d],
  "the browser and multiplayer authority share exact deterministic chunk bounds"
);
const seamNeighbor = worldB.structures[0].platformChunks.find((chunk) => chunk.deckRow === firstChunk.deckRow && chunk.deckColumn === firstChunk.deckColumn + 1);
const seamPoint = new THREE.Vector3(firstChunk.x + firstChunk.w / 2, firstChunk.top, firstChunk.z);
assert.equal(worldB.structuralPartAt(seamPoint, .01).structuralId, [firstChunk.structuralId, seamNeighbor.structuralId].sort()[0], "deck seams use a stable part-id tie break on every client");
assert.ok(worldB.structures.every((structure) => structure.segments.length >= 3 && structure.segments.length <= 8), "every destructible pillar is composed of a bounded number of sections");
assert.equal(worldB.debrisMesh.count, 128, "all collapsing structures share one bounded mixed-scale debris instance pool");
assert.equal(worldB.debrisMesh.castShadow, false, "temporary structural scrap cannot multiply shadow rendering cost");
assert.equal(worldB.dustMesh.count, 128, "soft structural smoke shares one bounded instanced volume pool");
assert.equal(worldB.dustMesh.castShadow, false, "temporary collapse dust never adds shadow passes");

const collapseWorld = new ArenaWorld(new THREE.Scene(), "COLLAPSE-QA");
const collapseStructure = collapseWorld.structures.find((structure) => !structure.major);
const originalDeckTop = collapseStructure.platformChunks[0].top;
const failedBase = collapseStructure.segments[0];
const failedBaseCenter = collapseWorld.structuralCenter(failedBase).clone();
collapseWorld.destroy(failedBaseCenter, 5.2, { eventId: "collapse-hit-1", attackerId: "attacker", structuralDamage: WEAPONS.rocket_launcher.structureDamage, structuralRadius: .35 });
assert.equal(collapseWorld.destroy(failedBaseCenter, 5.2, { eventId: "collapse-hit-1", attackerId: "attacker" }), 0, "replayed network terrain events are idempotent");
assert.deepEqual(collapseWorld.drainStructuralEvents().map((event) => event.type), ["warning"], "a lethal structural hit produces a readable warning before movement");
const riderChunk = collapseStructure.platformChunks[0];
const deckRider = {
  id: "rider", alive: true, grounded: true, radius: .55,
  position: new THREE.Vector3(riderChunk.x, originalDeckTop, riderChunk.z),
  velocity: new THREE.Vector3()
};
collapseWorld.update(.53, [deckRider]);
assert.deepEqual(collapseWorld.drainStructuralEvents().map((event) => event.type), ["break"], "the warned pillar section breaks before the deck descends");
collapseWorld.update(.74, [deckRider]);
assert.ok(collapseStructure.platformChunks.every((chunk) => chunk.top === originalDeckTop - failedBase.h), "destroying a pillar section lowers every surviving deck chunk by its exact module height");
assert.equal(deckRider.position.y, riderChunk.top, "grounded riders descend with their supporting deck chunk instead of being abandoned in mid-air");
assert.deepEqual(collapseWorld.drainStructuralEvents().map((event) => event.type), ["land"], "a completed descent emits one landing event");
collapseWorld.update(.04, [deckRider]);
assert.ok(riderChunk.visualOffset.y < 0, "landing mass first compresses every surviving deck chunk into the contact");
collapseWorld.update(.12, [deckRider]);
assert.ok(riderChunk.visualOffset.y > 0, "the compressed deck chunks follow with a smaller damped recoil");

let crushHit = 0;
const directDeckStructure = collapseWorld.structures.find((structure) => structure.major && structure.x === 42 && structure.z === -22);
const directDeck = directDeckStructure.platformChunks[0];
const directDeckNeighbor = directDeckStructure.platformChunks[1];
const directDeckCount = directDeckStructure.platformChunks.length;
const directDeckCenter = collapseWorld.structuralCenter(directDeck).add(new THREE.Vector3(directDeck.w * .22, directDeck.h / 2, directDeck.d * .18));
collapseWorld.destroy(directDeckCenter, 5.2, {
  eventId: `deck-hit-${++crushHit}`, attackerId: "attacker",
  structuralDamage: WEAPONS.rocket_launcher.structureDamage, structuralRadius: .35
});
assert.equal(directDeck.health, 0, "one rocket is lethal to the impacted major deck chunk");
collapseWorld.drainStructuralEvents();
collapseWorld.update(.53, []);
assert.ok(!collapseWorld.structuralParts.includes(directDeck) && collapseWorld.structuralParts.includes(directDeckNeighbor), "the struck chunk immediately becomes a real hole while its neighbor retains collision");
assert.ok(collapseWorld.debrisParticles.filter((particle) => particle.active).filter((particle) => particle.scale.x > 1 && particle.scale.z > 2).length >= 8, "a deck chunk visibly separates into independently simulated local slab pieces");
assert.ok(collapseWorld.dustParticles.some((particle) => particle.active && particle.maxLife >= 5 && particle.maxLife <= 10), "structural fracture emits persistent five-to-ten-second smoke rather than short spark stand-ins");
const protectedDeckFragments = collapseWorld.debrisParticles.filter((particle) => particle.active && particle.majorFragment);
for (let burst = 0; burst < 8; burst++) collapseWorld.spawnStructuralDebris(directDeckCenter, 0xff8050, 22, { w: 5, h: 3, d: 5 }, `chaos-${burst}`);
assert.ok(protectedDeckFragments.every((particle) => particle.active && particle.majorFragment), "simultaneous container destruction cannot overwrite platform fragments that gate a live collapse");
assert.deepEqual(collapseWorld.drainStructuralEvents().map((event) => event.type), ["break"], "the localized fracture emits one break event");
collapseWorld.update(.46, []);
assert.equal(collapseWorld.drainStructuralEvents().filter((event) => event.type === "land").length, 0, "a local deck fracture cannot fake a landing cue while its slabs remain airborne");
let localDeckLanding = null;
for (let frame = 0; frame < 60 && !localDeckLanding; frame++) {
  collapseWorld.update(.1, []);
  localDeckLanding = collapseWorld.drainStructuralEvents().find((event) => event.type === "land") || null;
}
assert.ok(localDeckLanding && localDeckLanding.position.y < directDeckCenter.y - 2, "a local deck fracture emits its contact cue at the debris' real landing height");
assert.equal(directDeckStructure.platformChunks.length, directDeckCount - 1, "direct platform destruction removes only the impacted chunk");
assert.ok(directDeckStructure.anchor, "an edge-chunk fracture keeps a still-supported grapple anchor");
collapseWorld.updateStructuralDebris(2);
const debrisProbe = new THREE.Object3D();
for (const particle of collapseWorld.debrisParticles.filter((entry) => entry.active && (entry.scale.x > 5 || entry.scale.y > 2))) {
  debrisProbe.rotation.set(particle.rotation.x, particle.rotation.y, particle.rotation.z);
  debrisProbe.scale.copy(particle.scale);
  debrisProbe.updateMatrix();
  const matrix = debrisProbe.matrix.elements;
  const halfExtent = .5 * (Math.abs(matrix[1]) + Math.abs(matrix[5]) + Math.abs(matrix[9]));
  const floor = collapseWorld.surfaceHeightAt(particle.position, particle.position.y + .2);
  assert.ok(particle.position.y >= floor + halfExtent - .001, "large deck and stand shards rest above terrain using their rotated box extent");
}

const majorStructure = collapseWorld.structures.find((structure) => structure.major && structure.x === -52 && structure.z === -48);
const majorSpawnBefore = collapseWorld.spawnPoints().find((point) => Math.abs(point.x + 60) < .01 && Math.abs(point.z + 48) < .01);
assert.equal(majorSpawnBefore.y, 15, "the major tower spawn initially resolves onto its deck");
const majorDeck = collapseWorld.structuralPartAt(majorSpawnBefore.clone().add(new THREE.Vector3(0, -.05, 0)), .35);
assert.equal(majorDeck?.structuralKind, "platform", "the spawn probe resolves to one deterministic deck chunk");
collapseWorld.destroy(majorSpawnBefore.clone(), 5.2, {
  eventId: `major-deck-${++crushHit}`, attackerId: "attacker", partId: majorDeck.structuralId,
  structuralDamage: WEAPONS.rocket_launcher.structureDamage, structuralRadius: .35
});
collapseWorld.settleStructuralChanges();
assert.equal(collapseWorld.surfaceHeightAt(new THREE.Vector3(majorDeck.x, majorDeck.top + 2, majorDeck.z), majorDeck.top + 2), 0, "the removed deck chunk leaves a physical hole instead of invisible support");

function simulateStructuralRider(step) {
  const world = new ArenaWorld(new THREE.Scene(), "FRAME-INVARIANCE");
  const structure = world.structures.find((candidate) => !candidate.major);
  const failed = structure.segments[0];
  const platform = structure.platformChunks[0];
  const rider = { id: "rider", alive: true, grounded: true, radius: .55, position: new THREE.Vector3(platform.x, platform.top, platform.z), velocity: new THREE.Vector3() };
  world.destroy(world.structuralCenter(failed).clone(), 5.2, { eventId: `frame-${step}-1`, attackerId: "attacker", structuralDamage: 20, structuralRadius: .35 });
  world.drainStructuralEvents();
  let guard = 0;
  while (world.structuralChanges.length && guard++ < 100) world.update(step, [rider]);
  const result = { riderY: rider.position.y, platformY: platform.top, crushes: world.drainStructuralEvents().filter((event) => event.type === "crush").length };
  world.dispose();
  return result;
}
const fineRider = simulateStructuralRider(.04), coarseRider = simulateStructuralRider(.2);
assert.ok(Math.abs(fineRider.platformY - coarseRider.platformY) < 1e-8 && Math.abs(fineRider.riderY - coarseRider.riderY) < 1e-8, "rider carry and exact final collision are invariant across fine and coarse frame steps");
assert.equal(fineRider.crushes + coarseRider.crushes, 0, "legitimate deck riders never become false crush kills at either frame rate");

const seamRiderWorld = new ArenaWorld(new THREE.Scene(), "SEAM-RIDER-QA");
const seamRiderStructure = seamRiderWorld.structures.find((structure) => !structure.major);
const seamLeft = seamRiderStructure.platformChunks[0];
const seamRight = seamRiderStructure.platformChunks.find((chunk) => chunk.deckRow === seamLeft.deckRow && chunk.deckColumn === seamLeft.deckColumn + 1);
const seamRider = { id: "seam-rider", alive: true, grounded: true, radius: .55, position: new THREE.Vector3(seamLeft.x + seamLeft.w / 2, seamLeft.top, seamLeft.z), velocity: new THREE.Vector3() };
const seamBase = seamRiderStructure.segments[0];
seamRiderWorld.destroy(seamRiderWorld.structuralCenter(seamBase).clone(), 5.2, { eventId: "seam-rider-collapse", attackerId: "attacker", structuralDamage: 20, structuralRadius: .35 });
seamRiderWorld.drainStructuralEvents();
seamRiderWorld.update(.53, [seamRider]);
seamRiderWorld.drainStructuralEvents();
seamRiderWorld.update(.74, [seamRider]);
assert.ok(seamRight && Math.abs(seamRider.position.y - seamLeft.top) < 1e-8, "a grounded capsule centered on a chunk seam is carried exactly once with the descending deck");
seamRiderWorld.dispose();

const padWorld = new ArenaWorld(new THREE.Scene(), "BOOST-SUPPORT-QA");
const towerPad = padWorld.boostPads.find((pad) => pad.support);
assert.ok(towerPad?.support, "elevated tower boost pads bind to their exact supporting deck chunk");
const padStartY = towerPad.position.y;
const padBase = towerPad.support.structure.segments[0];
padWorld.destroy(padWorld.structuralCenter(padBase).clone(), 5.2, { eventId: "pad-support-fall", attackerId: "attacker", structuralDamage: 20, structuralRadius: .35 });
padWorld.drainStructuralEvents();
padWorld.update(.53, []);
padWorld.drainStructuralEvents();
padWorld.update(.86, []);
assert.equal(towerPad.position.y, padStartY - padBase.h, "an attached boost pad moves with its descending support chunk");
assert.equal(towerPad.mesh.position.y, towerPad.position.y + .12, "the boost-pad mesh and gameplay trigger remain vertically aligned");
padWorld.destroy(padWorld.structuralCenter(towerPad.support).clone(), 5.2, { eventId: "pad-support-hole", attackerId: "attacker", partId: towerPad.support.structuralId, structuralDamage: 20, structuralRadius: .35 });
padWorld.settleStructuralChanges();
assert.ok(!towerPad.active && !towerPad.mesh.visible && !padWorld.boostAt(towerPad.position), "destroying a pad's host chunk hides and deactivates the pad");
padWorld.dispose();

const demolitionWorld = new ArenaWorld(new THREE.Scene(), "ALL-TOWERS-QA");
let demolitionEvent = 0;
for (const structure of demolitionWorld.structures.filter((candidate) => candidate.major)) {
  for (const part of [...structure.segments, ...structure.platformChunks]) {
    demolitionWorld.destroy(demolitionWorld.structuralCenter(part).clone(), 5.2, {
      eventId: `all-towers-${++demolitionEvent}`, attackerId: "attacker", partId: part.structuralId,
      structuralDamage: WEAPONS.rocket_launcher.structureDamage, structuralRadius: .35
    });
    demolitionWorld.settleStructuralChanges();
  }
}
assert.ok(demolitionWorld.structures.filter((structure) => structure.major).every((structure) => structure.platformChunks.length === 0 && structure.segments.length === 0), "every outer tower floor chunk and every stand module can be completely demolished");
assert.ok(demolitionWorld.platforms.some((platform) => !platform.structuralKind && platform.x === 0 && platform.z === 0 && platform.top === 15), "complete outer demolition cannot damage the protected middle tower");
demolitionWorld.dispose();

const snapshotWorld = new ArenaWorld(new THREE.Scene(), "SNAPSHOT-QA");
const snapshotStructure = snapshotWorld.structures[0];
const snapshotHole = snapshotStructure.platformChunks[0];
const snapshotChip = snapshotStructure.platformChunks[1];
snapshotWorld.applyStructuralState({ [snapshotHole.structuralId]: 0, [snapshotChip.structuralId]: 3.5 });
snapshotWorld.settleStructuralChanges();
assert.ok(!snapshotStructure.platformChunks.includes(snapshotHole) && snapshotStructure.platformChunks.includes(snapshotChip), "a compact late-join snapshot reconstructs one local hole without deleting the deck");
assert.equal(snapshotChip.health, 3.5, "a compact late-join snapshot preserves partial damage exactly");
assert.ok(!snapshotWorld.structuralChanges.length && !snapshotWorld.debrisParticles.some((particle) => particle.active) && !snapshotWorld.dustParticles.some((particle) => particle.active), "late-join structural snapshots settle silently without historical warnings, debris, or dust");
snapshotWorld.dispose();

const crushStructure = collapseWorld.structures.find((structure) => structure.platformChunks.length && structure.segments.length === 3) || collapseWorld.structures.find((structure) => structure.platformChunks.length && structure !== collapseStructure);
while (crushStructure.segments.length > 1) {
  const base = crushStructure.segments[0];
  const center = collapseWorld.structuralCenter(base).clone();
  collapseWorld.destroy(center, 5.2, { eventId: `crush-prep-${++crushHit}`, attackerId: "attacker", structuralDamage: 20, structuralRadius: .35 });
  collapseWorld.settleStructuralChanges();
}
const finalBase = crushStructure.segments[0];
const victimChunk = crushStructure.platformChunks.at(-1);
const victim = {
  id: "victim", alive: true, grounded: true, radius: .55,
  position: new THREE.Vector3(victimChunk.x, 0, victimChunk.z),
  velocity: new THREE.Vector3()
};
const finalCenter = collapseWorld.structuralCenter(finalBase).clone();
collapseWorld.destroy(finalCenter, 5.2, { eventId: `crush-final-${++crushHit}`, attackerId: "attacker", structuralDamage: 20, structuralRadius: .35 });
collapseWorld.drainStructuralEvents();
for (let frame = 0; frame < 14; frame++) collapseWorld.update(.1, [victim]);
assert.ok(collapseWorld.drainStructuralEvents().some((event) => event.type === "crush" && event.player === victim), "a descending deck reports a fighter with no full-height escape gap as crushed");
collapseWorld.dispose();

assert.match(mainSource, /authorityWeapon = WEAPONS\[weapon\.sourceWeaponId\] \|\| weapon[\s\S]*?reportTerrainHit\([\s\S]*?owner,[\s\S]*?authorityWeapon,/, "terrain hits and cluster children are reported under their authoritative source weapon");
assert.match(mainSource, /fireHitscan\([\s\S]*?damageTerrain\(wall, weapon, player\)/, "hitscan and precision weapons route direct surface hits into structure damage");
assert.match(mainSource, /fireFlame\([\s\S]*?damageTerrain\(surface, weapon, player\)/, "maintained flame routes surface contact into structure damage");
assert.match(mainSource, /fireMelee\([\s\S]*?damageTerrain\(surface, weapon, player\)/, "melee weapons route direct surface contact into structure damage");
assert.match(mainSource, /if \(worldHit\)[\s\S]*?terrainHit[\s\S]*?damageTerrain\(shot\.mesh\.position/, "physical projectiles route their exact impact point into structure damage");
assert.match(mainSource, /applyNetworkTerrainDamage\(message\)[\s\S]*?eventId: message\.id/, "clients mutate online structures only from idempotent room broadcasts");
assert.match(multiplayerWorkerSource, /structuralState: Object\.fromEntries\(this\.structuralHealth\)[\s\S]*?handleTerrainHit[\s\S]*?structuralPartBounds/, "the room authority stores compact structural state and validates reported chunk bounds");
assert.match(multiplayerWorkerSource, /structureDamageScale[\s\S]*?terrainShot\.structureDamageScale/, "partial charged shots retain the same structural damage scale at the room authority");
assert.match(multiplayerWorkerSource, /fallingDrop[\s\S]*?1_650[\s\S]*?bounds\.baseY - settledDrop - fallingDrop/, "the room authority accepts the swept visible bounds of a support during its collapse window");
assert.match(multiplayerWorkerSource, /handleCrush[\s\S]*?lastCrushEventId[\s\S]*?type: "crush"/, "the room authority deduplicates collapse kills and broadcasts their result");
assert.equal(worldB.spawnPoints().length, 16, "the arena provides one spawn candidate for every possible combatant");
const openingSpawns = worldB.spawnPoints().slice(0, 8);
assert.equal(openingSpawns.filter((point) => point.y >= 60 && Math.hypot(point.x, point.z) < 20).length, 1, "only one opening fighter spawns on the central tower");
assert.ok(openingSpawns.every((spawn, index) => openingSpawns.slice(index + 1).every((other) => spawn.distanceTo(other) >= 20)), "the normal eight-player opening distributes fighters across separate arena zones");
assert.ok(openingSpawns.every((spawn) => worldB.boostPads.every((pad) => spawn.distanceTo(pad.position) >= 4)), "opening fighters never start on an active boost pad");
assert.ok(openingSpawns.every((spawn) => worldB.portals.every((portal) => spawn.distanceTo(portal.position) >= 4)), "opening fighters never start inside a portal");
assert.equal(worldB.movers.length, 4, "the arena has moving aerial routes");
assert.equal(worldB.group.getObjectByName("Animated atmospheric perimeter"), undefined, "no giant atmosphere shell can intersect the camera at the map edge");
const skylineMatrix = new THREE.Matrix4();
const skylinePosition = new THREE.Vector3();
worldB.group.traverse((object) => {
  if (!object.isInstancedMesh || !object.name.includes("layered bodies")) return;
  for (let index = 0; index < object.count; index++) {
    object.getMatrixAt(index, skylineMatrix);
    skylinePosition.setFromMatrixPosition(skylineMatrix);
    assert.ok(Math.hypot(skylinePosition.x, skylinePosition.z) >= worldB.size + 40, "decorative skyline stays clear of the camera orbit");
  }
});
assert.equal(worldB.portals.length, 4, "the arena has two paired teleport routes");
assert.equal(worldB.sweepers.length, 2, "the arena has active kinetic hazards");
const moverX = worldB.movers[2].obstacle.x;
worldB.update(.5, []);
assert.notEqual(worldB.movers[2].obstacle.x, moverX, "dynamic platforms move during play");
const traveller = { alive: true, grounded: true, position: worldB.portals[0].position.clone(), velocity: new THREE.Vector3() };
worldB.update(.016, [traveller]);
assert.ok(traveller.position.distanceTo(worldB.portals[0].pair.position) < 1, "portals move combatants between arena elevations");
const wallGrapple = worldB.grapplePoint(new THREE.Vector3(100, 10, 0), new THREE.Vector3(1, 0, 0));
assert.ok(wallGrapple && Math.abs(wallGrapple.x - 111.4) < .01 && wallGrapple.y === 10, "the grapple attaches exactly where aimed on a wall");
const blockGrapple = worldB.grapplePoint(new THREE.Vector3(12, 20, 0), new THREE.Vector3(-1, 0, 0));
assert.ok(blockGrapple && Math.abs(blockGrapple.x - 3.5) < .01 && blockGrapple.y === 20, "the grapple attaches to ordinary blocks, not only anchor spheres");
const ropeStart = new THREE.Vector3(-12, 20, 0);
const ropeEnd = new THREE.Vector3(12, 20, 0);
const ropeWrapA = worldB.ropeWrapPoint(ropeStart, ropeEnd);
const ropeWrapB = ropeWrapA && worldB.ropeWrapPoint(ropeWrapA, ropeEnd);
assert.ok(worldB.ropeBlocked(ropeStart, ropeEnd), "solid geometry blocks a straight grapple rope");
assert.ok(worldB.effectBlocked(ropeStart, ropeEnd), "explosions and persistent hazards cannot damage through the same solid geometry");
assert.equal(worldB.effectBlocked(new THREE.Vector3(92, 10, 70), new THREE.Vector3(98, 10, 70)), false, "cover-aware effects still reach targets across clear open space");
assert.ok(ropeWrapA && ropeWrapB && !worldB.ropeBlocked(ropeStart, ropeWrapA) && !worldB.ropeBlocked(ropeWrapA, ropeWrapB) && !worldB.ropeBlocked(ropeWrapB, ropeEnd), "the grapple routes around clear obstacle edges");
const lowWrap = worldB.ropeWrapPoint(new THREE.Vector3(-12, 1.4, 0), new THREE.Vector3(12, 1.4, 0));
assert.ok(lowWrap?.y >= .12, "rope routing never bends underneath the arena floor");
assert.equal(worldB.grapplePoint(new THREE.Vector3(90, 10, 90), new THREE.Vector3(0, 1, 0)), null, "a missed grapple does not snap to an unrelated anchor");
assert.ok(worldB.grapplePoint(new THREE.Vector3(-300, 10, 0), new THREE.Vector3(1, 0, 0)), "the grapple ray has no hidden distance cutoff");
const blockedCamera = worldB.constrainCamera(new THREE.Vector3(100, 10, 0), new THREE.Vector3(120, 10, 0));
assert.ok(Math.abs(blockedCamera.x - 110.95) < .01, "the camera stops before entering a wall");
assert.ok(worldB.constrainCamera(new THREE.Vector3(100, 10, 0), new THREE.Vector3(95, 10, 0)).equals(new THREE.Vector3(95, 10, 0)), "the camera keeps its full distance when the view is clear");
assert.ok(worldB.size >= 100, "the arena spans a large horizontal combat area");
assert.ok(worldB.height >= 70, "the arena spans a large vertical combat area");
assert.ok(Math.max(...worldB.platforms.map((platform) => platform.top)) >= 60, "combat platforms reach the upper arena");
assert.ok(Math.max(...worldB.anchors.map((anchor) => anchor.point.y)) >= 70, "grapple anchors use the full arena height");
assert.ok(worldB.spawnPoints().some((point) => point.y >= 30), "respawns include elevated combat levels");
const upperSpawn = worldB.spawnPoints().find((point) => point.y >= 30);
const fallingOntoUpperSpawn = upperSpawn.clone().setY(upperSpawn.y - .1);
assert.ok(worldB.resolve(fallingOntoUpperSpawn, .72, upperSpawn.clone().setY(upperSpawn.y + .2)).grounded, "players land on elevated platforms");
const risingIntoPlatform = new THREE.Vector3(10, 12, 10);
assert.ok(worldB.resolve(risingIntoPlatform, .72, new THREE.Vector3(10, 11, 10)).ceiling && risingIntoPlatform.y < 11.3, "grapple motion cannot pull players through a platform underside");
const embeddedInSpire = new THREE.Vector3(0, 20, 0);
worldB.resolve(embeddedInSpire, .72, embeddedInSpire.clone());
assert.ok(Math.abs(embeddedInSpire.x) >= 4.2 || Math.abs(embeddedInSpire.z) >= 4.2, "solid blocks eject overlapping players instead of trapping them inside");
const platformSide = new THREE.Vector3(21.5, 12.5, 10);
const ledgeCollision = worldB.resolve(platformSide, .72, new THREE.Vector3(22.2, 12.5, 10));
assert.ok(ledgeCollision.ledge?.top === 15 && ledgeCollision.ledge.inward.x < 0, "platform sides expose an inward ledge-climb direction");

const fighter = new Fighter(
  worldScene,
  { id: "p1", name: "Rookie", color: 0x26d9ff, accent: 0xd9fbff },
  DEFAULT_LOADOUT,
  new THREE.Vector3()
);
fighter.switchSlot(4);
assert.equal(fighter.weapon.id, "railgun", "weapon switching selects the expected loadout slot");
fighter.recoil(2);
assert.ok(fighter.velocity.z < 0, "weapon recoil contributes to movement");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, 1.15, 0)), "projectiles collide with the fighter volume");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, 2.4, 0), .11), "head shots remain inside the fighter collision capsule");
assert.ok(projectileTouchesPlayer(fighter, new THREE.Vector3(0, .15, 0), .11), "low shots remain inside the fighter collision capsule");
assert.ok(projectileTouchesPlayer(fighter, fighter.forwardPoint(PROJECTILE_SPAWN_OFFSET + .6), .11), "a point-blank projectile cannot spawn beyond an overlapping fighter");
assert.ok(aimWithSpread(new THREE.Vector3(0, 0, 1), .02, () => .5).equals(new THREE.Vector3(0, 0, 1)), "centered spread preserves aim");
const spreadSamples = [.2, .8];
const conicalSpread = aimWithSpread(new THREE.Vector3(0, 0, 1), .2, () => spreadSamples.shift());
assert.notEqual(conicalSpread.x, 0, "shot spread varies horizontally");
assert.notEqual(conicalSpread.y, 0, "shot spread varies vertically instead of forming a flat fan");
fighter.ammo.railgun = 0;
assert.equal(fighter.reload(), true, "an empty weapon starts reloading");
fighter.switchSlot(0);
fighter.update(WEAPONS.railgun.reload + .05, new THREE.Vector3(), fighter.aim, {}, worldB);
assert.equal(fighter.ammo.railgun, WEAPONS.railgun.ammo, "reload completion refills the weapon that started the reload after a slot switch");
for (const id of fighter.loadout) fighter.ammo[id] = 0;
fighter.takeHit(100);
fighter.reloadTimer = 1;
fighter.reloadWeaponId = fighter.weapon.id;
fighter.pendingBurst = { weaponId: "burst_rifle", remaining: 2, timer: .05 };
fighter.chargeTimer = .8;
fighter.chargeLevel = .8;
fighter.chargingWeaponId = "charged_energy_rifle";
fighter.respawn(new THREE.Vector3());
assert.ok(fighter.loadout.every((id) => fighter.ammo[id] === WEAPONS[id].ammo), "respawning refills every weapon in the fighter's loadout");
assert.deepEqual(
  [fighter.reloadTimer, fighter.reloadWeaponId, fighter.pendingBurst, fighter.chargeTimer, fighter.chargeLevel, fighter.chargingWeaponId],
  [0, null, null, 0, 0, null],
  "respawning clears reload, burst, and charge state alongside the ammunition refill"
);

const meleeFighter = new Fighter(
  worldScene,
  { id: "melee", name: "Brawler", color: 0xff5c8a, accent: 0xffd3df },
  ["hammer", "energy_sword", "chainsaw", "spear", "punch_glove"],
  new THREE.Vector3(3, 0, 0)
);
meleeFighter.ammo.hammer = 0;
assert.equal(meleeFighter.reload(), false, "melee weapons never start a reload cycle");
assert.equal(meleeFighter.reloadTimer, 0, "melee weapons remain ready without reload downtime");
meleeFighter.dispose();

const flameFighter = new Fighter(
  worldScene,
  { id: "p16", name: "Pyro", color: 0xd75a1b, accent: 0xffc06a },
  ["flamethrower", ...DEFAULT_LOADOUT.slice(1)],
  new THREE.Vector3(4, 0, 4)
);
assert.ok(flameFighter.weaponMuzzleDistance > 1.4 && flameFighter.weaponGroup.children.length >= 6, "the Flamethrower has a distinct long-nozzle and fuel-tank silhouette");
flameFighter.slowTimer = 1;
flameFighter.update(.016, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), {}, worldB);
assert.ok(flameFighter.freezeRing.material.opacity > 0, "the geometry-based cyan frozen-state cue remains visible while slowed");
applyWeaponStatus(flameFighter, WEAPONS.freeze_gun);
assert.equal(flameFighter.slowTimer, 4.5, "repeated Freeze Gun hits refresh rather than add their duration");
applyWeaponStatus(flameFighter, WEAPONS.freeze_gun);
assert.equal(flameFighter.slowTimer, 4.5, "rapid Freeze Gun hits cannot stack into a longer impairment");
flameFighter.takeHit(100);
applyWeaponStatus(flameFighter, WEAPONS.freeze_gun);
assert.equal(flameFighter.slowTimer, 0, "death clears the frozen status immediately");
assert.equal(flameFighter.freezeRing.material.opacity, 0, "death clears the frozen-state visual immediately");
flameFighter.dispose();

const closeTarget = { alive: true, radius: .72, position: new THREE.Vector3(0, 0, 2) };
const cameraOrigin = new THREE.Vector3(3, 3, -6);
const cameraDirection = closeTarget.position.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(cameraOrigin).normalize();
const convergedAim = reticleAim(fighter, cameraOrigin, cameraDirection, { grapplePoint: () => null }, [fighter, closeTarget]);
const convergedHit = new THREE.Ray(fighter.position.clone().add(new THREE.Vector3(0, 1.25, 0)), convergedAim)
  .intersectSphere(new THREE.Sphere(closeTarget.position.clone().add(new THREE.Vector3(0, 1.2, 0)), closeTarget.radius), new THREE.Vector3());
assert.ok(convergedHit, "the weapon converges on the exact third-person reticle target at close range");
const overlappingTarget = { alive: true, radius: .72, position: new THREE.Vector3(0, 0, .3) };
const overlapDirection = overlappingTarget.position.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(cameraOrigin).normalize();
assert.ok(reticleAim(fighter, cameraOrigin, overlapDirection, { grapplePoint: () => null }, [fighter, overlappingTarget]).dot(overlapDirection) > 0, "overlapping targets cannot make the muzzle aim backward");
fighter.velocity.set(0, 0, 8);
fighter.grapple = { anchor: new THREE.Vector3(20, 20, 0), ropeLength: 24 };
const ropeBefore = fighter.grapple.ropeLength;
applyGrapplePhysics(fighter, .1);
assert.ok(fighter.velocity.x > 0 && fighter.velocity.y > 0, "the grapple actively pulls toward elevated anchors");
assert.ok(ropeBefore - fighter.grapple.ropeLength >= 1.79, "the grapple reels in decisively while attached");
const upwardLaunch = {
  position: new THREE.Vector3(), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
  grapple: { anchor: new THREE.Vector3(20, 20, 0), wraps: [], ropeLength: 24, pullSpeed: 0, launchLift: true }
};
const upwardDirection = upwardLaunch.grapple.anchor.clone().sub(new THREE.Vector3(0, 1.4, 0)).normalize();
applyGrapplePhysics(upwardLaunch, 1 / 60);
const upwardArc = upwardLaunch.velocity.y - upwardLaunch.velocity.dot(upwardDirection) * upwardDirection.y;
assert.ok(upwardArc > 1, "an upward grapple launches above its straight rope line to begin a visible lift arc");
assert.ok(upwardLaunch.velocity.y > 9 && upwardLaunch.velocity.x > 8, "an upward grapple immediately launches strongly upward and toward its anchor");
assert.equal(upwardLaunch.grapple.launchLift, false, "the launch lift is consumed once instead of disturbing the steady pull");
const levelLaunch = {
  position: new THREE.Vector3(), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
  grapple: { anchor: new THREE.Vector3(20, 1.4, 0), wraps: [], ropeLength: 18, pullSpeed: 0, launchLift: true }
};
applyGrapplePhysics(levelLaunch, 1 / 60);
assert.equal(levelLaunch.velocity.y, 0, "level grapple shots do not receive artificial upward lift");
const smoothPull = (fps) => {
  const dt = 1 / fps;
  const player = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
    grapple: { anchor: new THREE.Vector3(100, 1.4, 0), wraps: [], ropeLength: 90, pullSpeed: 0 }
  };
  const speeds = [];
  for (let frame = 0; frame < fps; frame++) {
    applyGrapplePhysics(player, dt);
    speeds.push(player.velocity.x);
    player.position.addScaledVector(player.velocity, dt);
  }
  return { player, speeds };
};
const pull60 = smoothPull(60);
assert.ok(pull60.speeds.every((speed, index) => index === 0 || speed >= pull60.speeds[index - 1] - .001), "grapple pull accelerates smoothly without stop-start velocity spikes");
assert.ok(pull60.player.velocity.x > 30 && pull60.player.velocity.x < 31.1, "grapple pull converges on one predictable travel speed");
assert.ok(Math.abs(smoothPull(30).player.velocity.x - smoothPull(120).player.velocity.x) < .05, "grapple pull is stable across frame rates");
const groundedGrappler = new Fighter(
  worldScene,
  { id: "grounded-grapple", name: "Grounded Grappler", color: 0x26d9ff, accent: 0xd9fbff },
  DEFAULT_LOADOUT,
  new THREE.Vector3()
);
groundedGrappler.grapple = { anchor: new THREE.Vector3(100, 1.4, 0), wraps: [], ropeLength: 90, pullSpeed: 0 };
const flatFloor = {
  resolve(position) { position.y = 0; return { grounded: true, ceiling: false, ledge: null, floor: 0 }; },
  boostAt() { return null; }
};
let previousPullSpeed = 0;
let maximumGroundRelaxation = 0;
for (let frame = 0; frame < 120; frame++) {
  groundedGrappler.update(1 / 60, new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), { jump: false }, flatFloor);
  maximumGroundRelaxation = Math.max(maximumGroundRelaxation, previousPullSpeed - groundedGrappler.velocity.x);
  applyGrapplePhysics(groundedGrappler, 1 / 60);
  previousPullSpeed = groundedGrappler.velocity.x;
}
assert.ok(maximumGroundRelaxation < .001, "ground contact and opposing walking input cannot relax grapple velocity between pulls");
assert.ok(groundedGrappler.velocity.x > 30, "the grapple retains authority over grounded locomotion until release");
groundedGrappler.dispose();
const wrappedPlayer = {
  position: new THREE.Vector3(), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
  grapple: { anchor: new THREE.Vector3(20, 10, 0), wraps: [new THREE.Vector3(0, 10, 10)], ropeLength: 25 }
};
applyGrapplePhysics(wrappedPlayer, .1);
assert.ok(wrappedPlayer.velocity.z > 0 && Math.abs(wrappedPlayer.velocity.x) < .001, "a bent rope pulls toward its nearest wrap point instead of through the obstacle");
const ledgePlayer = {
  position: new THREE.Vector3(21.72, 12.5, 10), velocity: new THREE.Vector3(), controlMove: new THREE.Vector3(), slowTimer: 0,
  ledgeContact: ledgeCollision.ledge,
  grapple: { anchor: new THREE.Vector3(10, 15, 10), wraps: [], ropeLength: 14 }
};
applyGrapplePhysics(ledgePlayer, .1);
assert.ok(ledgePlayer.velocity.y >= 11 && ledgePlayer.velocity.dot(ledgeCollision.ledge.inward) >= 6.99, "grappling a platform top automatically lifts and pulls a stuck player over its ledge");
const speedBeforeRelease = fighter.velocity.length();
boostGrappleRelease(fighter);
assert.ok(fighter.velocity.length() > speedBeforeRelease, "releasing a fast swing adds a slingshot boost");

fighter.dispose();
worldB.dispose();
console.log("Master Blaster smoke check passed.");
