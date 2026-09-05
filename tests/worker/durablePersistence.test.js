import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ARENA_SPAWN_POINTS, DEFAULT_LOADOUT, structuralPartBounds, structuralTowerBlueprints, WEAPONS } from "../../src/gameData.js";

describe("MatchRoom durable authority", () => {
  it("keeps legacy arenas isolated until all active and reserved identities drain", async () => {
    const stub = env.MATCH_ROOMS.getByName("ARENA-BRIDGE");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "ARENA-BRIDGE", seed: "BRIDGE", mode: "private", phase: "lobby", ended: false };
      await room.ctx.storage.put("meta", room.meta);
      const request = () => new Request("https://room.internal/api/rooms/ARENA-BRIDGE/connect?v=1&arenaRevision=2&mode=private", { headers: { upgrade: "websocket" } });
      const originalCount = room.effectiveHumanCount;
      room.effectiveHumanCount = () => 1;
      expect((await room.fetch(request())).status).toBe(426);
      expect(room.meta.arenaRevision).toBeUndefined();
      room.effectiveHumanCount = originalCount;
      room.resumeSessions.set("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", { player: { id: "reserved" }, expiresAt: Date.now() + 10_000 });
      expect((await room.fetch(request())).status).toBe(426);
      expect(room.meta.arenaRevision).toBeUndefined();
      room.resumeSessions.clear();
      room.structuralHealth.set("structure-1-pillar-1", 0);
      room.structuralFailures.set("structure-1-pillar-1", Date.now());
      room.terrainEvents.push({ partId: "structure-1-pillar-1" });
      const accepted = await room.fetch(request());
      expect(accepted.status).toBe(101);
      accepted.webSocket.accept();
      expect(room.meta.arenaRevision).toBe(2);
      expect(room.structuralHealth.size).toBe(0);
      expect(room.structuralFailures.size).toBe(0);
      expect(room.terrainEvents).toEqual([]);
      expect((await room.fetch(new Request("https://room.internal/api/rooms/ARENA-BRIDGE/connect?v=1&mode=private", { headers: { upgrade: "websocket" } }))).status).toBe(426);
      accepted.webSocket.close(1000, "test complete");
    });
  });

  it("authorizes every corner pillar section, rejects invented parts, and persists demolition", async () => {
    const stub = env.MATCH_ROOMS.getByName("CORNER-PILLAR-AUTHORITY");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "CORNER-PILLAR-AUTHORITY", seed: "CORNER-QA", phase: "playing", ended: false, arenaRevision: 2 };
      await room.ctx.storage.put("meta", room.meta);
      const player = { id: "corner-bot", bot: true, alive: true, loadout: ["machine_gun", "rocket_launcher"], position: { x: 0, y: 0, z: 0 } };
      room.bots.set(player.id, player);
      const socket = { deserializeAttachment: () => ({ id: player.id }) };
      const report = async (structureId, partId, position, weaponId = "rocket_launcher") => {
        const shot = {
          id: crypto.randomUUID(), playerId: player.id, weaponId, firedAt: Date.now(),
          origin: { ...position }, direction: { x: 1, y: 0, z: 0 },
          hits: {}, hitPositions: [], damageScale: 1, structureDamageScale: 1,
          strategy: weaponId === "machine_gun" ? "ray" : "explosive"
        };
        room.recentFires.set(player.id, [shot]);
        await room.handleTerrainHit(socket, { shotId: shot.id, attackerId: player.id, weaponId, position, structureId, partId });
      };
      for (const [index, tower] of structuralTowerBlueprints(room.meta.seed).entries()) {
        if (!tower.landmarkIndex) continue;
        const structureId = `structure-${index + 1}`;
        let previousStart = 0;
        // Top-down includes IDs 9–12, which the old hard-coded validator rejected.
        for (let part = tower.segmentCount; part >= 1; part--) {
          const partId = `${structureId}-pillar-${part}`;
          const bounds = structuralPartBounds(room.meta.seed, partId);
          const position = { x: tower.x + 3.5, y: (bounds.baseY + bounds.top) / 2, z: tower.z };
          await report(structureId, partId, position, "machine_gun");
          expect(room.structuralHealth.get(partId)).toBe(8 - WEAPONS.machine_gun.structureDamage);
          await report(structureId, partId, position);
          expect(room.structuralHealth.get(partId)).toBe(0);
          expect(room.terrainEvents.at(-1)).toMatchObject({ partId, collapsed: true, attackerId: player.id });
          const collapseStartsAt = room.terrainEvents.at(-1).collapseStartsAt;
          expect(collapseStartsAt).toBeGreaterThanOrEqual(previousStart + 1_650);
          previousStart = collapseStartsAt;
          await report(structureId, partId, position);
          expect(room.terrainEvents.at(-1).collapsed).toBe(false);
          expect(room.terrainEvents.at(-1).collapseStartsAt).toBe(collapseStartsAt);
        }
        for (const partId of [`${structureId}-platform-1`, `${structureId}-pillar-${tower.segmentCount + 1}`, `${structureId}-pillar-0`, "structure-21-pillar-1"]) {
          await report(partId.split("-").slice(0, 2).join("-"), partId, { x: tower.x, y: tower.top, z: tower.z });
          expect(room.structuralHealth.has(partId)).toBe(false);
          expect(room.terrainEvents.at(-1).partId).toBe("");
        }
      }
      expect(room.structuralHealth.size).toBe(39);
      if (room.persistenceTask) await room.persistenceTask;
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      expect(room.structuralHealth.size).toBe(39);
      expect([...room.structuralHealth.values()].every((health) => health === 0)).toBe(true);
      expect(room.structuralFailures.size).toBe(39);
      expect(Object.keys(room.rosterMessage("welcome").structuralState)).toHaveLength(39);
      expect(room.rosterMessage("welcome").structuralFailures).toEqual(Object.fromEntries(room.structuralFailures));
    });
  });

  it("applies mortar damage to a structure inside its canonical blast radius", async () => {
    const stub = env.MATCH_ROOMS.getByName("MORTAR-STRUCTURE-SPLASH");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "MORTAR-STRUCTURE-SPLASH", seed: "MORTAR-QA", phase: "playing", ended: false };
      const partId = "structure-1-pillar-1";
      const bounds = structuralPartBounds(room.meta.seed, partId);
      const blastPosition = {
        x: bounds.x + bounds.w / 2 + WEAPONS.mortar.terrainRadius - .1,
        y: (bounds.baseY + bounds.top) / 2,
        z: bounds.z
      };
      const player = {
        id: "mortar-bot", bot: true, alive: true, loadout: ["mortar"],
        position: { ...blastPosition }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 }
      };
      const socket = { deserializeAttachment: () => ({ id: player.id }) };
      room.bots.set(player.id, player);
      const report = async (position, id) => {
        const shot = {
          id, playerId: player.id, weaponId: "mortar", firedAt: Date.now(), origin: { ...position }, direction: { x: 1, y: 0, z: 0 },
          hits: {}, hitPositions: [], damageScale: 1, structureDamageScale: 1, strategy: "explosive"
        };
        room.recentFires.set(player.id, [shot]);
        await room.handleTerrainHit(socket, {
          type: "terrain_hit", shotId: shot.id, attackerId: player.id, weaponId: "mortar",
          position, structureId: "structure-1", partId
        });
      };
      await report({ ...blastPosition, x: bounds.x + bounds.w / 2 + WEAPONS.mortar.terrainRadius + .01 }, "66666666-6666-4666-8666-666666666661");
      await report({ ...blastPosition, x: bounds.x + bounds.w / 2 + WEAPONS.mortar.terrainRadius / Math.SQRT2 + .01, z: bounds.z + bounds.d / 2 + WEAPONS.mortar.terrainRadius / Math.SQRT2 + .01 }, "66666666-6666-4666-8666-666666666662");
      await report({ ...blastPosition, x: bounds.x, y: bounds.top + WEAPONS.mortar.terrainRadius + .01 }, "66666666-6666-4666-8666-666666666663");
      expect(room.structuralHealth.has(partId)).toBe(false);
      await report(blastPosition, "66666666-6666-4666-8666-666666666666");
      expect(room.structuralHealth.get(partId)).toBe(0);
      if (room.persistenceTask) await room.persistenceTask;
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      expect(room.structuralHealth.get("structure-1-pillar-1")).toBe(0);
      expect(room.recentFires.get("mortar-bot")?.[0]?.terrainHits).toBe(1);
    });
  });

  it("accepts only known paired portal jumps outside the ordinary movement budget", async () => {
    const stub = env.MATCH_ROOMS.getByName("PORTAL-AUTHORITY");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      const player = {
        id: "portal-player", alive: true, hasState: true, lastStateAt: 1_000,
        position: { x: -96, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 },
        slotIndex: 0, grounded: true
      };
      const portalState = {
        position: { x: 0, y: 66.35, z: -10 }, velocity: { x: 0, y: 5, z: 0 },
        aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: false
      };
      expect(room.updatePlayerState(player, portalState, 1_050)?.position).toEqual(portalState.position);
      const reversePortalState = { ...portalState, position: { x: -96, y: 0, z: 0 } };
      expect(room.updatePlayerState(player, reversePortalState, 1_100)).toBeNull();
      expect(player.position).toEqual(portalState.position);
      expect(room.updatePlayerState(player, reversePortalState, 2_251)?.position).toEqual(reversePortalState.position);
      expect(room.updatePlayerState(player, { ...portalState, position: { x: 0, y: 66.35, z: 10 } }, 3_452)).toBeNull();
      expect(player.position).toEqual(reversePortalState.position);
      player.position = { x: -96, y: 0, z: 0 };
      player.lastStateAt = 1_000;
      player.lastPortalAt = 0;
      expect(room.updatePlayerState(player, { ...portalState, position: { x: 96, y: .35, z: 0 } }, 1_050)).toBeNull();
      expect(player.position).toEqual({ x: -96, y: 0, z: 0 });
      player.position = { x: -80.01, y: 0, z: 0 };
      player.lastStateAt = 1_000;
      expect(room.updatePlayerState(player, portalState, 1_050)).toBeNull();
      expect(player.position).toEqual({ x: -80.01, y: 0, z: 0 });
      player.position = { x: -50, y: 0, z: 0 };
      player.lastStateAt = 1_000;
      expect(room.updatePlayerState(player, portalState, 1_500)).toBeNull();
      expect(player.position).toEqual({ x: -50, y: 0, z: 0 });
      player.position = { x: 0, y: 0, z: 0 };
      player.lastStateAt = 1_000;
      expect(room.updatePlayerState(player, { ...portalState, position: { x: 96, y: 0, z: 0 } }, 2_500)?.position.x).toBe(96);
      player.position = { x: 0, y: 0, z: 0 };
      player.lastStateAt = 1_000;
      expect(room.updatePlayerState(player, { ...portalState, position: { x: 96.01, y: 0, z: 0 } }, 2_500)).toBeNull();
    });
  });

  it("authorizes teleport-projectile displacement from its validated shot path", async () => {
    const stub = env.MATCH_ROOMS.getByName("PROJECTILE-TELEPORT-AUTHORITY");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "PROJECTILE-TELEPORT-AUTHORITY", seed: "AUTHORITY", phase: "playing", ended: false };
      const now = Date.now();
      const player = {
        id: "teleporter", bot: true, alive: true, hasState: true, lastStateAt: now - 50,
        loadout: ["teleport_projectile"], position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
        aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true
      };
      const shot = {
        id: "33333333-3333-4333-8333-333333333333", playerId: player.id, weaponId: "teleport_projectile",
        firedAt: now - 500, origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 1, y: 0, z: 0 },
        hits: {}, hitPositions: [], damageScale: 1, structureDamageScale: 1, strategy: "projectile"
      };
      room.bots.set(player.id, player);
      room.recentFires.set(player.id, [shot]);
      const socket = { deserializeAttachment: () => ({ id: player.id }) };
      await room.handleTeleport(socket, {
        playerId: player.id, shotId: shot.id, impact: { x: 50, y: 1.2, z: 0 },
        position: { x: 48.65, y: 1.2, z: 0 }
      });
      expect(player.position.x).toBeCloseTo(48.65);
      expect(player.velocity).toEqual({ x: 0, y: 2.5, z: 0 });
      expect(shot.teleported).toBe(true);
      const accepted = { ...player.position };
      await room.handleTeleport(socket, {
        playerId: player.id, shotId: shot.id, impact: { x: 90, y: 1.2, z: 0 },
        position: { x: 88.65, y: 1.2, z: 0 }
      });
      expect(player.position).toEqual(accepted);
      const structureShot = {
        ...shot, id: "44444444-4444-4444-8444-444444444444", firedAt: now - 100,
        origin: { x: 30, y: 2.5, z: -22 }, hits: {}, hitPositions: [], teleported: false
      };
      room.recentFires.set(player.id, [structureShot]);
      await room.handleTeleport(socket, {
        playerId: player.id, shotId: structureShot.id, impact: { x: 37.8, y: 2.5, z: -22 },
        position: { x: 38, y: 2.5, z: -22 }
      });
      expect(player.position).toEqual(accepted);
      expect(structureShot.teleported).toBe(false);
      await room.handleTeleport(socket, {
        playerId: player.id, shotId: structureShot.id, impact: { x: 37.8, y: 2.5, z: -22 },
        position: { x: 36.45, y: 2.5, z: -22 }
      });
      expect(player.position.x).toBeCloseTo(36.45);
      expect(structureShot.teleported).toBe(true);
      const deck = structuralPartBounds("AUTHORITY", "structure-1-platform-1");
      const deckShot = {
        ...shot, id: "55555555-5555-4555-8555-555555555555", firedAt: now - 100,
        origin: { x: deck.x, y: deck.baseY - 9.5, z: deck.z }, direction: { x: 0, y: 1, z: 0 },
        hits: {}, hitPositions: [], teleported: false
      };
      room.recentFires.set(player.id, [deckShot]);
      await room.handleTeleport(socket, {
        playerId: player.id, shotId: deckShot.id, impact: { x: deck.x, y: deck.baseY, z: deck.z },
        position: { x: deck.x, y: deck.top + .2, z: deck.z }
      });
      expect(player.position.x).toBeCloseTo(36.45);
      expect(deckShot.teleported).toBe(false);
      await room.handleTeleport(socket, {
        playerId: player.id, shotId: deckShot.id, impact: { x: deck.x, y: deck.baseY, z: deck.z },
        position: { x: deck.x, y: deck.baseY - 2.251, z: deck.z }
      });
      expect(player.position.y).toBeCloseTo(deck.baseY - 2.251);
      expect(deckShot.teleported).toBe(true);
      if (room.persistenceTask) await room.persistenceTask;
    });
  });

  it("restores exact bot and in-flight combat state after eviction", async () => {
    const stub = env.MATCH_ROOMS.getByName("EVICTION-AUTHORITY");
    const expected = await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = {
        roomCode: "EVICTION-AUTHORITY", seed: "EVICTION", mode: "quick", phase: "playing",
        difficulty: "veteran", targetSize: 16, configuredBotCount: 15,
        startedAt: Date.now(), endsAt: Date.now() + 300_000, timeLimitMinutes: 5,
        targetScore: 10, ended: false, lastResult: null
      };
      await room.reconcileBots();
      const bot = room.bots.get("bot-1");
      Object.assign(bot, {
        score: 7, health: 0, alive: false, deaths: 3, respawnAt: Date.now() + 2_800,
        position: { x: 37.25, y: 11.5, z: -28.75 }, velocity: { x: 3, y: -4, z: 5 },
        aim: { x: -.6, y: .2, z: .77 }, slotIndex: 2, grounded: false, hasState: true,
        ammo: { ...bot.ammo, [bot.loadout[2]]: 1 }, reloadEndsAt: { [bot.loadout[2]]: Date.now() + 900 }
      });
      const remoteShot = {
        id: "22222222-2222-4222-8222-222222222222", playerId: bot.id,
        weaponId: "remote_explosive", firedAt: Date.now(), origin: { ...bot.position },
        direction: { x: 1, y: 0, z: 0 }, hits: {}, hitPositions: [], damageScale: 1,
        structureDamageScale: 1, strategy: "explosive"
      };
      room.recentFires.set(bot.id, [remoteShot]);
      const persistenceTask = room.schedulePersistence({ bots: true, fires: true });
      for (let index = 0; index < 100; index++) {
        bot.position.x = 37.25 + index / 100;
        room.schedulePersistence({ bots: true, fires: true });
      }
      expect(room.persistenceTask).toBe(persistenceTask);
      await persistenceTask;
      return { bot: structuredClone(bot), remoteShot: structuredClone(remoteShot) };
    });

    await evictDurableObject(stub);

    const restored = await runInDurableObject(stub, async (room) => {
      await room.ready;
      return {
        bot: structuredClone(room.bots.get("bot-1")),
        remoteShot: structuredClone(room.recentFires.get("bot-1")?.[0])
      };
    });
    expect(restored).toEqual(expected);
  });

  it("retries a rejected coalesced persistence write without losing dirty state", async () => {
    const stub = env.MATCH_ROOMS.getByName("PERSISTENCE-RETRY");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "PERSISTENCE-RETRY" };
      room.bots.set("bot-retry", { id: "bot-retry", score: 9 });
      const persistBatchEntry = room.persistBatchEntry.bind(room);
      let attempts = 0;
      room.persistBatchEntry = (key, value) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("simulated transient storage failure"));
        return persistBatchEntry(key, value);
      };
      const firstAttempt = room.schedulePersistence({ bots: true });
      await firstAttempt;
      const retry = room.persistenceTask;
      expect(retry).not.toBeNull();
      await retry;
      expect(attempts).toBe(2);
      expect(await room.ctx.storage.get("bots")).toEqual([{ id: "bot-retry", score: 9 }]);
    });
  });

  it("coalesces heavy terrain bursts and restores the final structural state after eviction", async () => {
    const stub = env.MATCH_ROOMS.getByName("TERRAIN-PERSISTENCE-BURST");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "TERRAIN-PERSISTENCE-BURST", seed: "BURST" };
      let writes = 0;
      const persistBatchEntry = room.persistBatchEntry.bind(room);
      room.persistBatchEntry = (key, value) => {
        writes += 1;
        return persistBatchEntry(key, value);
      };
      let firstTask;
      for (let index = 0; index < 96; index++) {
        const partId = `structure-1-platform-${index % 15 + 1}`;
        room.terrainEvents.push({ id: `burst-${index}`, partId, structuralHealth: index % 8, serverTime: index });
        room.structuralHealth.set(partId, index % 8);
        if (index % 8 === 0) room.structuralFailures.set(partId, index);
        const task = room.schedulePersistence({ terrain: true });
        firstTask ||= task;
        expect(task).toBe(firstTask);
      }
      await firstTask;
      expect(writes).toBe(3);
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      expect(room.terrainEvents).toHaveLength(96);
      expect(room.terrainEvents.at(-1)?.id).toBe("burst-95");
      expect(room.structuralHealth.get("structure-1-platform-6")).toBe(7);
      expect(room.structuralFailures.get("structure-1-platform-6")).toBe(80);
    });
  });

  it("broadcasts a synchronized terrain burst once in exact event order", async () => {
    const stub = env.MATCH_ROOMS.getByName("TERRAIN-BROADCAST-BURST");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "TERRAIN-BROADCAST-BURST", phase: "playing", ended: false };
      const broadcasts = [];
      room.broadcast = (message) => broadcasts.push(message);
      for (let index = 0; index < 96; index++) room.queueTerrainBroadcast({ type: "terrain_damage", id: `terrain-${index}` });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].type).toBe("terrain_damage_batch");
      expect(broadcasts[0].events.map(({ id }) => id)).toEqual(Array.from({ length: 96 }, (_, index) => `terrain-${index}`));
    });
  });

  it("persists a secondary bot killed by authoritative splash damage", async () => {
    const stub = env.MATCH_ROOMS.getByName("SECONDARY-BOT-SPLASH-DEATH");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "SECONDARY-BOT-SPLASH-DEATH", phase: "playing", ended: false };
      const attacker = { id: "human-attacker", bot: false, alive: true, health: 100, score: 0, deaths: 0 };
      const bot = { id: "bot-secondary", bot: true, active: true, alive: true, health: 10, score: 0, deaths: 0, respawnAt: 0 };
      room.bots.set(bot.id, bot);
      room.broadcast = () => {};
      await room.applyAuthoritativeDamage(
        { player: attacker, socket: null },
        { player: bot, socket: null },
        WEAPONS.rocket_launcher,
        { damage: 10, push: { x: 0, y: 0, z: 0 } },
        Date.now()
      );
      expect(bot.alive).toBe(false);
      if (room.persistenceTask) await room.persistenceTask;
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      const restored = room.bots.get("bot-secondary");
      expect(restored?.alive).toBe(false);
      expect(restored?.health).toBe(0);
      expect(restored?.deaths).toBe(1);
    });
  });

  it("credits a crush to its exact terrain event even when a newer collapse shares the structure", async () => {
    const stub = env.MATCH_ROOMS.getByName("EXACT-CRUSH-ATTRIBUTION");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      const now = Date.now();
      room.meta = { roomCode: "EXACT-CRUSH-ATTRIBUTION", phase: "playing", ended: false, targetScore: 10, endsAt: now + 60_000 };
      const attackerA = { id: "bot-attacker-a", bot: true, active: true, alive: true, health: 100, score: 0, deaths: 0, position: { x: 0, y: 1, z: 0 } };
      const attackerB = { id: "bot-attacker-b", bot: true, active: true, alive: true, health: 100, score: 0, deaths: 0, position: { x: 0, y: 1, z: 0 } };
      const target = { id: "bot-crush-target", bot: true, active: true, alive: true, health: 100, score: 0, deaths: 0, position: { x: 2, y: 1, z: 2 } };
      room.bots.set(attackerA.id, attackerA);
      room.bots.set(attackerB.id, attackerB);
      room.bots.set(target.id, target);
      const causalId = "77777777-7777-4777-8777-777777777771";
      room.terrainEvents = [
        { id: causalId, structureId: "structure-1", attackerId: attackerA.id, collapsed: true, position: { x: 2, y: 1, z: 2 }, serverTime: now - 200 },
        { id: "77777777-7777-4777-8777-777777777772", structureId: "structure-1", attackerId: attackerB.id, collapsed: true, position: { x: 2, y: 1, z: 2 }, serverTime: now - 100 }
      ];
      room.authorizedActor = (_socket, playerId) => room.playerById(playerId);
      const broadcasts = [];
      room.broadcast = (message) => broadcasts.push(message);
      await room.handleCrush({}, { playerId: target.id, structureId: "structure-1", terrainEventId: causalId });
      expect(target.alive).toBe(false);
      expect(attackerA.score).toBe(1);
      expect(attackerB.score).toBe(0);
      expect(broadcasts.at(-1)?.attackerId).toBe(attackerA.id);
      expect(broadcasts.at(-1)?.scores?.[attackerA.id]).toBe(1);
    });
  });

  it("persists collapse credit for an attacker who disconnects before the structure lands", async () => {
    const stub = env.MATCH_ROOMS.getByName("DISCONNECTED-CRUSH-CREDIT");
    const resumeToken = "88888888-8888-4888-8888-888888888888";
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      const now = Date.now();
      room.meta = { roomCode: "DISCONNECTED-CRUSH-CREDIT", phase: "playing", ended: false, targetScore: 10, endsAt: now + 60_000 };
      const attacker = { id: "disconnected-attacker", bot: false, alive: true, health: 100, score: 0, deaths: 0 };
      const target = { id: "bot-disconnected-crush-target", bot: true, active: true, alive: true, health: 100, score: 0, deaths: 0, position: { x: 4, y: 1, z: 4 } };
      room.resumeSessions.set(resumeToken, { player: attacker, expiresAt: now + 45_000 });
      room.bots.set(target.id, target);
      const terrainEventId = "99999999-9999-4999-8999-999999999999";
      room.terrainEvents = [{
        id: terrainEventId, structureId: "structure-3", attackerId: attacker.id, collapsed: true,
        position: { x: 4, y: 1, z: 4 }, serverTime: now - 200
      }];
      room.authorizedActor = (_socket, playerId) => room.playerById(playerId);
      const broadcasts = [];
      room.broadcast = (message) => broadcasts.push(message);
      expect(room.resumePlayerById(attacker.id)?.player).toBe(attacker);
      await room.handleCrush({}, { playerId: target.id, structureId: "structure-3", terrainEventId });
      expect(target.alive).toBe(false);
      expect(broadcasts.at(-1)?.attackerId).toBe(attacker.id);
      expect(attacker.score).toBe(1);
      expect(room.resumeSessions.get(resumeToken)?.player.score).toBe(1);
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      expect(room.resumeSessions.get(resumeToken)?.player.score).toBe(1);
    });
  });

  it("retires and restores a capacity-displaced bot without reusing its identity as a fresh fighter", async () => {
    const stub = env.MATCH_ROOMS.getByName("BOT-CAPACITY-RETIREMENT");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "BOT-CAPACITY-RETIREMENT", mode: "quick", phase: "playing", ended: false, targetSize: 16 };
      const retired = {
        id: "bot-15", bot: true, active: true, alive: false, health: 0, score: 4, deaths: 3, respawnAt: Date.now() + 1_000,
        loadout: ["mortar"], ammo: { mortar: 0 }, reloadEndsAt: {}, lastFireAt: {}, position: { x: 1, y: 1, z: 1 }
      };
      room.bots.set(retired.id, retired);
      room.recentFires.set(retired.id, [{ id: "stale-shot" }]);
      room.humanEntries = () => Array.from({ length: 2 }, (_, index) => [{}, { id: `human-${index}` }]);
      await room.reconcileBots();
      expect(room.bots.get(retired.id)?.active).toBe(false);
      expect(room.recentFires.has(retired.id)).toBe(false);
      room.humanEntries = () => [[{}, { id: "human-0" }]];
      await room.reconcileBots();
      const restored = room.bots.get(retired.id);
      expect(restored?.active).toBe(true);
      expect(restored?.alive).toBe(false);
      expect(restored?.score).toBe(4);
      expect(restored?.deaths).toBe(3);
      expect(restored?.ammo?.mortar).toBe(0);
      expect(room.recentFires.has(retired.id)).toBe(false);
    });
  });

  it("makes capable bot-host respawns idempotent and rejects stale post-respawn state", async () => {
    const stub = env.MATCH_ROOMS.getByName("RESPAWN-HANDSHAKE-BOT");
    let accepted;
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = {
        roomCode: "RESPAWN-HANDSHAKE-BOT", seed: "RESPAWN", mode: "private", phase: "playing",
        configuredBotCount: 1, targetSize: 1, targetScore: 10, endsAt: Date.now() + 60_000, ended: false
      };
      await room.reconcileBots();
      const bot = room.bots.get("bot-1");
      Object.assign(bot, {
        alive: false, health: 0, deaths: 3, score: 4, respawnAt: Date.now() + 5_000,
        respawnId: "", respawnSpawnIndex: -1, respawnAcceptedAt: 0, respawnAmmo: null,
        awaitingRespawnState: false, hasState: true, position: { x: 42, y: 2, z: -37 }
      });
      room.botHostId = () => "host-player";
      const sent = [];
      const host = {
        deserializeAttachment: () => ({ id: "host-player", lifeStateCapable: true }),
        send: (value) => sent.push(JSON.parse(value)), close: () => {}
      };
      const intruder = {
        deserializeAttachment: () => ({ id: "intruder", lifeStateCapable: true }),
        send: (value) => sent.push(JSON.parse(value)), close: () => {}
      };
      const broadcasts = [];
      room.broadcast = (message) => broadcasts.push(structuredClone(message));

      await room.handleRespawn(host, { playerId: bot.id, lifeSequence: 3 });
      expect(sent.at(-1)).toMatchObject({ type: "respawn_pending", playerId: bot.id, lifeSequence: 3 });
      expect(sent.at(-1).respawnAt).toBe(bot.respawnAt);
      expect(bot.alive).toBe(false);

      bot.respawnAt = Date.now() - 1;
      await room.handleRespawn(intruder, { playerId: bot.id, lifeSequence: 3 });
      expect(bot.alive).toBe(false);
      expect(broadcasts).toHaveLength(0);
      await room.handleRespawn(host, { playerId: bot.id, lifeSequence: 2 });
      expect(bot.alive).toBe(false);
      await room.handleRespawn(host, { playerId: bot.id, lifeSequence: 3 });
      expect(bot.alive).toBe(true);
      expect(bot.awaitingRespawnState).toBe(true);
      expect(bot.respawnId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(broadcasts).toHaveLength(1);
      accepted = structuredClone(broadcasts[0]);
      const acceptedAmmo = bot.ammo[bot.loadout[0]];
      await room.handleFire(host, {
        playerId: bot.id, weaponId: bot.loadout[0], slotIndex: 0,
        shotId: crypto.randomUUID(), direction: { x: 1, y: 0, z: 0 }
      });
      expect(bot.ammo[bot.loadout[0]]).toBe(acceptedAmmo);
      expect(broadcasts).toHaveLength(1);

      bot.health = 63;
      bot.ammo[bot.loadout[0]] = 2;
      bot.position = { x: 17, y: 4, z: 19 };
      await room.handleRespawn(host, { playerId: bot.id, lifeSequence: 3 });
      expect(sent.at(-1)).toEqual(accepted);
      expect(broadcasts).toHaveLength(1);
      expect(bot.health).toBe(63);
      expect(bot.ammo[bot.loadout[0]]).toBe(2);
      expect(bot.position).toEqual({ x: 17, y: 4, z: 19 });

      const spawn = ARENA_SPAWN_POINTS[accepted.respawnSpawnIndex];
      const state = {
        position: { x: spawn.x, y: spawn.y, z: spawn.z }, velocity: { x: 0, y: 0, z: 0 },
        aim: { x: 1, y: 0, z: 0 }, slotIndex: 0, grounded: true
      };
      expect(room.updatePlayerState(bot, state, Date.now(), true)).toBeNull();
      expect(room.updatePlayerState(bot, { ...state, lifeSequence: 2, respawnId: accepted.respawnId }, Date.now(), true)).toBeNull();
      expect(room.updatePlayerState(bot, { ...state, lifeSequence: 3, respawnId: crypto.randomUUID() }, Date.now(), true)).toBeNull();
      expect(room.updatePlayerState(bot, {
        ...state, lifeSequence: 3, respawnId: accepted.respawnId,
        position: { ...state.position, x: state.position.x + 8.01 }
      }, Date.now(), true)).toBeNull();
      expect(room.updatePlayerState(bot, {
        ...state, lifeSequence: 3, respawnId: accepted.respawnId,
        position: { ...state.position, y: state.position.y + 8.01 }
      }, Date.now(), true)).toBeNull();
      expect(room.updatePlayerState(bot, {
        ...state, lifeSequence: 3, respawnId: accepted.respawnId,
        position: { ...state.position, y: -1.01 }
      }, Date.now(), true)).toBeNull();
      const elevated = {
        ...structuredClone(bot), id: "elevated-respawn", hasState: false, awaitingRespawnState: true,
        respawnSpawnIndex: 0, position: { x: 10, y: 66, z: 0 }
      };
      const elevatedState = {
        ...state, lifeSequence: 3, respawnId: accepted.respawnId,
        position: { x: 10, y: 0, z: 0 }
      };
      expect(room.updatePlayerState(elevated, elevatedState, Date.now(), true)).toBeNull();
      expect(room.updatePlayerState(elevated, { ...elevatedState, position: { x: 10, y: 66, z: 0 } }, Date.now(), true)?.position.y).toBe(66);
      room.structuralHealth.set("structure-1-pillar-1", 0);
      const lowered = {
        ...structuredClone(bot), id: "lowered-respawn", hasState: false, awaitingRespawnState: true,
        respawnSpawnIndex: 5, position: { x: 50, y: 31, z: -22 }
      };
      const loweredY = 31 - 31 / 6;
      expect(room.updatePlayerState(lowered, {
        ...state, lifeSequence: 3, respawnId: accepted.respawnId,
        position: { x: 50, y: loweredY, z: -22 }
      }, Date.now(), true)?.position.y).toBeCloseTo(loweredY);
      room.structuralHealth.delete("structure-1-pillar-1");
      expect(bot.hasState).toBe(false);
      const valid = room.updatePlayerState(bot, { ...state, lifeSequence: 3, respawnId: accepted.respawnId }, Date.now(), true);
      expect(valid).toMatchObject({ id: bot.id, lifeSequence: 3, respawnId: accepted.respawnId });
      expect(bot.awaitingRespawnState).toBe(false);
      expect(bot.position).toEqual(state.position);
      await room.persistBots();
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      const restored = room.bots.get("bot-1");
      expect(restored).toMatchObject({
        alive: true, deaths: 3, respawnId: accepted.respawnId,
        respawnSpawnIndex: accepted.respawnSpawnIndex, awaitingRespawnState: false
      });
      expect(restored.position.x).toBe(ARENA_SPAWN_POINTS[accepted.respawnSpawnIndex].x);
    });
  });

  it("keeps legacy respawns compatible while persisting capable human resume lifecycle", async () => {
    const legacyStub = env.MATCH_ROOMS.getByName("RESPAWN-LEGACY");
    await runInDurableObject(legacyStub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "RESPAWN-LEGACY", seed: "LEGACY", mode: "private", phase: "playing", configuredBotCount: 1, targetSize: 1, ended: false };
      await room.reconcileBots();
      const bot = room.bots.get("bot-1");
      Object.assign(bot, { alive: false, health: 0, deaths: 1, respawnAt: Date.now() - 1, respawnId: "", respawnSpawnIndex: -1 });
      room.botHostId = () => "legacy-host";
      const sent = [];
      const socket = { deserializeAttachment: () => ({ id: "legacy-host", lifeStateCapable: false }), send: (value) => sent.push(JSON.parse(value)), close: () => {} };
      room.broadcast = (message) => sent.push(structuredClone(message));
      await room.handleRespawn(socket, { playerId: bot.id });
      expect(sent.at(-1).type).toBe("respawn");
      expect(bot.awaitingRespawnState).toBe(false);
      expect(room.updatePlayerState(bot, {
        position: { x: 31, y: 2, z: -14 }, velocity: { x: 0, y: 0, z: 0 },
        aim: { x: 0, y: 0, z: 1 }, slotIndex: 0, grounded: true
      }, Date.now(), false)?.position).toEqual({ x: 31, y: 2, z: -14 });
    });

    const resumeStub = env.MATCH_ROOMS.getByName("RESPAWN-HUMAN-RESUME");
    const token = "12121212-1212-4212-8212-121212121212";
    let respawnId;
    await runInDurableObject(resumeStub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "RESPAWN-HUMAN-RESUME", phase: "playing", ended: false };
      const player = {
        id: "human-respawn", bot: false, alive: false, health: 0, score: 5, deaths: 2,
        respawnAt: Date.now() - 1, loadout: [...DEFAULT_LOADOUT],
        ammo: {}, reloadEndsAt: {}, position: { x: 3, y: 2, z: 1 }, hasState: true
      };
      room.resumeSessions.set(token, { player: structuredClone(player), expiresAt: Date.now() + 45_000 });
      const attachment = { ...player, lifeStateCapable: true };
      const playerSocket = { serializeAttachment: (value) => Object.assign(attachment, structuredClone(value)) };
      const requester = { deserializeAttachment: () => attachment, send: () => {}, close: () => {} };
      room.authorizedActor = () => ({ player, socket: playerSocket });
      room.allPlayers = () => [player];
      room.broadcast = () => {};
      await room.handleRespawn(requester, { playerId: player.id, lifeSequence: 2 });
      respawnId = player.respawnId;
      expect(attachment.respawnId).toBe(respawnId);
      expect(room.resumeSessions.get(token)?.player).toMatchObject({
        alive: true, deaths: 2, respawnId, respawnSpawnIndex: player.respawnSpawnIndex, awaitingRespawnState: true
      });
    });
    await evictDurableObject(resumeStub);
    await runInDurableObject(resumeStub, async (room) => {
      await room.ready;
      expect(room.resumeSessions.get(token)?.player).toMatchObject({ alive: true, deaths: 2, respawnId, awaitingRespawnState: true });
    });
  });
});
