import assert from "node:assert/strict";
import {
  MUSIC,
  hashMusicSeed,
  musicEventsForBar,
  musicEventsForStep,
  musicSectionForBar,
  noteFrequency,
  seededMusicChoice,
  seededMusicRandom
} from "../src/musicScore.js";

assert.equal(MUSIC.bpm, 132);
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
assert.equal(musicSectionForBar(12).name, "b");
assert.equal(musicSectionForBar(16).name, "breakdown");
assert.equal(musicSectionForBar(20).name, "drop");
assert.equal(musicSectionForBar(32).name, "intro");

const input = { seed: "BLAST-01", bar: 21, scene: "combat", intensity: .9 };
const score = musicEventsForBar(input);
assert.deepEqual(score, musicEventsForBar(input), "the same match state always creates the same score");
assert.ok(score.length > 20, "a high-intensity drop has a complete arrangement");
assert.ok(score.some((event) => event.layer === "lead"));
assert.ok(score.some((event) => event.layer === "kick"));
assert.ok(score.some((event) => event.layer === "snare"));
assert.ok(score.some((event) => event.layer === "hat"));
assert.ok(score.some((event) => event.layer === "arp"));
assert.ok(score.every((event) => Number.isFinite(event.frequency) && event.frequency > 0));
assert.ok(score.every((event) => event.step >= 0 && event.step < MUSIC.stepsPerBar));
assert.ok(score.every((event) => event.durationSteps > 0 && event.durationSteps <= MUSIC.stepsPerBar));
assert.ok(score.every((event) => event.gain > 0 && event.gain <= 1));
assert.ok(score.every((event) => event.pan >= -1 && event.pan <= 1));

const quiet = musicEventsForBar({ seed: "BLAST-01", bar: 8, scene: "combat", intensity: .1 });
assert.ok(quiet.some((event) => event.layer === "pad"));
assert.ok(!quiet.some((event) => ["kick", "hat", "arp", "lead"].includes(event.layer)));

const medium = musicEventsForBar({ seed: "BLAST-01", bar: 8, scene: "combat", intensity: .6 });
assert.ok(medium.some((event) => event.layer === "kick"));
assert.ok(medium.some((event) => event.layer === "arp"));
assert.ok(!medium.some((event) => event.layer === "lead"));

assert.deepEqual(musicEventsForStep({ scene: "paused" }), []);
assert.ok(musicEventsForBar({ scene: "menu" }).every((event) => ["pad", "sub", "menu-motif"].includes(event.layer)));
assert.ok(musicEventsForBar({ scene: "countdown" }).some((event) => event.layer === "riser"));
assert.ok(musicEventsForBar({ scene: "results-win" }).some((event) => event.layer === "result-motif"));
const sectionKickCounts = [4, 12, 16, 20, 28].map((bar) => musicEventsForBar({ bar, scene: "combat", intensity: 1 }).filter((event) => event.layer === "kick").length);
assert.ok(new Set(sectionKickCounts).size >= 4, "intro/A/B/breakdown/drop/resolve use materially different rhythm density");
const dominantMelody = musicEventsForBar({ bar: 3, scene: "combat", intensity: 1 }).filter((event) => ["lead", "arp"].includes(event.layer));
assert.ok(dominantMelody.every((event) => event.midi % 12 !== 0), "the A-major dominant avoids a clashing C-natural in melodic voices");
const dominantVictory = musicEventsForBar({ bar: 3, scene: "results-win", intensity: 1 }).filter((event) => event.layer === "result-motif");
assert.ok(dominantVictory.every((event) => event.midi % 12 !== 0), "victory motifs preserve the A-major dominant's C-sharp");
assert.ok(musicEventsForBar({ bar: 31, scene: "combat", intensity: 1 }).some((event) => event.layer === "cadence"), "the 32-bar form earns a composed cadence before looping");
assert.doesNotThrow(() => musicEventsForBar({ bar: -5, step: 200, intensity: Infinity, scene: "unknown" }));

console.log("Deterministic adaptive music score checks passed.");
