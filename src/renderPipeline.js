import * as THREE from "three/webgpu";
import { Fn, If, clearcoat, clearcoatNormalView, clearcoatRoughness, emissive, getNormalFromDepth, metalness, mix, mrt, normalView, output, pass, roughness, screenUV, uniform, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import TEXT from "./playerText.js";
import { localFog } from "./localFog.js";

// AO depth and normals must describe the same surface. Light overlays keep
// their scene color, but cannot replace the normal of the solid beneath them.
const aoNormal = Fn(([], builder) => vec4(builder.material.clearcoat !== undefined
  ? mix(normalView, clearcoatNormalView, clearcoat).normalize() : normalView, builder.material.depthWrite ? 1 : 0));
// Pack the finished material response alongside the beauty pass. Transparent
// light/smoke overlays preserve the solid surface's reflection eligibility.
const reflectionSurface = Fn(([], builder) => {
  const alpha = builder.material.depthWrite ? 1 : 0;
  if (builder.material.metalness === undefined) return vec4(0, 1, 0, alpha);
  const coated = builder.material.clearcoat !== undefined;
  const surfaceRoughness = coated ? mix(roughness, clearcoatRoughness, clearcoat) : roughness;
  const reflectivity = coated ? metalness.max(clearcoat.mul(.65)) : metalness;
  return vec4(reflectivity.mul(surfaceRoughness.oneMinus().pow(2)), surfaceRoughness, 0, alpha);
});
// Only authored emission enters bloom. Bright diffuse surfaces and normal-blend
// smoke still occlude it through the same depth/alpha as the beauty attachment.
const bloomEmission = Fn(([], builder) => builder.material.emissive
  ? vec4(emissive, output.a) : builder.material.emissiveNode ? output : vec4(0, 0, 0, output.a));
// Quiet inlays retain sharp cores; strong combat emission earns the large halo.
const EMISSION_THRESHOLD = .3;

// Compatibility GPUs cannot blend MRT attachments independently. A NoBlending
// overlay (Line2) marks its overwritten normal invalid; recover only those
// pixels from the unchanged solid depth, preserving all valid material normals.
export function recoverInvalidAONormals(normal, depth, inverseProjection) {
  return { sample: Fn(([coord]) => {
    const stored = normal.sample(coord).toVar();
    const result = stored.rgb.toVar();
    If(stored.a.lessThan(.5), () => {
      result.assign(getNormalFromDepth(coord, depth.value, inverseProjection));
    });
    return result;
  }) };
}

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
    this.reflectionPass = null;
    this.localFog = null;
    this.pipeline = null;
    this.bloomPass = null;
    const nativeWebGPU = renderer.backend.isWebGPUBackend === true;
    this.nativeWebGPU = nativeWebGPU;
    this.direct = false;
    this.profile = nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webglBloom;
    this.setQuality(this.quality);
  }

  ensureQualityPipeline() {
    if (this.pipeline || this.direct || this.quality === "low") return;
    const { renderer, scene, camera, reducedMotion, nativeWebGPU } = this;
    this.pipeline = new THREE.RenderPipeline(renderer);
    if (!nativeWebGPU) {
      this.scenePass = pass(scene, camera);
      this.scenePass.setMRT(mrt({ output, bloom: bloomEmission() })
        .setBlendMode("bloom", new THREE.BlendMode(THREE.MaterialBlending)));
      const sceneColor = this.scenePass.getTextureNode("output");
      this.bloomPass = bloom(this.scenePass.getTextureNode("bloom"), reducedMotion ? .16 : .36, .16, EMISSION_THRESHOLD);
      this.bloomPass.resolutionScale = .34;
      this.pipeline.outputNode = sceneColor.add(this.bloomPass);
      return;
    }
    const scenePass = this.scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: aoNormal(), bloom: bloomEmission(), surface: reflectionSurface() })
      .setBlendMode("bloom", new THREE.BlendMode(THREE.MaterialBlending))
      .setBlendMode("normal", new THREE.BlendMode(THREE.NormalBlending))
      .setBlendMode("surface", new THREE.BlendMode(THREE.NormalBlending)));

    const sceneColor = scenePass.getTextureNode("output");
    const bloomPass = bloom(
      scenePass.getTextureNode("bloom"),
      reducedMotion ? .22 : .52,
      .18,
      EMISSION_THRESHOLD
    );
    bloomPass.resolutionScale = .5;
    this.bloomPass = bloomPass;

    const normal = scenePass.getTextureNode("normal");
    const depth = scenePass.getTextureNode("depth");
    const aoNormals = renderer.backend.compatibilityMode === true
      ? recoverInvalidAONormals(normal, depth, uniform(camera.projectionMatrixInverse)) : normal;
    const aoPass = ao(depth, aoNormals, camera);
    this.aoPass = aoPass;
    aoPass.resolutionScale = .5;
    aoPass.radius.value = 1.6;
    aoPass.thickness.value = 2.2;
    aoPass.distanceExponent.value = 1.35;
    aoPass.distanceFallOff.value = .7;
    aoPass.samples.value = 16;
    const grounding = aoPass.getTextureNode().r.mul(.34).add(.66);
    const finalColor = sceneColor.mul(vec4(vec3(grounding), 1));
    const surface = scenePass.getTextureNode("surface");
    const reflections = this.reflectionPass = ssr(sceneColor, depth, normal, {
      camera, metalnessNode: surface.r.mul(surface.a.step(.5)), roughnessNode: surface.g,
      binaryRefine: true
    });
    reflections.resolutionScale = .5;
    reflections.maxDistance.value = 28;
    reflections.thickness.value = .22;
    reflections.quality.value = .5;
    reflections.intensity.value = .45;
    reflections.maxLuminance.value = 3;
    // No temporal history: moving fighters and destroyed cover update in the
    // current frame. Existing IBL remains the fallback outside the screen.
    const edge = screenUV.min(screenUV.oneMinus()).mul(12).clamp(0, 1);
    let litScene = finalColor.add(vec4(reflections.rgb.mul(edge.x.mul(edge.y)), 0));
    const key = scene.children.find(light => light.isDirectionalLight && light.castShadow);
    if (key) {
      this.localFog = localFog(depth, camera, key);
      const air = this.localFog.node(screenUV);
      litScene = vec4(litScene.rgb.mul(air.a).add(air.rgb), litScene.a);
    }
    this.pipeline.outputNode = litScene.add(bloomPass);
  }

  render() {
    if (this.direct || this.quality === "low") return this.renderer.render(this.scene, this.camera);
    try {
      if (this.quality === "high" && this.localFog) {
        // Shadows initialize lazily. Refresh the binding after quality changes
        // too: their map can be replaced while this post graph remains cached.
        if (!this.localFog.light.shadow.map) this.renderer.render(this.scene, this.camera);
        const shadowMap = this.localFog.light.shadow.map;
        // Empty menu scenes have no shadow receivers yet. Do not compile the
        // post graph against a placeholder with a different MSAA layout.
        if (!shadowMap) return;
        this.localFog.shadow.value = shadowMap.depthTexture;
        this.localFog.ready.value = 1;
      }
      (this.nativeWebGPU && this.quality === "medium" ? this.highLoadPipeline : this.pipeline).render();
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
    this.highLoadScenePass.setMRT(mrt({ output, bloom: bloomEmission() })
      .setBlendMode("bloom", new THREE.BlendMode(THREE.MaterialBlending)));
    const sceneColor = this.highLoadScenePass.getTextureNode("output");
    this.highLoadBloom = bloom(this.highLoadScenePass.getTextureNode("bloom"), this.reducedMotion ? .16 : .34, .16, EMISSION_THRESHOLD);
    this.highLoadBloom.resolutionScale = .34;
    this.highLoadPipeline.outputNode = sceneColor.add(this.highLoadBloom);
  }

  updateBloomQuality() {
    if (this.bloomPass) {
      this.bloomPass.strength.value = this.reducedMotion ? (this.nativeWebGPU ? .22 : .16)
        : this.quality === "medium" ? (this.nativeWebGPU ? .34 : .26)
          : this.nativeWebGPU ? .52 : .36;
      this.bloomPass.resolutionScale = this.quality === "medium" ? (this.nativeWebGPU ? .4 : .26) : this.nativeWebGPU ? .5 : .34;
    }
    if (this.highLoadBloom) this.highLoadBloom.strength.value = this.reducedMotion ? .16 : this.quality === "medium" ? .28 : .34;
  }

  setQuality(quality = "high") {
    this.quality = ["low", "medium", "high"].includes(quality) ? quality : "high";
    if (this.direct) {
      this.profile = `${this.nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webgl} ${TEXT.performanceProfiles.mobileDirect} · ${TEXT.performanceProfiles.quality[this.quality]}`;
      return this.quality;
    }
    if (this.nativeWebGPU && this.quality === "medium") this.ensurePerformancePipeline();
    else if (this.quality !== "low") this.ensureQualityPipeline();
    this.updateBloomQuality();
    const backend = this.nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webgl;
    this.profile = this.quality === "low" ? `${backend} ${TEXT.performanceProfiles.lowDirect}`
      : !this.nativeWebGPU ? `${backend} ${this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom : TEXT.performanceProfiles.bloom}`
        : `${backend} ${this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom : TEXT.performanceProfiles.ultra}`;
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
    if (this.quality === "medium") this.ensurePerformancePipeline();
    this.updateBloomQuality();
    this.profile = `${TEXT.performanceProfiles.webgpu} ${this.quality === "low" ? TEXT.performanceProfiles.lowDirect
      : this.quality === "medium" ? TEXT.performanceProfiles.mediumBloom
        : TEXT.performanceProfiles.ultra}`;
  }

  degradeToDirect(reason) {
    if (this.direct) return;
    console.warn("HDR render pipeline disabled; continuing with direct rendering.", reason);
    // A failed node pass can leave WebGPU bound to an offscreen target. Restore
    // the canvas and output state before the direct fallback draws its first frame.
    try {
      if (this.renderer.getPixelRatio) this.rendererState.pixelRatio = this.renderer.getPixelRatio();
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
    this.localFog?.placeholder.dispose();
    this.localFog = null;
    for (const resource of [this.pipeline, this.highLoadPipeline, this.scenePass, this.highLoadScenePass, this.bloomPass, this.highLoadBloom, this.aoPass, this.reflectionPass]) resource?.dispose?.();
    this.pipeline = null;
    this.highLoadPipeline = null;
    this.scenePass = null;
    this.highLoadScenePass = null;
    this.bloomPass = null;
    this.highLoadBloom = null;
    this.aoPass = null;
    this.reflectionPass = null;
  }
}
