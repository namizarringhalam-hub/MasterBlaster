import { DurableObject } from "cloudflare:workers";
import { DEFAULT_LOADOUT, WEAPONS, structuralPartBounds, weaponFireMode, weaponUsesAmmo } from "../src/gameData.js";
import TEXT, { formatText } from "../src/playerText.js";
import {
  MATCH_DURATION_MS,
  MATCH_TARGET_SCORE,
  MAX_MATCH_PLAYERS,
  MULTIPLAYER_PROTOCOL_VERSION,
  finiteNumber,
  matchTimeRemaining,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeLoadout,
  sanitizePlayerName,
  sanitizeVector,
  squaredDistance
} from "../src/multiplayerProtocol.js";

const WEAPON_IDS = Object.keys(WEAPONS);
const DIFFICULTIES = new Set(["rookie", "normal", "veteran"]);
const COLORS = [
  [0x129dba, 0x6ff6ff], [0xc82849, 0xff6b82], [0x6bad22, 0xb9ff55], [0x7847ca, 0xc793ff],
  [0xd77a16, 0xffc14f], [0xb92d86, 0xff75cf], [0x2867ce, 0x75b5ff], [0x15987b, 0x62ffd0],
  [0xbe4f20, 0xff8a55], [0x7456a8, 0xd0a8ff], [0x158a98, 0x68efff], [0xb58c18, 0xffde5e],
  [0xb33f5e, 0xff86a2], [0x327ba5, 0x78d5ff], [0x3c9a4e, 0x81f58d], [0xa43aa9, 0xf07dff]
];

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*", ...headers }
  });
}

function playerAmmo(loadout) {
  return Object.fromEntries(loadout.map((id) => [id, WEAPONS[id].ammo]));
}

function botLoadout(index) {
  return Array.from({ length: 5 }, (_, slot) => WEAPON_IDS[(8 + index * 5 + slot) % WEAPON_IDS.length]);
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    accent: player.accent,
    loadout: player.loadout,
    bot: Boolean(player.bot),
    score: player.score || 0,
    health: player.health,
    alive: player.alive,
    position: player.hasState ? player.position : null,
    velocity: player.velocity,
    aim: player.aim,
    slotIndex: player.slotIndex,
    ammo: player.ammo,
    respawnAt: player.respawnAt || 0
  };
}

function publicState(player) {
  return {
    id: player.id,
    position: player.position,
    velocity: player.velocity,
    aim: player.aim,
    slotIndex: player.slotIndex,
    grounded: player.grounded
  };
}

function roomPlayer(id, name, loadout, colorIndex, bot = false) {
  const [color, accent] = COLORS[colorIndex % COLORS.length];
  return {
    id, name, loadout, color, accent, bot,
    health: 100, alive: true, score: 0, deaths: 0,
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 0, y: 0, z: 1 },
    slotIndex: 0, grounded: true, ammo: playerAmmo(loadout), reloadEndsAt: {},
    lastFireAt: {}, lastStateAt: 0, hasState: false, respawnAt: 0, joinedAt: Date.now()
  };
}

function safeBody(request) {
  return request.json().catch(() => ({}));
}

export class Matchmaker extends DurableObject {
  async fetch(request) {
    if (request.method !== "POST") return json({ error: TEXT.errors.methodNotAllowed }, 405);
    const input = await safeBody(request);
    const targetSize = Math.min(MAX_MATCH_PLAYERS, Math.max(2, Math.trunc(finiteNumber(input.botCount, 7, 1, 15)) + 1));
    const difficulty = DIFFICULTIES.has(input.difficulty) ? input.difficulty : "normal";
    const key = `open:${targetSize}:${difficulty}`;
    let roomCode = await this.ctx.storage.get(key);
    if (roomCode) {
      const room = this.env.MATCH_ROOMS.getByName(roomCode);
      const status = await room.fetch("https://room.internal/status").then((response) => response.json()).catch(() => null);
      if (!status || status.ended || status.humans >= status.capacity) roomCode = null;
    }
    if (!roomCode) {
      roomCode = normalizeRoomCode(`Q-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`);
      await this.ctx.storage.put(key, roomCode);
    }
    return json({ roomCode, targetSize, difficulty });
  }
}

export class MatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.meta = null;
    this.bots = new Map();
    this.recentFires = new Map();
    this.terrainEvents = [];
    this.structuralHealth = new Map();
    this.structuralFailures = new Map();
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.meta = await this.ctx.storage.get("meta") || null;
      for (const bot of await this.ctx.storage.get("bots") || []) this.bots.set(bot.id, bot);
      this.terrainEvents = await this.ctx.storage.get("terrainEvents") || [];
      const storedStructuralHealth = await this.ctx.storage.get("structuralHealth");
      if (storedStructuralHealth) for (const [partId, health] of storedStructuralHealth) this.structuralHealth.set(partId, health);
      else for (const event of this.terrainEvents) if (event.partId && Number.isFinite(event.structuralHealth)) this.structuralHealth.set(event.partId, event.structuralHealth);
      const storedStructuralFailures = await this.ctx.storage.get("structuralFailures");
      if (storedStructuralFailures) for (const [partId, failedAt] of storedStructuralFailures) this.structuralFailures.set(partId, failedAt);
      else for (const event of this.terrainEvents) if (event.collapsed && event.partId) this.structuralFailures.set(event.partId, event.serverTime || 0);
    });
  }

  humanEntries() {
    const entries = [];
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const player = socket.deserializeAttachment();
        if (player?.id) entries.push([socket, player]);
      } catch {
        socket.close(1011, TEXT.errors.invalidSessionState);
      }
    }
    return entries;
  }

  allPlayers() {
    return [...this.humanEntries().map(([, player]) => player), ...this.bots.values()];
  }

  playerById(id) {
    for (const [socket, player] of this.humanEntries()) if (player.id === id) return { socket, player };
    const player = this.bots.get(id);
    return player ? { socket: null, player } : null;
  }

  botHostId() {
    return this.humanEntries()
      .map(([, player]) => player)
      .sort((left, right) => left.joinedAt - right.joinedAt)[0]?.id || "";
  }

  async initialize(url) {
    if (this.meta && !this.meta.ended && matchTimeRemaining(this.meta.endsAt) > 0) return;
    const now = Date.now();
    const targetSize = Math.min(MAX_MATCH_PLAYERS, Math.max(1, Math.trunc(finiteNumber(url.searchParams.get("botCount"), 7, 0, 15)) + 1));
    this.meta = {
      roomCode: normalizeRoomCode(url.pathname.split("/").filter(Boolean).at(-2), "ROOM"),
      seed: normalizeRoomCode(url.searchParams.get("seed"), normalizeRoomCode(url.pathname.split("/").filter(Boolean).at(-2), TEXT.loading.defaultSeed)),
      difficulty: DIFFICULTIES.has(url.searchParams.get("difficulty")) ? url.searchParams.get("difficulty") : "normal",
      targetSize,
      startedAt: now + 4_000,
      endsAt: now + 4_000 + MATCH_DURATION_MS,
      targetScore: MATCH_TARGET_SCORE,
      ended: false
    };
    this.bots.clear();
    this.recentFires.clear();
    this.terrainEvents = [];
    this.structuralHealth.clear();
    this.structuralFailures.clear();
    await this.persistRoom();
  }

  async persistRoom() {
    await Promise.all([
      this.ctx.storage.put("meta", this.meta),
      this.ctx.storage.put("bots", [...this.bots.values()]),
      this.ctx.storage.put("terrainEvents", this.terrainEvents),
      this.ctx.storage.put("structuralHealth", [...this.structuralHealth]),
      this.ctx.storage.put("structuralFailures", [...this.structuralFailures])
    ]);
  }

  async reconcileBots() {
    const humans = this.humanEntries().length;
    const desired = Math.max(0, Math.min(MAX_MATCH_PLAYERS - humans, this.meta.targetSize - humans));
    for (let index = 0; index < desired; index++) {
      const id = `bot-${index + 1}`;
      if (this.bots.has(id)) continue;
      const bot = roomPlayer(id, formatText(TEXT.defaults.quickBotName, { number: String(index + 1).padStart(2, "0") }), botLoadout(index), humans + index, true);
      this.bots.set(id, bot);
    }
    for (const id of [...this.bots.keys()]) {
      const index = Number(id.split("-")[1]) - 1;
      if (index >= desired) this.bots.delete(id);
    }
    await this.persistRoom();
  }

  rosterMessage(type = "roster") {
    return {
      type,
      roomCode: this.meta.roomCode,
      seed: this.meta.seed,
      serverTime: Date.now(),
      startsAt: this.meta.startedAt,
      endsAt: this.meta.endsAt,
      targetScore: this.meta.targetScore,
      botHostId: this.botHostId(),
      players: this.allPlayers().map(publicPlayer),
      ...(type === "welcome" ? { terrainEvents: this.terrainEvents, structuralState: Object.fromEntries(this.structuralHealth) } : {})
    };
  }

  broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(encoded); } catch { socket.close(1011, TEXT.errors.deliveryFailed); }
    }
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname.endsWith("/status")) {
      const humans = this.humanEntries().length;
      return json({ humans, capacity: MAX_MATCH_PLAYERS, targetSize: this.meta?.targetSize || 0, ended: !this.meta || this.meta.ended || matchTimeRemaining(this.meta.endsAt) === 0 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: TEXT.errors.websocketRequired }, 426);
    if (Number(url.searchParams.get("v")) !== MULTIPLAYER_PROTOCOL_VERSION) return json({ error: TEXT.errors.unsupportedProtocol }, 426);
    await this.initialize(url);
    if (this.humanEntries().length >= MAX_MATCH_PLAYERS || this.meta.ended) return json({ error: TEXT.errors.roomFull }, 409);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const humans = this.humanEntries().length;
    const id = `player-${crypto.randomUUID().slice(0, 12)}`;
    const loadout = sanitizeLoadout(url.searchParams.get("loadout"), WEAPONS, DEFAULT_LOADOUT);
    const player = roomPlayer(id, sanitizePlayerName(url.searchParams.get("name")), loadout, humans);
    server.serializeAttachment(player);
    this.ctx.acceptWebSocket(server);
    await this.reconcileBots();
    server.send(JSON.stringify({ ...this.rosterMessage("welcome"), playerId: id }));
    this.broadcast(this.rosterMessage());
    return new Response(null, { status: 101, webSocket: client });
  }

  authorizedPlayers(socket, requested) {
    const session = socket.deserializeAttachment();
    const allowed = new Set([session.id]);
    if (session.id === this.botHostId()) for (const id of this.bots.keys()) allowed.add(id);
    return requested.filter((state) => allowed.has(state?.id));
  }

  applyLazyReload(player, weaponId, now) {
    if (!weaponUsesAmmo(WEAPONS[weaponId])) {
      player.ammo[weaponId] = WEAPONS[weaponId].ammo;
      delete player.reloadEndsAt[weaponId];
      return;
    }
    const completeAt = player.reloadEndsAt[weaponId] || 0;
    if (completeAt && completeAt <= now) {
      player.ammo[weaponId] = WEAPONS[weaponId].ammo;
      delete player.reloadEndsAt[weaponId];
    }
  }

  updatePlayerState(player, state, now) {
    if (!player.alive) return null;
    const position = sanitizeVector(state.position);
    const elapsed = Math.min(1.5, Math.max(.05, (now - (player.lastStateAt || now)) / 1000));
    const movementBudget = 9 + 95 * elapsed;
    if (player.hasState && squaredDistance(position, player.position) > movementBudget * movementBudget) return null;
    player.position = {
      x: finiteNumber(position.x, player.position.x, -220, 220),
      y: finiteNumber(position.y, player.position.y, -24, 230),
      z: finiteNumber(position.z, player.position.z, -220, 220)
    };
    player.velocity = sanitizeVector(state.velocity, 100);
    player.aim = sanitizeVector(state.aim, 1);
    if (Math.hypot(player.aim.x, player.aim.y, player.aim.z) < .5) player.aim = { x: 0, y: 0, z: 1 };
    player.slotIndex = Math.trunc(finiteNumber(state.slotIndex, player.slotIndex, 0, 4));
    player.grounded = Boolean(state.grounded);
    player.lastStateAt = now;
    player.hasState = true;
    return publicState(player);
  }

  async handleState(socket, message) {
    const now = Date.now();
    const requested = Array.isArray(message.players) ? message.players.slice(0, MAX_MATCH_PLAYERS) : [];
    const changed = [];
    for (const state of this.authorizedPlayers(socket, requested)) {
      const entry = this.playerById(state.id);
      if (!entry) continue;
      for (const weaponId of entry.player.loadout) this.applyLazyReload(entry.player, weaponId, now);
      const update = this.updatePlayerState(entry.player, state, now);
      if (update) changed.push(update);
      if (entry.socket) entry.socket.serializeAttachment(entry.player);
    }
    if (changed.length) this.broadcast({ type: "state", players: changed, serverTime: now, endsAt: this.meta.endsAt });
    await this.checkMatchEnd(now);
  }

  authorizedActor(socket, playerId) {
    const session = socket.deserializeAttachment();
    if (playerId === session.id) return this.playerById(playerId);
    if (session.id === this.botHostId() && this.bots.has(playerId)) return this.playerById(playerId);
    return null;
  }

  async handleFire(socket, message) {
    const entry = this.authorizedActor(socket, message.playerId);
    if (!entry?.player.alive) return;
    const player = entry.player;
    const weapon = WEAPONS[message.weaponId];
    const slotIndex = Math.trunc(finiteNumber(message.slotIndex, -1, 0, 4));
    if (!weapon || player.loadout[slotIndex] !== weapon.id) return;
    const now = Date.now();
    this.applyLazyReload(player, weapon.id, now);
    const minimumDelay = Math.max(24, weapon.cooldown * 1000 * .72);
    if (now - (player.lastFireAt[weapon.id] || 0) < minimumDelay) return;
    const detonation = weapon.type === "remote" && message.action === "detonate";
    const usesAmmo = weaponUsesAmmo(weapon);
    if (usesAmmo && !detonation && (player.ammo[weapon.id] || 0) <= 0) {
      player.reloadEndsAt[weapon.id] ||= now + weapon.reload * 1000;
      this.broadcast({ type: "reload", playerId: player.id, weaponId: weapon.id, completeAt: player.reloadEndsAt[weapon.id] });
      return;
    }
    player.lastFireAt[weapon.id] = now;
    if (usesAmmo && !detonation) player.ammo[weapon.id] -= weaponFireMode(weapon) === "burst" ? Math.min(weapon.burstCount || 1, player.ammo[weapon.id]) : 1;
    if (usesAmmo && player.ammo[weapon.id] === 0) player.reloadEndsAt[weapon.id] = now + weapon.reload * 1000;
    const shot = {
      id: crypto.randomUUID(), playerId: player.id, weaponId: weapon.id, firedAt: now,
      origin: { ...player.position }, hits: Object.create(null),
      structureDamageScale: weapon.chargeTime
        ? .35 + finiteNumber(message.chargeRatio, weapon.minCharge || 0, weapon.minCharge || 0, 1) * .65
        : 1
    };
    const history = this.recentFires.get(player.id) || [];
    history.push(shot);
    while (history.length > 24 || history[0]?.firedAt < now - 12_000) history.shift();
    this.recentFires.set(player.id, history);
    if (entry.socket) entry.socket.serializeAttachment(player);
    this.broadcast({
      type: "fire", shotId: shot.id, playerId: player.id, weaponId: weapon.id, slotIndex,
      direction: sanitizeVector(message.direction, 1), triggerTap: Boolean(message.triggerTap), action: detonation ? "detonate" : "fire",
      chargeRatio: weapon.chargeTime ? finiteNumber(message.chargeRatio, weapon.minCharge || 0, weapon.minCharge || 0, 1) : 1,
      ammo: player.ammo[weapon.id], reloadCompleteAt: player.reloadEndsAt[weapon.id] || 0, serverTime: now
    });
  }

  async handleReload(socket, message) {
    const entry = this.authorizedActor(socket, message.playerId);
    const weapon = WEAPONS[message.weaponId];
    if (!entry || !weapon || !weaponUsesAmmo(weapon) || !entry.player.loadout.includes(weapon.id)) return;
    const player = entry.player;
    if (player.ammo[weapon.id] >= weapon.ammo || player.reloadEndsAt[weapon.id]) return;
    player.reloadEndsAt[weapon.id] = Date.now() + weapon.reload * 1000;
    if (entry.socket) entry.socket.serializeAttachment(player);
    this.broadcast({ type: "reload", playerId: player.id, weaponId: weapon.id, completeAt: player.reloadEndsAt[weapon.id] });
  }

  recentValidShot(attacker, target, weapon, now) {
    const history = this.recentFires.get(attacker.id) || [];
    const maximumAge = Math.min(12_000, 1_500 + 1000 * Math.max(0, weapon.fuse || weapon.hazardDuration || 0));
    const maximumRange = (weapon.maxUsefulRange || weapon.reach || 180) + (weapon.radius || 0) + 14;
    for (let index = history.length - 1; index >= 0; index--) {
      const shot = history[index];
      if (shot.weaponId !== weapon.id || now - shot.firedAt > maximumAge) continue;
      if (squaredDistance(shot.origin, target.position) > maximumRange * maximumRange) continue;
      const prior = shot.hits[target.id] || 0;
      const limit = weapon.hazard ? 32 : weapon.pellets || (weapon.type === "chain" ? weapon.chains || 3 : 1);
      if (prior >= limit) continue;
      shot.hits[target.id] = prior + 1;
      return shot;
    }
    return null;
  }

  async handleHit(socket, message) {
    const attackerEntry = this.authorizedActor(socket, message.attackerId);
    const targetEntry = this.playerById(message.targetId);
    const weapon = WEAPONS[message.weaponId];
    if (!attackerEntry?.player.alive || !targetEntry?.player.alive || !weapon) return;
    const attacker = attackerEntry.player;
    const target = targetEntry.player;
    if (!attacker.loadout.includes(weapon.id)) return;
    const now = Date.now();
    if (!this.recentValidShot(attacker, target, weapon, now)) return;
    const claimed = finiteNumber(message.damage, weapon.damage, 0, weapon.damage);
    const damage = Math.max(1, Math.min(weapon.damage, claimed));
    target.health = Math.max(0, target.health - damage);
    const killed = target.health === 0;
    if (killed) {
      target.alive = false;
      target.deaths += 1;
      target.respawnAt = now + 2_800;
      if (target.id !== attacker.id) attacker.score += 1;
    }
    if (targetEntry.socket) targetEntry.socket.serializeAttachment(target);
    if (attackerEntry.socket) attackerEntry.socket.serializeAttachment(attacker);
    this.broadcast({
      type: "damage", attackerId: attacker.id, targetId: target.id, weaponId: weapon.id,
      damage, health: target.health, killed, push: sanitizeVector(message.push, 40), respawnAt: target.respawnAt,
      scores: Object.fromEntries(this.allPlayers().map((player) => [player.id, player.score])), serverTime: now
    });
    await this.checkMatchEnd(now);
  }

  recentValidTerrainShot(attacker, weapon, position, now) {
    const history = this.recentFires.get(attacker.id) || [];
    const maximumAge = Math.min(12_000, 1_800 + 1000 * Math.max(0, weapon.fuse || weapon.hazardDuration || 0));
    const maximumRange = (weapon.maxUsefulRange || weapon.reach || 180) + (weapon.radius || 0) + 18;
    const limit = Math.max(1, weapon.split || weapon.pellets || weapon.burstCount || (weapon.terrainPenetration || weapon.penetration || 0) + 1);
    for (let index = history.length - 1; index >= 0; index--) {
      const shot = history[index];
      if (shot.weaponId !== weapon.id || now - shot.firedAt > maximumAge) continue;
      if (squaredDistance(shot.origin, position) > maximumRange * maximumRange) continue;
      if ((shot.terrainHits || 0) >= limit) continue;
      shot.terrainHits = (shot.terrainHits || 0) + 1;
      return shot;
    }
    return null;
  }

  async handleTerrainHit(socket, message) {
    const attackerEntry = this.authorizedActor(socket, message.attackerId);
    const weapon = WEAPONS[message.weaponId];
    const canonicalStructuralDamage = weapon?.structureDamage || weapon?.terrainRadius || 0;
    if (!attackerEntry?.player.alive || (!weapon?.terrainRadius && !canonicalStructuralDamage) || !attackerEntry.player.loadout.includes(weapon.id)) return;
    const position = sanitizeVector(message.position);
    if (Math.abs(position.x) > 120 || Math.abs(position.z) > 120 || position.y < -2 || position.y > 100) return;
    const now = Date.now();
    const terrainShot = this.recentValidTerrainShot(attackerEntry.player, weapon, position, now);
    if (!terrainShot) return;
    const structuralDamage = canonicalStructuralDamage * (terrainShot.structureDamageScale || 1);
    const structureId = /^structure-(?:[1-9]|1[0-6])$/.test(String(message.structureId || "")) ? String(message.structureId) : "";
    const requestedPartId = String(message.partId || "");
    let partId = structureId && new RegExp(`^${structureId}-(?:platform-[1-9]\\d*|pillar-[1-8])$`).test(requestedPartId) ? requestedPartId : "";
    const bounds = structuralPartBounds(this.meta.seed, partId);
    if (bounds) {
      const targetPillar = /-pillar-(\d+)$/.exec(partId);
      let settledDrop = 0;
      let fallingDrop = 0;
      for (const [failedId, health] of this.structuralHealth) {
        const failedPillar = new RegExp(`^${structureId}-pillar-(\\d+)$`).exec(failedId);
        if (health > 0 || !failedPillar || targetPillar && Number(failedPillar[1]) >= Number(targetPillar[1])) continue;
        const failedBounds = structuralPartBounds(this.meta.seed, failedId);
        const height = failedBounds ? failedBounds.top - failedBounds.baseY : 0;
        const failedAt = this.structuralFailures.get(failedId) || 0;
        if (failedAt && now - failedAt < 1_650) fallingDrop += height;
        else settledDrop += height;
      }
      const padding = .85;
      const validPosition = Math.abs(position.x - bounds.x) <= bounds.w / 2 + padding &&
        Math.abs(position.z - bounds.z) <= bounds.d / 2 + padding &&
        position.y >= bounds.baseY - settledDrop - fallingDrop - padding &&
        position.y <= bounds.top - settledDrop + padding;
      if (!validPosition) partId = "";
    } else partId = "";
    let structuralHealth = null;
    let collapsed = false;
    if (partId) {
      const majorTower = /^structure-[1-6]-/.test(partId);
      const maximumHealth = majorTower ? 8 : 6;
      const currentHealth = this.structuralHealth.get(partId) ?? maximumHealth;
      structuralHealth = Math.max(0, currentHealth - structuralDamage);
      collapsed = currentHealth > 0 && structuralHealth === 0;
      this.structuralHealth.set(partId, structuralHealth);
      if (collapsed) this.structuralFailures.set(partId, now);
    }
    const event = {
      type: "terrain_damage",
      id: crypto.randomUUID(),
      attackerId: attackerEntry.player.id,
      weaponId: weapon.id,
      position,
      radius: weapon.terrainRadius || 0,
      structuralDamage,
      structureId,
      partId,
      structuralHealth,
      collapsed,
      serverTime: now
    };
    this.terrainEvents.push(event);
    if (this.terrainEvents.length > 256) this.terrainEvents.splice(0, this.terrainEvents.length - 256);
    await this.persistRoom();
    this.broadcast(event);
  }

  async handleCrush(socket, message) {
    const targetEntry = this.authorizedActor(socket, message.playerId);
    if (!targetEntry?.player.alive) return;
    const structureId = String(message.structureId || "");
    const now = Date.now();
    const event = [...this.terrainEvents].reverse().find((candidate) =>
      candidate.structureId === structureId &&
      candidate.collapsed === true &&
      now - candidate.serverTime <= 5_000 &&
      Math.hypot(candidate.position.x - targetEntry.player.position.x, candidate.position.z - targetEntry.player.position.z) <= 18
    );
    if (!event || targetEntry.player.lastCrushEventId === event.id) return;
    const target = targetEntry.player;
    const attackerEntry = this.playerById(event.attackerId);
    target.lastCrushEventId = event.id;
    target.health = 0;
    target.alive = false;
    target.deaths += 1;
    target.respawnAt = now + 2_800;
    if (attackerEntry?.player && attackerEntry.player.id !== target.id) attackerEntry.player.score += 1;
    if (targetEntry.socket) targetEntry.socket.serializeAttachment(target);
    if (attackerEntry?.socket) attackerEntry.socket.serializeAttachment(attackerEntry.player);
    await this.persistRoom();
    this.broadcast({
      type: "crush",
      targetId: target.id,
      attackerId: attackerEntry?.player?.id || "",
      structureId,
      health: 0,
      killed: true,
      respawnAt: target.respawnAt,
      scores: Object.fromEntries(this.allPlayers().map((player) => [player.id, player.score])),
      serverTime: now
    });
    await this.checkMatchEnd(now);
  }

  async handleRespawn(socket, message) {
    const entry = this.authorizedActor(socket, message.playerId);
    if (!entry || entry.player.alive || Date.now() < entry.player.respawnAt) return;
    const player = entry.player;
    player.health = 100;
    player.alive = true;
    player.respawnAt = 0;
    player.ammo = playerAmmo(player.loadout);
    player.reloadEndsAt = {};
    player.hasState = false;
    if (entry.socket) entry.socket.serializeAttachment(player);
    this.broadcast({ type: "respawn", playerId: player.id, spawnIndex: (player.deaths * 5 + this.allPlayers().indexOf(player)) % MAX_MATCH_PLAYERS, ammo: player.ammo, serverTime: Date.now() });
  }

  async checkMatchEnd(now = Date.now()) {
    if (this.meta.ended) return;
    const players = this.allPlayers();
    const winner = players.reduce((best, player) => !best || player.score > best.score ? player : best, null);
    if (now < this.meta.endsAt && (winner?.score || 0) < this.meta.targetScore) return;
    this.meta.ended = true;
    await this.persistRoom();
    this.broadcast({
      type: "match_end", winnerId: winner?.id || "",
      scores: Object.fromEntries(players.map((player) => [player.id, player.score])), serverTime: now
    });
  }

  async webSocketMessage(socket, value) {
    await this.ready;
    const message = parseClientMessage(value);
    if (!message || this.meta?.ended) return;
    if (message.type === "state") await this.handleState(socket, message);
    else if (message.type === "fire") await this.handleFire(socket, message);
    else if (message.type === "hit") await this.handleHit(socket, message);
    else if (message.type === "terrain_hit") await this.handleTerrainHit(socket, message);
    else if (message.type === "crush") await this.handleCrush(socket, message);
    else if (message.type === "reload") await this.handleReload(socket, message);
    else if (message.type === "respawn") await this.handleRespawn(socket, message);
    else if (message.type === "ping") socket.send(JSON.stringify({ type: "pong", serverTime: Date.now() }));
  }

  async webSocketClose() {
    await this.ready;
    await this.reconcileBots();
    this.broadcast(this.rosterMessage());
  }

  async webSocketError() {
    await this.ready;
    await this.reconcileBots();
    this.broadcast(this.rosterMessage());
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }
    });
    if (url.pathname === "/api/health") return json({ ok: true, service: "master-blaster-multiplayer", protocol: MULTIPLAYER_PROTOCOL_VERSION });
    if (url.pathname === "/api/quick" && request.method === "POST") {
      return env.MATCHMAKER.getByName("global").fetch(request);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9-]{1,12})\/(connect|status)$/);
    if (!match) return json({ error: TEXT.errors.notFound }, 404);
    const roomCode = normalizeRoomCode(match[1]);
    return env.MATCH_ROOMS.getByName(roomCode).fetch(request);
  }
};
