// Marketing-only snapshot read from the user's live graphics panel on 28 October 2026.
// Keep explicit values: future changes to a production preset must not silently change captures.
export const MARKETING_GRAPHICS_ID = "browser-ultra-2026-10-28";
export const MARKETING_GRAPHICS_SHA256 = "bcd1bf54cd9da4219d8a7ce335f73e7a3c5edea946903d00abe93a9be6ebbdaa";
export const MARKETING_GRAPHICS = Object.freeze({
  graphics: "ultra", graphicsVersion: 3, reducedMotion: false, motionBlur: 35,
  graphicsOptions: Object.freeze({
    renderScale: 1, msaaSamples: 0, shadowMapSize: 4096, aoSamples: 32,
    ssrScale: .5, bloomScale: .5, combatQuality: 1, combatLights: 4,
    detailDistance: 96, atmosphereCount: 220, anisotropy: 16
  }),
  graphicsEffects: Object.freeze({
    antialiasing: true, bloom: true, reflections: true, ambientOcclusion: true,
    contactShadows: true, localFog: true, softParticles: true, heatDistortion: true,
    motionBlur: true, environmentMotion: true, mechaMotion: true, weaponMotion: true,
    wetSurfaces: true, waterCaustics: true, clouds: true, horizonMist: true,
    atmosphericMotes: true, distanceHaze: true, impactMarks: true
  })
});

export function applyMarketingGraphics(settings) {
  return Object.assign(settings, MARKETING_GRAPHICS, {
    graphicsOptions: { ...MARKETING_GRAPHICS.graphicsOptions },
    graphicsEffects: { ...MARKETING_GRAPHICS.graphicsEffects }
  });
}

export function marketingGraphicsEvidence(game) {
  const settings = game.settings, pipeline = game.renderPipeline;
  const values = Object.fromEntries(Object.keys(MARKETING_GRAPHICS).map(key => [key,
    typeof settings[key] === "object" ? { ...settings[key] } : settings[key]]));
  const active = Object.fromEntries(["temporal", "aoPass", "reflectionPass", "bloomPass", "contactShadows",
    "localFog", "particleDepth", "heatDistortion", "motionBlur"].map(key => [key, Boolean(pipeline?.[key])]));
  const effective = {
    quality: pipeline?.quality, options: { ...pipeline?.options }, effects: { ...pipeline?.effects },
    reducedMotion: pipeline?.reducedMotion, motionBlur: pipeline?.motionBlurStrength,
    nativeWebGPU: pipeline?.nativeWebGPU === true,
    compatibilityMode: game.renderer?.backend?.compatibilityMode === true,
    directFallback: pipeline?.direct === true, active
  };
  const same = (actual, expected) => Object.entries(expected).every(([key, value]) => actual?.[key] === value);
  const matches = values.graphics === MARKETING_GRAPHICS.graphics && values.graphicsVersion === MARKETING_GRAPHICS.graphicsVersion
    && values.reducedMotion === MARKETING_GRAPHICS.reducedMotion && values.motionBlur === MARKETING_GRAPHICS.motionBlur
    && same(values.graphicsOptions, MARKETING_GRAPHICS.graphicsOptions) && same(values.graphicsEffects, MARKETING_GRAPHICS.graphicsEffects)
    && effective.quality === MARKETING_GRAPHICS.graphics && same(effective.options, MARKETING_GRAPHICS.graphicsOptions)
    && same(effective.effects, MARKETING_GRAPHICS.graphicsEffects) && effective.reducedMotion === false
    && effective.motionBlur === MARKETING_GRAPHICS.motionBlur && effective.nativeWebGPU
    && !effective.compatibilityMode && !effective.directFallback && Object.values(active).every(Boolean);
  return {
    id: MARKETING_GRAPHICS_ID,
    snapshotSha256: MARKETING_GRAPHICS_SHA256, settings: values, effective, matches
  };
}

export function requireMarketingGraphics(game) {
  const evidence = marketingGraphicsEvidence(game);
  if (!evidence.matches) throw Error("Marketing capture requires the saved browser Ultra settings and complete native WebGPU temporal pipeline; do not lower quality silently");
  return evidence;
}
