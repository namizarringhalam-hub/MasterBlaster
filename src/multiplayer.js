import {
  MULTIPLAYER_PROTOCOL_VERSION,
  NETWORK_TICK_MS,
  normalizeRoomCode,
  parseServerMessage,
  socketUrl
} from "./multiplayerProtocol.js";
import TEXT, { formatText } from "./playerText.js";

const ROOM_SESSION_PREFIX = "master-blaster-room-session:";

function storedRoomSession(roomCode) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) return "";
  try { return localStorage.getItem(`${ROOM_SESSION_PREFIX}${normalized}`) || ""; }
  catch { return ""; }
}

function rememberRoomSession(roomCode, resumeToken) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized || !resumeToken) return;
  try { localStorage.setItem(`${ROOM_SESSION_PREFIX}${normalized}`, resumeToken); }
  catch {}
}

function apiOrigin() {
  const configured = import.meta.env?.VITE_MULTIPLAYER_ORIGIN;
  if (configured) return new URL(configured, location.href).origin;
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") return "http://127.0.0.1:8787";
  return location.origin;
}

export class MultiplayerClient extends EventTarget {
  constructor(roomTimeout = 10_000, retryDelay = 350, reconnectDelays = [0, 500, 1_500, 3_000, 5_000, 7_500, 10_000, 12_000]) {
    super();
    this.roomTimeout = roomTimeout;
    this.retryDelay = retryDelay;
    this.reconnectDelays = reconnectDelays;
    this.socket = null;
    this.roomCode = "";
    this.playerId = "";
    this.botHostId = "";
    this.resumeToken = "";
    this.welcome = null;
    this.options = null;
    this.lastStateAt = 0;
    this.heartbeatTimer = 0;
    this.awaitingPongSince = 0;
    this.reconnectTask = null;
    this.reconnectNonce = 0;
    this.closedByClient = false;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get controlsBots() {
    return Boolean(this.playerId && this.playerId === this.botHostId);
  }

  async connect(options) {
    this.close();
    this.closedByClient = false;
    this.options = { ...options };
    const storedResumeToken = options.mode === "private" ? storedRoomSession(options.roomCode) : "";
    try {
      return await this.connectOnce(options, "", storedResumeToken);
    } catch (error) {
      if (options.mode !== "quick" || error.message !== TEXT.errors.roomTimeout) throw error;
      const failedRoomCode = this.roomCode;
      await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      return this.connectOnce(options, failedRoomCode);
    }
  }

  async connectOnce({ mode, roomCode, name, loadout, botCount, difficulty, timeLimitMinutes }, excludeRoomCode = "", resumeToken = "", directRoomCode = "") {
    this.stopHeartbeat();
    const priorSocket = this.socket;
    this.socket = null;
    priorSocket?.close(1000, "Replacing connection");
    const origin = apiOrigin();
    if (mode === "quick" && !directRoomCode) {
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
    roomCode = directRoomCode || roomCode;
    this.roomCode = normalizeRoomCode(roomCode);
    if (!this.roomCode) throw new Error(TEXT.errors.invalidRoomCode);
    const url = socketUrl(origin, this.roomCode, {
      v: MULTIPLAYER_PROTOCOL_VERSION,
      name,
      loadout,
      mode,
      botCount,
      difficulty,
      timeLimitMinutes,
      resumeToken
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
      }, resumeToken ? Math.min(this.roomTimeout, 4_000) : this.roomTimeout);
      socket.addEventListener("message", (event) => {
        if (socket !== this.socket) return;
        this.awaitingPongSince = 0;
        const message = parseServerMessage(event.data);
        if (!message) return;
        if (message.type === "welcome") {
          joined = true;
          clearTimeout(timeout);
          this.playerId = message.playerId;
          this.botHostId = message.botHostId;
          this.resumeToken = message.resumeToken || this.resumeToken;
          if (this.options?.mode === "private") rememberRoomSession(this.roomCode, this.resumeToken);
          socket.send(JSON.stringify({ type: "resume_ack", resumeToken: this.resumeToken }));
          this.welcome = message;
          this.startHeartbeat(socket);
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
        const expected = this.closedByClient || socket !== this.socket;
        if (!joined) reject(new Error(reason));
        else if (!expected) void this.reconnect({ code: event.code, reason });
      });
    });
  }

  startHeartbeat(socket) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN || globalThis.document?.hidden) return;
      const now = Date.now();
      if (this.awaitingPongSince && now - this.awaitingPongSince > 30_000) {
        socket.close(4002, "Heartbeat timeout");
        return;
      }
      if (this.awaitingPongSince) return;
      try {
        socket.send('{"type":"ping"}');
        this.awaitingPongSince = now;
      } catch {
        socket.close(4002, "Heartbeat failed");
      }
    }, 15_000);
    this.heartbeatTimer?.unref?.();
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = 0;
    this.awaitingPongSince = 0;
  }

  reconnect(detail) {
    if (this.reconnectTask || this.closedByClient || !this.options || !this.resumeToken || !this.roomCode) return this.reconnectTask;
    const nonce = ++this.reconnectNonce;
    const roomCode = this.roomCode;
    const resumeToken = this.resumeToken;
    let recovered = false;
    this.stopHeartbeat();
    this.reconnectTask = (async () => {
      let lastError = new Error(detail.reason || TEXT.errors.connectionDescription);
      for (let attempt = 0; attempt < this.reconnectDelays.length; attempt++) {
        if (this.closedByClient || nonce !== this.reconnectNonce) return null;
        while (globalThis.navigator?.onLine === false && !this.closedByClient && nonce === this.reconnectNonce) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        this.dispatchEvent(new CustomEvent("reconnecting", { detail: { attempt: attempt + 1 } }));
        const delay = this.reconnectDelays[attempt];
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.closedByClient || nonce !== this.reconnectNonce) return null;
        try {
          const welcome = await this.connectOnce(this.options, "", resumeToken, roomCode);
          recovered = true;
          this.dispatchEvent(new CustomEvent("reconnected", { detail: welcome }));
          return welcome;
        } catch (error) {
          lastError = error;
        }
      }
      if (!this.closedByClient && nonce === this.reconnectNonce) {
        this.dispatchEvent(new CustomEvent("disconnect", { detail: { code: detail.code, reason: lastError.message, expected: false } }));
      }
      return null;
    })().finally(() => {
      this.reconnectTask = null;
      if (recovered && !this.closedByClient && !this.connected) {
        queueMicrotask(() => this.reconnect({ code: 1006, reason: TEXT.errors.connectionDescription }));
      }
    });
    return this.reconnectTask;
  }

  send(type, payload = {}) {
    if (!this.connected) return false;
    try {
      this.socket.send(JSON.stringify({ type, ...payload }));
      return true;
    } catch {
      this.socket.close(4002, "Send failed");
      return false;
    }
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
    const shotId = crypto.randomUUID();
    player.networkShotId = shotId;
    return this.send("fire", {
      shotId,
      playerId: player.id,
      weaponId: weapon.id,
      slotIndex: player.slotIndex,
      direction,
      triggerTap,
      action,
      chargeRatio
    });
  }

  reportHit(attacker, target, weapon, damage, push, context = {}) {
    return this.send("hit", {
      shotId: context.shotId || attacker.networkShotId,
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      damage,
      push,
      impact: context.point || null,
      phase: context.phase || "impact"
    });
  }

  reportTerrainHit(attacker, weapon, position, radius, structureId = "", partId = "", shotId = "") {
    return this.send("terrain_hit", {
      shotId: shotId || attacker.networkShotId,
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
    this.reconnectNonce += 1;
    this.stopHeartbeat();
    this.socket?.close(1000, "Leaving room");
    this.socket = null;
    this.welcome = null;
    this.options = null;
    this.resumeToken = "";
    this.playerId = "";
    this.botHostId = "";
  }
}
