import assert from "node:assert/strict";
import { analyzeAudioAsset, createProceduralAudioAssets } from "../src/audioAssets.js";

const assets = createProceduralAudioAssets(48000);
const duplicate = createProceduralAudioAssets(48000);
const expected = [
  "kick", "snare", "clap", "hatClosed", "hatOpen", "impact", "explosion", "ballistic", "energy", "mechanical",
  "heavyUi", "whoosh", "iceCrack", "cableSnap", "flame", "footstep", "transition",
  "chargeLoop", "weaponLoop", "grappleLoop", "hazardLoop", "projectileLoop", "ambienceFoundry", "ambienceIon", "ambienceSolar"
];
assert.deepEqual(Object.keys(assets), expected, "the produced transient bank exposes every music and gameplay family");

for (const name of expected) {
  const data = assets[name], analysis = analyzeAudioAsset(data);
  const loop = name.endsWith("Loop") || name.startsWith("ambience");
  assert.ok(data instanceof Float32Array && data.length >= 4800, `${name} is a rendered audio asset rather than a live oscillator preset`);
  assert.deepEqual(data, duplicate[name], `${name} is deterministic across devices and match sessions`);
  assert.ok(analysis.peak >= (loop ? .6 : .7) && analysis.peak <= .95, `${name} uses headroom without clipping`);
  assert.ok(analysis.rms > .1, `${name} has a materially audible body`);
  assert.ok(analysis.crest > (loop ? 1.35 : 2.5) && analysis.crest < 8, `${name} preserves ${loop ? "texture dynamics" : "transient punch"} without pathological peaks`);
  assert.ok(analysis.motion > .001, `${name} contains real spectral movement`);
}

const kick = analyzeAudioAsset(assets.kick), snare = analyzeAudioAsset(assets.snare), flame = analyzeAudioAsset(assets.flame);
assert.ok(snare.crossings > kick.crossings * 40 && snare.motion > kick.motion * 20, "drum assets occupy deliberately different spectral roles");
assert.ok(flame.crossings > kick.crossings * 50 && flame.crest > kick.crest, "sustained flame has textured air instead of a pitched beep");
assert.ok(assets.explosion.length > assets.impact.length * 3, "explosions carry a long cinematic body and debris tail");
assert.ok(assets.hatOpen.length > assets.hatClosed.length * 4, "open and closed hats have authored, perceptibly different decays");

const periodicity = (data) => {
  let best = 0;
  for (const lag of [47, 83, 131, 211, 337, 547]) {
    let correlation = 0, energyA = 0, energyB = 0;
    for (let index = lag; index < data.length; index += 7) {
      const a = data[index], b = data[index - lag];
      correlation += a * b; energyA += a * a; energyB += b * b;
    }
    best = Math.max(best, Math.abs(correlation) / Math.max(.000001, Math.sqrt(energyA * energyB)));
  }
  return best;
};
for (const name of ["energy", "mechanical", "heavyUi", "chargeLoop", "weaponLoop", "grappleLoop", "hazardLoop", "projectileLoop"]) {
  assert.ok(periodicity(assets[name]) < .72, `${name} is textured foley rather than a sustained periodic beep`);
}

console.log("Rendered procedural sample-bank dynamics, headroom, and timbral separation checks passed.");
