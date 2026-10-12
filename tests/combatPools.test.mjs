import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { texture, uv, vec4 } from "three/tsl";
import { CombatVisuals } from "../src/combatVisuals.js";
import { WEAPONS, graphicsProfile, weaponFireMode } from "../src/gameData.js";
import { createGrappleVisual, updateGrappleVisual, disposeGrappleVisual } from "../src/grappleRope.js";
import { HeatDistortion } from "../src/heatDistortion.js";

const scene = new THREE.Scene(), effects = new CombatVisuals(scene), camera = new THREE.PerspectiveCamera();
camera.position.set(4, 6, 9); camera.lookAt(0, 0, 0);
const owner = { accent: 0x3dffcb, color: 0xff00aa };
const resources = root => {
  const ids = [];
  root.traverse(object => { if (object.geometry) ids.push(object.uuid, object.geometry.uuid, object.material.uuid); });
  return ids;
};
const baseline = resources(effects.group);
const shots = [];
for (const weapon of Object.values(WEAPONS).filter(weapon =>
  ["projectile", "spread", "mine"].includes(weaponFireMode(weapon)) && weapon.presentationPayload !== "fireball")) {
  const mesh = effects.createProjectile(owner, weapon, weapon.projectileRadius || .2, { mine: weapon.type === "mine" });
  scene.add(mesh); mesh.position.set(3, 2, 1);
  const shot = { mesh, velocity: new THREE.Vector3(3, 1, 2) }; effects.updateProjectile(shot, 1 / 60); shots.push(shot);
}
const bomblet = { ...WEAPONS.cluster_grenade, id: "cluster_grenade_bomblet", type: "grenade", split: 0 };
const child = effects.createProjectile(owner, bomblet, .16); scene.add(child); shots.push({ mesh: child });
effects.syncPresentation(camera);
assert.deepEqual(resources(effects.group), baseline, "every weapon and cluster child uses the prewarmed GPU objects");
assert.ok(shots.every(shot => !shot.mesh.children.length), "gameplay anchors never own disposable render meshes");
const layers = [...effects.projectileBatches.templates.values()].flatMap(template => template.layers);
assert.ok(layers.filter(layer => layer.count > 0).every(layer => layer.mesh.count === layer.count));
for (const shot of shots) effects.removeProjectile(shot);
effects.syncPresentation(camera);
assert.ok(layers.every(layer => layer.mesh.count === 0));
assert.deepEqual(resources(effects.group), baseline, "projectile expiry cannot invalidate warmed graphs");

const hazards = [];
for (let i = 0; i < 24; i++) { const hazard = effects.createHazard(WEAPONS.napalm_launcher); scene.add(hazard.mesh); hazards.push(hazard); }
effects.syncPresentation(camera);
const napalm = effects.hazardPool.templates.get("napalm");
assert.equal(napalm.layers.find(layer => layer.flames).mesh.count, 216);
const flameId = napalm.layers.find(layer => layer.flames).mesh.uuid;
for (const hazard of hazards) hazard.mesh.userData.releaseVisual();
effects.syncPresentation(camera);
assert.ok(napalm.layers.every(layer => layer.mesh.count === 0));
for (let i = 0; i < 100; i++) { const hazard = effects.createHazard(WEAPONS.napalm_launcher); hazard.mesh.userData.releaseVisual(); }
assert.equal(napalm.layers.find(layer => layer.flames).mesh.uuid, flameId, "napalm reuses one instancing cache identity after quiet periods");

for (const level of ["low", "medium", "high"]) {
  const profile = graphicsProfile(level); effects.setGraphicsProfile(profile);
  assert.equal(effects.combatLightGroup.children.length, profile.combatLights * 2, "preset removes unused light slots from scene traversal");
}
const rope = createGrappleVisual(owner); scene.add(rope.line);
assert.equal(rope.line.material.transparent, false, "Line2 cannot select the viewport-copy shader");
updateGrappleVisual(rope.line, [new THREE.Vector3(), new THREE.Vector3(0, 2, 5)], camera, { slack: 3, dt: .016 });
assert.equal(rope.line.geometry.instanceCount, 4);
assert.equal(rope.line.userData.grappleVisual.halo.geometry.drawRange.count, 24);
const ropeResources = resources(rope.line);
rope.line.userData.releaseVisual();
updateGrappleVisual(rope.line, [new THREE.Vector3(1, 0, 0), new THREE.Vector3(3, 2, 5)], camera, { dt: .016 });
assert.deepEqual(resources(rope.line), ropeResources);
assert.ok(rope.line.visible);

effects.impact(new THREE.Vector3(), WEAPONS.rocket_launcher, owner, { explosive: true });
effects.update(1 / 120); effects.syncPresentation(camera);
const [fire, smoke, shock] = effects.explosions.layers;
assert.equal(fire.mesh.geometry.type, "PlaneGeometry");
assert.equal(smoke.mesh.material.isMeshBasicNodeMaterial, true, "smoke does not evaluate PBR light loops");
assert.equal(smoke.mesh.receiveShadow, false);
assert.equal(shock.mesh.geometry.type, "RingGeometry");
assert.ok(fire.particles.some(p => p.mode === "flash" && p.maxLife <= 1 / 30));
const ageBefore = fire.particles.find(p => p.life > 0).life;
effects.syncPresentation(camera); effects.syncPresentation(camera);
assert.equal(fire.particles.find(p => p.life > 0).life, ageBefore, "interpolated draw sync cannot advance simulation-age effects");
const heat = new HeatDistortion(texture(new THREE.DepthTexture(64, 64)), camera);
heat.update(scene, camera); assert.ok(heat.active.value > 0 && heat.active.value <= 8);
effects.update(5); heat.update(scene, camera); assert.equal(heat.active.value, 0);
effects.flameStream(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), WEAPONS.flamethrower, owner, 4);
heat.update(scene, camera); assert.ok(heat.parameters.some(parameter => parameter.w < 0), "flame plume receives heat haze without a shock ring");
heat.update(scene, camera, true); assert.equal(heat.active.value, 0, "reduced motion disables all distortion");
const heatMaterial = new THREE.NodeMaterial(); heatMaterial.fragmentNode = vec4(heat.node(uv()), 0, 1);
const heatQuad = new THREE.Mesh(new THREE.PlaneGeometry(), heatMaterial);

// Actual pinned WGSL and GLSL node builders: verify the new shader graphs and
// ensure opaque rope has no screen capture dependency on either backend.
for (const webgl of [false, true]) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: webgl,
    canvas: { width: 64, height: 64, style: {}, addEventListener() {}, removeEventListener() {} } });
  renderer.backend.capabilities ??= {}; renderer.backend.renderer = renderer;
  renderer.backend.capabilities.getUniformBufferLimit = () => 16384;
  renderer.hasFeature = renderer.hasCompatibility = () => false;
  if (webgl) renderer.backend.extensions = { has: () => false };
  for (const mesh of [effects.flashOuter, effects.tracerInner, effects.flameLayer, fire.mesh, smoke.mesh, shock.mesh,
    napalm.layers.find(layer => layer.flames).mesh, layers[0].mesh, rope.line, rope.line.userData.grappleVisual.halo, heatQuad]) {
    const builder = new (webgl ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder)(mesh, renderer);
    builder.scene = scene; builder.camera = camera; builder.build();
    assert.doesNotMatch(builder.fragmentShader, /undefined|NaN/);
    assert.ok(builder.fragmentShader.length > 100);
    if (mesh === rope.line) assert.doesNotMatch(builder.fragmentShader, /textureSample|textureLod|texture2D/);
  }
}
disposeGrappleVisual(rope); effects.dispose();
heatQuad.geometry.dispose(); heatMaterial.dispose();
console.log("Stable projectile/hazard/rope GPU ownership, active preset light rigs, billboard fire/smoke and WGSL/GLSL passed.");
