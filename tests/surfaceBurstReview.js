import * as THREE from "three/webgpu";
import { WEAPONS, seededRandom } from "../src/gameData.js";

// QA-only synthetic effect workload, not a firing/gameplay or visual-art test.
export async function withSurfaceBurstRuntime(game, capture) {
  const v = game.combatVisuals, pools = [v.flashes, v.tracers, v.rings, v.sparks, v.bloodDecals];
  if (!game.paused || !game.players[0] || game.projectiles.length || game.hazards.length || game.effects.length || game.decoys.length ||
      pools.some(pool => pool.some(s => s.life > 0)) || v.combatLights.some(l => l.userData.life > 0 || l.intensity > 1e-10))
    throw Error("Surface runtime review requires a paused, transient-free scene");
  const saved = { cursors: { ...v.cursors }, random: v.random, effectTime: v.effectTime, lightCursor: v.combatLightCursor };
  const backend = game.renderer.backend, createPipeline = backend.createRenderPipeline;
  const pipelineDescriptor = Object.getOwnPropertyDescriptor(backend, "createRenderPipeline");
  let pipelineBuilds = 0;
  const owner = game.players[0], point = owner.position.clone().add(new THREE.Vector3(0, 1, 3));
  const normal = owner.aim.clone().normalize().negate();
  const layers = [v.ringOuter, v.ringInner, v.surfaceFront, v.surfaceCore];
  const sample = phase => capture({ phase, workload: "synthetic-effect-only", get pipelineBuilds() { return pipelineBuilds; }, counts: layers.map(l => l.count),
    surfaceLives: v.rings.filter(s => s.life > 0 && s.surfaceBurst).length,
    legacyLives: v.rings.filter(s => s.life > 0 && !s.surfaceBurst).length });
  try {
    backend.createRenderPipeline = function(...args) { pipelineBuilds++; return createPipeline.apply(this, args); };
    v.random = seededRandom(0x73073); v.cursors.ring = 0;
    await sample("empty");
    v.impact(point, WEAPONS.blaster, owner, { normal }); v.update(1 / 60);
    await sample("first-surface");
    v.update(2); await sample("expired");
    v.impact(point, WEAPONS.blaster, owner, { normal }); v.update(1 / 60);
    await sample("repeat-surface");
    v.update(2); v.cursors.ring = 0;
    for (let i = 0; i < 112; i++) {
      v.impact(point, i % 2 ? WEAPONS.rocket_launcher : WEAPONS.blaster, owner, { normal, explosive: Boolean(i % 2) });
    }
    v.update(1 / 60); await sample("mixed-112");
    v.update(2); await sample("final-expired");
  } finally {
    if (pipelineDescriptor) Object.defineProperty(backend, "createRenderPipeline", pipelineDescriptor);
    else delete backend.createRenderPipeline;
    // As with the wall review, clean visible effects; expired slot payloads are
    // not bitwise restored and are overwritten by their next production reuse.
    for (const pool of pools) for (const slot of pool) slot.life = 0;
    for (const light of v.combatLights) { light.userData.life = 0; light.intensity = 0; }
    v.update(0); Object.assign(v.cursors, saved.cursors); v.random = saved.random;
    v.effectTime = saved.effectTime; v.combatLightCursor = saved.lightCursor;
  }
}
