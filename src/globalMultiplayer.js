import { MultiplayerClient } from "./multiplayer.js";
import "./globalMultiplayer.css";
import { ARENA_REVISION, sanitizeLoadoutSlots, sanitizePlayerName } from "./multiplayerProtocol.js";
import { activePresetLoadout, saveSettings, WEAPONS } from "./gameData.js";
import TEXT, { formatText } from "./playerText.js";

const copy = TEXT.globalLobby;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function stored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function remember(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

export class GlobalMultiplayer {
  constructor(game, ui, atmosphere) {
    this.game = game;
    this.ui = ui;
    this.atmosphere = atmosphere;
    const identity = stored("master-blaster-global-identity", "");
    this.identity = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(identity) ? identity : crypto.randomUUID();
    remember("master-blaster-global-identity", this.identity);
    const favorites = stored("master-blaster-global-favorites", []);
    this.favorites = new Set(Array.isArray(favorites) ? favorites.filter((id) => typeof id === "string") : []);
    this.snapshot = { players: [], rooms: [] };
    this.slots = Array(5).fill(null);
    this.options = {};
    this.countdownTimer = 0;
  }

  shell(body) {
    return `<main class="screen menu-scene setup-scene" data-menu-scene="private" data-menu-quality="${this.game.settings.graphics}" style="--menu-energy:.34;--menu-accent:#52e9ff">${this.atmosphere("private")}<section class="dialog global-dialog">${body}</section></main>`;
  }

  async open() {
    this.leaveRound();
    this.game.mode = "global";
    this.game.state = "global";
    this.renderLobby();
    if (this.directory?.connected) { this.updateLobby(); return; }
    this.directory?.close();
    const client = new MultiplayerClient();
    this.directory = client;
    client.addEventListener("message", ({ detail }) => {
      if (this.directory !== client || !["welcome", "global_lobby"].includes(detail.type)) return;
      this.snapshot = detail;
      this.updateLobby();
    });
    client.addEventListener("reconnecting", () => { if (this.directory === client) this.connectionStatus(copy.connectionLost); });
    client.addEventListener("reconnected", () => { if (this.directory === client) this.connectionStatus(""); });
    client.addEventListener("disconnect", () => { if (this.directory === client) this.connectionStatus(TEXT.errors.connectionDescription, true); });
    try {
      await client.connect({ mode: "directory", roomCode: "GLOBAL", name: this.game.settings.displayName, identity: this.identity });
      if (this.directory === client) { this.connectionStatus(""); this.updateLobby(); }
    } catch {
      if (this.directory === client) this.connectionStatus(TEXT.errors.couldNotConnect, true);
    }
  }

  close() { this.clearCountdown(); this.directory?.close(); this.directory = null; }
  clearCountdown() { clearInterval(this.countdownTimer); this.countdownTimer = 0; }

  leaveRound() {
    this.joinNonce = (this.joinNonce || 0) + 1;
    this.joining = false;
    this.clearCountdown();
    if (this.game.mode === "global") this.game.multiplayer?.send("lobby_leave");
    this.game.clearMatch();
  }

  connectionStatus(message, retry = false) {
    const node = this.ui.querySelector("[data-global-status]");
    if (node) node.innerHTML = `${esc(message)}${retry ? ` <button data-global="retry">${copy.retry}</button>` : ""}`;
    this.updateLobby();
  }

  renderLobby() {
    this.game.state = "global";
    this.game.paused = false;
    this.game.sound.setPaused(false);
    this.game.sound.setMusicScene("menu");
    this.game.sound.startMusic("menu", this.game.seed);
    this.ui.innerHTML = this.shell(`<header><button class="back" data-screen="main">${TEXT.setup.back}</button><p>${copy.section}</p></header><h1>${copy.title}</h1><p class="dialog-lead">${copy.description}</p><div class="global-toolbar"><label>${TEXT.setup.labels.displayName}<input id="display-name" maxlength="18" value="${esc(this.game.settings.displayName)}"></label><button class="primary" data-global="create">${copy.create}</button></div><p class="loadout-status" data-global-status role="status"></p><div class="global-columns"><section><div class="lobby-heading"><h2>${copy.open}</h2><span data-global-room-count></span></div><div data-global-rooms></div></section><aside><div class="lobby-heading"><h2>${copy.online}</h2><span data-global-player-count></span></div><p class="global-help">${copy.favoritesNote}</p><div data-global-players></div></aside></div>`);
    this.game.bindUi();
    this.updateLobby();
  }

  updateLobby() {
    const root = this.ui.querySelector("[data-global-rooms]");
    if (!root) return;
    const connected = this.directory?.connected;
    this.ui.querySelector('[data-global="create"]').disabled = !connected;
    const { rooms, players } = this.snapshot;
    this.ui.querySelector("[data-global-room-count]").textContent = String(rooms.length);
    this.ui.querySelector("[data-global-player-count]").textContent = String(players.length);
    const join = (room) => {
      const full = room.players.length >= room.capacity, compatible = room.arenaRevision === ARENA_REVISION;
      return `<button data-global-join="${esc(room.roomCode)}" ${full || !compatible || !connected ? "disabled" : ""}>${!compatible ? copy.version : full ? copy.full : copy.join}</button>`;
    };
    root.innerHTML = rooms.length ? rooms.map((room) => `<article class="global-round"><div><h3>${esc(room.name)}</h3><p>${esc(formatText(copy.hosted, { name: room.hostName }))}</p><small>${formatText(copy.players, { count: room.players.length, capacity: room.capacity, bots: room.bots })}</small><p class="global-help">${room.players.map((player) => esc(player.name)).join(" · ")}</p></div>${join(room)}</article>`).join("") : `<p class="dialog-lead">${connected ? copy.empty : copy.noneOnline}</p>`;
    const sorted = [...players].sort((a, b) => Number(this.favorites.has(b.id)) - Number(this.favorites.has(a.id)) || a.name.localeCompare(b.name));
    this.ui.querySelector("[data-global-players]").innerHTML = sorted.map((player) => {
      const favorite = this.favorites.has(player.id), room = rooms.find((entry) => entry.roomCode === player.roomCode);
      return `<div class="global-person"><button class="global-star" data-global-favorite="${esc(player.id)}" aria-pressed="${favorite}" aria-label="${esc(formatText(favorite ? copy.unfavorite : copy.favorite, { name: player.name }))}">${favorite ? "★" : "☆"}</button><div><b>${esc(player.name)}${player.id === this.directory?.playerId ? ` <span>${copy.you}</span>` : ""}</b><small>${player.roomCode && player.status === "lobby" ? copy.statuses.waiting : copy.statuses[player.status] || copy.statuses.lobby}</small></div>${room ? join(room) : ""}</div>`;
    }).join("");
  }

  renderCreate() {
    this.game.state = "global-create";
    this.ui.innerHTML = this.shell(`<header><button class="back" data-global="back">${copy.back}</button><p>${copy.section}</p></header><h1>${copy.create}</h1><p class="dialog-lead">${copy.createDescription}</p><div class="setup-form global-create-form"><label>${copy.roomName}<input id="global-name" maxlength="18" value="${esc(formatText(copy.defaultName, { name: this.game.settings.displayName }).slice(0, 18))}"></label><label>${copy.capacity}<select id="global-capacity">${[2,3,4,6,8,12,16].map((n) => `<option ${n === 4 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>${copy.bots}<input id="global-bots" type="number" min="0" max="12" step="1" value="2"></label><label>${TEXT.setup.labels.timeLimit}<input id="global-minutes" type="number" min="1" max="30" step="1" value="3"></label><label>${TEXT.setup.labels.botDifficulty}<select id="global-difficulty">${["rookie", "normal", "veteran"].map((level) => `<option value="${level}" ${level === "normal" ? "selected" : ""}>${TEXT.setup.difficulties[level]}</option>`).join("")}</select></label></div><p class="global-help">${copy.capacityHint}</p><p data-global-status class="loadout-status" role="status"></p><button class="launch primary" data-global="open">${copy.create}</button>`);
    this.game.bindUi();
  }

  async join(code = "", create = false) {
    if (!this.directory?.connected || this.joining) return;
    this.joining = true;
    const nonce = this.joinNonce = (this.joinNonce || 0) + 1;
    this.game.mode = "global";
    this.game.seed = code || `G-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`.toUpperCase();
    this.slots = sanitizeLoadoutSlots(activePresetLoadout(this.game.settings) || [], WEAPONS);
    this.options = { identity: this.identity, create: create ? 1 : 0 };
    if (create) {
      this.options.roomName = sanitizePlayerName(this.ui.querySelector("#global-name").value);
      this.options.humanCapacity = Number(this.ui.querySelector("#global-capacity").value);
      this.game.settings.botCount = Math.max(0, Math.min(16 - this.options.humanCapacity, Math.trunc(Number(this.ui.querySelector("#global-bots").value)) || 0));
      this.game.timeLimitMinutes = Math.max(1, Math.min(30, Math.trunc(Number(this.ui.querySelector("#global-minutes").value)) || 3));
      this.game.botDifficulty = this.ui.querySelector("#global-difficulty").value;
    }
    const epoch = this.directory;
    this.connectionStatus(copy.connecting);
    try {
      const welcome = await this.game.connectOnlineMatch();
      if (this.directory !== epoch || nonce !== this.joinNonce) return;
      this.renderRoom(welcome);
    } catch {
      if (nonce !== this.joinNonce) return;
      this.game.multiplayer?.close(); this.game.multiplayer = null;
      if (this.directory === epoch) { this.renderLobby(); this.connectionStatus(copy.joinFailed); }
    } finally { if (nonce === this.joinNonce) this.joining = false; }
  }

  renderRoom(message) {
    const game = this.game;
    if (game.world) game.clearMatch(true);
    game.state = "lobby";
    game.paused = false;
    game.privateLobby = { ...(game.privateLobby || {}), ...message };
    game.setMatchLoading(false);
    game.sound.setPaused(false); game.sound.setMusicScene("menu"); game.sound.startMusic("menu", game.seed);
    const local = message.players?.find((player) => player.id === game.multiplayer?.playerId);
    if (message.type === "welcome" && local?.pendingLoadout) this.slots = [...local.pendingLoadout];
    const lobby = game.privateLobby, host = lobby.hostId === game.multiplayer?.playerId, countdown = lobby.phase === "countdown";
    if (!this.ui.querySelector("[data-global-waiting]")) {
      this.ui.innerHTML = this.shell(`<div data-global-waiting><header><button class="back" data-global="leave">${copy.back}</button><p>${copy.section}</p></header><h1>${esc(lobby.roomName)}</h1><p class="dialog-lead" data-global-room-heading></p><div data-global-countdown role="status"></div><div class="lobby-heading"><h2>${TEXT.privateLobby.roster}</h2><span data-global-round-count></span></div><div class="lobby-roster global-roster" data-global-roster></div><div class="global-room-settings" data-global-room-settings></div><section class="loadout-builder"><div><h2>${copy.weapons}</h2><span data-global-selected></span></div><p class="global-help">${copy.slotHelp}</p><div class="loadout-order" data-global-slots></div><p class="global-loadout-note">${copy.randomHelp}</p><p class="loadout-status" data-global-save role="status"></p><div class="global-room-start" data-global-start></div><div class="weapon-categories">${game.weaponCategoriesMarkup(this.slots)}</div></section></div>`);
      game.bindUi();
    }
    this.ui.querySelector("[data-global-room-heading]").textContent = countdown ? copy.joinsClosed : host ? copy.waitingRoom : formatText(copy.hosted, { name: lobby.players.find((p) => p.id === lobby.hostId)?.name || "" });
    const humans = lobby.players.filter((p) => !p.bot).sort((a, b) => Number(b.id === lobby.hostId) - Number(a.id === lobby.hostId) || a.name.localeCompare(b.name));
    this.ui.querySelector("[data-global-round-count]").textContent = formatText(copy.players, { count: humans.length, capacity: lobby.humanCapacity, bots: lobby.configuredBotCount });
    this.ui.querySelector("[data-global-roster]").innerHTML = humans.map((p) => `<div><i style="--fighter:#${Number(p.accent || 0x52e9ff).toString(16).padStart(6,"0")}"></i><b>${esc(p.name)}</b><span>${p.id === lobby.hostId ? copy.host : ""}${p.id === game.multiplayer.playerId ? ` · ${copy.you}` : ""}</span></div>`).join("") + Array.from({ length: Math.max(0, lobby.humanCapacity - humans.length) }, () => `<div class="global-open-slot"><i></i><b>${countdown ? copy.closedSpot : copy.openSpot}</b></div>`).join("");
    this.ui.querySelector("[data-global-room-settings]").innerHTML = `<p class="global-help">${copy.capacityHint}</p><label>${copy.bots}${host ? `<select data-global-bots ${countdown ? "disabled" : ""}>${Array.from({ length: 17 - lobby.humanCapacity }, (_, n) => `<option ${n === lobby.configuredBotCount ? "selected" : ""}>${n}</option>`).join("")}</select>` : `: ${lobby.configuredBotCount}`}</label>`;
    this.ui.querySelector("[data-global-start]").innerHTML = `<p>${countdown ? copy.countdownHelp : !host ? copy.waitHost : humans.length < 2 ? copy.waitPlayer : copy.ready}</p>${host ? `<button class="primary" data-global="${countdown ? "cancel" : "start"}" ${humans.length < 2 || !game.multiplayer?.connected ? "disabled" : ""}>${countdown ? copy.cancel : copy.start}</button>` : ""}`;
    this.updateSlots();
    if (local?.pendingLoadout && local.pendingLoadout.every((id, index) => id === this.slots[index])) this.ui.querySelector("[data-global-save]").textContent = copy.saved;
    this.clearCountdown();
    const banner = this.ui.querySelector("[data-global-countdown]");
    banner.innerHTML = countdown ? `<div class="global-countdown"><strong data-global-seconds></strong><div><h2>${copy.getReady}</h2><p>${copy.countdownHelp}</p></div></div>` : "";
    if (countdown) {
      const deadline = performance.now() + Math.max(0, lobby.startsAt - lobby.serverTime);
      const tick = () => {
        const node = this.ui.querySelector("[data-global-seconds]");
        if (!node) { this.clearCountdown(); return; }
        node.textContent = String(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
      };
      tick(); this.countdownTimer = setInterval(tick, 100);
    }
  }

  updateSlots() {
    const order = this.ui.querySelector("[data-global-slots]");
    if (!order) return;
    order.innerHTML = this.game.loadoutOrderMarkup(this.slots).replaceAll(TEXT.setup.loadout.emptySlot, copy.emptySlot);
    this.ui.querySelector("[data-global-selected]").textContent = formatText(copy.selected, { count: this.slots.filter(Boolean).length });
    for (const button of this.ui.querySelectorAll("[data-weapon-choice]")) {
      const index = this.slots.indexOf(button.dataset.weaponChoice);
      button.classList.toggle("selected", index >= 0);
      button.dataset.slot = index >= 0 ? String(index + 1) : "";
      button.setAttribute("aria-pressed", String(index >= 0));
    }
  }

  sendSlots() {
    this.updateSlots();
    const sent = this.game.multiplayer?.send("lobby_loadout", { loadout: this.slots });
    const status = this.ui.querySelector("[data-global-save]");
    if (status) status.textContent = sent ? copy.saving : copy.connectionLost;
  }

  handleClick(button) {
    const action = button.dataset.global;
    if (button.dataset.globalJoin) { void this.join(button.dataset.globalJoin); return true; }
    if (button.dataset.globalFavorite) {
      const id = button.dataset.globalFavorite;
      if (this.favorites.has(id)) this.favorites.delete(id); else this.favorites.add(id);
      remember("master-blaster-global-favorites", [...this.favorites]); this.updateLobby(); return true;
    }
    if (action) {
      if (action === "retry") void this.open();
      if (action === "create") this.renderCreate();
      if (action === "back") { if (this.joining) this.leaveRound(); this.renderLobby(); }
      if (action === "open") void this.join("", true);
      if (action === "leave") { this.leaveRound(); this.renderLobby(); }
      if (action === "start") this.game.multiplayer?.send("lobby_start");
      if (action === "cancel") this.game.multiplayer?.send("lobby_cancel");
      return true;
    }
    if (this.game.mode !== "global" || this.game.state !== "lobby") return false;
    if (button.dataset.weaponChoice) {
      const id = button.dataset.weaponChoice, current = this.slots.indexOf(id), empty = this.slots.indexOf(null);
      if (current >= 0) this.slots[current] = null; else if (empty >= 0) this.slots[empty] = id;
      this.sendSlots(); return true;
    }
    if (button.dataset.loadoutRemove !== undefined) { this.slots[Number(button.dataset.loadoutRemove)] = null; this.sendSlots(); return true; }
    if (button.dataset.loadoutMove !== undefined) {
      const from = Number(button.dataset.loadoutMove), to = from + Number(button.dataset.direction);
      this.moveSlot(from, to); return true;
    }
    return false;
  }

  moveSlot(from, to) {
    if (![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < 5)) return;
    [this.slots[from], this.slots[to]] = [this.slots[to], this.slots[from]];
    this.sendSlots();
  }

  handleChange(event) {
    if (this.game.mode !== "global") return false;
    if (event.target.id === "display-name") {
      this.game.settings.displayName = sanitizePlayerName(event.target.value);
      saveSettings(this.game.settings);
      this.directory?.send("profile", { name: this.game.settings.displayName });
      if (this.directory?.options) this.directory.options.name = this.game.settings.displayName;
    }
    if (event.target.id === "global-capacity") {
      const bots = this.ui.querySelector("#global-bots");
      bots.max = String(16 - Number(event.target.value));
      bots.value = String(Math.min(Number(bots.value), Number(bots.max)));
    }
    if (event.target.hasAttribute("data-global-bots")) this.game.multiplayer?.send("lobby_settings", { botCount: Number(event.target.value) });
    return ["global", "global-create", "lobby"].includes(this.game.state);
  }
}
