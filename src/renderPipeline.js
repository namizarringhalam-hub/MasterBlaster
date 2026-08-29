import * as THREE from "three/webgpu";
import { mrt, normalView, output, pass, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import TEXT from "./playerText.js";

export class NeonRenderPipeline {
  constructor(renderer, scene, camera, { reducedMotion = false, coarsePointer = false, quality = "high" } = {}) {
    this.renderer = renderer;
    this.rendererState = THREE.RendererUtils.saveRendererState(renderer);
    this.rendererXrEnabled = renderer.xr?.enabled ?? false;
    this.passState = {
      transparent: renderer.transparent,
      opaque: renderer.opaque,
      contextNode: renderer.contextNode,
      sceneName: scene.name,
      overrideMaterial: scene.overrideMaterial,
      cameraLayerMask: camera.layers?.mask
    };
    this.scene = scene;
    this.camera = camera;
    this.reducedMotion = Boolean(reducedMotion);
    this.quality = ["low", "medium", "high"].includes(quality) ? quality : "high";
    this.coarsePointer = coarsePointer;
    this.highLoadMode = false;
    this.highLoadPipeline = null;
    this.highLoadBloom = null;
    this.highLoadScenePass = null;
    this.scenePass = null;
    this.aoPass = null;
    const nativeWebGPU = renderer.backend.isWebGPUBackend === true;
    this.nativeWebGPU = nativeWebGPU;
    this.direct = coarsePointer;
    this.profile = nativeWebGPU ? TEXT.performanceProfiles.webgpuMobileDirect : coarsePointer ? TEXT.performanceProfiles.webglMobileDirect : TEXT.performanceProfiles.webglBloom;
    if (this.direct) {
      this.setQuality(this.quality);
      return;
    }

    this.pipeline = new THREE.RenderPipeline(renderer);
    if (!nativeWebGPU) {
      this.scenePass = pass(scene, camera);
      const sceneColor = this.scenePass.getTextureNode("output");
      this.bloomPass = bloom(sceneColor, reducedMotion ? .16 : .28, .3, 1.08);
      this.bloomPass.resolutionScale = .34;
      this.pipeline.outputNode = sceneColor.add(this.bloomPass);
      this.setQuality(this.quality);
      return;
    }
    const scenePass = this.scenePass = pass(scene, camera);
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
    this.aoPass = aoPass;
    aoPass.resolutionScale = .5;
    aoPass.radius.value = 1.6;
    aoPass.thickness.value = 2.2;
    aoPass.distanceExponent.value = 1.35;
    aoPass.distanceFallOff.value = .7;
    aoPass.samples.value = 16;
    const grounding = aoPass.getTextureNode().r.mul(.34).add(.66);
    const finalColor = sceneColor.mul(vec4(vec3(grounding), 1));

    this.pipeline.outputNode = finalColor.add(bloomPass);
    this.setQuality(this.quality);
  }

  render() {
    if (this.direct || this.quality === "low") return this.renderer.render(this.scene, this.camera);
    try {
      (this.nativeWebGPU && (this.highLoadMode || this.quality === "medium") ? this.highLoadPipeline : this.pipeline).render();
    } catch (error) {
      this.degradeToDirect(error);
      this.renderer.render(this.scene, this.camera);
    }
  }

  setReducedMotion(reducedMotion) {
    this.reducedMotion = Boolean(reducedMotion);
    this.updateBloomQuality();
  }

  ensurePerformancePipeline() {
    if (!this.nativeWebGPU || this.highLoadPipeline) return;
    this.highLoadPipeline = new THREE.RenderPipeline(this.renderer);
    this.highLoadScenePass = pass(this.scene, this.camera);
    const sceneColor = this.highLoadScenePass.getTextureNode("output");
    this.highLoadBloom = bloom(sceneColor, this.reducedMotion ? .16 : .3, .3, 1.08);
    this.highLoadBloom.resolutionScale = .34;
    this.highLoadPipeline.outputNode = sceneColor.add(this.highLoadBloom);
  }

  updateBloomQuality() {
    if (this.bloomPass) {
      this.bloomPass.strength.value = this.reducedMotion ? (this.nativeWebGPU ? .22 : .16)
        : this.quality === "medium" ? (this.nativeWebGPU ? .3 : .2)
          : this.nativeWebGPU ? .44 : .28;
      this.bloomPass.resolutionScale = this.quality === "medium" ? (this.nativeWebGPU ? .4 : .26) : this.nativeWebGPU ? .5 : .34;
    }
    if (this.highLoadBloom) this.highLoadBloom.strength.value = this.reducedMotion ? .16 : this.quality === "medium" ? .24 : .3;
  }

  setQuality(quality = "high") {
    this.quality = ["low", "medium", "high"].includes(quality) ? quality : "high";
    if (this.direct) {
      this.profile = `${this.nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webgl} ${TEXT.performanceProfiles.mobileDirect} · ${TEXT.performanceProfiles.quality[this.quality]}`;
      return this.quality;
    }
    if (this.nativeWebGPU && this.quality === "medium") this.ensurePerformancePipeline();
    this.updateBloomQuality();
    const backend = this.nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webgl;
    this.profile = this.quality === "low" ? `${backend} ${TEXT.performanceProfiles.lowDirect}`
      : !this.nativeWebGPU ? `${backend} ${this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom : TEXT.performanceProfiles.bloom}`
        : `${backend} ${this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom : this.highLoadMode ? TEXT.performanceProfiles.sixteenPlayerBloom : TEXT.performanceProfiles.ultra}`;
    return this.quality;
  }

  setHighLoadMode(enabled) {
    if (this.direct) return;
    if (!this.nativeWebGPU) {
      this.highLoadMode = false;
      this.updateBloomQuality();
      this.profile = `${TEXT.performanceProfiles.webgl} ${this.quality === "low" ? TEXT.performanceProfiles.lowDirect : this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom : TEXT.performanceProfiles.bloom}`;
      return;
    }
    this.highLoadMode = Boolean(enabled);
    if (this.quality === "medium" || (this.highLoadMode && this.quality === "high")) this.ensurePerformancePipeline();
    this.updateBloomQuality();
    this.profile = `${TEXT.performanceProfiles.webgpu} ${this.quality === "low" ? TEXT.performanceProfiles.lowDirect
      : this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom
        : this.highLoadMode ? TEXT.performanceProfiles.sixteenPlayerBloom : TEXT.performanceProfiles.ultra}`;
  }

  degradeToDirect(reason) {
    if (this.direct) return;
    console.warn("HDR render pipeline disabled; continuing with direct rendering.", reason);
    // A failed node pass can leave WebGPU bound to an offscreen target. Restore
    // the canvas and output state before the direct fallback draws its first frame.
    try {
      THREE.RendererUtils.restoreRendererState(this.renderer, this.rendererState);
    } catch {
      try { this.renderer.setRenderTarget?.(null); } catch {}
      try { this.renderer.setMRT?.(null); } catch {}
      try { this.renderer.setRenderObjectFunction?.(null); } catch {}
      this.renderer.autoClear = true;
    }
    this.renderer.transparent = this.passState.transparent;
    this.renderer.opaque = this.passState.opaque;
    this.renderer.contextNode = this.passState.contextNode;
    this.scene.name = this.passState.sceneName;
    this.scene.overrideMaterial = this.passState.overrideMaterial;
    if (this.camera.layers && this.passState.cameraLayerMask != null) this.camera.layers.mask = this.passState.cameraLayerMask;
    if (this.renderer.xr) this.renderer.xr.enabled = this.rendererXrEnabled;
    this.disposePipelineResources();
    this.direct = true;
    this.highLoadMode = false;
    this.profile = TEXT.performanceProfiles.directSafety;
  }

  dispose() {
    this.disposePipelineResources();
  }

  disposePipelineResources() {
    for (const resource of [this.pipeline, this.highLoadPipeline, this.scenePass, this.highLoadScenePass, this.bloomPass, this.highLoadBloom, this.aoPass]) resource?.dispose?.();
    this.pipeline = null;
    this.highLoadPipeline = null;
    this.scenePass = null;
    this.highLoadScenePass = null;
    this.bloomPass = null;
    this.highLoadBloom = null;
    this.aoPass = null;
  }
}
