// Preferences survive tier changes; availability only determines what runs now.
export const GRAPHICS_EFFECTS = {
  antialiasing: { group: 'rendering', post: true },
  bloom: { group: 'rendering', post: true },
  reflections: { group: 'rendering', post: true, high: true },
  ambientOcclusion: { group: 'rendering', post: true, high: true },
  contactShadows: { group: 'rendering', post: true, high: true },
  localFog: { group: 'rendering', post: true, high: true },
  softParticles: { group: 'rendering', post: true, high: true },
  heatDistortion: { group: 'motion', post: true, high: true, motion: true },
  motionBlur: { group: 'motion', post: true, high: true, motion: true },
  environmentMotion: { group: 'motion', motion: true },
  mechaMotion: { group: 'motion', motion: true },
  weaponMotion: { group: 'motion', motion: true },
  wetSurfaces: { group: 'world' },
  waterCaustics: { group: 'world' },
  clouds: { group: 'world', atmosphere: true },
  horizonMist: { group: 'world', atmosphere: true },
  atmosphericMotes: { group: 'world' },
  distanceHaze: { group: 'world' },
  impactMarks: { group: 'world' }
};

export function normalizeGraphicsEffects(saved) {
  return Object.fromEntries(Object.keys(GRAPHICS_EFFECTS).map(key => [key, typeof saved?.[key] === 'boolean' ? saved[key] : true]));
}

export function graphicsEffectUnavailable(key, { quality = 'high', nativeWebGPU = true, reducedMotion = false, direct = false } = {}) {
  const effect = GRAPHICS_EFFECTS[key];
  if (effect.high && !nativeWebGPU) return 'webgpu';
  if (effect.post && direct) return 'fallback';
  if (effect.high && quality !== 'high') return 'high';
  if ((effect.post || effect.atmosphere) && quality === 'low') return 'medium';
  if (effect.motion && reducedMotion) return 'reduced';
  return '';
}
