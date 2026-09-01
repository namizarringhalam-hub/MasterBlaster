import assert from "node:assert/strict";
import { WEAPONS } from "../src/gameData.js";
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_SERVER_MESSAGE_BYTES,
  clampMatchMinutes,
  finiteNumber,
  matchTimeRemaining,
  normalizeRoomCode,
  parseClientMessage,
  parseServerMessage,
  sanitizeLoadout,
  sanitizePlayerName,
  sanitizeVector,
  socketUrl,
  squaredDistance,
  uniquePlayersById
} from "../src/multiplayerProtocol.js";

assert.equal(MULTIPLAYER_PROTOCOL_VERSION, 1);
assert.equal(normalizeRoomCode(" room! 42 "), "ROOM42");
assert.equal(normalizeRoomCode("", "FALLBACK"), "FALLBACK");
assert.equal(sanitizePlayerName("  <Ace>\n"), "Ace");
assert.deepEqual(sanitizeLoadout(["blaster", "shotgun", "railgun", "mine", "rocket_launcher"], WEAPONS), ["blaster", "shotgun", "railgun", "mine", "rocket_launcher"]);
assert.equal(sanitizeLoadout(["blaster", "blaster", "missing"], WEAPONS, ["railgun"]).join(), "railgun");
assert.equal(finiteNumber("8", 0, 0, 5), 5);
assert.equal(clampMatchMinutes("12"), 12);
assert.equal(clampMatchMinutes(0), 1);
assert.equal(clampMatchMinutes(99), 30);
assert.equal(clampMatchMinutes("invalid"), 3);
assert.deepEqual(sanitizeVector({ x: 30, y: 40, z: 0 }, 10), { x: 6, y: 8, z: 0 });
assert.equal(squaredDistance({ x: 1, y: 2, z: 3 }, { x: 4, y: 6, z: 3 }), 25);
assert.equal(matchTimeRemaining(2_000, 1_250), 750);
assert.deepEqual(parseClientMessage('{"type":"ping"}'), { type: "ping" });
assert.equal(parseClientMessage("bad"), null);
const roomSnapshot = JSON.stringify({ type: "welcome", terrainEvents: ["x".repeat(MAX_CLIENT_MESSAGE_BYTES)] });
assert.equal(parseClientMessage(roomSnapshot), null, "Worker-facing messages retain the strict client payload ceiling");
assert.deepEqual(parseServerMessage(roomSnapshot), JSON.parse(roomSnapshot), "browser accepts bounded authoritative room snapshots");
assert.equal(parseServerMessage(JSON.stringify({ type: "welcome", state: "x".repeat(MAX_SERVER_MESSAGE_BYTES) })), null);
const oversizedUnicodeClientMessage = JSON.stringify({ type: "ping", value: "é".repeat(MAX_CLIENT_MESSAGE_BYTES / 2) });
assert.ok(oversizedUnicodeClientMessage.length < MAX_CLIENT_MESSAGE_BYTES);
assert.ok(new TextEncoder().encode(oversizedUnicodeClientMessage).byteLength > MAX_CLIENT_MESSAGE_BYTES);
assert.equal(parseClientMessage(oversizedUnicodeClientMessage), null, "client limit counts UTF-8 bytes rather than UTF-16 code units");
const oversizedUnicodeServerMessage = JSON.stringify({ type: "welcome", state: "é".repeat(MAX_SERVER_MESSAGE_BYTES / 2) });
assert.ok(oversizedUnicodeServerMessage.length < MAX_SERVER_MESSAGE_BYTES);
assert.ok(new TextEncoder().encode(oversizedUnicodeServerMessage).byteLength > MAX_SERVER_MESSAGE_BYTES);
assert.equal(parseServerMessage(oversizedUnicodeServerMessage), null, "server limit counts UTF-8 bytes rather than UTF-16 code units");
assert.equal(socketUrl("https://masterblaster.se", "room-1", { name: "Ace" }), "wss://masterblaster.se/api/rooms/ROOM-1/connect?name=Ace");
assert.deepEqual(
  uniquePlayersById([{ id: "same", health: 0 }, { id: "same", health: 100 }, { id: "other", health: 75 }]),
  [{ id: "same", health: 0 }, { id: "other", health: 75 }],
  "a duplicate reconnect roster cannot create more than one fighter for one authoritative identity"
);

console.log("Multiplayer protocol checks passed.");
