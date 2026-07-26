import * as THREE from "three";
import "./styles.css";
import { SoundBoard } from "./audio.js";
import { ArenaWorld } from "./world.js";
import { Fighter, aimWithSpread, applyGrapplePhysics, boostGrappleRelease, cameraRelative, directionFromKeys, projectileTouchesPlayer } from "./player.js";
import { InputManager, updateOrbit } from "./input.js";
import { DEFAULT_LOADOUT, loadSettings, MAP_THEMES, projectileStepCount, saveSettings, WEAPONS } from "./gameData.js";
import { botFireChance, chooseBotSlot } from "./botBrain.js";

const canvas = document.querySelector("#game-canvas");
const ui = document.querySelector("#ui-root");
const clamp = THREE.MathUtils.clamp;

const PLAYER_COLORS = [
  { color: 0x26d9ff, accent: 0xd9fbff },
  { color: 0xff416c, accent: 0xffd2dc }
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
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
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
    this.sound = new SoundBoard();
    this.settings = loadSettings();
    this.state = "menu";
    this.paused = false;
    this.mode = "training";
    this.seed = "BLAST-01";
    this.botDifficulty = "normal";
    this.world = null;
    this.players = [];
    this.projectiles = [];
    this.effects = [];
    this.respawnTimers = [0, 0];
    this.scores = [0, 0];
    this.matchTime = 180;
    this.targetScore = 10;
    this.touch = {};
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
    this.scene.add(new THREE.HemisphereLight(0x96d9ff, 0x10182a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-22, 40, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -135, right: 135, top: 135, bottom: -135, near: 1, far: 260 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff315f, 2);
    rim.position.set(22, 15, -25);
    this.scene.add(rim);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  clearMatch() {
    this.input.releasePointer();
    this.world?.dispose();
    for (const player of this.players) {
      this.releaseGrapple(player);
      player.dispose();
    }
    for (const shot of this.projectiles) this.removeObject(shot.mesh);
    for (const effect of this.effects) this.removeObject(effect.mesh);
    this.world = null;
    this.players = [];
    this.projectiles = [];
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
            <button data-mode="training"><span>TRAINING</span><small>Fight an adaptive bot</small></button>
          </div>
          <div class="secondary-actions">
            <button data-screen="settings">Settings</button>
            <button data-screen="credits">Credits</button>
          </div>
          <div class="capabilities" aria-label="Browser capability check">${checks}</div>
        </section>
        <aside class="feature-rail">
          <span>01</span><div><b>GRAPPLE</b><small>Momentum is your weapon</small></div>
          <span>02</span><div><b>8 WEAPONS</b><small>Carry five into combat</small></div>
          <span>03</span><div><b>SEEDED ARENAS</b><small>Share the same battleground</small></div>
        </aside>
      </main>`;
    this.bindUi();
  }

  renderSetup(mode) {
    this.mode = mode;
    const title = mode === "quick" ? "Quick Play" : mode === "private" ? "Private Room" : "Training";
    const detail = mode === "quick"
      ? "Enter the regional practice queue. The MVP fills the opposing slot with an authoritative bot."
      : mode === "private"
        ? "Use a short room code as the deterministic arena seed."
        : "Tune the bot and master movement, trajectories, recoil, and grappling.";
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
          </div>
          <section class="loadout-builder">
            <div><h2>Choose five weapons</h2><span data-loadout-count>${this.settings.loadout.length}/5 selected</span></div>
            <div class="weapon-grid">
              ${Object.values(WEAPONS).map((weapon) => `
                <button class="weapon-choice ${this.settings.loadout.includes(weapon.id) ? "selected" : ""}" data-weapon-choice="${weapon.id}">
                  <i style="--weapon:#${weapon.color.toString(16).padStart(6, "0")}"></i>
                  <b>${weapon.name}</b><small>${weapon.description}</small>
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
    this.scores = [0, 0];
    this.respawnTimers = [0, 0];
    this.matchTime = 180;
    this.world = new ArenaWorld(this.scene, this.seed);
    const spawns = this.world.spawnPoints();
    const playerLoadout = this.settings.loadout.length === 5 ? this.settings.loadout : DEFAULT_LOADOUT;
    const botLoadout = ["machine_gun", "shotgun", "rocket_launcher", "grenade_launcher", "railgun"];
    this.players = [
      new Fighter(this.scene, { id: "p1", name: this.settings.displayName, ...PLAYER_COLORS[0] }, playerLoadout, spawns[0]),
      new Fighter(this.scene, { id: "p2", name: this.mode === "quick" ? "Region Bot 07" : "Atlas Bot", ...PLAYER_COLORS[1] }, botLoadout, spawns[1], true)
    ];
    this.cameraYaw = Math.atan2(this.players[0].aim.x, this.players[0].aim.z);
    this.cameraPitch = -.08;
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
          <small>${this.mode.toUpperCase()} · ${escapeHtml(this.seed)}</small>
          <strong data-time>03:00</strong>
          <span>FIRST TO ${this.targetScore}</span>
        </section>
        <section class="combatant right">
          <div><span data-score="1">0</span><b>${escapeHtml(this.players[1].name)}</b></div>
          <div class="health"><i data-health="1"></i></div>
        </section>
        <div class="reticle" aria-hidden="true"><i></i></div>
        <div class="weapon-strip">
          ${this.players[0].loadout.map((id, index) => `
            <button data-weapon-slot="${index}" class="${index === 0 ? "selected" : ""}">
              <span>${index + 1}</span><b>${WEAPONS[id].name}</b><small data-ammo-slot="${index}"></small>
            </button>`).join("")}
        </div>
        <div class="grapple-readout" data-grapple>GRAPPLE READY · E / RIGHT CLICK</div>
        <button class="pause" data-action="pause" aria-label="Pause">Ⅱ</button>
        <div class="scoreboard" data-scoreboard>
          <h2>Deathmatch</h2>
          <p><b>${escapeHtml(this.players[0].name)}</b><span data-board-score="0">0</span></p>
          <p><b>${escapeHtml(this.players[1].name)}</b><span data-board-score="1">0</span></p>
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
      health: [...ui.querySelectorAll("[data-health]")],
      score: [...ui.querySelectorAll("[data-score]")],
      boardScore: [...ui.querySelectorAll("[data-board-score]")],
      time: ui.querySelector("[data-time]"),
      grapple: ui.querySelector("[data-grapple]"),
      scoreboard: ui.querySelector("[data-scoreboard]"),
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

  frame() {
    const dt = Math.min(.033, this.clock.getDelta());
    if (this.state === "play" && this.input.tapped("Escape")) this.togglePause();
    if (this.state === "play" && !this.paused) this.update(dt);
    this.renderScene();
    this.input.endFrame();
    requestAnimationFrame(() => this.frame());
  }

  update(dt) {
    this.matchTime = Math.max(0, this.matchTime - dt);
    this.handleWeaponSwitch();
    this.updateHuman(dt);
    this.updateBot(dt);
    this.updateProjectiles(dt);
    this.updateEffects(dt);
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
    if (!player.alive) return;
    let move = cameraRelative(directionFromKeys(this.input), this.cameraYaw + Math.PI);
    move.add(new THREE.Vector3(
      (this.touch.right ? 1 : 0) - (this.touch.left ? 1 : 0),
      0,
      (this.touch.down ? 1 : 0) - (this.touch.up ? 1 : 0)
    ).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4));
    if (move.lengthSq() > 1) move.normalize();
    const aim = this.mouseAim();
    player.update(dt, move, aim, { jump: this.input.tapped("Space") || this.touch.jumpTap }, this.world);
    this.touch.jumpTap = false;
    if (this.input.tapped("KeyE") || this.input.tapped("MouseRight") || this.touch.grappleTap) this.toggleGrapple(player);
    this.touch.grappleTap = false;
    this.updateGrapple(player, dt);
    if (this.input.tapped("KeyR")) player.reload();
    if (this.input.mouse.left || this.touch.fire) this.tryFire(player);
  }

  updateBot(dt) {
    const bot = this.players[1];
    const target = this.players[0];
    if (!bot.alive || !target.alive) return;
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
    const preferred = bot.weapon.type === "spread" ? 8 : bot.weapon.type === "rail" ? 24 : 15;
    const move = side.multiplyScalar(.62);
    if (distance > preferred + 3) move.add(forward);
    if (distance < preferred - 3) move.addScaledVector(forward, -1);
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
    const anchor = this.world.grapplePoint(start, player.aim);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, anchor]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: player.accent }));
    this.scene.add(line);
    player.grapple = { anchor, line, ropeLength: Math.max(5, start.distanceTo(anchor) * .92) };
    const direction = anchor.clone().sub(start).normalize();
    const approachSpeed = player.velocity.dot(direction);
    if (approachSpeed < 12) player.velocity.addScaledVector(direction, 12 - approachSpeed);
    this.sound.play("power");
  }

  updateGrapple(player, dt) {
    if (!player.grapple || !player.alive) return;
    applyGrapplePhysics(player, dt);
    const chest = player.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    player.grapple.line.geometry.setFromPoints([chest, player.grapple.anchor]);
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
    if (player.ammo[weapon.id] <= 0) {
      player.reload();
      return;
    }
    player.attackTimer = weapon.cooldown;
    player.ammo[weapon.id] -= 1;
    player.recoil();
    this.sound.play(weapon.type === "rail" ? "impact" : "power");
    if (weapon.type === "spread") {
      for (let i = 0; i < weapon.pellets; i++) this.spawnProjectile(player, weapon, aimWithSpread(player.aim, weapon.spread));
      return;
    }
    if (weapon.type === "mine") return this.spawnMine(player, weapon);
    this.spawnProjectile(player, weapon, aimWithSpread(player.aim, weapon.spread));
  }

  spawnProjectile(player, weapon, direction) {
    const radius = weapon.type === "rocket" ? .25 : weapon.type === "plasma" ? .42 : weapon.type === "grenade" ? .28 : .11;
    const mesh = new THREE.Mesh(
      weapon.type === "rail" ? new THREE.BoxGeometry(.09, .09, 1.5) : new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshStandardMaterial({ color: weapon.color, emissive: weapon.color, emissiveIntensity: 1.2 })
    );
    mesh.position.copy(player.forwardPoint(1.2));
    if (weapon.type === "rail") mesh.lookAt(mesh.position.clone().add(direction));
    const velocity = direction.clone().multiplyScalar(weapon.projectileSpeed);
    if (weapon.type === "grenade") velocity.y = 7.5;
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, owner: player, weapon, velocity, radius,
      life: weapon.type === "grenade" ? weapon.fuse : weapon.range / weapon.projectileSpeed,
      age: 0, bounces: 0
    });
  }

  spawnMine(player, weapon) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(.32, .42, .18, 10),
      new THREE.MeshStandardMaterial({ color: weapon.color, emissive: weapon.color, emissiveIntensity: .8 })
    );
    mesh.position.copy(player.forwardPoint(1.3)).setY(.12);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, owner: player, weapon, velocity: new THREE.Vector3(), radius: .35,
      life: weapon.fuse, age: 0, mine: true
    });
  }

  updateProjectiles(dt) {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const shot = this.projectiles[index];
      shot.age += dt;
      shot.life -= dt;
      const explosive = ["rocket", "grenade", "plasma", "mine"].includes(shot.weapon.type);

      if (shot.mine) {
        shot.mesh.rotation.y += dt * 2;
        const target = this.players.find((player) => player !== shot.owner && player.alive && player.position.distanceTo(shot.mesh.position) < 3.1);
        if (target && shot.age > .45) shot.life = 0;
      } else {
        if (shot.weapon.type === "grenade") shot.velocity.y -= 17 * dt;
        const steps = projectileStepCount(shot.velocity.length(), dt, shot.radius);
        let removed = false;
        for (let step = 0; step < steps; step++) {
          shot.mesh.position.addScaledVector(shot.velocity, dt / steps);
          const target = this.players.find((player) => player !== shot.owner && projectileTouchesPlayer(player, shot.mesh.position, shot.radius));
          if (target) {
            if (explosive) {
              this.explode(shot);
            } else {
              this.damagePlayer(target, shot.weapon.damage, shot.velocity.clone().normalize().multiplyScalar(shot.weapon.recoil * 1.7), shot.owner);
              this.spawnImpact(shot.mesh.position, target);
            }
            this.removeProjectile(index);
            removed = true;
            break;
          }
          if (this.world.projectileHit(shot.mesh.position, shot.radius)) {
            if (shot.weapon.type === "grenade" && shot.bounces < 2 && shot.life > .2) {
              shot.bounces += 1;
              shot.mesh.position.y = Math.max(.35, this.world.surfaceHeightAt(shot.mesh.position) + shot.radius);
              shot.velocity.y = Math.abs(shot.velocity.y) * .62 + 2.5;
              shot.velocity.x *= -.55;
              shot.velocity.z *= -.55;
            } else {
              if (explosive) this.explode(shot);
              this.removeProjectile(index);
              removed = true;
            }
            break;
          }
        }
        if (removed) continue;
      }
      if (shot.life <= 0) {
        if (explosive) this.explode(shot);
        this.removeProjectile(index);
      }
    }
  }

  explode(shot) {
    const position = shot.mesh.position.clone();
    for (const player of this.players) {
      if (!player.alive) continue;
      const distance = player.position.distanceTo(position);
      if (distance > shot.weapon.radius) continue;
      const factor = 1 - distance / shot.weapon.radius;
      const selfScale = player === shot.owner ? .35 : 1;
      const push = player.position.clone().sub(position).setY(.18).normalize().multiplyScalar((8 + shot.weapon.recoil) * factor);
      this.damagePlayer(player, Math.ceil(shot.weapon.damage * factor * selfScale), push, shot.owner);
    }
    this.world.destroy(position, shot.weapon.terrainRadius || 0);
    this.spawnBurst(position, shot.weapon.color, this.settings.reducedMotion ? 8 : 18);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.5, .72, 34),
      new THREE.MeshBasicMaterial({ color: shot.weapon.color, transparent: true, opacity: .72, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position).setY(.08);
    this.scene.add(ring);
    this.effects.push({ mesh: ring, velocity: new THREE.Vector3(), life: .45, ring: true, maxScale: shot.weapon.radius * 1.8 });
    this.sound.play("impact");
  }

  damagePlayer(target, damage, push, attacker) {
    const killed = target.takeHit(damage, push);
    this.spawnImpact(target.position, target);
    if (!killed) return;
    this.releaseGrapple(target);
    const attackerIndex = this.players.indexOf(attacker);
    const targetIndex = this.players.indexOf(target);
    if (attackerIndex >= 0 && attacker !== target) this.scores[attackerIndex] += 1;
    this.respawnTimers[targetIndex] = 2.2;
  }

  spawnImpact(position, target) {
    const level = this.settings.blood;
    const color = level === "off" ? 0x6feeff : 0xff315f;
    const count = level === "full" ? 10 : level === "reduced" ? 4 : 3;
    this.spawnBurst(position, color, count);
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
      if (effect.ring) {
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
      if (this.players[index].alive || this.respawnTimers[index] <= 0) continue;
      this.respawnTimers[index] -= dt;
      if (this.respawnTimers[index] <= 0) {
        const spawns = this.world.spawnPoints();
        const opponent = this.players[1 - index];
        spawns.sort((a, b) => b.distanceToSquared(opponent.position) - a.distanceToSquared(opponent.position));
        this.players[index].respawn(spawns[0]);
      }
    }
  }

  updateHud() {
    this.players.forEach((player, index) => {
      this.hud.health[index].style.width = `${player.health}%`;
      this.hud.score[index].textContent = this.scores[index];
      this.hud.boardScore[index].textContent = this.scores[index];
    });
    const minutes = Math.floor(this.matchTime / 60).toString().padStart(2, "0");
    const seconds = Math.floor(this.matchTime % 60).toString().padStart(2, "0");
    this.hud.time.textContent = `${minutes}:${seconds}`;
    const player = this.players[0];
    this.hud.grapple.textContent = player.grapple ? "GRAPPLE PULLING · RELEASE TO SLINGSHOT" : "GRAPPLE READY · E / RIGHT CLICK";
    this.hud.slots.forEach((slot, index) => slot.classList.toggle("selected", index === player.slotIndex));
    this.hud.ammo.forEach((node, index) => {
      const weapon = WEAPONS[player.loadout[index]];
      node.textContent = index === player.slotIndex && player.reloadTimer > 0 ? "RELOAD" : `${player.ammo[weapon.id]}/${weapon.ammo}`;
    });
    this.hud.scoreboard.classList.toggle("visible", this.input.down("Tab"));
  }

  finishMatch() {
    if (this.state !== "play") return;
    this.state = "results";
    this.paused = true;
    this.input.releasePointer();
    const winnerIndex = this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1;
    const headline = winnerIndex < 0 ? "Draw match" : `${escapeHtml(this.players[winnerIndex].name)} wins`;
    ui.insertAdjacentHTML("beforeend", `
      <div class="overlay results">
        <section class="dialog results-dialog">
          <p>MATCH COMPLETE</p><h1>${headline}</h1>
          <div class="final-score"><span>${this.scores[0]}</span><i>—</i><span>${this.scores[1]}</span></div>
          <button class="primary" data-action="rematch">REMATCH · SAME SEED</button>
          <button data-screen="main">RETURN TO MENU</button>
        </section>
      </div>`);
    this.sound.play("win");
    this.bindUi();
  }

  updateCamera() {
    const player = this.players[0];
    if (!player) {
      this.camera.position.lerp(new THREE.Vector3(0, 22, 29), .08);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    const forward = player.aim.clone();
    const flatForward = forward.clone().setY(0).normalize();
    const right = new THREE.Vector3(flatForward.z, 0, -flatForward.x);
    const pivot = player.position.clone().add(new THREE.Vector3(0, 1.65, 0));
    const desired = pivot.clone()
      .addScaledVector(flatForward, -10)
      .addScaledVector(right, 1.15)
      .add(new THREE.Vector3(0, 3.5 - this.cameraPitch * 2.2, 0));
    this.camera.position.lerp(desired, .16);
    const focus = pivot.addScaledVector(forward, 28);
    this.camera.lookAt(focus);
  }

  renderScene() {
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  removeProjectile(index) {
    this.removeObject(this.projectiles[index].mesh);
    this.projectiles.splice(index, 1);
  }

  removeObject(object) {
    if (!object) return;
    this.scene.remove(object);
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  }
}

new BlasterBattle();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
