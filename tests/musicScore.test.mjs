import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MUSIC, MUSIC_SAMPLE_MANIFEST, combatMusicIntensity, hashMusicSeed, musicEventsForBar,
  musicEventsForStep, musicSectionForBar, noteFrequency, seededMusicChoice,
  seededMusicRandom, tempoForIntensity
} from "../src/musicScore.js";

assert.equal(MUSIC.countdownBpm, 132);
assert.deepEqual(MUSIC.tempoTiers, [118, 132, 146, 156]);
assert.equal(MUSIC.stepsPerBar, 16);
assert.ok(Math.abs(noteFrequency(69) - 440) < Number.EPSILON);
assert.throws(() => noteFrequency(NaN), /finite/);
assert.equal(hashMusicSeed("BLAST-01"), hashMusicSeed("BLAST-01"));
assert.notEqual(hashMusicSeed("BLAST-01"), hashMusicSeed("BLAST-02"));

const first = seededMusicRandom("arena");
const second = seededMusicRandom("arena");
assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
assert.equal(seededMusicChoice(["a", "b", "c"], "choice"), seededMusicChoice(["a", "b", "c"], "choice"));
assert.equal(seededMusicChoice([], "choice"), undefined);

assert.equal(musicSectionForBar(0).name, "intro");
assert.equal(musicSectionForBar(12).name, "assault");
assert.equal(musicSectionForBar(16).name, "breath");
assert.equal(musicSectionForBar(20).name, "onslaught");
assert.equal(musicSectionForBar(32).name, "intro");

assert.equal(tempoForIntensity(.2, 132), 118, "quiet combat drops by one beat-aligned tempo tier");
assert.equal(tempoForIntensity(.7, 132), 146, "active combat rises by one tier");
assert.equal(tempoForIntensity(.58, 146), 146, "hysteresis prevents tempo flutter near a boundary");
assert.equal(tempoForIntensity(.48, 146), 132, "tempo relaxes only after crossing the lower hysteresis boundary");
assert.equal(tempoForIntensity(1, 146), 156, "maximum pressure reaches the fastest authored tier");

const quietTelemetry = combatMusicIntensity({});
const hecticTelemetry = combatMusicIntensity({ combatPulse: 1, nearbyEnemies: 1, nearbyProjectiles: 1, nearbyHazards: 1, healthDanger: 1, speed: 1, finalMinute: 1, scorePressure: 1 });
assert.ok(quietTelemetry < .2 && hecticTelemetry > .95, "actual fight density spans calm and peak adaptive-music states");

let recordingCount = 0;
for (const [name, asset] of Object.entries(MUSIC_SAMPLE_MANIFEST)) {
  for (const fileConfig of asset.files) {
    recordingCount++;
    const file = new URL(`../public${fileConfig.url}`, import.meta.url);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 25_000, `${name} is a substantive recorded performance, not a tiny generated blip`);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WAVE");
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) / 2);
    let sum = 0;
    for (const sample of samples) sum += (sample / 32768) ** 2;
    const calibratedRms = Math.sqrt(sum / samples.length) * fileConfig.trim;
    assert.ok(calibratedRms >= .074 && calibratedRms <= .122, `${fileConfig.url} has calibrated source loudness (${calibratedRms.toFixed(3)} RMS)`);
  }
}
assert.ok(Object.keys(MUSIC_SAMPLE_MANIFEST).length >= 8, "the score has a broad recorded low-orchestral and percussion palette");
assert.ok(recordingCount >= 23, "recurring percussion and pitched instruments use round robins or nearby root zones");
for (const name of ["battleDrum", "fieldSnare"]) assert.ok(MUSIC_SAMPLE_MANIFEST[name].files.length >= 3, `${name} avoids machine-gun repetition with three recorded takes`);
for (const name of ["celloSpic", "celloTrem", "hornStaccato", "hornSustain"]) {
  assert.deepEqual(MUSIC_SAMPLE_MANIFEST[name].files.slice(0, 3).map((file) => file.rootMidi), [38, 45, 48], `${name} has closely spaced lower root zones`);
}
const allScoreEvents = [];
for (const scene of ["menu", "combat", "countdown", "results-win", "results-loss"]) {
  for (let bar = 0; bar < 32; bar++) for (const intensity of [.1, .55, 1]) allScoreEvents.push(...musicEventsForBar({ seed: "REGISTER-QA", bar, scene, intensity }));
}
for (const event of allScoreEvents.filter((event) => Number.isFinite(event.midi))) {
  const roots = MUSIC_SAMPLE_MANIFEST[event.sample].files.map((file) => file.rootMidi).filter(Number.isFinite);
  assert.ok(Math.min(...roots.map((root) => Math.abs(event.midi - root))) <= 7, `${event.layer} MIDI ${event.midi} stays within seven semitones of a recorded root`);
}
assert.ok(allScoreEvents.every((event) => !["violinSpic", "celloPizz", "anvil"].includes(event.sample)), "no thin violin, plucked bong, or anvil-bong voice can enter any score scene");
assert.ok(Math.max(...allScoreEvents.filter((event) => Number.isFinite(event.midi)).map((event) => event.midi)) <= 63, "the entire score stays in a weighty low and middle register");

const input = { seed: "BLAST-01", bar: 21, scene: "combat", intensity: .9 };
const score = musicEventsForBar(input);
assert.deepEqual(score, musicEventsForBar(input), "the same match state always creates the same arrangement");
assert.ok(score.length > 24, "a high-intensity onslaught has a complete orchestral arrangement");
for (const layer of ["low-strings", "brass-bed", "cello-ostinato", "low-brass", "battle-drum", "field-snare", "horn-accent", "brass-answer"]) {
  assert.ok(score.some((event) => event.layer === layer), `${layer} participates in the onslaught arrangement`);
}
assert.ok(score.every((event) => event.kind === "recorded" && MUSIC_SAMPLE_MANIFEST[event.sample]), "all musical voices use recorded performances");
assert.ok(score.every((event) => event.step >= 0 && event.step < MUSIC.stepsPerBar));
assert.ok(score.every((event) => event.durationSteps > 0 && event.durationSteps <= MUSIC.stepsPerBar));
assert.ok(score.every((event) => event.gain > 0 && event.gain <= 1));

const quiet = musicEventsForBar({ seed: "BLAST-01", bar: 8, scene: "combat", intensity: .1 });
assert.ok(quiet.some((event) => event.layer === "low-strings"));
assert.ok(!quiet.some((event) => ["battle-drum", "field-snare", "horn-accent", "brass-answer"].includes(event.layer)));
assert.ok(score.length > quiet.length * 2, "fighting density adds real orchestral layers instead of merely turning up volume");

assert.deepEqual(musicEventsForStep({ scene: "paused" }), []);
assert.ok(musicEventsForBar({ scene: "menu" }).every((event) => event.kind === "recorded"));
const quietMenu = musicEventsForBar({ scene: "menu", intensity: .2, bar: 5 });
const activeMenu = musicEventsForBar({ scene: "menu", intensity: .95, bar: 5 });
assert.ok(activeMenu.length > quietMenu.length * 2, "menu actions add recorded percussion, strings, and brass rather than only raising volume");
for (const layer of ["menu-drum", "menu-strings-pulse", "menu-snare", "menu-brass-accent", "menu-rise"]) {
  assert.ok(activeMenu.some((event) => event.layer === layer), `${layer} joins a peak menu action transition`);
}
assert.ok(musicEventsForBar({ scene: "countdown" }).some((event) => event.layer === "countdown-cymbal"));
assert.ok(musicEventsForBar({ scene: "results-win" }).some((event) => event.layer === "result-brass-answer"));
assert.ok(musicEventsForBar({ scene: "results-win" }).some((event) => event.layer === "result-low-brass"));
assert.ok(musicEventsForBar({ bar: 31, scene: "combat", intensity: 1 }).some((event) => event.layer === "cadence"), "the 32-bar form earns a composed cadence before looping");
assert.doesNotThrow(() => musicEventsForBar({ bar: -5, step: 200, intensity: Infinity, scene: "unknown" }));

console.log("Recorded adaptive orchestral music score checks passed.");
