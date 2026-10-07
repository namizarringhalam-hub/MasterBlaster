import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three/webgpu";
import { CombatVisuals } from "../src/combatVisuals.js";
import { WEAPONS } from "../src/gameData.js";
import WebGPUAttributeUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js";
import WebGLAttributeUtils from "../node_modules/three/src/renderers/webgl-fallback/utils/WebGLAttributeUtils.js";

const combatLayers = effects => [effects.flashOuter, effects.flashInner, effects.tracerOuter, effects.tracerInner,
  effects.ringOuter, effects.ringInner, effects.surfaceFront, effects.surfaceCore, effects.sparkLayer, effects.bloodLayer,
  ...effects.fireballLayerList];
const attributes = mesh => [mesh.instanceMatrix, mesh.instanceColor,
  mesh.geometry.getAttribute("particleAlpha"), mesh.geometry.getAttribute("particlePhase")].filter(Boolean);
const layers = effects => [...combatLayers(effects), ...effects.explosions.layers.map(layer => layer.mesh)];
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const point = new THREE.Vector3(2, 3, -4), end = new THREE.Vector3(7, 5, 8), normal = new THREE.Vector3(0, 1, 0);
const owner = { color: 0x42adff, accent: 0xf53f71, aim: end.clone().sub(point).normalize(),
  forwardPoint: () => point.clone() };

// Captured before the upload-only change: all 47 weapons, three volleys, every
// buffer including hidden slots, stable draw counts, three tiers and both motion modes.
const expected = {
  "0.5:false": "ab1aec2876cd0c25f82d589957d94ed1e7e63991d5040d7fb1051d8925ad00be",
  "0.5:true": "2ed4a171e118bce5a3081ed9975247d195a4bebc1627f13a1087096cbae54143",
  "0.75:false": "091db5c3414167b2ce3849102e039754c05bf2d7ff78120679a8379b3433c6c6",
  "0.75:true": "bc3006ebb6629de7f7fc6bb9d1b335bd3e64bd44af98efc0f35730f36d741c15",
  "1:false": "2a7d0da324287c70e5cce8666d1b598a25ac2c54a045a04de0f687728cfe6e2f",
  "1:true": "7c2c4555f644aaccd30b8c9fb76464eefa4affa333d96b6e3d99eee68320e45a"
};
for (const quality of [.5, .75, 1]) for (const reducedMotion of [false, true]) {
  const effects = new CombatVisuals(new THREE.Scene(), { quality, reducedMotion });
  const hash = createHash("sha256");
  for (let volley = 0; volley < 3; volley++) {
    for (const weapon of Object.values(WEAPONS)) {
      effects.muzzle(owner, weapon);
      effects.tracer(point, end, weapon, owner);
      effects.impact(end, weapon, owner, { normal, explosive: Boolean(weapon.radius), size: 1.5, ground: true });
      effects.blood(point, normal);
      if (weapon.presentationPayload === "fireball") {
        const anchor = effects.createProjectile(owner, weapon, weapon.radius || .11);
        anchor.position.copy(point); anchor.userData.projectileVelocity = owner.aim.clone();
      }
    }
    for (const dt of [1 / 60, 1 / 60, .13, 1.5, 10]) {
      for (const anchor of effects.fireballs) effects.updateProjectile({ mesh: anchor }, dt);
      effects.update(dt);
      for (const mesh of layers(effects)) {
        hash.update(String(mesh.count));
        for (const attribute of attributes(mesh)) hash.update(bytes(attribute.array));
      }
    }
  }
  const key = `${quality}:${reducedMotion}`, digest = hash.digest("hex");
  assert.equal(digest, expected[key], `${key}: full particle bytes and draw counts match the baseline`);
  effects.dispose();
}

// Execute the pinned renderer's real range uploads against readable mock GPU
// buffers. Allocation is full-sized once; only subsequent uploads are measured.
function uploader(backendName, meshes) {
  const state = new Map();
  let uploadedBytes = 0;
  const copy = (buffer, offset, array, start = 0, count = array.length - start) => {
    buffer.set(array.subarray(start, start + count), offset / array.BYTES_PER_ELEMENT);
    uploadedBytes += count * array.BYTES_PER_ELEMENT;
  };
  let bound;
  const backend = {
    get: attribute => state.get(attribute),
    device: { queue: { writeBuffer: copy } },
    gl: { bindBuffer: (_type, buffer) => { bound = buffer; }, bufferSubData: (_type, offset, array, start, count) => copy(bound, offset, array, start, count) }
  };
  const utils = backendName === "webgpu" ? new WebGPUAttributeUtils(backend) : new WebGLAttributeUtils(backend);
  for (const mesh of meshes) for (const attribute of attributes(mesh)) {
    const buffer = attribute.array.slice();
    state.set(attribute, { buffer, bufferGPU: buffer, bufferType: 0, version: attribute.version });
    attribute.clearUpdateRanges();
  }
  return {
    get bytes() { return uploadedBytes; },
    draw(mesh) {
      if (mesh.count === 0) return;
      for (const attribute of attributes(mesh)) {
        const data = state.get(attribute);
        if (data.version !== attribute.version) {
          utils.updateAttribute(attribute);
          data.version = attribute.version;
        }
        assert.deepEqual(bytes(data.buffer.subarray(0, mesh.count * attribute.itemSize)),
          bytes(attribute.array.subarray(0, mesh.count * attribute.itemSize)), `${backendName}: every drawn slot matches CPU bytes`);
        assert.equal(attribute.updateRanges.length, 0, `${backendName}: only the renderer consumes pending ranges`);
      }
    }
  };
}

for (const backendName of ["webgpu", "webgl"]) {
  const effects = new CombatVisuals(new THREE.Scene());
  const gpu = uploader(backendName, layers(effects));
  const blood = effects.bloodLayer;
  effects.blood(point, normal);
  effects.cursors.blood = 40; effects.blood(end, normal);
  effects.update(.01); gpu.draw(blood);
  assert.equal(blood.count, 41, "a sparse high slot keeps its original instance ID");

  effects.bloodDecals[40].life = .005;
  effects.cursors.blood = 20; effects.blood(end, normal);
  effects.update(.01); gpu.draw(blood);
  assert.equal(blood.count, 21, "expired high slots trim only the draw tail");
  effects.bloodDecals[0].life = .005;
  effects.update(.01); gpu.draw(blood);
  assert.equal(blood.instanceMatrix.array[0], 0, "a hole within the drawn prefix reaches the GPU");

  // Multiple fixed steps, including a shrinking prefix, before any render.
  effects.cursors.blood = 45; effects.blood(point, normal); effects.update(.01);
  effects.bloodDecals[45].life = .005; effects.update(.01);
  for (const attribute of attributes(blood)) assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 46 * attribute.itemSize }]);
  gpu.draw(blood);

  const versions = attributes(blood).map(attribute => attribute.version), beforeExpiry = gpu.bytes;
  effects.update(10); gpu.draw(blood);
  assert.equal(blood.count, 0);
  assert.deepEqual(attributes(blood).map(attribute => attribute.version), versions, "zero-count expiry creates no upload");
  assert.equal(gpu.bytes, beforeExpiry);
  effects.cursors.blood = 42; effects.blood(point, normal); effects.update(.01); gpu.draw(blood);
  assert.equal(blood.instanceMatrix.array[20 * 16], 0, "later expansion uploads a hole cleared while count was zero");

  // Expiry while the mesh is skipped must not erase a still-pending update.
  effects.cursors.blood = 47; effects.blood(end, normal); effects.update(.01);
  effects.update(10);
  effects.cursors.blood = 0; effects.blood(point, normal); effects.update(.01);
  for (const attribute of attributes(blood)) assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 48 * attribute.itemSize }]);
  gpu.draw(blood);

  const [fire, smoke, shell, scorch] = effects.explosions.layers;
  scorch.cursor = 27; effects.explosions.scorch(point, 2); effects.explosions.update(.01); gpu.draw(scorch.mesh);
  scorch.particles[27].life = .005;
  scorch.cursor = 2; effects.explosions.scorch(end, 2); effects.explosions.update(.01); gpu.draw(scorch.mesh);
  effects.explosions.update(10); gpu.draw(scorch.mesh);
  scorch.cursor = 30; effects.explosions.scorch(point, 2); effects.explosions.update(.01); gpu.draw(scorch.mesh);
  assert.equal(scorch.alpha.getX(27), 0, "explosion alpha expiry survives shrinking and zero-count prefixes");
  assert.equal(scorch.mesh.instanceMatrix.array[27 * 16], 0);

  // Surface/torus category changes retain fixed slots and independent draw tails.
  const surfacePair = [effects.surfaceFront, effects.surfaceCore];
  effects.cursors.ring = 0; effects.impact(point, WEAPONS.blaster, owner, { normal });
  effects.cursors.ring = 100; effects.impact(end, WEAPONS.blaster, owner, { normal });
  effects.update(.01); for (const mesh of surfacePair) gpu.draw(mesh);
  effects.rings[100].life = .005; effects.update(.01);
  for (const mesh of surfacePair) { assert.equal(mesh.count, 1); gpu.draw(mesh); }
  effects.cursors.ring = 115; effects.impact(end, WEAPONS.blaster, owner, { normal }); effects.update(.01);
  effects.cursors.ring = 115; effects.impact(end, WEAPONS.rocket_launcher, owner, { explosive: true }); effects.update(.01);
  for (const mesh of surfacePair) {
    assert.equal(mesh.count, 1, "switching the high slot to a torus preserves the low surface draw");
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 116 * 16 }]);
    gpu.draw(mesh);
  }
  effects.update(10);
  const expiredSurfaceVersions = surfacePair.flatMap(mesh => attributes(mesh).map(attribute => attribute.version));
  effects.update(.01);
  assert.deepEqual(surfacePair.flatMap(mesh => attributes(mesh).map(attribute => attribute.version)), expiredSurfaceVersions);
  effects.cursors.ring = 120; effects.impact(point, WEAPONS.blaster, owner, { normal }); effects.update(.01);
  for (const mesh of surfacePair) {
    assert.equal(mesh.count, 121); gpu.draw(mesh);
    assert.equal(mesh.instanceMatrix.array[100 * 16], 0, "surface expansion uploads old expired holes");
    assert.equal(mesh.instanceMatrix.array[115 * 16], 0, "surface expansion uploads a high slot switched to the torus category");
  }

  const first = effects.createProjectile(owner, WEAPONS.fireball, .36);
  const second = effects.createProjectile(owner, WEAPONS.fireball, .36);
  first.position.copy(point); second.position.copy(end);
  effects.updateFireballs(); effects.removeProjectile({ mesh: first }); effects.updateFireballs();
  for (const mesh of effects.fireballLayerList) {
    assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 32 }], "fireball steps retain the union until a render");
    gpu.draw(mesh);
  }
  effects.removeProjectile({ mesh: second }); effects.updateFireballs();
  for (const mesh of effects.fireballLayerList) {
    assert.equal(mesh.count, 0); assert.deepEqual(mesh.instanceMatrix.updateRanges, []);
  }
  effects.dispose();

  // Exact same single rocket impact previously uploaded 85,248 bytes/frame.
  const burst = new CombatVisuals(new THREE.Scene()), burstGpu = uploader(backendName, layers(burst));
  burst.impact(new THREE.Vector3(1, 2, 3), WEAPONS.rocket_launcher, owner, { size: 2, explosive: true, normal, ground: true });
  burst.update(1 / 60);
  for (const mesh of layers(burst)) burstGpu.draw(mesh);
  assert.equal(burstGpu.bytes, 3_820, "active prefixes upload only the exact burst's matrix/color/alpha/phase bytes");
  assert.ok(burstGpu.bytes < 85_248 / 20, "the paired burst reduces upload bytes by more than 95%");
  burst.dispose();
}
console.log("Particle upload baseline bytes/counts, sparse expiry, zero-count reuse, skipped renders and real WebGPU/WebGL range uploads passed (85,248 -> 3,820 bytes for the paired rocket burst).");
