import * as THREE from "three/webgpu";
import { Fn, If, clearcoat, clearcoatNormalView, clearcoatRoughness, emissive, float, getNormalFromDepth, metalness, mix, mrt, normalView, output, pass, renderOutput, roughness, rtt, screenUV, uniform, vec2, vec3, vec4, velocity } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { taau } from "three/addons/tsl/display/TAAUNode.js";
import { fsr1 } from "three/addons/tsl/display/FSR1Node.js";
import TEXT from "./playerText.js";
import { localFog } from "./localFog.js";
import { SoftParticleDepth } from "./softParticles.js";
import { HeatDistortion } from "./heatDistortion.js";
import { contactShadows } from "./contactShadows.js";
import { CinematicMotionBlur } from "./cinematicMotionBlur.js";
import { CinematicPresentation } from "./cinematicPresentation.js";
import { SeparatedScenePass } from "./separatedScenePass.js";
import { GRAPHICS_EFFECTS, normalizeGraphicsEffects } from "./graphicsEffects.js";
import { graphicsLevel, normalizeGraphicsOptions, presetEffects } from "./graphicsPresets.js";

// AO depth and normals must describe the same surface. Light overlays keep
// their scene color, but cannot replace the normal of the solid beneath them.
const opaqueVelocity = Fn(([], builder) => vec4(velocity, 0, builder.material.depthWrite ? 1 : 0));
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
const surfaceNormal = Fn(([], builder) => {
  if (!builder.material.depthWrite) return vec4(0, 0, 0, 1);
  const n = (builder.material.clearcoat !== undefined
    ? mix(normalView, clearcoatNormalView, clearcoat).normalize() : normalView).toVar();
  const oct = n.xy.div(n.abs().dot(vec3(1))).toVar();
  If(n.z.lessThan(0), () => { oct.assign(oct.yx.abs().oneMinus().mul(oct.step(0).mul(2).sub(1))); });
  const surface = reflectionSurface();
  // Reserve zero/zero for overlays that do not write solid depth.
  return vec4(oct.mul(.5).add(.5).clamp(.004, .996), surface.r, surface.g);
});
const unpackOctNormal = Fn(([value]) => {
  const f = value.mul(2).sub(1);
  const n = vec3(f, float(1).sub(f.x.abs()).sub(f.y.abs())).toVar();
  const t = n.z.negate().clamp(0, 1);
  n.x.addAssign(n.x.greaterThanEqual(0).select(t.negate(), t));
  n.y.addAssign(n.y.greaterThanEqual(0).select(t.negate(), t));
  return n.normalize();
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
export function recoverInvalidAONormals(normal, depth, inverseProjection, packed = false) {
  const sample = Fn(([coord]) => {
    const stored = normal.sample(coord).toVar();
    const result = (packed ? unpackOctNormal(stored.rg) : stored.rgb).toVar();
    If(packed ? stored.r.add(stored.g).lessThan(.004) : stored.a.lessThan(.5), () => {
      result.assign(getNormalFromDepth(coord, depth.value, inverseProjection));
    });
    return result;
  });
  const result = sample(screenUV);
  result.sample = sample;
  return result;
}

export class NeonRenderPipeline {
  constructor(renderer, scene, camera, { reducedMotion = false, motionBlur = 0, effects, options, coarsePointer = false, quality = "high" } = {}) {
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
    this.explicitEffects = effects != null;
    this.explicitOptions = options != null;
    this.effects = effects ? normalizeGraphicsEffects(effects) : presetEffects(quality);
    this.options = normalizeGraphicsOptions(options, quality);
    this.motionBlurStrength = Math.max(0, Math.min(100, Number(motionBlur) || 0));
    this.motionBlur = null;
    this.quality = graphicsLevel(quality);
    this.coarsePointer = coarsePointer;
    this.scenePass = null;
    this.aoPass = null;
    this.reflectionPass = null;
    this.localFog = null;
    this.particleDepth = null;
    this.heatDistortion = null;
    this.contactShadows = null;
    this.pipeline = null;
    this.bloomPass = null;
    this.outputTargets = [];
    this.presentation = new CinematicPresentation();
    this.temporal = null;
    this.temporalWeight = uniform(.08);
    this.historyWarmup = 0;
    this.spatial = null;
    this.historyPosition = new THREE.Vector3();
    this.historyRotation = new THREE.Quaternion();
    this.historyTime = null;
    const nativeWebGPU = renderer.backend.isWebGPUBackend === true;
    this.nativeWebGPU = nativeWebGPU;
    this.direct = false;
    this.profile = nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webglBloom;
    this.setQuality(this.quality);
  }

  ensureQualityPipeline() {
    if (this.pipeline || this.direct) return;
    const { renderer, scene, camera, nativeWebGPU } = this;
    this.pipeline = new THREE.RenderPipeline(renderer);
    const temporal = nativeWebGPU && renderer.backend.compatibilityMode !== true && this.effects.antialiasing;
    const samples = 0;
    if (nativeWebGPU && this.effects.softParticles) this.particleDepth = new SoftParticleDepth();
    const split = nativeWebGPU && (this.effects.softParticles || this.effects.motionBlur || temporal || this.effects.ambientOcclusion || this.effects.reflections || this.effects.contactShadows);
    const scenePass = this.scenePass = split
      ? new SeparatedScenePass(scene, camera, this.particleDepth, { samples })
      : pass(scene, camera, { samples });
    scenePass.setResolutionScale(this.options.renderScale);
    const outputs = { output };
    if (this.effects.bloom) outputs.bloom = bloomEmission();
    const needsNormal = nativeWebGPU && (this.effects.ambientOcclusion || this.effects.reflections || this.effects.contactShadows);
    if (needsNormal) outputs.normal = surfaceNormal();
    if (nativeWebGPU && (this.effects.motionBlur || temporal)) outputs.velocity = opaqueVelocity();
    const attachments = mrt(outputs);
    if (outputs.bloom) attachments.setBlendMode("bloom", new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(attachments);
    for (const name of Object.keys(outputs)) {
      const texture = scenePass.getTexture(name);
      // Octahedral normals use RG, reflectivity B and roughness A. Four targets
      // fit WebGPU's guaranteed 32-byte attachment budget with no larger limit.
      if (name === "normal") {
        texture.type = THREE.UnsignedByteType;
        texture.minFilter = texture.magFilter = THREE.NearestFilter;
      }
    }
    const sceneColor = scenePass.getTextureNode("output");
    const depth = scenePass.getTextureNode("depth");
    const vectors = outputs.velocity ? scenePass.getTextureNode("velocity") : null;
    if (nativeWebGPU && this.effects.motionBlur) this.motionBlur = new CinematicMotionBlur({ node: depth, velocity: vectors }, camera);
    if (this.effects.bloom) {
      this.bloomPass = bloom(scenePass.getTextureNode("bloom"), .4,
        this.quality === "high" || this.quality === "ultra" ? .3 : .25, EMISSION_THRESHOLD);
      this.bloomPass.setResolutionScale(this.options.renderScale * this.options.bloomScale);
    }
    const normal = needsNormal ? recoverInvalidAONormals(scenePass.getTextureNode("normal"), depth,
      uniform(camera.projectionMatrixInverse), true) : null;
    if (nativeWebGPU && this.effects.heatDistortion) this.heatDistortion = new HeatDistortion(depth, camera);
    const sceneUV = this.heatDistortion ? this.heatDistortion.node(screenUV) : screenUV;
    let grounding = float(1);
    if (nativeWebGPU && this.effects.ambientOcclusion) {
      const aoPass = this.aoPass = ao(depth, normal, camera);
      aoPass.resolutionScale = this.options.renderScale * .5;
      aoPass.radius.value = 1.6;
      aoPass.thickness.value = 2.2;
      aoPass.distanceExponent.value = 1.35;
      aoPass.distanceFallOff.value = .7;
      aoPass.samples.value = this.options.aoSamples;
      grounding = aoPass.getTextureNode().sample(sceneUV).r.mul(.34).add(.66);
    }
    let litScene = sceneColor.sample(sceneUV).mul(vec4(vec3(grounding), 1));
    if (nativeWebGPU && this.effects.reflections) {
      const surface = scenePass.getTextureNode("normal");
      const reflections = this.reflectionPass = ssr(sceneColor, depth, normal, {
        camera, metalnessNode: surface.b, roughnessNode: surface.a,
        binaryRefine: true
      });
      reflections.resolutionScale = this.options.renderScale * this.options.ssrScale;
      reflections.maxDistance.value = 28;
      reflections.thickness.value = .22;
      reflections.quality.value = this.options.ssrScale;
      reflections.intensity.value = .45;
      reflections.maxLuminance.value = 3;
      const edge = screenUV.min(screenUV.oneMinus()).mul(12).clamp(0, 1);
      litScene = litScene.add(vec4(reflections.getTextureNode().sample(sceneUV).rgb.mul(edge.x.mul(edge.y)), 0));
    }
    const key = scene.children.find(light => light.isDirectionalLight && light.castShadow);
    if (nativeWebGPU && key) {
      if (this.effects.contactShadows) {
        this.contactShadows = contactShadows(depth, normal, camera, key);
        litScene = vec4(litScene.rgb.mul(this.contactShadows.node(sceneUV)), litScene.a);
      }
      if (this.effects.localFog) {
        this.localFog = localFog(depth, camera, key, { resolutionScale: this.options.renderScale * .5 });
        const air = this.localFog.node(sceneUV);
        litScene = vec4(litScene.rgb.mul(air.a).add(air.rgb), litScene.a);
        // Binding after the scene pass follows the real shadow owner. No
        // throwaway scene render is necessary to initialize a shadow texture.
        const update = scenePass.updateBefore.bind(scenePass);
        scenePass.updateBefore = frame => { update(frame); this.localFog.update(); };
      }
    }
    this.finishOutput(this.pipeline, this.bloomPass ? litScene.add(this.bloomPass.getTextureNode().sample(sceneUV)) : litScene,
      { temporal, depth, vectors });
  }

  outputTarget(node, scale = this.options.renderScale, type = THREE.HalfFloatType) {
    const target = rtt(node, null, null, { type, depthBuffer: false });
    target.setResolutionScale(scale);
    this.outputTargets.push(target);
    return target;
  }

  finishOutput(pipeline, node, { temporal = false, depth = null, vectors = null } = {}) {
    // Accumulate HDR before the grade and animated grain. Jitter therefore never
    // affects HUD text and bloom/fire use the same exposure as solid geometry.
    let resolved = temporal || this.motionBlur ? this.outputTarget(node) : node;
    if (temporal) {
      this.temporal = taau(resolved, depth, vectors, this.camera);
      this.temporal.currentFrameWeight = this.temporalWeight;
      this.temporal.maxVelocityLength = 72;
      resolved = this.temporal.getTextureNode();
    }
    if (this.motionBlur) resolved = this.outputTarget(this.motionBlur.node(resolved), temporal ? 1 : this.options.renderScale);
    resolved = this.outputTarget(renderOutput(resolved, this.renderer.toneMapping, this.renderer.outputColorSpace),
      temporal ? 1 : this.options.renderScale, THREE.UnsignedByteType);
    if (!temporal && this.effects.antialiasing) resolved = this.outputTarget(fxaa(resolved), this.options.renderScale, THREE.UnsignedByteType);
    if (!temporal && this.options.renderScale < 1) {
      this.spatial = fsr1(resolved, .6, true);
      resolved = this.spatial.getTextureNode();
    }
    pipeline.outputColorTransform = false;
    pipeline.outputNode = this.presentation.node(resolved);
  }

  updatePresentation(state = {}) {
    this.presentation?.update(state, this.reducedMotion);
  }

  resetHistory() {
    this.motionBlur?.reset();
    // Seed from the current image for two frames. A uniform avoids reallocating
    // native-resolution history targets on a respawn, pause or long frame.
    this.historyWarmup = 2;
    this.temporalWeight.value = 1;
    this.historyTime = null;
  }

  async prepareScene(roots, valid = () => true) {
    // WebGL drivers can block for seconds when first-use linking happens in a
    // draw. Use Three's parallel compilation behind the loading screen, retaining
    // its resources until this promise settles, before submitting real draws.
    if (this.nativeWebGPU) return;
    const renderer = this.renderer;
    const state = THREE.RendererUtils.saveRendererState(renderer);
    try {
      if (!this.direct) {
        const pass = this.scenePass;
        pass.renderTarget.samples = pass.options.samples;
        pass.renderTarget.texture.type = renderer.getOutputBufferType();
        renderer.setRenderTarget(pass.renderTarget);
        renderer.setMRT(pass.getMRT());
      }
      const objects = new Set();
      for (const root of roots) root.traverseVisible(object => {
        if (object.isMesh || object.isLine || object.isPoints || object.isSprite) objects.add(object);
      });
      // One object at a time gives navigation/configuration changes a safe
      // cancellation boundary instead of finishing an obsolete scene walk.
      for (const object of objects) {
        if (!valid()) return;
        await renderer.compileAsync(object, this.camera, this.scene);
      }
    } finally { THREE.RendererUtils.restoreRendererState(renderer, state); }
  }

  async prepareRender(valid = () => true) {
    if (!valid()) return false;
    if (!this.nativeWebGPU) { this.render(); return valid(); }
    const backend = this.renderer.backend, create = backend.createRenderPipeline;
    // Exercise the exact shadow/depth/post graph, including nested pass contexts.
    // Three skips draws until their async pipelines are ready. Scope this hook to
    // the synchronous discovery render; normal frames retain the native backend.
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!valid()) return false;
      const pending = [], pipelines = [];
      try {
        backend.createRenderPipeline = (object, promises) => {
          const result = create.call(backend, object, promises ?? pending);
          pipelines.push(object.pipeline);
          return result;
        };
        try { this.render(); }
        finally { backend.createRenderPipeline = create; }
        await Promise.all(pending);
      } catch (error) {
        // Keep owners alive even if one shader or render fails before the rest.
        await Promise.allSettled(pending);
        throw error;
      }
      if (!valid()) return false;
      // Three resolves native compilation promises even after a shader error.
      if (pipelines.some(pipeline => backend.get(pipeline).error)) throw Error("Graphics shader compilation failed");
      if (!pending.length) return true;
    }
    throw Error("Graphics pipeline preparation did not settle");
  }

  render() {
    if (this.direct) return this.renderer.render(this.scene, this.camera);
    try {
      const now = performance.now();
      if (this.historyTime !== null && (now - this.historyTime > 150
        || this.historyPosition.distanceToSquared(this.camera.position) > 25
        || Math.abs(this.historyRotation.dot(this.camera.quaternion)) < .9
        || Math.abs(this.historyFov - this.camera.fov) > 5)) this.resetHistory();
      this.historyTime = now;
      this.historyPosition.copy(this.camera.position);
      this.historyRotation.copy(this.camera.quaternion);
      this.historyFov = this.camera.fov;
      this.motionBlur?.update(this.renderer, this.motionBlurStrength, !this.reducedMotion && this.motionBlurStrength > 0);
      this.heatDistortion?.update(this.scene, this.camera, this.reducedMotion);
      this.pipeline.render();
      if (this.historyWarmup > 0 && --this.historyWarmup === 0) this.temporalWeight.value = .08;
    } catch (error) {
      this.camera.clearViewOffset?.();
      velocity.setProjectionMatrix(null);
      this.degradeToDirect(error);
      this.renderer.render(this.scene, this.camera);
    }
  }

  setReducedMotion(reducedMotion) {
    this.reducedMotion = Boolean(reducedMotion);
    this.resetHistory();
    if (this.reducedMotion) this.presentation?.update({}, true);
    this.updateBloomQuality();
  }

  setMotionBlur(value) {
    this.motionBlurStrength = Math.max(0, Math.min(100, Number(value) || 0));
    this.motionBlur?.reset();
  }

  updateBloomQuality() {
    if (!this.bloomPass) return;
    this.bloomPass.strength.value = this.reducedMotion ? .22
      : this.quality === 'low' ? .3 : this.quality === 'medium' ? .36 : .52;
    this.bloomPass.setResolutionScale(this.options.renderScale * this.options.bloomScale);
  }

  setQuality(quality = 'high') {
    const next = graphicsLevel(quality);
    if (next !== this.quality && this.pipeline) this.disposePipelineResources();
    this.quality = next;
    if (!this.explicitEffects) this.effects = presetEffects(this.quality);
    if (!this.explicitOptions) this.options = normalizeGraphicsOptions(null, this.quality);
    this.renderQuality = this.nativeWebGPU && Object.entries(GRAPHICS_EFFECTS).some(([key, effect]) => effect.high && this.effects[key])
      ? 'high' : 'medium';
    if (this.direct) return this.quality;
    this.ensureQualityPipeline();
    this.updateBloomQuality();
    const backend = this.nativeWebGPU ? TEXT.performanceProfiles.webgpu : TEXT.performanceProfiles.webgl;
    this.profile = backend + ' / ' + (this.temporal ? 'Temporal native output' : 'Spatial native output') + ' / ' + this.quality;
    return this.quality;
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
    this.presentation?.dispose();
    this.presentation = null;
    this.direct = true;
    this.profile = TEXT.performanceProfiles.directSafety;
  }

  dispose() {
    this.disposePipelineResources();
    this.presentation?.dispose();
    this.presentation = null;
  }

  disposePipelineResources() {
    this.motionBlur = null;
    this.temporal?.dispose();
    this.temporal = null;
    this.spatial?.dispose();
    this.spatial = null;
    // r185 RTTNode has no resource-disposal override.
    for (const target of this.outputTargets || []) {
      target.renderTarget.dispose();
      target._quadMesh.material.dispose();
    }
    this.outputTargets = [];
    this.contactShadows = null;
    this.heatDistortion = null;
    this.particleDepth?.dispose();
    this.particleDepth = null;
    this.localFog?.dispose();
    this.localFog = null;
    // Three r185 GTAO.dispose omits its per-instance noise texture.
    this.aoPass?._noiseNode?.value.dispose();
    for (const resource of [this.pipeline, this.scenePass, this.bloomPass, this.aoPass, this.reflectionPass]) resource?.dispose?.();
    this.pipeline = null;
    this.scenePass = null;
    this.bloomPass = null;
    this.aoPass = null;
    this.reflectionPass = null;
  }
}
