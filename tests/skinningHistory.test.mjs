import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { mrt, output, vec4, velocity } from 'three/tsl';
import { Fighter } from '../src/player.js';
import { cloneMechaHologram } from '../src/mecha.js';
import { patchSkinningHistory, skinningOriginal, skinningReplacement, skinningState } from '../scripts/patch-three.mjs';

const source = readFileSync(new URL('../node_modules/three/src/nodes/accessors/Skinning.js', import.meta.url), 'utf8');
const pristine = source.replace(skinningState, '').replace(skinningReplacement, skinningOriginal);
assert.equal(patchSkinningHistory(pristine), source);
assert.equal(patchSkinningHistory(source), source);
assert.throws(() => patchSkinningHistory('changed source'), /source changed/);
assert.throws(() => patchSkinningHistory(source + source), /duplicate/);
assert.throws(() => patchSkinningHistory(source + skinningOriginal), /mixed/);
for (const path of ['build/three.webgpu.js', 'build/three.webgpu.nodes.js']) {
  const installed = readFileSync(new URL(`../node_modules/three/${path}`, import.meta.url), 'utf8');
  assert.equal(patchSkinningHistory(installed), installed);
}

// Execute the installed helper and its actual object callbacks. These uniforms
// stand in only for GPU storage; transform math uses the real rig and skeleton.
const start = source.indexOf('function getPreviousSkinnedPosition(');
const helper = source.slice(start, source.indexOf('\n/**', start));
const makeUniform = () => ({ onObjectUpdate(callback) { this.callback = callback; return this; } });
const previous = new Function('uniform', 'buffer', 'positionPrevious', 'getSkinnedPosition',
  `${skinningState}\nconst _previousBoneMatricesData = new WeakMap();\n${helper}\nreturn getPreviousSkinnedPosition;`)
  (makeUniform, array => Object.assign(makeUniform(), { value: array }), null, (bones, position, bind, inverse) => ({ bones, bind, inverse }));
const scene = new THREE.Scene(), fighter = new Fighter(scene,
  { id: 'skin-history', color: 0x227799, accent: 0x55ddff }, ['blaster'], new THREE.Vector3());
const clone = cloneMechaHologram(fighter.group); clone.position.set(-5, 0, 0); scene.add(clone);
const meshes = [...fighter.mechaSkinMeshes]; clone.traverse(mesh => { if (mesh.isSkinnedMesh) meshes.push(mesh); });
scene.updateMatrixWorld(true);
const states = meshes.map(mesh => {
  const nodes = previous(mesh, null, null, null, null);
  const bind = nodes.bind.callback({ object: mesh, frameId: 1 });
  const inverse = nodes.inverse.callback({ object: mesh, frameId: 1 });
  mesh.skeleton.update();
  return { mesh, nodes, oldBones: mesh.skeleton.boneMatrices.slice(), oldBind: bind.clone(), oldInverse: inverse.clone(), oldWorld: mesh.matrixWorld.clone() };
});
fighter.group.position.x += 1;
fighter.group.rotation.y = .27;
fighter.leftArm.rotation.z += .3; fighter.rightLeg.rotation.x -= .4; fighter.syncMechaSkeleton();
clone.position.add(new THREE.Vector3(.5, 1, 0)); clone.rotation.z = -.13;
const cloneHinge = clone.getObjectByName('Mecha bone leftArm'); cloneHinge.rotation.z -= .2;
scene.updateMatrixWorld(true);
let samples = 0, changed = 0;
const skin = (mesh, index, bones, bind, inverse) => {
  const position = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).applyMatrix4(bind);
  const result = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (let slot = 0; slot < 4; slot++) {
    const weight = mesh.geometry.attributes.skinWeight.getComponent(index, slot);
    const bone = mesh.geometry.attributes.skinIndex.getComponent(index, slot);
    if (weight) result.addScaledVector(position.clone().applyMatrix4(matrix.fromArray(bones, bone * 16)), weight);
  }
  return result.applyMatrix4(inverse);
};
for (const { mesh, nodes, oldBones, oldBind, oldInverse, oldWorld } of states) {
  const frame = { object: mesh, frameId: 2 };
  const priorBind = nodes.bind.callback(frame), priorInverse = nodes.inverse.callback(frame);
  assert.ok(priorBind.equals(oldBind)); assert.ok(priorInverse.equals(oldInverse));
  assert.equal(nodes.inverse.callback(frame), priorInverse, 'shadow/main repeat cannot advance history twice');
  mesh.skeleton.update();
  const count = mesh.geometry.attributes.position.count;
  for (let index = 0; index < count; index += Math.max(1, Math.floor(count / 40))) {
    const expected = skin(mesh, index, oldBones, oldBind, oldInverse).applyMatrix4(oldWorld);
    const actual = skin(mesh, index, oldBones, priorBind, priorInverse).applyMatrix4(oldWorld);
    assert.ok(actual.distanceTo(expected) < 1e-6, 'previous root/limb/hologram world vertex stays in its original frame');
    const wrong = skin(mesh, index, oldBones, mesh.bindMatrix, mesh.bindMatrixInverse).applyMatrix4(oldWorld);
    if (wrong.distanceTo(expected) > .1) changed++;
    const current = skin(mesh, index, mesh.skeleton.boneMatrices, mesh.bindMatrix, mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
    const cpu = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index);
    mesh.applyBoneTransform(index, cpu); cpu.applyMatrix4(mesh.matrixWorld);
    assert.ok(current.distanceTo(cpu) < 1e-4, 'current renderer-owned palette retains root and articulated geometry');
    samples++;
  }
}
assert.ok(changed > 100, 'the old current-inverse defect is observed across actual armor and hologram vertices');
// A reused shader must follow the currently drawn mesh, not its build-time mesh.
const first = states[0], second = states.at(-1);
assert.ok(first.nodes.inverse.callback({ object: second.mesh, frameId: 2 }).equals(second.oldInverse));
assert.equal(first.nodes.bones.callback({ object: second.mesh }), second.nodes.bones.value,
  'a reused shader selects the current draw skeleton previous palette');
assert.notEqual(first.nodes.bones.callback({ object: first.mesh }), second.nodes.bones.value,
  'different skeletons never borrow the first shader-build skeleton history');
const detached = new THREE.SkinnedMesh(); detached.bindMode = THREE.DetachedBindMode;
const detachedNodes = previous({ ...detached, skeleton: fighter.mechaSkeleton }, null, null, null, null);
assert.ok(detachedNodes.inverse.callback({ object: detached, frameId: 1 }).equals(detached.bindMatrixInverse));

// Build the actual installed GPU paths, including opaque velocity skinning.
for (const webgl of [false, true]) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: webgl, canvas: { width: 32, height: 32, style: {}, addEventListener() {}, removeEventListener() {} } });
  renderer.backend.renderer = renderer;
  renderer.backend.capabilities = { getUniformBufferLimit: () => 16384 };
  renderer.hasFeature = renderer.hasCompatibility = () => false;
  if (webgl) renderer.backend.extensions = { has: () => false };
  const target = new THREE.RenderTarget(32, 32, { count: 2 });
  target.textures[0].name = 'output'; target.textures[1].name = 'velocity';
  renderer.setRenderTarget(target); renderer.setMRT(mrt({ output, velocity: vec4(velocity, 0, 1) }));
  for (const mesh of [fighter.mechaSkinMeshes[0], second.mesh]) {
    const builder = new (webgl ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder)(mesh, renderer);
    builder.scene = scene; builder.camera = new THREE.PerspectiveCamera(); builder.build();
    assert.ok(builder.needsPreviousData());
    assert.match(builder.vertexShader, /positionPrevious/);
    assert.doesNotMatch(builder.vertexShader, /undefined|NaN/);
  }
  target.dispose();
}
const cloneSkeletons = new Set(); clone.traverse(mesh => { if (mesh.isSkinnedMesh) cloneSkeletons.add(mesh.skeleton); });
for (const skeleton of cloneSkeletons) skeleton.dispose(); fighter.dispose();
console.log(`Skinning history: ${samples} root/hinge/hologram samples, shared draw bindings, same-frame stability and WGSL/GLSL passed.`);
