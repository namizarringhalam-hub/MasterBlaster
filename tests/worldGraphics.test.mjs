import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";
import { ArenaShadowRig, SHADOW_LAYERS, fitArenaShadow } from "../src/lighting.js";

const world = new ArenaWorld(new THREE.Scene(), "WORLD-GRAPHICS");
assert.equal(world.group.children.filter(object => object.isPointLight).length, 0);
assert.ok(world.ground.material.emissiveNode, "routes and district pools share the floor pass");
assert.ok(!world.group.getObjectByName("District route floor"));
assert.ok(!world.group.children.some(object => object.isGridHelper));
assert.equal(world.panelTexture.image.width, 512);
assert.equal(world.groundTexture.image.width, 512);
assert.equal(world.atmosphere.panorama.image.width, 512);
assert.equal(world.atmosphere.shadowTexture.image.width, 128);
assert.equal(world.batchedDecorSources.length, 10);

const material = world.wallMesh.material, geometry = world.wallMesh.geometry;
let disposals = 0;
material.addEventListener("dispose", () => disposals++);
geometry.addEventListener("dispose", () => disposals++);
for (let run = 0; run < 3; run++) {
  const wall = world.addTemporaryWall(new THREE.Vector3(97, 0, 97), new THREE.Vector3(1, 0, 0), 0x69e7ff, .2);
  assert.equal(world.grappleTarget(new THREE.Vector3(97, 8, 97), new THREE.Vector3(0, -1, 0)).item, wall);
  world.update(.21, []);
  assert.ok(wall.removed);
  assert.equal(world.wallMesh.count, 0);
  assert.equal(world.wallMesh.material, material);
  assert.equal(world.wallMesh.geometry, geometry);
  assert.equal(disposals, 0, "wall expiry retains compiled GPU resources");
}
assert.equal(world.debrisMesh.frustumCulled, false);
assert.equal(world.dustMesh.frustumCulled, false);
world.debrisMesh.computeBoundingSphere = world.dustMesh.computeBoundingSphere = () => { throw new Error("hot bounding scan"); };
world.spawnStructuralDebris(new THREE.Vector3(0, 4, 0), 0x778899);
world.spawnStructuralDust(new THREE.Vector3(0, 4, 0), 0x778899);
world.updateStructuralDebris(.1);

const camera = new THREE.PerspectiveCamera(60, 1, .1, 450);
camera.position.set(0, 10, 0);
const rotor = world.rotors[0].object, before = rotor.rotation.clone();
world.update(.05, []); world.update(.05, []);
assert.ok(rotor.rotation.equals(before), "catch-up steps do not pose decorative machinery");
world.updatePresentation(camera, false, .1);
assert.ok(!rotor.rotation.equals(before));
const after = rotor.rotation.clone(); world.updatePresentation(camera, true, .1);
assert.ok(rotor.rotation.equals(after));
assert.equal(world.atmosphere.lightning.value, 0);

const key = new THREE.DirectionalLight(); key.position.set(-22, 40, 18);
const shadowRig = new ArenaShadowRig(key, { mapSize: 1024 });
shadowRig._init({ camera, renderer: { coordinateSystem: THREE.WebGPUCoordinateSystem, reversedDepthBuffer: false } });
shadowRig.registerWorld(world.group);
const rig = new THREE.Group(), armor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
const proxy = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false }));
proxy.name = "Fighter shadow proxy"; rig.add(armor, proxy); shadowRig.registerFighter(rig);
const [near, far] = shadowRig.lights.map(light => light.shadow.camera);
assert.ok(near.layers.test(armor.layers)); assert.ok(!near.layers.test(proxy.layers));
assert.ok(far.layers.test(proxy.layers)); assert.ok(!far.layers.test(armor.layers));
assert.ok(!camera.layers.test(proxy.layers), "proxy cannot contaminate color, depth or velocity");
assert.ok(near.layers.test(world.ground.layers) && far.layers.test(world.ground.layers));
assert.equal(proxy.layers.mask, 1 << SHADOW_LAYERS.fighterProxy);
const retainedMap = shadowRig.lights[0].shadow.map = new THREE.RenderTarget(16, 16);
shadowRig.setMapSize(512);
assert.equal(shadowRig.lights[0].shadow.map, retainedMap, "profile resize retains the ShadowNode-owned target reference");
assert.equal(shadowRig.lights[0].shadow.mapSize.x, 512);
retainedMap.dispose(); shadowRig.lights[0].shadow.map = null;
shadowRig.update(camera); shadowRig.dispose();

// Fit the former whole-arena light first, as match startup does. Those depth
// planes cannot be inherited by a camera-relative cascade.
const shadowScene = new THREE.Scene(), headingCamera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 800);
const headingLight = new THREE.DirectionalLight(); headingLight.position.set(-22, 40, 18);
shadowScene.add(headingLight, headingLight.target); fitArenaShadow(headingLight, { size: 112, height: 78 });
const headingRig = new ArenaShadowRig(headingLight);
headingRig._init({ camera: headingCamera, renderer: { coordinateSystem: THREE.WebGPUCoordinateSystem, reversedDepthBuffer: false } });
for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  headingCamera.position.set(0, 5, 10);
  const direction = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  headingCamera.lookAt(headingCamera.position.clone().add(direction)); headingCamera.updateMatrixWorld(true);
  headingRig.update(headingCamera); headingRig.updateBefore();
  for (const light of headingRig.lights) light.shadow.updateMatrices(light);
  for (const distance of [1, 5, 20, 45, 46, 60, 150, 320]) {
    const receiver = headingCamera.position.clone().addScaledVector(direction, distance);
    const cascade = headingRig.lights[distance < 46 ? 0 : 1].shadow;
    const sample = receiver.applyMatrix4(cascade.matrix);
    assert.ok(sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1 && sample.z >= 0 && sample.z <= 1,
      `heading ${heading}, receiver ${distance}m must be covered by its cascade: ${sample.toArray()}`);
  }
}
headingRig.dispose();
armor.geometry.dispose(); armor.material.dispose(); proxy.geometry.dispose(); proxy.material.dispose();

// Exercise the pinned renderer's real shader generators for every added layer.
for (const webgl of [false, true]) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: webgl, canvas: { width: 64, height: 64, style: {}, addEventListener() {}, removeEventListener() {} } });
  renderer.backend.capabilities ??= {}; renderer.backend.renderer = renderer;
  renderer.backend.capabilities.getUniformBufferLimit = () => 16384;
  renderer.hasFeature = renderer.hasCompatibility = () => false;
  if (webgl) renderer.backend.extensions = { has: () => false };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicNodeMaterial());
  sky.material.colorNode = world.scene.backgroundNode;
  for (const mesh of [sky, world.ground, world.wallMesh, ...Object.values(world.cityLife), ...world.group.children.filter(object => object.name === "Batched static route decoration")]) {
    const builder = new (webgl ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder)(mesh, renderer);
    builder.scene = world.scene; builder.camera = camera; builder.build();
    assert.doesNotMatch(builder.fragmentShader + builder.vertexShader, /undefined|NaN/);
    assert.ok(builder.fragmentShader.length > 100 && builder.vertexShader.length > 100);
    if (mesh === sky) assert.doesNotMatch(builder.fragmentShader, /mx_noise|for\s*\(/, "sky samples cached integrated radiance rather than a per-fragment volume march");
  }
  sky.geometry.dispose(); sky.material.dispose();
}
world.dispose();
assert.equal(disposals, 2, "pool resources are released once at arena disposal");
console.log("World pooling, integrated floor/sky, render-only machinery, layer-safe cascades and WGSL/GLSL city shaders passed.");
