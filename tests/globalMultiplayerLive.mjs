import assert from "node:assert/strict";
import { WEAPONS } from "../src/gameData.js";
import { sanitizeLoadoutSlots, fillLoadoutSlots } from "../src/multiplayerProtocol.js";

const origin = process.env.MULTIPLAYER_TEST_ORIGIN || "http://127.0.0.1:8787";
const sockets = [];
const selected = ["rocket_launcher", null, "railgun", null, null];
assert.deepEqual(sanitizeLoadoutSlots(["rocket_launcher", "rocket_launcher", "constructor", null, "railgun"], WEAPONS), ["rocket_launcher", null, null, null, "railgun"]);
const filled = fillLoadoutSlots(selected, WEAPONS, () => 0);
assert.equal(filled[0], selected[0]); assert.equal(filled[2], selected[2]); assert.equal(new Set(filled).size, 5);

async function connect(path, params) {
  const url = new URL(path, origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  const socket = new WebSocket(url), messages = []; sockets.push(socket);
  let failure = null;
  socket.addEventListener("error", () => { failure = new Error("WebSocket rejected: " + path); });
  socket.addEventListener("message", ({ data }) => messages.push(JSON.parse(data)));
  const next = async (predicate, from = 0, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = messages.slice(from).find(predicate); if (found) return found;
      if (failure) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Timeout: " + JSON.stringify(messages.slice(-3)));
  };
  const welcome = await next((m) => m.type === "welcome");
  const send = (type, fields = {}) => socket.send(JSON.stringify({ type, ...fields }));
  send("resume_ack", { resumeToken: welcome.resumeToken });
  return { socket, messages, next, welcome, send };
}

try {
  const identityA = crypto.randomUUID(), identityB = crypto.randomUUID(), identityC = crypto.randomUUID();
  const a = await connect("/api/lobby/connect", { identity: identityA, name: "Host" });
  const b = await connect("/api/lobby/connect", { identity: identityB, name: "Guest" });
  const c = await connect("/api/lobby/connect", { identity: identityC, name: "Observer" });
  await a.next((m) => m.type === "global_lobby" && m.players.some((p) => p.id === b.welcome.playerId));
  const code = "G-" + crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const path = `/api/rooms/${code}/connect`;
  const common = { v: 1, arenaRevision: 2, mode: "global", botCount: 2, humanCapacity: 3, roomName: "Public test", timeLimitMinutes: 3, difficulty: "normal", lifeState: 1 };
  const host = await connect(path, { ...common, create: 1, identity: identityA, name: "Host", loadout: selected });
  assert.equal(host.welcome.phase, "lobby");
  await b.next((m) => m.type === "global_lobby" && m.rooms.some((r) => r.roomCode === code && r.players.length === 1));
  host.send("lobby_start");
  host.send("ping"); await host.next((m) => m.type === "pong");
  assert(!host.messages.some((m) => m.phase === "countdown"), "cannot start alone");
  const guest = await connect(path, { ...common, identity: identityB, name: "Guest", loadout: [] });
  let cursor = host.messages.length;
  guest.send("lobby_settings", { botCount: 8 }); guest.send("lobby_start"); guest.send("lobby_loadout", { loadout: [null, "shotgun"] });
  const settings = await host.next((m) => m.type === "lobby" && m.players.some((p) => p.pendingLoadout?.[1] === "shotgun"), cursor);
  assert.equal(settings.configuredBotCount, 2); assert.equal(settings.phase, "lobby");
  host.send("lobby_settings", { botCount: 1 });
  await host.next((m) => m.configuredBotCount === 1, cursor);
  cursor = host.messages.length;
  host.send("lobby_start");
  const countdown = await host.next((m) => m.phase === "countdown", cursor);
  assert(countdown.startsAt - countdown.serverTime > 4800 && countdown.startsAt - countdown.serverTime <= 5000);
  await c.next((m) => m.type === "global_lobby" && !m.rooms.some((r) => r.roomCode === code) && m.players.some((p) => p.id === a.welcome.playerId && p.status === "countdown"));
  await assert.rejects(connect(path, { ...common, identity: identityC, name: "Late" }));
  guest.send("lobby_loadout", { loadout: [null, "shotgun", null, "machine_gun", null] });
  const started = await host.next((m) => m.type === "match_start", cursor);
  assert(Date.now() >= countdown.startsAt, "server must not launch early");
  assert.equal(started.players.filter((p) => p.bot).length, 1);
  const hostLoadout = started.players.find((p) => p.id === host.welcome.playerId).loadout;
  const guestLoadout = started.players.find((p) => p.id === guest.welcome.playerId).loadout;
  assert.equal(hostLoadout[0], "rocket_launcher"); assert.equal(hostLoadout[2], "railgun");
  assert.equal(guestLoadout[1], "shotgun"); assert.equal(guestLoadout[3], "machine_gun");
  for (const loadout of [hostLoadout, guestLoadout]) { assert.equal(new Set(loadout).size, 5); assert(loadout.every((id) => Object.hasOwn(WEAPONS, id))); }
  await c.next((m) => m.type === "global_lobby" && m.players.some((p) => p.id === a.welcome.playerId && p.status === "playing"));
  guest.send("lobby_leave"); host.send("lobby_leave");
  const endCursor = c.messages.length;
  await c.next((m) => m.type === "global_lobby" && m.players.find((p) => p.id === a.welcome.playerId)?.status === "lobby", endCursor);
  console.log("Global multiplayer live checks passed: presence, discovery, host authority, minimum players, late-join rejection, five-second countdown, in-countdown selection, slot-preserving random fill, bots, and departure cleanup.");
} finally {
  for (const socket of sockets) if (socket.readyState < 2) socket.close(1000, "test complete");
}
