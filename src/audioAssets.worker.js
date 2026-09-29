import { createProceduralAudioAssets, createWeaponAudioAssets } from "./audioAssets.js";
import { generatedResource } from "./generatedResourceStore.js";

self.onmessage = async ({ data }) => {
  try {
    const sampleRate = Number(data?.sampleRate) || 48000;
    const entries = await generatedResource(["audio", sampleRate, data?.weapons, data?.identities], () => Object.entries({
      ...createProceduralAudioAssets(sampleRate),
      ...createWeaponAudioAssets(sampleRate, data?.weapons || [], data?.identities || {})
    }), value => Array.isArray(value) && value.length > 0 && value.every(entry => Array.isArray(entry) && typeof entry[0] === "string" && entry[1] instanceof Float32Array));
    self.postMessage({ sampleRate, entries }, entries.map(([, samples]) => samples.buffer));
  } catch { self.postMessage({ error: true }); }
};
