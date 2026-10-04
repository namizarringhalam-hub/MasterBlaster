import * as THREE from "three/webgpu";
import { ArenaWorld } from "./world.js";
import { prepareSurfaceTextures, surfaceTexturesReady } from "./surfaceTextures.js";
import { RESOURCE_VERSION, backgroundYield } from "./resourceVersion.js";

const atmosphereKeys = ["background", "backgroundNode", "fog", "fogNode"];
const now = () => performance.now();

// Optional CPU construction only. The live scene and GPU stay untouched until Start.
export class ArenaPreparation {
  constructor(game) {
    this.game = game;
    this.entry = null;
    this.generation = 0;
    this.quietUntil = now() + 350;
    this.interrupt = () => {
      this.quietUntil = now() + 350;
      this.stopScheduling();
      this.schedule();
    };
    if (typeof requestIdleCallback === "function") {
      for (const event of ["pointerdown", "pointermove", "wheel", "touchmove", "keydown", "input", "scroll"])
        globalThis.document?.addEventListener(event, this.interrupt, { capture: true, passive: true });
      globalThis.document?.addEventListener("visibilitychange", this.interrupt);
    }
  }

  key(seed) {
    // Geometry does not depend on viewport size or the selected graphics tier.
    return JSON.stringify([RESOURCE_VERSION, seed, this.game.scene.environment?.uuid, this.game.scene.environment?.version]);
  }

  preload(seed) {
    if (typeof requestIdleCallback !== "function") return;
    if (this.entry?.key === this.key(seed)) { this.schedule(); return; }
    this.cancel();
    this.entry = { seed, key: this.key(seed), world: null, cpuComplete: false, steps: 0, maxStepMs: 0, limited: false };
    this.quietUntil = now() + 350;
    this.schedule();
  }

  stopScheduling() {
    if (this.idle != null) globalThis.cancelIdleCallback?.(this.idle);
    clearTimeout(this.wake);
    this.idle = this.wake = null;
  }

  schedule() {
    const entry = this.entry;
    if (!entry || entry.cpuComplete || entry.limited || entry.texturesPending || this.idle != null || this.wake != null
      || globalThis.document?.hidden || !["menu", "lobby", "global"].includes(this.game.state)) return;
    const delay = this.quietUntil - now();
    if (delay > 0) { this.wake = setTimeout(() => { this.wake = null; this.schedule(); }, delay); return; }
    // No timeout or busy-browser fallback: optional work can wait indefinitely.
    const idle = requestIdleCallback(deadline => {
      if (this.entry !== entry || this.idle !== idle) return;
      this.idle = null;
      if (globalThis.document?.hidden || !["menu", "lobby", "global"].includes(this.game.state)
        || now() < this.quietUntil || deadline.didTimeout || deadline.timeRemaining() < 8
        || globalThis.navigator?.scheduling?.isInputPending?.({ includeContinuous: true })) { this.schedule(); return; }
      if (!surfaceTexturesReady(entry.seed)) {
        entry.texturesPending = true;
        prepareSurfaceTextures([entry.seed], () => {}, { background: true }).then(ready => {
          if (this.entry !== entry) return;
          entry.texturesPending = false;
          entry.limited = !ready;
          this.schedule();
        }).catch(() => { if (this.entry === entry) { entry.texturesPending = false; entry.limited = true; } });
        return;
      }
      const started = now();
      try {
        if (!entry.world) this.createWorld(entry);
        else { entry.cpuComplete = entry.world.advanceBuild(); entry.steps++; }
      } catch {
        // A speculative failure must never affect the menu or prevent foreground loading.
        entry.world?.dispose(); entry.world = null; entry.limited = true;
      }
      entry.maxStepMs = Math.max(entry.maxStepMs, now() - started);
      // Slow hardware finishes the remaining work under the loading screen.
      if (entry.maxStepMs > 8) entry.limited = true;
      this.schedule();
    });
    this.idle = idle;
  }

  createWorld(entry) {
    const scene = new THREE.Scene();
    scene.environment = this.game.scene.environment;
    entry.world = new ArenaWorld(scene, entry.seed, { deferBuild: true });
    entry.world.group.visible = false;
    entry.atmosphere = Object.fromEntries(atmosphereKeys.map(key => [key, scene[key]]));
  }

  async promote(seed, valid = () => true) {
    this.stopScheduling();
    let entry = this.entry;
    this.entry = null;
    if (entry?.key !== this.key(seed)) { entry?.world?.dispose(); entry = null; }
    entry ||= { seed, key: this.key(seed), world: null, cpuComplete: false, steps: 0, maxStepMs: 0, limited: false };
    const generation = this.generation;
    const current = () => generation === this.generation && valid();
    const interrupted = () => {
      // A new render size/tier invalidates GPU warmup, but the same CPU geometry can resume.
      if (generation === this.generation && entry.key === this.key(seed) && !this.entry) this.entry = entry;
      else entry.world?.dispose();
      return null;
    };
    try {
      await prepareSurfaceTextures([seed]);
      if (!current()) return interrupted();
      if (!entry.world) this.createWorld(entry);
      while (!entry.world.buildComplete && current()) {
        entry.world.advanceBuild(); entry.steps++;
        await backgroundYield();
      }
      if (!current()) return interrupted();
      return { world: entry.world, atmosphere: entry.atmosphere };
    } catch (error) { entry.world?.dispose(); throw error; }
  }

  cancel() {
    this.generation++;
    this.stopScheduling();
    this.entry?.world?.dispose();
    this.entry = null;
  }
}
