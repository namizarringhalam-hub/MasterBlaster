import {
  MULTIPLAYER_PROTOCOL_VERSION,
  NETWORK_TICK_MS,
  normalizeRoomCode,
  parseClientMessage,
  socketUrl
} from "./multiplayerProtocol.js";

function apiOrigin() {
  const configured = import.meta.env.VITE_MULTIPLAYER_ORIGIN;
  if (configured) return new URL(configured, location.href).origin;
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return "http://127.0.0.1:8787";
  return location.origin;
}

export class MultiplayerClient extends EventTarget {
  constructor() {
    super();
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

  async connect({ mode, roomCode, name, loadout, botCount, difficulty }) {
    this.close();
    this.closedByClient = false;
    const origin = apiOrigin();
    if (mode === "quick") {
      const response = await fetch(new URL("/api/quick", origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botCount, difficulty })
      });
      if (!response.ok) throw new Error(`Matchmaking unavailable (${response.status})`);
      const assignment = await response.json();
      roomCode = assignment.roomCode;
    }
    this.roomCode = normalizeRoomCode(roomCode);
    if (!this.roomCode) throw new Error("Enter a valid room code.");
    const url = socketUrl(origin, this.roomCode, {
      v: MULTIPLAYER_PROTOCOL_VERSION,
      name,
      loadout,
      botCount,
      difficulty
    });
    const socket = new WebSocket(url);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close(4000, "Connection timeout");
        reject(new Error("The multiplayer room did not respond in time."));
      }, 10_000);
      socket.addEventListener("message", (event) => {
        const message = parseClientMessage(event.data);
        if (!message) return;
        if (message.type === "welcome") {
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
        if (!this.welcome) reject(new Error("Could not connect to the multiplayer service."));
      }, { once: true });
      socket.addEventListener("close", (event) => {
        clearTimeout(timeout);
        this.dispatchEvent(new CustomEvent("disconnect", { detail: { code: event.code, reason: event.reason, expected: this.closedByClient } }));
        if (!this.welcome) reject(new Error(event.reason || "The multiplayer room closed before joining."));
      });
    });
  }

  send(type, payload = {}) {
    if (!this.connected) return false;
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
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

  fire(player, weapon, direction, triggerTap = false, action = "fire") {
    return this.send("fire", {
      playerId: player.id,
      weaponId: weapon.id,
      slotIndex: player.slotIndex,
      direction,
      triggerTap,
      action
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
