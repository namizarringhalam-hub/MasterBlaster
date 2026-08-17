import assert from "node:assert/strict";
import { SoundBoard } from "../src/audio.js";
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

sound.updateWeaponLoop("fighter", WEAPONS.minigun, true);
const minigunLoop = sound.weaponLoops.get("fighter");
sound.updateWeaponLoop("fighter", WEAPONS.gravity_beam, true);
const gravityLoop = sound.weaponLoops.get("fighter");
assert.notEqual(gravityLoop, minigunLoop, "hot-switching maintained weapons creates a fresh sound identity");
assert.equal(minigunLoop.source.stopped, true, "the previous maintained texture is stopped during a hot switch");
assert.equal(gravityLoop.weaponId, "gravity_beam", "the replacement loop carries the new weapon profile");

sound.updateChargeLoop("bot", WEAPONS.charged_energy_rifle, .8, .4);
assert.equal(sound.chargeLoops.has("bot"), true, "a charging bot owns one bounded wind-up loop");
assert.equal(sound.stopChargeLoop("bot"), true, "bot death or target loss can explicitly stop the wind-up");
assert.equal(sound.chargeLoops.has("bot"), false, "a stopped bot charge cannot remain audible indefinitely");

sound.stopWeaponLoop("fighter");
console.log("Weapon audio lifecycle checks passed.");
