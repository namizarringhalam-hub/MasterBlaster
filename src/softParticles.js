import * as THREE from "three/webgpu";
import { Fn, cameraFar, cameraNear, float, mix, perspectiveDepthToViewZ, positionView, screenUV, texture, uniform } from "three/tsl";

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
    this.target = new THREE.RenderTarget(1, 1, { type: THREE.UnsignedByteType, format: THREE.RedFormat, depthTexture: new THREE.DepthTexture(1, 1), samples: 0 });
    this.node = texture(this.target.depthTexture);
    this.strength = uniform(1);
    this.frames = 0;
  }

  // Copy the opaque main pass's depth; no geometry or velocity prepass.
  copy(renderer, source) {
    const { width, height } = source.image;
    if (this.target.width !== width || this.target.height !== height || this.target.depthTexture.type !== source.type) {
      this.target.depthTexture.type = source.type;
      this.target.setSize(width, height);
      renderer.initRenderTarget(this.target);
    }
    renderer.copyTextureToTexture(source, this.target.depthTexture);
    this.frames++;
  }

  dispose() { this.target.dispose(); }
}
