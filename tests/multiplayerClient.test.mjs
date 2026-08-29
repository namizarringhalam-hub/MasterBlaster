import assert from "node:assert/strict";
import { MultiplayerClient } from "../src/multiplayer.js";

const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;
const originalWebSocket = globalThis.WebSocket;
const originalLocalStorage = globalThis.localStorage;
const requests = [];
const storage = new Map();

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.instances.length === 2) queueMicrotask(() => this.emitMessage(welcomeMessage));
    if (FakeWebSocket.instances.length === 3) queueMicrotask(() => this.emitMessage({ ...welcomeMessage, serverTime: 3 }));
    if (FakeWebSocket.instances.length === 4) queueMicrotask(() => this.emitMessage({ ...welcomeMessage, roomCode: "P-ROOM", resumeToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }));
    if (FakeWebSocket.instances.length === 5) queueMicrotask(() => this.emitMessage({ ...welcomeMessage, roomCode: "P-ROOM", resumeToken: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }));
    if (FakeWebSocket.instances.length === 6) queueMicrotask(() => this.emitMessage({ ...welcomeMessage, roomCode: "P-LONG", resumeToken: "cccccccc-cccc-cccc-cccc-cccccccccccc" }));
    if (FakeWebSocket.instances.length >= 7 && FakeWebSocket.instances.length <= 10) queueMicrotask(() => this.emitErrorAndClose());
    if (FakeWebSocket.instances.length === 11) queueMicrotask(() => this.emitMessage({ ...welcomeMessage, roomCode: "P-LONG", resumeToken: "dddddddd-dddd-dddd-dddd-dddddddddddd" }));
  }

  emitMessage(message) {
    this.readyState = FakeWebSocket.OPEN;
    const event = new Event("message");
    Object.defineProperty(event, "data", { value: JSON.stringify(message) });
    this.dispatchEvent(event);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  emitClose(code = 1006, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    const event = new Event("close");
    Object.defineProperties(event, { code: { value: code }, reason: { value: reason } });
    this.dispatchEvent(event);
  }

  emitErrorAndClose() {
    this.dispatchEvent(new Event("error"));
    this.emitClose();
  }

  send() {}
}

const welcomeMessage = {
  type: "welcome", playerId: "player-new", botHostId: "player-new", roomCode: "ROOM-B",
  resumeToken: "12345678-1234-1234-1234-123456789abc",
  seed: "ROOM-B", startsAt: 1, endsAt: 2, targetScore: 10, players: []
};

globalThis.location = new URL("https://masterblaster.se/");
globalThis.WebSocket = FakeWebSocket;
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value))
};
globalThis.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return Response.json({ roomCode: requests.length === 1 ? "ROOM-A" : "ROOM-B" });
};

try {
  const client = new MultiplayerClient(8, 0, [0]);
  const welcome = await client.connect({
    mode: "quick", roomCode: "", name: "Retry Tester", loadout: [],
    botCount: 7, difficulty: "normal", timeLimitMinutes: 3
  });
  assert.equal(welcome.playerId, "player-new");
  assert.equal(requests.length, 2, "a room timeout gets one replacement assignment");
  assert.equal(requests[0].excludeRoomCode, "");
  assert.equal(requests[1].excludeRoomCode, "ROOM-A");
  FakeWebSocket.instances[0].emitMessage({ type: "welcome", playerId: "player-stale", botHostId: "player-stale" });
  assert.equal(client.playerId, "player-new", "a late superseded welcome cannot replace the active identity");
  let disconnects = 0;
  let reconnecting = 0;
  client.addEventListener("disconnect", () => { disconnects += 1; });
  client.addEventListener("reconnecting", () => { reconnecting += 1; });
  const reconnected = new Promise((resolve) => client.addEventListener("reconnected", ({ detail }) => resolve(detail), { once: true }));
  FakeWebSocket.instances[1].emitClose();
  const resumed = await reconnected;
  assert.equal(resumed.playerId, "player-new", "a transient disconnect resumes the same authoritative player");
  assert.equal(reconnecting, 1);
  assert.equal(disconnects, 0, "a recovered interruption never becomes a fatal disconnect");
  assert.equal(requests.length, 2, "reconnect goes directly to the current room instead of re-entering matchmaking");
  const resumeUrl = new URL(FakeWebSocket.instances[2].url);
  assert.equal(resumeUrl.pathname, "/api/rooms/ROOM-B/connect");
  assert.equal(resumeUrl.searchParams.get("resumeToken"), welcomeMessage.resumeToken);
  client.close();

  const privateOptions = {
    mode: "private", roomCode: "P-ROOM", name: "Persistent player", loadout: [],
    botCount: 0, difficulty: "normal", timeLimitMinutes: 3
  };
  const firstPrivateClient = new MultiplayerClient(8, 0, [0]);
  const firstPrivateWelcome = await firstPrivateClient.connect(privateOptions);
  firstPrivateClient.close();
  const secondPrivateClient = new MultiplayerClient(8, 0, [0]);
  await secondPrivateClient.connect(privateOptions);
  const manualRejoinUrl = new URL(FakeWebSocket.instances[4].url);
  assert.equal(manualRejoinUrl.searchParams.get("resumeToken"), firstPrivateWelcome.resumeToken, "a new client on the same device presents the saved private-room session");
  assert.equal(storage.get("master-blaster-room-session:P-ROOM"), "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "the device saves the rotated room credential immediately");
  secondPrivateClient.close();

  const defaultRecoveryPolicy = new MultiplayerClient();
  assert.ok(defaultRecoveryPolicy.reconnectDelays.length >= 8);
  assert.ok(defaultRecoveryPolicy.reconnectDelays.reduce((total, delay) => total + delay, 0) >= 30_000, "default retries span routine Wi-Fi and mobile handoffs");
  defaultRecoveryPolicy.close();
  const longRecoveryClient = new MultiplayerClient(8, 0, [0, 0, 0, 0, 0]);
  await longRecoveryClient.connect({ ...privateOptions, roomCode: "P-LONG" });
  let longRecoveryAttempts = 0;
  longRecoveryClient.addEventListener("reconnecting", () => { longRecoveryAttempts += 1; });
  const recoveredAfterFailures = new Promise((resolve) => longRecoveryClient.addEventListener("reconnected", ({ detail }) => resolve(detail), { once: true }));
  FakeWebSocket.instances[5].emitClose();
  const longRecoveryWelcome = await recoveredAfterFailures;
  assert.equal(longRecoveryWelcome.resumeToken, "dddddddd-dddd-dddd-dddd-dddddddddddd");
  assert.equal(longRecoveryAttempts, 5, "several immediate socket failures are absorbed before recovery succeeds");
  longRecoveryClient.close();
  console.log("Multiplayer timeout and live-session recovery state machine passed.");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.location = originalLocation;
  globalThis.WebSocket = originalWebSocket;
  globalThis.localStorage = originalLocalStorage;
}
