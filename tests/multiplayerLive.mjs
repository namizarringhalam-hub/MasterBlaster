import assert from "node:assert/strict";
import { WEAPONS, structuralPartBounds } from "../src/gameData.js";

const origin = process.env.MULTIPLAYER_TEST_ORIGIN || "http://127.0.0.1:8787";
const loadout = ["blaster", "charged_energy_rifle", "rocket_launcher", "cluster_grenade", "railgun"];
const botCount = 15;
const timeLimitMinutes = 7;

function closeSocket(socket) {
  if (socket.readyState !== WebSocket.CLOSED) socket.close(1000, "test complete");
}

async function assignment(requestedMinutes = timeLimitMinutes) {
  const response = await fetch(`${origin}/api/quick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ botCount, difficulty: "veteran", timeLimitMinutes: requestedMinutes })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function connect(roomCode, name, roomBotCount = botCount, requestedMinutes = timeLimitMinutes) {
  const url = new URL(`/api/rooms/${roomCode}/connect`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("v", "1");
  url.searchParams.set("name", name);
  url.searchParams.set("loadout", loadout.join(","));
  url.searchParams.set("botCount", String(roomBotCount));
  url.searchParams.set("difficulty", "veteran");
  url.searchParams.set("timeLimitMinutes", String(requestedMinutes));
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.accept(message)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  const next = (accept, timeout = 4_000) => {
    const found = messages.find(accept);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { accept, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${name} message`));
      }, timeout);
    });
  };
  const welcome = await next((message) => message.type === "welcome");
  return { socket, next, welcome };
}

const firstAssignment = await assignment();
assert.equal(firstAssignment.timeLimitMinutes, timeLimitMinutes);
const otherDurationAssignment = await assignment(8);
assert.notEqual(otherDurationAssignment.roomCode, firstAssignment.roomCode, "different durations never share a Quick Play room");
const first = await connect(firstAssignment.roomCode, "Alpha", botCount, 30);
assert.equal(first.welcome.endsAt - first.welcome.startsAt, timeLimitMinutes * 60_000, "the matchmaker reservation overrides a manipulated WebSocket duration");
const secondAssignment = await assignment();
assert.equal(secondAssignment.roomCode, firstAssignment.roomCode);
const second = await connect(firstAssignment.roomCode, "Bravo");
assert.equal(first.welcome.players.length, 16);
assert.equal(second.welcome.players.length, 16);
assert.equal(second.welcome.botHostId, first.welcome.playerId);

const firstId = first.welcome.playerId;
const secondId = second.welcome.playerId;
const botId = second.welcome.players.find((player) => player.bot).id;
first.socket.send(JSON.stringify({
  type: "state",
  players: [
    { id: firstId, position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true },
    { id: botId, position: { x: 8, y: 1, z: 2 }, velocity: { x: 1, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }
  ]
}));
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: 5, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === botId));

first.socket.send(JSON.stringify({ type: "fire", playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: { x: 1, y: 0, z: 0 } }));
await second.next((message) => message.type === "fire" && message.playerId === firstId);
first.socket.send(JSON.stringify({ type: "hit", attackerId: firstId, targetId: secondId, weaponId: "blaster", damage: 18, push: { x: 1, y: 0, z: 0 } }));
const damage = await second.next((message) => message.type === "damage" && message.targetId === secondId);
assert.equal(damage.health, 82);
assert.equal(damage.damage, 18);

await new Promise((resolve) => setTimeout(resolve, 320));
first.socket.send(JSON.stringify({ type: "fire", playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: { x: 1, y: 0, z: 0 } }));
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "blaster" && message.serverTime > damage.serverTime);
first.socket.send(JSON.stringify({
  type: "terrain_hit", attackerId: firstId, weaponId: "blaster",
  position: { x: 28.4, y: 31, z: -31.75 }, structureId: "structure-1", partId: "structure-1-platform-1"
}));
const chipDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === "structure-1-platform-1");
assert.equal(chipDamage.structuralDamage, 1.8, "ordinary blaster fire applies canonical chip damage to a deck chunk");
assert.equal(chipDamage.collapsed, false);

first.socket.send(JSON.stringify({ type: "fire", playerId: firstId, weaponId: "charged_energy_rifle", slotIndex: 1, direction: { x: 1, y: 0, z: 0 }, chargeRatio: .5 }));
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "charged_energy_rifle");
const chargedPartId = "structure-1-platform-3";
const chargedBounds = structuralPartBounds(first.welcome.seed, chargedPartId);
first.socket.send(JSON.stringify({
  type: "terrain_hit", attackerId: firstId, weaponId: "charged_energy_rifle",
  position: { x: chargedBounds.x, y: (chargedBounds.baseY + chargedBounds.top) / 2, z: chargedBounds.z },
  structureId: "structure-1", partId: chargedPartId
}));
const chargedDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === chargedPartId);
assert.equal(chargedDamage.structuralDamage, WEAPONS.charged_energy_rifle.structureDamage * (.35 + .5 * .65), "partial charge uses the same structural damage scale on the client and room authority");

first.socket.send(JSON.stringify({ type: "fire", playerId: firstId, weaponId: "cluster_grenade", slotIndex: 3, direction: { x: 1, y: 0, z: 0 } }));
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "cluster_grenade");
const clusterPartId = "structure-1-platform-4";
const clusterBounds = structuralPartBounds(first.welcome.seed, clusterPartId);
first.socket.send(JSON.stringify({
  type: "terrain_hit", attackerId: firstId, weaponId: "cluster_grenade",
  position: { x: clusterBounds.x, y: (clusterBounds.baseY + clusterBounds.top) / 2, z: clusterBounds.z },
  structureId: "structure-1", partId: clusterPartId
}));
const clusterDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === clusterPartId);
assert.equal(clusterDamage.structuralDamage, WEAPONS.cluster_grenade.structureDamage, "cluster bomblets are accepted under their authoritative parent weapon identity");

first.socket.send(JSON.stringify({ type: "fire", playerId: firstId, weaponId: "rocket_launcher", slotIndex: 2, direction: { x: 1, y: 0, z: 0 } }));
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "rocket_launcher");
first.socket.send(JSON.stringify({
  type: "terrain_hit",
  attackerId: firstId,
  weaponId: "rocket_launcher",
  position: { x: 42, y: 2, z: -22 },
  radius: 99,
  structureId: "structure-1",
  partId: "structure-1-pillar-1"
}));
const firstTerrainDamage = await second.next((message) => message.type === "terrain_damage" && message.weaponId === "rocket_launcher" && message.partId === "structure-1-pillar-1");
assert.equal(firstTerrainDamage.radius, 5.2, "the room uses the weapon's canonical terrain radius");
assert.equal(firstTerrainDamage.structuralDamage, 20, "the room uses the rocket's canonical one-shot structural damage");
assert.equal(firstTerrainDamage.collapsed, true, "one accepted rocket destroys a major stand section");
const terrainDamage = firstTerrainDamage;
await new Promise((resolve) => setTimeout(resolve, 320));
first.socket.send(JSON.stringify({ type: "fire", playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: { x: 1, y: 0, z: 0 } }));
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "blaster" && message.serverTime > firstTerrainDamage.serverTime);
const fallingPartId = "structure-1-platform-2";
const fallingBounds = structuralPartBounds(first.welcome.seed, fallingPartId);
first.socket.send(JSON.stringify({
  type: "terrain_hit", attackerId: firstId, weaponId: "blaster",
  position: { x: fallingBounds.x, y: (fallingBounds.baseY + fallingBounds.top) / 2, z: fallingBounds.z },
  structureId: "structure-1", partId: fallingPartId
}));
const fallingDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === fallingPartId);
assert.equal(fallingDamage.structuralDamage, WEAPONS.blaster.structureDamage, "shots at a visibly falling deck remain valid throughout the collapse window");
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: 42, y: 1, z: -22 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.position?.x === 42));
second.socket.send(JSON.stringify({ type: "crush", playerId: secondId, structureId: "structure-1" }));
const crush = await first.next((message) => message.type === "crush" && message.targetId === secondId);
assert.equal(crush.health, 0);
assert.equal(crush.attackerId, firstId);

const lateJoin = await connect(firstAssignment.roomCode, "Charlie");
assert.ok(lateJoin.welcome.terrainEvents.some((event) => event.id === terrainDamage.id), "late joiners receive authoritative terrain history");
assert.equal(lateJoin.welcome.structuralState["structure-1-pillar-1"], 0, "late joiners receive the compact destroyed-section snapshot");
assert.equal(lateJoin.welcome.structuralState["structure-1-platform-1"], 6.2, "late joiners receive partial chunk health even when the hit log is trimmed");
assert.equal(lateJoin.welcome.structuralState[fallingPartId], 6.2, "late joiners retain damage applied while a support was visibly collapsing");
closeSocket(lateJoin.socket);
closeSocket(first.socket);
closeSocket(second.socket);

const privateRoom = await connect(`P-${Date.now().toString(36).slice(-8)}`, "Solo", 0);
assert.equal(privateRoom.welcome.players.length, 1);
assert.equal(privateRoom.welcome.players.some((player) => player.bot), false);
closeSocket(privateRoom.socket);
console.log("Two-client lifecycle and zero-bot private room passed.");
process.exit(0);
