import assert from "node:assert/strict";
import { ARENA_SPAWN_POINTS, WEAPONS, structuralPartBounds } from "../src/gameData.js";

const origin = process.env.MULTIPLAYER_TEST_ORIGIN || "http://127.0.0.1:8787";
const loadout = ["blaster", "charged_energy_rifle", "rocket_launcher", "cluster_grenade", "mortar"];
const botCount = 15;
const timeLimitMinutes = 7;

function closeSocket(socket) {
  if (socket.readyState !== WebSocket.CLOSED) socket.close(1000, "test complete");
}

function fire(client, payload) {
  const shotId = crypto.randomUUID();
  client.socket.send(JSON.stringify({ type: "fire", shotId, ...payload }));
  return shotId;
}

function directionTo(position, origin = { x: 0, y: 2.2, z: 0 }) {
  const direction = { x: position.x - origin.x, y: position.y - origin.y, z: position.z - origin.z };
  const magnitude = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return { x: direction.x / magnitude, y: direction.y / magnitude, z: direction.z / magnitude };
}

function closeSocketAndWait(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    closeSocket(socket);
  });
}

async function assignment(requestedMinutes = timeLimitMinutes, excludeRoomCode = "") {
  const response = await fetch(`${origin}/api/quick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ botCount, difficulty: "veteran", timeLimitMinutes: requestedMinutes, excludeRoomCode, arenaRevision: 2 })
  });
  assert.equal(response.status, 200);
  return response.json();
}

function connectionUrl(roomCode, name, roomBotCount, requestedMinutes, mode, resumeToken = "") {
  const url = new URL(`/api/rooms/${roomCode}/connect`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("v", "1");
  url.searchParams.set("name", name);
  url.searchParams.set("loadout", loadout.join(","));
  url.searchParams.set("mode", mode);
  url.searchParams.set("botCount", String(roomBotCount));
  url.searchParams.set("difficulty", "veteran");
  url.searchParams.set("timeLimitMinutes", String(requestedMinutes));
  url.searchParams.set("lifeState", "1");
  url.searchParams.set("arenaRevision", "2");
  if (resumeToken) url.searchParams.set("resumeToken", resumeToken);
  return url;
}

async function connect(roomCode, name, roomBotCount = botCount, requestedMinutes = timeLimitMinutes, mode = "quick", resumeToken = "") {
  const url = connectionUrl(roomCode, name, roomBotCount, requestedMinutes, mode, resumeToken);
  const socket = new WebSocket(url);
  const messages = [];
  const terrainBatches = [];
  const waiters = [];
  socket.addEventListener("message", ({ data }) => {
    const packet = JSON.parse(data);
    if (packet.type === "terrain_damage_batch") terrainBatches.push(packet);
    for (const message of packet.type === "terrain_damage_batch" ? packet.events || [] : [packet]) {
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (!waiter.accept(message)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
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
        const recent = messages.slice(-8).map((message) => `${message.type}:${message.phase || "-"}:${message.hostId || "-"}`).join(", ");
        reject(new Error(`Timed out waiting for ${name} message; recent: ${recent || "none"}`));
      }, timeout);
    });
  };
  const welcome = await next((message) => message.type === "welcome");
  socket.send(JSON.stringify({ type: "resume_ack", resumeToken: welcome.resumeToken }));
  return { socket, next, welcome, messages, terrainBatches };
}

async function resumeAttempt(roomCode, resumeToken, name = "Concurrent resume") {
  const socket = new WebSocket(connectionUrl(roomCode, name, 0, timeLimitMinutes, "private", resumeToken));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for concurrent resume")), 4_000);
    const fail = () => {
      clearTimeout(timeout);
      reject(new Error("Concurrent resume rejected"));
    };
    socket.addEventListener("error", fail, { once: true });
    socket.addEventListener("close", fail, { once: true });
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.type !== "welcome") return;
      clearTimeout(timeout);
      resolve({ socket, welcome: message });
    });
  });
}

async function waitForMessageCount(client, accept, count, timeout = 4_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const matches = client.messages.filter(accept);
    if (matches.length >= count) return matches.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for message count ${count}; found ${client.messages.filter(accept).length}`);
}

async function expectConnectionRejected(roomCode, name, roomBotCount = 0, requestedMinutes = timeLimitMinutes, mode = "private") {
  const socket = new WebSocket(connectionUrl(roomCode, name, roomBotCount, requestedMinutes, mode));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${name} rejection`)), 2_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      closeSocket(socket);
      reject(new Error(`${name} unexpectedly joined a reserved full room`));
    }, { once: true });
    const rejected = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.addEventListener("error", rejected, { once: true });
    socket.addEventListener("close", rejected, { once: true });
  });
}

const firstAssignment = await assignment();
assert.equal(firstAssignment.timeLimitMinutes, timeLimitMinutes);
const otherDurationAssignment = await assignment(8);
assert.notEqual(otherDurationAssignment.roomCode, firstAssignment.roomCode, "different durations never share a Quick Play room");
let first = await connect(firstAssignment.roomCode, "Alpha", botCount, 30);
assert.equal(first.welcome.endsAt - first.welcome.startsAt, timeLimitMinutes * 60_000, "the matchmaker reservation overrides a manipulated WebSocket duration");
const secondAssignment = await assignment();
assert.equal(secondAssignment.roomCode, firstAssignment.roomCode);
let second = await connect(firstAssignment.roomCode, "Bravo");
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
const coalescedState = await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId));
assert.ok(coalescedState.players.some((player) => player.id === botId), "same-tick player updates share one room broadcast");
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === botId));

const firstShotId = fire(first, { playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.playerId === firstId);
await new Promise((resolve) => setTimeout(resolve, 35));
first.socket.send(JSON.stringify({ type: "hit", shotId: firstShotId, attackerId: firstId, targetId: secondId, weaponId: "blaster", damage: 999, push: { x: -99, y: 99, z: 99 }, impact: { x: 5, y: 2.05, z: 0 } }));
const damage = await second.next((message) => message.type === "damage" && message.targetId === secondId);
assert.equal(damage.health, 82);
assert.equal(damage.damage, 18);

await new Promise((resolve) => setTimeout(resolve, 1_600));
first.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: firstId, position: { x: -96, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: 5, y: 66.35, z: -10 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: false }]
}));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.position?.y === 66.35));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === firstId && player.position?.x === -96));
first.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: firstId, position: { x: 0, y: 66.35, z: -10 }, velocity: { x: 0, y: 5, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: false }]
}));
const portalShotId = fire(first, { playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.shotId === portalShotId);
await new Promise((resolve) => setTimeout(resolve, 35));
first.socket.send(JSON.stringify({
  type: "hit", shotId: portalShotId, attackerId: firstId, targetId: secondId,
  weaponId: "blaster", impact: { x: 5, y: 67.4, z: -10 }
}));
const portalDamage = await second.next((message) => message.type === "damage" && message.targetId === secondId && message.serverTime > damage.serverTime);
assert.equal(portalDamage.health, 64, "an immediate post-portal shot uses the authoritative exit origin and applies canonical damage");
const portalResumeToken = first.welcome.resumeToken;
await closeSocketAndWait(first.socket);
first = await connect(firstAssignment.roomCode, "Alpha portal reconnect", botCount, timeLimitMinutes, "quick", portalResumeToken);
assert.deepEqual(first.welcome.players.find((player) => player.id === firstId)?.position, { x: 0, y: 66.35, z: -10 }, "reconnect immediately after portal traversal restores the accepted exit position");

await new Promise((resolve) => setTimeout(resolve, 1_600));
first.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: firstId, position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: -20, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === firstId && player.position?.x === 0 && player.position?.y === 1));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.position?.x === -20));
const forgedRocketShotId = fire(first, { playerId: firstId, weaponId: "rocket_launcher", slotIndex: 2, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.shotId === forgedRocketShotId);
const damageCount = second.messages.filter((message) => message.type === "damage" && message.targetId === secondId).length;
first.socket.send(JSON.stringify({
  type: "hit", shotId: forgedRocketShotId, attackerId: firstId, targetId: secondId,
  weaponId: "rocket_launcher", damage: 999, impact: { x: -20, y: 2.05, z: 0 }
}));
await new Promise((resolve) => setTimeout(resolve, 350));
assert.equal(second.messages.filter((message) => message.type === "damage" && message.targetId === secondId).length, damageCount, "a live room rejects an impact behind the authoritative rocket path");
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: 5, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.position?.x === 5));

await new Promise((resolve) => setTimeout(resolve, 320));
const chipPosition = { x: 28.4, y: 31, z: -31.75 };
const chipShotId = fire(first, { playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: directionTo(chipPosition) });
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "blaster" && message.serverTime > damage.serverTime);
await new Promise((resolve) => setTimeout(resolve, 750));
first.socket.send(JSON.stringify({
  type: "terrain_hit", shotId: chipShotId, attackerId: firstId, weaponId: "blaster",
  position: chipPosition, structureId: "structure-1", partId: "structure-1-platform-1"
}));
const chipDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === "structure-1-platform-1");
assert.equal(chipDamage.structuralDamage, 1.8, "ordinary blaster fire applies canonical chip damage to a deck chunk");
assert.equal(chipDamage.collapsed, false);

const chargedPartId = "structure-1-platform-3";
const chargedBounds = structuralPartBounds(first.welcome.seed, chargedPartId);
const chargedPosition = { x: chargedBounds.x, y: (chargedBounds.baseY + chargedBounds.top) / 2, z: chargedBounds.z };
const chargedShotId = fire(first, { playerId: firstId, weaponId: "charged_energy_rifle", slotIndex: 1, direction: directionTo(chargedPosition), chargeRatio: .5 });
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "charged_energy_rifle");
first.socket.send(JSON.stringify({
  type: "terrain_hit", shotId: chargedShotId, attackerId: firstId, weaponId: "charged_energy_rifle",
  position: chargedPosition,
  structureId: "structure-1", partId: chargedPartId
}));
const chargedDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === chargedPartId);
assert.equal(chargedDamage.structuralDamage, WEAPONS.charged_energy_rifle.structureDamage * (.35 + .5 * .65), "partial charge uses the same structural damage scale on the client and room authority");

const clusterPartId = "structure-1-platform-4";
const clusterBounds = structuralPartBounds(first.welcome.seed, clusterPartId);
const clusterPosition = { x: clusterBounds.x, y: (clusterBounds.baseY + clusterBounds.top) / 2, z: clusterBounds.z };
const clusterOrigin = { x: clusterPosition.x - 3, y: clusterPosition.y - 1.2, z: clusterPosition.z };
await new Promise((resolve) => setTimeout(resolve, 320));
first.socket.send(JSON.stringify({ type: "state", players: [{ id: firstId, position: clusterOrigin, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 3, grounded: true }] }));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === firstId && player.position?.x === clusterOrigin.x));
const clusterShotId = fire(first, { playerId: firstId, weaponId: "cluster_grenade", slotIndex: 3, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "cluster_grenade");
first.socket.send(JSON.stringify({
  type: "terrain_hit", shotId: clusterShotId, attackerId: firstId, weaponId: "cluster_grenade",
  position: clusterPosition,
  structureId: "structure-1", partId: clusterPartId
}));
const clusterDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === clusterPartId);
assert.equal(clusterDamage.structuralDamage, WEAPONS.cluster_grenade.structureDamage, "cluster bomblets are accepted under their authoritative parent weapon identity");

await new Promise((resolve) => setTimeout(resolve, 320));
const mortarPartId = "structure-1-platform-12";
const mortarBounds = structuralPartBounds(first.welcome.seed, mortarPartId);
const mortarPosition = {
  x: mortarBounds.x + mortarBounds.w / 2 + WEAPONS.mortar.terrainRadius - .1,
  y: (mortarBounds.baseY + mortarBounds.top) / 2,
  z: mortarBounds.z
};
const mortarFlightTime = 4 / WEAPONS.mortar.projectileSpeed;
const mortarOrigin = {
  x: mortarPosition.x - 4,
  y: mortarPosition.y - WEAPONS.mortar.arcLift * mortarFlightTime + .5 * WEAPONS.mortar.gravity * mortarFlightTime ** 2,
  z: mortarPosition.z
};
first.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: firstId, position: { ...mortarOrigin, y: mortarOrigin.y - 1.2 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 4, grounded: false }]
}));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === firstId && player.slotIndex === 4));
const mortarShotId = fire(first, { playerId: firstId, weaponId: "mortar", slotIndex: 4, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.shotId === mortarShotId);
await new Promise((resolve) => setTimeout(resolve, 80));
first.socket.send(JSON.stringify({
  type: "terrain_hit_batch",
  hits: [{ shotId: mortarShotId, attackerId: firstId, weaponId: "mortar", position: mortarPosition, structureId: "structure-1", partId: mortarPartId }]
}));
const mortarDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === mortarPartId);
assert.equal(mortarDamage.structuralDamage, WEAPONS.mortar.structureDamage, "a live mortar near miss applies canonical structural damage inside its blast radius");
assert.equal(mortarDamage.collapsed, true, "a live mortar near miss destroys the selected major deck section");
assert.ok(second.terrainBatches.some((batch) => batch.events.some((event) => event.id === mortarDamage.id)), "live structural damage arrives through the ordered terrain batch channel");

await new Promise((resolve) => setTimeout(resolve, 450));
const rocketPosition = { x: 42, y: 2, z: -22 };
const rocketOrigin = { x: rocketPosition.x - 4, y: rocketPosition.y - 1.2, z: rocketPosition.z };
first.socket.send(JSON.stringify({ type: "state", players: [{ id: firstId, position: rocketOrigin, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 2, grounded: true }] }));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === firstId && player.position?.x === rocketOrigin.x));
const rocketShotId = fire(first, { playerId: firstId, weaponId: "rocket_launcher", slotIndex: 2, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "rocket_launcher");
first.socket.send(JSON.stringify({
  type: "terrain_hit", shotId: rocketShotId,
  attackerId: firstId,
  weaponId: "rocket_launcher",
  position: rocketPosition,
  radius: 99,
  structureId: "structure-1",
  partId: "structure-1-pillar-1"
}));
const firstTerrainDamage = await second.next((message) => message.type === "terrain_damage" && message.weaponId === "rocket_launcher" && message.partId === "structure-1-pillar-1");
assert.equal(firstTerrainDamage.radius, WEAPONS.rocket_launcher.terrainRadius, "the room uses the weapon's canonical terrain radius");
assert.equal(firstTerrainDamage.structuralDamage, 20, "the room uses the rocket's canonical one-shot structural damage");
assert.equal(firstTerrainDamage.collapsed, true, "one accepted rocket destroys a major stand section");
const terrainDamage = firstTerrainDamage;
await new Promise((resolve) => setTimeout(resolve, 320));
const fallingPartId = "structure-1-platform-2";
const fallingBounds = structuralPartBounds(first.welcome.seed, fallingPartId);
const fallingPosition = { x: fallingBounds.x, y: (fallingBounds.baseY + fallingBounds.top) / 2, z: fallingBounds.z };
const fallingOrigin = { x: fallingPosition.x - 5, y: fallingPosition.y - 1.2, z: fallingPosition.z };
first.socket.send(JSON.stringify({ type: "state", players: [{ id: firstId, position: fallingOrigin, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true }] }));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === firstId && player.position?.x === fallingOrigin.x));
const fallingShotId = fire(first, { playerId: firstId, weaponId: "blaster", slotIndex: 0, direction: { x: 1, y: 0, z: 0 } });
await second.next((message) => message.type === "fire" && message.playerId === firstId && message.weaponId === "blaster" && message.serverTime > firstTerrainDamage.serverTime);
await new Promise((resolve) => setTimeout(resolve, 80));
first.socket.send(JSON.stringify({
  type: "terrain_hit", shotId: fallingShotId, attackerId: firstId, weaponId: "blaster",
  position: fallingPosition,
  structureId: "structure-1", partId: fallingPartId
}));
const fallingDamage = await second.next((message) => message.type === "terrain_damage" && message.partId === fallingPartId);
assert.equal(fallingDamage.structuralDamage, WEAPONS.blaster.structureDamage, "shots at a visibly falling deck remain valid throughout the collapse window");
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: 42, y: 1, z: -22 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.position?.x === 42));
second.socket.send(JSON.stringify({ type: "crush", playerId: secondId, structureId: "structure-1", terrainEventId: terrainDamage.id }));
const crush = await first.next((message) => message.type === "crush" && message.targetId === secondId);
assert.equal(crush.health, 0);
assert.equal(crush.attackerId, firstId);
assert.equal(crush.terrainEventId, terrainDamage.id, "the room attributes a collapse kill to the exact causal terrain event");
assert.equal(crush.scores[firstId], 1, "a structure-collapse kill updates the attacker's authoritative score immediately");
assert.equal(crush.lifeSequence, 1);

second.socket.send(JSON.stringify({ type: "respawn", playerId: secondId, lifeSequence: crush.lifeSequence }));
const pendingRespawn = await second.next((message) => message.type === "respawn_pending" && message.playerId === secondId);
assert.equal(pendingRespawn.lifeSequence, crush.lifeSequence);
assert.ok(pendingRespawn.respawnAt > pendingRespawn.serverTime, "an early request receives server-relative pending timing");
await new Promise((resolve) => setTimeout(resolve, pendingRespawn.respawnAt - pendingRespawn.serverTime + 40));
second.socket.send(JSON.stringify({ type: "respawn", playerId: secondId, lifeSequence: crush.lifeSequence }));
const acceptedRespawn = await waitForMessageCount(first, (message) => message.type === "respawn" && message.playerId === secondId, 1);
await waitForMessageCount(second, (message) => message.type === "respawn" && message.playerId === secondId, 1);
assert.equal(acceptedRespawn.lifeSequence, crush.lifeSequence);
assert.match(acceptedRespawn.respawnId, /^[0-9a-f-]{36}$/i);
const observerRespawnCount = first.messages.filter((message) => message.type === "respawn" && message.playerId === secondId).length;

// Deliberately discard the first completion locally and request it again.
second.socket.send(JSON.stringify({ type: "respawn", playerId: secondId, lifeSequence: crush.lifeSequence }));
const replayedRespawn = await waitForMessageCount(second, (message) => message.type === "respawn" && message.playerId === secondId, 2);
assert.deepEqual(replayedRespawn, acceptedRespawn, "a lost completion is replayed identically without a second life mutation");
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(first.messages.filter((message) => message.type === "respawn" && message.playerId === secondId).length, observerRespawnCount, "a retry is requester-only and never rebroadcast globally");

const secondStateCount = first.messages.filter((message) => message.type === "state" && message.players.some((player) => player.id === secondId)).length;
second.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: secondId, position: { x: 42, y: 1, z: -22 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }]
}));
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(first.messages.filter((message) => message.type === "state" && message.players.some((player) => player.id === secondId)).length, secondStateCount, "the stale death-position packet cannot establish the new life");
const firstSpawn = ARENA_SPAWN_POINTS[acceptedRespawn.respawnSpawnIndex];
second.socket.send(JSON.stringify({
  type: "state",
  players: [{
    id: secondId, position: { ...firstSpawn, y: 230 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: false,
    lifeSequence: acceptedRespawn.lifeSequence, respawnId: acceptedRespawn.respawnId
  }]
}));
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(first.messages.filter((message) => message.type === "state" && message.players.some((player) => player.id === secondId)).length, secondStateCount, "the lifecycle ID cannot authorize a vertical sky teleport at the spawn X/Z");
second.socket.send(JSON.stringify({
  type: "state",
  players: [{
    id: secondId, position: { ...firstSpawn, y: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true,
    lifeSequence: acceptedRespawn.lifeSequence, respawnId: acceptedRespawn.respawnId
  }]
}));
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(first.messages.filter((message) => message.type === "state" && message.players.some((player) => player.id === secondId)).length, secondStateCount, "an elevated canonical spawn cannot claim ground level with a valid lifecycle ID");
second.socket.send(JSON.stringify({
  type: "state",
  players: [{
    id: secondId, position: firstSpawn, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true,
    lifeSequence: acceptedRespawn.lifeSequence, respawnId: acceptedRespawn.respawnId
  }]
}));
await waitForMessageCount(first, (message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.respawnId === acceptedRespawn.respawnId), 1);

const midpoint = {
  x: (firstSpawn.x + mortarPosition.x) / 2,
  y: (firstSpawn.y + mortarPosition.y) / 2,
  z: (firstSpawn.z + mortarPosition.z) / 2
};
await new Promise((resolve) => setTimeout(resolve, 700));
for (const position of [midpoint, mortarPosition]) {
  second.socket.send(JSON.stringify({
    type: "state",
    players: [{
      id: secondId, position, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true,
      lifeSequence: acceptedRespawn.lifeSequence, respawnId: acceptedRespawn.respawnId
    }]
  }));
  await new Promise((resolve) => setTimeout(resolve, 700));
}
second.socket.send(JSON.stringify({ type: "crush", playerId: secondId, structureId: "structure-1", terrainEventId: mortarDamage.id }));
const secondCrush = await first.next((message) => message.type === "crush" && message.targetId === secondId && message.lifeSequence === 2);
const secondResumeToken = second.welcome.resumeToken;
await new Promise((resolve) => setTimeout(resolve, Math.max(0, secondCrush.respawnAt - secondCrush.serverTime + 40)));
await closeSocketAndWait(second.socket);
second = await connect(firstAssignment.roomCode, "Bravo zero reconnect", botCount, timeLimitMinutes, "quick", secondResumeToken);
const reconnectedDead = second.welcome.players.find((player) => player.id === secondId);
assert.equal(reconnectedDead.alive, false);
assert.equal(reconnectedDead.lifeSequence, 2, "reconnect at zero restores the same dead authoritative life");
second.socket.send(JSON.stringify({ type: "respawn", playerId: secondId, lifeSequence: reconnectedDead.lifeSequence }));
const reconnectRespawn = await second.next((message) => message.type === "respawn" && message.playerId === secondId && message.lifeSequence === 2);
const reconnectSpawn = ARENA_SPAWN_POINTS[reconnectRespawn.respawnSpawnIndex];
second.socket.send(JSON.stringify({
  type: "state",
  players: [{
    id: secondId, position: reconnectSpawn, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true,
    lifeSequence: reconnectRespawn.lifeSequence, respawnId: reconnectRespawn.respawnId
  }]
}));
await first.next((message) => message.type === "state" && message.players.some((player) => player.id === secondId && player.respawnId === reconnectRespawn.respawnId));

first.socket.send(JSON.stringify({
  type: "state",
  players: [{ id: botId, position: rocketPosition, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true, lifeSequence: 0, respawnId: "" }]
}));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === botId && player.position?.x === rocketPosition.x));
first.socket.send(JSON.stringify({ type: "crush", playerId: botId, structureId: "structure-1", terrainEventId: terrainDamage.id }));
const botCrush = await second.next((message) => message.type === "crush" && message.targetId === botId);
assert.equal(botCrush.lifeSequence, 1, "the 16-fighter room persists an independently advancing bot life");

const lateJoin = await connect(firstAssignment.roomCode, "Charlie");
assert.ok(lateJoin.welcome.terrainEvents.some((event) => event.id === terrainDamage.id), "late joiners receive authoritative terrain history");
assert.equal(lateJoin.welcome.structuralState["structure-1-pillar-1"], 0, "late joiners receive the compact destroyed-section snapshot");
assert.equal(lateJoin.welcome.structuralState["structure-1-platform-1"], 6.2, "late joiners receive partial chunk health even when the hit log is trimmed");
assert.equal(lateJoin.welcome.structuralState[fallingPartId], 6.2, "late joiners retain damage applied while a support was visibly collapsing");
closeSocket(lateJoin.socket);
await closeSocketAndWait(first.socket);
const migratedBotHostRoster = await second.next((message) => message.type === "roster" && message.botHostId === secondId);
const migratedDeadBot = migratedBotHostRoster.players.find((player) => player.id === botId);
assert.equal(migratedDeadBot?.alive, false, "bot death lifecycle survives migration to the next human host");
second.socket.send(JSON.stringify({ type: "respawn", playerId: botId, lifeSequence: migratedDeadBot.lifeSequence }));
const migratedBotPending = await second.next((message) => message.type === "respawn_pending" && message.playerId === botId);
await new Promise((resolve) => setTimeout(resolve, migratedBotPending.respawnAt - migratedBotPending.serverTime + 40));
second.socket.send(JSON.stringify({ type: "respawn", playerId: botId, lifeSequence: migratedDeadBot.lifeSequence }));
const migratedBotRespawn = await second.next((message) => message.type === "respawn" && message.playerId === botId);
const migratedBotSpawn = ARENA_SPAWN_POINTS[migratedBotRespawn.respawnSpawnIndex];
second.socket.send(JSON.stringify({
  type: "state",
  players: [{
    id: botId, position: migratedBotSpawn, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true,
    lifeSequence: migratedBotRespawn.lifeSequence, respawnId: migratedBotRespawn.respawnId
  }]
}));
await second.next((message) => message.type === "state" && message.players.some((player) => player.id === botId && player.respawnId === migratedBotRespawn.respawnId));
const resumedFirst = await connect(firstAssignment.roomCode, "Alpha reconnect", botCount, timeLimitMinutes, "quick", first.welcome.resumeToken);
assert.equal(resumedFirst.welcome.playerId, firstId, "a dropped player resumes the same authoritative identity");
assert.notEqual(resumedFirst.welcome.resumeToken, first.welcome.resumeToken, "a successful resume rotates the reconnect credential");
assert.ok(resumedFirst.welcome.terrainEvents.some((event) => event.id === terrainDamage.id), "reconnect receives the current terrain snapshot");
resumedFirst.socket.send('{"type":"ping"}');
await resumedFirst.next((message) => message.type === "pong");
closeSocket(resumedFirst.socket);
closeSocket(second.socket);

const privateCode = `P-${Date.now().toString(36).slice(-8)}`;
const privateBotCount = 10;
const privateHost = await connect(privateCode, "Host", privateBotCount, timeLimitMinutes, "private");
assert.equal(privateHost.welcome.phase, "lobby");
assert.equal(privateHost.welcome.hostId, privateHost.welcome.playerId);
assert.equal(privateHost.welcome.players.length, 1);
const privateGuest = await connect(privateCode, "Guest", privateBotCount, timeLimitMinutes, "private");
assert.equal(privateGuest.welcome.phase, "lobby");
assert.equal(privateGuest.welcome.players.length, 2);
assert.equal(privateGuest.welcome.hostId, privateHost.welcome.playerId);
privateGuest.socket.send(JSON.stringify({ type: "lobby_start" }));
await assert.rejects(
  privateGuest.next((message) => message.type === "match_start", 350),
  /Timed out/,
  "a guest cannot start the host's private match"
);
await closeSocketAndWait(privateHost.socket);
const migratedRoster = await privateGuest.next((message) => message.type === "roster" && message.phase === "lobby" && message.hostId === privateGuest.welcome.playerId);
assert.equal(migratedRoster.players.length, 1, "the next oldest player becomes host when the original host leaves");
const privateReplacement = await connect(privateCode, "Replacement", privateBotCount, timeLimitMinutes, "private");
assert.equal(privateReplacement.welcome.hostId, privateGuest.welcome.playerId, "the migrated host remains stable when another friend joins");
privateGuest.socket.send(JSON.stringify({ type: "lobby_start" }));
const [hostStart, guestStart] = await Promise.all([
  privateGuest.next((message) => message.type === "match_start"),
  privateReplacement.next((message) => message.type === "match_start")
]);
assert.equal(hostStart.phase, "playing");
assert.equal(guestStart.phase, "playing");
assert.equal(hostStart.configuredBotCount, privateBotCount);
assert.equal(hostStart.players.filter((player) => player.bot).length, privateBotCount, "friends do not reduce the configured private-room bot count");
assert.equal(hostStart.players.length, privateBotCount + 2);

const privateHostId = privateGuest.welcome.playerId;
const privateBots = hostStart.players.filter((player) => player.bot);
const privatePartId = "structure-2-pillar-1";
const privateBounds = structuralPartBounds(hostStart.seed, privatePartId);
const privatePosition = { x: privateBounds.x, y: (privateBounds.baseY + privateBounds.top) / 2, z: privateBounds.z };
privateGuest.socket.send(JSON.stringify({
  type: "state",
  players: [
    { id: privateHostId, position: privatePosition, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }, slotIndex: 2, grounded: true },
    ...privateBots.map((bot) => ({ id: bot.id, position: privatePosition, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 0, grounded: true }))
  ]
}));
const privateRocketShotId = fire(privateGuest, { playerId: privateHostId, weaponId: "rocket_launcher", slotIndex: 2, direction: { x: 1, y: 0, z: 0 } });
await privateReplacement.next((message) => message.type === "fire" && message.playerId === privateHostId && message.weaponId === "rocket_launcher");
privateGuest.socket.send(JSON.stringify({
  type: "terrain_hit", shotId: privateRocketShotId, attackerId: privateHostId, weaponId: "rocket_launcher", position: privatePosition,
  structureId: "structure-2", partId: privatePartId
}));
const privateCollapse = await privateReplacement.next((message) => message.type === "terrain_damage" && message.partId === privatePartId);
assert.equal(privateCollapse.collapsed, true);
privateGuest.socket.send(JSON.stringify({ type: "crush", playerId: privateBots[0].id, structureId: "structure-2", terrainEventId: privateCollapse.id }));
const privateCrush = await privateReplacement.next((message) => message.type === "crush" && message.targetId === privateBots[0].id);
assert.equal(privateCrush.scores[privateHostId], 1, "collapse credit is visible before the attacker reconnects");
await closeSocketAndWait(privateGuest.socket);
const rejoinedPrivateHost = await connect(privateCode, "Changed name cannot reset score", privateBotCount, timeLimitMinutes, "private", privateGuest.welcome.resumeToken);
assert.equal(rejoinedPrivateHost.welcome.playerId, privateHostId, "a private-room player can deliberately leave and rejoin the active match");
assert.notEqual(rejoinedPrivateHost.welcome.resumeToken, privateGuest.welcome.resumeToken, "manual rejoin rotates the room credential");
assert.equal(rejoinedPrivateHost.welcome.players.find((player) => player.id === privateHostId)?.score, 1, "manual rejoin restores the authoritative score");
assert.equal(rejoinedPrivateHost.welcome.players.find((player) => player.id === privateHostId)?.name, "Guest", "manual rejoin cannot replace the authoritative identity with a new name");
await closeSocketAndWait(privateReplacement.socket);
const hostLobbyReturn = rejoinedPrivateHost.next((message) => message.type === "lobby");
for (const bot of privateBots.slice(1)) {
  rejoinedPrivateHost.socket.send(JSON.stringify({ type: "crush", playerId: bot.id, structureId: "structure-2", terrainEventId: privateCollapse.id }));
  await rejoinedPrivateHost.next((message) => message.type === "crush" && message.targetId === bot.id);
}
const returnedHost = await hostLobbyReturn;
assert.equal(returnedHost.phase, "lobby");
assert.equal(returnedHost.hostId, privateHostId);
assert.equal(returnedHost.players.length, 1, "bots and disconnected fighters leave the active lobby roster after the result");
assert.equal(returnedHost.lastResult.winnerId, privateHostId);
rejoinedPrivateHost.socket.send(JSON.stringify({ type: "lobby_start" }));
await rejoinedPrivateHost.next((message) => message.type === "match_start");
const rejoinedRematchGuest = await connect(privateCode, "Cannot carry old points", privateBotCount, timeLimitMinutes, "private", privateReplacement.welcome.resumeToken);
assert.equal(rejoinedRematchGuest.welcome.players.find((player) => player.id === privateReplacement.welcome.playerId)?.score, 0, "a player leaving the rematch resumes only that round's score");
closeSocket(rejoinedPrivateHost.socket);
closeSocket(rejoinedRematchGuest.socket);

const capacityCode = `C-${Date.now().toString(36).slice(-8)}`;
const capacityPlayers = [];
for (let index = 0; index < 16; index++) capacityPlayers.push(await connect(capacityCode, `Capacity ${index + 1}`, 0, timeLimitMinutes, "private"));
const reservedPlayer = capacityPlayers.shift();
await closeSocketAndWait(reservedPlayer.socket);
await expectConnectionRejected(capacityCode, "Unreserved seventeenth player");
const resumedCapacityPlayer = await connect(capacityCode, "Reserved player returns", 0, timeLimitMinutes, "private", reservedPlayer.welcome.resumeToken);
assert.equal(resumedCapacityPlayer.welcome.players.filter((player) => !player.bot).length, 16, "a stored identity reserves one of the room's sixteen human slots");
for (const participant of capacityPlayers) closeSocket(participant.socket);
closeSocket(resumedCapacityPlayer.socket);

const resumeRaceCode = `R-${Date.now().toString(36).slice(-8)}`;
const resumeRaceSeed = await connect(resumeRaceCode, "Resume race", 0, timeLimitMinutes, "private");
const resumeRaceResults = await Promise.allSettled(Array.from({ length: 3 }, (_, index) =>
  resumeAttempt(resumeRaceCode, resumeRaceSeed.welcome.resumeToken, `Concurrent resume ${index + 1}`)
));
const acceptedResumes = resumeRaceResults.filter((result) => result.status === "fulfilled").map((result) => result.value);
assert.equal(acceptedResumes.length, 1, "only one simultaneous socket can consume a reconnect identity");
assert.equal(acceptedResumes[0].welcome.playerId, resumeRaceSeed.welcome.playerId, "the winning reconnect preserves the authoritative identity");
assert.equal(new Set(acceptedResumes[0].welcome.players.map((player) => player.id)).size, acceptedResumes[0].welcome.players.length, "the winning roster contains no duplicate fighter identity");
const resumeRaceStatus = await fetch(`${origin}/api/rooms/${resumeRaceCode}/status`).then((response) => response.json());
assert.equal(resumeRaceStatus.activeHumans, 1, "a reconnect race leaves exactly one active human socket");
closeSocket(acceptedResumes[0].socket);

const recoveryAssignment = await assignment(timeLimitMinutes, firstAssignment.roomCode);
assert.notEqual(recoveryAssignment.roomCode, firstAssignment.roomCode, "a timed-out Quick Play room is replaced on the retry");
assert.equal((await assignment()).roomCode, recoveryAssignment.roomCode, "an abandoned canonical room is replaced by the recovery room");
console.log("Quick recovery, session resume, coalesced state, and persistent private-lobby lifecycle passed.");

// Isolated room: real paid shots, two observing clients and fourteen bots.
const cornerCode = `C-${Date.now().toString(36).slice(-8)}`;
const cornerHost = await connect(cornerCode, "Corner QA host", 14, 7, "private");
const cornerGuest = await connect(cornerCode, "Corner QA observer", 14, 7, "private");
cornerHost.socket.send(JSON.stringify({ type: "lobby_start" }));
const cornerStart = await cornerGuest.next((message) => message.type === "match_start");
assert.equal(cornerStart.players.length, 16);
assert.equal(cornerStart.arenaRevision, 2);
let cornerPosition = null;
let nextCornerFireAt = 0;
for (const partId of ["structure-17-pillar-7", "structure-18-pillar-9", "structure-19-pillar-12", "structure-20-pillar-11", "structure-17-pillar-1", "structure-18-pillar-1", "structure-19-pillar-1", "structure-20-pillar-1"]) {
  const bounds = structuralPartBounds(cornerStart.seed, partId);
  const impact = { x: bounds.x + bounds.w / 2, y: (bounds.baseY + bounds.top) / 2, z: bounds.z };
  const destination = { x: impact.x + 4, y: impact.y - 1.2, z: impact.z };
  const distance = cornerPosition ? Math.hypot(destination.x - cornerPosition.x, destination.y - cornerPosition.y, destination.z - cornerPosition.z) : 0;
  const steps = Math.max(1, Math.ceil(distance / 10));
  const previous = cornerPosition || destination;
  for (let step = 1; step <= steps; step++) {
    const position = Object.fromEntries(["x", "y", "z"].map((axis) => [axis, previous[axis] + (destination[axis] - previous[axis]) * step / steps]));
    cornerHost.socket.send(JSON.stringify({ type: "state", players: [{ id: cornerHost.welcome.playerId, position, velocity: { x: 0, y: 0, z: 0 }, aim: { x: -1, y: 0, z: 0 }, slotIndex: 2, grounded: false }] }));
    await cornerGuest.next((message) => message.type === "state" && message.players.some((player) => player.id === cornerHost.welcome.playerId && player.position.x === position.x && player.position.y === position.y && player.position.z === position.z));
  }
  cornerPosition = destination;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextCornerFireAt - Date.now())));
  const shotId = fire(cornerHost, { playerId: cornerHost.welcome.playerId, weaponId: "rocket_launcher", slotIndex: 2, direction: { x: -1, y: 0, z: 0 } });
  const paid = await cornerGuest.next((message) => message.type === "fire" && message.shotId === shotId);
  nextCornerFireAt = Math.max(paid.reloadCompleteAt || 0, paid.serverTime + WEAPONS.rocket_launcher.cooldown * 1000) + 80;
  await new Promise((resolve) => setTimeout(resolve, 80));
  cornerHost.socket.send(JSON.stringify({ type: "terrain_hit", shotId, attackerId: cornerHost.welcome.playerId, weaponId: "rocket_launcher", position: impact, structureId: partId.split("-").slice(0, 2).join("-"), partId }));
  const damage = await cornerGuest.next((message) => message.type === "terrain_damage" && message.partId === partId && message.collapsed);
  assert.equal(damage.structuralHealth, 0);
}
await closeSocketAndWait(cornerGuest.socket);
const cornerResume = await connect(cornerCode, "Corner QA resume", 14, 7, "private", cornerGuest.welcome.resumeToken);
assert.equal(cornerResume.welcome.playerId, cornerGuest.welcome.playerId);
assert.equal(Object.keys(cornerResume.welcome.structuralState).length, 8);
assert.ok(Object.values(cornerResume.welcome.structuralState).every((health) => health === 0));
closeSocket(cornerResume.socket);
closeSocket(cornerHost.socket);
console.log("All four corner pillars: high/base destruction, paid ammunition and reconnect state passed in a 16-fighter live room.");
process.exit(0);
