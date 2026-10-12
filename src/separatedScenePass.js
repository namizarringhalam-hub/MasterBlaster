import { BlendMode, CustomBlending, MaterialBlending, OneFactor, PassNode, RendererUtils, ZeroFactor } from 'three/webgpu';
import { context, mrt, vec4 } from 'three/tsl';

// Render every opaque surface exactly once. Preserve its depth for soft
// particles, then draw transparency into the same beauty/MRT attachments.
export class SeparatedScenePass extends PassNode {
  constructor(scene, camera, particleDepth, options = {}) {
    super(PassNode.COLOR, scene, camera, options);
    this.particleDepth = particleDepth;
    this.transparent = false;
    if (particleDepth) this.contextNode = context({ particleDepth: particleDepth.node, particleFadeStrength: particleDepth.strength });
  }

  setMRT(opaqueMRT) {
    super.setMRT(opaqueMRT);
    this.transparentMRT = mrt({ ...opaqueMRT.outputNodes });
    for (const name of Object.keys(opaqueMRT.outputNodes)) {
      if (name === 'output' || name === 'bloom') {
        this.transparentMRT.setBlendMode(name, new BlendMode(MaterialBlending));
      } else {
        // G-buffer and rigid velocity describe opaque surfaces. Transparent
        // smoke/energy may blend beauty and emission, never those surfaces.
        const keep = new BlendMode(CustomBlending);
        keep.blendSrc = keep.blendSrcAlpha = ZeroFactor;
        keep.blendDst = keep.blendDstAlpha = OneFactor;
        // The physical velocity attachment is retained without producing
        // motion vectors. Three keys previous-instance allocation from the
        // semantic name alone, even when its output is constant zero.
        const semantic = name === 'velocity' ? 'preservedVelocity' : name;
        if (semantic !== name) delete this.transparentMRT.outputNodes[name];
        this.transparentMRT.setBlendMode(semantic, keep);
        this.transparentMRT.outputNodes[semantic] = vec4(0);
      }
    }
    return this;
  }

  updateBefore(frame) {
    const { renderer } = frame, { scene, camera } = this;
    const state = RendererUtils.saveRendererAndSceneState(renderer, scene);
    const transparent = renderer.transparent, opaque = renderer.opaque;
    const contextNode = renderer.contextNode, autoShadows = renderer.shadowMap.autoUpdate;
    const mask = camera.layers.mask, sceneName = scene.name;
    const matrixAutoUpdate = scene.matrixWorldAutoUpdate;
    const velocityTexture = this.renderTarget.textures.find(texture => texture.name === 'velocity');
    try {
      // Presentation has settled before this pass. Opaque, shadow and
      // transparent draws share one world-transform snapshot for the frame.
      // CSM explicitly publishes its own light transforms when it repositions.
      if (matrixAutoUpdate) {
        scene.updateMatrixWorld();
        scene.matrixWorldAutoUpdate = false;
      }
      super.updateBefore(frame);
      this.particleDepth?.copy(renderer, this.renderTarget.depthTexture);
      if (velocityTexture) velocityTexture.name = 'preservedVelocity';
      renderer.setRenderTarget(this.renderTarget);
      renderer.setMRT(this.transparentMRT);
      renderer.autoClear = false;
      renderer.opaque = false;
      renderer.transparent = true;
      // The opaque pass already refreshed all shadow maps.
      renderer.shadowMap.autoUpdate = false;
      if (this._contextNodeCache) renderer.contextNode = this._contextNodeCache.context;
      if (this.getLayers()) camera.layers.mask = this.getLayers().mask;
      scene.background = null;
      scene.backgroundNode = null;
      renderer.render(scene, camera);
    } finally {
      if (velocityTexture) velocityTexture.name = 'velocity';
      scene.matrixWorldAutoUpdate = matrixAutoUpdate;
      RendererUtils.restoreRendererAndSceneState(renderer, scene, state);
      renderer.transparent = transparent;
      renderer.opaque = opaque;
      renderer.contextNode = contextNode;
      renderer.shadowMap.autoUpdate = autoShadows;
      camera.layers.mask = mask;
      scene.name = sceneName;
    }
  }
}
