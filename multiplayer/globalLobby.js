import { DurableObject } from "cloudflare:workers";
import { parseClientMessage, sanitizePlayerName } from "../src/multiplayerProtocol.js";
import TEXT from "../src/playerText.js";

// ponytail: one shared discovery lobby, with gameplay isolated in per-round objects.
// Bound the initial lobby to 512 connections; shard discovery if it outgrows this.
export class GlobalLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = new Map();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.rooms = await ctx.storage.get("rooms") || new Map();
    });
  }

  entries(exclude = null) {
    return this.ctx.getWebSockets().filter((socket) => socket !== exclude && socket.readyState === 1)
      .map((socket) => [socket, socket.deserializeAttachment()]);
  }

  async identity(token) {
    await this.ready;
    const entry = this.entries().find(([, player]) => player.token === token);
    return entry ? { id: entry[1].id, name: entry[1].name } : null;
  }

  snapshot(exclude = null) {
    const players = new Map(this.entries(exclude).map(([, player]) => [player.id, { id: player.id, name: player.name, status: "lobby", roomCode: "" }]));
    for (const room of this.rooms.values()) for (const player of room.players) {
      players.set(player.id, { ...player, roomCode: room.roomCode, status: room.phase });
    }
    return { type: "global_lobby", players: [...players.values()], rooms: [...this.rooms.values()].filter((room) => room.phase === "lobby"), serverTime: Date.now() };
  }

  broadcast(exclude = null) {
    const message = JSON.stringify(this.snapshot(exclude));
    for (const [socket] of this.entries(exclude)) {
      try { socket.send(message); } catch { socket.close(1011, TEXT.errors.deliveryFailed); }
    }
  }

  async updateRoom(room) {
    await this.ready;
    if (room.players.length) this.rooms.set(room.roomCode, room);
    else this.rooms.delete(room.roomCode);
    await this.ctx.storage.put("rooms", this.rooms);
    this.broadcast();
    if (this.rooms.size && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  async alarm() {
    await this.ready;
    // Reconcile abandoned rooms even if a room's last directory update failed.
    for (const [code, previous] of this.rooms) {
      try {
        const response = await this.env.MATCH_ROOMS.getByName(code).fetch("https://room.internal/status");
        const { globalSummary } = await response.json();
        // Don't overwrite a newer pushed update while a status request was in flight.
        if (this.rooms.get(code) !== previous) continue;
        if (globalSummary?.players.length) this.rooms.set(code, globalSummary);
        else this.rooms.delete(code);
      } catch (error) { console.error(JSON.stringify({ event: "directory_refresh_failed", roomCode: code, error: String(error) })); }
    }
    await this.ctx.storage.put("rooms", this.rooms);
    this.broadcast();
    if (this.rooms.size) await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  async fetch(request) {
    await this.ready;
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
    if (this.entries().length >= 512) return new Response(null, { status: 503 });
    const url = new URL(request.url), token = url.searchParams.get("identity") || "";
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(token)) return new Response(null, { status: 400 });
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const id = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({ id, token, name: sanitizePlayerName(url.searchParams.get("name")) });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ ...this.snapshot(), type: "welcome", playerId: id, resumeToken: token }));
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, value) {
    await this.ready;
    const message = parseClientMessage(value);
    if (message?.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
    if (message?.type === "profile") {
      socket.serializeAttachment({ ...socket.deserializeAttachment(), name: sanitizePlayerName(message.name) });
      this.broadcast();
    }
  }

  async webSocketClose(socket) { await this.ready; socket.close(); this.broadcast(socket); }
  async webSocketError(socket) { await this.webSocketClose(socket); }
}
