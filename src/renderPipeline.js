import * as THREE from "three/webgpu";
import { mrt, normalView, output, pass, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";

export class NeonRenderPipeline {
  constructor(renderer, scene, camera, { reducedMotion = false, coarsePointer = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.reducedMotion = Boolean(reducedMotion);
    this.highLoadMode = false;
    this.highLoadPipeline = null;
    this.highLoadBloom = null;
    const nativeWebGPU = renderer.backend.isWebGPUBackend === true;
    this.nativeWebGPU = nativeWebGPU;
    this.direct = coarsePointer;
    this.profile = nativeWebGPU ? "WEBGPU MOBILE DIRECT" : coarsePointer ? "WEBGL2 MOBILE DIRECT" : "WEBGL2 BLOOM";
    if (this.direct) return;

    this.pipeline = new THREE.RenderPipeline(renderer);
    if (!nativeWebGPU) {
      const sceneColor = pass(scene, camera).getTextureNode("output");
      this.bloomPass = bloom(sceneColor, reducedMotion ? .16 : .28, .3, 1.08);
      this.bloomPass.resolutionScale = .34;
      this.pipeline.outputNode = sceneColor.add(this.bloomPass);
      return;
    }
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: normalView }));

    const sceneColor = scenePass.getTextureNode("output");
    const bloomPass = bloom(
      sceneColor,
      reducedMotion ? .22 : .44,
      .36,
      1.02
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
      (this.highLoadMode ? this.highLoadPipeline : this.pipeline).render();
    } catch (error) {
      this.degradeToDirect(error);
      this.renderer.render(this.scene, this.camera);
    }
  }

  setReducedMotion(reducedMotion) {
    this.reducedMotion = Boolean(reducedMotion);
    if (this.bloomPass) this.bloomPass.strength.value = this.nativeWebGPU ? reducedMotion ? .22 : .44 : reducedMotion ? .16 : .28;
    if (this.highLoadBloom) this.highLoadBloom.strength.value = reducedMotion ? .16 : .3;
  }

  setHighLoadMode(enabled) {
    if (this.direct) return;
    if (!this.nativeWebGPU) {
      this.highLoadMode = false;
      this.profile = "WEBGL2 BLOOM";
      return;
    }
    this.highLoadMode = Boolean(enabled);
    if (this.highLoadMode && !this.highLoadPipeline) {
      this.highLoadPipeline = new THREE.RenderPipeline(this.renderer);
      const sceneColor = pass(this.scene, this.camera).getTextureNode("output");
      this.highLoadBloom = bloom(sceneColor, this.reducedMotion ? .16 : .3, .3, 1.08);
      this.highLoadBloom.resolutionScale = .34;
      this.highLoadPipeline.outputNode = sceneColor.add(this.highLoadBloom);
    }
    this.profile = this.highLoadMode ? "WEBGPU 16P BLOOM" : "WEBGPU ULTRA";
  }

  degradeToDirect(reason) {
    if (this.direct) return;
    console.warn("HDR render pipeline disabled; continuing with direct rendering.", reason);
    this.pipeline?.dispose();
    this.highLoadPipeline?.dispose();
    this.pipeline = null;
    this.highLoadPipeline = null;
    this.bloomPass = null;
    this.highLoadBloom = null;
    this.direct = true;
    this.highLoadMode = false;
    this.profile = "DIRECT SAFETY";
  }

  dispose() {
    this.pipeline?.dispose();
    this.highLoadPipeline?.dispose();
  }
}
