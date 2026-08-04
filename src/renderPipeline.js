import * as THREE from "three/webgpu";
import { mrt, normalView, output, pass, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";

export class NeonRenderPipeline {
  constructor(renderer, scene, camera, { reducedMotion = false, coarsePointer = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const nativeWebGPU = renderer.backend.isWebGPUBackend === true;
    const ultra = nativeWebGPU && !coarsePointer;
    this.direct = !ultra;
    this.profile = nativeWebGPU ? "WEBGPU MOBILE" : "WEBGL2 DIRECT";
    if (this.direct) return;

    this.pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: normalView }));

    const sceneColor = scenePass.getTextureNode("output");
    const bloomPass = bloom(
      sceneColor,
      reducedMotion ? .32 : .58,
      .48,
      .72
    );
    bloomPass.resolutionScale = .5;
    this.bloomPass = bloomPass;

    const normal = scenePass.getTextureNode("normal");
    const depth = scenePass.getTextureNode("depth");
    const aoPass = ao(depth, normal, camera);
    aoPass.resolutionScale = .5;
    aoPass.radius.value = 1.6;
    aoPass.thickness.value = 2.2;
    aoPass.distanceExponent.value = 1.35;
    aoPass.distanceFallOff.value = .7;
    aoPass.samples.value = 16;
    const grounding = aoPass.getTextureNode().r.mul(.34).add(.66);
    const finalColor = sceneColor.mul(vec4(vec3(grounding), 1));

    this.pipeline.outputNode = finalColor.add(bloomPass);
    this.profile = "WEBGPU ULTRA";
  }

  render() {
    if (this.direct) return this.renderer.render(this.scene, this.camera);
    try {
      this.pipeline.render();
    } catch (error) {
      this.degradeToDirect(error);
      this.renderer.render(this.scene, this.camera);
    }
  }

  setReducedMotion(reducedMotion) {
    if (this.bloomPass) this.bloomPass.strength.value = reducedMotion ? .32 : .58;
  }

  degradeToDirect(reason) {
    if (this.direct) return;
    console.warn("HDR render pipeline disabled; continuing with direct rendering.", reason);
    this.pipeline?.dispose();
    this.pipeline = null;
    this.bloomPass = null;
    this.direct = true;
    this.profile = "DIRECT SAFETY";
  }

  dispose() {
    this.pipeline?.dispose();
  }
}
