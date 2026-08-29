import assert from "node:assert/strict";
import { WEAPONS } from "../src/gameData.js";
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  clampMatchMinutes,
  finiteNumber,
  matchTimeRemaining,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeLoadout,
  sanitizePlayerName,
  sanitizeVector,
  socketUrl,
  squaredDistance
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
assert.equal(socketUrl("https://masterblaster.se", "room-1", { name: "Ace" }), "wss://masterblaster.se/api/rooms/ROOM-1/connect?name=Ace");

console.log("Multiplayer protocol checks passed.");
