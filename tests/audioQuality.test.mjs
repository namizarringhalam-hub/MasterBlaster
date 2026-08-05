import assert from "node:assert/strict";
import fs from "node:fs";
import { AUDIO_EVENTS, SoundBoard, spatialMix, weaponAudioProfile, WEAPON_AUDIO_IDENTITIES } from "../src/audio.js";
import { WEAPONS } from "../src/gameData.js";

const audioParam = (value = 0) => ({
  value,
  events: [],
  setTargetAtTime(next, at, constant) { this.value = next; this.events.push(["target", next, at, constant]); }, cancelScheduledValues(at) { this.events.push(["cancel", at]); },
  setValueAtTime(next, at) { this.value = next; this.events.push(["value", next, at]); }, linearRampToValueAtTime(next, at) { this.value = next; this.events.push(["linear", next, at]); },
  exponentialRampToValueAtTime(next, at) { this.value = next; this.events.push(["exponential", next, at]); }
});
const audioNode = () => ({
  frequency: audioParam(), detune: audioParam(), Q: audioParam(), gain: audioParam(), pan: audioParam(),
  stopped: false, stoppedAt: null, startedAt: null, connections: [],
  connect(node) { this.connections.push(node); return node || this; }, disconnect() {}, start(at) { this.startedAt = at; }, stop(at) { this.stopped = true; this.stoppedAt = at; },
  addEventListener() {}
});
const context = {
  currentTime: 10, sampleRate: 48000,
  createOscillator: audioNode, createBiquadFilter: audioNode, createGain: audioNode,
  createStereoPanner: audioNode, createBufferSource: audioNode
};

assert.deepEqual(Object.keys(WEAPON_AUDIO_IDENTITIES).sort(), Object.keys(WEAPONS).sort(), "all 47 weapons have an explicit audio identity");
assert.equal(new Set(Object.values(WEAPON_AUDIO_IDENTITIES).map(([identity]) => identity)).size, 47, "every weapon audio identity is unique");
assert.equal(new Set(Object.values(WEAPONS).map((weapon) => JSON.stringify(weaponAudioProfile(weapon)))).size, 47, "every explicit identity resolves to a unique audible synthesis profile");
for (const event of ["uiHover", "weaponSelect", "jump", "land", "reload", "empty", "grappleFire", "grappleAttach", "grappleRelease", "hitConfirm", "elimination", "damage", "death", "respawn", "bounce", "stick", "split", "hazardSpawn", "hazardEnd"]) {
  assert.ok(AUDIO_EVENTS.includes(event), `${event} is part of the authored event catalog`);
}

const near = spatialMix([0, 0, 0], [2, 0, 0], [0, 0, 1]);
const far = spatialMix([0, 0, 0], [120, 0, 0], [0, 0, 1]);
assert.ok(near.gain > far.gain && far.gain > 0, "distance attenuation is monotonic");
assert.ok(near.pan > 0 && spatialMix([0, 0, 0], [-2, 0, 0], [0, 0, 1]).pan < 0, "world audio pans to the correct side");
assert.equal(spatialMix([0, 0, 0], [181, 0, 0], [0, 0, 1]).gain, 0, "inaudible sources do not receive an artificial volume floor");

const sound = new SoundBoard();
sound.context = context;
sound.master = audioNode();
sound.noiseBuffer = {};
sound.setVolume(50);
assert.ok(Math.abs(sound.master.gain.value - .13) < 1e-9, "50% volume follows a perceptual square curve");
sound.setVolume(100);
assert.ok(Math.abs(sound.master.gain.value - .52) < 1e-9, "100% volume reaches the calibrated master ceiling");
sound.setVolume(0);
assert.equal(sound.master.gain.value, 0, "0% is silent");
sound.setVolume(70);

for (const [index, weapon] of Object.values(WEAPONS).entries()) {
  assert.doesNotThrow(() => sound.playWeapon(weapon, { local: index === 0, ownerId: `fighter-${index}`, volume: 1 }));
  assert.doesNotThrow(() => sound.playImpact(weapon, { position: { x: index, y: 0, z: 8 }, volume: 1 }, 0, "player"));
}
assert.ok(sound.activeVoices.size <= 48, "a 47-weapon fire-and-impact storm respects the global 48-voice budget");
sound.activeVoices.clear(); // The mock has no real `ended` events; model the completed transient storm before sustained-load testing.

sound.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
sound.updateWeaponLoop("moving", WEAPONS.minigun, true, { position: { x: -8, y: 0, z: 4 }, volume: 1 });
const movingLoop = sound.weaponLoops.get("moving");
assert.ok(movingLoop.panner.pan.value < 0, "a moving sustained weapon begins on its real stereo side");
sound.updateWeaponLoop("moving", WEAPONS.minigun, true, { position: { x: 8, y: 0, z: 4 }, volume: 1, occluded: true });
assert.ok(movingLoop.panner.pan.value > 0 && movingLoop.filter.frequency.value <= 1100, "moving loops update both pan and occlusion continuously");
for (let index = 0; index < 16; index++) {
  sound.updateWeaponLoop(`weapon-${index}`, WEAPONS.minigun, true, { position: { x: index - 8, y: 0, z: 12 }, volume: .5 });
  sound.updateGrappleLoop(`grapple-${index}`, true, { position: { x: 8 - index, y: 2, z: 10 }, volume: .5, tension: .7, speed: 24 });
}
for (let index = 0; index < 4; index++) sound.updateHazardLoop(`hazard-${index}`, WEAPONS.black_hole_generator, true, { position: { x: index * 3, y: 0, z: 9 }, volume: .6 });
sound.startAmbience("foundry");
const acceptedProjectiles = [];
for (let index = 0; index < 6; index++) acceptedProjectiles.push(sound.updateProjectileLoop(`projectile-${index}`, WEAPONS.rocket_launcher, true, { position: { x: index, y: 2, z: 14 }, speed: 36, volume: .6 }));
assert.deepEqual(acceptedProjectiles, [true, true, true, true, true, true], "the intended nearest-six projectile flight loops preempt lower-value ambience or remote loops under peak load");
assert.equal(sound.projectileLoops.size, 6, "all six prioritized projectile flight loops remain active");
sound.play("elimination");
assert.ok(sound.totalVoiceCount() <= 48, "16 maintained weapons, 16 grapples, four hazards, ambience, and a protected local cue share one real 48-source ceiling");
assert.ok([...sound.activeVoices].some((voice) => voice.priority === 100), "critical elimination audio survives a saturated continuous-source pool");
sound.stopAll();
assert.equal(sound.continuousSources.size, 0, "all continuous weapon, grapple, hazard, projectile, and ambience sources are released together");

const adverse = new SoundBoard();
adverse.context = { ...context, currentTime: 12 };
adverse.master = audioNode();
adverse.noiseBuffer = {};
for (let index = 0; index < 40; index++) adverse.continuousSources.set(audioNode(), { priority: 4 });
for (let index = 0; index < 8; index++) adverse.fadingSources.set(audioNode(), { priority: 4 });
adverse.play("elimination");
assert.ok([...adverse.activeVoices].filter((voice) => voice.priority === 100).length >= 2, "critical elimination layers globally preempt low-priority loops or fading tails in the worst arrival order");
assert.ok(adverse.totalVoiceCount() <= 48, "global transient, continuous, and fading priority arbitration never exceeds the true voice ceiling");
const protectedPool = new SoundBoard();
protectedPool.context = { ...context, currentTime: 13 };
for (let index = 0; index < 40; index++) protectedPool.continuousSources.set(audioNode(), { priority: 24 });
for (let index = 0; index < 8; index++) protectedPool.activeVoices.add({ source: audioNode(), priority: 100, group: "critical" });
assert.equal(protectedPool._claimContinuous(1, 24), false, "an equal-priority remote loop never evicts a priority-100 transient");
assert.equal([...protectedPool.activeVoices].filter((voice) => voice.priority === 100).length, 8, "critical transient voices remain intact when a lower-value loop is rejected");
const turnoverPool = new SoundBoard();
turnoverPool.context = { ...context, currentTime: 14 };
for (let index = 0; index < 40; index++) turnoverPool.fadingSources.set(audioNode(), { priority: 4 });
assert.equal(turnoverPool._claimContinuous(1, 76), true, "a priority projectile can reclaim sustained-budget space from a low-priority fading tail");
assert.equal(turnoverPool.fadingSources.size, 39, "continuous-budget arbitration stops and removes the weakest fading tail immediately");

sound.buses.music = audioNode();
sound.buses.ambience = audioNode();
sound.musicFilter = audioNode();
sound.setMix({ music: 35, effects: 85, ambience: 0 });
sound.setPaused(true);
assert.equal(sound.buses.ambience.gain.value, 0, "pausing never unmutes a user-muted ambience bus");
sound.setPaused(false);
assert.equal(sound.buses.ambience.gain.value, 0, "resuming preserves the persisted ambience mix");

const musicContext = { ...context, currentTime: 20 };
const musicSound = new SoundBoard();
musicSound.context = musicContext;
musicSound.master = audioNode();
musicSound.noiseBuffer = {};
musicSound.buses.music = audioNode();
musicSound.buses.ambience = audioNode();
musicSound.musicFilter = audioNode();
const scheduledMusic = [];
musicSound._scheduleMusicEvent = (event, at) => scheduledMusic.push({ scene: musicSound.musicScene, at, step: musicSound.musicStep, intensity: musicSound.musicBarIntensity, event });
const gate = musicSound.startCountdown("AUDIO-QA", .42);
assert.ok(gate && gate.endTime > gate.startTime, "countdown exposes its authoritative audio-clock gate");
clearInterval(musicSound.musicTimer);
musicSound.musicTimer = null;
for (let at = musicContext.currentTime; at <= gate.endTime + .2; at += .02) {
  musicContext.currentTime = at;
  musicSound._scheduleMusic();
}
assert.equal(musicSound.lastCountdownStepCount, 32, "the countdown schedules exactly 32 sixteenth notes: eight beats at 132 BPM");
assert.equal(musicSound.musicScene, "combat", "the score enters combat on the exact shared-clock GO boundary");
assert.ok(scheduledMusic.filter((entry) => entry.scene === "countdown").every((entry) => entry.at < gate.endTime), "no countdown event is scheduled on or after GO");
assert.ok(scheduledMusic.filter((entry) => entry.scene === "combat").every((entry) => entry.at >= gate.endTime), "combat begins on or after the exact GO timestamp");
const firstCombatBar = scheduledMusic.filter((entry) => entry.scene === "combat" && entry.step < 16);
assert.ok(firstCombatBar.length > 0 && firstCombatBar.every((entry) => Math.abs(entry.intensity - .42) < 1e-9), "the first combat bar launches at the intended intensity and holds one snapshot for all 16 steps");

musicContext.currentTime = 30;
const pausedGate = musicSound.startCountdown("PAUSE-QA", .42);
clearInterval(musicSound.musicTimer);
musicSound.musicTimer = null;
musicContext.currentTime = pausedGate.startTime + .8;
musicSound.setPaused(true);
const frozenRemaining = musicSound.getCountdownState().remaining;
musicContext.currentTime += 2;
assert.equal(musicSound.getCountdownState().remaining, frozenRemaining, "pause freezes the authoritative countdown clock");
musicSound.setPaused(false);
clearInterval(musicSound.musicTimer);
musicSound.musicTimer = null;
assert.ok(Math.abs(musicSound.getCountdownState().remaining - frozenRemaining) < 1e-9, "resume shifts the countdown downbeat grid without losing time");

const musicBus = musicSound.buses.music;
musicSound.musicReverb = audioNode();
musicSound.musicReverb.connect(musicBus);
const wetInput = audioNode();
musicSound._route(wetInput, "music", 0, .25);
assert.ok(wetInput.connections.some((node) => node.connections?.includes(musicSound.musicReverb)) && musicSound.musicReverb.connections.includes(musicBus), "music wet sends return through the user-controlled music bus");
musicSound.setMix({ music: 35, ambience: 0 });
const configuredMusicGain = .68 * .35 ** 2;
musicSound.duckMusic(.5, .1);
assert.ok(Math.abs(musicBus.gain.value - configuredMusicGain) < 1e-9, "duck recovery returns to the configured music mix rather than a fixed gain");
musicSound.setPaused(true);
musicSound.setPaused(false);
assert.ok(Math.abs(musicBus.gain.value - configuredMusicGain) < 1e-9, "pause and resume preserve the configured music gain");
const fadingMusic = audioNode();
musicSound.activeVoices.add({ source: fadingMusic, priority: 8, group: "music" });
const fadeStart = musicContext.currentTime;
musicSound.stopMusic(.2);
assert.ok(musicBus.gain.events.some(([kind, value, at]) => kind === "linear" && value === .0001 && Math.abs(at - (fadeStart + .2)) < 1e-9), "music fade automation reaches silence before teardown");
assert.equal(fadingMusic.stoppedAt, fadeStart + .2, "music sources stop at the fade boundary");
assert.ok(musicSound.fadingSources.has(fadingMusic), "fading music remains in the real voice budget until its scheduled stop");

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
for (const event of ["uiHover", "weaponSelect", "jump", "empty", "grappleMiss", "grappleFire", "grappleAttach", "grappleWrap", "grappleRelease", "hitConfirm", "elimination", "damage", "bounce", "stick", "arm", "split", "teleport", "steal", "construct", "hazardSpawn", "hazardEnd"]) {
  assert.match(mainSource, new RegExp(`sound\\.play\\(.*?"${event}"`), `${event} is wired into live game/menu flow`);
}
assert.match(mainSource, /setListener\(this\.camera\.position/, "the audio listener follows the camera");
assert.match(mainSource, /updateFighter\(player\.id,[\s\S]*?reloading: player\.reloadTimer > 0/, "fighter state transitions drive reload, landing, death, and respawn cues");
assert.match(mainSource, /playImpact\(shot\.weapon, this\.audioSpatial\(position/, "explosions use listener-relative position and distance");
assert.match(mainSource, /setMusicIntensity\(/, "combat continuously drives adaptive music intensity");
assert.match(mainSource, /startCountdown\(this\.seed, \.42\)/, "gameplay and the score share one authoritative audio-clock countdown");
assert.match(mainSource, /audibleHazards[\s\S]*?distanceToSquared[\s\S]*?slice\(0, 4\)/, "the four nearest hazards receive tactical loop priority");
assert.match(mainSource, /button\.dataset\.weaponSlot != null \? WEAPONS\[this\.players\[0\]\?\.loadout/, "direct HUD and touch slot selection carries the selected weapon's handling identity");
assert.match(mainSource, /setMusicScene\("results"/, "match results receive a dedicated musical resolution");
const audioSource = fs.readFileSync(new URL("../src/audio.js", import.meta.url), "utf8");
assert.match(audioSource, /musicReverb\.connect\(this\.musicReverbGain\)\.connect\(this\.buses\.music\)/, "music reverb returns through the user-controlled music bus");
assert.match(audioSource, /if \(step === 0\) this\.musicBarIntensity = this\.musicIntensity/, "adaptive layers use one stable intensity snapshot per bar");
assert.match(audioSource, /linearRampToValueAtTime\?\.\(\.0001, now \+ fade\)/, "music teardown performs a real gain fade before source stops");
assert.match(audioSource, /_route\(gain, "weapon", mix\.pan, \.1\)/, "weapon hazards stay audible through the effects bus when ambience is muted");

console.log("AAA audio coverage, spatialization, identity, mix, and overload checks passed.");
