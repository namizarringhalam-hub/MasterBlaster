import assert from "node:assert/strict";
import { MultiplayerClient } from "../src/multiplayer.js";

const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;
const originalWebSocket = globalThis.WebSocket;
const requests = [];

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.instances.length === 2) queueMicrotask(() => this.emitMessage({
      type: "welcome", playerId: "player-new", botHostId: "player-new", roomCode: "ROOM-B",
      seed: "ROOM-B", startsAt: 1, endsAt: 2, targetScore: 10, players: []
    }));
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

  send() {}
}

globalThis.location = new URL("https://masterblaster.se/");
globalThis.WebSocket = FakeWebSocket;
globalThis.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return Response.json({ roomCode: requests.length === 1 ? "ROOM-A" : "ROOM-B" });
};

try {
  const client = new MultiplayerClient(8, 0);
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
  console.log("Multiplayer timeout recovery state machine passed.");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.location = originalLocation;
  globalThis.WebSocket = originalWebSocket;
}
