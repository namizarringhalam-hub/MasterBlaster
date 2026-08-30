import assert from "node:assert/strict";
import { analyzeAudioAsset, createProceduralAudioAssets, createWeaponAudioAssets } from "../src/audioAssets.js";
import { WEAPON_AUDIO_IDENTITIES } from "../src/audio.js";
import { WEAPONS } from "../src/gameData.js";

const assets = createProceduralAudioAssets(48000);
const duplicate = createProceduralAudioAssets(48000);
const expected = [
  "kick", "snare", "clap", "hatClosed", "hatOpen", "impact", "explosion", "ballistic", "energy", "mechanical",
  "heavyUi", "whoosh", "iceCrack", "cableSnap", "flame", "footstep", "transition",
  "structuralWarning", "structuralBreak", "structuralFall", "structuralLand",
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
assert.ok(assets.structuralLand.length > assets.structuralBreak.length && assets.structuralBreak.length > assets.structuralWarning.length, "tower destruction escalates from stressed warning through fracture to a long debris landing tail");
assert.ok(analyzeAudioAsset(assets.structuralLand).rms > .1 && periodicity(assets.structuralWarning) < .72, "structural cues have physical low-frequency weight without tonal warning beeps");

const weaponAssets = createWeaponAudioAssets(48000, Object.values(WEAPONS), WEAPON_AUDIO_IDENTITIES);
const weaponAssetsAgain = createWeaponAudioAssets(48000, Object.values(WEAPONS), WEAPON_AUDIO_IDENTITIES);
const fireFingerprints = [];
for (const weapon of Object.values(WEAPONS)) {
  for (const kind of ["Fire", "Impact", "Operate"]) {
    const key = `weapon${kind}:${weapon.id}`;
    const data = weaponAssets[key], metrics = analyzeAudioAsset(data);
    assert.ok(data instanceof Float32Array && data.length >= 2400, `${weapon.name} owns a substantive ${kind.toLowerCase()} composite`);
    assert.deepEqual(data, weaponAssetsAgain[key], `${weapon.name} ${kind.toLowerCase()} is deterministic`);
    assert.ok(metrics.peak >= .75 && metrics.peak <= .95 && metrics.rms > .055, `${weapon.name} ${kind.toLowerCase()} has calibrated audible weight and headroom`);
    assert.ok(periodicity(data) < .8, `${weapon.name} ${kind.toLowerCase()} is textured rather than a clean beep`);
  }
  const fire = weaponAssets[`weaponFire:${weapon.id}`], metrics = analyzeAudioAsset(fire);
  const envelope = Array.from({ length: 8 }, (_, segment) => {
    const from = Math.floor(segment * fire.length / 8), to = Math.floor((segment + 1) * fire.length / 8);
    let energy = 0;
    for (let index = from; index < to; index++) energy += fire[index] ** 2;
    return Math.sqrt(energy / Math.max(1, to - from));
  });
  fireFingerprints.push({ id: weapon.id, values: [fire.length / 48000, metrics.rms, metrics.crest / 8, metrics.motion * 10, metrics.crossings / fire.length, ...envelope] });
  if (weapon.maintained) assert.ok(weaponAssets[`weaponLoop:${weapon.id}`], `${weapon.name} owns a dedicated maintained-operation loop`);
  if (weapon.chargeTime) assert.ok(weaponAssets[`weaponCharge:${weapon.id}`], `${weapon.name} owns a dedicated charge loop`);
  if (weapon.projectileSpeed > 0 && !weapon.hitscan) assert.ok(weaponAssets[`weaponFlight:${weapon.id}`], `${weapon.name} owns a dedicated projectile-flight loop`);
  if (weapon.hazard) assert.ok(weaponAssets[`weaponHazard:${weapon.id}`], `${weapon.name} owns a dedicated hazard loop`);
}
for (const [key, data] of Object.entries(weaponAssets).filter(([key]) => /weapon(?:Loop|Charge|Flight|Hazard):/.test(key))) {
  const rms = analyzeAudioAsset(data).rms;
  const seam = Math.abs(data[0] - data[data.length - 1]) / Math.max(.000001, rms);
  const slope = Math.abs((data[1] - data[0]) - (data[data.length - 1] - data[data.length - 2])) / Math.max(.000001, rms);
  assert.ok(seam < .01 && slope < .04, `${key} has a click-free amplitude and slope boundary`);
}
for (let left = 0; left < fireFingerprints.length; left++) for (let right = left + 1; right < fireFingerprints.length; right++) {
  const distance = Math.sqrt(fireFingerprints[left].values.reduce((sum, value, index) => sum + (value - fireFingerprints[right].values[index]) ** 2, 0));
  assert.ok(distance > .025, `${fireFingerprints[left].id} and ${fireFingerprints[right].id} retain measurably different duration, spectrum, dynamics, and temporal envelopes`);
}
const maintained = ["minigun", "flamethrower", "gravity_beam", "chainsaw"].map((id) => weaponAssets[`weaponLoop:${id}`]);
assert.equal(new Set(maintained).size, 4, "minigun, flamethrower, gravity beam, and chainsaw never share a maintained texture");

console.log("Rendered sample-bank dynamics and all 47 per-weapon composite identity checks passed.");
