import assert from "node:assert/strict";

const origin = process.env.MULTIPLAYER_TEST_ORIGIN || "http://127.0.0.1:8787";
const loadout = ["blaster", "shotgun", "rocket_launcher", "grenade_launcher", "railgun"];
const botCount = 15;

async function assignment() {
  const response = await fetch(`${origin}/api/quick`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ botCount, difficulty: "veteran" })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function connect(roomCode, name) {
  const url = new URL(`/api/rooms/${roomCode}/connect`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("v", "1");
  url.searchParams.set("name", name);
  url.searchParams.set("loadout", loadout.join(","));
  url.searchParams.set("botCount", String(botCount));
  url.searchParams.set("difficulty", "veteran");
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
const first = await connect(firstAssignment.roomCode, "Alpha");
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

first.socket.close(1000, "test complete");
second.socket.close(1000, "test complete");
console.log("Two-client multiplayer room lifecycle passed.");
