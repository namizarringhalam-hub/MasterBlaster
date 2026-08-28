import assert from "node:assert/strict";
import { SoundBoard, weaponAudioProfile } from "../src/audio.js";
import { WEAPONS } from "../src/gameData.js";

const audioParam = (value = 0) => ({
  value,
  setTargetAtTime(next) { this.value = next; },
  cancelScheduledValues() {},
  setValueAtTime(next) { this.value = next; },
  linearRampToValueAtTime(next) { this.value = next; }
});
const audioNode = () => ({
  frequency: audioParam(), playbackRate: audioParam(1), Q: audioParam(), gain: audioParam(), stopped: false,
  connect() { return this; }, start() {}, stop() { this.stopped = true; }
});
const context = {
  currentTime: 10,
  createOscillator() { throw new Error("live oscillators are forbidden"); },
  createBufferSource: audioNode,
  createBiquadFilter: audioNode,
  createGain: audioNode
};

const sound = new SoundBoard();
sound.context = context;
sound.master = audioNode();
for (const name of ["chargeLoop", "weaponLoop", "flame", "projectileLoop"]) sound.sampleBank[name] = { duration: 1 };
for (const id of ["minigun", "gravity_beam", "flamethrower", "chainsaw", "charged_energy_rifle"]) {
  const profile = weaponAudioProfile(WEAPONS[id]);
  sound.sampleBank[profile.loopSample] = { duration: 1, identity: `${id}-loop` };
  sound.sampleBank[profile.chargeSample] = { duration: 1, identity: `${id}-charge` };
}
for (const name of ["battleDrum", "celloSpic", "hornStaccato", "cymbal"]) sound.musicSamples[name] = [{ buffer: { duration: 1 }, rootMidi: ["celloSpic", "hornStaccato"].includes(name) ? 38 : null, trim: 1 }];
sound.musicSamplesReady = true;
sound.musicScene = "menu";
const voicesBeforeAccent = sound.activeVoices.size;
assert.equal(sound.accentMenuAction(.94, true), true, "a peak menu action immediately schedules a recorded musical accent");

const coldSound = new SoundBoard();
coldSound.context = context;
coldSound.musicScene = "menu";
coldSound._loadMusicSamples = () => Promise.resolve();
assert.equal(coldSound.accentMenuAction(.72, true), true, "a cold-load menu action is accepted while recorded samples decode");
assert.deepEqual(coldSound.pendingMenuAccent, { energy: .72, launch: true }, "cold-load menu energy and launch intent are retained");
coldSound.musicSamples = sound.musicSamples;
coldSound.musicSamplesReady = true;
coldSound.buses = sound.buses;
coldSound.master = sound.master;
assert.equal(coldSound._flushPendingMenuAccent(), true, "the retained cold-load action becomes a recorded accent once samples are ready");
assert.equal(coldSound.pendingMenuAccent, null, "the queued accent is consumed exactly once");
assert.ok(sound.activeVoices.size >= voicesBeforeAccent + 4, "Start layers recorded drum, strings, brass, and cymbal before navigation");

sound.updateWeaponLoop("fighter", WEAPONS.minigun, true);
const minigunLoop = sound.weaponLoops.get("fighter");
sound.updateWeaponLoop("fighter", WEAPONS.gravity_beam, true);
const gravityLoop = sound.weaponLoops.get("fighter");
assert.notEqual(gravityLoop, minigunLoop, "hot-switching maintained weapons creates a fresh sound identity");
assert.equal(minigunLoop.source.stopped, true, "the previous maintained texture is stopped during a hot switch");
assert.equal(gravityLoop.weaponId, "gravity_beam", "the replacement loop carries the new weapon profile");
assert.notEqual(gravityLoop.source.buffer, minigunLoop.source.buffer, "maintained weapons play different authored buffers, not one shared loop at different rates");

sound.updateChargeLoop("bot", WEAPONS.charged_energy_rifle, .8, .4);
assert.equal(sound.chargeLoops.has("bot"), true, "a charging bot owns one bounded wind-up loop");
assert.equal(sound.stopChargeLoop("bot"), true, "bot death or target loss can explicitly stop the wind-up");
assert.equal(sound.chargeLoops.has("bot"), false, "a stopped bot charge cannot remain audible indefinitely");

sound.stopWeaponLoop("fighter");
console.log("Weapon audio lifecycle checks passed.");
