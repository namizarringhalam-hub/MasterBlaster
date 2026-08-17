import assert from "node:assert/strict";
import { analyzeAudioAsset, createProceduralAudioAssets } from "../src/audioAssets.js";

const assets = createProceduralAudioAssets(48000);
const duplicate = createProceduralAudioAssets(48000);
const expected = ["kick", "snare", "clap", "hatClosed", "hatOpen", "impact", "explosion", "ballistic", "energy", "mechanical", "flame", "footstep", "transition"];
assert.deepEqual(Object.keys(assets), expected, "the produced transient bank exposes every music and gameplay family");

for (const name of expected) {
  const data = assets[name], analysis = analyzeAudioAsset(data);
  assert.ok(data instanceof Float32Array && data.length >= 4800, `${name} is a rendered audio asset rather than a live oscillator preset`);
  assert.deepEqual(data, duplicate[name], `${name} is deterministic across devices and match sessions`);
  assert.ok(analysis.peak >= .7 && analysis.peak <= .95, `${name} uses headroom without clipping`);
  assert.ok(analysis.rms > .1, `${name} has a materially audible body`);
  assert.ok(analysis.crest > 2.5 && analysis.crest < 8, `${name} preserves transient punch without pathological peaks`);
  assert.ok(analysis.motion > .001, `${name} contains real spectral movement`);
}

const kick = analyzeAudioAsset(assets.kick), snare = analyzeAudioAsset(assets.snare), flame = analyzeAudioAsset(assets.flame);
assert.ok(snare.crossings > kick.crossings * 40 && snare.motion > kick.motion * 20, "drum assets occupy deliberately different spectral roles");
assert.ok(flame.crossings > kick.crossings * 50 && flame.crest > kick.crest, "sustained flame has textured air instead of a pitched beep");
assert.ok(assets.explosion.length > assets.impact.length * 3, "explosions carry a long cinematic body and debris tail");
assert.ok(assets.hatOpen.length > assets.hatClosed.length * 4, "open and closed hats have authored, perceptibly different decays");

console.log("Rendered procedural sample-bank dynamics, headroom, and timbral separation checks passed.");
