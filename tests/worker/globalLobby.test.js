import { env } from "cloudflare:workers";
import { runInDurableObject, evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WEAPONS, DEFAULT_LOADOUT } from "../../src/gameData.js";
import { fillLoadoutSlots, sanitizeLoadoutSlots } from "../../src/multiplayerProtocol.js";

describe("public waiting rooms", () => {
  it("preserves slot positions and randomizes only valid empty slots without duplicates", () => {
    const input = ["rocket_launcher", null, "railgun", "constructor", "rocket_launcher"];
    expect(sanitizeLoadoutSlots(input, WEAPONS)).toEqual(["rocket_launcher", null, "railgun", null, null]);
    const filled = fillLoadoutSlots(input, WEAPONS, () => 0.5);
    expect(filled[0]).toBe("rocket_launcher"); expect(filled[2]).toBe("railgun");
    expect(new Set(filled).size).toBe(5);
    expect(fillLoadoutSlots(DEFAULT_LOADOUT, WEAPONS)).toEqual(DEFAULT_LOADOUT);
  });

  it("persists the countdown across eviction, guards host actions, and finalizes late selections", async () => {
    const stub = env.MATCH_ROOMS.getByName("GLOBAL-TEST");
    const expires = Date.now() + 60_000;
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "GLOBAL-TEST", mode: "global", phase: "countdown", humanCapacity: 4, configuredBotCount: 2, startedAt: expires, timeLimitMinutes: 3, ended: false };
      await room.ctx.storage.put("meta", room.meta);
      await room.ctx.storage.setAlarm(expires);
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      expect(room.meta.phase).toBe("countdown");
      expect(await room.ctx.storage.getAlarm()).toBe(expires);
      const socket = (id, joinedAt) => {
        let player = { id, joinedAt, name: id, loadout: [...DEFAULT_LOADOUT], pendingLoadout: ["rocket_launcher", null, "railgun", null, null] };
        return { deserializeAttachment: () => player, serializeAttachment: (value) => { player = value; } };
      };
      const host = socket("host", 1), guest = socket("guest", 2);
      room.humanEntries = () => [[host, host.deserializeAttachment()], [guest, guest.deserializeAttachment()]];
      const broadcasts = [];
      room.broadcast = (message) => broadcasts.push(message);
      room.publishGlobalRoom = async () => {};
      await room.handleGlobalLobbyMessage(guest, { type: "lobby_cancel" });
      expect(room.meta.phase).toBe("countdown");
      await room.handleGlobalLobbyMessage(host, { type: "lobby_cancel" });
      expect(room.meta.phase).toBe("lobby");
      expect(await room.ctx.storage.getAlarm()).toBe(null);
      await room.handleGlobalLobbyMessage(guest, { type: "lobby_settings", botCount: 12 });
      expect(room.meta.configuredBotCount).toBe(2);
      await room.handleGlobalLobbyMessage(host, { type: "lobby_settings", botCount: 100 });
      expect(room.meta.configuredBotCount).toBe(12);
      await room.handleLobbyStart(guest);
      expect(room.meta.phase).toBe("lobby");
      await room.handleLobbyStart(host);
      expect(room.meta.phase).toBe("countdown");
      expect(room.meta.startedAt - Date.now()).toBeGreaterThan(4500);
      await room.alarm();
      expect(room.meta.phase).toBe("countdown");
      await room.handleGlobalLobbyMessage(guest, { type: "lobby_loadout", loadout: [null, "shotgun", null, null, "mine"] });
      room.meta.startedAt = Date.now() - 1;
      await room.alarm();
      expect(room.meta.phase).toBe("playing");
      expect(host.deserializeAttachment().loadout[0]).toBe("rocket_launcher");
      expect(host.deserializeAttachment().loadout[2]).toBe("railgun");
      expect(guest.deserializeAttachment().loadout[1]).toBe("shotgun");
      expect(guest.deserializeAttachment().loadout[4]).toBe("mine");
      expect(broadcasts.at(-1).type).toBe("match_start");
      const locked = [...guest.deserializeAttachment().loadout];
      await room.handleGlobalLobbyMessage(guest, { type: "lobby_loadout", loadout: [] });
      expect(guest.deserializeAttachment().loadout).toEqual(locked);
      await room.ctx.storage.deleteAlarm();
    });
  });

  it("cancels a countdown instead of launching with too few humans", async () => {
    const stub = env.MATCH_ROOMS.getByName("GLOBAL-SOLO");
    await runInDurableObject(stub, async (room) => {
      await room.ready;
      room.meta = { roomCode: "GLOBAL-SOLO", mode: "global", phase: "countdown", startedAt: Date.now() - 1 };
      room.humanEntries = () => [];
      room.broadcast = () => {};
      room.publishGlobalRoom = async () => {};
      await room.alarm();
      expect(room.meta.phase).toBe("lobby");
      expect(room.meta.startedAt).toBe(0);
      expect(await room.ctx.storage.getAlarm()).toBe(null);
    });
  });
});
