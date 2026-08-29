import {
  MULTIPLAYER_PROTOCOL_VERSION,
  NETWORK_TICK_MS,
  normalizeRoomCode,
  parseClientMessage,
  socketUrl
} from "./multiplayerProtocol.js";
import TEXT, { formatText } from "./playerText.js";

function apiOrigin() {
  const configured = import.meta.env?.VITE_MULTIPLAYER_ORIGIN;
  if (configured) return new URL(configured, location.href).origin;
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return "http://127.0.0.1:8787";
  return location.origin;
}

export class MultiplayerClient extends EventTarget {
  constructor(roomTimeout = 10_000, retryDelay = 350) {
    super();
    this.roomTimeout = roomTimeout;
    this.retryDelay = retryDelay;
    this.socket = null;
    this.roomCode = "";
    this.playerId = "";
    this.botHostId = "";
    this.welcome = null;
    this.lastStateAt = 0;
    this.closedByClient = false;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get controlsBots() {
    return Boolean(this.playerId && this.playerId === this.botHostId);
  }

  async connect(options) {
    try {
      return await this.connectOnce(options);
    } catch (error) {
      if (options.mode !== "quick" || error.message !== TEXT.errors.roomTimeout) throw error;
      const failedRoomCode = this.roomCode;
      await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      return this.connectOnce(options, failedRoomCode);
    }
  }

  async connectOnce({ mode, roomCode, name, loadout, botCount, difficulty, timeLimitMinutes }, excludeRoomCode = "") {
    this.close();
    this.closedByClient = false;
    const origin = apiOrigin();
    if (mode === "quick") {
      let response;
      try {
        response = await fetch(new URL("/api/quick", origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ botCount, difficulty, timeLimitMinutes, excludeRoomCode })
        });
      } catch {
        throw new Error(TEXT.errors.couldNotConnect);
      }
      if (!response.ok) throw new Error(formatText(TEXT.errors.matchmakingUnavailable, { status: response.status }));
      let assignment;
      try { assignment = await response.json(); }
      catch { throw new Error(TEXT.errors.couldNotConnect); }
      roomCode = assignment.roomCode;
    }
    this.roomCode = normalizeRoomCode(roomCode);
    if (!this.roomCode) throw new Error(TEXT.errors.invalidRoomCode);
    const url = socketUrl(origin, this.roomCode, {
      v: MULTIPLAYER_PROTOCOL_VERSION,
      name,
      loadout,
      mode,
      botCount,
      difficulty,
      timeLimitMinutes
    });
    let socket;
    try { socket = new WebSocket(url); }
    catch { throw new Error(TEXT.errors.couldNotConnect); }
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let joined = false;
      const timeout = setTimeout(() => {
        socket.close(4000, TEXT.errors.roomTimeout);
        reject(new Error(TEXT.errors.roomTimeout));
      }, this.roomTimeout);
      socket.addEventListener("message", (event) => {
        if (socket !== this.socket) return;
        const message = parseClientMessage(event.data);
        if (!message) return;
        if (message.type === "welcome") {
          joined = true;
          clearTimeout(timeout);
          this.playerId = message.playerId;
          this.botHostId = message.botHostId;
          this.welcome = message;
          resolve(message);
        }
        if (message.botHostId) this.botHostId = message.botHostId;
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        if (!joined) reject(new Error(TEXT.errors.couldNotConnect));
      }, { once: true });
      socket.addEventListener("close", (event) => {
        clearTimeout(timeout);
        const knownReason = [TEXT.errors.invalidSessionState, TEXT.errors.deliveryFailed].includes(event.reason) ? event.reason : "";
        const reason = knownReason || (joined ? TEXT.errors.connectionDescription : TEXT.errors.roomClosedBeforeJoining);
        this.dispatchEvent(new CustomEvent("disconnect", { detail: { code: event.code, reason, expected: this.closedByClient || socket !== this.socket } }));
        if (!joined) reject(new Error(reason));
      });
    });
  }

  send(type, payload = {}) {
    if (!this.connected) return false;
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  startPrivateMatch() {
    return this.send("lobby_start");
  }

  sendState(players, now = performance.now()) {
    if (now - this.lastStateAt < NETWORK_TICK_MS) return false;
    this.lastStateAt = now;
    return this.send("state", {
      players: players.map((player) => ({
        id: player.id,
        position: player.position,
        velocity: player.velocity,
        aim: player.aim,
        slotIndex: player.slotIndex,
        grounded: player.grounded
      }))
    });
  }

  fire(player, weapon, direction, triggerTap = false, action = "fire", chargeRatio = 1) {
    return this.send("fire", {
      playerId: player.id,
      weaponId: weapon.id,
      slotIndex: player.slotIndex,
      direction,
      triggerTap,
      action,
      chargeRatio
    });
  }

  reportHit(attacker, target, weapon, damage, push) {
    return this.send("hit", {
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      damage,
      push
    });
  }

  reportTerrainHit(attacker, weapon, position, radius, structureId = "", partId = "") {
    return this.send("terrain_hit", {
      attackerId: attacker.id,
      weaponId: weapon.id,
      position,
      radius,
      structureId,
      partId
    });
  }

  reportCrush(player, structureId) {
    return this.send("crush", { playerId: player.id, structureId });
  }

  reload(player) {
    return this.send("reload", { playerId: player.id, weaponId: player.weapon.id });
  }

  requestRespawn(playerId) {
    return this.send("respawn", { playerId });
  }

  close() {
    this.closedByClient = true;
    this.socket?.close(1000, "Leaving room");
    this.socket = null;
    this.welcome = null;
    this.playerId = "";
    this.botHostId = "";
  }
}
