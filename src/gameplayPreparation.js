import * as THREE from "three/webgpu";
import { materialOpacity } from "three/tsl";
import { Fighter } from "./player.js";
import { CombatVisuals, createProjectileVisual } from "./combatVisuals.js";
import { WEAPONS } from "./gameData.js";
import { fitArenaShadow } from "./lighting.js";
import { prepareSurfaceTextures } from "./surfaceTextures.js";
import { RESOURCE_VERSION, backgroundYield } from "./resourceVersion.js";
import { createHazardVisual } from "./hazardVisuals.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { createGrappleRopeGeometry, updateGrappleRopeGeometry } from "./grappleRope.js";
import { ArenaPreparation } from "./arenaPreparation.js";

const atmosphereKeys = ["background", "backgroundNode", "fog", "fogNode"];
const atmosphere = scene => Object.fromEntries(atmosphereKeys.map(key => [key, scene[key]]));

export function gameplayPreparationKey(game, seed, version = RESOURCE_VERSION) {
  return JSON.stringify([version, seed, game.graphics, game.settings.graphicsEffects,
    game.settings.reducedMotion, game.settings.motionBlur, game.renderSize, game.renderer.samples,
    game.scene.environment?.uuid, game.scene.environment?.version]);
}

// Exercise the actual render graph, including empty particle/debris pools and
// off-camera geometry. Restore every temporary change before yielding to UI.
// Menu-owned resources may compile asynchronously, but their owner must await
// this task before disposal or handoff. Active-match warmup uses only renders.
export function warmGameplayScene(game, roots, valid = () => true, sceneAtmosphere = null, compileRoots = roots) {
  const pending = (game.graphicsWarmup || Promise.resolve()).catch(() => {}).then(() => renderWarmup(game, roots, valid, sceneAtmosphere, compileRoots));
  game.graphicsWarmup = pending;
  return pending;
}

async function renderWarmup(game, roots, valid, sceneAtmosphere, compileRoots) {
  game.preparingGraphics = true;
  try {
    for (const position of [[0, 110, 90], [0, 5, 14]]) {
      if (!valid()) return false;
      const camera = game.camera.clone(), savedAtmosphere = atmosphere(game.scene), saved = [];
      try {
        if (sceneAtmosphere) Object.assign(game.scene, sceneAtmosphere);
        for (const root of roots) root.traverse(object => {
          const entry = { object, visible: object.visible, culled: object.frustumCulled };
          saved.push(entry);
          object.visible = true;
          object.frustumCulled = false;
          if (object.isInstancedMesh && object.count === 0 && object.instanceMatrix.count) {
            entry.matrix = new THREE.Matrix4();
            object.getMatrixAt(0, entry.matrix);
            object.setMatrixAt(0, new THREE.Matrix4());
            object.instanceMatrix.needsUpdate = true;
            object.count = 1;
          }
        });
        game.camera.position.set(...position);
        game.camera.lookAt(0, 2, 0);
        game.scene.updateMatrixWorld(true);
        if (sceneAtmosphere && position[1] === 110) {
          await game.renderPipeline.prepareScene?.(compileRoots, valid);
          if (!valid()) return false;
        }
        game.renderPipeline.render();
      } finally {
        for (const { object, visible, culled, matrix } of saved) {
          object.visible = visible;
          object.frustumCulled = culled;
          if (matrix) {
            object.count = 0;
            object.setMatrixAt(0, matrix);
            object.instanceMatrix.needsUpdate = true;
          }
        }
        Object.assign(game.scene, savedAtmosphere);
        // A resize may update the projection while WebGL compiles. Restore only
        // the temporary viewpoint, preserving the latest viewport/projection.
        game.camera.position.copy(camera.position);
        game.camera.quaternion.copy(camera.quaternion);
        game.camera.updateMatrixWorld(true);
      }
      await game.renderer.backend.device?.queue.onSubmittedWorkDone();
      await backgroundYield();
    }
    return valid();
  } finally {
    game.renderPipeline.motionBlur?.reset();
    game.preparingGraphics = false;
  }
}

export async function prepareFighterWeapons(fighter, valid = () => true) {
  for (let index = 0; index < fighter.loadout.length; index++) {
    if (!valid()) return false;
    const slot = fighter.slotIndex;
    try {
      fighter.slotIndex = index;
      fighter.updateWeaponModel();
    } finally {
      // Restore before yielding: online updates must see the real equipped
      // weapon, and a later update's selection must never be overwritten.
      fighter.slotIndex = slot;
      fighter.updateWeaponModel();
    }
    await backgroundYield();
  }
  return valid();
}

// Inactive weapon models normally remain detached. Attach only for the render,
// then return them to their original ownership without destroying GPU resources.
export async function warmFighterWeapons(game, fighters, roots, valid, sceneAtmosphere, compileRoots = roots) {
  const models = fighters.flatMap(fighter => [...fighter.weaponModels.values()].map(model => model.group));
  for (const model of models) game.scene.add(model);
  try { return await warmGameplayScene(game, [...roots, ...models], valid, sceneAtmosphere, [...compileRoots, ...models]); }
  finally { for (const model of models) model.removeFromParent(); }
}

function disposeSamples(game, entry) {
  for (const fighter of entry.fighters) fighter.dispose();
  game.removeObject(entry.projectiles);
}

export function disposeGameplaySamples(game, entry) {
  if (entry) disposeSamples(game, entry);
}

export class GameplayPreparation {
  constructor(game) { this.game = game; this.requested = null; this.ready = null; this.pending = null; this.arena = new ArenaPreparation(game); }

  preload(seed) { if (!this.pending) this.arena.preload(seed); }

  request(seed) {
    this.requested = seed;
    if (!this.pending) {
      this.pending = this.run().finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  cancel() {
    this.requested = null;
    this.arena.cancel();
    if (!this.pending) this.discard();
  }

  discard() {
    if (!this.ready) return;
    const entry = this.ready;
    this.ready = null;
    const previous = atmosphere(this.game.scene);
    entry.world?.dispose();
    Object.assign(this.game.scene, previous);
    entry.visuals?.dispose();
    disposeSamples(this.game, entry);
  }

  take(seed) {
    const entry = this.ready;
    if (!entry?.complete || entry.key !== gameplayPreparationKey(this.game, seed)
      || entry.pipeline !== this.game.renderPipeline || entry.renderer !== this.game.renderer) return null;
    this.ready = null;
    this.requested = null;
    Object.assign(this.game.scene, entry.atmosphere);
    entry.world.group.visible = entry.visuals.group.visible = true;
    return entry;
  }

  async run() {
    const game = this.game;
    try {
      await game.prepareResources();
      while (this.requested !== null) {
        await game.graphicsWarmup?.catch(() => {});
        // Apply pending settings before deriving identity or touching the GPU.
        game.commitResize();
        if (this.requested === null) break;
        const seed = this.requested, key = gameplayPreparationKey(game, seed), pipeline = game.renderPipeline, renderer = game.renderer;
        if (this.ready?.complete && this.ready.key === key && this.ready.pipeline === pipeline && this.ready.renderer === renderer) return this.ready;
        this.discard();
        const valid = () => this.requested === seed && key === gameplayPreparationKey(game, seed)
          && pipeline === game.renderPipeline && renderer === game.renderer && !game.pendingGraphicsEffects && !game.pendingGraphics && !game.pendingResize;
        await prepareSurfaceTextures([seed]);
        await backgroundYield();
        if (!valid()) continue;
        const arena = await this.arena.promote(seed, valid);
        if (!arena || !valid()) { arena?.world.dispose(); continue; }
        const entry = this.ready = { key, pipeline, renderer, complete: false, fighters: [], projectiles: new THREE.Group(), ...arena };
        for (const property of atmosphereKeys) entry.world[`previous${property[0].toUpperCase()}${property.slice(1)}`] = game.scene[property];
        entry.world.scene = game.scene;
        game.scene.add(entry.world.group);
        entry.world.group.visible = false;
        entry.world.setGraphicsProfile(game.graphics, game.renderer.getMaxAnisotropy());
        entry.world.setGraphicsEffects(game.settings.graphicsEffects);
        fitArenaShadow(game.keyLight, entry.world);
        entry.visuals = new CombatVisuals(game.scene, { reducedMotion: game.settings.reducedMotion, quality: game.graphics.combatQuality });
        entry.visuals.setGraphicsProfile(game.graphics);
        entry.visuals.group.visible = false;
        entry.projectiles.visible = false;
        game.scene.add(entry.projectiles);
        const ropeGeometry = createGrappleRopeGeometry();
        updateGrappleRopeGeometry(ropeGeometry, [new THREE.Vector3(), new THREE.Vector3(0, 6, 0)]);
        entry.projectiles.add(new Line2(ropeGeometry, new THREE.Line2NodeMaterial({
          color: 0x52e9ff, linewidth: 2, transparent: true, opacity: .92, opacityNode: materialOpacity,
          depthWrite: false, toneMapped: false, alphaToCoverage: true
        })));
        const weapons = Object.keys(WEAPONS);
        for (let offset = 0; offset < weapons.length && valid(); offset += 5) {
          const loadout = weapons.slice(offset, offset + 5);
          const fighter = new Fighter(game.scene, { id: `warmup-${offset}`, name: "", color: 0x52e9ff, accent: 0xf53f71 }, loadout, new THREE.Vector3());
          entry.fighters.push(fighter);
          fighter.group.visible = false;
          await prepareFighterWeapons(fighter, valid);
          if (!valid()) break;
          for (const id of loadout) {
            const weapon = WEAPONS[id];
            if (weapon.type !== "melee") entry.projectiles.add(createProjectileVisual(weapon, fighter, weapon.radius || .11));
            if (weapon.hazard) entry.projectiles.add(createHazardVisual(weapon).mesh);
          }
          const roots = [entry.world.group, entry.visuals.group, entry.projectiles, fighter.group];
          await warmFighterWeapons(game, [fighter], roots, valid, entry.atmosphere,
            offset === 0 ? roots : [entry.projectiles, fighter.group]);
        }
        if (valid()) {
          entry.complete = true;
          performance.mark?.("blaster-gameplay-resources-ready");
          return entry;
        }
      }
      this.discard();
      return null;
    } catch (error) {
      this.discard();
      throw error;
    }
  }
}
