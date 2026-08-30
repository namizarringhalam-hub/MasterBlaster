import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  frequency: audioParam(), playbackRate: audioParam(1), Q: audioParam(), gain: audioParam(), stopped: false, disconnected: false,
  connect() { return this; }, disconnect() { this.disconnected = true; }, start() {}, stop() { this.stopped = true; }
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
sound.dispose();
assert.equal(sound.totalVoiceCount(), 0, "dispose clears transient, continuous, and fading voice accounting");
assert.equal(sound.lifecycleTimers.size, 0, "dispose cancels every delayed audio cleanup callback");

const audioSource = await readFile(new URL("../src/audio.js", import.meta.url), "utf8");
const mixerSource = audioSource.slice(audioSource.indexOf("  _buildMixer()"), audioSource.indexOf("  _impulseBuffer("));
assert.doesNotMatch(mixerSource, /createProceduralAudioAssets|createWeaponAudioAssets/, "audio unlock never renders the 48 kHz PCM bank on the main thread");
assert.match(audioSource, /new Worker\(new URL\("\.\/audioAssets\.worker\.js"/, "the complete PCM bank is prepared in a dedicated module worker");

const workers = [];
const hydrationContext = {
  createBuffer(_channels, length, sampleRate) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data };
  }
};
class FakeWorker {
  constructor() { this.terminated = false; workers.push(this); }
  postMessage(message) {
    this.request = message;
    queueMicrotask(() => this.onmessage?.({ data: { sampleRate: 48000, entries: [["heavyUi", new Float32Array(4800).fill(.2)]] } }));
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;
const prepared = new SoundBoard();
prepared.context = hydrationContext;
await prepared.audioAssetPromise;
assert.equal(workers[0].request.sampleRate, 48000, "the production worker prepares assets at the production sample rate");
assert.equal(workers[0].request.weapons.length, Object.keys(WEAPONS).length, "the worker receives all forty-seven weapon identities");
assert.ok(prepared.sampleBank.heavyUi && prepared.audioAssetData === null, "hydration releases transferred PCM after creating AudioBuffers");
prepared.dispose();

const cancelled = new SoundBoard();
const cancelledWorker = workers.at(-1);
cancelled.dispose();
await cancelled.audioAssetPromise;
assert.equal(cancelledWorker.terminated, true, "dispose terminates in-flight audio preparation");
assert.deepEqual(cancelled.sampleBank, {}, "a late worker completion cannot rebuild audio after dispose");

class FailingWorker {
  postMessage() { queueMicrotask(() => this.onerror?.(new Error("simulated worker failure"))); }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FailingWorker;
const fallback = new SoundBoard();
fallback.context = hydrationContext;
assert.equal(await fallback.audioAssetPromise, true, "a failed module worker rebuilds the authored bank through the rare-path fallback");
assert.ok(fallback.sampleBank.heavyUi, "the fallback preserves menu and gameplay feedback");
assert.ok(fallback.sampleBank[weaponAudioProfile(WEAPONS.railgun).fireSample], "the fallback preserves per-weapon sound identities");
fallback.dispose();
delete globalThis.Worker;

const waiting = new SoundBoard();
waiting.context = { ...context, ...hydrationContext };
waiting.master = audioNode();
waiting.buses.ambience = audioNode();
assert.equal(waiting.updateGrappleLoop("cold-grapple", true, { local: true }), false, "a loop never starts with a null buffer while asset preparation is pending");
assert.equal(waiting.continuousSources.size, 0, "a pending loop does not consume the bounded continuous-source budget");
assert.equal(waiting.startAmbience("foundry"), false, "ambience waits for its authored buffer");
assert.equal(waiting.pendingAmbienceTheme, "foundry", "the requested ambience scene is retained while assets hydrate");
waiting.audioAssetData = { sampleRate: 48000, entries: [["ambienceFoundry", new Float32Array(4800).fill(.1)]] };
assert.equal(waiting._hydrateAudioAssets(), true, "late assets hydrate into the live audio context");
assert.equal(waiting.ambienceNodes?.theme, "foundry", "queued ambience starts automatically after hydration");
assert.equal(waiting.pendingAmbienceTheme, null, "the queued ambience request is consumed exactly once");
waiting.dispose();

const originalFetch = globalThis.fetch;
let releaseDecode;
const decodeGate = new Promise((resolve) => { releaseDecode = resolve; });
let fetchSignal;
globalThis.fetch = async (_url, options) => {
  fetchSignal = options.signal;
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
};
const decoding = new SoundBoard();
decoding.context = {
  currentTime: 0,
  decodeAudioData: async () => { await decodeGate; return { duration: 1 }; },
  close() {}
};
const decodePromise = decoding._loadMusicSamples();
await Promise.resolve();
decoding.dispose();
releaseDecode();
await decodePromise;
assert.equal(fetchSignal.aborted, true, "dispose aborts every in-flight recorded-music request");
assert.deepEqual(decoding.musicSamples, {}, "a late recorded-music decode cannot repopulate state after dispose");
assert.equal(decoding.musicAbortController, null, "dispose releases the music abort controller");
globalThis.fetch = originalFetch;

for (let cycle = 0; cycle < 100; cycle++) {
  const candidate = new SoundBoard();
  candidate.context = context;
  candidate.master = audioNode();
  candidate._countFade(audioNode(), .35, 1, [audioNode(), audioNode()]);
  candidate.dispose();
  assert.equal(candidate.lifecycleTimers.size, 0, `audio lifecycle ${cycle} leaves no timer`);
  assert.equal(candidate.totalVoiceCount(), 0, `audio lifecycle ${cycle} leaves no voice`);
}
console.log("Weapon audio lifecycle checks passed.");
