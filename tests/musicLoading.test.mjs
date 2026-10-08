import assert from "node:assert/strict";
import { SoundBoard } from "../src/audio.js";
import { MUSIC, MUSIC_SAMPLE_MANIFEST } from "../src/musicScore.js";

const parameter = (value = 0) => ({
  value, setValueAtTime(next) { this.value = next; }, setTargetAtTime(next) { this.value = next; },
  linearRampToValueAtTime(next) { this.value = next; }, exponentialRampToValueAtTime(next) { this.value = next; },
  cancelScheduledValues() {}
});
const node = () => ({
  gain: parameter(), frequency: parameter(), Q: parameter(), pan: parameter(), playbackRate: parameter(1),
  connections: [], starts: [], stops: [], disconnected: false,
  connect(target) { this.connections.push(target); return target; },
  disconnect() { this.disconnected = true; },
  start(...args) { this.starts.push(args); }, stop(at) { this.stops.push(at); }, addEventListener() {}
});
const buffer = (channels, frames, sampleRate) => {
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  return { numberOfChannels: channels, length: frames, sampleRate, duration: frames / sampleRate,
    getChannelData(channel) { return data[channel]; }, copyToChannel(samples, channel) { data[channel].set(samples); } };
};
const makeContext = () => ({
  currentTime: 10, sampleRate: 100, sources: [], closed: false,
  createGain: node, createBiquadFilter: node, createStereoPanner: node, createBuffer: buffer,
  createBufferSource() { const source = node(); this.sources.push(source); return source; },
  close() { this.closed = true; }
});
const makeSound = () => {
  const sound = new SoundBoard();
  sound.context = makeContext(); sound.master = node(); sound.buses.music = node(); sound.buses.ambience = node();
  sound.musicFilter = node(); sound.musicSamplesReady = true;
  for (const [name, role] of Object.entries(MUSIC_SAMPLE_MANIFEST)) {
    sound.musicSamples[name] = role.files.map(file => ({ buffer: { duration: 1.2 }, rootMidi: file.rootMidi ?? null, trim: file.trim ?? 1 }));
  }
  sound.sampleBank.explosion = { duration: .8 };
  return sound;
};

const originalOffline = globalThis.OfflineAudioContext;
const renders = [];
class OfflineContext {
  constructor(channels, frames, sampleRate) {
    Object.assign(this, makeContext(), { currentTime: 0, channels, frames, sampleRate, destination: node() });
    renders.push(this);
  }
  startRendering() {
    this.startedRendering = true;
    return new Promise(resolve => {
      this.finish = () => {
        const result = buffer(this.channels, this.frames, this.sampleRate);
        for (let channel = 0; channel < this.channels; channel++) {
          result.getChannelData(channel).fill(1, 0, this.frames / 2);
          result.getChannelData(channel).fill(2 + channel, this.frames / 2);
        }
        resolve(result);
      };
    });
  }
}
globalThis.OfflineAudioContext = OfflineContext;
const reachRendering = async render => {
  for (let attempt = 0; !render.startedRendering && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(render.startedRendering, true, "offline preparation reaches its bounded render gate");
};

try {
  const sound = makeSound(), context = sound.context;
  sound.startMusic("menu", "LOADING-QA");
  assert.equal(sound.setLoadingMusic(true), false, "a cold loading request waits for its native buffer");
  const preparing = sound._prepareLoadingMusic(), render = renders.at(-1);
  assert.equal(sound._prepareLoadingMusic(), preparing, "concurrent cold requests share one preparation");
  await reachRendering(render);
  render.finish(); await preparing;
  assert.ok(render.sources.length > 0, "preparation renders the existing recorded instrument graph");
  assert.equal(sound.loadingMusicBuffer.length, Math.round(MUSIC.roots.length * MUSIC.stepsPerBar * 60 / MUSIC.tempoTiers[0] / MUSIC.stepsPerBeat * context.sampleRate));
  assert.equal(sound.loadingMusicBuffer.getChannelData(0)[0], 2, "the loop keeps the second cycle's preceding note tails");
  assert.equal(sound.loadingMusicBuffer.getChannelData(1)[0], 3, "the stereo loop preserves both rendered channels");
  await sound._prepareLoadingMusic();
  assert.equal(renders.length, 1, "subsequent matches reuse the prepared buffer");

  const events = [], scheduleEvent = sound._scheduleMusicEvent.bind(sound);
  sound._scheduleMusicEvent = (event, at, duration) => { events.push({ scene: sound.musicScene, at }); scheduleEvent(event, at, duration); };
  assert.equal(sound.setLoadingMusic(true), true);
  const loop = sound.loadingMusicSource;
  assert.equal(loop.loop, true, "loading uses a native looping source");
  assert.equal(loop.buffer, sound.loadingMusicBuffer);
  assert.equal([...sound.activeVoices].filter(voice => voice.group === "music").length, 1, "the whole loading score occupies one active musical voice");
  const sourceCount = context.sources.length;
  assert.equal(sound.setLoadingMusic(true), true, "repeat loading signals do not duplicate the source");
  context.currentTime += 45;
  sound._scheduleMusic();
  assert.equal(context.sources.length, sourceCount, "a 45-second scheduler stall cannot create an overdue loading burst");
  assert.equal(events.length, 0, "the native loading score never depends on step timer progress");
  assert.equal(loop.stops.length, 0, "the audio thread keeps the looping source running during the stall");

  assert.equal(sound.setLoadingMusic(false), true, "cancelling loading returns to the live score");
  assert.equal(sound.loadingMusicSource, null);
  assert.equal(loop.stops.at(-1), context.currentTime + .035);
  assert.ok(sound.musicTimer, "the live scheduling timer remains available after cancellation");
  context.currentTime += .3; sound._scheduleMusic();
  assert.ok(sound.musicNextTime > context.currentTime, "cancellation continues from a current live scheduling timestamp");
  const resumedEvents = events.length;
  context.currentTime += 45; sound._scheduleMusic();
  assert.ok(events.slice(resumedEvents).every(event => event.at >= context.currentTime), "a later live stall skips overdue notes instead of replaying them together");
  assert.ok(events.length - resumedEvents <= 5, "live recovery schedules only the current lookahead window");

  sound.setPaused(true);
  assert.equal(sound.setLoadingMusic(true), false, "loading begun while hidden waits for audio to resume");
  assert.equal(sound.loadingMusicSource, null);
  sound.setPaused(false);
  const pausedLoop = sound.loadingMusicSource;
  assert.ok(pausedLoop, "returning to a loading tab starts its prepared native score");
  sound.setPaused(true);
  assert.equal(pausedLoop.stops.at(-1), context.currentTime + .05, "hiding an active loading tab stops its native loop");
  assert.equal(sound.loadingMusicSource, null);
  context.currentTime += 3;
  sound.setPaused(false);
  assert.ok(sound.loadingMusicSource && sound.loadingMusicSource !== pausedLoop, "resuming loading creates one replacement native loop");

  const countdownLoop = sound.loadingMusicSource;
  const gate = sound.startCountdown("LOADING-COUNTDOWN", .42);
  assert.equal(countdownLoop.stops.at(-1), gate.startTime, "the loading source stops on the authoritative countdown downbeat");
  assert.equal(sound.loadingMusicSource, null);
  sound.setPaused(false);
  assert.equal(sound.loadingMusicSource, null, "applying the visible-tab state after countdown begins cannot restart loading music");
  clearInterval(sound.musicTimer); sound.musicTimer = null;
  for (let at = context.currentTime; at <= gate.endTime + .2; at += .02) { context.currentTime = at; sound._scheduleMusic(); }
  assert.equal(sound.lastCountdownStepCount, 32, "loading handoff preserves all eight beats and 32 countdown steps");
  assert.equal(sound.musicScene, "combat");
  assert.ok(events.filter(event => event.scene === "countdown").every(event => event.at < gate.endTime));
  assert.ok(events.filter(event => event.scene === "combat").every(event => event.at >= gate.endTime));

  sound.setLoadingMusic(true);
  const toggledLoop = sound.loadingMusicSource;
  assert.equal(sound.toggle(), false);
  assert.equal(sound.loadingMusicSource, null);
  assert.ok(toggledLoop.stops.length > 0, "disabling audio stops the native loading loop");
  assert.equal(sound.setLoadingMusic(true), false, "disabled audio cannot start a replacement loading source");
  assert.equal(sound.toggle(), true);
  assert.equal(sound.setLoadingMusic(true), true);
  const disposedLoop = sound.loadingMusicSource;
  sound.dispose();
  assert.ok(disposedLoop.stops.length > 0, "dispose stops the replacement loading source");
  assert.equal(sound.loadingMusicBuffer, null);
  assert.equal(sound.musicTimer, null);
  assert.equal(sound.lifecycleTimers.size, 0);
  assert.equal(context.closed, true);

  const coldDisposed = makeSound(), coldContext = coldDisposed.context;
  const coldPreparing = coldDisposed._prepareLoadingMusic(), coldRender = renders.at(-1);
  await reachRendering(coldRender);
  coldDisposed.dispose(); coldRender.finish(); await coldPreparing;
  assert.equal(coldDisposed.loadingMusicBuffer, null, "a late offline render cannot rebuild a disposed loading buffer");
  assert.equal(coldDisposed.loadingMusicPromise, null);
  assert.equal(coldContext.sources.length, 0, "a cancelled cold render never starts playback");
} finally {
  if (originalOffline === undefined) delete globalThis.OfflineAudioContext;
  else globalThis.OfflineAudioContext = originalOffline;
}

console.log("Native loading score, long-stall recovery, cancellation, pause, countdown, cache and disposal checks passed.");
