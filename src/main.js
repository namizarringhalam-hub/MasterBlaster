import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import "./styles.css";
import { SoundBoard } from "./audio.js";
import { CombatVisuals } from "./combatVisuals.js";
import { ArenaWorld } from "./world.js";
import { Fighter, PROJECTILE_SPAWN_OFFSET, aimWithSpread, applyGrapplePhysics, boostGrappleRelease, cameraRelative, directionFromKeys, directionFromTouch, grappleSightline, projectileTouchesPlayer, reticleAim } from "./player.js";
import { InputManager, updateOrbit } from "./input.js";
import { DEFAULT_LOADOUT, loadSettings, projectileLifetime, projectileStepCount, randomLoadout, saveSettings, WEAPONS } from "./gameData.js";
import { botFireChance, chooseBotSlot, clampBotCount, nearestTarget, safestSpawn } from "./botBrain.js";

const canvas = document.querySelector("#game-canvas");
const ui = document.querySelector("#ui-root");
const clamp = THREE.MathUtils.clamp;

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
    webgl2: Boolean(document.createElement("canvas").getContext("webgl2")),
    wasm: typeof WebAssembly === "object",
    websocket: typeof WebSocket === "function",
    pointer: typeof PointerEvent === "function"
  };
}

class BlasterBattle {
  constructor() {
    this.capabilities = capabilities();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.55));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment(), .04).texture;
    this.scene.environmentIntensity = .55;
    environment.dispose();
    this.scene.background = new THREE.Color(0x07111d);
    this.scene.fog = new THREE.FogExp2(0x07111d, .006);
    this.camera = new THREE.PerspectiveCamera(62, 1, .1, 520);
    this.clock = new THREE.Clock();
    this.input = new InputManager(
      canvas,
      () => this.state === "play" && !this.paused,
      () => { if (this.state === "play" && !this.paused) this.togglePause(); }
    );
    this.cameraYaw = 0;
    this.cameraPitch = -.08;
    this.cameraFocus = new THREE.Vector3();
    this.sound = new SoundBoard();
    this.settings = loadSettings();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .34, .36, .78);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
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
    this.targetScore = 10;
    this.touch = {};
    this.performanceSample = this.freshPerformanceSample();
    this.setupLights();
    this.renderMain();
    this.resize();
    addEventListener("resize", () => this.resize());
    addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "play" && !this.paused) this.togglePause();
    });
    requestAnimationFrame(() => this.frame());
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0x96d9ff, 0x10182a, 1.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.15);
    key.position.set(-22, 40, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -135, right: 135, top: 135, bottom: -135, near: 1, far: 260 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff315f, 1.25);
    rim.position.set(22, 15, -25);
    this.scene.add(rim);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer?.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  clearMatch() {
    this.input.releasePointer();
    this.combatVisuals?.dispose();
    this.combatVisuals = null;
    this.world?.dispose();
    for (const player of this.players) {
      this.releaseGrapple(player);
      player.dispose();
    }
    for (const shot of this.projectiles) this.removeObject(shot.mesh);
    for (const hazard of this.hazards) this.removeObject(hazard.mesh);
    for (const decoy of this.decoys) this.removeObject(decoy.mesh);
    for (const effect of this.effects) this.removeObject(effect.mesh);
    this.world = null;
    this.players = [];
    this.projectiles = [];
    this.hazards = [];
    this.decoys = [];
    this.effects = [];
  }

  renderMain() {
    this.state = "menu";
    this.paused = false;
    this.clearMatch();
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
          <span>02</span><div><b>45 WEAPONS</b><small>Carry five into combat</small></div>
          <span>03</span><div><b>DYNAMIC ARENAS</b><small>Moving routes, portals, and hazards</small></div>
        </aside>
      </main>`;
    this.bindUi();
  }

  renderSetup(mode) {
    this.mode = mode;
    if (mode === "quick") {
      this.settings.loadout = randomLoadout();
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
            <div class="weapon-grid">
              ${Object.values(WEAPONS).map((weapon) => `
                <button class="weapon-choice ${this.settings.loadout.includes(weapon.id) ? "selected" : ""}" data-weapon-choice="${weapon.id}" style="--weapon:#${weapon.color.toString(16).padStart(6, "0")}">
                  <i></i>
                  <b>${weapon.name}</b><em>${weapon.category}</em><small>${weapon.description}</small>
                </button>`).join("")}
            </div>
          </section>
          <button class="launch primary" data-action="start">${mode === "quick" ? "FIND MATCH" : mode === "private" ? "CREATE ROOM" : "START TRAINING"}</button>
          <p class="prototype-note">Playable MVP slice · Guest session · Internet match fleet is represented locally in this build</p>
        </section>
      </main>`;
    this.bindUi();
  }

  renderSettings() {
    ui.innerHTML = `
      <main class="screen">
        <section class="dialog settings-dialog">
          <header><button class="back" data-screen="main">← Back</button><p>LOCAL PREFERENCES</p></header>
          <h1>Settings</h1>
          <div class="settings-grid">
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
      if (button.dataset.screen === "main") return this.renderMain();
      if (button.dataset.screen === "settings") return this.renderSettings();
      if (button.dataset.screen === "credits") return this.renderCredits();
      if (button.dataset.mode) return this.renderSetup(button.dataset.mode);
      if (button.dataset.weaponChoice) return this.toggleLoadout(button.dataset.weaponChoice);
      if (button.dataset.weaponSlot) return this.players[0]?.switchSlot(Number(button.dataset.weaponSlot));
      if (button.dataset.action === "start") return this.captureSetupAndStart();
      if (button.dataset.action === "pause") return this.togglePause();
      if (button.dataset.action === "rematch") return this.startMatch();
      if (button.dataset.action === "save-settings") return this.saveSettingsForm();
    };
  }

  toggleLoadout(id) {
    const current = [...this.settings.loadout];
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
    else if (current.length < 5) current.push(id);
    this.settings.loadout = current;
    const button = ui.querySelector(`[data-weapon-choice="${id}"]`);
    button?.classList.toggle("selected", current.includes(id));
    const count = ui.querySelector("[data-loadout-count]");
    if (count) count.textContent = `${current.length}/5 selected`;
    const launch = ui.querySelector('[data-action="start"]');
    if (launch) launch.disabled = current.length !== 5;
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
    this.settings.blood = ui.querySelector('[data-setting="blood"]').value;
    this.settings.shake = Number(ui.querySelector('[data-setting="shake"]').value);
    this.settings.volume = Number(ui.querySelector('[data-setting="volume"]').value);
    this.settings.reducedMotion = ui.querySelector('[data-setting="reducedMotion"]').checked;
    saveSettings(this.settings);
    this.renderMain();
  }

  startMatch() {
    this.clearMatch();
    this.state = "play";
    this.paused = false;
    this.matchTime = 180;
    this.performanceSample = this.freshPerformanceSample();
    this.world = new ArenaWorld(this.scene, this.seed);
    this.combatVisuals = new CombatVisuals(this.scene, {
      reducedMotion: this.settings.reducedMotion,
      quality: matchMedia("(pointer: coarse)").matches ? .68 : 1
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
    this.sound.startMusic();
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
          <div class="touch-move">
            <button data-touch="up">▲</button><button data-touch="left">◀</button>
            <button data-touch="down">▼</button><button data-touch="right">▶</button>
          </div>
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
        else this.touch[action] = true;
        button.setPointerCapture?.(event.pointerId);
      };
      const release = (event) => {
        event.preventDefault();
        this.touch[action] = false;
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
    }
  }

  togglePause() {
    if (this.state !== "play") return;
    this.paused = !this.paused;
    if (this.paused) this.input.releasePointer();
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

  frame() {
    const rawDt = Math.min(.25, this.clock.getDelta());
    const dt = Math.min(.033, rawDt);
    if (this.state === "play" && this.input.tapped("Escape")) this.togglePause();
    if (this.state === "play" && !this.paused) this.update(dt);
    this.renderScene();
    if (this.state === "play" && !this.paused) this.updatePerformanceSample(rawDt);
    this.input.endFrame();
    requestAnimationFrame(() => this.frame());
  }

  update(dt) {
    this.matchTime = Math.max(0, this.matchTime - dt);
    this.world.update(dt, this.players);
    this.handleWeaponSwitch();
    this.updateHuman(dt);
    for (let index = 1; index < this.players.length; index++) this.updateBot(this.players[index], dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updateDecoys(dt);
    this.updateEffects(dt);
    this.combatVisuals?.update(dt);
    this.updateRespawns(dt);
    this.updateHud();
    if (this.matchTime <= 0 || Math.max(...this.scores) >= this.targetScore) this.finishMatch();
  }

  handleWeaponSwitch() {
    const player = this.players[0];
    for (let index = 0; index < 5; index++) if (this.input.tapped(`Digit${index + 1}`)) player.switchSlot(index);
    if (this.input.tapped("KeyQ") || this.touch.weaponTap) player.switchSlot((player.slotIndex + 1) % player.loadout.length);
    this.touch.weaponTap = false;
  }

  updateHuman(dt) {
    const player = this.players[0];
    const look = this.input.consumeLook();
    ({ yaw: this.cameraYaw, pitch: this.cameraPitch } = updateOrbit(this.cameraYaw, this.cameraPitch, look.x, look.y));
    this.updateCamera(dt);
    if (!player.alive) return;
    let move = cameraRelative(directionFromKeys(this.input), this.cameraYaw);
    move.add(cameraRelative(directionFromTouch(this.touch), this.cameraYaw));
    if (move.lengthSq() > 1) move.normalize();
    const aim = reticleAim(player, this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()), this.world, [...this.players, ...this.decoys]);
    player.update(dt, move, aim, { jump: this.input.tapped("Space") || this.touch.jumpTap }, this.world);
    this.touch.jumpTap = false;
    if (this.input.tapped("KeyE") || this.input.tapped("MouseRight") || this.touch.grappleTap) this.toggleGrapple(player);
    this.touch.grappleTap = false;
    this.updateGrapple(player, dt);
    if (this.input.tapped("KeyR")) player.reload();
    if (this.input.mouse.left || this.touch.fire) this.tryFire(player);
  }

  updateBot(bot, dt) {
    if (!bot.alive) return;
    const human = this.players[0];
    const target = human?.alive && bot.position.distanceToSquared(human.position) < 28 ** 2
      ? human
      : nearestTarget(bot, [...this.players, ...this.decoys]);
    if (!target) return;
    const offset = target.position.clone().sub(bot.position).setY(0);
    const distance = offset.length();
    const visible = this.world.lineOfSight(bot.position, target.position);
    bot.botThink -= dt;
    if (bot.botThink <= 0) {
      bot.botThink = this.botDifficulty === "veteran" ? .25 : this.botDifficulty === "rookie" ? .75 : .48;
      bot.botDodge *= Math.random() < .45 ? -1 : 1;
      bot.switchSlot(chooseBotSlot(bot.loadout, distance));
    }
    const forward = offset.lengthSq() ? offset.clone().normalize() : new THREE.Vector3();
    const side = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(bot.botDodge);
    const preferred = bot.weapon.type === "melee" ? bot.weapon.reach * .8 : bot.weapon.type === "spread" ? 8 : ["rail", "beam", "chain"].includes(bot.weapon.type) ? 24 : 15;
    const move = side.multiplyScalar(.62);
    if (distance > preferred + 3) move.add(forward);
    if (distance < preferred - 3) move.addScaledVector(forward, -1);
    if (bot.grounded && move.lengthSq() > .01) {
      const probe = bot.position.clone().addScaledVector(move.clone().normalize(), 2.8);
      if (this.world.surfaceHeightAt(probe, bot.position.y + 2) < bot.position.y - 1.5) move.multiplyScalar(-.75);
    }
    bot.update(dt, move, forward, { jump: Math.random() < dt * .45 }, this.world);
    if (!bot.grapple && distance > 22 && Math.random() < dt * .35) this.toggleGrapple(bot);
    if (bot.grapple && (distance < 11 || Math.random() < dt * .18)) this.releaseGrapple(bot, true);
    this.updateGrapple(bot, dt);
    const difficulty = this.botDifficulty === "veteran" ? 1.45 : this.botDifficulty === "rookie" ? .58 : 1;
    if (Math.random() < botFireChance(distance, visible, bot.weapon) * difficulty) this.tryFire(bot);
  }

  mouseAim() {
    const horizontal = Math.cos(this.cameraPitch);
    return new THREE.Vector3(
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
    if (!anchor) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([start, anchor]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: player.accent }));
    this.scene.add(line);
    player.grapple = { anchor, line, wraps: [], ropeLength: Math.max(5, start.distanceTo(anchor) * .92) };
    const direction = anchor.clone().sub(start).normalize();
    const approachSpeed = player.velocity.dot(direction);
    if (approachSpeed < 15) player.velocity.addScaledVector(direction, 15 - approachSpeed);
    this.sound.play("power");
  }

  updateGrapple(player, dt) {
    if (!player.grapple || !player.alive) return;
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
    applyGrapplePhysics(player, dt);
    player.grapple.line.geometry.setFromPoints([chest, ...wraps, player.grapple.anchor]);
  }

  releaseGrapple(player, boost = false) {
    if (!player?.grapple) return;
    this.removeObject(player.grapple.line);
    player.grapple = null;
    if (boost && player.alive) boostGrappleRelease(player);
  }

  tryFire(player) {
    const weapon = player.weapon;
    if (!player.alive || player.attackTimer > 0 || player.reloadTimer > 0) return;
    if (weapon.type === "remote") {
      const charges = this.projectiles
        .map((shot, index) => ({ shot, index }))
        .filter(({ shot }) => shot.owner === player && shot.weapon.id === weapon.id);
      if (charges.length) {
        player.attackTimer = weapon.cooldown;
        for (const { shot, index } of charges.reverse()) {
          this.explode(shot);
          this.removeProjectile(index);
        }
        return;
      }
    }
    if (player.ammo[weapon.id] <= 0) {
      player.reload();
      return;
    }
    player.attackTimer = weapon.cooldown;
    player.ammo[weapon.id] -= 1;
    player.recoil();
    const listener = this.players[0];
    const distanceScale = player === listener ? 1 : Math.max(.18, 1 - player.position.distanceTo(listener.position) / 110) * .42;
    this.sound.playWeapon(weapon, distanceScale);
    this.combatVisuals?.muzzle(player, weapon, player.aim);
    if (weapon.type === "spread") {
      for (let i = 0; i < weapon.pellets; i++) this.spawnProjectile(player, weapon, aimWithSpread(player.aim, weapon.spread));
      return;
    }
    if (weapon.type === "mine") return this.spawnMine(player, weapon);
    if (weapon.type === "beam") return this.fireBeam(player, weapon);
    if (weapon.type === "chain") return this.fireChain(player, weapon);
    if (weapon.type === "melee") return this.fireMelee(player, weapon);
    this.spawnProjectile(player, weapon, aimWithSpread(player.aim, weapon.spread));
  }

  spawnProjectile(player, weapon, direction, position = null) {
    const radius = weapon.projectileRadius ?? (weapon.type === "rocket" ? .25 : weapon.type === "plasma" ? .42 : weapon.type === "grenade" ? .28 : .11);
    const mesh = this.combatVisuals.createProjectile(player, weapon, radius);
    mesh.position.copy(position || player.forwardPoint(PROJECTILE_SPAWN_OFFSET));
    if (weapon.type === "rail") mesh.lookAt(mesh.position.clone().add(direction));
    const velocity = direction.clone().multiplyScalar(weapon.projectileSpeed);
    if (weapon.arcLift) velocity.y += weapon.arcLift;
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, owner: player, weapon, velocity, radius,
      life: projectileLifetime(weapon),
      age: 0, bounces: 0, hitTargets: new Set(),
      remainingPenetration: weapon.penetration || 0,
      remainingTerrainPenetration: weapon.terrainPenetration || 0,
      remote: weapon.type === "remote"
    });
  }

  fireBeam(player, weapon) {
    const start = player.forwardPoint(1.05);
    const direction = aimWithSpread(player.aim, weapon.spread).normalize();
    const wall = this.world.grapplePoint(start, direction);
    const end = wall || start.clone().addScaledVector(direction, 1000);
    const distance = start.distanceTo(end);
    const targets = [...this.players, ...this.decoys]
      .filter((target) => target !== player && target.alive)
      .map((target) => {
        const offset = target.position.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(start);
        const along = offset.dot(direction);
        const miss = offset.addScaledVector(direction, -along).length();
        return { target, along, miss };
      })
      .filter(({ target, along, miss }) => along > 0 && along < distance && miss < target.radius + .45)
      .sort((a, b) => a.along - b.along)
      .slice(0, (weapon.penetration || 0) + 1);
    for (const { target } of targets) {
      const push = weapon.beamPull
        ? player.position.clone().sub(target.position).normalize().multiplyScalar(weapon.beamPull)
        : direction.clone().multiplyScalar(weapon.recoil * 1.7);
      this.damageTarget(target, weapon.damage, push, player, weapon);
    }
    if (weapon.terrainRadius && wall) this.world.destroy(wall, weapon.terrainRadius);
    this.spawnTracer(start, end, weapon, player, .13);
  }

  fireChain(player, weapon) {
    const origin = player.forwardPoint(.9);
    const candidates = [...this.players, ...this.decoys]
      .filter((target) => target !== player && target.alive)
      .filter((target) => {
        const offset = target.position.clone().sub(origin);
        return offset.length() <= weapon.reach && offset.normalize().dot(player.aim) > .45 && this.world.lineOfSight(player.position, target.position);
      });
    let from = origin;
    let remaining = [...candidates];
    for (let jump = 0; jump < weapon.chains && remaining.length; jump++) {
      remaining.sort((a, b) => a.position.distanceToSquared(from) - b.position.distanceToSquared(from));
      const target = remaining.shift();
      if (jump > 0 && target.position.distanceTo(from) > 14) break;
      const end = target.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      this.spawnTracer(from, end, weapon, player, .18);
      this.damageTarget(target, Math.ceil(weapon.damage * Math.pow(.72, jump)), target.position.clone().sub(from).normalize().multiplyScalar(weapon.recoil * 1.5), player, weapon);
      from = end;
    }
    if (!candidates.length) this.spawnTracer(origin, origin.clone().addScaledVector(player.aim, 8), weapon, player, .1);
  }

  fireMelee(player, weapon) {
    const origin = player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
    const end = origin.clone().addScaledVector(player.aim, weapon.reach);
    for (const target of [...this.players, ...this.decoys]) {
      if (target === player || !target.alive) continue;
      const offset = target.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
      if (offset.length() > weapon.reach + target.radius || offset.normalize().dot(player.aim) < 1 - weapon.arc) continue;
      this.damageTarget(target, weapon.damage, player.aim.clone().multiplyScalar(weapon.recoil * 1.8).setY(weapon.recoil * .45), player, weapon);
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
      life: projectileLifetime(weapon), age: 0, mine: true
    });
  }

  updateProjectiles(dt) {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const shot = this.projectiles[index];
      shot.age += dt;
      shot.life -= dt;
      const explosive = Boolean(shot.weapon.radius);

      if (shot.mine) {
        shot.mesh.rotation.y += dt * 2;
        const target = [...this.players, ...this.decoys].find((player) => player !== shot.owner && player.alive && player.position.distanceTo(shot.mesh.position) < 3.1);
        if (target && shot.age > .45) shot.life = 0;
      } else if (!shot.stuck) {
        if (shot.weapon.returning && shot.age >= shot.weapon.returning) {
          const home = shot.owner.position.clone().add(new THREE.Vector3(0, 1.2, 0));
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
          const previous = shot.mesh.position.clone();
          shot.mesh.position.addScaledVector(shot.velocity, dt / steps);
          if (shot.weapon.returning) shot.mesh.rotation.y += dt * 18 / steps;
          const target = [...this.players, ...this.decoys].find((player) =>
            player !== shot.owner && player.alive && !shot.hitTargets.has(player.id) && projectileTouchesPlayer(player, shot.mesh.position, shot.radius)
          );
          if (target) {
            if (shot.weapon.type === "wall") {
              this.world.addTemporaryWall(target.position, shot.velocity, shot.weapon.color, shot.weapon.wallDuration);
              this.removeProjectile(index);
            } else if (shot.weapon.type === "decoy") {
              this.spawnDecoy(target.position, shot.owner, shot.weapon);
              this.removeProjectile(index);
            } else if (explosive) {
              this.finishProjectile(index, shot);
            } else {
              this.damageTarget(target, shot.weapon.damage, shot.velocity.clone().normalize().multiplyScalar(shot.weapon.recoil * 1.7), shot.owner, shot.weapon);
              this.combatVisuals?.impact(shot.mesh.position, shot.weapon, shot.owner, { size: .9 });
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
          if (this.world.projectileHit(shot.mesh.position, shot.radius)) {
            if (shot.weapon.type === "wall") {
              this.world.addTemporaryWall(previous, shot.velocity, shot.weapon.color, shot.weapon.wallDuration);
              this.removeProjectile(index);
              removed = true;
            } else if (shot.weapon.type === "decoy") {
              this.spawnDecoy(previous, shot.owner, shot.weapon);
              this.removeProjectile(index);
              removed = true;
            } else if (shot.weapon.effect === "teleport") {
              this.teleportOwner(shot.owner, previous, shot.velocity);
              this.removeProjectile(index);
              removed = true;
            } else if (shot.remainingTerrainPenetration > 0 && this.world.destroy(shot.mesh.position, shot.weapon.terrainRadius || 2)) {
              shot.remainingTerrainPenetration -= 1;
              shot.mesh.position.copy(previous).addScaledVector(shot.velocity.clone().normalize(), shot.radius * 3);
            } else if (shot.weapon.sticky || shot.remote) {
              shot.mesh.position.copy(previous);
              shot.velocity.set(0, 0, 0);
              shot.stuck = true;
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
      }
      this.combatVisuals?.updateProjectile(shot, dt);
      if (shot.life <= 0) {
        this.finishProjectile(index, shot);
      }
    }
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
  }

  finishProjectile(index, shot) {
    if (shot.weapon.split && !shot.split) this.splitProjectile(shot);
    else if (shot.weapon.radius) this.explode(shot);
    else this.combatVisuals?.impact(shot.mesh.position, shot.weapon, shot.owner, { size: 1.05 });
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
  }

  explode(shot) {
    const position = shot.mesh.position.clone();
    for (const target of [...this.players, ...this.decoys]) {
      if (!target.alive) continue;
      const distance = target.position.distanceTo(position);
      if (distance > shot.weapon.radius) continue;
      const factor = 1 - distance / shot.weapon.radius;
      const selfScale = target === shot.owner ? .35 : 1;
      const push = target.position.clone().sub(position).setY(.18).normalize().multiplyScalar((8 + shot.weapon.recoil) * factor * (shot.weapon.pull ? -1 : 1));
      this.damageTarget(target, Math.ceil(shot.weapon.damage * factor * selfScale), push, shot.owner, shot.weapon);
      if (shot.weapon.grappleDisrupt && target.grapple) this.releaseGrapple(target);
    }
    if (shot.weapon.terrainRadius > 0) this.world.destroy(position, shot.weapon.terrainRadius);
    if (shot.weapon.hazard) this.spawnHazard(position, shot.owner, shot.weapon);
    this.combatVisuals?.impact(position, shot.weapon, shot.owner, { size: Math.min(2.6, Math.max(1.35, shot.weapon.radius * .42)), explosive: true });
    this.sound.play("impact");
  }

  damageTarget(target, damage, push, attacker, weapon) {
    if (target.isDecoy) {
      target.health -= damage;
      this.spawnImpact(target.position, target);
      if (target.health <= 0) this.removeDecoy(target);
      return;
    }
    this.damagePlayer(target, damage, push, attacker, weapon);
    if (weapon.effect === "freeze") target.slowTimer = Math.max(target.slowTimer || 0, weapon.effectDuration || 2);
    if (weapon.effect === "steal" && target.alive) {
      target.ammo[target.weapon.id] = 0;
      attacker.ammo[attacker.weapon.id] = attacker.weapon.ammo;
    }
    if (weapon.effect === "teleport") this.teleportOwner(attacker, target.position, attacker.aim);
  }

  teleportOwner(player, point, direction) {
    if (!player?.alive) return;
    this.releaseGrapple(player);
    const destination = point.clone().addScaledVector(direction.clone().normalize(), -1.35);
    destination.y = Math.max(.2, destination.y);
    const previous = player.position.clone();
    player.position.copy(destination);
    this.world.resolve(player.position, player.radius, previous);
    player.velocity.set(0, 2.5, 0);
    this.spawnBurst(player.position, 0x43ffd1, 14);
  }

  spawnHazard(position, owner, weapon) {
    const hazardRadius = weapon.hazard === "black_hole" ? 9 : weapon.hazard === "tornado" ? 7 : 6;
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(hazardRadius * .48, .22, 8, 34),
      new THREE.MeshBasicMaterial({ color: weapon.color, transparent: true, opacity: .65, side: THREE.DoubleSide })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(position).setY(Math.max(.18, position.y));
    this.scene.add(mesh);
    this.hazards.push({ mesh, owner, weapon, radius: hazardRadius, life: weapon.hazardDuration, tick: 0 });
  }

  updateHazards(dt) {
    for (let index = this.hazards.length - 1; index >= 0; index--) {
      const hazard = this.hazards[index];
      hazard.life -= dt;
      hazard.tick -= dt;
      hazard.mesh.rotation.z += dt * (hazard.weapon.hazard === "tornado" ? 5 : 1.8);
      const pulse = 1 + Math.sin(hazard.life * 7) * .08;
      hazard.mesh.scale.setScalar(pulse);
      if (hazard.tick <= 0) {
        hazard.tick = .22;
        for (const player of this.players) {
          if (!player.alive) continue;
          const offset = player.position.clone().sub(hazard.mesh.position);
          const distance = offset.length();
          if (distance > hazard.radius) continue;
          const factor = 1 - distance / hazard.radius;
          let damage = 0;
          const push = new THREE.Vector3();
          if (hazard.weapon.hazard === "napalm") {
            damage = 4;
            push.set(0, 1.2, 0);
          } else if (hazard.weapon.hazard === "black_hole") {
            damage = 2;
            push.copy(offset).normalize().multiplyScalar(-14 * factor);
          } else {
            damage = 1;
            push.set(-offset.z, 8, offset.x).normalize().multiplyScalar(13 * factor).setY(7 * factor);
          }
          this.damagePlayer(player, Math.ceil(damage * (player === hazard.owner ? .35 : 1)), push, hazard.owner, hazard.weapon);
        }
      }
      if (hazard.life <= 0) {
        this.removeObject(hazard.mesh);
        this.hazards.splice(index, 1);
      }
    }
  }

  spawnDecoy(position, owner, weapon) {
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(.55, 1.25, 5, 10),
      new THREE.MeshStandardMaterial({ color: weapon.color, emissive: weapon.color, emissiveIntensity: .7, transparent: true, opacity: .72 })
    );
    const feet = position.clone();
    feet.y = this.world.surfaceHeightAt(feet, position.y + 1);
    mesh.position.copy(feet).add(new THREE.Vector3(0, 1.15, 0));
    this.scene.add(mesh);
    this.decoys.push({
      id: `decoy-${Math.random().toString(36).slice(2)}`,
      isDecoy: true, alive: true, health: 55, radius: .72,
      owner, weapon, mesh, position: feet, life: weapon.decoyDuration
    });
    this.spawnBurst(mesh.position, weapon.color, 10);
  }

  updateDecoys(dt) {
    for (let index = this.decoys.length - 1; index >= 0; index--) {
      const decoy = this.decoys[index];
      decoy.life -= dt;
      decoy.mesh.rotation.y += dt * 1.4;
      decoy.mesh.material.opacity = .58 + Math.sin(decoy.life * 9) * .14;
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
    }
    if (target === this.players[0] && attacker) {
      this.hud.damageVignette.style.setProperty("--damage-color", `#${new THREE.Color(attacker.accent).getHexString()}`);
      this.hud.damageVignette.classList.remove("visible");
      void this.hud.damageVignette.offsetWidth;
      this.hud.damageVignette.classList.add("visible");
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
    this.combatVisuals?.impact(center, impactWeapon, attacker || target, { size: level === "full" ? 1.25 : .9 });
    if (!this.settings.reducedMotion && this.settings.shake > 0 && target === this.players[0]) {
      this.camera.position.x += (Math.random() - .5) * this.settings.shake * .006;
    }
  }

  spawnBurst(position, color, count) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(.08 + Math.random() * .13),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .85 })
      );
      mesh.position.copy(position).add(new THREE.Vector3(0, 1.05, 0));
      const velocity = new THREE.Vector3((Math.random() - .5) * 7, 2 + Math.random() * 5, (Math.random() - .5) * 7);
      this.scene.add(mesh);
      this.effects.push({ mesh, velocity, life: .55 + Math.random() * .35 });
    }
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
    this.hud.root.dataset.playerState = actionState;
    this.hud.health.style.width = `${player.health}%`;
    this.hud.score.textContent = this.scores[0];
    this.hud.boardScore.forEach((node, index) => { node.textContent = this.scores[index]; });
    const leaderIndex = this.scores.indexOf(Math.max(...this.scores));
    this.hud.leaderName.textContent = this.players[leaderIndex].name;
    this.hud.leaderScore.textContent = this.scores[leaderIndex];
    const minutes = Math.floor(this.matchTime / 60).toString().padStart(2, "0");
    const seconds = Math.floor(this.matchTime % 60).toString().padStart(2, "0");
    this.hud.time.textContent = `${minutes}:${seconds}`;
    this.hud.grapple.textContent = player.grapple ? "GRAPPLE PULLING · RELEASE TO SLINGSHOT" : "GRAPPLE READY · E / RIGHT CLICK";
    this.hud.slots.forEach((slot, index) => slot.classList.toggle("selected", index === player.slotIndex));
    this.hud.ammo.forEach((node, index) => {
      const weapon = WEAPONS[player.loadout[index]];
      node.textContent = index === player.slotIndex && player.reloadTimer > 0 ? "RELOAD" : `${player.ammo[weapon.id]}/${weapon.ammo}`;
    });
    this.hud.scoreboard.classList.toggle("visible", this.input.down("Tab"));
    this.hud.motionVignette.style.setProperty("--motion", clamp((player.velocity.length() - 14) / 30, 0, 1).toFixed(3));
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
    node.textContent = `${Math.round(sample.fps)} FPS · ${this.renderer.info.render.calls} DRAWS · ${this.players.length} FIGHTERS · ${seconds}/60 SEC`;
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
    this.sound.play("win");
    this.bindUi();
  }

  updateCamera(dt = 1 / 60) {
    const cameraBlend = 1 - Math.exp(-11 * dt);
    const focusBlend = 1 - Math.exp(-15 * dt);
    const player = this.players[0];
    if (!player) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 62, cameraBlend);
      this.camera.updateProjectionMatrix();
      this.camera.position.lerp(new THREE.Vector3(0, 22, 29), cameraBlend);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    const forward = this.mouseAim();
    const flatForward = forward.clone().setY(0).normalize();
    const right = new THREE.Vector3(flatForward.z, 0, -flatForward.x);
    const pivot = player.position.clone().add(new THREE.Vector3(0, 1.65, 0));
    const desired = pivot.clone()
      .addScaledVector(flatForward, -8.25)
      .addScaledVector(right, 1.05)
      .add(new THREE.Vector3(0, 2.8 - this.cameraPitch * 1.8, 0));
    const speed = player.velocity.length();
    const targetFov = 62 + Math.min(11, Math.max(0, speed - 8) * .34) + (player.grapple ? 2.5 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, cameraBlend);
    this.camera.updateProjectionMatrix();
    let cameraTarget = this.world.constrainCamera(pivot, desired);
    if (cameraTarget.distanceTo(pivot) < 5.5) {
      const offset = desired.clone().sub(pivot);
      const alternatives = [-2.35, -1.57, -.78, .78, 1.57, 2.35, Math.PI].map((angle) =>
        this.world.constrainCamera(pivot, pivot.clone().add(offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)))
      );
      alternatives.push(
        this.world.constrainCamera(pivot, desired.clone().add(new THREE.Vector3(0, 5.2, 0))),
        this.world.constrainCamera(pivot, desired.clone().add(new THREE.Vector3(0, -3.2, 0)))
      );
      for (const candidate of alternatives) if (candidate.distanceTo(pivot) > cameraTarget.distanceTo(pivot)) cameraTarget = candidate;
    }
    this.camera.position.lerp(cameraTarget, cameraBlend);
    this.camera.position.copy(this.world.constrainCamera(pivot, this.camera.position));
    if (this.camera.position.distanceTo(pivot) < 3.2 && cameraTarget.distanceTo(pivot) > 4) this.camera.position.copy(cameraTarget);
    this.cameraClearance = { actual: this.camera.position.distanceTo(pivot), target: cameraTarget.distanceTo(pivot) };
    const motionLead = player.velocity.clone().setY(0).multiplyScalar(.08);
    const focus = pivot.addScaledVector(forward, 28).add(motionLead);
    if (this.cameraFocus.lengthSq() === 0) this.cameraFocus.copy(focus);
    else this.cameraFocus.lerp(focus, focusBlend);
    this.camera.lookAt(this.cameraFocus);
    if (!this.settings.reducedMotion) this.camera.rotateZ(clamp(-player.velocity.dot(right) * .0024, -.035, .035));
  }

  renderScene() {
    if (this.state !== "play" || this.paused) this.updateCamera();
    this.composer.render();
  }

  removeProjectile(index) {
    this.removeObject(this.projectiles[index].mesh);
    this.projectiles.splice(index, 1);
  }

  removeObject(object) {
    if (!object) return;
    this.scene.remove(object);
    object.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((entry) => entry.dispose?.());
      else child.material?.dispose?.();
    });
  }
}

new BlasterBattle();
