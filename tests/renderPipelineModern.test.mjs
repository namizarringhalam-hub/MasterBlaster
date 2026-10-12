import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { NeonRenderPipeline } from '../src/renderPipeline.js';
import { SoftParticleDepth } from '../src/softParticles.js';
import { localFog } from '../src/localFog.js';
import { ArenaShadowRig, fitArenaShadow } from '../src/lighting.js';
import { texture } from 'three/tsl';
import { CinematicPresentation, createNeonGrade } from '../src/cinematicPresentation.js';
import { GRAPHICS_PRESETS, migrateLegacyGraphicsPreset, normalizeGraphicsOptions, presetEffects } from '../src/graphicsPresets.js';

assert.equal(GRAPHICS_PRESETS.ultra.msaaSamples, 0);
assert.equal(presetEffects('low').bloom, true);
assert.equal(presetEffects('medium').reflections, true);
assert.equal(GRAPHICS_PRESETS.medium.ssrScale, .25);
assert.deepEqual(normalizeGraphicsOptions({ ...GRAPHICS_PRESETS.high, msaaSamples: 4, renderScale: .65, bloomScale: .25 }, 'high'),
  { ...GRAPHICS_PRESETS.high, msaaSamples: 0, renderScale: .65, bloomScale: .25 }, 'temporal AA replaces MSAA while every other custom option survives');
const savedMediumV2 = {
  graphicsVersion: 2, graphics: 'medium', motionBlur: 0,
  graphicsOptions: { renderScale: .65, msaaSamples: 0, shadowMapSize: 1024, aoSamples: 16, ssrScale: .5,
    bloomScale: .34, combatQuality: .75, combatLights: 2, detailDistance: 72, atmosphereCount: 150, anisotropy: 8 },
  graphicsEffects: { antialiasing: true, bloom: true, reflections: false, ambientOcclusion: false,
    contactShadows: false, localFog: false, softParticles: false, heatDistortion: false, motionBlur: false,
    environmentMotion: true, mechaMotion: true, weaponMotion: true, wetSurfaces: true, waterCaustics: true,
    clouds: true, horizonMist: true, atmosphericMotes: true, distanceHaze: true, impactMarks: true }
};
const migrated = migrateLegacyGraphicsPreset(structuredClone(savedMediumV2), savedMediumV2);
assert.equal(migrated.graphicsVersion, 3);
assert.equal(migrated.graphicsOptions.ssrScale, .25);
assert.equal(migrated.graphicsEffects.reflections, true);
for (const alter of [saved => { saved.graphicsOptions.renderScale = .75; },
  saved => { saved.graphicsEffects.bloom = false; }, saved => { saved.motionBlur = 17; }]) {
  const custom = structuredClone(savedMediumV2); alter(custom);
  assert.deepEqual(migrateLegacyGraphicsPreset(structuredClone(custom), custom), custom, 'every explicit custom value survives');
}
for (const msaaSamples of [0, 4]) {
  const custom = structuredClone(savedMediumV2);
  custom.graphicsOptions.msaaSamples = msaaSamples;
  custom.graphicsEffects.antialiasing = false;
  custom.graphicsEffects.bloom = false;
  custom.motionBlur = 17;
  const expected = structuredClone(custom);
  expected.graphicsOptions.msaaSamples = 0;
  expected.graphicsEffects.antialiasing = msaaSamples === 4;
  const normalized = structuredClone(custom);
  normalized.graphicsOptions = normalizeGraphicsOptions(custom.graphicsOptions, custom.graphics);
  assert.deepEqual(migrateLegacyGraphicsPreset(normalized, custom), expected,
    'legacy MSAA intent becomes reconstruction AA while explicitly disabled AA and all other custom settings survive');
}
const grade = createNeonGrade();
assert.deepEqual([...grade.image.data.slice(0, 4)], [0, 0, 0, 255]);
assert.deepEqual([...grade.image.data.slice(-4)], [255, 255, 255, 255]);
grade.dispose();
const presentation = new CinematicPresentation();
presentation.update({ motion: 2, damage: -.5, impact: .5, time: 4 });
assert.equal(presentation.motion.value, 1);
assert.equal(presentation.damage.value, 0);
assert.equal(presentation.impact.value, .5);
presentation.update({ motion: 1, damage: .7, impact: 1 }, true);
assert.equal(presentation.motion.value, 0);
assert.equal(presentation.damage.value, .7);
assert.equal(presentation.impact.value, 0);
presentation.update({ motion: 1, damage: 1, impact: 1, active: false });
assert.equal(presentation.damage.value, 0);
presentation.dispose();

const copied = new SoftParticleDepth();
let copies = 0, inits = 0;
const source = new THREE.DepthTexture(320, 180);
const copyRenderer = {
  initRenderTarget: () => inits++,
  copyTextureToTexture: (src, dst) => {
    assert.equal(src, source); assert.equal(dst, copied.target.depthTexture); copies++;
  }
};
copied.copy(copyRenderer, source);
copied.copy(copyRenderer, source);
assert.equal(inits, 1); assert.equal(copies, 2);
assert.equal(copied.frames, 2);
assert.equal(copied.target.width, 320);
assert.equal(copied.material, undefined, 'depth copy owns no override material or opaque prepass');
copied.dispose();

// Exercise the same world-fit -> camera-relative CSM transition as match
// startup. A populated distant map is insufficient: every fog sample must be
// inside its selected map's actual projection, including wide-screen rays.
const fogCamera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 800);
fogCamera.position.set(0, 5, 10); fogCamera.lookAt(0, 5, 11); fogCamera.updateMatrixWorld(true);
const fogScene = new THREE.Scene(), fogLight = new THREE.DirectionalLight();
fogLight.position.set(-22, 40, 18); fogScene.add(fogLight, fogLight.target);
fitArenaShadow(fogLight, { size: 112, height: 78 });
const shadowRig = new ArenaShadowRig(fogLight);
shadowRig._init({ camera: fogCamera, renderer: { coordinateSystem: THREE.WebGPUCoordinateSystem, reversedDepthBuffer: false } });
for (const light of shadowRig.lights) light.shadow.map = new THREE.RenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
const fogDepth = new THREE.DepthTexture(4, 4), fog = localFog(texture(fogDepth), fogCamera, fogLight);
// Follow the real cold graph ordering: map nodes can run immediately after
// _init, before the first application update or CSM node callback.
for (const light of shadowRig.lights) light.shadow.updateMatrices(light);
fog.update();
for (const distance of [1, 20, 45, 60, 64]) {
  const receiver = fogCamera.position.clone().add(new THREE.Vector3(0, 0, distance));
  receiver.applyMatrix4(fog.shadowBindings[distance <= 46 ? 0 : 1].matrix.value);
  assert.ok(receiver.toArray().every(value => value > 0 && value < 1), 'cold first CSM maps cover fog before any subsequent update');
}
for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  fogCamera.position.set(0, 5, 10);
  fogCamera.lookAt(fogCamera.position.clone().add(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))));
  fogCamera.updateMatrixWorld(true); shadowRig.update(fogCamera); shadowRig.updateBefore();
  for (const light of shadowRig.lights) light.shadow.updateMatrices(light);
  fog.update();
  assert.equal(fog.cascadeSplit.value, 46);
  for (const [index, binding] of fog.shadowBindings.entries()) {
    assert.equal(binding.texture.value, shadowRig.lights[index].shadow.map.depthTexture);
    assert.ok(binding.matrix.value.equals(shadowRig.lights[index].shadow.matrix));
  }
  for (const [x, y] of [[0, 0], [-.9, -.9], [.9, -.9], [-.9, .9], [.9, .9]]) {
    const ray = new THREE.Vector3(x, y, .5).unproject(fogCamera).sub(fogCamera.position).normalize();
    for (const distance of [1, 5, 20, 45, 46, 60, 64]) {
      const point = fogCamera.position.clone().addScaledVector(ray, distance);
      const viewDepth = -point.clone().applyMatrix4(fogCamera.matrixWorldInverse).z;
      const selected = viewDepth <= fog.cascadeSplit.value ? 0 : 1;
      const projected = point.applyMatrix4(fog.shadowBindings[selected].matrix.value);
      assert.ok(projected.toArray().every(value => value > 0 && value < 1),
        `fog receiver heading=${heading} ndc=${x},${y} distance=${distance} must lie inside cascade ${selected}: ${projected.toArray()}`);
    }
  }
}
fog.dispose(); fogDepth.dispose(); shadowRig.dispose();

for (const webgl of [false, true]) for (const quality of ['low', 'medium', 'high', 'ultra']) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: webgl,
    canvas: { width: 64, height: 64, style: {}, addEventListener() {}, removeEventListener() {} } });
  renderer.backend.capabilities ??= {};
  renderer.backend.renderer = renderer;
  renderer.backend.capabilities.getUniformBufferLimit = () => 16384;
  renderer.hasFeature = renderer.hasCompatibility = () => false;
  if (webgl) renderer.backend.extensions = { has: () => false };
  renderer.toneMapping = THREE.AgXToneMapping;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const key = new THREE.DirectionalLight();
  key.position.set(10, 20, 10); key.castShadow = true;
  key.shadow.map = new THREE.RenderTarget(4, 4, { depthTexture: new THREE.DepthTexture(4, 4) });
  scene.add(key);
  const pipeline = new NeonRenderPipeline(renderer, scene, camera, { quality });
  const pass = pipeline.scenePass;
  assert.equal(pass.getResolutionScale(), GRAPHICS_PRESETS[quality].renderScale);
  assert.equal(pass.options.samples, 0);
  if (!webgl && ['high', 'ultra'].includes(quality)) {
    assert.deepEqual(pass.renderTarget.textures.map(t => [t.name, t.type, t.format]), [
      ['output', THREE.HalfFloatType, THREE.RGBAFormat],
      ['bloom', THREE.HalfFloatType, THREE.RGBAFormat],
      ['normal', THREE.UnsignedByteType, THREE.RGBAFormat],
      ['velocity', THREE.HalfFloatType, THREE.RGBAFormat]
    ]);
    assert.equal(pass.renderTarget.textures.length, 4, 'full graph stays within the portable WebGPU attachment budget');
    assert.ok(pipeline.particleDepth);
    assert.equal(pipeline.particleDepth.material, undefined);
    assert.equal(pipeline.localFog.low.getResolutionScale(), GRAPHICS_PRESETS[quality].renderScale * .5);
  }
  assert.equal(Boolean(pipeline.temporal), !webgl && quality !== 'low');
  if (quality === 'low') assert.ok(pipeline.spatial);
  const build = (material, target = null, mrt = null, instanced = false) => {
    renderer.setRenderTarget(target); renderer.setMRT(mrt);
    const mesh = instanced ? new THREE.InstancedMesh(new THREE.BoxGeometry(), material, 16)
      : new THREE.Mesh(new THREE.BoxGeometry(), material);
    const builder = new (webgl ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder)(mesh, renderer);
    if (instanced) assert.equal(builder.needsPreviousData(), false, 'transparent particles allocate no unused previous-instance data');
    builder.scene = scene; builder.camera = camera; builder.build();
    assert.doesNotMatch(builder.fragmentShader + builder.vertexShader, /undefined|NaN/);
    mesh.geometry.dispose();
    return builder;
  };
  const material = new THREE.MeshStandardNodeMaterial();
  material.emissiveIntensity = 2;
  build(material, pass.renderTarget, pass.getMRT()); material.dispose();
  if (pass.transparentMRT) {
    const smoke = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const velocityTexture = pass.renderTarget.textures.find(texture => texture.name === 'velocity');
    if (velocityTexture) velocityTexture.name = 'preservedVelocity';
    const builder = build(smoke, pass.renderTarget, pass.transparentMRT, true);
    assert.doesNotMatch(builder.vertexShader, /previousInstance/);
    if (velocityTexture) velocityTexture.name = 'velocity';
    smoke.dispose();
  }
  const post = new THREE.NodeMaterial();
  post.fragmentNode = pipeline.pipeline.outputNode; build(post);
  for (const target of pipeline.outputTargets) { post.fragmentNode = target.node; build(post); }
  if (pipeline.localFog) { post.fragmentNode = pipeline.localFog.low.node; build(post); }
  for (const owner of [pipeline.temporal, pipeline.spatial, pipeline.reflectionPass, pipeline.aoPass, pipeline.bloomPass]) {
    if (!owner) continue;
    // These are produced during setup by the real r185 nodes, not stand-ins.
    for (const value of Object.values(owner)) if (value?.isNodeMaterial && value.fragmentNode) build(value);
  }
  const owned = [pipeline.presentation.grade, pipeline.temporal?._historyRenderTarget,
    pipeline.temporal?._resolveRenderTarget, pipeline.temporal?._previousDepthRenderTarget,
    pipeline.temporal?._resolveMaterial, pipeline.temporal?._seedMaterial,
    pipeline.spatial?._easuRT, pipeline.spatial?._rcasRT, pipeline.localFog?.low.renderTarget,
    pipeline.localFog?.low._quadMesh.material,
    ...pipeline.outputTargets.flatMap(target => [target.renderTarget, target._quadMesh.material]),
    pipeline.pipeline?._quadMesh?.material].filter(Boolean);
  const disposalCounts = new Map(owned.map(resource => [resource, 0]));
  for (const resource of owned) resource.addEventListener('dispose', () => disposalCounts.set(resource, disposalCounts.get(resource) + 1));
  pipeline.resetHistory();
  assert.equal(pipeline.temporalWeight.value, 1);
  assert.ok([...disposalCounts.values()].every(count => count === 0), 'camera cuts reset history without allocating native-size targets');
  post.dispose(); key.shadow.map.dispose(); pipeline.dispose(); pipeline.dispose();
  for (const [resource, count] of disposalCounts) assert.equal(count, 1,
    `${resource.name || resource.constructor.name} owned resource ${owned.indexOf(resource)} disposes exactly once`);
  assert.equal(pipeline.temporal, null); assert.equal(pipeline.spatial, null); assert.equal(pipeline.presentation, null);
  pipeline.updatePresentation({motion: 1});
}
console.log('Modern pipeline: all presets, packed MRT, native TAAU/spatial output, fog, LUT, presentation and real WGSL/GLSL generation passed.');
