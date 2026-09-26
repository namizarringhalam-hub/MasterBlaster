import * as THREE from "three/webgpu";
import { Fn, cameraFar, cameraNear, float, mix, perspectiveDepthToViewZ, positionView, screenUV, texture, uniform, vec4, velocity } from "three/tsl";

// The opaque depth is separate from the beauty attachment: sampling the depth
// currently being written is invalid on WebGPU, especially with MSAA enabled.
export const softParticleFade = Fn(([], builder) => {
  const depth = builder.context.particleDepth;
  if (!depth) return float(1);
  const solidZ = perspectiveDepthToViewZ(depth.sample(screenUV).r, cameraNear, cameraFar);
  return mix(1, positionView.z.sub(solidZ).div(.65).clamp(0, 1), builder.context.particleFadeStrength ?? 1);
});

export class SoftParticleDepth {
  constructor() {
    this.target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1), samples: 0 });
    this.node = texture(this.target.depthTexture);
    this.velocity = texture(this.target.texture);
    this.strength = uniform(1);
    this.frames = 0;
    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.fragmentNode = vec4(velocity, 0, 1);
    this.size = new THREE.Vector2();
  }

  render(renderer, scene, camera, motionBlur = false) {
    const effects = scene.children.find(child => child.name === "Combat visuals");
    const particles = effects?.children.find(child => child.name === "Pooled explosion fire and smoke");
    if (!motionBlur && !particles?.children.some(mesh => mesh.name !== "Explosion scorch" && mesh.visible && mesh.count > 0)) return;
    renderer.getDrawingBufferSize(this.size);
    this.target.setSize(Math.max(1, Math.ceil(this.size.x / 2)), Math.max(1, Math.ceil(this.size.y / 2)));
    const state = THREE.RendererUtils.saveRendererAndSceneState(renderer, scene);
    const transparent = renderer.transparent, opaque = renderer.opaque;
    try {
      renderer.setRenderTarget(this.target); renderer.setMRT(null);
      renderer.autoClear = true; renderer.transparent = false; renderer.opaque = true;
      renderer.setClearColor(0, 0);
      scene.overrideMaterial = this.material;
      scene.background = null; scene.backgroundNode = null;
      renderer.render(scene, camera);
      this.frames++;
    } finally {
      THREE.RendererUtils.restoreRendererAndSceneState(renderer, scene, state);
      renderer.transparent = transparent; renderer.opaque = opaque;
    }
  }

  dispose() { this.target.dispose(); this.material.dispose(); }
}
