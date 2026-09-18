import assert from "node:assert/strict";
import "./wallImpactReview.test.mjs";
import "./structuralDustReview.test.mjs";
import "./structuralPools.test.mjs";
import "./projectileContact.test.mjs";
import "./blasterRing.test.mjs";
import "./blasterSpark.test.mjs";
import "./blasterSurface.test.mjs";
import * as THREE from "three/webgpu";
import { getCurrentStack, getNormalFromDepth, materialOpacity, normalView, normalViewGeometry, positionViewDirection, setCurrentStack, stack, time as shaderTime, uniform, vec2, vec4 } from "three/tsl";
import NodeMaterialObserver from "../node_modules/three/src/materials/nodes/manager/NodeMaterialObserver.js";
import WebGPUPipelineUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js";
import { ArenaWorld, structuralPanelGeometry, structuralRouteGeometry } from "../src/world.js";
import { Fighter } from "../src/player.js";
import { createMechaRig } from "../src/mecha.js";
import "./mecha.test.mjs";
import { graphicsProfile, swapStolenWeapon, WEAPONS } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import { NeonRenderPipeline, recoverInvalidAONormals } from "../src/renderPipeline.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { surfaceTextures, surfaceMaps, projectSurfaceUVs } from "../src/surfaceTextures.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { weaponUsesAmmo } from "../src/gameData.js";
import { weaponPresentation } from "../src/weaponPresentation.js";

const playerMergeSource = readFileSync(new URL("../src/player.js", import.meta.url), "utf8");

{
  const effects = new CombatVisuals(new THREE.Scene());
  for (const weapon of Object.values(WEAPONS)) {
    const mesh = effects.createProjectile({ accent: 0x6ff6ff }, weapon, .11);
    for (const trail of mesh.userData.combatVisual?.trailParts || []) {
      assert.equal(trail.material.vertexColors, weapon.id === "blaster", `${weapon.id} trail shading isolation`);
      assert.equal(!!trail.geometry.getAttribute("color"), weapon.id === "blaster", `${weapon.id} shared geometry isolation`);
      assert.ok(Math.abs(trail.rotation.x - (weapon.id === "blaster" ? -Math.PI / 2 : Math.PI / 2)) < 1e-12,
        `${weapon.id} trail orientation: only Blaster should taper toward the rear`);
    }
    effects.removeProjectile({ mesh }); mesh.traverse(child => child.material?.dispose());
  }
  effects.dispose();
}
{
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  const removeSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const removeObject = new Function(`return function(object) {${removeSource.split("  removeObject(object) {")[1].split("\n  }\n}")[0]}}`)();
  let geometry, colorAttribute, geometryDisposals = 0;
  const materials = new Set();
  for (let i = 0; i < 32; i++) {
    const mesh = effects.createProjectile({ accent: i % 2 ? 0xff3377 : 0x6ff6ff }, WEAPONS.blaster, .11);
    scene.add(mesh);
    const trails = mesh.userData.combatVisual.trailParts;
    assert.equal(trails.length, 1);
    const trail = trails[0], uv = trail.geometry.getAttribute("uv"), colors = trail.geometry.getAttribute("color");
    if (!geometry) {
      geometry = trail.geometry; colorAttribute = colors;
      geometry.addEventListener("dispose", () => geometryDisposals++);
      const p = geometry.parameters, original = new THREE.ConeGeometry(p.radius, p.height, p.radialSegments, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
      for (const name of ["position", "normal", "uv"]) assert.deepEqual(geometry.getAttribute(name).array, original.getAttribute(name).array);
      assert.deepEqual(geometry.index.array, original.index.array); original.dispose();
    }
    assert.equal(trail.geometry, geometry); assert.equal(colors, colorAttribute);
    assert.equal(colors.array.byteLength, 168);
    for (let v = 0; v < uv.count; v++) for (const channel of ["getX", "getY", "getZ"]) assert.equal(colors[channel](v), 1 - uv.getY(v));
    assert.equal(materials.has(trail.material), false); materials.add(trail.material);
    assert.ok(trail.material.color.equals(new THREE.Color(i % 2 ? 0xff3377 : 0x6ff6ff).multiplyScalar(2.2)));
    let materialDisposals = 0; trail.material.addEventListener("dispose", () => materialDisposals++);
    removeObject.call({ scene }, mesh);
    assert.equal(materialDisposals, 1); assert.equal(geometryDisposals, 0);
    assert.equal(mesh.parent, null);
  }
  effects.dispose();
}
{
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  const hero = new Fighter(scene, { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3(8, 15, 8));
  effects.muzzle(hero, hero.weapon);
  const flash = effects.flashes[0], tracer = effects.tracers[0], light = effects.combatLights[0];
  const origin = flash.position.clone(), end = tracer.end.clone(), lamp = light.position.clone(), direction = flash.direction.clone();
  hero.weaponGroup.position.z -= .2;
  const delta = hero.visualMuzzlePoint().sub(origin);
  effects.update(1 / 60);
  assert.ok(flash.position.distanceTo(origin.clone().add(delta)) < 1e-12, "live Blaster flash must follow its animated aperture");
  assert.ok(tracer.end.distanceTo(end.clone().add(delta)) < 1e-12);
  assert.ok(light.position.distanceTo(lamp.clone().add(delta)) < 1e-12);
  assert.ok(flash.direction.equals(direction));
  const held = flash.position.clone();
  hero.switchSlot(1); hero.switchSlot(0); hero.weaponGroup.position.z += 3;
  effects.update(1 / 60);
  assert.ok(flash.position.equals(held), "cached switch-away/back must detach the previous event without killing its fade");
  assert.ok(flash.life > 0);
  hero.dispose(); effects.dispose();
}
for (const action of ["death", "respawn", "dispose", "model", "expiry", "reuse", "quality", "effects-dispose"]) {
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  const hero = new Fighter(scene, { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3());
  effects.muzzle(hero, hero.weapon);
  const flash = effects.flashes[0], tracer = effects.tracers[0], light = effects.combatLights[0];
  const held = flash.position.clone(), originalLife = flash.life;
  if (action === "death") hero.takeHit(100);
  if (action === "respawn") hero.respawn(new THREE.Vector3(100, 0, 0));
  if (action === "dispose") hero.dispose();
  if (action === "model") hero.updateWeaponModel();
  if (action === "quality") effects.setGraphicsProfile({ combatQuality: "low", combatLights: 0 });
  if (action === "effects-dispose") effects.dispose();
  if (action === "reuse") {
    effects.cursors.tracer = 0; effects.combatLightCursor = 0;
    effects.addTracer(new THREE.Vector3(2, 3, 4), new THREE.Vector3(5, 6, 7), hero.weapon, hero, .2, .1);
    effects.pulseLight(new THREE.Vector3(9, 8, 7), new THREE.Color(), 4, 10, .2);
    assert.equal(tracer.muzzleOwner, null); assert.equal(light.muzzleOwner, null);
  }
  hero.weaponGroup.position.x += 2;
  if (action !== "effects-dispose") effects.update(action === "expiry" ? .11 : 0);
  if (["death", "respawn", "dispose", "model", "expiry", "effects-dispose"].includes(action)) {
    assert.equal(flash.muzzleOwner, null); assert.equal(tracer.muzzleOwner, null); assert.equal(light.muzzleOwner, null);
    assert.ok(flash.position.equals(held));
    if (action !== "expiry") assert.equal(flash.life, originalLife, "detachment preserves the existing fade");
  }
  if (action === "expiry") assert.ok(light.intensity > 0, "detach the pulse without deleting its damped tail");
  if (action === "quality") assert.equal(light.muzzleOwner, null);
  if (action === "reuse") { assert.deepEqual(tracer.start.toArray(), [2, 3, 4]); assert.deepEqual(light.position.toArray(), [9, 8, 7]); }
  if (action !== "dispose") hero.dispose();
  if (action !== "effects-dispose") effects.dispose();
}
for (const tier of ["low", "medium", "high"]) {
  const scene = new THREE.Scene(), effects = new CombatVisuals(scene);
  effects.setGraphicsProfile(graphicsProfile(tier));
  const fighters = Array.from({ length: 16 }, (_, i) => new Fighter(scene, { id: `p${i}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3(i, 0, 0)));
  for (let round = 0; round < 12; round++) {
    for (const hero of fighters) {
      hero.switchSlot(round % 2); effects.muzzle(hero, hero.weapon);
      effects.impact(new THREE.Vector3(50, 0, 0), hero.weapon, hero);
    }
    for (const hero of fighters) hero.weaponGroup.position.z -= .1;
    effects.update(1 / 60);
    for (const flash of effects.flashes) if (flash.muzzleOwner) assert.ok(flash.position.distanceTo(flash.muzzleOwner.visualMuzzlePoint()) < 1e-12);
    for (const light of effects.combatLights) if (!light.muzzleOwner && light.intensity > 0) assert.ok(Number.isFinite(light.position.x));
  }
  effects.setGraphicsProfile(graphicsProfile("low"));
  for (const light of effects.combatLights.slice(1)) assert.equal(light.muzzleOwner, null);
  effects.setGraphicsProfile(graphicsProfile("high"));
  for (const light of effects.combatLights.slice(1)) assert.equal(light.muzzleOwner, null);
  for (const hero of fighters) hero.dispose();
  effects.update(0);
  for (const pool of [effects.flashes, effects.tracers, effects.combatLights]) assert.ok(pool.every(slot => !slot.muzzleOwner));
  effects.dispose();
}
for (const reducedMotion of [false, true]) {
  const scene = new THREE.Scene(), current = new CombatVisuals(scene, { reducedMotion }), previous = new CombatVisuals(new THREE.Scene(), { reducedMotion });
  previous.bindMuzzle = () => {};
  const hero = new Fighter(scene, { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  current.muzzle(hero, hero.weapon); previous.muzzle(hero, hero.weapon);
  const timeline = effects => ({ flash: effects.flashes.map(slot => slot.life), tracer: effects.tracers.map(slot => slot.life),
    lights: effects.combatLights.map(light => [light.userData.life, light.intensity]), counts: [effects.flashOuter.count, effects.flashInner.count, effects.tracerOuter.count, effects.tracerInner.count] });
  const direction = current.flashes[0].direction.clone(), segment = current.tracers[0].end.clone().sub(current.tracers[0].start);
  for (let frame = 0; frame < 60; frame++) {
    hero.weaponGroup.position.z -= .005;
    current.update(1 / 60); previous.update(1 / 60);
    assert.deepEqual(timeline(current), timeline(previous));
    assert.ok(current.flashes[0].direction.equals(direction));
    assert.ok(current.tracers[0].end.clone().sub(current.tracers[0].start).distanceTo(segment) < 1e-12);
  }
  hero.dispose(); current.dispose(); previous.dispose();
}
{
  const target = new THREE.Vector3(), effects = new CombatVisuals(new THREE.Scene());
  for (const id of Object.keys(WEAPONS)) {
    const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, [id], new THREE.Vector3(8, 15, 8));
    assert.equal(typeof hero.visualMuzzlePoint, "function", "visual muzzle origin must be distinct from gameplay origin");
    for (const pitch of [0, Math.PI / 3, -Math.PI / 3]) {
      hero.rig.position.y = -.08; hero.rig.rotation.x = .13; hero.weaponGroup.rotation.x = pitch; hero.weaponGroup.position.z = .15;
      const logical = hero.muzzlePoint().toArray(), projectile = hero.forwardPoint(.08).toArray();
      assert.ok(hero.visualMuzzlePoint(target) === target);
      const expected = id === "blaster" ? new THREE.Vector3(.05, .06, .994).applyMatrix4(hero.weaponGroup.matrixWorld) : hero.muzzlePoint();
      assert.ok(target.distanceTo(expected) < 1e-12);
      assert.deepEqual(hero.muzzlePoint().toArray(), logical); assert.deepEqual(hero.forwardPoint(.08).toArray(), projectile);
    }
    if (id !== "blaster") {
      const index = effects.cursors.flash % effects.flashes.length;
      effects.muzzle(hero, hero.weapon);
      assert.equal(effects.flashes[index].muzzleOwner, null);
      assert.ok(effects.flashes[index].position.distanceTo(hero.muzzlePoint()) < 1e-12);
    }
    if (id === "blaster") {
      effects.muzzle(hero, hero.weapon); const flash = effects.flashes[0], tracer = effects.tracers[0], light = effects.combatLights[0];
      assert.ok(flash.position.distanceTo(hero.visualMuzzlePoint(target)) < 1e-12);
      assert.ok(tracer.start.distanceTo(flash.position) < 1e-12);
      assert.ok(light.position.distanceTo(flash.position.clone().addScaledVector(flash.direction, flash.length * .32)) < 1e-12);
      assert.equal(flash.life, .1); assert.equal(tracer.life, .085); assert.equal(light.userData.life, .085);
    }
    hero.dispose();
  }
  const cached = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster", "rocket_launcher"], new THREE.Vector3(8, 15, 8));
  const blasterModel = cached.weaponModels.get("blaster");
  cached.ammo.blaster = 2; cached.health = 73;
  for (const slot of [1, 0, 1, 0]) {
    cached.switchSlot(slot); assert.ok(cached.visualMuzzlePoint(target) === target);
    const expected = slot ? cached.muzzlePoint() : new THREE.Vector3(.05, .06, .994).applyMatrix4(cached.weaponGroup.matrixWorld);
    assert.ok(target.distanceTo(expected) < 1e-12); assert.ok(cached.weaponModels.get("blaster") === blasterModel);
    assert.equal(cached.weaponModels.size, 2); assert.equal(cached.ammo.blaster, 2); assert.equal(cached.health, 73);
  }
  cached.dispose();
  effects.dispose();
}
{
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(8, 15, 8));
  hero.grounded = true; hero.landTimer = .22; hero.landStrength = 1;
  const floor = { surfaceHeightAt: () => 15, resolve: position => { position.y = 15; return { grounded: true }; }, boostAt: () => null };
  for (let frame = 0; frame < 14; frame++) {
    hero.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, floor); hero.group.updateMatrixWorld(true);
    for (const leg of [hero.leftLeg, hero.rightLeg]) assert.ok(new THREE.Box3().setFromObject(leg, true).min.y >= 15,
      "hard-landing visual legs must not penetrate the physical floor");
  }
  hero.dispose();
}
// The advancing-clock hit pose caught a floor-crossing regression missed by a fixed clock.
{
  let clock = 1000, landingFrame = -1, checked = false;
  const plain = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "");
  const Type = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation", "createMechaRig", "surfaceMaps", "projectSurfaceUVs", "performance",
    `${plain}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation, createMechaRig, surfaceMaps, projectSurfaceUVs, { now: () => clock });
  const p = new Type(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15, 8));
  const still = new THREE.Vector3(), aim = new THREE.Vector3(0, 0, -1);
  const world = { resolve(position) { const grounded = position.y <= 15; if (grounded) position.y = 15; return { grounded }; }, boostAt: () => null };
  try {
    for (let step = 0; step < 60; step++) { clock = 1000 + step * 1000 / 60; p.update(1 / 60, still, aim, {}, world); }
    p.position.y += 8; p.grounded = false;
    for (let step = 60; step < 180; step++) {
      clock = 1000 + step * 1000 / 60;
      if (landingFrame === 6) p.hitTimer = .3;
      p.update(1 / 60, still, aim, {}, world); p.group.updateMatrixWorld(true);
      if (landingFrame < 0 && p.landTimer > 0) landingFrame = 0;
      if (landingFrame === 13) {
        checked = true;
        for (const leg of [p.leftLeg, p.rightLeg]) assert.ok(new THREE.Box3().setFromObject(leg, true).min.y >= 15,
          "advancing-clock hit frame 13 must not introduce the rejected pitch trial's floor crossing");
      }
      if (landingFrame >= 0) landingFrame++;
    }
    assert.ok(checked); assert.equal(p.landTimer, 0);
  } finally { p.dispose(); }
}
const mergeHelperSource = playerMergeSource.slice(playerMergeSource.indexOf("function mergeStaticParts("), playerMergeSource.indexOf("const armDown"));
const mergeCopies = [];
const mergeHelpers = new Function("THREE", "mergeGeometries", "disposeGeometry", `${mergeHelperSource}; return { mergeStaticParts, mergeRigidMeshes, combineMaterialBatches };`)(THREE,
  (geometries, groups) => {
    for (const geometry of geometries) {
      const copy = { geometry, disposals: 0 }; mergeCopies.push(copy);
      geometry.addEventListener("dispose", () => copy.disposals++);
    }
    return mergeGeometries(geometries, groups);
  }, geometry => { if (!geometry.userData.sharedFighterGeometry) geometry.dispose(); });
let proceduralCopies = 0;
class CountedMergeGeometry extends THREE.BufferGeometry {
  constructor() { super(); proceduralCopies++; }
}
for (const indexed of [true, false]) for (const name of Object.keys(mergeHelpers)) {
  const box = new THREE.BoxGeometry(1, 2, 3), flat = indexed ? box : box.toNonIndexed();
  const source = new CountedMergeGeometry().copy(flat);
  if (flat !== box) flat.dispose(); box.dispose();
  source.userData.sharedFighterGeometry = true;
  source.morphAttributes.position = [source.attributes.position.clone()]; source.morphTargetsRelative = true;
  source.computeBoundingBox(); source.computeBoundingSphere(); source.setDrawRange(0, 12);
  const sourceData = source.toJSON(), sourceBuffers = Object.values(source.attributes).map(attribute => attribute.array);
  let sourceDisposals = 0; source.addEventListener("dispose", () => sourceDisposals++);
  const beforeConstructors = proceduralCopies, beforeCopies = mergeCopies.length;
  const root = new THREE.Group();
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const meshes = materials.map((material, i) => { const mesh = new THREE.Mesh(source, name === "mergeRigidMeshes" ? materials[0] : material); mesh.position.set(i, 2, 3); mesh.updateMatrix(); root.add(mesh); return mesh; });
  const output = name === "mergeStaticParts" ? mergeHelpers[name](materials[0], meshes) : (mergeHelpers[name](root), root);
  assert.equal(proceduralCopies, beforeConstructors, `${name} must not invoke a source subclass constructor (${indexed ? "indexed" : "flat"})`);
  assert.equal(sourceDisposals, 0, "shared source buffers remain owned by their cache");
  assert.deepEqual(source.toJSON(), sourceData, "transforms/copying cannot mutate source geometry data, morphs or bounds");
  assert.deepEqual(Object.values(source.attributes).map(attribute => attribute.array), sourceBuffers);
  assert.ok(mergeCopies.slice(beforeCopies).every(copy => copy.disposals === 1), "all transient merge inputs are disposed exactly once");
  output.traverse(object => { if (object.geometry && object.geometry !== source) object.geometry.dispose(); });
  source.dispose(); materials.forEach(material => material.dispose());
}
if (process.argv.includes("--bench-merge")) {
  const results = [];
  for (let batch = 0; batch < 6; batch++) {
    const variants = [["current", Fighter], ["legacy", LegacyMergeFighter]];
    if (batch % 2) variants.reverse();
    for (const [name, Type] of variants) {
      let constructionMs = 0, disposalMs = 0;
      for (const id of Object.keys(WEAPONS)) {
        const start = performance.now();
        const fighter = new Type(new THREE.Scene(), { id: "merge-bench", color: 0x129dba, accent: 0x6ff6ff }, [id], new THREE.Vector3());
        const built = performance.now(); fighter.dispose();
        constructionMs += built - start; disposalMs += performance.now() - built;
      }
      results.push({ batch, name, weapons: Object.keys(WEAPONS).length, constructionMs, disposalMs });
    }
  }
  console.log(JSON.stringify({ mergeBenchmark: results }));
}

// Execute the fixture's actual wait helper with a stopped animation clock.
const graphicsFixture = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
const humanGrappleSource = graphicsFixture.slice(graphicsFixture.indexOf('select("human-grapple").onclick = ') + 'select("human-grapple").onclick = '.length,
  graphicsFixture.indexOf('select("hold-ropes").onclick')).trim().replace(/;$/, "");
const startHumanMotion = new Function("game", "stress", "resetPhase", "resetSamples", `(${humanGrappleSource})(); return stress;`);
const humanEvents = [], humanGame = { paused: true, players: [{ grapple: {} }], sound: { resume: () => humanEvents.push("audio") },
  setTrainingBotOption: (...args) => humanEvents.push(args) };
for (const [stress, phase] of [[true, "ready"], [false, "starting"]]) assert.throws(() => startHumanMotion(humanGame, stress, phase, () => {}), /ready paused grapple/);
assert.equal(humanEvents.length, 0);
assert.equal(startHumanMotion(humanGame, false, "ready", () => humanEvents.push("samples")), true);
assert.equal(humanGame.paused, false);
assert.deepEqual(humanEvents, [["botsStandStill", true], ["botsDontAttack", true], "audio", "samples"]);
const holdRopeSource = graphicsFixture.slice(graphicsFixture.indexOf('select("hold-ropes").onclick = ') + 'select("hold-ropes").onclick = '.length,
  graphicsFixture.indexOf('select("thruster-dust").onclick')).trim().replace(/;$/, "");
for (const legacy of [false, true]) {
  const players = Array.from({ length: 16 }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(1, 2, 3), aim: new THREE.Vector3(), grapple: {} }));
  let releases = 0, creates = 0;
  const game = { paused: true, players, releaseGrapple(player) { releases++; player.grapple = null; },
    toggleGrapple(player) { creates++; player.grapple = { line: { material: { opacityNode: materialOpacity } } }; } };
  const runHeld = new Function("game", "stress", "resetPhase", "location", `return (${holdRopeSource})();`);
  const location = { search: legacy ? "?legacyRopeBindings" : "" };
  for (const [stress, phase, paused] of [[true, "ready", true], [false, "starting", true], [false, "ready", false]]) {
    game.paused = paused;
    assert.throws(() => runHeld(game, stress, phase, location), /ready paused/);
    assert.equal(releases + creates, 0, "guarded QA attempts cannot mutate gameplay");
  }
  game.paused = true; runHeld(game, false, "ready", location);
  assert.equal(releases, 16); assert.equal(creates, 15); assert.equal(players[0].grapple, null);
  assert.deepEqual(players[0].position.toArray(), [0, 0, 0]);
  for (const [i, player] of players.slice(1).entries()) {
    assert.deepEqual(player.position.toArray(), [-12, 18.6, -9 + i * 1.25]);
    assert.equal(player.velocity.lengthSq(), 0); assert.ok(Math.abs(player.aim.length() - 1) < 1e-12);
    assert.ok(player.grapple.line.material.opacityNode === (legacy ? null : materialOpacity));
  }
}
const textureTraceSource = graphicsFixture.slice(graphicsFixture.indexOf("function installResizeTextureTrace("), graphicsFixture.indexOf("const resizeTextureTrace ="));
const installTextureTrace = new Function(`${textureTraceSource}; return installResizeTextureTrace;`)();
const tracedDescriptors = [], traceEvents = [], textureTraceState = { serial: 0, dropped: 0, entries: [] };
const traceDevice = { createTexture(descriptor) {
  assert.equal(this, traceDevice); tracedDescriptors.push(descriptor);
  const result = { label: descriptor.label, destroy(...args) { assert.equal(this, result); traceEvents.push(args); return "destroyed"; } }; return result;
} };
const traceBackend = { device: traceDevice, createTexture(texture, options) {
  assert.equal(this, traceBackend);
  if (options.fail) throw Error("trace failure");
  if (options.nested) this.createTexture({}, { descriptor: options.descriptor });
  return this.device.createTexture(options.descriptor);
} };
installTextureTrace({ backend: traceBackend, info: { calls: 42 } }, textureTraceState);
const tracedOwner = { id: 123, name: "output", version: 7, renderTarget: { width: 10, height: 20, isPostProcessingRenderTarget: true } };
const sourceDescriptor = { label: "original", format: "rgba16float", size: { width: 10, height: 20 }, sampleCount: 4, usage: 16 };
const tracedTexture = traceBackend.createTexture(tracedOwner, { descriptor: sourceDescriptor, nested: true });
assert.equal(tracedDescriptors[0], sourceDescriptor, "non-target texture descriptors stay untouched even inside nested creation");
assert.deepEqual(tracedDescriptors[1], { ...sourceDescriptor, label: "resize-texture-1 original" });
assert.equal(sourceDescriptor.label, "original");
assert.deepEqual(textureTraceState.entries[0].owner, { textureId: 123, version: 7, name: "output", width: 10, height: 20, outputConversion: true });
assert.notEqual(textureTraceState.entries[0].size, sourceDescriptor.size);
assert.equal(tracedTexture.destroy("argument"), "destroyed");
assert.deepEqual(traceEvents, [["argument"]]);
assert.equal(textureTraceState.entries[0].destroyed.calls, 42);
assert.equal(textureTraceState.entries[0].actualLabel, "resize-texture-1 original");
assert.equal(textureTraceState.entries[0].destroyed.label, "resize-texture-1 original");
assert.throws(() => traceBackend.createTexture(tracedOwner, { fail: true }), /trace failure/);
traceDevice.createTexture(sourceDescriptor);
assert.equal(tracedDescriptors.at(-1), sourceDescriptor, "a thrown backend call always restores the previous trace owner");
for (let i = 0; i < 100; i++) traceBackend.createTexture(tracedOwner, { descriptor: sourceDescriptor });
assert.equal(textureTraceState.serial, 101); assert.equal(textureTraceState.entries.length, 96); assert.equal(textureTraceState.dropped, 5);
assert.equal(textureTraceState.entries.at(-1).label, "resize-texture-101");
const resetCaptureSource = graphicsFixture.slice(graphicsFixture.indexOf('  resetPhase = "starting";'), graphicsFixture.indexOf('  clearThrusterSortControl();', graphicsFixture.indexOf("async function reset()")));
const staleLink = { hidden: false, href: "old-frame", removeAttribute(name) { delete this[name]; } };
const clearedCapture = new Function("select", `let resetPhase='ready', captureCanvas=true, canvasCapture={old:true}; ${resetCaptureSource}; return {resetPhase,captureCanvas,canvasCapture};`)(() => staleLink);
assert.deepEqual(clearedCapture, { resetPhase: "starting", captureCanvas: false, canvasCapture: null });
assert.equal(staleLink.hidden, true); assert.equal(staleLink.href, undefined);
const requestCaptureSource = graphicsFixture.match(/select\("capture-canvas"\)\.onclick = ([^\n]+);/)[1];
for (const phase of ["starting", "started", "ready"]) {
  let checked = false;
  const requested = new Function("resetPhase", "validateExhaustView", `let captureCanvas=false; (${requestCaptureSource})(); return captureCanvas;`)(phase, () => { checked = true; });
  assert.equal(checked, true);
  assert.equal(requested, phase === "ready");
  assert.throws(() => new Function("resetPhase", "validateExhaustView", `let captureCanvas=false; (${requestCaptureSource})();`)(phase, () => { throw Error("unsupported view"); }), /unsupported view/);
}
let deferredReset, resetCalls = 0;
const costumeChangeSource = graphicsFixture.match(/select\("costume"\)\.onchange = ([^\n]+);/)[1];
new Function("setTimeout", "reset", `(${costumeChangeSource})();`)((fn, delay) => { assert.equal(delay, 0); deferredReset = fn; }, () => resetCalls++);
assert.equal(resetCalls, 0); deferredReset(); assert.equal(resetCalls, 1);
assert.ok(graphicsFixture.includes('if (captureCanvas && resetPhase === "ready")'));
assert.ok(graphicsFixture.includes("function replaceReviewCostume("), "helmet review uses all four actual Fighter variants");
const reviewCostumeSource = graphicsFixture.slice(graphicsFixture.indexOf("function replaceReviewCostume("), graphicsFixture.indexOf("function setView("));
for (const variant of ["", "0", "1", "2", "3"]) {
  const scene = new THREE.Scene();
  const original = new Fighter(scene, { id: "p1", name: "Review", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(2, 3, 4));
  const originalLoadout = original.loadout, neighbor = { id: "untouched" };
  let disposed = 0;
  const dispose = original.dispose.bind(original);
  original.dispose = () => { disposed++; dispose(); };
  const reviewGame = { scene, players: [original, neighbor] };
  new Function("game", "select", "Fighter", `${reviewCostumeSource}; replaceReviewCostume();`)(reviewGame, () => ({ value: variant }), Fighter);
  const selected = reviewGame.players[0];
  assert.equal(reviewGame.players.length, 2); assert.ok(reviewGame.players[1] === neighbor);
  assert.equal(disposed, variant === "" ? 0 : 1);
  assert.equal(scene.children.length, 1);
  assert.deepEqual(selected.position.toArray(), [2, 3, 4]);
  assert.equal(selected.color, original.color); assert.equal(selected.accent, original.accent); assert.equal(selected.name, "Review");
  assert.deepEqual(selected.loadout, originalLoadout);
  if (variant === "") assert.ok(selected === original);
  else {
    assert.equal([...selected.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4, Number(variant));
    assert.ok(selected.loadout !== originalLoadout); assert.equal(original.group.parent, null);
    assert.equal(original.weaponModels.size, 0);
  }
  selected.dispose(); assert.equal(scene.children.length, 0);
}
const settleReviewSource = graphicsFixture.slice(graphicsFixture.indexOf("const stillMove"), graphicsFixture.indexOf("function replaceReviewCostume("));
for (const active of [true, false]) {
  const hero = new Fighter(new THREE.Scene(), { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const pad = { position: new THREE.Vector3(0, 0, 0), strength: 24, active };
  const world = { boostPads: [pad], resolve: position => {
    const grounded = position.y <= 0; if (grounded) position.y = 0; return { grounded };
  }, boostAt: () => active ? pad : null };
  const geometry = hero.thrusterLights.geometry, material = hero.thrusterMaterial;
  const run = () => new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "view" ? "thrusters" : ["aim-height", "boost-pad"].includes(name) ? "0" : "boost" }));
  if (active) {
    const review = run();
    assert.equal(review.boost.sampledFrames, 30); assert.equal(review.boost.launched, true);
    assert.equal(hero.grounded, false); assert.ok(hero.position.y > 5 && hero.velocity.y > 0);
    assert.deepEqual(review.boost.position, hero.position.toArray());
    assert.equal(review.boost.scale, hero.thrusterScale); assert.equal(review.boost.opacity, material.opacity);
    assert.ok(hero.thrusterScale > 1.19 && hero.thrusterScale < 1.21);
  } else assert.throws(run, /active pad/);
  assert.equal(hero.thrusterLights.geometry, geometry); assert.equal(hero.thrusterMaterial, material);
  hero.dispose();
}
for (const view of ["fighter", "helmet-profile", "weapon", "hand-front", "lower-body-front", "arena"]) {
  let touched = false;
  assert.throws(() => new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
    { clearTransientNetworkCombat() { touched = true; } }, name => ({ value: name === "view" ? view : "boost" })), /requires a thruster or player-camera view/);
  assert.equal(touched, false, "unsupported boost framing fails before touching the scene");
}
for (const view of ["hand-front", "hand-side", "hand-opposite", "hand-palm", "player-camera"]) assert.ok(graphicsFixture.includes(`<option>${view}</option>`), `missing actual ${view} review view`);
for (const weaponId of ["blaster", "rocket_launcher", "energy_sword"]) for (const pose of ["aim", "reload", "reacquire-early", "reacquire-complete"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "hand-qa", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  const world = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
  const review = new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose }));
  assert.equal(review.requested, pose);
  if (pose !== "aim") assert.equal(review.reloadAccepted, weaponUsesAmmo(hero.weapon));
  if (weaponUsesAmmo(hero.weapon) && pose === "reload") {
    assert.ok(hero.reloadTimer > 0); assert.equal(hero.supportGripProgress, 0);
  } else if (weaponUsesAmmo(hero.weapon) && pose.startsWith("reacquire")) {
    assert.equal(hero.reloadTimer, 0); assert.equal(hero.reloadWeaponId, null); assert.equal(hero.ammo[weaponId], hero.weapon.ammo);
    if (pose === "reacquire-early") assert.ok(hero.supportGripProgress > 0 && hero.supportGripProgress < 1);
    else assert.equal(hero.supportGripProgress, 1);
  }
  if (pose === "aim" || pose === "reacquire-complete") {
    const grip = hero.weaponGrip.clone().applyMatrix4(hero.weaponGroup.matrixWorld);
    const hand = hero.rightHand.position.clone().applyMatrix4(hero.rightForearm.matrixWorld);
    assert.ok(hand.distanceTo(grip) < .03, "review uses the existing grip solve, not a synthetic hand pose");
  }
  hero.dispose();
}
for (const height of [0, Math.sqrt(3), -Math.sqrt(3)]) {
  const aims = [], hero = { velocity: new THREE.Vector3(2, 3, 4), group: { updateMatrixWorld() {} },
    update(dt, move, aim) { assert.equal(dt, 1 / 60); assert.equal(move.length(), 0); aims.push(aim.clone()); } };
  let clears = 0;
  new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
    { players: [hero], world: {}, clearTransientNetworkCombat() { clears++; } }, name => ({ value: name === "aim-height" ? String(height) : "aim" }));
  assert.equal(clears, 1); assert.equal(aims.length, 60); assert.equal(hero.velocity.length(), 0);
  assert.ok(aims.every(aim => Math.abs(aim.length() - 1) < 1e-12 && Math.abs(aim.y - height / Math.hypot(height, 1)) < 1e-12 && aim.z < 0));
}
// Execute the exact capture block: later frame counters must not alter evidence.
for (const pose of ["gait-positive", "gait-negative", "landing"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15.01, 8));
  const world = { resolve: position => { const grounded = position.y <= 15.01; if (grounded) position.y = 15.01; return { grounded }; }, boostAt: () => null };
  const poseState = new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose }));
  const sample = poseState.locomotion;
  assert.ok(sample.sampledFrames > 0 && sample.sampledFrames <= 180); assert.equal(sample.grounded, true);
  assert.ok(sample.maxHorizontalCorrection < 1e-12);
  assert.deepEqual(sample.position, hero.position.toArray()); assert.deepEqual(sample.velocity, hero.velocity.toArray());
  if (pose === "landing") {
    assert.ok(sample.landTimer > 0 && sample.landTimer <= .12); assert.ok(sample.landStrength > 0);
  } else {
    assert.ok(sample.sampledFrames > 60); assert.ok(sample.velocity[2] < -8.9);
    // Foot-driven IK has a bent neutral hip; capture its extrema without
    // assuming that neutral is the old straight-leg sine wave's zero angle.
    if (pose === "gait-positive") assert.ok(sample.previousDelta > 0 && sample.delta <= 0);
    else assert.ok(sample.previousDelta < 0 && sample.delta >= 0);
    const resolve = world.resolve;
    world.resolve = position => { position.z = Math.max(position.z, 7.9); return resolve(position); };
    assert.throws(() => new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
      { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose })), /route obstructed/);
  }
  hero.dispose();
}
const handViewSource = graphicsFixture.slice(graphicsFixture.indexOf("function setView()"), graphicsFixture.indexOf("async function reset()"));
const landingDropSource = graphicsFixture.slice(graphicsFixture.indexOf("async function withPreviousLandingDrop("), graphicsFixture.indexOf("async function runLandingReview("));
const removeLandingDrop = new Function(`${landingDropSource}; return withPreviousLandingDrop;`)();
const translateMuzzle = new Function(`${landingDropSource}; return withTranslatedMuzzle;`)();
const reverseTrail = new Function(`${landingDropSource}; return withReversedTrail;`)();
const makeTrailShading = new Function("THREE", `${landingDropSource}; return makeTrailShading;`)(THREE);
const shadeTrail = new Function(`${landingDropSource}; return withTrailShading;`)();
const landingReference = new Function(`${landingDropSource}; return landingReference;`)();
const plantLanding = new Function("THREE", `${landingDropSource}; return withLandingContact;`)(THREE);
{
  const start = graphicsFixture.indexOf("    grapple: game.players[0]?.grapple ?");
  const end = graphicsFixture.indexOf("    aoGeometryApplied:", start);
  const readGrapple = new Function("game", `return ({${graphicsFixture.slice(start, end)}}).grapple;`);
  const pose = { anchor: new THREE.Vector3(4, 40, 0) };
  assert.deepEqual(readGrapple({ players: [{ grapple: pose }] }), { anchor: [4, 40, 0], blending: null });
  pose.line = { material: { blending: THREE.AdditiveBlending } };
  assert.equal(readGrapple({ players: [{ grapple: pose }] }).blending, THREE.AdditiveBlending);
  assert.equal(readGrapple({ players: [{}] }), null);
}
const clockLanding = new Function(`${landingDropSource}; return withLandingClock;`)();
{
  const descriptor = Object.getOwnPropertyDescriptor(performance, "now"), nativeNow = performance.now;
  for (const fail of [false, true]) {
    const update = () => { assert.equal(performance.now(), 1234); if (fail) throw new Error("landing clock interrupted"); };
    if (fail) assert.throws(() => clockLanding(1234, update), /landing clock interrupted/); else clockLanding(1234, update);
    assert.equal(performance.now, nativeNow); assert.deepEqual(Object.getOwnPropertyDescriptor(performance, "now"), descriptor);
  }
}
{
  const fighter = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(8, 15, 8));
  fighter.rig.position.y = .012;
  fighter.leftLeg.rotation.z = .025; fighter.rightLeg.rotation.z = -.025;
  const standing = landingReference(fighter);
  fighter.group.updateMatrixWorld(true);
  const feet = () => [fighter.leftLeg, fighter.rightLeg].map(leg => new THREE.Box3().setFromObject(leg, true).min.y);
  const referenceFeet = feet();
  fighter.rig.scale.set(1.18, .79, 1.18); fighter.rig.rotation.x = .08;
  fighter.leftLeg.rotation.x = .65; fighter.rightLeg.rotation.x = .6; fighter.group.updateMatrixWorld(true);
  const original = landingReference(fighter), originalFeet = feet(), position = fighter.position.toArray(), muzzle = fighter.muzzlePoint().toArray();
  for (const fail of [false, true]) {
    const capture = async offset => {
      const planted = feet();
      assert.ok(offset <= 0);
      assert.ok(Math.abs(Math.min(...planted) - Math.min(...referenceFeet, ...originalFeet)) < 1e-12);
      for (let i = 0; i < 2; i++) assert.ok(Math.abs(planted[i] - originalFeet[i] - offset) < 1e-12);
      assert.deepEqual(fighter.position.toArray(), position); assert.deepEqual(fighter.muzzlePoint().toArray(), muzzle);
      if (fail) throw new Error("foot contact interrupted");
    };
    if (fail) await assert.rejects(plantLanding(fighter, standing, capture), /foot contact interrupted/);
    else await plantLanding(fighter, standing, capture);
    assert.deepEqual(landingReference(fighter), original); assert.equal(fighter.rig.position.y, .012); assert.deepEqual(feet(), originalFeet);
  }
  fighter.grounded = false;
  await plantLanding(fighter, standing, offset => { assert.equal(offset, 0); assert.deepEqual(feet(), originalFeet); });
  fighter.dispose();
}
const makeTrailEdgeMaterials = new Function("THREE", "materialOpacity", "normalViewGeometry", "positionViewDirection", `${landingDropSource}; return makeTrailEdgeMaterials;`)(THREE, materialOpacity, normalViewGeometry, positionViewDirection);
const fadeTrail = new Function(`${landingDropSource}; return withTrailEdgeMaterials;`)();
{
  const effects = new CombatVisuals(new THREE.Scene()), mesh = effects.createProjectile({ accent: 0xff3388 }, WEAPONS.blaster, .11);
  const entries = makeTrailEdgeMaterials({ mesh }); assert.equal(entries.length, 1);
  const { trail, control, trial } = entries[0], geometry = trail.geometry, material = trail.material;
  assert.equal(control.opacityNode, null); assert.ok(trial.opacityNode?.isNode);
  for (const candidate of [control, trial]) {
    for (const field of ["transparent", "blending", "depthWrite", "toneMapped", "vertexColors", "side"]) assert.equal(candidate[field], material[field]);
    assert.ok(candidate.color.equals(material.color));
  }
  for (const mode of ["control", "trial"]) for (const fail of [false, true]) {
    material.opacity = .17;
    const capture = async () => {
      assert.equal(trail.geometry, geometry); assert.equal(trail.material, entries[0][mode]); assert.equal(trail.material.opacity, .17);
      if (fail) throw new Error("edge capture interrupted");
    };
    if (fail) await assert.rejects(fadeTrail(entries, mode, capture), /edge capture interrupted/);
    else await fadeTrail(entries, mode, capture);
    assert.equal(trail.material, material); assert.equal(trail.geometry, geometry);
  }
  control.dispose(); trial.dispose(); mesh.traverse(child => child.material?.dispose()); effects.dispose();
}
const freezeShaderTime = new Function("shaderTime", `${landingDropSource}; return withFrozenShaderTime;`)(shaderTime);
for (const fail of [false, true]) {
  const update = shaderTime.update;
  shaderTime.update({ time: 7 });
  const capture = async () => {
    shaderTime.update({ time: 99 });
    assert.equal(shaderTime.value, 7, "paused comparison must freeze renderer-time effects too");
    if (fail) throw new Error("clock capture interrupted");
  };
  if (fail) await assert.rejects(freezeShaderTime(capture), /clock capture interrupted/);
  else await freezeShaderTime(capture);
  assert.equal(shaderTime.update, update);
  shaderTime.update({ time: 100 });
  assert.equal(shaderTime.value, 100, "ordinary shader time must resume after comparison");
}
{
  const effects = new CombatVisuals(new THREE.Scene()), mesh = effects.createProjectile({ accent: 0x6ff6ff }, WEAPONS.blaster, .11);
  const entries = makeTrailShading({ mesh }); assert.equal(entries.length, 1);
  const entry = entries[0], geometry = entry.trail.geometry, material = entry.trail.material;
  for (const candidate of [entry.white, entry.gradient]) {
    for (const attribute of ["position", "normal", "uv"]) assert.deepEqual(candidate.getAttribute(attribute).array, geometry.getAttribute(attribute).array);
    assert.deepEqual(candidate.index.array, geometry.index.array);
    assert.equal(candidate.getAttribute("color").count, geometry.getAttribute("position").count);
  }
  assert.ok(entry.white.getAttribute("color").array.every(value => value === 1));
  const uv = geometry.getAttribute("uv"), colors = entry.gradient.getAttribute("color");
  for (let i = 0; i < uv.count; i++) assert.equal(colors.getX(i), 1 - uv.getY(i));
  for (const mode of ["white", "gradient"]) for (const fail of [false, true]) {
    material.opacity = .17;
    const capture = () => {
      assert.ok(entry.trail.geometry === entry[mode] && entry.trail.material === entry.material);
      assert.equal(entry.material.vertexColors, true); assert.equal(entry.material.opacity, material.opacity);
      assert.ok(entry.material.color.equals(material.color));
      if (fail) throw new Error("shading interrupted");
    };
    if (fail) await assert.rejects(shadeTrail(entries, mode, capture), /shading interrupted/); else await shadeTrail(entries, mode, capture);
    assert.ok(entry.trail.geometry === geometry && entry.trail.material === material);
  }
  for (const asset of [entry.white, entry.gradient, entry.material]) asset.dispose();
  mesh.traverse(child => child.material?.dispose()); effects.dispose();
}
{
  const effects = new CombatVisuals(new THREE.Scene());
  const mesh = effects.createProjectile({ accent: 0x6ff6ff }, WEAPONS.blaster, .11);
  const shot = { mesh, velocity: new THREE.Vector3(0, 0, -30) };
  effects.updateProjectile(shot, 1 / 60); mesh.updateMatrixWorld(true);
  const trails = mesh.userData.combatVisual.trailParts;
  assert.equal(trails.length, 1);
  const before = trails.map(trail => ({ rotationX: trail.rotation.x, quaternion: trail.quaternion.toArray(), matrix: trail.matrixWorld.toArray(), position: trail.position.toArray(), scale: trail.scale.toArray(), geometry: trail.geometry, material: trail.material }));
  for (const fail of [false, true]) {
    const capture = () => {
      trails.forEach((trail, i) => {
        assert.ok(Math.abs(trail.rotation.x + before[i].rotationX) < 1e-12);
        assert.deepEqual(trail.position.toArray(), before[i].position); assert.deepEqual(trail.scale.toArray(), before[i].scale);
        assert.ok(trail.geometry === before[i].geometry && trail.material === before[i].material);
      });
      if (fail) throw new Error("trail capture interrupted");
    };
    if (fail) await assert.rejects(reverseTrail(shot, capture), /trail capture interrupted/); else await reverseTrail(shot, capture);
    trails.forEach((trail, i) => { assert.deepEqual(trail.quaternion.toArray(), before[i].quaternion); assert.deepEqual(trail.matrixWorld.toArray(), before[i].matrix); });
  }
  mesh.traverse(child => child.material?.dispose()); effects.dispose();
}
for (const weaponId of Object.keys(WEAPONS)) {
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3(8, 15, 8));
  hero.grounded = true; hero.landTimer = .11; hero.landStrength = .36; hero.rig.position.y = -.07; hero.group.updateMatrixWorld(true);
  const before = { y: hero.rig.position.y, scale: hero.rig.scale.toArray(), rotation: hero.rig.rotation.toArray(),
    muzzle: hero.muzzlePoint().toArray(), projectile: hero.forwardPoint(.08).toArray(), position: hero.position.toArray(),
    legs: [hero.leftLeg, hero.rightLeg].map(leg => leg.matrix.toArray()), rig: hero.rig.matrixWorld.toArray() };
  for (const fail of [false, true]) {
    const capture = drop => {
      assert.ok(Math.abs(drop - .0972) < 1e-12); assert.ok(Math.abs(hero.rig.position.y - before.y + drop) < 1e-12);
      assert.deepEqual(hero.rig.scale.toArray(), before.scale); assert.deepEqual(hero.rig.rotation.toArray(), before.rotation);
      assert.deepEqual(hero.muzzlePoint().toArray(), before.muzzle); assert.deepEqual(hero.forwardPoint(.08).toArray(), before.projectile);
      assert.deepEqual(hero.position.toArray(), before.position); assert.deepEqual([hero.leftLeg, hero.rightLeg].map(leg => leg.matrix.toArray()), before.legs);
      if (fail) throw new Error("landing capture interrupted");
    };
    if (fail) await assert.rejects(removeLandingDrop(hero, capture), /landing capture interrupted/); else await removeLandingDrop(hero, capture);
    assert.equal(hero.rig.position.y, before.y); assert.deepEqual(hero.rig.matrixWorld.toArray(), before.rig);
  }
  hero.landTimer = 0; await assert.rejects(removeLandingDrop(hero, () => assert.fail("idle accepted")), /landing pose/);
  hero.dispose();
}
{
  const source = graphicsFixture.slice(graphicsFixture.indexOf("async function runLandingReview("), graphicsFixture.indexOf('select("landing-translation").onclick'));
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(8, 15, 8));
  hero.grounded = true; hero.landTimer = .11; hero.landStrength = .36; hero.rig.position.y = -.07; hero.group.updateMatrixWorld(true);
  const state = {}, controls = [{ disabled: false }, { disabled: true }], links = [];
  let beforeShot;
  const shotCalls = [], shotGame = { scene: new THREE.Scene(), projectiles: [], combatMusicPulse: .23, combatVisuals: new CombatVisuals(new THREE.Scene()),
    clearTransientNetworkCombat() { for (const { mesh } of this.projectiles) mesh.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); }); this.projectiles = []; shotCalls.push("clear"); },
    tryFire(player) { shotCalls.push("fire");
      const mesh = new THREE.Group(), trail = new THREE.Mesh(new THREE.ConeGeometry(.1, 2, 6, 1, true), new THREE.MeshBasicMaterial()); trail.rotation.x = Math.PI / 2; mesh.add(trail);
      mesh.position.copy(player.forwardPoint(.08)); mesh.userData.combatVisual = { trailParts: [trail] }; mesh.updateMatrixWorld(true);
      this.projectiles.push({ mesh, age: 0 });
      beforeShot = { velocity: player.velocity.toArray(), recoilVisual: player.recoilVisual };
      player.recoil(); player.ammo[player.weapon.id]--; player.attackTimer = .3; this.combatMusicPulse = .52;
      this.combatVisuals.muzzle(player, player.weapon); },
    updateProjectiles(dt) { shotCalls.push("step"); this.projectiles[0].age += dt; this.projectiles[0].mesh.position.addScaledVector(hero.aim, dt * 30); this.projectiles[0].mesh.updateMatrixWorld(true); } };
  let interrupted = false;
  const shadingDisposals = [];
  const trackedShading = projectile => {
    const entries = makeTrailShading(projectile);
    for (const entry of entries) for (const asset of [entry.white, entry.gradient, entry.material]) asset.addEventListener("dispose", () => shadingDisposals.push(asset.uuid));
    return entries;
  };
  const trackedEdges = projectile => {
    const entries = makeTrailEdgeMaterials(projectile);
    for (const entry of entries) for (const asset of [entry.control, entry.trial]) asset.addEventListener("dispose", () => shadingDisposals.push(asset.uuid));
    return entries;
  };
  const nativeNow = performance.now;
  const run = new Function("THREE", "Fighter", "game", "cameraReview", "document", "select", "waitForReviewFrame", "shellReviewState", "withPreviousLandingDrop", "withTranslatedMuzzle", "withReversedTrail", "makeTrailShading", "withTrailShading", "withFrozenShaderTime", "makeTrailEdgeMaterials", "withTrailEdgeMaterials", "landingReference", "withLandingContact", "withLandingClock", `
    const resetReview={},cacheReview={},decoyReview={},sceneSerial=1,errorCount=0,stress=false,resetPhase="ready",renderedFrames=0,stillMove=new THREE.Vector3(),reviewAim=new THREE.Vector3(0,0,-1); let cameraOffset=0;
    ${source};return runLandingReview;`)(THREE, Fighter, Object.assign(shotGame, { players: [hero], paused: true, renderPipeline: { direct: false }, world: {
      surfaceHeightAt: () => 15, resolve: position => { const grounded = position.y <= 15; if (grounded) position.y = 15; return { grounded }; }, boostAt: () => null } }), state,
    { querySelectorAll: () => controls, createElement: () => ({}), querySelector: () => ({ toDataURL: () => "data:image/png;base64,test" }) },
    name => name === "view" ? { value: "lower-body-side" } : name === "pose" ? { value: "landing" } : { replaceChildren: () => { links.length = 0; }, append: link => links.push(link) },
    async () => { assert.equal(performance.now, nativeNow); assert.equal(state.shell, true); assert.ok(controls.every(control => control.disabled)); if (interrupted && state.samples.length === 1) throw new Error("landing frame timeout"); },
    () => ({}), removeLandingDrop, translateMuzzle, reverseTrail, trackedShading, shadeTrail, freezeShaderTime, trackedEdges, fadeTrail, landingReference, plantLanding, clockLanding);
  for (const transition of ["grapple", "move", "hit"]) {
    await run(true, 8, false, null, false, transition);
    assert.equal(state.error, null); assert.equal(state.samples.length, 27); assert.equal(state.landingFrames.length, 46);
    assert.equal(shotGame.players[0], hero); assert.equal(hero.group.visible, true);
    assert.equal(state.transitionKind, "pose-branch-control-before-update");
    assert.equal(state.landingFrames[5].baseline.grappled, false);
    assert.equal(state.landingFrames[6].baseline.grappled, transition === "grapple");
    if (transition === "hit") assert.ok(state.landingFrames[6].baseline.hitTimer > 0);
    if (transition === "move") for (const sample of state.samples) assert.ok(Math.abs(sample.cameraOffset - sample.fighterPosition[0] + hero.position.x) < 1e-12);
    assert.ok(state.samples.every(sample => sample.reviewStep > 60));
    interrupted = true; await run(true, 8, false, null, false, transition);
    assert.match(state.error, /landing frame timeout/); assert.equal(shotGame.players[0], hero); assert.equal(hero.group.visible, true);
    assert.equal(performance.now, nativeNow); interrupted = false;
  }
  await run(); assert.equal(state.error, null); assert.equal(links.length, 3);
  assert.deepEqual(state.samples.map(sample => sample.mode), ["current", "previous-drop", "current-restored"]);
  assert.equal(state.samples[0].rigY, state.samples[2].rigY); assert.ok(state.samples[1].rigY < state.samples[0].rigY);
  interrupted = true; await run(); assert.match(state.error, /landing frame timeout/);
  assert.equal(hero.rig.position.y, -.07); assert.equal(state.running, false); assert.equal(state.shell, false);
  assert.deepEqual(controls.map(control => control.disabled), [false, true]);
  interrupted = false;
  for (const fallHeight of [0, 8]) {
    await run(true, fallHeight); assert.equal(state.error, null);
    assert.equal(state.samples.length, 27); assert.equal(state.landingFrames.length, 46);
    assert.equal(state.landingFrames.at(-1).baseline.landTimer, 0);
    assert.ok(state.landingFrames[0].baseline.landStrength > (fallHeight ? .9 : .3));
    for (const frame of state.landingFrames) {
      assert.equal(frame.fallHeight, fallHeight); assert.equal(frame.baseline.floor, 15);
      assert.deepEqual(frame.baseline.fighterPosition, frame.candidate.fighterPosition);
      assert.deepEqual(frame.baseline.velocity, frame.candidate.velocity);
      assert.deepEqual(frame.baseline.logicalMuzzle, frame.candidate.logicalMuzzle);
      assert.deepEqual(frame.baseline.rigScale, frame.candidate.rigScale);
      assert.ok(frame.candidate.rigY <= frame.baseline.rigY);
    }
  }
  await run(true, 8, true); assert.equal(state.error, null); assert.equal(state.samples.length, 9);
  assert.deepEqual(shotCalls, ["clear", "fire", "step", "step", "clear"]);
  for (let index = 0; index < 9; index += 3) {
    assert.deepEqual(state.samples[index].shotEvidence, state.samples[index + 1].shotEvidence);
    assert.deepEqual(state.samples[index].weaponMatrix, state.samples[index + 2].weaponMatrix);
    assert.ok(state.samples[index + 1].blasterAperture[1] < state.samples[index].blasterAperture[1]);
    const rayDistance = sample => new THREE.Vector3().fromArray(sample.blasterAperture)
      .sub(new THREE.Vector3().fromArray(sample.logicalMuzzle)).cross(hero.aim).length();
    assert.ok(rayDistance(state.samples[index]) <= rayDistance(state.samples[index + 1]), "corrected barrel must not move farther from the muzzle ray");
    assert.equal(state.samples[index].shotEvidence.projectiles[0].age, index / 3 / 60);
  }
  interrupted = true; await run(true, 8, true); assert.match(state.error, /landing frame timeout/);
  assert.equal(shotCalls.at(-1), "clear"); assert.equal(shotGame.projectiles.length, 0);
  assert.deepEqual(hero.velocity.toArray(), beforeShot.velocity); assert.equal(hero.recoilVisual, beforeShot.recoilVisual);
  assert.equal(hero.attackTimer, 0); assert.equal(hero.ammo.blaster, WEAPONS.blaster.ammo); assert.equal(shotGame.combatMusicPulse, .23);
  assert.ok([...shotGame.combatVisuals.flashes, ...shotGame.combatVisuals.tracers].every(slot => slot.life <= 0 && !slot.visible));
  assert.ok(shotGame.combatVisuals.combatLights.every(light => light.userData.life <= 0 && light.intensity === 0));
  for (const layer of ["flashOuter", "flashInner", "tracerOuter", "tracerInner", "ringOuter", "sparkLayer", "bloodLayer"])
    assert.equal(shotGame.combatVisuals[layer].count, 0, `${layer} must be empty after the shot check`);
  interrupted = false;
  const originalSnapshot = () => {
    const fields = Object.fromEntries(Object.entries(hero).filter(([, value]) => value === null || ["number", "string", "boolean"].includes(typeof value) || value?.isVector3 || value?.isQuaternion)
      .map(([key, value]) => [key, value?.toArray ? value.toArray() : value]));
    const transforms = []; hero.group.traverse(object => transforms.push([object.uuid, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.visible]));
    return { fields, transforms, ammo: { ...hero.ammo } };
  };
  const original = originalSnapshot();
  for (const mode of ["neutral", "landing", "neutral-follow", "landing-follow", "neutral-tail", "landing-tail", "neutral-shade", "landing-shade", "neutral-edge", "landing-edge"]) {
    const following = mode.endsWith("-follow"), tail = mode.endsWith("-tail"), shade = mode.endsWith("-shade"), edge = mode.endsWith("-edge"), quartet = shade || edge;
    shadingDisposals.length = 0;
    await run(true, mode.startsWith("neutral") ? 0 : 8, true, mode); assert.equal(state.error, null); assert.equal(state.samples.length, quartet ? 48 : following || tail ? 36 : 27);
    assert.equal(shadingDisposals.length, shade ? 3 : edge ? 2 : 0); assert.equal(new Set(shadingDisposals).size, shadingDisposals.length);
    assert.ok(shotGame.players[0] === hero); assert.deepEqual(originalSnapshot(), original); assert.equal(shotGame.scene.children.length, 0);
    if (tail || quartet) assert.ok(Math.abs(state.samples[0].shotEvidence.muzzleEvent.age - 1 / 60) < 1e-12, "trail review starts after the real heading update, not construction state");
    for (let index = 0; index < state.samples.length; index += quartet ? 4 : 3) {
      const before = state.samples[index], trial = state.samples[index + (quartet ? 2 : 1)], restored = state.samples[index + (quartet ? 3 : 2)];
      assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(new THREE.Matrix4().fromArray(before.weaponMatrix)).dot(new THREE.Vector3(0, 0, -1)) > .95,
        "temporary fighter barrel must face the shot direction throughout recoil");
      assert.deepEqual(before.shotEvidence, restored.shotEvidence);
      if (tail || shade) {
        assert.deepEqual(before.shotEvidence.projectiles.map(({ trails, ...physical }) => physical), trial.shotEvidence.projectiles.map(({ trails, ...physical }) => physical));
        if (tail) assert.notDeepEqual(before.shotEvidence.projectiles[0].trails[0].rotation, trial.shotEvidence.projectiles[0].trails[0].rotation);
        else {
          assert.deepEqual(before.shotEvidence.projectiles[0].trails[0].rotation, trial.shotEvidence.projectiles[0].trails[0].rotation);
          assert.ok(state.samples[index + 1].shotEvidence.projectiles[0].trails[0].colors.every(value => value === 1));
          assert.ok(trial.shotEvidence.projectiles[0].trails[0].colors.includes(0));
          assert.equal(before.shotEvidence.projectiles[0].trails[0].opacity, trial.shotEvidence.projectiles[0].trails[0].opacity);
        }
        assert.deepEqual(before.shotEvidence.projectiles[0].trails[0].scale, trial.shotEvidence.projectiles[0].trails[0].scale);
      } else assert.deepEqual(before.shotEvidence.projectiles, trial.shotEvidence.projectiles);
      assert.deepEqual(before.weaponMatrix, trial.weaponMatrix);
      const event = before.shotEvidence.muzzleEvent, moved = trial.shotEvidence.muzzleEvent;
      if (following && event.flashLife > 0) assert.ok(new THREE.Vector3().fromArray(event.flash).distanceTo(new THREE.Vector3().fromArray(before.blasterAperture)) < 1e-12);
      for (const field of ["flash", "tracerStart", "tracerEnd", "lightPosition"]) {
        const expected = tail || quartet ? new THREE.Vector3().fromArray(event[field]) : following ? new THREE.Vector3().fromArray(state.samples[0].shotEvidence.muzzleEvent[field])
          : new THREE.Vector3().fromArray(event[field]).add(new THREE.Vector3().fromArray(event.delta));
        assert.ok(expected.distanceTo(new THREE.Vector3().fromArray(moved[field])) < 1e-12);
      }
      assert.equal(event.flashLife, moved.flashLife); assert.equal(event.lightIntensity, moved.lightIntensity);
    }
    assert.ok(state.samples.at(-1).shotEvidence.muzzleEvent.flashLife <= 0, "capture must include flash expiry");
    if (following) {
      assert.ok(Math.abs(state.samples.at(-1).shotEvidence.muzzleEvent.age - .5) < 1e-12);
      assert.ok(state.samples.at(-1).shotEvidence.muzzleEvent.lightIntensity < .001, "include the damped light tail");
    }
    assert.notDeepEqual(state.samples[0].weaponMatrix, state.samples[quartet ? 4 : 3].weaponMatrix, "recoil must actually animate");
  }
  interrupted = true; await run(true, 8, true, "landing"); assert.match(state.error, /landing frame timeout/);
  shadingDisposals.length = 0; await run(true, 8, true, "landing-shade"); assert.match(state.error, /landing frame timeout/);
  assert.equal(shadingDisposals.length, 3); assert.equal(new Set(shadingDisposals).size, 3);
  shadingDisposals.length = 0; await run(true, 8, true, "landing-edge"); assert.match(state.error, /landing frame timeout/);
  assert.equal(shadingDisposals.length, 2); assert.equal(new Set(shadingDisposals).size, 2);
  assert.ok(shotGame.players[0] === hero); assert.deepEqual(originalSnapshot(), original); assert.equal(shotGame.scene.children.length, 0);
  assert.equal(shotGame.projectiles.length, 0); assert.ok(shotGame.combatVisuals.flashes.every(slot => slot.life === 0));
  shotGame.combatVisuals.dispose();
  hero.dispose();
}
const weaponSelectSource = graphicsFixture.slice(graphicsFixture.indexOf('select("weapon").onchange ='), graphicsFixture.indexOf('select("pose").onchange ='));
for (const view of ["lower-body-front", "lower-body-side"]) {
  assert.ok(graphicsFixture.includes(`<option>${view}</option>`));
  const hero = new Fighter(new THREE.Scene(), { id: "p1", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { resolve: position => { position.y = 15.01; return { grounded: true }; }, boostAt: () => null } };
  new Function("THREE", "game", "select", `let stress=false, cameraOffset=0; const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; setView();`)(THREE, game, name => ({ value: name === "view" ? view : name === "aim-height" ? "0" : "aim" }));
  game.camera.updateMatrixWorld(true);
  assert.equal(hero.position.x, 8, "lower-body route clears the central seven-metre spire");
  const center = new THREE.Vector3(8, 15.55, 8).project(game.camera);
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6);
  assert.equal(game.camera.fov, 62);
  const before = game.camera.position.clone(); hero.weaponGroup.position.x += .3; game.updateCamera();
  assert.deepEqual(game.camera.position, before); hero.dispose();
}
for (const view of ["hand-front", "hand-side", "hand-opposite", "hand-palm", "hand-shoulder", "hand-shoulder-opposite", "hand-shoulder-oblique"]) for (const previousPose of ["aim", "reload", "reacquire-early"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "hand-view", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const controls = { view: { value: view }, weapon: { value: "blaster" }, pose: { value: "aim" }, "aim-height": { value: "0" } };
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { resolve: position => { position.y = 15.01; return { grounded: true }; }, boostAt: () => null } };
  const review = new Function("THREE", "game", "select", `let stress=false, cameraOffset=0;
    const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; ${weaponSelectSource}; return {setView,settlePose};`)(THREE, game, name => controls[name]);
  review.setView();
  controls.pose.value = previousPose; review.settlePose();
  controls.weapon.value = "hammer";
  assert.ok(WEAPONS[controls.weapon.value], "use a real alternate grip");
  controls.weapon.onchange();
  assert.equal(controls.pose.value, "aim", "hand view/weapon changes visibly reset to ready pose before framing");
  game.updateCamera(); game.camera.updateMatrixWorld(true);
  const target = (view.startsWith("hand-shoulder") ? new THREE.Vector3(0, -.16, 0).applyMatrix4((view === "hand-shoulder-opposite" ? hero.leftArm : hero.rightArm).matrixWorld)
    : view === "hand-palm" ? hero.leftHand.position.clone().applyMatrix4(hero.leftForearm.matrixWorld)
    : hero.weaponGrip.clone().applyMatrix4(hero.weaponGroup.matrixWorld)).project(game.camera);
  assert.ok(Math.abs(target.x) < 1e-6 && Math.abs(target.y) < 1e-6, "weapon switching must reframe the current grip, not retain the old anchor");
  if (view === "hand-shoulder-oblique") {
    const focus = new THREE.Vector3(0, -.16, 0).applyMatrix4(hero.rightArm.matrixWorld);
    const offset = new THREE.Vector3(1.5, .24, .12).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 9).applyQuaternion(hero.group.quaternion);
    assert.ok(game.camera.position.clone().sub(focus).distanceTo(offset) < 1e-8, "oblique view orbits exactly 20 degrees without changing focus or distance");
    assert.equal(game.camera.fov, 62);
  }
  const cameraPosition = game.camera.position.clone();
  controls.pose.value = "fire";
  // A weapon transform change must NOT be followed after the view is established.
  hero.weaponGroup.position.x += .3; hero.group.updateMatrixWorld(true); game.updateCamera();
  assert.deepEqual(game.camera.position, cameraPosition, "fixed framing preserves visible weapon travel");
  hero.dispose();
}
const captureSource = graphicsFixture.slice(graphicsFixture.indexOf("    const grapple = game.players[0]?.grapple;"), graphicsFixture.indexOf('    const link = select("canvas-capture");'));
const captureFrame = new Function("THREE", "game", "renderedFrames", "sceneSerial", "select", "ropeRenders", "ropeRendersBefore", "errorCount", "thrusterSortControl", "thrusterRenderOrder", "poseReview", `let canvasCapture; ${captureSource}; return canvasCapture;`).bind(null, THREE);
{
  const hero = new Fighter(new THREE.Scene(), { id: "hand-metadata", color: 0x129dba, accent: 0x6ff6ff }, ["rocket_launcher"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 300); camera.position.set(1, 2, 3); camera.updateMatrixWorld(true);
  const game = { players: [hero], scene: { children: [] }, camera, settings: { graphics: "high" },
    renderer: { info: { render: { drawCalls: 1, triangles: 1 } } }, renderPipeline: { direct: false, profile: "WEBGPU ULTRA" } };
  const review = { requested: "aim", reloadAccepted: null, additionalReacquireFrames: 0 };
  const captured = captureFrame(game, 10, 3, () => ({ value: "hand-front" }), 0, 0, 0, null, [], review);
  assert.equal(captured.handPose.weapon, "rocket_launcher"); assert.equal(captured.tier, "high"); assert.equal(captured.profile, "WEBGPU ULTRA");
  assert.equal(captured.lowerBody.floorAtFighter, null);
  assert.deepEqual(captured.lowerBody.legs[0].matrix, hero.leftLeg.matrixWorld.toArray());
  assert.deepEqual(captured.lowerBody.legs[0].bounds.min, new THREE.Box3().setFromObject(hero.leftLeg, true).min.toArray());
  assert.equal(captured.camera.gameplay, false);
  assert.deepEqual(captured.exhaust.position, hero.position.toArray());
  assert.deepEqual(captured.exhaust.velocity, hero.velocity.toArray());
  assert.deepEqual(captured.exhaust.scale, hero.thrusterLights.scale.toArray());
  assert.deepEqual(captured.exhaust.matrix, hero.thrusterLights.matrixWorld.toArray());
  assert.equal(captured.exhaust.opacity, hero.thrusterMaterial.opacity);
  assert.equal(captured.exhaust.vertices, hero.thrusterLights.geometry.attributes.position.count);
  assert.deepEqual(captured.handPose.rightForearmMatrix, hero.rightForearm.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.leftForearmMatrix, hero.leftForearm.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.weaponMatrix, hero.weaponGroup.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.rightHandLocal, hero.rightHand.position.toArray());
  const stored = JSON.stringify(captured);
  hero.rightHand.position.x = 8; hero.rightForearm.matrixWorld.elements[12] = 9; hero.weaponGrip.y = 8;
  camera.matrixWorld.elements[12] = 10; review.requested = "reload";
  hero.position.x = 15; hero.velocity.y = 20; hero.thrusterLights.scale.y = 2;
  hero.thrusterLights.matrixWorld.elements[12] = 13; hero.thrusterMaterial.opacity = .9;
  assert.equal(JSON.stringify(captured), stored, "later pose/camera changes cannot rewrite saved evidence");
  hero.dispose();
}
for (const renders of [0, 1]) {
  const captureGame = { players: [{ id: "helmet-2", aim: new THREE.Vector3(0, 0, -1), helmet: { matrixWorld: new THREE.Matrix4() }, visor: { matrixWorld: new THREE.Matrix4() },
    grapple: { anchor: new THREE.Vector3(1, 2, 3), line: { geometry: { instanceCount: 1 }, material: { blending: THREE.NoBlending } } } }],
    scene: { children: [{ isLine2: true }, {}] },
    renderer: { info: { render: { drawCalls: 378, triangles: 169330 } } }, renderPipeline: { direct: false } };
  const captured = captureFrame(captureGame, 8, 1, () => ({ value: "effects" }), 4 + renders, 4, 0);
  captureGame.renderer.info.render.drawCalls = 1;
  assert.equal(captured.draws, 378);
  assert.equal(captured.rope.rendersThisFrame, renders, "a live grapple object alone cannot certify a rendered rope");
  assert.equal(captured.rope.segments, 1);
  assert.equal(captured.grappleLines, 1);
  captureGame.players[0].aim.y = 1; captureGame.players[0].helmet.matrixWorld.elements[12] = 8;
  assert.equal(captured.fighter.id, "helmet-2"); assert.deepEqual(captured.fighter.aim, [0, 0, -1]); assert.equal(captured.fighter.helmetMatrix[12], 0);
  captureGame.players = []; captureGame.scene.children = [];
  const released = captureFrame(captureGame, 9, 1, () => ({ value: "effects" }), 4, 4, 0);
  assert.equal(released.rope, null); assert.equal(released.grappleLines, 0); assert.equal(released.fighter, null);
}
const sortControlSource = graphicsFixture.slice(graphicsFixture.indexOf("function clearThrusterSortControl("), graphicsFixture.indexOf("let settleUntil"));
const sortScene = new THREE.Scene(), sortCamera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 300);
sortCamera.position.set(1.6, 1.7, 2.3); sortCamera.lookAt(0, 1.15, .49); sortCamera.updateMatrixWorld(true);
const sortFighter = new Fighter(sortScene, { id: "sort-control", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const modernFlames = sortFighter.thrusterLights, originalParent = modernFlames.parent, originalCallback = modernFlames.onBeforeRender;
const sortHarness = new Function("THREE", "game", `let stress=false, resetReview={}, cacheReview={}, cameraReview={}, decoyReview={}, thrusterSortControl=null, thrusterRenderOrder=[], captureCanvas=false;
  ${sortControlSource}; return { toggle: toggleThrusterSortControl, clear: clearThrusterSortControl, state: () => thrusterSortControl };`)(THREE, { scene: sortScene, camera: sortCamera, players: [sortFighter] });
sortHarness.toggle();
const sortControl = sortHarness.state();
assert.ok(sortControl.quadZ > Math.min(sortControl.legacyZ, sortControl.modernZ) && sortControl.quadZ < Math.max(sortControl.legacyZ, sortControl.modernZ),
  "overlap control must exercise the changed transparent sort keys");
assert.equal(sortControl.mode, "merged");
sortHarness.toggle();
assert.equal(sortControl.mode, "legacy"); assert.equal(modernFlames.parent, null);
assert.ok(sortControl.legacy.parent === originalParent);
const controlResources = [sortControl.legacy.geometry, sortControl.legacy.material, sortControl.quad.geometry, sortControl.quad.material];
const disposed = new Map(controlResources.map(resource => [resource, 0]));
for (const resource of controlResources) resource.addEventListener("dispose", () => disposed.set(resource, disposed.get(resource) + 1));
sortHarness.clear(); sortHarness.clear();
assert.ok(modernFlames.parent === originalParent && modernFlames.onBeforeRender === originalCallback, "cleanup restores the real fighter even when the legacy control is active");
assert.ok([...disposed.values()].every(count => count === 1));
sortFighter.dispose();
const hideAOObjectSource = graphicsFixture.slice(graphicsFixture.indexOf("function hideAOObjectForReview("), graphicsFixture.indexOf("const requestedAOOutput"));
for (const hidden of [null, "grid", "route", "unknown"]) {
  const hide = new Function("hiddenAOObject", `${hideAOObjectSource}; return hideAOObjectForReview;`)(hidden);
  const objects = [{ type: "GridHelper", visible: true }, { name: "District route floor", visible: true }, { name: "Arena floor", visible: true }];
  objects.forEach(hide);
  assert.deepEqual(objects.map(object => object.visible), [hidden !== "grid", hidden !== "route", true], "QA visibility isolation changes only the requested object, never the ground");
}
const aoWrapperSource = graphicsFixture.slice(graphicsFixture.indexOf("function withAODiagnostics("), graphicsFixture.indexOf("// QA-only causal comparison"));
const geometryNormalToken = {}, colorOutputToken = {};
const makeAOWrapper = new Function("mrt", "normalViewGeometry", "output", "geometryAONormals", "aoOutput", "vec3", "vec4", "depthAONormals", "legacyAONormals", "normalView", "materialBlendAONormals", "THREE", "recoverAONormals", "singleSampleAO", "emulateCompatibilityAO", `${aoWrapperSource}; return withAODiagnostics;`);
const wrapAONormals = makeAOWrapper(value => value, geometryNormalToken, colorOutputToken, true, "final");
let aoOverrides = 0, aoBuildCalls = 0;
const aoFixture = { ensure: wrapAONormals(function (value) {
  aoBuildCalls++; this.aoPass = {};
  this.scenePass ??= { setMRT(value) { aoOverrides++; assert.ok(value.normal === geometryNormalToken && value.output === colorOutputToken); } };
  return value;
}) };
assert.equal(aoFixture.ensure(7), 7);
assert.equal(aoFixture.ensure(8), 8);
assert.equal(aoBuildCalls, 2); assert.equal(aoOverrides, 1, "QA normal comparison overrides only newly created AO scene passes");
const noAOFixture = { ensure: wrapAONormals(function () { this.scenePass = { setMRT() { throw new Error("non-AO pass changed"); } }; }) };
noAOFixture.ensure();
const depthAOFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, true)(function () {
  this.aoPass = { normalNode: {} }; this.scenePass = {};
}) };
depthAOFixture.ensure();
assert.equal(depthAOFixture.aoPass.normalNode, null, "depth-normal diagnostic changes only the AO normal source");
const legacyAOFixture = { ensure: makeAOWrapper(value => value, null, colorOutputToken, false, "final", null, null, false, true, normalView)(function () {
  this.aoPass = {}; this.scenePass = { setMRT(value) { assert.ok(value.normal === normalView && value.output === colorOutputToken); } };
}) };
legacyAOFixture.ensure();
let normalBlend;
const materialBlendFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, false, false, null, true, THREE)(function () {
  this.aoPass = {}; this.scenePass = { getMRT: () => ({ setBlendMode(name, blend) { assert.equal(name, "normal"); normalBlend = blend; } }) };
}) };
materialBlendFixture.ensure();
assert.equal(normalBlend.blending, THREE.MaterialBlending);

function assertCompatibleAONormals(root) {
  root.traverse(object => {
    for (const material of [].concat(object.material || [])) {
      if (material.depthWrite || !material.colorWrite) continue;
      assert.equal(material.transparent, true, "visible non-depth writers need alpha blending on compatibility GPUs");
      assert.equal(material.premultipliedAlpha, false, "a premultiplied normal needs separate coverage handling");
      assert.ok([THREE.NormalBlending, THREE.AdditiveBlending].includes(material.blending), "new blend modes need AO compatibility coverage");
      const blend = WebGPUPipelineUtils.prototype._getBlending.call({}, material);
      assert.equal(blend.color.srcFactor, "src-alpha");
      assert.ok(["one", "one-minus-src-alpha"].includes(blend.color.dstFactor));
      assert.equal(blend.color.operation, "add", "alpha zero preserves the destination normal in compatibility mode");
    }
  });
}
for (const mode of ["raw", "color"]) {
  const rawToken = {}, colorToken = {};
  const wrap = makeAOWrapper(() => { throw new Error("diagnostic changed material normals"); }, geometryNormalToken, colorOutputToken, false, mode,
    value => value, value => value);
  const target = { ensure: wrap(function () {
    this.aoPass = { getTextureNode: () => ({ r: rawToken }) };
    this.scenePass = { getTextureNode: () => colorToken };
    this.pipeline = {};
  }) };
  target.ensure();
  assert.ok(target.pipeline.outputNode === (mode === "raw" ? rawToken : colorToken));
  assert.equal(target.pipeline.needsUpdate, true);
}
const waitSource = graphicsFixture.slice(graphicsFixture.indexOf("function waitForReviewFrame("), graphicsFixture.indexOf("const stillMove"));
let timeoutCallback, timeoutDelay, frameCallback, cleared = 0, cancelled = 0, serial = 3;
const makeWait = new Function("setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "getSerial", "validateExhaustView",
  waitSource.replaceAll("sceneSerial", "getSerial()") + "; return waitForReviewFrame;");
for (const pose of ["hip-hard-peak", "hip-hard-recovery"]) {
  const guard = new Function("THREE", "select", `${settleReviewSource}; poseReview={requested:"aim"}; return validateExhaustView;`)(THREE,
    name => ({ value: name === "view" ? "waist-low-front" : pose }));
  let started = false;
  const fail = () => { started = true; };
  assert.throws(() => makeWait(fail, fail, fail, fail, () => 3, guard)(3, () => true), /successfully staged/);
  assert.equal(started, false);
}
const waitReview = makeWait((callback, delay) => { timeoutCallback = callback; timeoutDelay = delay; return 9; }, () => cleared++,
  callback => { frameCallback = callback; return 7; }, () => cancelled++, () => serial, capture => assert.equal(capture, true));
assert.throws(() => makeWait(() => { throw Error("must not start timer"); }, () => {}, () => {}, () => {}, () => serial,
  () => { throw Error("unsupported capture"); })(3, () => true), /unsupported capture/);
const stalledWait = waitReview(3, () => false);
assert.equal(timeoutDelay, 20000);
timeoutCallback();
await assert.rejects(stalledWait, /timed out/, "a suspended rAF cannot prevent the independent timeout");
assert.equal(cleared, 1); assert.equal(cancelled, 1);
await waitReview(3, () => true);
assert.equal(cleared, 2); assert.equal(cancelled, 2);
const interruptedWait = waitReview(3, () => false);
serial = 4; frameCallback();
await assert.rejects(interruptedWait, /scene change/);
const coldResetWait = waitReview(4, () => false, 60000);
assert.equal(timeoutDelay, 60000, "cold lifecycle readiness can request a longer bounded window");
timeoutCallback();
await assert.rejects(coldResetWait, /60 seconds/, "a stalled reset still terminates independently of rAF");
const decoySampleStart = graphicsFixture.indexOf("    const sample = async (cycle, phase) => {", graphicsFixture.indexOf("async function runDecoyReview"));
const decoySampleSource = graphicsFixture.slice(decoySampleStart, graphicsFixture.indexOf("    if (overlap) {", decoySampleStart));
const decoyWaits = [], decoySampleReview = { samples: [] };
const decoySample = new Function("game", "waitForReviewFrame", "decoyReview", "renderedFrames", "serial", "pipelineCreations", "errorCount",
  decoySampleSource + "; return sample;")({ settings: { graphics: "high" }, decoys: [], renderer: { info: { memory: {} } }, renderPipeline: { direct: false } },
  async (scene, ready, timeout) => { assert.equal(scene, 4); assert.equal(ready(), false); decoyWaits.push(timeout); }, decoySampleReview, 0, 4, 0, 0);
await decoySample(-1, "baseline"); await decoySample(0, "spawned"); await decoySample(0, "removed"); await decoySample(3, "cleanup");
assert.deepEqual(decoyWaits, [60000, 20000, 20000, 20000], "only cold decoy baseline gets reset readiness budget; warmed phases keep their original deadline");
assert.deepEqual(decoySampleReview.samples.map(sample => sample.phase), ["baseline", "spawned", "removed", "cleanup"]);

const botTraceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceBotMethod("), graphicsFixture.indexOf("if (traceFrames) for"));
let botTraceClock = 0, botTraceContext = null, botTraceCpu = {}, projectileTraceActive = false;
const traceBotMethod = new Function("performance", "getBot", "getCpu", "getProjectiles", botTraceSource.replaceAll("activeTraceBot", "getBot()").replaceAll("activeTraceProjectiles", "getProjectiles()").replaceAll("cpu.botCalls", "getCpu().botCalls").replaceAll("cpu[", "getCpu()[") + "; return traceBotMethod;")(
  { now: () => ++botTraceClock }, () => botTraceContext, () => botTraceCpu, () => projectileTraceActive);
const botTraceTarget = { value: 4, run(n) { return this.value + n; } };
assert.throws(() => traceBotMethod(botTraceTarget, "missing", "test"), /Unknown trace method: test.missing/, "stale hook names must fail visibly rather than silently lose attribution");
traceBotMethod(botTraceTarget, "run", "test");
assert.equal(botTraceTarget.run(3), 7);
assert.equal(botTraceClock, 0, "nested timing is inactive outside bot updates");
botTraceContext = { id: "p3", weapon: { id: "blaster" } };
for (let i = 0; i < 30; i++) assert.equal(botTraceTarget.run(i), 4 + i);
assert.deepEqual(botTraceCpu.botCalls["test.run"], { calls: 30, totalMs: 30, maxMs: 1, bot: "p3", weapon: "blaster" });
const botTraceError = new Error("bot call failed");
botTraceTarget.fail = () => { throw botTraceError; };
traceBotMethod(botTraceTarget, "fail", "test");
assert.throws(() => botTraceTarget.fail(), error => error === botTraceError);
assert.equal(botTraceCpu.botCalls["test.fail"].calls, 1);
botTraceCpu = {};
botTraceTarget.run(1);
assert.equal(botTraceCpu.botCalls["test.run"].calls, 1, "nested counters follow the current frame rather than retaining old state");
const queryPoint = new THREE.Vector3(1, 2, 3);
const queryTrace = { resolve(point) { point.x = 8; }, ropeObstacle(point) { return point; } };
traceBotMethod(queryTrace, "resolve", "world"); traceBotMethod(queryTrace, "ropeObstacle", "world");
queryTrace.resolve(queryPoint);
assert.equal(botTraceCpu.botCalls["world.resolve"].inputs, undefined, "mutating query coordinates cannot be mislabeled as inputs");
queryTrace.ropeObstacle(queryPoint); queryPoint.set(0, 0, 0);
assert.deepEqual(botTraceCpu.botCalls["world.ropeObstacle"].inputs, [[8, 2, 3]], "read-only query evidence owns numeric copies");
const ropeTrace = { updateGrapple() {} }, ropeTraceBot = { grapple: { wraps: Array.from({ length: 10 }, () => new THREE.Vector3(1, 2, 3)) } };
traceBotMethod(ropeTrace, "updateGrapple", "game"); ropeTrace.updateGrapple(ropeTraceBot);
ropeTraceBot.grapple.wraps[0].set(0, 0, 0);
assert.equal(botTraceCpu.botCalls["game.updateGrapple"].wraps.length, 8);
assert.deepEqual(botTraceCpu.botCalls["game.updateGrapple"].wraps[0], [1, 2, 3], "grapple evidence cannot retain mutable vectors");
botTraceContext = null; projectileTraceActive = true;
assert.equal(botTraceTarget.run(8), 12);
assert.deepEqual(botTraceCpu.projectileCalls["test.run"], { calls: 1, totalMs: 1, maxMs: 1, bot: null, weapon: null }, "projectile-loop timing must not be mislabeled as a bot update");
assert.throws(() => botTraceTarget.fail(), error => error === botTraceError);
assert.equal(botTraceCpu.projectileCalls["test.fail"].calls, 1);
const shotTrace = { damagePlayer() { return 7; } }, shotWeapon = { id: "rocket_launcher" };
traceBotMethod(shotTrace, "damagePlayer", "game");
assert.equal(shotTrace.damagePlayer({}, 10, {}, {}, shotWeapon), 7);
shotWeapon.id = "changed";
assert.equal(botTraceCpu.projectileCalls["game.damagePlayer"].weapon, "rocket_launcher", "max projectile attribution owns the relevant weapon label");
projectileTraceActive = false;
const stoppedTraceClock = botTraceClock;
botTraceTarget.run(1);
assert.equal(botTraceClock, stoppedTraceClock, "combat tracing stops outside both update phases");

const traceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceStartupMethod("), graphicsFixture.indexOf("if (traceStartup) {"));
assert.ok(graphicsFixture.includes("function createStartupIdentityRecorder("), "startup diagnostics distinguish actual cache keys from shader source identities");
const identitySource = graphicsFixture.slice(graphicsFixture.indexOf("function createStartupIdentityRecorder("), graphicsFixture.indexOf("const startupIdentityRecorder ="));
let clearedSources = 0;
class SourceMap extends Map { clear() { clearedSources += this.size; super.clear(); } }
const identityRecorder = new Function("Map", `${identitySource}; return createStartupIdentityRecorder();`)(SourceMap);
const identityObject = { initialCacheKey: 1, context: { id: 2 }, material: { type: "MeshStandardMaterial", isShadowPassMaterial: false },
  object: { id: 3, name: "Test slats", type: "Mesh", isInstancedMesh: true, count: 4, receiveShadow: false },
  getGeometryCacheKey: () => "position,3,uv,2,index," };
const identityBuilder = { material: identityObject.material, vertexShader: "vertex-a", fragmentShader: "fragment-a" };
identityRecorder.build(identityBuilder, identityObject);
identityObject.initialCacheKey = 4; identityRecorder.build(identityBuilder, identityObject);
identityObject.initialCacheKey = 1; identityRecorder.build(identityBuilder, identityObject);
identityRecorder.program({ code: "fragment-a", stage: "fragment" });
identityRecorder.program({ code: "fragment-b", stage: "fragment" });
assert.deepEqual(identityRecorder.state.builds.map(entry => entry.key), [1, 4, 1]);
assert.deepEqual(identityRecorder.state.builds.map(entry => entry.sources), [[1, 2], [1, 2], [1, 2]], "distinct/repeated keys retain identical exact shader IDs");
assert.deepEqual(identityRecorder.state.programs.map(entry => entry.source), [2, 3], "backend programs share the same exact source identity space");
assert.equal(identityRecorder.state.builds[0].instanced, true);
assert.equal(identityRecorder.state.builds[0].geometryKey, identityObject.getGeometryCacheKey(), "record the pinned renderer's full layout discriminator");
identityRecorder.build({ ...identityBuilder, material: { type: "NodeMaterial" } }, identityObject);
assert.equal(identityRecorder.state.builds[3].material, "NodeMaterial", "successful fallback builds report the actual material, not the original request");
assert.equal(identityRecorder.state.builds[3].requestedMaterial, "MeshStandardMaterial");
identityObject.object.name = "changed"; identityBuilder.fragmentShader = "changed";
assert.equal(identityRecorder.state.builds[0].object, "Test slats", "records retain primitives, never live scene objects");
assert.ok(!JSON.stringify(identityRecorder.state).includes("vertex-a"), "shader text is not copied into DOM metrics");
for (let i = 0; i < 600; i++) {
  identityRecorder.build({ material: identityObject.material, vertexShader: `vertex-${i}`, fragmentShader: `fragment-${i}` }, identityObject);
  identityRecorder.program({ code: `other-${i}`, stage: "vertex" });
}
assert.equal(identityRecorder.state.builds.length, 256);
assert.equal(identityRecorder.state.programs.length, 256);
assert.ok(identityRecorder.state.dropped > 0);
identityRecorder.close(); identityRecorder.close();
assert.equal(clearedSources, 512, "bounded source strings are released once capture finishes");
const closedIdentity = JSON.stringify(identityRecorder.state);
identityRecorder.build(identityBuilder, identityObject); identityRecorder.program({ code: "after", stage: "fragment" });
assert.equal(JSON.stringify(identityRecorder.state), closedIdentity, "closed captures cannot retain more sources");
let traceClock = 0;
const startupCalls = {};
const traceMethod = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, startupCalls);
const tracedTarget = { offset: 4, draw(value) { return this.offset + value; } };
traceMethod(tracedTarget, "draw", "test");
for (let i = 0; i < 20; i++) assert.equal(tracedTarget.draw(i), i + 4, "timing preserves receiver, arguments and return values");
assert.equal(startupCalls["test.draw"].calls, 20, "startup totals include calls beyond the old twelve-pipeline sample");
assert.equal(startupCalls["test.draw"].totalMs, 20);
assert.equal(startupCalls["test.draw"].slowest.length, 8, "startup detail retention stays bounded");
const shaderTarget = { object: { name: "Fighter thruster pair" }, material: { type: "MeshBasicMaterial" }, build() { return this.object; } };
traceMethod(shaderTarget, "build", "nodeBuilder");
assert.ok(shaderTarget.build() === shaderTarget.object);
assert.equal(startupCalls["nodeBuilder.build"].calls, 1, "actual shader builds are counted separately from cache lookups");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].object, "Fighter thruster pair");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].material, "MeshBasicMaterial");
for (let i = 0; i < 20; i++) shaderTarget.build();
assert.deepEqual(startupCalls["nodeBuilder.build"].thrusters, { calls: 21, totalMs: 21, maxMs: 1 }, "target aggregate counts every build, not just the top eight");
assert.equal(startupCalls["nodeBuilder.build"].slowest.length, 8);
shaderTarget.object = { name: "Other mesh" }; shaderTarget.build();
assert.equal(startupCalls["nodeBuilder.build"].thrusters.calls, 21, "other objects cannot inflate target attribution");
const expectedFailure = new Error("original failure");
tracedTarget.fail = () => { throw expectedFailure; };
traceMethod(tracedTarget, "fail", "test");
assert.throws(() => tracedTarget.fail(), error => error === expectedFailure, "instrumentation cannot swallow rendering errors");
assert.equal(startupCalls["test.fail"].calls, 1);
const inactiveTrace = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now() { throw new Error("inactive timing"); } }, null);
const inactiveTarget = { draw: value => value };
inactiveTrace(inactiveTarget, "draw", "test");
assert.equal(inactiveTarget.draw(7), 7, "timing stops after the bounded startup capture");
const capturedKinds = [];
const identityHooks = { build: (builder, object) => capturedKinds.push(["build", builder, object]), program: program => capturedKinds.push(["program", program]) };
const identityTrace = new Function("performance", "startupCalls", "startupIdentityRecorder", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, {}, identityHooks);
const identityBuildTarget = { build: () => 7 };
identityTrace(identityBuildTarget, "build", "nodeBuilder", identityObject);
assert.equal(identityBuildTarget.build(), 7);
assert.ok(capturedKinds[0][1] === identityBuildTarget && capturedKinds[0][2] === identityObject);
const identityBackend = { createProgram: program => program, fail() { throw expectedFailure; } };
identityTrace(identityBackend, "createProgram", "backend");
const sourceProgram = { stage: "vertex", code: "source" };
assert.ok(identityBackend.createProgram(sourceProgram) === sourceProgram);
assert.ok(capturedKinds[1][1] === sourceProgram);
identityTrace(identityBackend, "fail", "nodeBuilder", identityObject);
assert.throws(() => identityBackend.fail(), error => error === expectedFailure);
assert.equal(capturedKinds.length, 2, "failed builds never become successful source-identity evidence");
const tracedFrameAt = graphicsFixture.indexOf("    frame(time);");
const finishStartupSource = graphicsFixture.slice(graphicsFixture.lastIndexOf("  try {", tracedFrameAt), graphicsFixture.indexOf("  renderedFrames++;", tracedFrameAt));
const finishStartup = new Function("frame", "startupTrace", "startupIdentityRecorder", `const time=0, now=0, performance={now:()=>1}, game={renderer:{info:{render:{},memory:{}}}}; let startupCalls={}; ${finishStartupSource}; return startupCalls;`);
let startupClosures = 0;
assert.equal(finishStartup(() => {}, [{}, {}], { close: () => startupClosures++ }), null);
assert.equal(startupClosures, 1, "third successful frame releases transient shader-source identities");
assert.throws(() => finishStartup(() => { throw expectedFailure; }, [], { close: () => startupClosures++ }), error => error === expectedFailure);
assert.equal(startupClosures, 2, "render failure releases transient identities without swallowing the original error");
const destroyReviewSource = graphicsFixture.slice(graphicsFixture.indexOf("function destroyReviewCovers("), graphicsFixture.indexOf('select("destroy-cover").onclick'));
for (const all of [false, true]) {
  const items = [{ x: 1, z: 2, baseY: 0, h: 4 }, { x: 2, z: 3, baseY: 1, h: 6 }];
  const reviewWorld = { destructibles: [...items], detachedDestructibleMeshes: [], districtIndexAt: x => x,
    destroy(point, radius, context) {
      assert.equal(radius, .001); assert.equal(context.partId, "qa-cover-only");
      const item = this.destructibles.find(item => item.x === point.x);
      assert.equal(point.y, item.baseY + item.h / 2);
      this.detachedDestructibleMeshes.push(item); this.destructibles.splice(this.destructibles.indexOf(item), 1);
    } };
  const review = new Function("THREE", "game", "select", `let coverDestruction, sceneSerial=2; ${destroyReviewSource}; return {run:destroyReviewCovers,state:()=>coverDestruction};`)(THREE, { world: reviewWorld }, () => ({ value: "cover-shield" }));
  assert.equal(review.run(all), all ? 2 : 1);
  assert.deepEqual(review.state().targets, all ? [[1, 2], [2, 3]] : [[1, 2]]);
  items[0].x = 99; assert.equal(review.state().targets[0][0], 1, "destruction evidence keeps owned numeric positions");
}

for (const [seed, expected] of [
  ["GRAPHICS-QA-structure", ["3fcaf9d84ec4401241287fef3d3288259e9493dd3171fc3d3bd7ccf8cec086ec", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "2c41abb3a5ae6b9dc7230be392ef85426db453f65d008e6d32255b7b30ae66e4"]],
  ["FOUNDRY111-ground", ["8464cd7f25660d46d3c91713d3f67e7a41d2a473a713646b75f8c02a6c5ec38b", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "f10f355514250bf4724da5431b3d72f8e755612343c6c73d9735ce8cf18da9e7"]]
]) {
  const maps = surfaceTextures(seed, 4);
  assert.deepEqual(maps.map(map => createHash("sha256").update(map.image.data).digest("hex")), expected, "matched albedo, normals and packed ORM stay deterministic");
  maps.forEach(map => map.dispose());
}

const coverMaps = surfaceTextures("COVER-TEST", 4, true);
const normalPixel = (x, y) => coverMaps[1].image.data[(y * 256 + x) * 4];
assert.equal(normalPixel(2, 24), 127, "machined plate is flat two texels from a narrow seam, not broadly rounded");
assert.equal(normalPixel(64, 24), 127, "cover has two large plates per axis, not a four-cell upholstered grid");
assert.ok(Math.abs(normalPixel(128, 24) - 127) > 15, "the narrow inter-plate seam remains visibly recessed");
for (const x of [20, 107, 148, 235]) for (const y of [20, 107, 148, 235]) {
  assert.ok(coverMaps[0].image.data[(y * 256 + x) * 4] < 170, "recessed fasteners stay inside the visible cover UV crop");
}
assert.deepEqual(coverMaps.map(map => map.image.width), [256, 256, 256]);
assert.deepEqual(coverMaps.map(map => map.colorSpace), [THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.NoColorSpace]);
coverMaps.forEach(map => map.dispose());

const plate = structuralPanelGeometry();
plate.computeBoundingBox();
assert.deepEqual(plate.boundingBox.min.toArray(), [-.5, -.5, -.5]);
assert.deepEqual(plate.boundingBox.max.toArray(), [.5, .5, .5]);
assert.ok(plate.index.count / 3 <= 108, "macro plates have a fixed small triangle budget");
assert.ok(Math.min(...plate.attributes.color.array) < .4, "frames and inset panels have distinct values");
const pillarPlate = structuralPanelGeometry(.25);
assert.equal(Math.max(...pillarPlate.attributes.uv.array), .25, "pillar service panels use a quarter of the previous repeat cadence");
for (const name of ["position", "normal", "color"]) assert.ok(
  Buffer.from(pillarPlate.attributes[name].array.buffer).equals(Buffer.from(plate.attributes[name].array.buffer)),
  "pillar UV cadence cannot change geometry, normals or frame values");
pillarPlate.dispose();
const route = new THREE.Mesh(structuralRouteGeometry(), new THREE.MeshBasicMaterial());
route.updateMatrixWorld();
const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
assert.equal(ray.intersectObject(route).length, 0, "route lighting leaves the deck material visible through its center");
route.geometry.dispose(); route.material.dispose(); plate.dispose();

const rendererStub = nativeWebGPU => ({
  backend: { isWebGPUBackend: nativeWebGPU }, xr: { enabled: false },
  getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
  getRenderObjectFunction: () => null, getPixelRatio: () => 1, getMRT: () => null,
  getClearColor: target => target.set(0), getClearAlpha: () => 1, getScissorTest: () => false
});
// Inspect the real TSL graph, including the lazy branch's real depth sampler.
for (const alpha of [0, 1]) {
  const previousStack = getCurrentStack(), shaderStack = stack();
  try {
    setCurrentStack(shaderStack);
    const coord = vec2(.5), stored = vec4(.2, .3, .4, alpha);
    const depth = { value: new THREE.DepthTexture(4, 4) }, inverse = uniform(new THREE.Matrix4());
    const sample = recoverInvalidAONormals({ sample(uv) { assert.ok(uv === coord); return stored; } }, depth, inverse);
    const result = sample.sample.shaderNode.jsFunc([coord]);
    const conditions = shaderStack.nodes.filter(node => node.constructor.name === "ConditionalNode");
    assert.equal(conditions.length, 1);
    const condition = conditions[0], operator = condition.condNode.node;
    assert.equal(operator.op, "<");
    assert.equal(operator.bNode.value, .5);
    assert.equal(operator.aNode.components, "w");
    assert.ok(operator.aNode.node.node === stored, "test the stored normal's alpha, not scene opacity");
    assert.equal(result.node.components, "xyz");
    assert.ok(result.node.node === operator.aNode.node, "valid normals keep their exact material RGB");
    assert.equal(condition.elseNode, null);
    const invalidStack = stack(); setCurrentStack(invalidStack);
    condition.ifNode.jsFunc();
    const assign = invalidStack.nodes.find(node => node.isAssignNode);
    assert.ok(assign.targetNode === result);
    assert.ok(assign.sourceNode.node.shaderNode === getNormalFromDepth.shaderNode);
    assert.deepEqual(assign.sourceNode.node.rawInputs, [coord, depth.value, inverse]);
    depth.value.dispose();
  } finally { setCurrentStack(previousStack); }
}
for (const compatibilityMode of [undefined, false, true]) {
  const renderer = rendererStub(true); renderer.backend.compatibilityMode = compatibilityMode;
  renderer.samples = compatibilityMode === true ? 0 : 4;
  const pipeline = new NeonRenderPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(pipeline.aoPass.normalNode === pipeline.scenePass.getTextureNode("normal"), compatibilityMode !== true,
    "only actual compatibility mode installs conditional recovery");
  assert.equal(renderer.samples, compatibilityMode === true ? 0 : 4, "normal recovery cannot change antialiasing");
  assert.equal(pipeline.scenePass.options.samples, undefined, "product leaves sample selection to the renderer");
  pipeline.dispose();
}
for (const nativeWebGPU of [true, false]) for (const quality of ["low", "medium", "high"]) {
  const pipeline = new NeonRenderPipeline(rendererStub(nativeWebGPU), new THREE.Scene(), new THREE.PerspectiveCamera(), { quality });
  assert.equal(Boolean(pipeline.pipeline), quality !== "low" && (!nativeWebGPU || quality === "high"));
  assert.equal(Boolean(pipeline.highLoadPipeline), nativeWebGPU && quality === "medium");
  assert.equal(Boolean(pipeline.aoPass), nativeWebGPU && quality === "high");
  pipeline.setQuality("high");
  if (nativeWebGPU) {
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("normal").blending, THREE.NormalBlending,
      "AO normals must preserve the opaque normal behind non-depth-writing decoration");
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("output").blending, THREE.MaterialBlending,
      "scene color keeps the original per-material blend modes");
    const makeNormal = pipeline.scenePass.getMRT().get("normal").node.shaderNode.jsFunc;
    for (const depthWrite of [true, false]) for (const transparent of [true, false]) for (const opacity of [0, .11, 1]) {
      const normal = makeNormal([], { material: { depthWrite, transparent, opacity } }).node;
      assert.ok(normal.nodes[0] === normalView, "solid surface normal mapping is preserved");
      assert.equal(normal.nodes[1].value, Number(depthWrite), "AO normal coverage follows depth writes, not opacity or color blend mode");
    }
    assert.deepEqual([pipeline.aoPass.resolutionScale, pipeline.aoPass.samples.value, pipeline.aoPass.radius.value,
      pipeline.aoPass.thickness.value, pipeline.aoPass.distanceExponent.value, pipeline.aoPass.distanceFallOff.value],
      [.5, 16, 1.6, 2.2, 1.35, .7], "depth-matched normals do not reduce AO quality");
  }
  const full = pipeline.pipeline;
  pipeline.setQuality("medium");
  const balanced = pipeline.highLoadPipeline;
  for (let i = 0; i < 5; i++) for (const level of ["low", "high", "medium"]) pipeline.setQuality(level);
  assert.ok(pipeline.pipeline === full, "tier toggles reuse the full graph without recompiling it");
  assert.ok(pipeline.highLoadPipeline === balanced, "tier toggles reuse the balanced graph");
  pipeline.dispose(); pipeline.dispose();
  assert.equal(pipeline.pipeline, null);
  assert.equal(pipeline.highLoadPipeline, null);
}

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const ropeMaterialSource = main.slice(main.indexOf("    const ropeMaterial ="), main.indexOf("    const line = new Line2"));
const makeRopeMaterial = new Function("THREE", "materialOpacity", "player", `${ropeMaterialSource}; return ropeMaterial;`);
for (const isBot of [false, true]) {
  const material = makeRopeMaterial(THREE, materialOpacity, { accent: 0x6ff6ff, isBot });
  const observer = new NodeMaterialObserver({ material, object: {}, context: {} });
  // Two already-initialized, otherwise unchanged ropes share a builder monitor.
  // The second must still update bindings when their shared viewport copy resized.
  observer.firstInitialization = () => false;
  observer.getLights = () => [];
  observer.equals = () => true;
  const object = { object: {}, bundle: null }, frame = { renderId: 42, renderer: { getMRT: () => null } };
  assert.equal(observer.needsRefresh(object, frame), true);
  assert.equal(observer.needsRefresh(object, frame), true, "every rope refreshes its viewport-copy binding, including unchanged second ropes");
  assert.ok(material.opacityNode === materialOpacity, "explicit node is the original built-in opacity expression");
  assert.deepEqual([material.opacity, material.linewidth, material.transparent, material.depthWrite, material.toneMapped, material.alphaToCoverage],
    [isBot ? .64 : .92, isBot ? 1.55 : 2.35, true, false, false, true]);
  material.dispose();
}
const frameSource = main.slice(main.indexOf("  frame(time) {"), main.indexOf("  update(dt, realDt = dt) {"));
const firstFrameEvents = [];
const frameMethod = new Function("performance", `return ({${frameSource}}).frame`)({
  mark: name => firstFrameEvents.push(name), measure: name => firstFrameEvents.push(name)
});
const firstFrameState = {
  state: "play", paused: true, hideMatchLoadingAfterFrame: true,
  commitResize() {}, timer: { update() {}, getDelta: () => 1 / 60 },
  input: { tapped: () => false, endFrame() {} }, renderScene: () => false,
  setMatchLoading: value => firstFrameEvents.push(value)
};
frameMethod.call(firstFrameState, 100);
assert.equal(firstFrameState.hideMatchLoadingAfterFrame, true, "a skipped frame cannot dismiss the loader");
assert.equal(firstFrameEvents.length, 0);
firstFrameState.renderScene = () => true;
frameMethod.call(firstFrameState, 116);
assert.deepEqual(firstFrameEvents, ["blaster-arena-first-frame", "blaster-arena-first-render", false]);
frameMethod.call(firstFrameState, 133);
assert.equal(firstFrameEvents.length, 3, "first-render completion is emitted only once per match");
const resize = main.slice(main.indexOf("  commitResize() {"), main.indexOf("  applyGraphicsSettings() {"));
const commitResize = new Function(`return ({${resize}}).commitResize`)();
const submitted = [], renderer = { setDrawingBufferSize: (...args) => submitted.push(args) };
const resizeState = { renderer, pendingResize: { width: 1280, height: 720, pixelRatio: 1.65 } };
commitResize.call(resizeState);
resizeState.pendingResize = { width: 1280, height: 720, pixelRatio: 1.65 };
commitResize.call(resizeState);
assert.equal(submitted.length, 1, "same-size events never recreate framebuffer attachments");
resizeState.pendingResize = { width: 390, height: 844, pixelRatio: 1.3 };
commitResize.call(resizeState);
assert.deepEqual(submitted[1], [390, 844, 1.3]);
const qualityEvents = [];
Object.assign(resizeState, {
  pendingGraphics: true, graphics: graphicsProfile("low"),
  renderer: { ...renderer, getMaxAnisotropy: () => 8 },
  renderPipeline: { setQuality: level => qualityEvents.push(level) },
  world: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  combatVisuals: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  keyLight: { shadow: { mapSize: new THREE.Vector2(4096, 4096), map: { dispose: () => qualityEvents.push("dispose-shadow") } } }
});
commitResize.call(resizeState);
assert.deepEqual(qualityEvents, ["low", "low", "low", "dispose-shadow"]);
assert.equal(resizeState.keyLight.shadow.map, null);
commitResize.call(resizeState);
assert.equal(qualityEvents.length, 4, "graphics resources change only once at the frame boundary");

for (const [level, shadowMapSize, anisotropy] of [["low", 1024, 4], ["medium", 2048, 8], ["high", 4096, 16]]) {
  const profile = graphicsProfile(level, false, 3);
  assert.equal(profile.shadowMapSize, shadowMapSize);
  assert.equal(profile.anisotropy, anisotropy);
  assert.deepEqual(graphicsProfile(level, true, 3), profile, "touch input never silently lowers the selected tier");
  const effects = new CombatVisuals(new THREE.Scene(), { quality: profile.combatQuality });
  effects.setGraphicsProfile(profile);
  assert.equal(effects.rings.length, 128, "all tiers retain enough core impacts for the 112-hit maximum-player volley");
  assert.equal(effects.tracers.length, 128);
  assert.equal(effects.flashes.length, 64);
  const gameplayRandom = Math.random;
  let gameplayRandomCalls = 0;
  Math.random = () => { gameplayRandomCalls++; return .5; };
  try {
    for (const weapon of Object.values(WEAPONS)) {
      effects.impact(new THREE.Vector3(), weapon, { color: 0x129dba, accent: 0x6ff6ff }, { explosive: Boolean(weapon.radius) });
    }
    effects.burst(new THREE.Vector3(), 0x6ff6ff, 16);
    effects.blood(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  } finally { Math.random = gameplayRandom; }
  assert.equal(gameplayRandomCalls, 0, "visual density never consumes gameplay randomness");
  effects.dispose();
}
const scene = new THREE.Scene();
const createOnlineSource = main.slice(main.indexOf("  createOnlineFighter(data, position) {"), main.indexOf("  async startMatch("));
const createOnlineFighter = new Function("Fighter", `return ({${createOnlineSource}}).createOnlineFighter`)(Fighter);
const restoredWeapon = createOnlineFighter.call({ scene, controlsNetworkPlayer: () => true }, {
  id: "cache-online", name: "QA", color: 0x129dba, accent: 0x6ff6ff,
  loadout: ["blaster", "rocket_launcher"], slotIndex: 1, health: 37, ammo: { rocket_launcher: 1 }
}, new THREE.Vector3());
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "authoritative nonzero initial slot restores the corresponding model");
assert.equal(restoredWeapon.health, 37); assert.equal(restoredWeapon.ammo.rocket_launcher, 1);
const reconnectSource = main.slice(main.indexOf("  handleNetworkReconnect(welcome) {"), main.indexOf("  clearTransientNetworkCombat() {"));
const reconnect = new Function("THREE", "uniquePlayersById", `return ({${reconnectSource}}).handleNetworkReconnect`)(THREE, players => players);
restoredWeapon.switchSlot(0);
restoredWeapon.reloadTimer = .7; restoredWeapon.reloadWeaponId = "blaster";
reconnect.call({
  state: "play", world: {}, multiplayer: { playerId: restoredWeapon.id }, players: [restoredWeapon],
  hideNetworkReconnecting() {}, clearTransientNetworkCombat() {}, syncOnlineRoster() {}, updateCamera() {}
}, { players: [{ id: restoredWeapon.id, slotIndex: 1, health: 37, alive: true, ammo: { rocket_launcher: 1 } }] });
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "in-place reconnect restores the authoritative weapon visual");
assert.deepEqual([restoredWeapon.health, restoredWeapon.ammo.rocket_launcher, restoredWeapon.reloadTimer, restoredWeapon.reloadWeaponId], [37, 1, .7, "blaster"]);
restoredWeapon.dispose();
// Matrices/colors are captured from the full-capacity implementation before
// trimming dead draw tails. Stable slots keep transparent blending order intact.
const effectDigests = [];
const effectGroups = [
  ["flashes", "flashOuter", "flashInner"], ["tracers", "tracerOuter", "tracerInner"],
  ["rings", "ringOuter", "ringInner"], ["sparks", "sparkLayer"], ["bloodDecals", "bloodLayer"]
];
for (const quality of [.5, .75, 1]) {
  const effects = new CombatVisuals(new THREE.Scene(), { quality });
  assertCompatibleAONormals(effects.group);
  const digest = createHash("sha256");
  const start = new THREE.Vector3(1, 2, 3), end = new THREE.Vector3(5, 6, 7), normal = new THREE.Vector3(0, 1, 0);
  const owner = { color: 0x129dba, accent: 0x6ff6ff, aim: normal, muzzlePoint: target => target.copy(start) };
  for (let volley = 0; volley < 3; volley++) for (const weapon of Object.values(WEAPONS)) {
    effects.muzzle(owner, weapon); effects.tracer(start, end, weapon, owner);
    effects.impact(end, weapon, owner, { explosive: Boolean(weapon.radius) }); effects.blood(end, normal);
    // Keep this archived draw-tail optimization baseline before Pass68/69's
    // separately tested Blaster fade/spark shape. Preserve its original hashes.
    effects.rings[(effects.cursors.ring - 1) % effects.rings.length].dissipate = false;
    for (const spark of effects.sparks) spark.directional = false;
    for (const dt of [.008, .016, .09, .4]) {
      effects.update(dt);
      for (const [slots, ...names] of effectGroups) {
        const count = effects[slots].findLastIndex(slot => slot.life > 0) + 1;
        for (const name of names) assert.equal(effects[name].count, count, `${name} must retain every live slot through wrap/expiry`);
      }
      for (const [, ...names] of effectGroups) for (const name of names) {
        digest.update(new Uint8Array(effects[name].instanceMatrix.array.buffer));
        digest.update(new Uint8Array(effects[name].instanceColor.array.buffer));
      }
    }
  }
  effectDigests.push(digest.digest("hex"));
  for (const [slots] of effectGroups) {
    const pool = effects[slots];
    pool.forEach(slot => { slot.life = 0; });
    pool[0].life = .05; pool.at(-1).life = .01;
  }
  for (const [dt, bound] of [[.008, "full"], [.008, 1], [.05, 0], [.01, 0]]) {
    effects.update(dt);
    for (const [slots, ...names] of effectGroups) for (const name of names) {
      assert.equal(effects[name].count, bound === "full" ? effects[slots].length : bound, "sparse wrap retains the last slot until it expires, then keeps slot zero");
    }
  }
  effects.dispose();
}
assert.deepEqual(effectDigests, [
  "0210fb48d26f44d6745b45316c6f35b61c952e414de0e9ad78352308ef7279e4",
  "0f54f2d5a66f74c80741732d45bd2164a9ae59df2eb4c67b526163edbe1f5e77",
  "2a4ff06b7d57d1718b4a4ca63c6d3ccd0c8e5703ebe452b7a7fa50bf1fc6deaf"
], "archived pre-refinement effects retain byte-identical transforms and colours at all tiers");
const emptyEffects = new CombatVisuals(new THREE.Scene());
for (const [, ...names] of effectGroups) for (const name of names) assert.equal(emptyEffects[name].count, 0, "countdown frames start with empty draw ranges");
emptyEffects.update(1 / 60);
assert.equal(emptyEffects.ringOuter.count, 0, "an empty impact pool must submit no triangles");
emptyEffects.dispose();
scene.environment = new THREE.Texture();
const lightingEnvironment = scene.environment;
const world = new ArenaWorld(scene, "GRAPHICS-QA");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.geometry)).size, 1, "all eight pads reuse one immutable housing");
assert.equal(world.boostPads[0].mesh.geometry.index.count / 3, 384, "housing triangle cost remains explicitly bounded");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.children[2].material.opacityNode)).size, 1,
  "all plumes must share one shader expression rather than compiling identical per-pad graphs");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.children[2].material.customProgramCacheKey())).size, 1);
assert.deepEqual(world.boostPads.map(pad => [...pad.position.toArray(), pad.strength]), [
  [-18, 0, -18, 24], [18, 0, 18, 24], [-66, 0, 22, 29], [66, 0, -22, 29],
  [-52, 15, -48, 26], [53, 15, 49, 26], [42, 31, -22, 27], [-42, 47, 30, 28]
], "boost artwork preserves all gameplay positions and launch strengths");
for (const pad of world.boostPads) {
  assert.equal(pad.radius, 2.5); assert.equal(pad.mesh.position.y, pad.position.y + .12);
  assert.equal(pad.mesh.material.transparent, false, "boost hardware is opaque, not a translucent light source");
  assert.equal(pad.mesh.material.emissiveIntensity, 0, "the body cannot compete with its inset emitters");
  pad.mesh.geometry.computeBoundingBox();
  const bounds = pad.mesh.geometry.boundingBox;
  assert.ok(Math.abs(bounds.min.y + .11) < 1e-6 && Math.abs(bounds.max.y - .11) < 1e-6);
  assert.ok(Math.abs(bounds.min.x + 2.5) < 1e-6 && Math.abs(bounds.max.x - 2.5) < 1e-6);
  const housingNormals = pad.mesh.geometry.attributes.normal;
  assert.ok(Array.from({ length: housingNormals.count }, (_, i) => Math.abs(housingNormals.getY(i)))
    .some(y => y > .1 && y < .99), "housing has an authored bevel between the flat top and cylindrical side");
  const [ring, arrows, plume] = pad.mesh.children;
  assert.equal(pad.mesh.children.length, 3, "material refinement adds no pad objects or light sources");
  assert.equal(ring.material.opacity, .38); assert.equal(arrows.material.opacity, .42);
  assert.equal(ring.material.blending, THREE.AdditiveBlending);
  assert.equal(plume.geometry.parameters.height, 3.4);
  assert.equal(plume.geometry.parameters.radiusTop, 1.55); assert.equal(plume.geometry.parameters.radiusBottom, 2.15);
  assert.equal(plume.material.depthWrite, false); assert.equal(plume.material.side, THREE.DoubleSide);
  assert.ok(plume.material.opacityNode?.isNode, "plume transparency fades continuously in its actual shader");
  const unwrap = node => node.isVarNode ? node.node : node;
  const opacity = unwrap(plume.material.opacityNode), inverse = unwrap(opacity.aNode), fade = unwrap(inverse.aNode);
  assert.equal(opacity.op, "*"); assert.equal(unwrap(opacity.bNode).value, .055, "lower lift cue keeps its original alpha");
  assert.equal(inverse.method, "oneMinus"); assert.equal(fade.method, "smoothstep");
  assert.equal(unwrap(fade.aNode).value, .5); assert.equal(unwrap(fade.bNode).value, 1);
  const heightUV = unwrap(fade.cNode);
  assert.equal(heightUV.components, "y"); assert.equal(unwrap(heightUV.node).getAttributeName(), "uv");
  const positions = plume.geometry.attributes.position, uvs = plume.geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) assert.equal(uvs.getY(i), positions.getY(i) > 0 ? 1 : 0,
    "actual cylinder UVs place full intensity at the base and zero at the upper rim");
  const pulse = world.pulsers.find(pulse => pulse.object === ring);
  assert.deepEqual([pulse.base, pulse.amplitude, pulse.speed, pulse.phase], [1, .055, 3.8, pad.position.x + pad.position.z]);
}
const triggerPad = world.boostPads[0], trigger = triggerPad.position;
assert.ok(world.boostAt(trigger) === triggerPad);
assert.equal(world.boostAt(trigger.clone().add(new THREE.Vector3(2.5, 0, 0))), undefined);
assert.equal(world.boostAt(trigger.clone().add(new THREE.Vector3(0, .35, 0))), undefined);
assertCompatibleAONormals(world.group);
const coverSource = readFileSync(new URL("../src/world.js", import.meta.url), "utf8");
const legacyLightGeometry = new Function("THREE", "projectSurfaceUVs", `${coverSource.slice(coverSource.indexOf("function coverLightGeometry("), coverSource.indexOf("function segmentCircle("))}; return coverLightGeometry;`)(THREE, projectSurfaceUVs);
const legacyDecorateSource = coverSource.slice(coverSource.indexOf("  decorateBreakable("), coverSource.indexOf("  addBox(", coverSource.indexOf("  decorateBreakable(")))
  .replace(/^\s*if \(inset\) slats = bakeCoverSlats\(slats\);\r?\n/m, "");
const legacyDecorate = new Function("THREE", "coverLightGeometry", `return function ${legacyDecorateSource};`)(THREE, legacyLightGeometry);
const legacyCoverRoots = world.destructibles.map(obstacle => {
  const root = new THREE.Mesh(obstacle.mesh.geometry, obstacle.mesh.material);
  legacyDecorate.call(world, root, obstacle.x, obstacle.z, true); return root;
});
const legacyCoverLights = legacyCoverRoots.map(root => root.children.find(child => child.isInstancedMesh));
const coverLights = world.destructibles.map((obstacle, index) => obstacle.mesh.getObjectByName(legacyCoverLights[index].name));
assert.equal(coverLights.length, 34);
assert.equal(createHash("sha256").update(Buffer.concat(legacyCoverLights.map(mesh => Buffer.from(mesh.instanceMatrix.array.buffer)))).digest("hex"),
  "79e8a017067ce8ec1fed7ae87de457878322758c2d9d4c73c0128e90df5d8849", "symbol instances keep their authored positions, rotations and illuminated scale");
for (const [coverIndex, light] of legacyCoverLights.entries()) {
  const baked = coverLights[coverIndex], { geometry } = baked;
  assert.ok(baked.isMesh && !baked.isInstancedMesh, "opaque cover symbols use one locally baked mesh without object-specific instance bindings");
  assert.equal(geometry.index, null); assert.equal(geometry.attributes.position.count, 240);
  assert.ok(baked.material === light.material && baked.parent === world.destructibles[coverIndex].mesh);
  for (const flag of ["castShadow", "receiveShadow", "renderOrder", "frustumCulled", "visible"]) assert.equal(baked[flag], light[flag]);
  assert.equal(baked.layers.mask, light.layers.mask);
  assert.deepEqual(baked.matrix.toArray(), light.matrix.toArray());
  assert.deepEqual(geometry.boundingSphere, light.boundingSphere, "baked symbols retain the original conservative culling volume");
  const storedMatrix = new THREE.Matrix4(), storedNormal = new THREE.Matrix3(), point = new THREE.Vector3();
  for (let piece = 0; piece < 4; piece++) {
    light.getMatrixAt(piece, storedMatrix); storedNormal.getNormalMatrix(storedMatrix);
    for (let vertex = 0; vertex < light.geometry.attributes.position.count; vertex++) {
      const bakedIndex = piece * 60 + vertex;
      for (const name of ["position", "normal"]) {
        point.fromBufferAttribute(light.geometry.attributes[name], vertex);
        if (name === "position") point.applyMatrix4(storedMatrix); else point.applyNormalMatrix(storedNormal);
        const actual = new THREE.Vector3().fromBufferAttribute(geometry.attributes[name], bakedIndex);
        assert.ok(actual.distanceTo(point) < 3e-7, `${light.name}: stored Float32 transform and ${name} remain within rounding tolerance`);
        if (name === "position") assert.ok(actual.distanceTo(geometry.boundingSphere.center) <= geometry.boundingSphere.radius + 3e-7);
      }
      for (const name of ["uv", "color"]) {
        const before = light.geometry.attributes[name], after = geometry.attributes[name];
        for (let axis = 0; axis < before.itemSize; axis++) assert.equal(after.array[bakedIndex * before.itemSize + axis], before.array[vertex * before.itemSize + axis]);
      }
    }
  }
  const { position, normal, uv1: uv, color } = light.geometry.attributes;
  assert.equal(light.material.emissiveMap.channel, 1, "emission lookup is independent of PBR surface UVs");
  assert.equal((light.geometry.index?.count ?? position.count) / 3, 20, "closed light housing uses ten planar quads within its existing draw");
  assert.equal(light.count, 4);
  assert.equal(light.material.color.getHex(), 0xffffff, "vertex colors separate neutral housing from colored diffuser");
  assert.equal(light.material.emissiveIntensity, .3, "diffuser brightness is unchanged");
  assert.ok(light.material.emissiveMap === world.coverLightMask, "one shared mask keeps the neutral bezel unlit");
  const face = [];
  for (let i = 0; i < position.count; i++) if (uv.getX(i) > .5) {
    face.push(i);
    assert.ok(Math.abs(position.getZ(i) - .488) < 1e-6);
    assert.ok(Math.abs(normal.getZ(i) - 1) < 1e-6);
    assert.ok(Math.abs(Math.abs(position.getX(i)) - .445) < 1e-6 && Math.abs(Math.abs(position.getY(i)) - .445) < 1e-6, "colored face retains its exact old local bounds");
  }
  assert.equal(face.length, 6, "only the inset front diffuser emits light");
  for (let i = 0; i < position.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(color[axis](i), color[axis](i + 5), "bezel and diffuser colors never interpolate across a triangle");
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "light housing corners are planar without diagonal patches");
  }
}
const bakeSource = coverSource.slice(coverSource.indexOf("function bakeCoverSlats("), coverSource.indexOf("// Three owns and reuses"));
const temporaryBakes = new Map();
const actualBake = new Function("THREE", "mergeGeometries", `${bakeSource}; return bakeCoverSlats;`)(THREE, (pieces, groups) => {
  pieces.forEach(piece => { temporaryBakes.set(piece, 0); piece.addEventListener("dispose", () => temporaryBakes.set(piece, temporaryBakes.get(piece) + 1)); });
  return mergeGeometries(pieces, groups);
});
const bakeInput = new THREE.InstancedMesh(legacyCoverLights[0].geometry.clone(), legacyCoverLights[0].material.clone(), 4);
bakeInput.instanceMatrix.copy(legacyCoverLights[0].instanceMatrix); bakeInput.computeBoundingSphere();
let inputGeometryDisposals = 0, instanceDisposals = 0, bakeMaterialDisposals = 0;
bakeInput.geometry.addEventListener("dispose", () => inputGeometryDisposals++);
bakeInput.addEventListener("dispose", () => instanceDisposals++);
bakeInput.material.addEventListener("dispose", () => bakeMaterialDisposals++);
const bakeOutput = actualBake(bakeInput);
assert.equal(temporaryBakes.size, 4); assert.ok([...temporaryBakes.values()].every(count => count === 1));
assert.equal(inputGeometryDisposals, 1); assert.equal(instanceDisposals, 1);
assert.equal(bakeMaterialDisposals, 0, "baking cannot dispose the material still used by the new mesh and other covers");
bakeOutput.geometry.dispose(); bakeOutput.material.dispose();
for (const root of legacyCoverRoots) for (const child of root.children) { child.geometry.dispose(); child.dispose?.(); }
assert.ok(scene.backgroundNode?.isNode, "arena sky has a continuous horizon-to-zenith background");
assert.equal(scene.fog.density, .0044, "sky treatment cannot hide content with extra fog");
assert.ok(scene.environment === lightingEnvironment, "background must not replace the scene lighting environment");
for (const segment of world.structures.flatMap(structure => structure.segments)) {
  const rails = segment.instanceVisuals.filter(visual => visual.mesh.name === "Instanced pillar load rails");
  assert.equal(rails.length, 4, "each destructible module retains its four owned load rails");
  for (const rail of rails) for (const [axis, span] of [["x", segment.w], ["z", segment.d]]) {
    const outer = Math.abs(rail.offset[axis]) + rail.scale[axis] / 2;
    assert.ok(outer > span / 2 + .005, "pillar rails must be visible beyond the opaque body, not buried inside it");
    assert.ok(outer <= span / 2 + .07, "decorative rail clearance remains under seven centimetres; collision envelope is unchanged");
  }
}
const centralDeck = world.platforms.find(platform => platform.x === 0 && platform.z === 0 && platform.top === 15);
assert.equal(centralDeck.mesh.material.color.getHexString(), "162b3b", "walking surfaces keep a neutral slate base");
assert.ok(centralDeck.mesh.material.envMap === scene.environment, "deck reflections share the existing environment texture");
assert.equal(centralDeck.mesh.material.envMapIntensity, .24, "deck reflection tuning actually overrides scene intensity");
assert.ok(world.structuralBatchMeshes.find(mesh => mesh.name === "Instanced destructible platform decks").material.envMap === scene.environment);
for (const texture of world.textures) {
  if (texture === world.coverLightMask) {
    assert.deepEqual(Array.from(texture.image.data), [0, 0, 0, 255, 255, 255, 255, 255]);
    assert.equal(texture.minFilter, THREE.NearestFilter);
    assert.equal(texture.magFilter, THREE.NearestFilter);
    assert.equal(texture.generateMipmaps, false, "constant per-face emission lookup must not average the unlit and lit texels");
    continue;
  }
  assert.ok(texture.generateMipmaps, "procedural filtered textures must generate their mip chain");
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
}
assert.ok(world.panelTexture.image.width >= 256);
assert.equal(world.panelTexture.colorSpace, THREE.SRGBColorSpace);
assert.equal(world.panelNormal.colorSpace, THREE.NoColorSpace);
assert.equal(world.panelRoughness.colorSpace, THREE.NoColorSpace);
for (const level of ["low", "medium", "high", "low", "high"]) {
  world.setGraphicsProfile(graphicsProfile(level), 8);
  assert.equal(world.panelTexture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8));
  for (const texture of world.coverTextures) assert.equal(texture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8), "cover filtering follows every selected tier and device limit");
  assert.equal(world.structures.length, 20, "tier changes never alter structural/collision content");
}
const gripFighter = new Fighter(scene, { id: "grip-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15.01, 8));
const cacheFighter = new Fighter(scene, { id: "cache-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff },
  ["blaster", "minigun", "punch_glove", "fireball", "plasma_cannon"], new THREE.Vector3());
const cachedChildren = [];
for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  cachedChildren[slot] = [...cacheFighter.weaponGroup.children];
}
cacheFighter.switchSlot(0);
assert.ok(cacheFighter.weaponGroup.children[0] === cachedChildren[0][0], "returning to a selected weapon must reuse its existing visual resources");
const cachedResources = new Map();
const recordResource = resource => {
  if (!resource || resource.userData?.sharedFighterGeometry || cachedResources.has(resource)) return;
  cachedResources.set(resource, 0);
  resource.addEventListener("dispose", () => cachedResources.set(resource, cachedResources.get(resource) + 1));
};
for (const root of [cacheFighter.group, ...[...cacheFighter.weaponModels.values()].map(model => model.group)]) root.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
for (let cycle = 0; cycle < 3; cycle++) for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  assert.ok(cacheFighter.weaponGroup.children.every((child, i) => child === cachedChildren[slot][i]));
  assert.equal(cacheFighter.weaponModelId, cacheFighter.loadout[slot]);
  const activeObjects = new Set();
  cacheFighter.group.traverse(object => activeObjects.add(object));
  for (const [id, model] of cacheFighter.weaponModels) if (id !== cacheFighter.weaponModelId) {
    model.group.traverse(object => assert.ok(!activeObjects.has(object), "inactive cached weapons cannot be cloned into decoys"));
  }
}
assert.ok([...cachedResources.values()].every(count => count === 0), "switching never disposes a retained resource");
cacheFighter.loadout[0] = "rocket_launcher";
cacheFighter.switchSlot(0);
assert.equal(cacheFighter.weaponModelId, "rocket_launcher");
assert.equal(cacheFighter.weaponModels.has("blaster"), false, "removed loadout models are evicted");
cacheFighter.weaponGroup.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
cacheFighter.dispose();
assert.ok([...cachedResources.values()].every(count => count === 1), "all original active, inactive and evicted owned resources dispose exactly once");
assert.equal(cacheFighter.weaponModels.size, 0);
for (const id of Object.keys(WEAPONS)) {
  const alternate = id === "blaster" ? "machine_gun" : "blaster";
  const fighter = new Fighter(scene, { id: "cache-parity", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [id, alternate], new THREE.Vector3());
  const model = fighter.weaponModels.get(id), originalChildren = [...fighter.weaponGroup.children];
  const geometryHash = () => {
    const hash = createHash("sha256");
    fighter.weaponGroup.traverse(object => {
      for (const attribute of Object.values(object.geometry?.attributes || {})) hash.update(new Uint8Array(attribute.array.buffer));
    });
    return hash.digest("hex");
  };
  const before = geometryHash();
  fighter.weaponGlowMaterial.emissiveIntensity = 3;
  fighter.weaponSpinner?.rotateZ(.7);
  if (fighter.weaponPiston) fighter.weaponPiston.position.z += .3;
  fighter.switchSlot(1); fighter.switchSlot(0);
  assert.ok(fighter.weaponGroup.children.every((child, i) => child === originalChildren[i]));
  assert.equal(geometryHash(), before, `${id}: cached geometry is byte-identical`);
  assert.deepEqual(fighter.weaponGrip.toArray(), model.grip.toArray());
  assert.deepEqual(fighter.weaponSupportGrip.toArray(), model.supportGrip.toArray());
  assert.equal(fighter.weaponMuzzleDistance, model.state.weaponMuzzleDistance);
  assert.equal(fighter.weaponGlowMaterial.emissiveIntensity, .25);
  if (fighter.weaponSpinner) assert.deepEqual(fighter.weaponSpinner.quaternion.toArray(), model.spinnerRotation.toArray());
  if (fighter.weaponPiston) assert.deepEqual(fighter.weaponPiston.position.toArray(), model.pistonPosition.toArray());
  fighter.health = 37; fighter.ammo[id] = 1; fighter.reloadTimer = .7; fighter.reloadWeaponId = id;
  fighter.updateWeaponModel();
  assert.deepEqual([fighter.health, fighter.ammo[id], fighter.reloadTimer, fighter.reloadWeaponId], [37, 1, .7, id], "visual refresh cannot reset authoritative or weapon state");
  fighter.dispose();
}
const stealingId = "weapon_stealing_projectile";
const stealingFighters = [[stealingId, "blaster", "minigun"], ["blaster", stealingId, "fireball"]].map((loadout, i) =>
  new Fighter(scene, { id: `cache-steal-${i}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, loadout, new THREE.Vector3()));
for (const fighter of stealingFighters) for (let slot = 0; slot < 3; slot++) fighter.switchSlot(slot);
swapStolenWeapon(...stealingFighters, stealingId, 0, 0);
for (const fighter of stealingFighters) {
  for (let slot = 0; slot < 3; slot++) { fighter.slotIndex = slot; fighter.updateWeaponModel(); assert.equal(fighter.weaponModelId, fighter.loadout[slot]); }
  fighter.dispose();
}
for (let frame = 0; frame < 60; frame++) gripFighter.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, world);
gripFighter.group.updateMatrixWorld(true);
const handCenter = gripFighter.rightHand.position.clone().applyMatrix4(gripFighter.rightForearm.matrixWorld);
const gripCenter = new THREE.Vector3(.05, -.2, .11).applyMatrix4(gripFighter.weaponGroup.matrixWorld);
assert.ok(handCenter.distanceTo(gripCenter) < .03, `aiming hand must meet its grip, gap=${handCenter.distanceTo(gripCenter).toFixed(3)}m`);
gripFighter.dispose();
const poseWorld = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
const noMovement = new THREE.Vector3(), poseLook = new THREE.Vector3();
const posedHand = new THREE.Vector3(), posedGrip = new THREE.Vector3();
const wristAxis = new THREE.Vector3(), wristNormal = new THREE.Vector3(), barrelNormal = new THREE.Vector3();
for (const weaponId of ["blaster", "rocket_launcher", "machine_gun"]) for (const release of ["reload", "grapple"]) {
  const fighter = new Fighter(scene, { id: "transition-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  for (let frame = 0; frame < 60; frame++) {
    fighter.reloadTimer = release === "reload" ? 1 : 0;
    fighter.grapple = release === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
  }
  fighter.group.updateMatrixWorld(true);
  const rigInverse = fighter.rig.matrixWorld.clone().invert();
  const previousPalm = fighter.leftHand.position.clone().applyMatrix4(fighter.leftForearm.matrixWorld).applyMatrix4(rigInverse);
  const localPalm = new THREE.Vector3();
  fighter.reloadTimer = 0; fighter.grapple = null;
  for (let frame = 0; frame < 24; frame++) {
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
    fighter.group.updateMatrixWorld(true);
    posedHand.copy(fighter.leftHand.position).applyMatrix4(fighter.leftForearm.matrixWorld);
    // Isolate joint return from the existing grapple-release body roll/movement.
    rigInverse.copy(fighter.rig.matrixWorld).invert();
    localPalm.copy(posedHand).applyMatrix4(rigInverse);
    const jump = localPalm.distanceTo(previousPalm);
    assert.ok(jump < .2, `${weaponId}/${release}/${frame}: support-hand jump ${jump.toFixed(3)}m`);
    previousPalm.copy(localPalm);
  }
  posedGrip.copy(fighter.weaponSupportGrip).applyMatrix4(fighter.weaponGroup.matrixWorld);
  assert.ok(posedHand.distanceTo(posedGrip) < .03, "support hand returns exactly to the grip after its release transition");
  fighter.dispose();
}
for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: "pose-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  for (const pitch of [-.9, 0, .9]) for (const pose of ["aim", "fire", "reload", "grapple"]) {
    poseLook.set(0, Math.sin(pitch), -Math.cos(pitch));
    fighter.grapple = pose === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    for (let frame = 0; frame < 24; frame++) {
      fighter.reloadTimer = pose === "reload" ? 1 : 0;
      fighter.recoilVisual = pose === "fire" ? .9 : 0;
      fighter.attackTimer = pose === "fire" ? weapon.cooldown * .75 : 0;
      fighter.update(1 / 60, noMovement, poseLook, {}, poseWorld);
    }
    fighter.group.updateMatrixWorld(true);
    const hands = [[fighter.rightArm, fighter.rightForearm, fighter.weaponGrip]];
    if (fighter.weaponHasSupportGrip && pose !== "reload" && pose !== "grapple") hands.push([fighter.leftArm, fighter.leftForearm, fighter.weaponSupportGrip]);
    for (const [upper, forearm, grip] of hands) {
      posedHand.copy(forearm.userData.handRest).applyMatrix4(forearm.matrixWorld);
      posedGrip.copy(grip).applyMatrix4(fighter.weaponGroup.matrixWorld);
      const gap = posedHand.distanceTo(posedGrip);
      assert.ok(gap < .04, `${weapon.id}/${pitch}/${pose}: grip gap ${gap.toFixed(3)}m`);
      assert.deepEqual(forearm.position.toArray(), [0, -.44, 0], "joint solve never stretches a limb");
      assert.ok(Math.abs(upper.quaternion.length() - 1) < .000001);
      assert.ok(Math.abs(forearm.quaternion.length() - 1) < .000001);
      wristAxis.copy(forearm.userData.handRest).transformDirection(forearm.matrixWorld);
      wristNormal.set(0, 0, 1).transformDirection(forearm.matrixWorld).projectOnPlane(wristAxis).normalize();
      barrelNormal.set(0, 0, 1).transformDirection(fighter.weaponGroup.matrixWorld).projectOnPlane(wristAxis).normalize();
      assert.ok(wristNormal.dot(barrelNormal) > .998, `${weapon.id}/${pitch}/${pose}: wrist follows the weapon instead of twisting across its grip`);
    }
  }
  fighter.dispose();
}
const outsideSprite = new THREE.Sprite();
for (const batch of world.destructibleBatches) {
  assert.ok(batch.material.map === world.coverTextures[0] && batch.material.normalMap === world.coverTextures[1] && batch.material.roughnessMap === world.coverTextures[2], "cover batches share one dedicated matched surface atlas");
  assert.ok(batch.material.map !== world.panelTexture, "cover tuning cannot alter pillar and deck textures");
  batch.geometry.computeBoundingBox();
  assert.deepEqual(batch.geometry.boundingBox.min.toArray(), [-.5, -.5, -.5]);
  assert.deepEqual(batch.geometry.boundingBox.max.toArray(), [.5, .5, .5]);
  assert.equal(batch.geometry.attributes.position.count / 3, 60, "cover uses four planar mitered rim sections and one panel per face");
  assert.ok(Math.abs(Math.max(...batch.geometry.attributes.uv.array) - .23625) < 1e-6, "infill retains its .25 UV cadence inside the 5.5% frame");
  assert.equal(batch.material.vertexColors, true, "cover perimeter retains its machined dark frame");
  const colors = batch.geometry.attributes.color;
  for (let i = 0; i < colors.count; i += 3) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(colors[axis](i), colors[axis](i + 1));
    assert.equal(colors[axis](i), colors[axis](i + 2), "each face triangle has a crisp frame/infill boundary");
  }
  const uv = batch.geometry.attributes.uv, normal = batch.geometry.attributes.normal;
  for (let i = 0; i < colors.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "each mitered frame quad is planar, without triangular corner patches");
  }
  for (let i = 0; i < colors.count; i += 3) {
    const area = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i));
    assert.ok(Math.abs(area) > 1e-10, "frame sampling keeps a valid tangent basis");
    for (const axis of ["getX", "getY", "getZ"]) {
      assert.equal(normal[axis](i), normal[axis](i + 1));
      assert.equal(normal[axis](i), normal[axis](i + 2), "split frame faces have geometric bevel normals");
    }
  }
}
scene.add(outsideSprite);
let sharedSpriteDisposals = 0;
const onSharedSpriteDispose = () => sharedSpriteDisposals++;
outsideSprite.geometry.addEventListener("dispose", onSharedSpriteDispose);
for (const arena of [world, new ArenaWorld(scene, "RESET-2"), new ArenaWorld(scene, "RESET-3")]) {
  let spriteMaterialsDisposed = 0, ownedGeometryDisposed = 0;
  const boostDisposals = new Map(arena.boostPads.flatMap(pad => [pad.mesh, ...pad.mesh.children])
    .flatMap(mesh => [mesh.geometry, mesh.material]).map(resource => [resource, 0]));
  for (const resource of boostDisposals.keys()) resource.addEventListener("dispose", () => boostDisposals.set(resource, boostDisposals.get(resource) + 1));
  const coverDisposals = new Map([...arena.coverTextures, arena.coverLightMask].map(texture => [texture, 0]));
  for (const texture of coverDisposals.keys()) texture.addEventListener("dispose", () => coverDisposals.set(texture, coverDisposals.get(texture) + 1));
  arena.group.traverse(object => {
    if (object.isSprite) object.material.addEventListener("dispose", () => spriteMaterialsDisposed++);
    else if (object.geometry) object.geometry.addEventListener("dispose", () => ownedGeometryDisposed++);
  });
  const victim = arena.destructibles[0], neighbor = arena.destructibles.at(-1);
  const secondVictim = arena.destructibles.find(item => item !== victim && item !== neighbor && arena.districtIndexAt(item.x, item.z) === arena.districtIndexAt(victim.x, victim.z));
  const removedCases = arena.seed === "RESET-3" ? [] : [victim, secondVictim];
  const detachedResources = new Map();
  for (const removed of removedCases) removed.mesh.traverse(object => {
    for (const resource of [object.geometry, ...[].concat(object.material || [])].filter(Boolean)) detachedResources.set(resource, 0);
  });
  for (const resource of detachedResources.keys()) resource.addEventListener("dispose", () => detachedResources.set(resource, detachedResources.get(resource) + 1));
  for (const removed of removedCases) {
    const point = new THREE.Vector3(removed.x, removed.baseY + removed.h / 2, removed.z), eventId = `cover-disposal-${removed.x}-${removed.z}`;
    arena.destroy(point, .001, { eventId, structuralDamage: .01 });
    arena.destroy(point, .001, { eventId, structuralDamage: .01 });
  }
  for (const removed of removedCases) assert.equal(removed.mesh.parent, null);
  assert.equal(arena.detachedDestructibleMeshes.length, removedCases.length, "duplicate destruction cannot enqueue a detached cover twice");
  assert.ok(neighbor.mesh.parent === arena.group && arena.destructibles.includes(neighbor), "removing one cover cannot remove its neighbor");
  assert.ok([...detachedResources.values()].every(count => count === 0), "shared resources remain valid for surviving covers until world teardown");
  arena.dispose();
  assert.equal(arena.detachedDestructibleMeshes.length, 0, "teardown releases its detached-root references");
  assert.ok([...detachedResources.values()].every(count => count === 1), "destroyed cover buffers and shared materials still dispose exactly once at teardown");
  assert.ok([...boostDisposals.values()].every(count => count === 1), "all boost geometry and materials dispose exactly once, including shared route marks");
  assert.ok([...coverDisposals.values()].every(count => count === 1), "shared cover textures dispose exactly once per arena");
  assert.ok(scene.backgroundNode === arena.previousBackgroundNode, "teardown restores the previous sky expression without disposing Three's owned sky mesh");
  assert.equal(sharedSpriteDisposals, 0, "arena teardown must not destroy Three's shared Sprite quad used by the next arena");
  assert.ok(spriteMaterialsDisposed > 0, "owned sprite materials are still released");
  assert.ok(ownedGeometryDisposed > 0, "owned arena geometry is still released");
  assert.ok(!scene.children.includes(arena.group));
}
outsideSprite.geometry.removeEventListener("dispose", onSharedSpriteDispose);
scene.remove(outsideSprite); outsideSprite.material.dispose();
console.log("Graphics profiles, mip chains, texture color spaces, unchanged structures and all 47 authored weapons passed.");
