import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { color } from "three/tsl";
import { CombatVisuals } from "../src/combatVisuals.js";
import { NeonRenderPipeline } from "../src/renderPipeline.js";
import { ArenaWorld } from "../src/world.js";
import { Fighter } from "../src/player.js";

// Exercise Three's actual shader generators without a browser/device. The only
// stand-ins are conservative hardware limits; this is not a GPU pixel test.
for (const webgl of [false, true]) for (const quality of ["high", "medium"]) {
  const renderer = new THREE.WebGPURenderer({ forceWebGL: webgl,
    canvas: { width: 64, height: 64, style: {}, addEventListener() {}, removeEventListener() {} } });
  renderer.backend.capabilities ??= {};
  renderer.backend.capabilities.getUniformBufferLimit = () => 16384;
  renderer.hasFeature = () => false;
  if (webgl) renderer.backend.extensions = { has: () => false };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const effects = new CombatVisuals(scene), pipeline = new NeonRenderPipeline(renderer, scene, camera, { quality });
  const pass = !webgl && quality === "medium" ? pipeline.highLoadScenePass : pipeline.scenePass;
  assert.equal(pass.getMRT().getBlendMode("bloom").blending, THREE.MaterialBlending,
    "bloom must preserve additive alpha and smoke occlusion, not overwrite with transparent RGB");
  renderer.setRenderTarget(pass.renderTarget); renderer.setMRT(pass.getMRT());
  const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const lit = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: 0xff6600, emissiveIntensity: 3 }));
  const reactor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
  reactor.material.emissiveNode = color(0x33aaff).mul(.08);
  const world = new ArenaWorld(scene);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicNodeMaterial());
  sky.material.colorNode = scene.backgroundNode;
  const fighter = new Fighter(scene, { id: "shader-night", color: 0x227799, accent: 0x55ddff }, ["blaster"], new THREE.Vector3());
  for (const mesh of [world.ground, world.platforms[0].mesh, world.lightShafts, sky,
    world.group.getObjectByName("Cyan relay arcologies — layered bodies"),
    fighter.group.getObjectByName("Movement neon back halos"), fighter.group.getObjectByName("Movement neon back vents")]) {
    const builder = new (webgl ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder)(mesh, renderer);
    builder.scene = scene; builder.camera = camera; builder.build();
    assert.ok(builder.fragmentShader.length > 100);
    assert.doesNotMatch(builder.fragmentShader, /undefined|NaN/);
  }
  for (const mesh of [effects.flashOuter, effects.tracerInner, ...effects.explosions.layers.map(l => l.mesh), plain, lit, reactor]) {
    const builder = new (webgl ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder)(mesh, renderer);
    builder.scene = scene; builder.camera = camera; builder.build();
    const fragment = builder.fragmentShader;
    assert.ok(fragment.length > 100 && builder.vertexShader.length > 100);
    assert.doesNotMatch(fragment, /undefined|NaN/);
    assert.ok(pass.renderTarget.textures.some(t => t.name === "bloom"));
    if (mesh.material.emissiveNode && !mesh.material.emissive) {
      assert.match(fragment, /EmissiveColor\s*=/);
      assert.match(fragment, /\.m\d\s*=\s*Output|\bm\d\s*=\s*Output/, "animated emission reaches the bloom attachment");
    } else if (mesh === plain || ["smoke", "scorch"].some(kind => mesh === effects.explosions.layers.find(layer => layer.kind === kind).mesh)) {
      assert.match(fragment, /vec4(?:<f32>)?\( 0\.0, 0\.0, 0\.0, Output\.w \)/, "diffuse white and smoke cannot emit bloom");
    } else assert.match(fragment, /vec4(?:<f32>)?\( EmissiveColor, Output\.w \)/, "PBR contributes only its emission, not reflected light");
  }
  pipeline.dispose(); effects.dispose(); plain.geometry.dispose(); plain.material.dispose(); lit.geometry.dispose(); lit.material.dispose();
  reactor.geometry.dispose(); reactor.material.dispose();
  world.dispose(); sky.geometry.dispose(); sky.material.dispose();
  fighter.dispose();
}
console.log("WGSL/GLSL high/medium shaders generate with selective emission, smoke alpha and instanced attributes.");
