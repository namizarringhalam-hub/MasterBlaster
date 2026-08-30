import { createProceduralAudioAssets, createWeaponAudioAssets } from "./audioAssets.js";

self.onmessage = ({ data }) => {
  const sampleRate = Number(data?.sampleRate) || 48000;
  const assets = {
    ...createProceduralAudioAssets(sampleRate),
    ...createWeaponAudioAssets(sampleRate, data?.weapons || [], data?.identities || {})
  };
  const entries = Object.entries(assets);
  self.postMessage({ sampleRate, entries }, entries.map(([, samples]) => samples.buffer));
};
