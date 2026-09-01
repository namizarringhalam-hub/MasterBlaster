import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { structuralPartBounds } from "../../src/gameData.js";

describe("MatchRoom durable authority", () => {
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
});
