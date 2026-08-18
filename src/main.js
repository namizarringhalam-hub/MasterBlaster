import * as THREE from "three/webgpu";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import "./styles.css";
import { SoundBoard } from "./audio.js";
import { CombatVisuals } from "./combatVisuals.js";
import { ArenaWorld } from "./world.js";
import { Fighter, PROJECTILE_SPAWN_OFFSET, aimWithSpread, applyGrapplePhysics, applyWeaponStatus, boostGrappleRelease, cameraRelative, directionFromKeys, directionFromTouch, flameConeFactor, grappleSightline, projectileTouchesPlayer, reticleAim } from "./player.js";
import { InputManager, clearTouchActions, updateOrbit } from "./input.js";
import { activePresetLoadout, DEFAULT_LOADOUT, excessOwnedProjectiles, graphicsProfile, LOADOUT_PRESET_COUNT, loadSettings, projectileLifetime, projectileStepCount, randomLoadout, saveSettings, swapStolenWeapon, weaponFireMode, WEAPON_GROUPS, WEAPONS } from "./gameData.js";
import { botFireChance, botRemoteChargeAction, botWeaponPolicy, chooseBotSlot, clampBotCount, safestSpawn, shouldBotPlaceWall } from "./botBrain.js";
import { NeonRenderPipeline } from "./renderPipeline.js";
import { combatMusicIntensity } from "./musicScore.js";

const canvas = document.querySelector("#game-canvas");
const ui = document.querySelector("#ui-root");
const matchLoading = document.querySelector("#match-loading");
const MATCH_SESSION_KEY = "blaster-pending-match";
const clamp = THREE.MathUtils.clamp;
const WEAPON_CATEGORY_BY_ID = Object.fromEntries(WEAPON_GROUPS.flatMap((group) => group.ids.map((id) => [id, group])));
const WEAPON_INDEX_BY_ID = Object.fromEntries(Object.keys(WEAPONS).map((id, index) => [id, index]));
const WEAPON_CATEGORY_SLUG_BY_ID = Object.fromEntries(Object.values(WEAPONS).map((weapon) => [weapon.id, weapon.category.toLowerCase().replaceAll(" ", "-")]));
const WEAPON_CSS_COLOR_BY_ID = Object.fromEntries(Object.values(WEAPONS).map((weapon) => [weapon.id, `#${weapon.color.toString(16).padStart(6, "0")}`]));
const CAMERA_ALTERNATIVE_ANGLES = [-2.35, -1.57, -.78, .78, 1.57, 2.35, Math.PI];
const CAMERA_ALTERNATIVE_HEIGHTS = [5.2, -3.2];
const CAMERA_UP = new THREE.Vector3(0, 1, 0);

function projectileNeedsLoop(shot) {
  return !shot.mine && !shot.stuck && (shot.weapon.type === "rocket" || shot.weapon.type === "grenade" || shot.weapon.returning || ["fireball", "drill"].includes(shot.weapon.presentationPayload));
}

function selectNearestAudio(items, origin, limit, accept, distances, ids, output) {
  output.clear();
  let count = 0;
  for (const item of items) {
    if (accept && !accept(item)) continue;
    const distance = item.mesh.position.distanceToSquared(origin);
    if (count === limit && distance >= distances[limit - 1]) continue;
    let insert = Math.min(count, limit - 1);
    while (insert > 0 && distance < distances[insert - 1]) {
      distances[insert] = distances[insert - 1];
      ids[insert] = ids[insert - 1];
      insert--;
    }
    distances[insert] = distance;
    ids[insert] = item.audioId;
    if (count < limit) count++;
  }
  for (let index = 0; index < count; index++) output.add(ids[index]);
  return output;
}

function setText(node, value) {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}

function setStyle(node, property, value) {
  if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
}

function weaponPreviewVariables(weapon, index) {
  const length = 27 + index % 7 * 1.35;
  const height = 8 + index % 5 * 1.1;
  const angle = -8 + index * .36;
  const offset = index % 4 * .75;
  return `--preview-length:${length}px;--preview-height:${height}px;--preview-angle:${angle}deg;--preview-offset:${offset}px`;
}

function vortexRibbonGeometry(radius = 2.25, height = 3.8, turns = 3.4, segments = 76) {
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const angle = t * Math.PI * 2 * turns;
    const centreRadius = radius * (1 - t * .58) + Math.sin(t * Math.PI * 7) * .08;
    const halfWidth = .07 + (1 - t) * .05;
    for (const side of [-1, 1]) {
      const r = centreRadius + side * halfWidth;
      positions.push(Math.cos(angle) * r, t * height, Math.sin(angle) * r);
    }
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const PLAYER_COLORS = [
  { color: 0x129dba, accent: 0x6ff6ff },
  { color: 0xc82849, accent: 0xff6b82 },
  { color: 0x6bad22, accent: 0xb9ff55 },
  { color: 0x7847ca, accent: 0xc793ff },
  { color: 0xd77a16, accent: 0xffc14f },
  { color: 0xb92d86, accent: 0xff75cf },
  { color: 0x2867ce, accent: 0x75b5ff },
  { color: 0x15987b, accent: 0x62ffd0 },
  { color: 0xbe4f20, accent: 0xff8a55 },
  { color: 0x7456a8, accent: 0xd0a8ff },
  { color: 0x158a98, accent: 0x68efff },
  { color: 0xb58c18, accent: 0xffde5e },
  { color: 0xb33f5e, accent: 0xff86a2 },
  { color: 0x327ba5, accent: 0x78d5ff },
  { color: 0x3c9a4e, accent: 0x81f58d },
  { color: 0xa43aa9, accent: 0xf07dff }
];

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function capabilities() {
  return {
    webgpu: Boolean(navigator.gpu),
    webgl2: Boolean(document.createElement("canvas").getContext("webgl2")),
    wasm: typeof WebAssembly === "object",
    websocket: typeof WebSocket === "function",
    pointer: typeof PointerEvent === "function"
  };
}

class BlasterBattle {
  constructor() {
    this.capabilities = capabilities();
    this.settings = loadSettings();
    this.coarsePointer = matchMedia("(pointer: coarse)").matches;
    this.graphics = graphicsProfile(this.settings.graphics, this.coarsePointer, devicePixelRatio);
    this.forceWebGL = sessionStorage.getItem("blaster-force-webgl") === "1"
      || new URLSearchParams(location.search).get("renderer") === "webgl";
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      samples: 4,
      alpha: false,
      forceWebGL: this.forceWebGL,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(this.graphics.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07111d);
    this.scene.fog = new THREE.FogExp2(0x07111d, .006);
    this.camera = new THREE.PerspectiveCamera(62, 1, .1, 520);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.input = new InputManager(
      canvas,
      () => this.state === "play" && !this.paused,
      () => { if (this.state === "play" && !this.paused) this.togglePause(); }
    );
    this.cameraYaw = 0;
    this.cameraPitch = -.08;
    this.cameraFocus = new THREE.Vector3();
    this.cameraScratch = {
      forward: new THREE.Vector3(), flatForward: new THREE.Vector3(), right: new THREE.Vector3(),
      pivot: new THREE.Vector3(), desired: new THREE.Vector3(), offset: new THREE.Vector3(),
      candidateDesired: new THREE.Vector3(), candidate: new THREE.Vector3(), target: new THREE.Vector3(),
      constrained: new THREE.Vector3(), motionLead: new THREE.Vector3(), focus: new THREE.Vector3(),
      menuPosition: new THREE.Vector3(0, 22, 29)
    };
    this.cameraClearance = { actual: 0, target: 0 };
    this.listenerDirection = new THREE.Vector3();
    this.aimDirection = new THREE.Vector3();
    this.aimTargets = [];
    this.nearestAudioDistances = new Float64Array(6);
    this.nearestAudioIds = Array(6);
    this.audibleProjectileIds = new Set();
    this.audibleHazardIds = new Set();
    this.armedCounts = new Map();
    this.hazardTarget = new THREE.Vector3();
    this.hazardOffset = new THREE.Vector3();
    this.hazardPush = new THREE.Vector3();
    this.sound = new SoundBoard();
    this.sound.setVolume(this.settings.volume);
    this.sound.setMix({ music: this.settings.musicVolume, effects: this.settings.effectsVolume, ambience: this.settings.ambienceVolume });
    this.sound.setDynamicRange(this.settings.dynamicRange);
    document.documentElement.classList.toggle("reduce-motion", this.settings.reducedMotion);
    this.state = "menu";
    this.paused = false;
    this.mode = "training";
    this.seed = "BLAST-01";
    this.botDifficulty = "normal";
    this.world = null;
    this.players = [];
    this.projectiles = [];
    this.hazards = [];
    this.decoys = [];
    this.effects = [];
    this.combatVisuals = null;
    this.respawnTimers = [];
    this.scores = [];
    this.matchTime = 180;
    this.matchStartDelay = 0;
    this.countdownBeat = 0;
    this.audioCountdown = false;
    this.awaitingAudioGesture = false;
    this.targetScore = 10;
    this.touch = {};
    this.performanceSample = this.freshPerformanceSample();
    this.audioMixTimer = 0;
    this.combatMusicPulse = 0;
    this.freshSessionReady = false;
    this.setupLights();
  }

  async init() {
    await this.renderer.init();
    this.capabilities[this.renderer.backend.isWebGPUBackend === true ? "webgpu renderer" : "webgl2 fallback"] = true;
    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment(), .04).texture;
    this.scene.environmentIntensity = .82;
    environment.dispose();
    this.rebuildRenderPipeline();
    const reportDeviceLost = this.renderer.onDeviceLost.bind(this.renderer);
    this.renderer.onDeviceLost = (info) => {
      reportDeviceLost(info);
      if (this.renderer.backend.isWebGPUBackend === true && !this.forceWebGL) {
        sessionStorage.setItem("blaster-force-webgl", "1");
        location.reload();
        return;
      }
      this.showRendererFailure("The graphics device was reset. Reload the page to restart the arena.");
    };
    const reportRendererError = this.renderer.onError.bind(this.renderer);
    this.renderer.onError = (info) => {
      reportRendererError(info);
      this.renderPipeline.degradeToDirect(info);
    };
    this.renderMain();
    this.resize();
    addEventListener("resize", () => this.resize());
    addEventListener("blur", () => clearTouchActions(this.touch));
    this.resumeAudioGesture = () => {
      if (this.resumeAudioAfterReload()) removeEventListener("pointerdown", this.resumeAudioGesture, true);
    };
    addEventListener("pointerdown", this.resumeAudioGesture, { passive: true, capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearTouchActions(this.touch);
        if (this.state === "play" && !this.paused) this.togglePause();
      }
      this.sound.setPaused(document.hidden || this.paused);
    });
    await this.renderer.setAnimationLoop((time) => this.frame(time));
    this.resumePendingMatch();
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0x96d9ff, 0x10182a, 1.18));
    const key = new THREE.DirectionalLight(0xffffff, 1.78);
    key.position.set(-22, 40, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -.00018;
    key.shadow.normalBias = .035;
    Object.assign(key.shadow.camera, { left: -135, right: 135, top: 135, bottom: -135, near: 1, far: 260 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff315f, .88);
    rim.position.set(22, 15, -25);
    this.scene.add(rim);
  }

  showRendererFailure(message) {
    this.paused = true;
    ui.insertAdjacentHTML("beforeend", `<div class="overlay"><section class="dialog"><p>GRAPHICS RECOVERY</p><h1>Renderer paused.</h1><p class="dialog-lead">${escapeHtml(message)}</p><button class="primary" onclick="location.reload()">RELOAD</button></section></div>`);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  applyGraphicsSettings() {
    this.graphics = graphicsProfile(this.settings.graphics, this.coarsePointer, devicePixelRatio);
    this.settings.graphics = this.graphics.level;
    this.renderer.setPixelRatio(this.graphics.pixelRatio);
    this.renderPipeline?.setQuality(this.graphics.level);
    this.resize();
  }

  rebuildRenderPipeline() {
    this.renderPipeline?.dispose();
    this.renderer.setRenderTarget(null);
    this.renderPipeline = new NeonRenderPipeline(this.renderer, this.scene, this.camera, {
      reducedMotion: this.settings.reducedMotion,
      coarsePointer: this.coarsePointer,
      quality: this.graphics.level
    });
  }

  clearMatch() {
    this.input.releasePointer();
    clearTouchActions(this.touch);
    this.combatVisuals?.dispose();
    this.combatVisuals = null;
    this.world?.dispose();
    for (const player of this.players) {
      this.sound.stopOwner(player.id);
      this.releaseGrapple(player, false, true);
      player.dispose();
    }
    for (const shot of this.projectiles) {
      this.removeObject(shot.mesh);
      this.removeObject(shot.telegraph);
    }
    for (const hazard of this.hazards) this.removeObject(hazard.mesh);
    for (const decoy of this.decoys) this.removeObject(decoy.mesh);
    for (const effect of this.effects) this.removeObject(effect.mesh);
    this.world = null;
    this.players = [];
    this.projectiles = [];
    this.hazards = [];
    this.decoys = [];
    this.effects = [];
    this.sound.stopAll();
  }

  renderMain() {
    this.state = "menu";
    this.paused = false;
    this.clearMatch();
    this.sound.setPaused(false);
    this.sound.setMusicScene("menu");
    if (this.sound.context) this.sound.startMusic("menu", this.seed);
    const checks = Object.entries(this.capabilities)
      .map(([name, ok]) => `<span class="${ok ? "ok" : "bad"}">${ok ? "●" : "×"} ${name.toUpperCase()}</span>`)
      .join("");
    ui.innerHTML = `
      <main class="menu-shell">
        <section class="hero-panel">
          <div class="brand-mark"><i></i><span>BLASTER</span><b>BATTLE</b></div>
          <p class="kicker">BROWSER-NATIVE ARENA COMBAT</p>
          <h1>Swing fast.<br><em>Blast smart.</em></h1>
          <p class="lead">Physical projectiles, explosive routes, and a grappling hook that never leaves your side.</p>
          <div class="primary-actions">
            <button class="primary" data-mode="quick"><span>QUICK PLAY</span><small>Regional practice queue</small></button>
            <button data-mode="private"><span>PRIVATE ROOM</span><small>Create or join by code</small></button>
            <button data-mode="training"><span>TRAINING</span><small>Fight up to 15 adaptive bots</small></button>
          </div>
          <div class="secondary-actions">
            <button data-screen="settings">Settings</button>
            <button data-screen="credits">Credits</button>
          </div>
          <div class="capabilities" aria-label="Browser capability check">${checks}</div>
        </section>
        <aside class="feature-rail">
          <span>01</span><div><b>GRAPPLE</b><small>Momentum is your weapon</small></div>
          <span>02</span><div><b>47 WEAPONS</b><small>Carry five into combat</small></div>
          <span>03</span><div><b>DYNAMIC ARENAS</b><small>Moving routes, portals, and hazards</small></div>
        </aside>
      </main>`;
    this.bindUi();
  }

  renderSetup(mode) {
    this.mode = mode;
    const savedDefault = activePresetLoadout(this.settings);
    if (savedDefault) this.settings.loadout = [...savedDefault];
    if (mode === "quick") {
      if (!savedDefault) this.settings.loadout = randomLoadout();
      this.settings.botCount = 7;
      this.botDifficulty = "normal";
    }
    const title = mode === "quick" ? "Quick Play" : mode === "private" ? "Private Room" : "Training";
    const detail = mode === "quick"
      ? "Enter the regional practice queue with up to fifteen AI combatants."
      : mode === "private"
        ? "Use a short room code as the deterministic arena seed."
        : "Choose up to fifteen bots and master movement, trajectories, recoil, and grappling.";
    ui.innerHTML = `
      <main class="screen">
        <section class="dialog setup-dialog">
          <header><button class="back" data-screen="main">← Back</button><p>${mode.toUpperCase()}</p></header>
          <h1>${title}</h1>
          <p class="dialog-lead">${detail}</p>
          <div class="setup-form">
            <label>Display name<input id="display-name" maxlength="18" value="${escapeHtml(this.settings.displayName)}"></label>
            <label>${mode === "private" ? "Room code" : "Map seed"}<input id="map-seed" maxlength="12" value="${escapeHtml(mode === "private" ? this.roomCode() : this.seed)}"></label>
            <label>Bot difficulty
              <select id="bot-difficulty">
                ${["rookie", "normal", "veteran"].map((level) => `<option ${this.botDifficulty === level ? "selected" : ""}>${level}</option>`).join("")}
              </select>
            </label>
            <label>Number of bots<input id="bot-count" type="number" min="1" max="15" step="1" value="${clampBotCount(this.settings.botCount)}"></label>
          </div>
          <section class="loadout-builder">
            <div><h2>Choose five weapons</h2><span data-loadout-count>${this.settings.loadout.length}/5 selected</span></div>
            <p class="loadout-help">Weapon order becomes slots 1â€“5. Drag on desktop or use the arrow controls on any device.</p>
            <div class="loadout-order" data-loadout-order>${this.loadoutOrderMarkup()}</div>
            <div class="preset-heading"><h3>Saved sets</h3><span>One default applies automatically to every game</span></div>
            <section class="loadout-presets" aria-label="Saved weapon sets" data-loadout-presets>${this.loadoutPresetsMarkup()}</section>
            <p class="loadout-status" data-loadout-status aria-live="polite"></p>
            <div class="weapon-categories">${this.weaponCategoriesMarkup()}</div>
          </section>
          <button class="launch primary" data-action="start">${mode === "quick" ? "FIND MATCH" : mode === "private" ? "CREATE ROOM" : "START TRAINING"}</button>
          <p class="prototype-note">Playable MVP slice · Guest session · Internet match fleet is represented locally in this build</p>
        </section>
      </main>`;
    this.bindUi();
  }

  weaponCategoriesMarkup() {
    return WEAPON_GROUPS.map((group) => `<section class="weapon-category" data-weapon-category="${group.id}" style="--category:${group.color}" aria-labelledby="weapon-category-${group.id}">
      <header><h3 id="weapon-category-${group.id}"><i></i>${group.name}</h3><span>${group.ids.length} weapons · A–Z</span></header>
      <div class="weapon-grid">
        ${group.ids.map((id) => {
          const weapon = WEAPONS[id];
          const slot = this.settings.loadout.indexOf(id);
          return `<button class="weapon-choice ${slot >= 0 ? "selected" : ""}" data-weapon-choice="${id}" data-weapon="${id}" data-category="${group.id}" data-shape="${weapon.type}" data-slot="${slot >= 0 ? slot + 1 : ""}" style="--weapon:#${weapon.color.toString(16).padStart(6, "0")};--category:${group.color};${weaponPreviewVariables(weapon, WEAPON_INDEX_BY_ID[id])}">
            <i></i><span class="weapon-preview" aria-hidden="true"></span>
            <b>${weapon.name}</b><em>${group.name}</em><small>${weapon.description}</small>
          </button>`;
        }).join("")}
      </div>
    </section>`).join("");
  }

  loadoutOrderMarkup() {
    return Array.from({ length: 5 }, (_, index) => {
      const id = this.settings.loadout[index];
      const weapon = WEAPONS[id];
      if (!weapon) return `<div class="loadout-slot empty"><span>${index + 1}</span><small>Empty slot</small></div>`;
      const color = `#${weapon.color.toString(16).padStart(6, "0")}`;
      const category = WEAPON_CATEGORY_BY_ID[id];
      return `<div class="loadout-slot" draggable="true" data-loadout-drag="${index}" style="--weapon:${color};--category:${category.color}">
        <span>${index + 1}</span><b>${escapeHtml(weapon.name)}</b><small>${category.name}</small>
        <div>
          <button data-loadout-move="${index}" data-direction="-1" aria-label="Move ${escapeHtml(weapon.name)} left" ${index === 0 ? "disabled" : ""}>‹</button>
          <button data-loadout-move="${index}" data-direction="1" aria-label="Move ${escapeHtml(weapon.name)} right" ${index === this.settings.loadout.length - 1 ? "disabled" : ""}>›</button>
          <button data-loadout-remove="${index}" aria-label="Remove ${escapeHtml(weapon.name)}">×</button>
        </div>
      </div>`;
    }).join("");
  }

  loadoutPresetsMarkup() {
    return Array.from({ length: LOADOUT_PRESET_COUNT }, (_, index) => {
      const preset = this.settings.loadoutPresets[index];
      const isDefault = this.settings.defaultLoadoutPreset === index;
      const name = preset?.name || `Set ${index + 1}`;
      const label = escapeHtml(name);
      const summary = preset ? preset.weaponIds.map((id, slot) => `<span style="--category:${WEAPON_CATEGORY_BY_ID[id].color}"><i>${slot + 1}</i>${escapeHtml(WEAPONS[id].name)}</span>`).join("") : `<small>No saved weapons</small>`;
      return `<article class="loadout-preset ${isDefault ? "default" : ""}" aria-label="${label} weapon set">
        <header>
          <input value="${label}" maxlength="18" data-preset-name="${index}" aria-label="Name for weapon set ${index + 1}">
          <button data-preset-default="${index}" ${preset ? "" : "disabled"} aria-label="${isDefault ? `Remove ${label} as default` : `Make ${label} the default`} weapon set" aria-pressed="${isDefault}">${isDefault ? "★ DEFAULT" : "☆ DEFAULT"}</button>
        </header>
        <div class="preset-summary">${summary}</div>
        <footer>
          <button data-preset-load="${index}" ${preset ? "" : "disabled"} aria-label="Load ${label} weapon set">LOAD</button>
          <button data-preset-save="${index}" ${this.settings.loadout.length === 5 ? "" : "disabled"} aria-label="Save current loadout to ${label}">SAVE CURRENT</button>
          <button data-preset-clear="${index}" ${preset ? "" : "disabled"} aria-label="Clear ${label} weapon set">CLEAR</button>
        </footer>
      </article>`;
    }).join("");
  }

  renderSettings() {
    ui.innerHTML = `
      <main class="screen">
        <section class="dialog settings-dialog">
          <header><button class="back" data-screen="main">← Back</button><p>LOCAL PREFERENCES</p></header>
          <h1>Settings</h1>
          <div class="settings-grid">
            <label>Graphics quality
              <select data-setting="graphics">
                ${["low", "medium", "high"].map((value) => `<option ${this.settings.graphics === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>Blood and impact effects
              <select data-setting="blood">
                ${["off", "reduced", "full"].map((value) => `<option ${this.settings.blood === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label>Camera shake <output>${this.settings.shake}%</output>
              <input type="range" min="0" max="100" value="${this.settings.shake}" data-setting="shake">
            </label>
            <label>Master volume <output>${this.settings.volume}%</output>
              <input type="range" min="0" max="100" value="${this.settings.volume}" data-setting="volume">
            </label>
            <label>Music volume <output>${this.settings.musicVolume}%</output>
              <input type="range" min="0" max="100" value="${this.settings.musicVolume}" data-setting="musicVolume">
            </label>
            <label>Effects volume <output>${this.settings.effectsVolume}%</output>
              <input type="range" min="0" max="100" value="${this.settings.effectsVolume}" data-setting="effectsVolume">
            </label>
            <label>Ambience volume <output>${this.settings.ambienceVolume}%</output>
              <input type="range" min="0" max="100" value="${this.settings.ambienceVolume}" data-setting="ambienceVolume">
            </label>
            <label>Dynamic range
              <select data-setting="dynamicRange">
                ${["wide", "standard", "night"].map((value) => `<option ${this.settings.dynamicRange === value ? "selected" : ""}>${value}</option>`).join("")}
              </select>
            </label>
            <label class="toggle"><input type="checkbox" data-setting="reducedMotion" ${this.settings.reducedMotion ? "checked" : ""}> Reduce motion and flashes</label>
          </div>
          <button class="primary" data-action="save-settings">SAVE SETTINGS</button>
        </section>
      </main>`;
    this.bindUi();
    for (const range of ui.querySelectorAll('input[type="range"]')) {
      range.oninput = () => { range.previousElementSibling.textContent = `${range.value}%`; };
    }
  }

  renderCredits() {
    ui.innerHTML = `
      <main class="screen">
        <section class="dialog credits-dialog">
          <header><button class="back" data-screen="main">← Back</button><p>BLASTER BATTLE v0.1</p></header>
          <h1>Built for the open web.</h1>
          <p>Three.js rendering, deterministic seeded arenas, Web Audio, Pointer Events, keyboard, mouse, and touch-friendly controls.</p>
          <p>Game direction follows the Blaster Battle browser-native specification, inspired by the immediate projectile combat and grappling movement of classic arena games.</p>
        </section>
      </main>`;
    this.bindUi();
  }

  roomCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  bindUi() {
    ui.onclick = (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      this.sound.resume();
      this.sound.setVolume(this.settings.volume);
      this.sound.startMusic(this.state === "play" ? "combat" : "menu", this.seed);
      const menuWeapon = button.dataset.weaponChoice
        ? WEAPONS[button.dataset.weaponChoice]
        : button.dataset.weaponSlot != null ? WEAPONS[this.players[0]?.loadout[Number(button.dataset.weaponSlot)]] : null;
      this.sound.play(button.dataset.screen === "main" ? "uiBack" : button.dataset.weaponChoice || button.dataset.weaponSlot ? "weaponSelect" : "uiConfirm", menuWeapon);
      if (button.dataset.screen === "main") return this.renderMain();
      if (button.dataset.screen === "settings") return this.renderSettings();
      if (button.dataset.screen === "credits") return this.renderCredits();
      if (button.dataset.mode) return this.renderSetup(button.dataset.mode);
      if (button.dataset.weaponChoice) return this.toggleLoadout(button.dataset.weaponChoice);
      if (button.dataset.loadoutMove) return this.moveLoadout(Number(button.dataset.loadoutMove), Number(button.dataset.direction));
      if (button.dataset.loadoutRemove) return this.removeLoadout(Number(button.dataset.loadoutRemove));
      if (button.dataset.presetLoad) return this.loadPreset(Number(button.dataset.presetLoad));
      if (button.dataset.presetSave) return this.savePreset(Number(button.dataset.presetSave));
      if (button.dataset.presetDefault) return this.toggleDefaultPreset(Number(button.dataset.presetDefault));
      if (button.dataset.presetClear) return this.clearPreset(Number(button.dataset.presetClear));
      if (button.dataset.weaponSlot) return this.players[0]?.switchSlot(Number(button.dataset.weaponSlot));
      if (button.dataset.action === "start") return this.captureSetupAndStart();
      if (button.dataset.action === "pause") return this.togglePause();
      if (button.dataset.action === "rematch") return this.queueRematch();
      if (button.dataset.action === "save-settings") return this.saveSettingsForm();
    };
    ui.onchange = (event) => {
      if (event.target.dataset.presetName) this.renamePreset(Number(event.target.dataset.presetName), event.target.value);
    };
    ui.oninput = (event) => {
      if (!["volume", "musicVolume", "effectsVolume", "ambienceVolume"].includes(event.target.dataset.setting)) return;
      event.target.closest("label")?.querySelector("output")?.replaceChildren(`${event.target.value}%`);
      this.settings[event.target.dataset.setting] = Number(event.target.value);
      if (event.target.dataset.setting === "volume") this.sound.setVolume(this.settings.volume);
      else this.sound.setMix({
        music: this.settings.musicVolume, effects: this.settings.effectsVolume, ambience: this.settings.ambienceVolume
      });
    };
    ui.onpointerover = (event) => {
      const button = event.target.closest?.("button");
      if (button && !button.disabled && event.relatedTarget?.closest?.("button") !== button) this.sound.play("uiHover");
    };
    ui.ondragstart = (event) => {
      const slot = event.target.closest?.("[data-loadout-drag]");
      if (!slot) return;
      event.dataTransfer.setData("text/plain", slot.dataset.loadoutDrag);
      event.dataTransfer.effectAllowed = "move";
    };
    ui.ondragover = (event) => {
      if (event.target.closest?.("[data-loadout-drag]")) event.preventDefault();
    };
    ui.ondrop = (event) => {
      const slot = event.target.closest?.("[data-loadout-drag]");
      if (!slot) return;
      event.preventDefault();
      this.moveLoadoutTo(Number(event.dataTransfer.getData("text/plain")), Number(slot.dataset.loadoutDrag));
    };
  }

  toggleLoadout(id) {
    const current = [...this.settings.loadout];
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
    else if (current.length < 5) current.push(id);
    else return this.announceLoadout("All five weapon slots are full.");
    this.settings.loadout = current;
    this.updateLoadoutUi();
    this.announceLoadout(index >= 0 ? `${WEAPONS[id].name} removed.` : `${WEAPONS[id].name} added to slot ${current.length}.`);
  }

  moveLoadout(index, direction) {
    const next = index + direction;
    if (!this.settings.loadout[index] || next < 0 || next >= this.settings.loadout.length) return;
    const name = WEAPONS[this.settings.loadout[index]].name;
    [this.settings.loadout[index], this.settings.loadout[next]] = [this.settings.loadout[next], this.settings.loadout[index]];
    const focusDirection = next + direction >= 0 && next + direction < this.settings.loadout.length ? direction : -direction;
    this.updateLoadoutUi(`[data-loadout-move="${next}"][data-direction="${focusDirection}"]`);
    this.announceLoadout(`${name} moved to slot ${next + 1}.`);
  }

  moveLoadoutTo(from, to) {
    if (from === to || !this.settings.loadout[from] || !this.settings.loadout[to]) return;
    const [weapon] = this.settings.loadout.splice(from, 1);
    this.settings.loadout.splice(to, 0, weapon);
    this.updateLoadoutUi();
    this.announceLoadout(`${WEAPONS[weapon].name} moved to slot ${to + 1}.`);
  }

  removeLoadout(index) {
    if (index < 0 || index >= this.settings.loadout.length) return;
    const [weapon] = this.settings.loadout.splice(index, 1);
    this.updateLoadoutUi(`[data-weapon-choice="${weapon}"]`);
    this.announceLoadout(`${WEAPONS[weapon].name} removed.`);
  }

  loadPreset(index) {
    const preset = this.settings.loadoutPresets[index];
    if (!preset) return;
    this.settings.loadout = [...preset.weaponIds];
    this.updateLoadoutUi(`[data-preset-load="${index}"]`);
    this.announceLoadout(`${preset.name} loaded in slots 1 through 5.`);
  }

  savePreset(index) {
    if (index < 0 || index >= LOADOUT_PRESET_COUNT || this.settings.loadout.length !== 5) return;
    const name = ui.querySelector(`[data-preset-name="${index}"]`)?.value.trim().slice(0, 18) || `Set ${index + 1}`;
    const existing = this.settings.loadoutPresets[index];
    const unchanged = existing?.name === name && existing.weaponIds.every((id, slot) => id === this.settings.loadout[slot]);
    if (existing && !unchanged && !globalThis.confirm(`Replace ${existing.name} with the current weapon order?`)) return;
    const firstPreset = !this.settings.loadoutPresets.some(Boolean);
    this.settings.loadoutPresets[index] = { name, weaponIds: [...this.settings.loadout] };
    if (firstPreset) this.settings.defaultLoadoutPreset = index;
    saveSettings(this.settings);
    this.updateLoadoutUi(`[data-preset-save="${index}"]`);
    this.announceLoadout(`${name} saved${firstPreset ? " and set as default" : ""}.`);
  }

  renamePreset(index, value) {
    const preset = this.settings.loadoutPresets[index];
    if (!preset) return;
    preset.name = value.trim().slice(0, 18) || `Set ${index + 1}`;
    saveSettings(this.settings);
    const input = ui.querySelector(`[data-preset-name="${index}"]`);
    if (input) input.value = preset.name;
    const label = preset.name;
    const article = input?.closest(".loadout-preset");
    article?.setAttribute("aria-label", `${label} weapon set`);
    article?.querySelector("[data-preset-load]")?.setAttribute("aria-label", `Load ${label} weapon set`);
    article?.querySelector("[data-preset-save]")?.setAttribute("aria-label", `Save current loadout to ${label}`);
    article?.querySelector("[data-preset-clear]")?.setAttribute("aria-label", `Clear ${label} weapon set`);
    article?.querySelector("[data-preset-default]")?.setAttribute("aria-label", this.settings.defaultLoadoutPreset === index
      ? `Remove ${label} as default weapon set`
      : `Make ${label} the default weapon set`);
    this.announceLoadout(`Weapon set renamed to ${preset.name}.`);
  }

  toggleDefaultPreset(index) {
    if (!this.settings.loadoutPresets[index]) return;
    if (this.settings.defaultLoadoutPreset === index) this.settings.defaultLoadoutPreset = null;
    else {
      this.settings.defaultLoadoutPreset = index;
      this.settings.loadout = [...this.settings.loadoutPresets[index].weaponIds];
    }
    saveSettings(this.settings);
    this.updateLoadoutUi(`[data-preset-default="${index}"]`);
    this.announceLoadout(this.settings.defaultLoadoutPreset === index
      ? `${this.settings.loadoutPresets[index].name} is now the default and has been loaded.`
      : "Default weapon set cleared.");
  }

  clearPreset(index) {
    if (index < 0 || index >= LOADOUT_PRESET_COUNT) return;
    const preset = this.settings.loadoutPresets[index];
    if (!preset || !globalThis.confirm(`Clear ${preset.name}? This cannot be undone.`)) return;
    this.settings.loadoutPresets[index] = null;
    if (this.settings.defaultLoadoutPreset === index) this.settings.defaultLoadoutPreset = null;
    saveSettings(this.settings);
    this.updateLoadoutUi(`[data-preset-save="${index}"]`);
    this.announceLoadout(`${preset.name} cleared.`);
  }

  updateLoadoutUi(focusSelector = "") {
    for (const button of ui.querySelectorAll("[data-weapon-choice]")) {
      const index = this.settings.loadout.indexOf(button.dataset.weaponChoice);
      button.classList.toggle("selected", index >= 0);
      button.dataset.slot = index >= 0 ? index + 1 : "";
    }
    const order = ui.querySelector("[data-loadout-order]");
    if (order) order.innerHTML = this.loadoutOrderMarkup();
    const presets = ui.querySelector("[data-loadout-presets]");
    if (presets) presets.innerHTML = this.loadoutPresetsMarkup();
    const count = ui.querySelector("[data-loadout-count]");
    if (count) count.textContent = `${this.settings.loadout.length}/5 selected`;
    const launch = ui.querySelector('[data-action="start"]');
    if (launch) launch.disabled = this.settings.loadout.length !== 5;
    if (focusSelector) ui.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  announceLoadout(message) {
    const status = ui.querySelector("[data-loadout-status]");
    if (status) status.textContent = message;
  }

  captureSetupAndStart() {
    if (this.settings.loadout.length !== 5) return;
    this.settings.displayName = ui.querySelector("#display-name")?.value.trim() || "Rookie";
    this.seed = ui.querySelector("#map-seed")?.value.trim().toUpperCase() || "BLAST-01";
    this.botDifficulty = ui.querySelector("#bot-difficulty")?.value || "normal";
    this.settings.botCount = clampBotCount(ui.querySelector("#bot-count")?.value);
    saveSettings(this.settings);
    this.startMatch();
  }

  saveSettingsForm() {
    this.settings.graphics = ui.querySelector('[data-setting="graphics"]').value;
    this.settings.blood = ui.querySelector('[data-setting="blood"]').value;
    this.settings.shake = Number(ui.querySelector('[data-setting="shake"]').value);
    this.settings.volume = Number(ui.querySelector('[data-setting="volume"]').value);
    this.settings.musicVolume = Number(ui.querySelector('[data-setting="musicVolume"]').value);
    this.settings.effectsVolume = Number(ui.querySelector('[data-setting="effectsVolume"]').value);
    this.settings.ambienceVolume = Number(ui.querySelector('[data-setting="ambienceVolume"]').value);
    this.settings.dynamicRange = ui.querySelector('[data-setting="dynamicRange"]').value;
    this.sound.setVolume(this.settings.volume);
    this.sound.setMix({ music: this.settings.musicVolume, effects: this.settings.effectsVolume, ambience: this.settings.ambienceVolume });
    this.sound.setDynamicRange(this.settings.dynamicRange);
    this.settings.reducedMotion = ui.querySelector('[data-setting="reducedMotion"]').checked;
    document.documentElement.classList.toggle("reduce-motion", this.settings.reducedMotion);
    this.renderPipeline.setReducedMotion(this.settings.reducedMotion);
    this.applyGraphicsSettings();
    saveSettings(this.settings);
    this.renderMain();
  }

  queueRematch() {
    this.queueMatchStart(true);
  }

  queueMatchStart(sameSeed = false) {
    sessionStorage.setItem(MATCH_SESSION_KEY, JSON.stringify({
      seed: this.seed, mode: this.mode, botDifficulty: this.botDifficulty,
      botCount: this.settings.botCount, sameSeed, queuedAt: Date.now()
    }));
    this.setMatchLoading(true, this.seed, sameSeed);
    requestAnimationFrame(() => requestAnimationFrame(() => location.reload()));
  }

  setMatchLoading(visible, seed = this.seed, sameSeed = false) {
    if (!matchLoading) return;
    matchLoading.hidden = !visible;
    if (!visible) return;
    matchLoading.querySelector("[data-match-seed]").textContent = String(seed).slice(0, 12);
    matchLoading.querySelector("[data-match-kind]").textContent = sameSeed ? "SAME SEED" : "NEW SESSION";
  }

  resumePendingMatch() {
    const raw = sessionStorage.getItem(MATCH_SESSION_KEY);
    if (!raw) {
      this.setMatchLoading(false);
      return false;
    }
    sessionStorage.removeItem(MATCH_SESSION_KEY);
    try {
      const saved = JSON.parse(raw);
      const queuedAt = Number(saved?.queuedAt);
      const age = Date.now() - queuedAt;
      if (!saved?.seed || !Number.isFinite(queuedAt) || age < 0 || age > 30000) {
        this.setMatchLoading(false);
        return false;
      }
      this.seed = String(saved.seed).slice(0, 12);
      this.mode = ["quick", "private", "training"].includes(saved.mode) ? saved.mode : "training";
      this.botDifficulty = ["rookie", "normal", "veteran"].includes(saved.botDifficulty) ? saved.botDifficulty : "normal";
      this.settings.botCount = clampBotCount(saved.botCount);
      this.freshSessionReady = true;
      this.startMatch();
      this.hideMatchLoadingAfterFrame = true;
      return true;
    } catch {
      this.setMatchLoading(false);
      return false;
    }
  }

  resumeAudioAfterReload() {
    if (this.state !== "play") return false;
    if (!this.sound.resume()) return false;
    this.sound.setVolume(this.settings.volume);
    this.sound.setMix({ music: this.settings.musicVolume, effects: this.settings.effectsVolume, ambience: this.settings.ambienceVolume });
    this.sound.startAmbience(this.world?.theme.id);
    this.sound.setMusicIntensity(.42);
    if (this.matchStartDelay > 0) {
      const countdown = this.sound.startCountdown(this.seed, .42);
      if (countdown) {
        this.audioCountdown = true;
        this.matchStartDelay = countdown.remaining;
        this.countdownBeat = countdown.beatsRemaining;
      }
    } else this.sound.startMusic("combat", this.seed);
    this.awaitingAudioGesture = false;
    return true;
  }

  startMatch() {
    if (!this.freshSessionReady) return this.queueMatchStart(false);
    this.freshSessionReady = false;
    this.clearMatch();
    this.state = "play";
    this.paused = false;
    this.matchTime = 180;
    this.matchStartDelay = 60 / 132 * 8;
    this.countdownBeat = 8;
    this.audioCountdown = false;
    this.awaitingAudioGesture = !this.sound.context;
    this.performanceSample = this.freshPerformanceSample();
    this.combatMusicPulse = 0;
    const fighterCount = 1 + clampBotCount(this.settings.botCount);
    // The full post stack is ideal for normal matches. Sixteen-fighter sessions use
    // the lighter WebGPU bloom profile to preserve effects under maximum material load.
    this.renderPipeline.setHighLoadMode(fighterCount >= 13);
    this.world = new ArenaWorld(this.scene, this.seed);
    this.combatVisuals = new CombatVisuals(this.scene, {
      reducedMotion: this.settings.reducedMotion,
      quality: this.graphics.combatQuality
    });
    const spawns = this.world.spawnPoints();
    const playerLoadout = this.settings.loadout.length === 5 ? this.settings.loadout : DEFAULT_LOADOUT;
    const weaponIds = Object.keys(WEAPONS);
    this.players = [new Fighter(this.scene, { id: "p1", name: this.settings.displayName, ...PLAYER_COLORS[0] }, playerLoadout, spawns[0])];
    this.players[0].aim.set(-spawns[0].x, -3.5, -spawns[0].z).normalize();
    for (let index = 0; index < clampBotCount(this.settings.botCount); index++) {
      const number = String(index + 1).padStart(2, "0");
      const name = this.mode === "quick" ? `Region Bot ${number}` : `Atlas Bot ${number}`;
      const botLoadout = Array.from({ length: 5 }, (_, slot) => weaponIds[(8 + index * 5 + slot) % weaponIds.length]);
      this.players.push(new Fighter(this.scene, { id: `p${index + 2}`, name, ...PLAYER_COLORS[(index + 1) % PLAYER_COLORS.length] }, botLoadout, spawns[index + 1], true));
    }
    this.scores = this.players.map(() => 0);
    this.respawnTimers = this.players.map(() => 0);
    this.cameraYaw = Math.atan2(this.players[0].aim.x, this.players[0].aim.z);
    this.cameraPitch = this.players[0].position.y > 50 ? -.38 : -.08;
    this.cameraFocus.set(0, 0, 0);
    this.updateCamera(1);
    this.renderHud();
    this.sound.startAmbience(this.world.theme.id);
    this.sound.setMusicIntensity(.42);
    const countdown = this.sound.startCountdown(this.seed, .42);
    if (countdown) {
      this.audioCountdown = true;
      this.matchStartDelay = countdown.remaining;
      this.countdownBeat = countdown.beatsRemaining;
    } else this.sound.play("countdown");
    this.sound.setPaused(false);
  }

  renderHud() {
    ui.innerHTML = `
      <div class="hud">
        <section class="combatant left">
          <div><b>${escapeHtml(this.players[0].name)}</b><span data-score="0">0</span></div>
          <div class="health"><i data-health="0"></i></div>
        </section>
        <section class="match-state">
          <small>${escapeHtml(this.world.theme.name)} · ${this.mode.toUpperCase()} · ${escapeHtml(this.seed)}</small>
          <strong data-time>03:00</strong>
          <span>FIRST TO ${this.targetScore}</span>
        </section>
        <section class="combatant right">
          <div><b data-leader-name>${escapeHtml(this.players[0].name)}</b><span data-leader-score>0</span></div>
          <small>${this.players.length} FIGHTERS · ARENA LEADER</small>
        </section>
        <div class="damage-vignette" data-damage-vignette></div>
        <div class="motion-vignette" data-motion-vignette></div>
        <div class="reticle" data-reticle aria-hidden="true"><i></i></div>
        <div class="combat-log" data-combat-log aria-live="polite"></div>
        <div class="weapon-strip">
          ${this.players[0].loadout.map((id, index) => `
            <button data-weapon-slot="${index}" data-category="${WEAPONS[id].category.toLowerCase().replaceAll(" ", "-")}" class="${index === 0 ? "selected" : ""}" style="--weapon:#${WEAPONS[id].color.toString(16).padStart(6, "0")}">
              <span>${index + 1}</span><i aria-hidden="true"></i><b>${WEAPONS[id].name}</b><small data-ammo-slot="${index}"></small>
            </button>`).join("")}
        </div>
        <div class="grapple-readout" data-grapple>GRAPPLE READY · E / RIGHT CLICK</div>
        <div class="perf-readout" data-perf>MEASURING FRAME PACE</div>
        <button class="pause" data-action="pause" aria-label="Pause">Ⅱ</button>
        <div class="scoreboard" data-scoreboard>
          <h2>Deathmatch</h2>
          <div class="score-list">
            ${this.players.map((player, index) => `<p><b>${escapeHtml(player.name)}</b><span data-board-score="${index}">0</span></p>`).join("")}
          </div>
        </div>
        <div class="touch-controls" aria-label="Touch controls">
          <div class="touch-actions">
            <button data-touch="jump">JUMP</button><button data-touch="grapple">HOOK</button>
            <button data-touch="weapon">SWAP</button><button class="fire" data-touch="fire">FIRE</button>
          </div>
        </div>
      </div>`;
    this.hud = {
      root: ui.querySelector(".hud"),
      health: ui.querySelector('[data-health="0"]'),
      score: ui.querySelector('[data-score="0"]'),
      boardScore: [...ui.querySelectorAll("[data-board-score]")],
      leaderName: ui.querySelector("[data-leader-name]"),
      leaderScore: ui.querySelector("[data-leader-score]"),
      time: ui.querySelector("[data-time]"),
      grapple: ui.querySelector("[data-grapple]"),
      performance: ui.querySelector("[data-perf]"),
      scoreboard: ui.querySelector("[data-scoreboard]"),
      reticle: ui.querySelector("[data-reticle]"),
      damageVignette: ui.querySelector("[data-damage-vignette]"),
      motionVignette: ui.querySelector("[data-motion-vignette]"),
      combatLog: ui.querySelector("[data-combat-log]"),
      slots: [...ui.querySelectorAll("[data-weapon-slot]")],
      slotNames: [...ui.querySelectorAll("[data-weapon-slot] b")],
      ammo: [...ui.querySelectorAll("[data-ammo-slot]")]
    };
    this.bindUi();
    this.bindTouch();
  }

  bindTouch() {
    this.touch = {};
    for (const button of ui.querySelectorAll("[data-touch]")) {
      const action = button.dataset.touch;
      const press = (event) => {
        event.preventDefault();
        if (action === "jump" || action === "grapple" || action === "weapon") this.touch[`${action}Tap`] = true;
        else {
          if (action === "fire" && !this.touch.fire) this.touch.fireTap = true;
          this.touch[action] = true;
        }
        button.setPointerCapture?.(event.pointerId);
      };
      const release = (event) => {
        event.preventDefault();
        this.touch[action] = false;
      };
      const cancel = (event) => {
        release(event);
        if (action === "fire") this.touch.fireTap = false;
        else if (action === "jump" || action === "grapple" || action === "weapon") this.touch[`${action}Tap`] = false;
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", cancel);
    }
  }

  togglePause() {
    if (this.state !== "play") return;
    this.paused = !this.paused;
    this.sound.play(this.paused ? "pause" : "resume");
    this.sound.setPaused(this.paused);
    if (this.paused) {
      this.input.releasePointer();
      clearTouchActions(this.touch);
      for (const player of this.players || []) {
        this.sound.updateWeaponLoop(player.id, player.weapon, false);
        this.sound.stopChargeLoop(player.id);
      }
    }
    ui.querySelector(".overlay")?.remove();
    if (!this.paused) return;
    ui.insertAdjacentHTML("beforeend", `
      <div class="overlay">
        <section class="dialog pause-dialog">
          <p>SIMULATION PAUSED</p><h1>Take a breath.</h1>
          <button class="primary" data-action="pause">RESUME</button>
          <button data-action="rematch">RESTART MATCH</button>
          <button data-screen="main">MAIN MENU</button>
        </section>
      </div>`);
    this.bindUi();
  }

  freshPerformanceSample() {
    return { elapsed: 0, frames: 0, windowElapsed: 0, windowFrames: 0, fps: 0, minimum: Infinity, total: 0, samples: 0 };
  }

  audioSpatial(position, local = false, volume = 1, ownerId = "") {
    return {
      position, local, volume, ownerId,
      occluded: Boolean(!local && this.world?.ropeBlocked?.(this.camera.position, position))
    };
  }

  updateAudio(dt) {
    const local = this.players[0];
    if (!local) return;
    this.combatMusicPulse *= Math.exp(-dt * 1.55);
    this.sound.setListener(this.camera.position, this.camera.getWorldDirection(this.listenerDirection));
    this.audioMixTimer -= dt;
    if (this.audioMixTimer <= 0) {
      this.audioMixTimer = .25;
      const speed = clamp(local.velocity.length() / 38, 0, 1);
      const danger = clamp((100 - local.health) / 100, 0, 1);
      const finalMinute = this.matchTime < 60 ? 1 - this.matchTime / 60 : 0;
      let leadingScore = 0;
      let enemyCount = 0;
      let projectileCount = 0;
      let hazardCount = 0;
      for (const score of this.scores) leadingScore = Math.max(leadingScore, score);
      for (const player of this.players) if (player !== local && player.alive && player.position.distanceToSquared(local.position) < 38 ** 2) enemyCount++;
      for (const shot of this.projectiles) if (shot.owner !== local && shot.mesh.position.distanceToSquared(local.position) < 24 ** 2) projectileCount++;
      for (const hazard of this.hazards) if (hazard.mesh.position.distanceToSquared(local.position) < 30 ** 2) hazardCount++;
      const scorePressure = clamp(leadingScore / Math.max(1, this.targetScore), 0, 1);
      const nearbyEnemies = clamp(enemyCount / 4, 0, 1);
      const nearbyProjectiles = clamp(projectileCount / 5, 0, 1);
      const nearbyHazards = clamp(hazardCount / 3, 0, 1);
      this.sound.setMusicIntensity(combatMusicIntensity({
        combatPulse: this.combatMusicPulse, nearbyEnemies, nearbyProjectiles, nearbyHazards,
        healthDanger: danger, speed, finalMinute, scorePressure
      }));
      this.sound.updateAmbience({ danger, speed });
    }
    for (const player of this.players) {
      const localPlayer = player === local;
      const spatial = this.audioSpatial(player.position, localPlayer, localPlayer ? 1 : .34, player.id);
      this.sound.updateFighter(player.id, {
        ...spatial, alive: player.alive, grounded: player.grounded,
        speed: Math.hypot(player.velocity.x, player.velocity.z), verticalSpeed: player.velocity.y,
        reloading: player.reloadTimer > 0, weapon: player.weapon, boosted: player.boosted,
        slowed: player.slowTimer > 0,
        lowAmmo: player.ammo[player.weapon.id] > 0 && player.ammo[player.weapon.id] <= Math.max(1, Math.ceil(player.weapon.ammo * .2))
      });
      this.sound.updateGrappleLoop(player.id, Boolean(player.grapple), {
        ...spatial, tension: player.grapple ? clamp(player.position.distanceTo(player.grapple.anchor) / Math.max(1, player.grapple.ropeLength) - .72, 0, 1) : 0,
        speed: player.velocity.length()
      });
    }
    const audibleHazards = selectNearestAudio(
      this.hazards, local.position, 4, null,
      this.nearestAudioDistances, this.nearestAudioIds, this.audibleHazardIds
    );
    for (const hazard of this.hazards) this.sound.updateHazardLoop(hazard.audioId, hazard.weapon, audibleHazards.has(hazard.audioId), this.audioSpatial(hazard.mesh.position, false, .72, hazard.audioId));
  }

  frame(time) {
    this.timer.update(time);
    const rawDt = Math.min(.25, this.timer.getDelta());
    const dt = Math.min(.033, rawDt);
    if (this.state === "play" && this.input.tapped("Escape")) this.togglePause();
    if (this.state === "play" && !this.paused) this.update(dt);
    this.renderScene();
    if (this.hideMatchLoadingAfterFrame) {
      this.hideMatchLoadingAfterFrame = false;
      this.setMatchLoading(false);
    }
    if (this.state === "play" && !this.paused) this.updatePerformanceSample(rawDt);
    this.input.endFrame();
  }

  update(dt) {
    if (this.awaitingAudioGesture) {
      this.updateAudio(dt);
      this.updateHud();
      return;
    }
    if (this.matchStartDelay > 0 || this.audioCountdown) {
      const countdown = this.audioCountdown ? this.sound.getCountdownState() : null;
      if (countdown) {
        this.matchStartDelay = countdown.remaining;
        this.countdownBeat = countdown.beatsRemaining;
      } else {
        this.matchStartDelay = Math.max(0, this.matchStartDelay - dt);
        const beat = Math.ceil(this.matchStartDelay);
        if (beat > 0 && beat !== this.countdownBeat) {
          this.countdownBeat = beat;
          this.sound.play("countdown");
        }
      }
      this.updateAudio(dt);
      this.updateHud();
      if ((countdown && !countdown.active) || (!countdown && this.matchStartDelay === 0)) {
        if (!countdown) {
          this.sound.play("go");
          this.sound.startMusic("combat", this.seed);
        }
        this.audioCountdown = false;
        this.matchStartDelay = 0;
      }
      return;
    }
    this.matchTime = Math.max(0, this.matchTime - dt);
    this.world.update(dt, this.players);
    this.handleWeaponSwitch();
    this.updateHuman(dt);
    for (let index = 1; index < this.players.length; index++) this.updateBot(this.players[index], dt);
    for (const player of this.players) this.updateBurst(player, dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateDecoys(dt);
    this.updateEffects(dt);
    this.combatVisuals?.update(dt);
    this.updateRespawns(dt);
    this.updateAudio(dt);
    this.updateHud();
    if (this.matchTime <= 0 || Math.max(...this.scores) >= this.targetScore) this.finishMatch();
  }

  handleWeaponSwitch() {
    const player = this.players[0];
    const previousSlot = player.slotIndex;
    for (let index = 0; index < 5; index++) if (this.input.tapped(`Digit${index + 1}`)) player.switchSlot(index);
    if (this.input.tapped("KeyQ") || this.touch.weaponTap) player.switchSlot((player.slotIndex + 1) % player.loadout.length);
    if (player.slotIndex !== previousSlot) {
      this.sound.stopWeaponLoop(player.id);
      this.sound.stopChargeLoop(player.id);
      this.sound.play("weaponSelect", player.weapon, { local: true });
    }
    this.touch.weaponTap = false;
  }

  updateHuman(dt) {
    const player = this.players[0];
    const look = this.input.consumeLook();
    ({ yaw: this.cameraYaw, pitch: this.cameraPitch } = updateOrbit(this.cameraYaw, this.cameraPitch, look.x, look.y));
    this.updateCamera(dt);
    if (!player.alive) {
      this.sound.updateWeaponLoop(player.id, player.weapon, false);
      this.sound.stopChargeLoop(player.id);
      return;
    }
    let move = cameraRelative(directionFromKeys(this.input), this.cameraYaw);
    move.add(cameraRelative(directionFromTouch(this.input.touchDirection()), this.cameraYaw));
    if (move.lengthSq() > 1) move.normalize();
    this.aimTargets.length = 0;
    this.aimTargets.push(...this.players, ...this.decoys);
    const aim = reticleAim(player, this.camera.position, this.camera.getWorldDirection(this.aimDirection), this.world, this.aimTargets);
    const jump = this.input.tapped("Space") || this.touch.jumpTap;
    if (jump && player.grounded) this.sound.play("jump", null, { local: true });
    player.update(dt, move, aim, { jump }, this.world);
    this.touch.jumpTap = false;
    if (this.input.tapped("KeyE") || this.input.tapped("MouseRight") || this.touch.grappleTap) this.toggleGrapple(player);
    this.touch.grappleTap = false;
    this.updateGrapple(player, dt);
    if (this.input.tapped("KeyR") && !player.reload()) this.sound.play("uiInvalid");
    const fireHeld = this.input.mouse.left || this.touch.fire;
    const fireTapped = this.input.tapped("MouseLeft") || this.touch.fireTap;
    if (player.weapon.chargeTime) this.updateCharge(player, fireHeld, dt);
    else {
      this.cancelCharge(player);
      if (fireHeld) this.tryFire(player, fireTapped);
    }
    this.sound.updateWeaponLoop(player.id, player.weapon, fireHeld && player.weapon.maintained && player.ammo[player.weapon.id] > 0, this.audioSpatial(player.position, true, 1, player.id));
    this.touch.fireTap = false;
  }

  updateBot(bot, dt) {
    if (!bot.alive) {
      this.sound.updateWeaponLoop(bot.id, bot.weapon, false);
      this.sound.stopChargeLoop(bot.id);
      return;
    }
    const human = this.players[0];
    let distractingDecoy = null;
    let distractingDistance = 30 ** 2;
    for (const decoy of this.decoys) {
      if (!decoy.alive || decoy.owner === bot) continue;
      const distanceSq = bot.position.distanceToSquared(decoy.position);
      if (distanceSq < distractingDistance) {
        distractingDistance = distanceSq;
        distractingDecoy = decoy;
      }
    }
    let target = distractingDecoy;
    if (!target && human?.alive && bot.position.distanceToSquared(human.position) < 28 ** 2) target = human;
    if (!target) {
      let closest = Infinity;
      const playerCount = this.players.length;
      const total = playerCount + this.decoys.length;
      for (let index = 0; index < total; index++) {
        const candidate = index < playerCount ? this.players[index] : this.decoys[index - playerCount];
        if (candidate === bot || !candidate.alive || candidate.owner === bot) continue;
        const distanceSq = bot.position.distanceToSquared(candidate.position);
        if (distanceSq < closest) {
          closest = distanceSq;
          target = candidate;
        }
      }
    }
    if (!target) {
      this.sound.updateWeaponLoop(bot.id, bot.weapon, false);
      this.sound.stopChargeLoop(bot.id);
      return;
    }
    const origin = bot.botOrigin.copy(bot.position);
    origin.y += 1.25;
    const targetPoint = bot.botTarget.copy(target.position);
    targetPoint.y += 1.05;
    const aimOffset = bot.botAimOffset.copy(targetPoint).sub(origin);
    const distance = aimOffset.length();
    const visible = !this.world.ropeBlocked(origin, targetPoint);
    bot.botThink -= dt;
    if (bot.botThink <= 0) {
      bot.botThink = this.botDifficulty === "veteran" ? .25 : this.botDifficulty === "rookie" ? .75 : .48;
      bot.botDodge *= Math.random() < .45 ? -1 : 1;
      const previousSlot = bot.slotIndex;
      bot.switchSlot(chooseBotSlot(bot.loadout, distance));
      if (bot.slotIndex !== previousSlot) this.sound.play("equip", bot.weapon, this.audioSpatial(bot.position, false, .28, bot.id));
    }
    const forward = bot.botForward.copy(aimOffset);
    if (forward.lengthSq()) forward.normalize();
    const moveForward = bot.botMoveForward.copy(forward).setY(0);
    if (moveForward.lengthSq()) moveForward.normalize();
    const move = bot.botMove.set(-moveForward.z, 0, moveForward.x).multiplyScalar(bot.botDodge * .62);
    const preferred = botWeaponPolicy(bot.weapon).preferred;
    if (distance > preferred + 3) move.add(moveForward);
    if (distance < preferred - 3) move.addScaledVector(moveForward, -1);
    if (bot.grounded && move.lengthSq() > .01) {
      const probe = bot.botProbe.copy(bot.position).addScaledVector(move, 2.8 / Math.sqrt(move.lengthSq()));
      if (this.world.surfaceHeightAt(probe, bot.position.y + 2) < bot.position.y - 1.5) move.multiplyScalar(-.75);
    }
    bot.update(dt, move, forward, { jump: Math.random() < dt * .45 }, this.world);
    if (!bot.grapple && distance > 22 && Math.random() < dt * .35) this.toggleGrapple(bot);
    if (bot.grapple && (distance < 11 || Math.random() < dt * .18)) this.releaseGrapple(bot, true);
    this.updateGrapple(bot, dt);
    const difficulty = this.botDifficulty === "veteran" ? 1.45 : this.botDifficulty === "rookie" ? .58 : 1;
    let wantsFire = Math.random() < botFireChance(distance, visible, bot.weapon) * difficulty;
    if (bot.weapon.type === "wall") {
      const wallNearby = this.world.temporaryWalls.some(({ obstacle }) => Math.hypot(obstacle.x - bot.position.x, obstacle.z - bot.position.z) < 9);
      wantsFire = shouldBotPlaceWall(bot.weapon, {
        distance, visible, healthFraction: bot.health / 100, underPressure: bot.hitTimer > .12,
        wallNearby, ammo: bot.ammo[bot.weapon.id]
      });
      if (wantsFire) {
        const placement = bot.botProbe.copy(bot.position).addScaledVector(moveForward, 4.5);
        placement.y = this.world.surfaceHeightAt(placement, bot.position.y + 2) + .55;
        bot.aim.copy(placement.sub(origin).normalize());
      }
    }
    if (bot.weapon.type === "remote") {
      const armedChargeDistances = bot.botChargeDistances;
      armedChargeDistances.length = 0;
      for (const shot of this.projectiles) {
        if (shot.owner === bot && shot.weapon.id === bot.weapon.id && shot.stuck) armedChargeDistances.push(shot.mesh.position.distanceTo(target.position));
      }
      const action = botRemoteChargeAction(bot.weapon, {
        targetDistance: distance, visible,
        armedChargeDistances,
        ammo: bot.ammo[bot.weapon.id], maxCharges: bot.weapon.maxCharges
      });
      if (action === "detonate") this.tryFire(bot, true);
      else if (action === "place" && wantsFire) this.tryFire(bot, false);
      const listener = this.players[0];
      const distanceScale = Math.max(.12, 1 - bot.position.distanceTo(listener.position) / 110) * .36;
      this.sound.updateWeaponLoop(bot.id, bot.weapon, false, this.audioSpatial(bot.position, false, distanceScale, bot.id));
      return;
    }
    if (bot.weapon.chargeTime) {
      if (bot.chargingWeaponId || wantsFire) this.updateCharge(bot, true, dt);
      if (bot.chargeLevel >= 1) this.releaseCharge(bot);
    } else {
      this.cancelCharge(bot);
      if (wantsFire) this.tryFire(bot, true);
    }
    const listener = this.players[0];
    const distanceScale = Math.max(.12, 1 - bot.position.distanceTo(listener.position) / 110) * .36;
    this.sound.updateWeaponLoop(bot.id, bot.weapon, bot.weapon.maintained && bot.attackTimer > 0, this.audioSpatial(bot.position, false, distanceScale, bot.id));
  }

  mouseAim(target = new THREE.Vector3()) {
    const horizontal = Math.cos(this.cameraPitch);
    return target.set(
      Math.sin(this.cameraYaw) * horizontal,
      Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * horizontal
    );
  }

  toggleGrapple(player) {
    if (!player.alive) return;
    if (player.grapple) return this.releaseGrapple(player, true);
    const start = player.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const sightline = grappleSightline(player, this.camera);
    const anchor = this.world.grapplePoint(sightline.origin, sightline.direction);
    const local = player === this.players[0];
    if (!anchor) {
      this.sound.play("grappleMiss", null, this.audioSpatial(player.position, local, local ? 1 : .3, player.id));
      return;
    }
    this.sound.play("grappleFire", null, this.audioSpatial(start, local, local ? 1 : .34, player.id));
    const geometry = new LineGeometry();
    geometry.setPositions([start.x, start.y, start.z, anchor.x, anchor.y, anchor.z]);
    const ropeMaterial = new THREE.Line2NodeMaterial({
      color: new THREE.Color(player.accent).multiplyScalar(1.65),
      lineWidth: player.isBot ? 1.55 : 2.35,
      transparent: true,
      opacity: player.isBot ? .64 : .92,
      depthWrite: false,
      toneMapped: false,
      alphaToCoverage: true
    });
    const line = new Line2(geometry, ropeMaterial);
    line.frustumCulled = false;
    line.computeLineDistances();
    this.scene.add(line);
    player.grapple = { anchor, line, wraps: [], ropeLength: Math.max(5, start.distanceTo(anchor) * .92), pullSpeed: 0 };
    const direction = anchor.clone().sub(start).normalize();
    const approachSpeed = player.velocity.dot(direction);
    player.grapple.pullSpeed = Math.max(0, approachSpeed);
    this.sound.play("grappleAttach", null, this.audioSpatial(anchor, local, local ? 1 : .42, player.id));
  }

  updateGrapple(player, dt) {
    if (!player.grapple || !player.alive) return;
    const previousWrapCount = player.grapple.wraps.length;
    const chest = player.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const wraps = [];
    let routeStart = chest;
    for (let index = 0; index < 8; index++) {
      const wrap = this.world.ropeWrapPoint(routeStart, player.grapple.anchor);
      if (!wrap) break;
      wraps.push(wrap);
      routeStart = wrap;
    }
    player.grapple.wraps = wraps;
    if (wraps.length !== previousWrapCount) this.sound.play("grappleWrap", null, this.audioSpatial(player.position, player === this.players[0], player === this.players[0] ? .8 : .25, player.id));
    applyGrapplePhysics(player, dt);
    const ropePoints = [chest, ...wraps, player.grapple.anchor];
    const ropePositions = [];
    for (const point of ropePoints) ropePositions.push(point.x, point.y, point.z);
    player.grapple.line.geometry.setPositions(ropePositions);
    player.grapple.line.computeLineDistances();
  }

  releaseGrapple(player, boost = false, silent = false) {
    if (!player?.grapple) return;
    const local = player === this.players[0];
    const position = player.position.clone();
    this.removeObject(player.grapple.line);
    player.grapple = null;
    if (boost && player.alive) boostGrappleRelease(player);
    this.sound.updateGrappleLoop(player.id, false);
    if (!silent) this.sound.play("grappleRelease", null, this.audioSpatial(position, local, local ? 1 : .3, player.id));
  }

  tryFire(player, triggerTap = false) {
    const weapon = player.weapon;
    const fireMode = weaponFireMode(weapon);
    if (!player.alive || player.attackTimer > 0 || player.reloadTimer > 0) return;
    if (weapon.type === "remote") {
      const charges = this.projectiles
        .map((shot, index) => ({ shot, index }))
        .filter(({ shot }) => shot.owner === player && shot.weapon.id === weapon.id && shot.stuck);
      if (triggerTap && charges.length) {
        player.attackTimer = weapon.cooldown;
        this.combatMusicPulse = Math.max(this.combatMusicPulse, player === this.players[0] ? .72 : .4);
        for (const { shot, index } of charges.reverse()) {
          this.explode(shot);
          this.removeProjectile(index);
        }
        return;
      }
    }
    if (player.ammo[weapon.id] <= 0) {
      this.sound.play("empty", weapon, this.audioSpatial(player.position, player === this.players[0], 1, player.id));
      player.reload();
      return;
    }
    if (fireMode === "burst") return this.beginBurst(player, weapon);
    player.attackTimer = weapon.cooldown;
    player.ammo[weapon.id] -= 1;
    this.combatMusicPulse = Math.max(this.combatMusicPulse, player === this.players[0] ? .52 : player.position.distanceToSquared(this.players[0].position) < 42 ** 2 ? .32 : this.combatMusicPulse);
    player.recoil();
    const listener = this.players[0];
    const distanceScale = player === listener ? 1 : Math.max(.18, 1 - player.position.distanceTo(listener.position) / 110) * .42;
    this.sound.playWeapon(weapon, this.audioSpatial(player.position, player === listener, distanceScale, player.id));
    this.combatVisuals?.muzzle(player, weapon, player.aim);
    if (fireMode === "spread") {
      for (let i = 0; i < weapon.pellets; i++) this.spawnProjectile(player, weapon, aimWithSpread(player.aim, weapon.spread));
      return;
    }
    if (fireMode === "mine") return this.spawnMine(player, weapon);
    if (fireMode === "beam") return this.fireBeam(player, weapon);
    if (fireMode === "chain") return this.fireChain(player, weapon);
    if (fireMode === "flame") return this.fireFlame(player, weapon);
    if (fireMode === "melee") return this.fireMelee(player, weapon);
    if (fireMode === "hitscan") return this.fireHitscan(player, weapon, aimWithSpread(player.aim, weapon.spread));
    this.spawnProjectile(player, weapon, aimWithSpread(player.aim, weapon.spread));
  }

  beginBurst(player, weapon) {
    const rounds = Math.min(weapon.burstCount, player.ammo[weapon.id]);
    if (!rounds) return player.reload();
    player.attackTimer = weapon.cooldown;
    player.ammo[weapon.id] -= rounds;
    this.combatMusicPulse = Math.max(this.combatMusicPulse, player === this.players[0] ? .56 : player.position.distanceToSquared(this.players[0].position) < 42 ** 2 ? .34 : this.combatMusicPulse);
    this.fireBurstRound(player, weapon);
    player.pendingBurst = rounds > 1 ? { weaponId: weapon.id, remaining: rounds - 1, timer: weapon.burstInterval } : null;
  }

  updateBurst(player, dt) {
    const burst = player.pendingBurst;
    if (!burst || !player.alive || player.weapon.id !== burst.weaponId) return;
    burst.timer -= dt;
    while (burst.remaining > 0 && burst.timer <= 0) {
      this.fireBurstRound(player, WEAPONS[burst.weaponId]);
      burst.remaining -= 1;
      burst.timer += WEAPONS[burst.weaponId].burstInterval;
    }
    if (burst.remaining <= 0) player.pendingBurst = null;
  }

  fireBurstRound(player, weapon) {
    player.recoil(weapon.recoil * .46);
    const listener = this.players[0];
    const distanceScale = player === listener ? 1 : Math.max(.18, 1 - player.position.distanceTo(listener.position) / 110) * .42;
    this.sound.playWeapon(weapon, this.audioSpatial(player.position, player === listener, distanceScale, player.id));
    const direction = aimWithSpread(player.aim, weapon.spread);
    this.combatVisuals?.muzzle(player, weapon, direction);
    this.fireHitscan(player, weapon, direction);
  }

  updateCharge(player, wantsFire, dt) {
    const weapon = player.weapon;
    if (!weapon.chargeTime || !player.alive) return this.cancelCharge(player);
    if (!wantsFire) return this.releaseCharge(player);
    if (player.attackTimer > 0 || player.reloadTimer > 0) return;
    if (player.ammo[weapon.id] <= 0) return player.reload();
    if (player.chargingWeaponId !== weapon.id) {
      player.chargingWeaponId = weapon.id;
      player.chargeTimer = 0;
      this.sound.play("power", weapon, this.audioSpatial(player.position, player === this.players[0], player === this.players[0] ? 1 : .35, player.id));
    }
    player.chargeTimer = Math.min(weapon.chargeTime, player.chargeTimer + dt);
    player.chargeLevel = player.chargeTimer / weapon.chargeTime;
    const listener = this.players[0];
    const distanceScale = player === listener ? 1 : Math.max(.15, 1 - player.position.distanceTo(listener.position) / 110) * .42;
    this.sound.updateChargeLoop(player.id, weapon, player.chargeLevel, this.audioSpatial(player.position, player === listener, distanceScale, player.id));
  }

  releaseCharge(player) {
    const weapon = WEAPONS[player.chargingWeaponId];
    if (!weapon) return;
    const ratio = clamp(player.chargeTimer / weapon.chargeTime, 0, 1);
    this.cancelCharge(player);
    if (ratio < weapon.minCharge || !player.alive || player.weapon.id !== weapon.id || player.attackTimer > 0 || player.reloadTimer > 0) return;
    player.attackTimer = weapon.cooldown;
    player.ammo[weapon.id] -= 1;
    const chargedWeapon = { ...weapon, damage: weapon.damage * (.35 + ratio * .65), recoil: weapon.recoil * (.45 + ratio * .55) };
    player.recoil(chargedWeapon.recoil);
    this.sound.playWeapon(chargedWeapon, this.audioSpatial(player.position, player === this.players[0], player === this.players[0] ? 1 : .4, player.id));
    this.combatVisuals?.muzzle(player, chargedWeapon, player.aim);
    this.fireHitscan(player, chargedWeapon, aimWithSpread(player.aim, weapon.spread));
  }

  cancelCharge(player) {
    this.sound.stopChargeLoop(player.id);
    player.chargeTimer = 0;
    player.chargeLevel = 0;
    player.chargingWeaponId = null;
  }

  spawnProjectile(player, weapon, direction, position = null) {
    if (weapon.type === "remote") {
      this.trimRemoteCharges(player, weapon, weapon.maxCharges - 1, true);
    }
    const radius = weapon.projectileRadius ?? (weapon.type === "rocket" ? .25 : weapon.type === "plasma" ? .42 : weapon.type === "grenade" ? .28 : .11);
    const mesh = this.combatVisuals.createProjectile(player, weapon, radius);
    mesh.position.copy(position || player.forwardPoint(PROJECTILE_SPAWN_OFFSET));
    if (weapon.type === "rail") mesh.lookAt(mesh.position.clone().add(direction));
    const velocity = direction.clone().multiplyScalar(weapon.projectileSpeed);
    if (weapon.arcLift) velocity.y += weapon.arcLift;
    if (!mesh.userData.combatVisual?.instancedFireball) this.scene.add(mesh);
    const shot = {
      audioId: `projectile-${player.id}-${weapon.id}-${performance.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      mesh, owner: player, weapon, velocity, radius,
      life: projectileLifetime(weapon),
      age: 0, bounces: 0, hitTargets: new Set(),
      previousPosition: new THREE.Vector3(),
      scratchPosition: new THREE.Vector3(),
      sourceSlot: player.slotIndex,
      firedDirection: direction.clone(),
      remainingPenetration: weapon.penetration || 0,
      remainingTerrainPenetration: weapon.terrainPenetration || 0,
      remote: weapon.type === "remote"
    };
    if (mesh.userData.combatVisual?.instancedFireball) mesh.userData.projectileVelocity = velocity;
    if (weapon.presentationPayload === "mortar") {
      const landing = mesh.position.clone();
      const predictedVelocity = velocity.clone();
      const step = .055;
      for (let time = 0; time < weapon.fuse; time += step) {
        const previous = landing.clone();
        predictedVelocity.y -= weapon.gravity * step;
        landing.addScaledVector(predictedVelocity, step);
        if (this.world.projectileHit(landing, radius)) {
          landing.copy(previous);
          break;
        }
      }
      landing.y = this.world.surfaceHeightAt(landing, landing.y + 2) + .06;
      const telegraph = new THREE.Mesh(
        new THREE.RingGeometry(.55, 1.05, 28),
        new THREE.MeshBasicMaterial({ color: weapon.color, transparent: true, opacity: .56, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
      );
      telegraph.rotation.x = -Math.PI / 2;
      telegraph.position.copy(landing);
      telegraph.renderOrder = 6;
      this.scene.add(telegraph);
      shot.telegraph = telegraph;
    }
    this.projectiles.push(shot);
  }

  hitscanTargets(player, start, direction, distance) {
    const ray = new THREE.Ray(start, direction);
    const hit = new THREE.Vector3();
    return [...this.players, ...this.decoys]
      .filter((target) => target !== player && target.alive)
      .map((target) => {
        let nearest = Infinity;
        const samples = target.isDecoy ? [[1.05, target.radius]] : [[.55, target.radius * .72], [1.2, target.radius], [2.08, target.radius * .72]];
        for (const [height, radius] of samples) {
          const sphere = new THREE.Sphere(target.position.clone().add(new THREE.Vector3(0, height, 0)), radius);
          if (ray.intersectSphere(sphere, hit)) nearest = Math.min(nearest, start.distanceTo(hit));
        }
        return { target, distance: nearest };
      })
      .filter((entry) => entry.distance > .02 && entry.distance < distance)
      .sort((a, b) => a.distance - b.distance);
  }

  fireHitscan(player, weapon, direction) {
    const start = player.muzzlePoint(new THREE.Vector3());
    const aim = direction.clone().normalize();
    const wall = this.world.grapplePoint(start, aim);
    const wallDistance = wall ? start.distanceTo(wall) : 1000;
    const hits = this.hitscanTargets(player, start, aim, wallDistance).slice(0, (weapon.penetration || 0) + 1);
    for (const { target } of hits) {
      this.damageTarget(target, weapon.damage, aim.clone().multiplyScalar(weapon.recoil * 1.7), player, weapon);
    }
    const end = hits.length && !weapon.penetration
      ? start.clone().addScaledVector(aim, hits[0].distance)
      : wall || start.clone().addScaledVector(aim, 1000);
    this.spawnTracer(start, end, weapon, player, weapon.type === "rail" ? .16 : .105, weapon.type === "rail" ? .095 : .045);
    if (wall && !hits.length) {
      this.combatVisuals?.impact(wall, weapon, player, { size: weapon.type === "rail" ? 1.25 : .72, normal: aim.clone().negate() });
      this.sound.playImpact(weapon, this.audioSpatial(wall, false, .72, player.id), 0, "wall");
    }
  }

  fireBeam(player, weapon) {
    const start = player.forwardPoint(1.05);
    const direction = aimWithSpread(player.aim, weapon.spread).normalize();
    let cursor = start.clone();
    let wall = this.world.grapplePoint(cursor, direction);
    let end = wall || start.clone().addScaledVector(direction, 1000);
    let terrainPasses = weapon.terrainRadius ? weapon.penetration || 0 : 0;
    while (wall && terrainPasses > 0 && this.world.destroy(wall, weapon.terrainRadius) > 0) {
      this.sound.playImpact(weapon, this.audioSpatial(wall, false, .64, player.id), 0, "wall");
      cursor = wall.clone().addScaledVector(direction, Math.max(.8, weapon.terrainRadius * .35));
      wall = this.world.grapplePoint(cursor, direction);
      end = wall || start.clone().addScaledVector(direction, 1000);
      terrainPasses -= 1;
    }
    const distance = start.distanceTo(end);
    const targets = this.hitscanTargets(player, start, direction, distance).slice(0, (weapon.penetration || 0) + 1);
    for (const { target } of targets) {
      const push = weapon.beamPull
        ? player.position.clone().sub(target.position).normalize().multiplyScalar(weapon.beamPull)
        : direction.clone().multiplyScalar(weapon.recoil * 1.7);
      this.damageTarget(target, weapon.damage, push, player, weapon);
    }
    if (weapon.terrainRadius && wall && !weapon.penetration) this.world.destroy(wall, weapon.terrainRadius);
    this.spawnTracer(start, end, weapon, player, .13);
    if (wall && !targets.length) this.sound.playImpact(weapon, this.audioSpatial(wall, false, .72, player.id), 0, "wall");
  }

  fireChain(player, weapon) {
    const origin = player.forwardPoint(.9);
    const allTargets = [...this.players, ...this.decoys]
      .filter((target) => target !== player && target.alive);
    const candidates = allTargets
      .filter((target) => {
        const end = target.position.clone().add(new THREE.Vector3(0, 1.05, 0));
        const offset = end.clone().sub(origin);
        return offset.length() <= weapon.reach && offset.normalize().dot(player.aim) > .45 && !this.world.ropeBlocked(origin, end);
      });
    let from = origin;
    const hitTargets = new Set();
    for (let jump = 0; jump < weapon.chains; jump++) {
      let remaining = (jump === 0 ? candidates : allTargets).filter((target) => {
        if (hitTargets.has(target)) return false;
        const point = target.position.clone().add(new THREE.Vector3(0, 1.05, 0));
        return (jump === 0 || point.distanceTo(from) <= 14) && !this.world.ropeBlocked(from, point);
      });
      if (!remaining.length) break;
      remaining.sort((a, b) => a.position.distanceToSquared(from) - b.position.distanceToSquared(from));
      const target = remaining.shift();
      if (jump > 0 && target.position.distanceTo(from) > 14) break;
      const end = target.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      this.spawnTracer(from, end, weapon, player, .18);
      this.damageTarget(target, Math.ceil(weapon.damage * Math.pow(.72, jump)), target.position.clone().sub(from).normalize().multiplyScalar(weapon.recoil * 1.5), player, weapon);
      hitTargets.add(target);
      from = end;
    }
    if (!candidates.length) this.spawnTracer(origin, origin.clone().addScaledVector(player.aim, 8), weapon, player, .1);
  }

  fireFlame(player, weapon) {
    const origin = player.muzzlePoint(new THREE.Vector3());
    const direction = player.aim.clone().normalize();
    const surface = this.world.grapplePoint(origin, direction);
    const visibleReach = Math.min(weapon.reach, surface ? origin.distanceTo(surface) : weapon.reach);
    this.combatVisuals?.flameStream(origin, direction, weapon, player, visibleReach);

    for (const target of [...this.players, ...this.decoys]) {
      if (target === player || !target.alive) continue;
      const targetPoint = target.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      const factor = flameConeFactor(origin, direction, targetPoint, target.radius, weapon.reach, weapon.coneAngle);
      if (factor <= 0 || this.world.ropeBlocked(origin, targetPoint)) continue;
      const push = direction.clone().multiplyScalar(weapon.recoil * 1.7);
      this.damageTarget(target, weapon.damage * factor, push, player, weapon);
    }
  }

  fireMelee(player, weapon) {
    const origin = player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
    const end = origin.clone().addScaledVector(player.aim, weapon.reach);
    for (const target of [...this.players, ...this.decoys]) {
      if (target === player || !target.alive) continue;
      const targetPoint = target.position.clone().add(new THREE.Vector3(0, 1, 0));
      const offset = targetPoint.clone().sub(origin);
      if (offset.length() > weapon.reach + target.radius || offset.normalize().dot(player.aim) < 1 - weapon.arc) continue;
      if (this.world.ropeBlocked(origin, targetPoint)) continue;
      const damage = weapon.executeThreshold && !target.isDecoy && target.health <= weapon.executeThreshold ? target.health : weapon.damage;
      this.damageTarget(target, damage, player.aim.clone().multiplyScalar(weapon.recoil * 1.8).setY(weapon.recoil * .45), player, weapon);
    }
    this.spawnTracer(origin, end, weapon, player, .12, Math.max(.12, weapon.arc * .35));
  }

  spawnTracer(start, end, weapon, owner, life = .15, width = .055) {
    this.combatVisuals?.tracer(start, end, weapon, owner, { life, width });
  }

  spawnMine(player, weapon) {
    const mesh = this.combatVisuals.createProjectile(player, weapon, .35, { mine: true });
    const placement = player.forwardPoint(1.3);
    placement.y = this.world.surfaceHeightAt(placement, player.position.y + 1.5) + .12;
    mesh.position.copy(placement);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, owner: player, weapon, velocity: new THREE.Vector3(), radius: .35,
      life: projectileLifetime(weapon), age: 0, mine: true,
      previousPosition: new THREE.Vector3(), scratchPosition: new THREE.Vector3()
    });
    this.sound.play("arm", weapon, this.audioSpatial(placement, player === this.players[0], .8, player.id));
  }

  updateProjectiles(dt) {
    const listener = this.players[0];
    const audibleProjectiles = selectNearestAudio(
      this.projectiles, listener.position, 6, projectileNeedsLoop,
      this.nearestAudioDistances, this.nearestAudioIds, this.audibleProjectileIds
    );
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const shot = this.projectiles[index];
      this.sound.updateProjectileLoop(shot.audioId, shot.weapon, audibleProjectiles.has(shot.audioId), {
        ...this.audioSpatial(shot.mesh.position, false, .72, shot.owner.id), speed: shot.velocity.length()
      });
      shot.age += dt;
      shot.life -= dt;
      const explosive = Boolean(shot.weapon.radius);
      if (shot.telegraph) {
        const pulse = 1 + Math.sin(shot.age * 10) * .16;
        shot.telegraph.scale.setScalar(pulse);
        shot.telegraph.rotation.z += dt * 1.4;
      }

      if (shot.mine) {
        shot.mesh.rotation.y += dt * 2;
        const target = this.findProjectileTarget(shot, true);
        if (target && shot.age > .45) shot.life = 0;
      } else if (!shot.stuck) {
        if (shot.weapon.returning && shot.age >= shot.weapon.returning) {
          const home = shot.scratchPosition.copy(shot.owner.position);
          home.y += 1.2;
          if (shot.mesh.position.distanceTo(home) < 1.1) {
            this.removeProjectile(index);
            continue;
          }
          shot.velocity.lerp(home.sub(shot.mesh.position).normalize().multiplyScalar(shot.weapon.projectileSpeed), Math.min(1, dt * 6));
        }
        if (shot.weapon.gravity) shot.velocity.y -= shot.weapon.gravity * dt;
        const steps = projectileStepCount(shot.velocity.length(), dt, shot.radius);
        let removed = false;
        for (let step = 0; step < steps; step++) {
          const previous = shot.previousPosition.copy(shot.mesh.position);
          shot.mesh.position.addScaledVector(shot.velocity, dt / steps);
          if (shot.weapon.returning) shot.mesh.rotation.y += dt * 18 / steps;
          const worldHit = this.world.projectileHit(shot.mesh.position, shot.radius);
          const target = !worldHit && this.findProjectileTarget(shot);
          if (target) {
            if (shot.weapon.type === "wall") {
              const placement = previous.clone().addScaledVector(shot.velocity.clone().normalize(), -2);
              this.world.addTemporaryWall(placement, shot.velocity, shot.weapon.color, shot.weapon.wallDuration);
              this.sound.play("construct", shot.weapon, this.audioSpatial(placement, false, .8, shot.owner.id));
              this.removeProjectile(index);
            } else if (shot.weapon.type === "decoy") {
              this.spawnDecoy(previous, shot.owner, shot.weapon);
              this.sound.play("construct", shot.weapon, this.audioSpatial(previous, false, .75, shot.owner.id));
              this.removeProjectile(index);
            } else if (shot.weapon.sticky || shot.remote) {
              shot.mesh.position.copy(target.position);
              shot.mesh.position.y += 1.05;
              shot.velocity.set(0, 0, 0);
              shot.stuck = true;
              shot.attachedTarget = target;
              this.combatVisuals?.impact(shot.mesh.position, shot.weapon, shot.owner, { size: .72 });
              this.sound.play("stick", shot.weapon, this.audioSpatial(shot.mesh.position, false, .82, shot.owner.id));
              this.sound.play("arm", shot.weapon, this.audioSpatial(shot.mesh.position, false, .48, shot.owner.id));
            } else if (explosive) {
              this.finishProjectile(index, shot);
            } else {
              this.damageTarget(target, shot.weapon.damage, shot.velocity.clone().normalize().multiplyScalar(shot.weapon.recoil * 1.7), shot.owner, shot.weapon, {
                point: shot.mesh.position.clone(), direction: shot.velocity.clone(), sourceSlot: shot.sourceSlot
              });
              shot.hitTargets.add(target.id);
              if (shot.remainingPenetration > 0) {
                shot.remainingPenetration -= 1;
                continue;
              }
              this.removeProjectile(index);
            }
            removed = true;
            break;
          }
          if (worldHit) {
            if (shot.weapon.type === "wall") {
              this.world.addTemporaryWall(previous, shot.velocity, shot.weapon.color, shot.weapon.wallDuration);
              this.sound.play("construct", shot.weapon, this.audioSpatial(previous, false, .8, shot.owner.id));
              this.removeProjectile(index);
              removed = true;
            } else if (shot.weapon.type === "decoy") {
              this.spawnDecoy(previous, shot.owner, shot.weapon);
              this.sound.play("construct", shot.weapon, this.audioSpatial(previous, false, .75, shot.owner.id));
              this.removeProjectile(index);
              removed = true;
            } else if (shot.weapon.effect === "teleport") {
              this.teleportOwner(shot.owner, previous, shot.velocity);
              this.sound.play("teleport", shot.weapon, this.audioSpatial(previous, false, .9, shot.owner.id));
              this.removeProjectile(index);
              removed = true;
            } else if (shot.remainingTerrainPenetration > 0 && this.world.destroy(shot.mesh.position, shot.weapon.terrainRadius || 2)) {
              shot.remainingTerrainPenetration -= 1;
              shot.mesh.position.copy(previous).addScaledVector(shot.velocity.clone().normalize(), shot.radius * 3);
            } else if (shot.weapon.sticky || shot.remote) {
              shot.mesh.position.copy(previous);
              shot.velocity.set(0, 0, 0);
              shot.stuck = true;
              this.combatVisuals?.impact(previous, shot.weapon, shot.owner, { size: .72 });
              this.sound.play("stick", shot.weapon, this.audioSpatial(previous, false, .82, shot.owner.id));
              this.sound.play("arm", shot.weapon, this.audioSpatial(previous, false, .48, shot.owner.id));
              break;
            } else if (shot.bounces < (shot.weapon.bounces || 0) && shot.life > .15) {
              shot.bounces += 1;
              this.bounceProjectile(shot, previous);
              break;
            } else {
              this.finishProjectile(index, shot);
              removed = true;
            }
            break;
          }
        }
        if (removed) continue;
      } else if (shot.attachedTarget?.alive) {
        shot.mesh.position.copy(shot.attachedTarget.position);
        shot.mesh.position.y += 1.05;
      }
      this.combatVisuals?.updateProjectile(shot, dt);
      if (shot.life <= 0) {
        this.finishProjectile(index, shot);
      }
    }
  }

  findProjectileTarget(shot, mine = false) {
    const playerCount = this.players.length;
    const total = playerCount + this.decoys.length;
    for (let index = 0; index < total; index++) {
      const target = index < playerCount ? this.players[index] : this.decoys[index - playerCount];
      if (target === shot.owner || !target.alive || (mine && target.owner === shot.owner) || (!mine && shot.hitTargets.has(target.id))) continue;
      if (mine ? target.position.distanceToSquared(shot.mesh.position) < 3.1 ** 2 : projectileTouchesPlayer(target, shot.mesh.position, shot.radius)) return target;
    }
    return null;
  }

  bounceProjectile(shot, previous) {
    const movement = shot.mesh.position.clone().sub(previous);
    shot.mesh.position.copy(previous);
    let reflected = false;
    for (const axis of ["x", "y", "z"]) {
      const probe = previous.clone();
      probe[axis] += movement[axis];
      if (!this.world.projectileHit(probe, shot.radius)) continue;
      shot.velocity[axis] *= -1;
      reflected = true;
    }
    if (!reflected) shot.velocity.multiplyScalar(-1);
    shot.velocity.multiplyScalar(shot.weapon.bounceEnergy ?? .62);
    if (shot.weapon.type === "grenade") shot.velocity.y = Math.max(2.5, shot.velocity.y);
    this.combatVisuals?.impact(previous, shot.weapon, shot.owner, { size: .58 });
    this.sound.play("bounce", shot.weapon, this.audioSpatial(previous, false, shot.weapon.presentationPayload === "fireball" ? .42 : .62, shot.owner.id));
  }

  finishProjectile(index, shot) {
    if (shot.weapon.split && !shot.split) this.splitProjectile(shot);
    else if (shot.weapon.radius) this.explode(shot);
    else {
      this.combatVisuals?.impact(shot.mesh.position, shot.weapon, shot.owner, { size: 1.05 });
      this.sound.playImpact(shot.weapon, this.audioSpatial(shot.mesh.position, false, .78, shot.owner.id), 0, "wall");
    }
    this.removeProjectile(index);
  }

  splitProjectile(shot) {
    shot.split = true;
    const count = shot.weapon.split;
    const child = {
      ...shot.weapon, id: `${shot.weapon.id}_bomblet`, type: "grenade", split: 0,
      damage: Math.max(14, shot.weapon.damage), projectileSpeed: 18,
      radius: 2.8, terrainRadius: 2.2, fuse: .62, gravity: 15,
      bounces: 1, bounceEnergy: .55, arcLift: 0, projectileRadius: .16
    };
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const direction = new THREE.Vector3(Math.cos(angle), .55 + (i % 2) * .25, Math.sin(angle)).normalize();
      this.spawnProjectile(shot.owner, child, direction, shot.mesh.position.clone().add(new THREE.Vector3(0, .35, 0)));
    }
    this.combatVisuals?.impact(shot.mesh.position, shot.weapon, shot.owner, { size: 1.5 });
    this.sound.play("split", shot.weapon, this.audioSpatial(shot.mesh.position, false, .9, shot.owner.id));
  }

  explode(shot) {
    const position = shot.mesh.position.clone();
    for (const target of [...this.players, ...this.decoys]) {
      if (!target.alive) continue;
      const targetPoint = target.position.clone();
      targetPoint.y += clamp(position.y - target.position.y, .72, 1.85);
      const distance = targetPoint.distanceTo(position);
      if (distance > shot.weapon.radius) continue;
      if (this.world.effectBlocked(position, targetPoint)) continue;
      const factor = 1 - distance / shot.weapon.radius;
      const selfScale = target === shot.owner ? .35 : 1;
      const push = targetPoint.clone().sub(position).setY(.18).normalize().multiplyScalar((8 + shot.weapon.recoil) * factor * (shot.weapon.pull ? -1 : 1));
      this.damageTarget(target, Math.ceil(shot.weapon.damage * factor * selfScale), push, shot.owner, shot.weapon);
      if (shot.weapon.grappleDisrupt && target.grapple) this.releaseGrapple(target);
    }
    if (shot.weapon.terrainRadius > 0) this.world.destroy(position, shot.weapon.terrainRadius);
    if (shot.weapon.hazard) this.spawnHazard(position, shot.owner, shot.weapon, shot.velocity);
    this.combatVisuals?.impact(position, shot.weapon, shot.owner, { size: Math.min(2.6, Math.max(1.35, shot.weapon.radius * .42)), explosive: true });
    this.sound.playImpact(shot.weapon, this.audioSpatial(position, false, 1, shot.owner.id), 0, "explosive");
  }

  damageTarget(target, damage, push, attacker, weapon, context = {}) {
    if (weapon.effect === "teleport") this.teleportOwner(attacker, context.point || target.position, context.direction || attacker.aim);
    if (target.isDecoy) {
      target.health -= damage;
      this.spawnImpact(target.position, target, weapon, attacker);
      if (target.health <= 0) this.removeDecoy(target);
      return;
    }
    this.damagePlayer(target, damage, push, attacker, weapon);
    applyWeaponStatus(target, weapon);
    if (weapon.effect === "steal" && target.alive) this.stealWeapon(attacker, target, weapon, context.sourceSlot);
  }

  stealWeapon(attacker, target, stealingWeapon, sourceSlot) {
    const attackerSlot = Number.isInteger(sourceSlot) && attacker.loadout[sourceSlot] === stealingWeapon.id
      ? sourceSlot
      : attacker.loadout.indexOf(stealingWeapon.id);
    if (attackerSlot < 0 || !target.weapon) return;
    const targetSlot = target.slotIndex;
    const swap = swapStolenWeapon(attacker, target, stealingWeapon.id, attackerSlot, targetSlot);
    if (!swap) return;
    const { stolenId } = swap;
    if (stolenId === "remote_explosive") {
      for (const shot of this.projectiles) if (shot.owner === target && shot.weapon.id === stolenId) shot.owner = attacker;
      this.trimRemoteCharges(attacker, WEAPONS[stolenId], WEAPONS[stolenId].maxCharges);
    }
    if (attacker.slotIndex === attackerSlot) attacker.updateWeaponModel();
    target.updateWeaponModel();
    this.spawnBurst(target.position, stealingWeapon.color, 12);
    this.sound.play("steal", stealingWeapon, this.audioSpatial(target.position, target === this.players[0], .9, attacker.id));
  }

  teleportOwner(player, point, direction) {
    if (!player?.alive) return;
    this.releaseGrapple(player);
    const destination = point.clone().addScaledVector(direction.clone().normalize(), -1.35);
    destination.y = Math.max(.2, destination.y);
    const previous = player.position.clone();
    this.spawnBurst(previous, 0x43ffd1, 12);
    player.position.copy(destination);
    this.world.resolve(player.position, player.radius, previous);
    player.velocity.set(0, 2.5, 0);
    this.spawnBurst(player.position, 0x43ffd1, 14);
    this.sound.play("teleport", WEAPONS.teleport_projectile, this.audioSpatial(player.position, player === this.players[0], 1, player.id));
  }

  trimRemoteCharges(owner, weapon, limit, detonate = false) {
    for (const shot of excessOwnedProjectiles(this.projectiles, owner, weapon.id, limit)) {
      const index = this.projectiles.indexOf(shot);
      if (index < 0) continue;
      if (detonate) this.explode(shot);
      else this.combatVisuals?.impact(shot.mesh.position, weapon, owner, { size: .7 });
      this.removeProjectile(index);
    }
  }

  spawnHazard(position, owner, weapon, projectileVelocity = new THREE.Vector3()) {
    const ownerHazards = this.hazards
      .map((hazard, index) => ({ hazard, index }))
      .filter(({ hazard }) => hazard.owner === owner && hazard.weapon.id === weapon.id);
    if (ownerHazards.length >= (weapon.maxActiveHazards || 2)) this.removeHazard(ownerHazards[0].index);
    if (this.hazards.length >= 24) this.removeHazard(0);
    const hazardRadius = weapon.hazard === "black_hole" ? 9 : weapon.hazard === "tornado" ? 7 : 6;
    const mesh = new THREE.Group();
    const ringOpacity = weapon.hazard === "tornado" ? .12 : weapon.hazard === "black_hole" ? .18 : .28;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(hazardRadius * .48, .22, 8, 34),
      new THREE.MeshBasicMaterial({ color: weapon.color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
    let instances = null;
    const fadeMaterials = [{ material: ring.material, baseOpacity: ringOpacity }];
    if (weapon.hazard === "napalm") {
      const count = 9;
      const flames = new THREE.InstancedMesh(
        new THREE.ConeGeometry(.42, 1.8, 7),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .46, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        count
      );
      const dummy = new THREE.Object3D();
      const bases = [];
      const phases = [];
      for (let index = 0; index < 9; index++) {
        const angle = index / 9 * Math.PI * 2;
        const base = new THREE.Vector3(Math.cos(angle) * hazardRadius * .42, .65 + index % 2 * .25, Math.sin(angle) * hazardRadius * .42);
        bases.push(base);
        phases.push(index * .73);
        dummy.position.copy(base);
        dummy.scale.set(.82 + index % 3 * .12, .78 + index % 2 * .24, .82 + index % 3 * .12);
        dummy.updateMatrix();
        flames.setMatrixAt(index, dummy.matrix);
        flames.setColorAt(index, new THREE.Color(index % 2 ? weapon.color : 0xffd061));
      }
      flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.add(flames);
      fadeMaterials.push({ material: flames.material, baseOpacity: .46 });
      instances = { kind: "flame", mesh: flames, dummy, bases, phases };
    } else if (weapon.hazard === "black_hole") {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 10), new THREE.MeshBasicMaterial({ color: 0x210337, transparent: true, opacity: .58, depthWrite: false, toneMapped: false }));
      const vertical = new THREE.Mesh(new THREE.TorusGeometry(2.1, .13, 7, 28), ring.material.clone());
      vertical.material.opacity = .24;
      vertical.rotation.y = Math.PI / 2;
      mesh.add(core, vertical);
      fadeMaterials.push({ material: core.material, baseOpacity: .58 }, { material: vertical.material, baseOpacity: .24 });
    } else {
      const vortexMaterial = ring.material.clone();
      vortexMaterial.opacity = .1;
      vortexMaterial.side = THREE.DoubleSide;
      vortexMaterial.blending = THREE.NormalBlending;
      const ribbon = new THREE.Mesh(vortexRibbonGeometry(), vortexMaterial);
      ribbon.position.y = .18;
      mesh.add(ribbon);
      fadeMaterials.push({ material: vortexMaterial, baseOpacity: .1 });
      instances = { kind: "ribbon", mesh: ribbon };
    }
    const hazardPosition = position.clone();
    if (weapon.hazard === "napalm") hazardPosition.y = this.world.surfaceHeightAt(hazardPosition, position.y + 2) + .12;
    else hazardPosition.y = Math.max(.18, position.y);
    mesh.position.copy(hazardPosition);
    this.scene.add(mesh);
    const velocity = projectileVelocity.clone().setY(0);
    if (velocity.lengthSq()) velocity.normalize().multiplyScalar(weapon.hazardSpeed || 0);
    const audioId = `hazard-${owner.id}-${weapon.id}-${performance.now().toString(36)}`;
    this.hazards.push({
      audioId, mesh, owner, weapon, radius: hazardRadius, life: weapon.hazardDuration, tick: 0, velocity, elapsed: 0, instances, fadeMaterials,
      previousPosition: new THREE.Vector3(), nextPosition: new THREE.Vector3(), probePosition: new THREE.Vector3()
    });
    this.sound.play("hazardSpawn", weapon, this.audioSpatial(mesh.position, false, .9, audioId));
  }

  updateHazards(dt) {
    for (let index = this.hazards.length - 1; index >= 0; index--) {
      const hazard = this.hazards[index];
      hazard.life -= dt;
      hazard.tick -= dt;
      hazard.elapsed += dt;
      const cameraDistance = this.camera.position.distanceTo(hazard.mesh.position);
        const proximityFade = clamp((cameraDistance - 2) / 7, .025, 1);
      for (const entry of hazard.fadeMaterials || []) entry.material.opacity = entry.baseOpacity * proximityFade;
      hazard.mesh.rotation.y += dt * (hazard.weapon.hazard === "tornado" ? 2.6 : hazard.weapon.hazard === "black_hole" ? -1.4 : .4);
      if (hazard.weapon.hazard === "tornado" && hazard.velocity.lengthSq()) {
        const previous = hazard.previousPosition.copy(hazard.mesh.position);
        const next = hazard.nextPosition.copy(previous).addScaledVector(hazard.velocity, dt);
        if (this.world.projectileHit(next, .8)) {
          const probeX = hazard.probePosition.copy(previous);
          probeX.x += hazard.velocity.x * dt;
          if (this.world.projectileHit(probeX, .8)) hazard.velocity.x *= -1;
          const probeZ = hazard.probePosition.copy(previous);
          probeZ.z += hazard.velocity.z * dt;
          if (this.world.projectileHit(probeZ, .8)) hazard.velocity.z *= -1;
        } else hazard.mesh.position.copy(next);
      }
      if (hazard.instances?.kind === "flame") {
        const { mesh, dummy, bases, phases } = hazard.instances;
        for (let flameIndex = 0; flameIndex < bases.length; flameIndex++) {
          const flicker = 1 + Math.sin(hazard.elapsed * 11 + phases[flameIndex]) * .22;
          dummy.position.copy(bases[flameIndex]);
          dummy.rotation.set(0, phases[flameIndex], 0);
          dummy.scale.set(flicker, .78 + flicker * .42, flicker);
          dummy.updateMatrix();
          mesh.setMatrixAt(flameIndex, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      } else if (hazard.instances?.kind === "ribbon") {
        hazard.instances.mesh.rotation.y += dt * 1.8;
        hazard.instances.mesh.scale.y = 1 + Math.sin(hazard.elapsed * 5) * .035;
      }
      const pulse = 1 + Math.sin(hazard.life * 7) * .08;
      hazard.mesh.scale.setScalar(pulse);
      if (hazard.tick <= 0) {
        hazard.tick = .22;
        for (const player of this.players) {
          if (!player.alive) continue;
          const targetPoint = this.hazardTarget.copy(player.position);
          targetPoint.y += 1.05;
          const offset = this.hazardOffset.copy(targetPoint).sub(hazard.mesh.position);
          const distance = offset.length();
          if (distance > hazard.radius) continue;
          if (this.world.effectBlocked(hazard.mesh.position, targetPoint)) continue;
          const factor = 1 - distance / hazard.radius;
          let damage = 0;
          const push = this.hazardPush.set(0, 0, 0);
          if (hazard.weapon.hazard === "napalm") {
            damage = 4 * (.35 + factor * .65);
            push.set(0, 1.2, 0);
          } else if (hazard.weapon.hazard === "black_hole") {
            damage = 2 * (.35 + factor * .65);
            push.copy(offset).normalize().multiplyScalar(-14 * factor);
          } else {
            damage = .6 + factor * .8;
            push.set(-offset.z, 8, offset.x).normalize().multiplyScalar(13 * factor).setY(7 * factor);
          }
          this.damagePlayer(player, Math.ceil(damage * (player === hazard.owner ? .35 : 1)), push, hazard.owner, hazard.weapon);
        }
      }
      if (hazard.life <= 0) {
        this.removeHazard(index);
      }
    }
  }

  spawnDecoy(position, owner, weapon) {
    const mesh = owner.group.clone(true);
    const materials = [];
    mesh.traverse((child) => {
      if (child.geometry) child.geometry = child.geometry.clone();
      if (!child.material) return;
      const source = Array.isArray(child.material) ? child.material : [child.material];
      const clones = source.map((entry) => {
        const clone = entry.clone();
        const wasVisible = clone.opacity > .01;
        clone.transparent = true;
        clone.opacity = wasVisible ? .48 : 0;
        clone.depthWrite = false;
        clone.color?.setHex?.(weapon.color);
        clone.emissive?.setHex?.(weapon.color);
        if ("emissiveIntensity" in clone) clone.emissiveIntensity = 1.15;
        materials.push({ material: clone, baseOpacity: clone.opacity });
        return clone;
      });
      child.material = Array.isArray(child.material) ? clones : clones[0];
      child.castShadow = false;
      child.receiveShadow = false;
    });
    const feet = position.clone();
    feet.y = this.world.surfaceHeightAt(feet, position.y + 1);
    mesh.position.copy(feet);
    mesh.scale.multiplyScalar(.96);
    this.scene.add(mesh);
    this.decoys.push({
      id: `decoy-${Math.random().toString(36).slice(2)}`,
      isDecoy: true, alive: true, health: 55, radius: .72,
      owner, weapon, mesh, materials, position: feet, life: weapon.decoyDuration
    });
    this.spawnBurst(mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), weapon.color, 10);
  }

  updateDecoys(dt) {
    for (let index = this.decoys.length - 1; index >= 0; index--) {
      const decoy = this.decoys[index];
      decoy.life -= dt;
      decoy.mesh.rotation.y += dt * 1.4;
      const flicker = .76 + Math.sin(decoy.life * 9) * .24;
      for (const { material, baseOpacity } of decoy.materials) material.opacity = baseOpacity * flicker;
      if (decoy.life <= 0) this.removeDecoy(decoy);
    }
  }

  removeDecoy(decoy) {
    const index = this.decoys.indexOf(decoy);
    if (index < 0) return;
    decoy.alive = false;
    this.removeObject(decoy.mesh);
    this.decoys.splice(index, 1);
  }

  damagePlayer(target, damage, push, attacker, weapon = null) {
    const killed = target.takeHit(damage, push);
    if (target === this.players[0] || attacker === this.players[0] || target.position.distanceToSquared(this.players[0].position) < 34 ** 2) {
      this.combatMusicPulse = Math.max(this.combatMusicPulse, killed ? 1 : .76);
    }
    this.spawnImpact(target.position, target, weapon, attacker);
    this.showCombatFeedback(target, attacker, weapon, killed);
    if (!killed) return;
    this.releaseGrapple(target);
    const attackerIndex = this.players.indexOf(attacker);
    const targetIndex = this.players.indexOf(target);
    if (attackerIndex >= 0 && attacker !== target) this.scores[attackerIndex] += 1;
    this.respawnTimers[targetIndex] = 2.8;
  }

  showCombatFeedback(target, attacker, weapon, killed) {
    if (!this.hud) return;
    if (attacker === this.players[0]) {
      this.hud.reticle.classList.remove("hit", "elimination");
      void this.hud.reticle.offsetWidth;
      this.hud.reticle.classList.add(killed ? "elimination" : "hit");
      this.sound.play(killed ? "elimination" : "hitConfirm");
    }
    if (target === this.players[0] && attacker) {
      if (!killed) this.sound.play("damage", weapon, { local: true });
      this.hud.damageVignette.style.setProperty("--damage-color", `#${new THREE.Color(attacker.accent).getHexString()}`);
      this.hud.damageVignette.classList.remove("visible");
      void this.hud.damageVignette.offsetWidth;
      this.hud.damageVignette.classList.add("visible");
      clearTimeout(this.damageVignetteTimer);
      this.damageVignetteTimer = setTimeout(
        () => this.hud?.damageVignette?.classList.remove("visible"),
        this.settings.reducedMotion ? 120 : 520
      );
    }
    if (!killed || !attacker || attacker === target) return;
    const line = document.createElement("p");
    const source = document.createElement("b");
    const victim = document.createElement("b");
    source.textContent = attacker.name;
    source.style.color = `#${new THREE.Color(attacker.accent).getHexString()}`;
    victim.textContent = target.name;
    victim.style.color = `#${new THREE.Color(target.accent).getHexString()}`;
    line.append(source, document.createTextNode(`  ${weapon?.name || "impact"}  `), victim);
    this.hud.combatLog.prepend(line);
    while (this.hud.combatLog.children.length > 4) this.hud.combatLog.lastElementChild.remove();
  }

  spawnImpact(position, target, weapon, attacker) {
    const level = this.settings.blood;
    const color = level === "off" ? 0x6feeff : 0xff315f;
    const impactWeapon = weapon || { color, type: "projectile" };
    const center = position.clone().add(new THREE.Vector3(0, 1.05, 0));
    if (weapon && !weapon.radius) this.sound.playImpact(weapon, this.audioSpatial(center, target === this.players[0], target === this.players[0] ? 1 : .5, attacker?.id || "world"), 0, "player");
    this.combatVisuals?.impact(center, impactWeapon, attacker || target, { size: level === "full" ? 1.25 : .9 });
    if (level !== "off") {
      const direction = attacker?.position
        ? target.position.clone().sub(attacker.position).normalize()
        : new THREE.Vector3(0, 1, 0);
      this.combatVisuals?.burst(center, 0xff315f, level === "full" ? 10 : 5, { family: "blood", direction, force: level === "full" ? 8 : 5.5 });
      this.combatVisuals?.blood(center, direction, level === "full" ? .82 : .54);
    }
    if (!this.settings.reducedMotion && this.settings.shake > 0 && target === this.players[0]) {
      this.camera.position.x += (Math.random() - .5) * this.settings.shake * .006;
    }
  }

  spawnBurst(position, color, count) {
    this.combatVisuals?.burst(position.clone().add(new THREE.Vector3(0, 1.05, 0)), color, count, { family: "energy", force: 7 });
  }

  updateEffects(dt) {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      effect.life -= dt;
      if (effect.beam) {
        effect.mesh.material.opacity *= .72;
      } else if (effect.ring) {
        const scale = THREE.MathUtils.lerp(effect.mesh.scale.x, effect.maxScale, dt * 9);
        effect.mesh.scale.setScalar(scale);
        effect.mesh.material.opacity *= .9;
      } else {
        effect.velocity.y -= 12 * dt;
        effect.mesh.position.addScaledVector(effect.velocity, dt);
        effect.mesh.scale.multiplyScalar(1 - dt * 1.4);
      }
      if (effect.life <= 0) {
        this.removeObject(effect.mesh);
        this.effects.splice(index, 1);
      }
    }
  }

  updateRespawns(dt) {
    for (let index = 0; index < this.players.length; index++) {
      const player = this.players[index];
      if (player.alive) continue;
      player.updateDeath(dt);
      if (this.respawnTimers[index] <= 0) continue;
      this.respawnTimers[index] -= dt;
      if (this.respawnTimers[index] <= 0) {
        player.respawn(safestSpawn(this.world.spawnPoints(), this.players, player));
        if (index === 0) {
          this.cameraFocus.set(0, 0, 0);
          this.updateCamera(1);
        }
      }
    }
  }

  updateHud() {
    const player = this.players[0];
    const actionState = !player.alive ? "death"
      : player.hitTimer > 0 ? "hit"
        : player.attackTimer > player.weapon.cooldown * .35 || player.recoilVisual > .02 ? "firing"
          : player.grapple ? "grapple"
            : player.landTimer > 0 ? "landing"
              : !player.grounded ? "airborne"
                : player.controlMove.lengthSq() > .01 ? "running" : "idle";
    if (this.hud.root.dataset.playerState !== actionState) this.hud.root.dataset.playerState = actionState;
    setStyle(this.hud.health, "width", `${player.health}%`);
    setText(this.hud.score, this.scores[0]);
    let leaderIndex = 0;
    for (let index = 0; index < this.scores.length; index++) {
      setText(this.hud.boardScore[index], this.scores[index]);
      if (this.scores[index] > this.scores[leaderIndex]) leaderIndex = index;
    }
    setText(this.hud.leaderName, this.players[leaderIndex].name);
    setText(this.hud.leaderScore, this.scores[leaderIndex]);
    const minutes = Math.floor(this.matchTime / 60).toString().padStart(2, "0");
    const seconds = Math.floor(this.matchTime % 60).toString().padStart(2, "0");
    setText(this.hud.time, `${minutes}:${seconds}`);
    setText(this.hud.grapple, this.awaitingAudioGesture ? "CLICK / TAP TO START MATCH"
      : player.grapple ? "GRAPPLE PULLING · RELEASE TO SLINGSHOT" : "GRAPPLE READY · E / RIGHT CLICK");
    this.hud.slots.forEach((slot, index) => {
      const weapon = WEAPONS[player.loadout[index]];
      slot.classList.toggle("selected", index === player.slotIndex);
      const category = WEAPON_CATEGORY_SLUG_BY_ID[weapon.id];
      if (slot.dataset.category !== category) slot.dataset.category = category;
      setStyle(slot, "--weapon", WEAPON_CSS_COLOR_BY_ID[weapon.id]);
      setText(this.hud.slotNames[index], weapon.name);
    });
    this.armedCounts.clear();
    for (const shot of this.projectiles) {
      if (shot.owner !== player || !shot.stuck || shot.weapon.type !== "remote") continue;
      this.armedCounts.set(shot.weapon.id, (this.armedCounts.get(shot.weapon.id) || 0) + 1);
    }
    this.hud.ammo.forEach((node, index) => {
      const weapon = WEAPONS[player.loadout[index]];
      const isReloading = player.reloadTimer > 0 && player.reloadWeaponId === weapon.id;
      const charge = player.chargingWeaponId === weapon.id && weapon.chargeTime
        ? `CHARGE ${Math.round(100 * Math.min(1, player.chargeTimer / weapon.chargeTime))}%`
        : null;
      const armed = weapon.type === "remote" ? this.armedCounts.get(weapon.id) || 0 : 0;
      setText(node, isReloading ? "RELOAD" : charge || `${player.ammo[weapon.id]}/${weapon.ammo}${armed ? ` · ${armed} ARMED` : ""}`);
    });
    this.hud.scoreboard.classList.toggle("visible", this.input.down("Tab"));
    const motion = this.settings.reducedMotion ? 0 : clamp((player.velocity.length() - 14) / 30, 0, 1);
    const grappleBlur = player.grapple && this.graphics.level !== "low" ? motion * (this.graphics.level === "high" ? 3.2 : 1.7) : 0;
    setStyle(this.hud.motionVignette, "--motion", motion.toFixed(3));
    setStyle(this.hud.motionVignette, "--environment-blur", `${grappleBlur.toFixed(2)}px`);
    this.hud.motionVignette.classList.toggle("grappling", Boolean(player.grapple));
  }

  updatePerformanceSample(dt) {
    const sample = this.performanceSample;
    sample.elapsed += dt;
    sample.frames++;
    sample.windowElapsed += dt;
    sample.windowFrames++;
    if (sample.windowElapsed < 1) return;
    sample.fps = sample.windowFrames / sample.windowElapsed;
    sample.minimum = Math.min(sample.minimum, sample.fps);
    sample.total += sample.fps;
    sample.samples++;
    sample.windowElapsed = 0;
    sample.windowFrames = 0;
    const node = this.hud?.performance;
    if (!node) return;
    const seconds = Math.min(60, Math.floor(sample.elapsed));
    const average = sample.total / sample.samples;
    node.textContent = `${Math.round(sample.fps)} FPS · ${this.renderer.info.render.drawCalls} DRAWS · ${this.players.length} FIGHTERS · ${this.renderPipeline.profile} · ${seconds}/60 SEC`;
    node.dataset.fps = sample.fps.toFixed(1);
    node.dataset.averageFps = average.toFixed(1);
    node.dataset.minimumFps = sample.minimum.toFixed(1);
    node.dataset.sampleSeconds = sample.elapsed.toFixed(1);
    node.dataset.complete = sample.elapsed >= 60 ? "true" : "false";
    node.dataset.cameraDistance = (this.cameraClearance?.actual || 0).toFixed(2);
    node.dataset.cameraTargetDistance = (this.cameraClearance?.target || 0).toFixed(2);
  }

  finishMatch() {
    if (this.state !== "play") return;
    this.state = "results";
    this.paused = true;
    this.input.releasePointer();
    for (const player of this.players) {
      this.sound.stopOwner(player.id);
    }
    this.sound.stopAll();
    const winningScore = Math.max(...this.scores);
    const winners = this.scores.map((score, index) => score === winningScore ? index : -1).filter((index) => index >= 0);
    const headline = winners.length > 1 ? "Draw match" : `${escapeHtml(this.players[winners[0]].name)} wins`;
    const ranking = this.players.map((player, index) => ({ player, score: this.scores[index] })).sort((a, b) => b.score - a.score);
    ui.insertAdjacentHTML("beforeend", `
      <div class="overlay results">
        <section class="dialog results-dialog">
          <p>MATCH COMPLETE</p><h1>${headline}</h1>
          <div class="results-ranking">${ranking.slice(0, 5).map(({ player, score }) => `<p><b>${escapeHtml(player.name)}</b><span>${score}</span></p>`).join("")}</div>
          <button class="primary" data-action="rematch">REMATCH · SAME SEED</button>
          <button data-screen="main">RETURN TO MENU</button>
        </section>
      </div>`);
    const humanWon = winners.includes(0);
    this.sound.startMusic(`results-${humanWon ? "win" : "loss"}`, this.seed);
    this.sound.setMusicIntensity(humanWon ? .58 : .34);
    this.sound.play(humanWon ? "win" : "loss");
    this.bindUi();
  }

  updateCamera(dt = 1 / 60) {
    const cameraBlend = 1 - Math.exp(-11 * dt);
    const focusBlend = 1 - Math.exp(-15 * dt);
    const player = this.players[0];
    const scratch = this.cameraScratch;
    if (!player) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 62, cameraBlend);
      this.camera.updateProjectionMatrix();
      this.camera.position.lerp(scratch.menuPosition, cameraBlend);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    const forward = this.mouseAim(scratch.forward);
    const flatForward = scratch.flatForward.copy(forward).setY(0).normalize();
    const right = scratch.right.set(flatForward.z, 0, -flatForward.x);
    const pivot = scratch.pivot.copy(player.position);
    pivot.y += 1.65;
    const desired = scratch.desired.copy(pivot)
      .addScaledVector(flatForward, -8.25)
      .addScaledVector(right, 1.05);
    desired.y += 2.8 - this.cameraPitch * 1.8;
    const speed = player.velocity.length();
    const targetFov = 62 + Math.min(11, Math.max(0, speed - 8) * .34) + (player.grapple ? 2.5 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, cameraBlend);
    this.camera.updateProjectionMatrix();
    const cameraTarget = this.world.constrainCamera(pivot, desired, .45, scratch.target);
    let bestDistanceSq = cameraTarget.distanceToSquared(pivot);
    if (bestDistanceSq < 5.5 ** 2) {
      const offset = scratch.offset.copy(desired).sub(pivot);
      for (const angle of CAMERA_ALTERNATIVE_ANGLES) {
        const alternative = scratch.candidateDesired.copy(offset).applyAxisAngle(CAMERA_UP, angle).add(pivot);
        const candidate = this.world.constrainCamera(pivot, alternative, .45, scratch.candidate);
        const distanceSq = candidate.distanceToSquared(pivot);
        if (distanceSq > bestDistanceSq) {
          cameraTarget.copy(candidate);
          bestDistanceSq = distanceSq;
        }
      }
      for (const height of CAMERA_ALTERNATIVE_HEIGHTS) {
        const alternative = scratch.candidateDesired.copy(desired);
        alternative.y += height;
        const candidate = this.world.constrainCamera(pivot, alternative, .45, scratch.candidate);
        const distanceSq = candidate.distanceToSquared(pivot);
        if (distanceSq > bestDistanceSq) {
          cameraTarget.copy(candidate);
          bestDistanceSq = distanceSq;
        }
      }
    }
    this.camera.position.lerp(cameraTarget, cameraBlend);
    this.world.constrainCamera(pivot, this.camera.position, .45, scratch.constrained);
    this.camera.position.copy(scratch.constrained);
    let actualDistance = this.camera.position.distanceTo(pivot);
    const targetDistance = Math.sqrt(bestDistanceSq);
    if (actualDistance < 3.2 && targetDistance > 4) {
      this.camera.position.copy(cameraTarget);
      actualDistance = targetDistance;
    }
    this.cameraClearance.actual = actualDistance;
    this.cameraClearance.target = targetDistance;
    const motionLead = scratch.motionLead.copy(player.velocity).setY(0).multiplyScalar(.08);
    const focus = scratch.focus.copy(pivot).addScaledVector(forward, 28).add(motionLead);
    if (this.cameraFocus.lengthSq() === 0) this.cameraFocus.copy(focus);
    else this.cameraFocus.lerp(focus, focusBlend);
    this.camera.lookAt(this.cameraFocus);
    if (!this.settings.reducedMotion) this.camera.rotateZ(clamp(-player.velocity.dot(right) * .0024, -.035, .035));
  }

  renderScene() {
    if (this.state !== "play" || this.paused) this.updateCamera();
    this.renderPipeline.render();
  }

  removeProjectile(index) {
    this.sound.updateProjectileLoop(this.projectiles[index]?.audioId, this.projectiles[index]?.weapon, false);
    this.combatVisuals?.removeProjectile(this.projectiles[index]);
    this.removeObject(this.projectiles[index].mesh);
    this.removeObject(this.projectiles[index].telegraph);
    this.projectiles.splice(index, 1);
  }

  removeHazard(index) {
    const hazard = this.hazards[index];
    if (!hazard) return;
    this.sound.updateHazardLoop(hazard.audioId, hazard.weapon, false);
    this.sound.play("hazardEnd", hazard.weapon, this.audioSpatial(hazard.mesh.position, false, .48, hazard.audioId));
    this.removeObject(hazard.mesh);
    this.hazards.splice(index, 1);
  }

  removeObject(object) {
    if (!object) return;
    this.scene.remove(object);
    object.traverse?.((child) => {
      if (!child.geometry?.userData?.sharedProjectile) child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((entry) => entry.dispose?.());
      else child.material?.dispose?.();
    });
  }
}

new BlasterBattle().init().catch((error) => {
  console.error("Blaster Battle renderer failed to initialize", error);
  try { sessionStorage.removeItem(MATCH_SESSION_KEY); } catch {}
  if (matchLoading) matchLoading.hidden = true;
  ui.innerHTML = `<main class="menu-shell"><section class="hero-panel"><p class="kicker">RENDERER ERROR</p><h1>Graphics initialization failed.</h1><p class="lead">Update your browser or enable WebGL2, then reload.</p></section></main>`;
});
