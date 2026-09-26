import { GRAPHICS_EFFECTS, normalizeGraphicsEffects } from './graphicsEffects.js';

export const GRAPHICS_VERSION = 2;
export const GRAPHICS_OPTIONS = {
  renderScale: [.25, .5, .65, .75, 1], msaaSamples: [0, 4], shadowMapSize: [0, 512, 1024, 2048, 4096],
  aoSamples: [8, 16, 32], ssrScale: [.5, 1], bloomScale: [.34, .5, 1],
  combatQuality: [.25, .5, .75, 1], combatLights: [1, 2, 4], detailDistance: [24, 48, 72, 96],
  atmosphereCount: [0, 80, 150, 220], anisotropy: [4, 8, 16]
};
const high = { renderScale: .75, msaaSamples: 0, shadowMapSize: 2048, aoSamples: 16, ssrScale: .5,
  bloomScale: .5, combatQuality: 1, combatLights: 4, detailDistance: 96, atmosphereCount: 220, anisotropy: 16 };
export const GRAPHICS_PRESETS = {
  low: { ...high, renderScale: .5, shadowMapSize: 0, combatQuality: .25, combatLights: 1, detailDistance: 24, atmosphereCount: 0, anisotropy: 4 },
  medium: { ...high, renderScale: .65, shadowMapSize: 1024, bloomScale: .34, combatQuality: .75, combatLights: 2, detailDistance: 72, atmosphereCount: 150, anisotropy: 8 },
  high,
  ultra: { ...high, renderScale: 1, msaaSamples: 4, shadowMapSize: 4096, aoSamples: 32 }
};
export const graphicsLevel = level => Object.hasOwn(GRAPHICS_PRESETS, level) ? level : 'high';

export function presetEffects(level) {
  const effects = normalizeGraphicsEffects();
  for (const [key, effect] of Object.entries(GRAPHICS_EFFECTS)) {
    if (level === 'low') effects[key] = ['wetSurfaces', 'waterCaustics', 'distanceHaze'].includes(key);
    else if (level === 'medium' && effect.high) effects[key] = false;
  }
  return effects;
}

export function normalizeGraphicsOptions(saved, level) {
  const defaults = GRAPHICS_PRESETS[graphicsLevel(level)];
  return Object.fromEntries(Object.entries(GRAPHICS_OPTIONS).map(([key, values]) =>
    [key, values.includes(saved?.[key]) ? saved[key] : defaults[key]]));
}

export function applyGraphicsPreset(settings, level) {
  settings.graphics = graphicsLevel(level);
  settings.graphicsVersion = GRAPHICS_VERSION;
  settings.graphicsOptions = { ...GRAPHICS_PRESETS[settings.graphics] };
  settings.graphicsEffects = presetEffects(settings.graphics);
  settings.motionBlur = settings.graphicsEffects.motionBlur ? 35 : 0;
}

export function isCustomGraphics(settings) {
  const defaults = GRAPHICS_PRESETS[graphicsLevel(settings.graphics)], effects = presetEffects(settings.graphics);
  return Object.keys(defaults).some(key => settings.graphicsOptions?.[key] !== defaults[key])
    || Object.keys(effects).some(key => settings.graphicsEffects?.[key] !== effects[key])
    || settings.motionBlur !== (effects.motionBlur ? 35 : 0);
}
