import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("MatchRoom durable authority", () => {
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
