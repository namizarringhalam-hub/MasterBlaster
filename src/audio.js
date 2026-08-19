import { MUSIC, MUSIC_SAMPLE_MANIFEST, musicEventsForStep, tempoForIntensity } from "./musicScore.js";
import { weaponPresentation } from "./weaponPresentation.js";
import { WEAPONS } from "./gameData.js";
import { createProceduralAudioAssets, createWeaponAudioAssets } from "./audioAssets.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const MASTER_GAIN = .52;
const VOICE_LIMIT = 48;
const CONTINUOUS_LIMIT = 40;
const MUSIC_PRIORITY = 34;
export const MUSIC_PROGRAM_GAIN = 4.2;
export const MUSIC_ASSET_REVISION = "orchestra-2";

export const AUDIO_EVENTS = Object.freeze([
  "uiHover", "uiConfirm", "uiBack", "uiInvalid", "weaponSelect", "pause", "resume",
  "matchStart", "countdown", "go", "win", "loss", "jump", "land", "footstep",
  "boost", "reload", "reloadComplete", "empty", "lowAmmo", "equip", "freeze", "thaw", "grappleFire", "grappleAttach",
  "grappleMiss", "grappleWrap", "grappleRelease", "hitConfirm", "elimination",
  "damage", "death", "respawn", "bounce", "stick", "arm", "split", "teleport",
  "steal", "construct", "hazardSpawn", "hazardEnd", "pickup", "power", "impact"
]);

// Each weapon owns a deliberately different tonal/mechanical fingerprint. The
// presentation family still supplies the broad grammar; these values stop two
// weapons in that family from collapsing into the same sound.
export const WEAPON_AUDIO_IDENTITIES = Object.freeze({
  blaster: ["ion-bolt", 1.18, .12, .34], shotgun: ["twin-chamber", .58, .76, .62],
  machine_gun: ["dry-receiver", .92, .7, .26], rocket_launcher: ["backblast", .48, .68, .78],
  grenade_launcher: ["hollow-tube", .66, .56, .58], mine: ["mag-clamp", 1.34, .18, .24],
  railgun: ["rail-resonance", 1.48, .24, .9], plasma_cannon: ["plasma-bloom", .82, .16, .72],
  submachine_gun: ["compact-bolt", 1.16, .74, .18], minigun: ["rotary-brass", .74, .66, .3],
  plasma_repeater: ["ion-repeater", 1.32, .1, .3], needle_launcher: ["needle-zip", 1.72, .32, .16],
  burst_rifle: ["three-pulse", 1.06, .55, .34], flamethrower: ["fuel-roar", .5, .92, .72],
  cluster_grenade: ["cluster-shell", .72, .58, .7], sticky_launcher: ["adhesive-thunk", .8, .46, .52],
  remote_explosive: ["remote-clack", .86, .5, .62], mortar: ["mortar-tube", .4, .7, .96],
  bouncing_bomb: ["elastic-core", 1.14, .3, .48], napalm_launcher: ["napalm-burst", .56, .9, .8],
  implosion_bomb: ["reverse-collapse", .44, .22, .98], laser_beam: ["laser-lance", 1.66, .08, .42],
  charged_energy_rifle: ["charged-coil", 1.4, .14, .88], arc_lightning: ["arc-crack", 1.52, .54, .44],
  pulse_cannon: ["radial-pulse", .7, .18, .7], gravity_beam: ["tractor-drone", .38, .12, .94],
  disintegration_weapon: ["vapor-tear", 1.22, .48, 1], black_hole_generator: ["singularity", .3, .16, 1],
  freeze_gun: ["crystal-burst", 1.58, .28, .52], fireball: ["living-flame", .62, .82, .72],
  teleport_projectile: ["phase-jump", 1.46, .08, .64], drill_missile: ["drill-motor", .68, .66, .82],
  boomerang_blade: ["returning-edge", 1.26, .5, .48], ricochet_cannon: ["ricochet-ping", 1.4, .4, .46],
  gravity_grenade: ["gravity-well", .42, .2, .92], tornado_generator: ["vortex-seed", .54, .86, .84],
  temporary_wall: ["hardlight-build", 1.08, .12, .68], decoy_launcher: ["holo-glitch", 1.36, .2, .5],
  weapon_stealing_projectile: ["swap-warble", 1.5, .16, .58], grapple_disrupting_pulse: ["rope-emp", .78, .48, .68],
  hammer: ["mass-driver", .38, .78, .84], energy_sword: ["energy-edge", 1.3, .18, .52],
  chainsaw: ["toothed-motor", .48, .9, .58], spear: ["piercing-shaft", 1.12, .52, .38],
  punch_glove: ["spring-piston", .72, .64, .54], shock_baton: ["stun-prong", 1.44, .46, .5],
  knife: ["narrow-edge", 1.68, .42, .24]
});

function identityHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function weaponAudioProfile(weapon = {}) {
  const identity = WEAPON_AUDIO_IDENTITIES[weapon.id] || [weapon.id || "unknown", 1, .4, .4];
  const hash = identityHash(identity[0]);
  return Object.freeze({
    key: identity[0], pitchRatio: identity[1], noise: identity[2], tail: identity[3],
    fireSample: `weaponFire:${weapon.id || "unknown"}`,
    impactSample: `weaponImpact:${weapon.id || "unknown"}`,
    operationSample: `weaponOperate:${weapon.id || "unknown"}`,
    loopSample: `weaponLoop:${weapon.id || "unknown"}`,
    chargeSample: `weaponCharge:${weapon.id || "unknown"}`,
    flightSample: `weaponFlight:${weapon.id || "unknown"}`,
    hazardSample: `weaponHazard:${weapon.id || "unknown"}`,
    formant: 620 + ((hash >>> 14) % 34) * 115,
    detune: ((hash >>> 20) % 29) - 14
  });
}

export function spatialMix(listener = [0, 0, 0], source = [0, 0, 0], forward = [0, 0, 1], maxDistance = 180) {
  const dx = source[0] - listener[0], dy = source[1] - listener[1], dz = source[2] - listener[2];
  const distance = Math.hypot(dx, dy, dz);
  const safeMax = Math.max(1, Number(maxDistance) || 180);
  const gain = distance >= safeMax ? 0 : (1 - distance / safeMax) ** 1.35;
  const length = Math.max(.001, distance);
  const fx = forward[0] || 0, fz = forward[2] || 1;
  const forwardLength = Math.max(.001, Math.hypot(fx, fz));
  const rightX = fz / forwardLength, rightZ = -fx / forwardLength;
  return { distance, gain, pan: clamp((dx / length) * rightX + (dz / length) * rightZ, -1, 1) };
}

export class SoundBoard {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.sampleBank = {};
    this.musicSamples = {};
    this.musicSamplePromise = null;
    this.musicPrefetchPromise = null;
    this.musicSamplesReady = false;
    this.musicLoadFailed = false;
    this.musicLoadCycles = 0;
    this.musicRetryTimer = null;
    this.musicRoundRobin = new Map();
    this.pendingMusicStart = null;
    this.enabled = true;
    this.volume = 70;
    this.buses = {};
    this.activeVoices = new Set();
    this.continuousSources = new Map();
    this.fadingSources = new Map();
    this.eventTimes = new Map();
    this.engineNodes = new Map();
    this.weaponLoops = new Map();
    this.chargeLoops = new Map();
    this.grappleLoops = new Map();
    this.hazardLoops = new Map();
    this.projectileLoops = new Map();
    this.fighterStates = new Map();
    this.listenerPosition = [0, 0, 0];
    this.listenerForward = [0, 0, 1];
    this.musicTimer = null;
    this.musicScene = "menu";
    this.musicSeed = "BLAST-01";
    this.musicStep = 0;
    this.musicNextTime = 0;
    this.musicIntensity = .22;
    this.musicTargetIntensity = .22;
    this.musicBarIntensity = .22;
    this.musicBpm = MUSIC.bpm;
    this.pendingMusicScene = null;
    this.musicCountdown = null;
    this.countdownStepsScheduled = 0;
    this.lastCountdownStepCount = 0;
    this.musicPauseTime = null;
    this.musicPaused = false;
    this.ambienceNodes = null;
    this.mix = { music: 70, effects: 85, ambience: 65 };
    this.dynamicRange = "standard";
  }

  resume() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this._buildMixer();
    }
    this.context.resume?.();
    if (this.musicTimer && this.musicNextTime < this.context.currentTime) this.musicNextTime = this.context.currentTime + .04;
    return true;
  }

  _buildMixer() {
    const context = this.context;
    this.master = context.createGain();
    this.compressor = context.createDynamicsCompressor();
    this.limiter = context.createDynamicsCompressor();
    this.compressor.threshold.value = -16;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 6;
    this.compressor.attack?.setValueAtTime?.(.003, context.currentTime);
    this.compressor.release?.setValueAtTime?.(.18, context.currentTime);
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack?.setValueAtTime?.(.001, context.currentTime);
    this.limiter.release?.setValueAtTime?.(.08, context.currentTime);
    if (context.createWaveShaper) {
      this.saturator = context.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let index = 0; index < curve.length; index++) { const x = index / (curve.length - 1) * 2 - 1; curve[index] = Math.tanh(x * 1.35) / Math.tanh(1.35); }
      this.saturator.curve = curve;
      this.saturator.oversample = "4x";
      this.master.connect(this.saturator).connect(this.compressor).connect(this.limiter);
    } else this.master.connect(this.compressor).connect(this.limiter);
    if (context.createAnalyser) {
      this.peakMeter = context.createAnalyser();
      this.peakMeter.fftSize = 256;
      this.limiter.connect(this.peakMeter).connect(context.destination);
    } else this.limiter.connect(context.destination);
    const levels = { ui: .7, movement: .48, weapon: .88, impact: .82, ambience: .26, music: .56 };
    for (const [name, level] of Object.entries(levels)) {
      const bus = context.createGain();
      bus.gain.value = level;
      bus.connect(this.master);
      this.buses[name] = bus;
    }
    this.musicFilter = context.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = 6400;
    this.musicLowShelf = context.createBiquadFilter();
    this.musicLowShelf.type = "lowshelf";
    this.musicLowShelf.frequency.value = 150;
    this.musicLowShelf.gain.value = 1.4;
    this.musicHighShelf = context.createBiquadFilter();
    this.musicHighShelf.type = "highshelf";
    this.musicHighShelf.frequency.value = 4200;
    this.musicHighShelf.gain.value = 1.1;
    this.buses.music.disconnect?.();
    this.buses.music.connect(this.musicLowShelf).connect(this.musicFilter).connect(this.musicHighShelf).connect(this.master);
    if (context.createConvolver) {
      const impulse = this._impulseBuffer(1.15, 2.8);
      this.reverb = context.createConvolver();
      this.reverb.buffer = impulse;
      this.reverbGain = context.createGain();
      this.reverbGain.gain.value = .085;
      this.reverb.connect(this.reverbGain).connect(this.master);
      this.musicReverb = context.createConvolver();
      this.musicReverb.buffer = impulse;
      this.musicReverbGain = context.createGain();
      this.musicReverbGain.gain.value = .11;
      this.musicReverb.connect(this.musicReverbGain).connect(this.buses.music);
    }
    if (context.createDelay) {
      this.musicDelay = context.createDelay(1);
      this.musicDelay.delayTime.value = (60 / MUSIC.bpm) * .75;
      this.musicDelayFeedback = context.createGain();
      this.musicDelayFeedback.gain.value = .27;
      this.musicDelayGain = context.createGain();
      this.musicDelayGain.gain.value = .14;
      this.musicDelay.connect(this.musicDelayFeedback).connect(this.musicDelay);
      this.musicDelay.connect(this.musicDelayGain).connect(this.buses.music);
    }
    const proceduralAssets = createProceduralAudioAssets(context.sampleRate);
    const weaponAssets = createWeaponAudioAssets(context.sampleRate, Object.values(WEAPONS), WEAPON_AUDIO_IDENTITIES);
    this.sampleBank = Object.fromEntries(Object.entries({ ...proceduralAssets, ...weaponAssets }).map(([name, data]) => [name, this._audioBufferFromMono(data)]));
    this._loadMusicSamples();
    this.setVolume(this.volume);
    this.setMix(this.mix);
    this.setDynamicRange(this.dynamicRange);
  }

  _impulseBuffer(seconds, decay) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** decay;
    }
    return impulse;
  }

  _audioBufferFromMono(data) {
    const buffer = this.context.createBuffer(1, data.length, this.context.sampleRate);
    buffer.getChannelData(0).set(data);
    return buffer;
  }

  prefetchMusic() {
    if (this.musicPrefetchPromise || typeof fetch !== "function") return this.musicPrefetchPromise;
    const connection = typeof navigator !== "undefined" ? navigator.connection : null;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return null;
    const criticalRoles = new Set(["battleDrum", "celloTrem", "hornSustain", "tromboneBuzz"]);
    const files = Object.entries(MUSIC_SAMPLE_MANIFEST).flatMap(([role, asset]) => asset.files.map((file) => ({ ...file, critical: criticalRoles.has(role) })));
    const fetchFile = async (file) => {
      const separator = file.url.includes("?") ? "&" : "?";
      const response = await fetch(`${file.url}${separator}bank=${MUSIC_ASSET_REVISION}`, { cache: "force-cache" });
      if (response.ok) await response.arrayBuffer();
    };
    const waitForIdle = () => new Promise((resolve) => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(resolve, { timeout: 1800 });
      else setTimeout(resolve, 250);
    });
    this.musicPrefetchPromise = Promise.allSettled(files.filter((file) => file.critical).map(fetchFile))
      .then(waitForIdle)
      .then(() => Promise.allSettled(files.filter((file) => !file.critical).map(fetchFile)));
    return this.musicPrefetchPromise;
  }

  _loadMusicSamples(force = false) {
    if ((!force && this.musicSamplePromise) || !this.context || typeof fetch !== "function") return this.musicSamplePromise;
    if (this.musicRetryTimer) { clearTimeout(this.musicRetryTimer); this.musicRetryTimer = null; }
    const context = this.context;
    const decodeFile = async (file) => {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const separator = file.url.includes("?") ? "&" : "?";
          const response = await fetch(`${file.url}${separator}bank=${MUSIC_ASSET_REVISION}`, { cache: attempt ? "reload" : "default" });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return { buffer: await context.decodeAudioData(await response.arrayBuffer()), rootMidi: file.rootMidi ?? null, trim: file.trim ?? 1 };
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 90 * (attempt + 1)));
        }
      }
      throw lastError;
    };
    this.musicSamplePromise = Promise.all(Object.entries(MUSIC_SAMPLE_MANIFEST).map(async ([name, asset]) => {
      const decoded = (await Promise.allSettled(asset.files.map(decodeFile))).filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
      if (decoded.length) this.musicSamples[name] = decoded;
      else console.warn(`Recorded music role ${name} unavailable after three load attempts`);
    })).then(() => {
      if (this.context !== context) return this.musicSamples;
      const recordedFallbacks = { fieldSnare: "battleDrum", cymbal: "fieldSnare", celloSpic: "celloTrem", celloTrem: "hornSustain", hornStaccato: "hornSustain", hornSustain: "celloTrem", tromboneBuzz: "hornSustain" };
      for (const name of Object.keys(MUSIC_SAMPLE_MANIFEST)) if (!this.musicSamples[name]?.length && this.musicSamples[recordedFallbacks[name]]?.length) this.musicSamples[name] = this.musicSamples[recordedFallbacks[name]];
      const decodedRoles = Object.values(this.musicSamples).filter((entries) => Array.isArray(entries) && entries.length).length;
      this.musicSamplesReady = decodedRoles > 0;
      this.musicLoadFailed = decodedRoles === 0;
      if (this.musicSamplesReady) {
        this.musicLoadCycles = 0;
        this._resumePendingMusic();
      } else {
        // Never label an empty orchestra as ready. Release a pending gameplay
        // countdown to its frame-clock fallback, but retain the intended scene
        // so a later successful retry restores music without another click.
        if (this.pendingMusicStart?.scene === "countdown") this.pendingMusicStart = null;
        this.musicCountdown = null;
        this.musicSamplePromise = null;
        this.musicLoadCycles += 1;
        if (this.musicLoadCycles < 4) this.musicRetryTimer = setTimeout(() => this._loadMusicSamples(true), 700 * 2 ** this.musicLoadCycles);
      }
      return this.musicSamples;
    });
    return this.musicSamplePromise;
  }

  _resumePendingMusic() {
    if (!this.musicSamplesReady || !this.pendingMusicStart || this.musicPaused) return;
    const pending = this.pendingMusicStart;
    this.pendingMusicStart = null;
    if (pending.scene === "countdown") this.startCountdown(pending.seed, pending.combatIntensity);
    else this.startMusic(pending.scene, pending.seed);
  }

  _bus(name) { return this.buses[name] || this.master; }

  setVolume(percent) {
    this.volume = clamp(Number(percent) || 0, 0, 100);
    if (this.master) this.master.gain.setTargetAtTime?.(this.enabled ? MASTER_GAIN * (this.volume / 100) ** 2 : 0, this.context.currentTime, .025);
    return this.volume;
  }

  setMix({ music, effects, ambience } = {}) {
    const now = this.context?.currentTime || 0;
    if (Number.isFinite(music)) this.mix.music = clamp(music > 1 ? music : music * 100, 0, 100);
    if (Number.isFinite(effects)) this.mix.effects = clamp(effects > 1 ? effects : effects * 100, 0, 100);
    if (Number.isFinite(ambience)) this.mix.ambience = clamp(ambience > 1 ? ambience : ambience * 100, 0, 100);
    this.buses.music?.gain.setTargetAtTime(this._musicBusGain(), now, .04);
    const effectCurve = (this.mix.effects / 100) ** 2;
    for (const [name, base] of Object.entries({ weapon: .88, impact: .82, movement: .48, ui: .7 })) this.buses[name]?.gain.setTargetAtTime(base * effectCurve, now, .04);
    this.buses.ambience?.gain.setTargetAtTime(this._ambienceBusGain(), now, .04);
    return { ...this.mix };
  }

  _musicBusGain() { return (this.musicPaused ? .18 : .68) * (this.mix.music / 100) ** 2; }
  _ambienceBusGain() { return (this.musicPaused ? .1 : .42) * (this.mix.ambience / 100) ** 2; }

  setDynamicRange(preset = "standard") {
    this.dynamicRange = ["wide", "standard", "night"].includes(preset) ? preset : "standard";
    if (!this.compressor) return this.dynamicRange;
    const values = { wide: [-10, 3], standard: [-16, 6], night: [-24, 10] }[this.dynamicRange];
    this.compressor.threshold.value = values[0];
    this.compressor.ratio.value = values[1];
    return this.dynamicRange;
  }

  peakLevel() {
    if (!this.peakMeter) return 0;
    const samples = new Float32Array(this.peakMeter.fftSize);
    this.peakMeter.getFloatTimeDomainData(samples);
    return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
  }

  setListener(position, forward) {
    this.listenerPosition = [position?.x || 0, position?.y || 0, position?.z || 0];
    this.listenerForward = [forward?.x || 0, forward?.y || 0, forward?.z ?? 1];
  }

  _mix(input = 1, fallbackPan = 0) {
    if (typeof input === "number") return { gain: clamp(input, 0, 1.5), pan: clamp(fallbackPan, -1, 1), occluded: false, distanceRatio: 0 };
    if (input?.local) return { gain: clamp(input.volume ?? 1, 0, 1.5), pan: 0, occluded: false, distanceRatio: 0 };
    const position = input?.position;
    if (!position) return { gain: clamp(input?.volume ?? 1, 0, 1.5), pan: clamp(input?.pan ?? fallbackPan, -1, 1), occluded: Boolean(input?.occluded), distanceRatio: 0 };
    const maxDistance = input.maxDistance || 180;
    const spatial = spatialMix(this.listenerPosition, [position.x || 0, position.y || 0, position.z || 0], this.listenerForward, maxDistance);
    return { gain: spatial.gain * clamp(input.volume ?? 1, 0, 1.5), pan: spatial.pan, occluded: Boolean(input.occluded), distanceRatio: clamp(spatial.distance / maxDistance) };
  }

  _allow(key, interval = 0) {
    const now = this.context?.currentTime || 0;
    if (now - (this.eventTimes.get(key) ?? -Infinity) < interval) return false;
    this.eventTimes.set(key, now);
    return true;
  }

  _claimVoice(priority, requesterGroup = "sfx") {
    while (this.totalVoiceCount() >= VOICE_LIMIT) if (!this._evictForPriority(priority, requesterGroup)) return false;
    return true;
  }

  _preemptContinuous(source) {
    const metadata = this.continuousSources.get(source);
    if (!metadata) return false;
    const now = this.context?.currentTime || 0;
    if (metadata.map && metadata.id != null) {
      const loop = metadata.map.get(metadata.id);
      for (const node of loop?.nodes || [source]) {
        this.continuousSources.delete(node);
        try { node.stop(now); } catch {}
      }
      metadata.map.delete(metadata.id);
    } else if (metadata.group === "ambience" && this.ambienceNodes) {
      for (const node of this.ambienceNodes.nodes) {
        this.continuousSources.delete(node);
        try { node.stop(now); } catch {}
      }
      this.ambienceNodes = null;
    } else {
      this.continuousSources.delete(source);
      try { source.stop(now); } catch {}
    }
    return true;
  }

  _claimContinuous(count = 1, priority = 0) {
    while (this.continuousSources.size + this.fadingSources.size + count > CONTINUOUS_LIMIT) {
      const candidates = [
        ...[...this.continuousSources].map(([source, metadata]) => ({ kind: "continuous", source, priority: metadata?.priority || 0 })),
        ...[...this.fadingSources].map(([source, metadata]) => ({ kind: "fading", source, priority: metadata?.priority || 0 }))
      ].sort((a, b) => a.priority - b.priority);
      const weakest = candidates[0];
      if (!weakest || weakest.priority >= priority) return false;
      if (weakest.kind === "continuous") {
        if (!this._preemptContinuous(weakest.source)) return false;
      } else {
        this.fadingSources.delete(weakest.source);
        try { weakest.source.stop(this.context?.currentTime || 0); } catch {}
      }
    }
    while (this.totalVoiceCount() + count > VOICE_LIMIT) if (!this._evictForPriority(priority, "continuous")) return false;
    return true;
  }

  _trackContinuous(source, metadata = {}) { this.continuousSources.set(source, { priority: 0, ...metadata }); }
  _evictForPriority(priority, requesterGroup = "sfx") {
    const musicCount = [...this.activeVoices].filter((voice) => voice.group === "music").length;
    const candidates = [
      ...[...this.activeVoices].filter((voice) => !(requesterGroup !== "music" && voice.group === "music" && musicCount <= 8)).map((voice) => ({ kind: "active", source: voice.source, priority: voice.priority || 0, voice })),
      ...[...this.continuousSources].map(([source, metadata]) => ({ kind: "continuous", source, priority: metadata?.priority || 0 })),
      ...[...this.fadingSources].map(([source, metadata]) => ({ kind: "fading", source, priority: metadata?.priority || 0 }))
    ].sort((a, b) => a.priority - b.priority);
    const weakest = candidates[0];
    if (!weakest || weakest.priority >= priority) return false;
    if (weakest.kind === "active") this.activeVoices.delete(weakest.voice);
    else if (weakest.kind === "continuous") return this._preemptContinuous(weakest.source);
    else this.fadingSources.delete(weakest.source);
    try { weakest.source.stop(this.context?.currentTime || 0); } catch {}
    return true;
  }
  _countFade(source, seconds, priority = 0) {
    this.fadingSources.set(source, { priority });
    setTimeout(() => this.fadingSources.delete(source), Math.max(0, seconds * 1000 + 12));
  }
  totalVoiceCount() { return this.activeVoices.size + this.continuousSources.size + this.fadingSources.size; }

  _track(source, priority, group = "sfx") {
    const voice = { source, priority, group };
    this.activeVoices.add(voice);
    const cleanup = () => this.activeVoices.delete(voice);
    if (source.addEventListener) source.addEventListener("ended", cleanup, { once: true });
    else source.onended = cleanup;
  }

  _route(node, busName, pan = 0, wet = 0, delay = 0) {
    let tail = node;
    let panner = null;
    if (this.context.createStereoPanner) {
      panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(this._bus(busName));
    const reverb = busName === "music" ? this.musicReverb : this.reverb;
    if (wet > 0 && reverb) {
      const send = this.context.createGain();
      send.gain.value = wet;
      node.connect(send).connect(reverb);
    }
    if (delay > 0 && busName === "music" && this.musicDelay) {
      const send = this.context.createGain();
      send.gain.value = delay;
      node.connect(send).connect(this.musicDelay);
    }
    return panner;
  }

  sample(name, volume = .1, options = {}) {
    const buffer = this.sampleBank?.[name];
    if (!this.enabled || !this.context || !buffer || !this._claimVoice(options.priority ?? 45, options.group || "sfx")) return false;
    const now = Math.max(this.context.currentTime, options.at ?? this.context.currentTime);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    if (source.playbackRate) source.playbackRate.value = clamp(options.rate ?? 1, .55, 1.8);
    if (source.detune && Number.isFinite(options.detune)) source.detune.value = options.detune;
    filter.type = options.filterType || "lowpass";
    filter.frequency.value = options.filter ?? 14000;
    filter.Q.value = options.q ?? .55;
    gain.gain.setValueAtTime(Math.max(.0001, volume), now);
    const duration = buffer.duration / (source.playbackRate?.value || 1);
    const release = Math.min(duration * .75, options.release ?? .08);
    gain.gain.setValueAtTime?.(Math.max(.0001, volume), Math.max(now, now + duration - release));
    gain.gain.exponentialRampToValueAtTime?.(.0001, now + duration);
    source.connect(filter).connect(gain);
    this._route(gain, options.bus || "impact", options.pan || 0, options.wet ?? .03, options.delay || 0);
    source.start(now);
    source.stop(now + duration + .025);
    this._track(source, options.priority ?? 45, options.group || "sfx");
    return true;
  }

  musicSample(name, volume = .1, options = {}) {
    const bank = this.musicSamples?.[name];
    const entries = Array.isArray(bank) ? bank : bank ? [{ buffer: bank, rootMidi: options.rootMidi ?? null, trim: 1 }] : [];
    if (!this.enabled || !this.context || !entries.length || !this._claimVoice(options.priority ?? 8, "music")) return false;
    let candidates = entries;
    if (Number.isFinite(options.midi) && entries.some((entry) => Number.isFinite(entry.rootMidi))) {
      const distance = Math.min(...entries.filter((entry) => Number.isFinite(entry.rootMidi)).map((entry) => Math.abs(options.midi - entry.rootMidi)));
      candidates = entries.filter((entry) => Number.isFinite(entry.rootMidi) && Math.abs(options.midi - entry.rootMidi) === distance);
    }
    const roundRobin = this.musicRoundRobin.get(name) || 0;
    this.musicRoundRobin.set(name, roundRobin + 1);
    const selected = candidates[roundRobin % candidates.length];
    const buffer = selected.buffer;
    const now = Math.max(this.context.currentTime, options.at ?? this.context.currentTime);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const rootMidi = Number.isFinite(selected.rootMidi) ? selected.rootMidi : options.rootMidi;
    const semitones = Number.isFinite(options.midi) && Number.isFinite(rootMidi) ? options.midi - rootMidi : 0;
    const rate = clamp(2 ** (semitones / 12) * (options.rate || 1), .38, 3.2);
    source.buffer = buffer;
    if (source.playbackRate) source.playbackRate.value = rate;
    filter.type = "lowpass";
    filter.frequency.value = options.filter ?? 12000;
    filter.Q.value = .5;
    const available = buffer.duration / rate;
    const duration = Math.max(.04, Math.min(available, options.duration ?? available));
    const attack = Math.min(duration * .4, options.attack ?? .006);
    const release = Math.min(duration * .7, options.release ?? .1);
    gain.gain.setValueAtTime(.0001, now);
    const calibratedVolume = Math.max(.0001, volume * (selected.trim ?? 1) * MUSIC_PROGRAM_GAIN);
    gain.gain.linearRampToValueAtTime(calibratedVolume, now + attack);
    gain.gain.setValueAtTime?.(calibratedVolume, Math.max(now + attack, now + duration - release));
    gain.gain.exponentialRampToValueAtTime?.(.0001, now + duration);
    source.connect(filter).connect(gain);
    this._route(gain, "music", options.pan || 0, options.wet ?? .08, options.delay || 0);
    source.start(now);
    source.stop(now + duration + .025);
    this._track(source, options.priority ?? 8, "music");
    return true;
  }

  play(type, weapon = null, spatial = 1, fallbackPan = 0) {
    if (!AUDIO_EVENTS.includes(type)) return false;
    const mix = this._mix(spatial, fallbackPan);
    if (mix.gain <= 0) return false;
    const now = this.context?.currentTime || 0;
    const ui = { bus: "ui", priority: 88, pan: 0 };
    const local = { bus: "movement", priority: 82, pan: mix.pan, filter: mix.occluded ? 1050 : 11000, wet: mix.occluded ? .015 : .035 };
    const world = { bus: "impact", priority: 65, pan: mix.pan, wet: .05, filter: mix.occluded ? 1050 : 11000 };
    const handling = weapon ? weaponAudioProfile(weapon) : null;
    const v = mix.gain;
    if (type === "uiHover") return this._allow(type, .045) && this.sample("mechanical", .016 * v, { ...ui, rate: .82, filter: 3600 });
    if (type === "uiConfirm") { this.sample("heavyUi", .052 * v, { ...ui, rate: .9, filter: 4200 }); this.sample("mechanical", .018 * v, { ...ui, at: now + .045, rate: .72, filter: 3200 }); return true; }
    if (type === "uiBack") return this.sample("whoosh", .035 * v, { ...ui, rate: .74, filter: 3600 });
    if (type === "uiInvalid") { this.sample("heavyUi", .05 * v, { ...ui, rate: .65, filter: 2100 }); this.sample("mechanical", .02 * v, { ...ui, at: now + .07, rate: .62, filter: 1800 }); return true; }
    if (type === "weaponSelect") return this.sample(handling?.operationSample || "mechanical", .055 * v, { ...ui, rate: 1, filter: 6200 });
    if (type === "pause") return this.sample("heavyUi", .055 * v, { ...ui, rate: .66, filter: 2600 });
    if (type === "resume") { this.sample("whoosh", .04 * v, { ...ui, rate: .82, filter: 4200 }); this.sample("mechanical", .025 * v, { ...ui, at: now + .05, rate: .76, filter: 3800 }); return true; }
    if (type === "matchStart" || type === "go") { const recorded = this.musicSample("battleDrum", .11 * v, { priority: 100, at: now, wet: .08, rate: .88 }); this.musicSample("cymbal", .06 * v, { priority: 100, at: now, wet: .16 }); if (!recorded) this.sample("explosion", .1 * v, { ...local, priority: 100, rate: .72, wet: .12 }); return true; }
    if (type === "countdown") return this.musicSample("battleDrum", .085 * v, { priority: 92, at: now, rate: .9, wet: .05 }) || this.sample("heavyUi", .055 * v, ui);
    if (type === "win" || type === "loss") { const win = type === "win"; this.musicSample("battleDrum", (win ? .1 : .065) * v, { priority: 100, at: now, rate: win ? .88 : .72, wet: .1 }); this.musicSample(win ? "hornSustain" : "celloTrem", .06 * v, { priority: 100, at: now, midi: win ? 45 : 38, wet: .18, filter: 4800 }); if (win) this.musicSample("cymbal", .05 * v, { priority: 100, at: now, wet: .17 }); return true; }
    if (type === "jump" || type === "boost") { this.sample("whoosh", (type === "boost" ? .06 : .042) * v, { ...local, rate: type === "boost" ? 1.08 : .82, filter: type === "boost" ? 6200 : 4200 }); this.sample("heavyUi", .026 * v, { ...local, rate: .68, filter: 2200 }); return true; }
    if (type === "land") { this.sample("impact", .072 * v, { ...local, rate: .72, wet: .035, filter: 4200 }); this.sample("footstep", .036 * v, { ...local, at: now + .012, rate: .76, filter: 2600 }); return true; }
    if (type === "footstep") { if (!this._allow(`step:${spatial?.actorId || "local"}`, spatial?.local ? .12 : .18)) return false; return this.sample("footstep", .034 * v, { ...local, rate: .88 + (spatial?.strength || .5) * .12, wet: .018, filter: 5200 }); }
    if (type === "reload" || type === "reloadComplete") { const complete = type === "reloadComplete"; return this.sample(handling?.operationSample || "mechanical", .06 * v, { ...local, rate: complete ? 1.08 : .84, filter: mix.occluded ? 1050 : complete ? 6800 : 4800 }); }
    if (type === "empty") return this._allow(`empty:${weapon?.id || "generic"}`, .13) && this.sample(handling?.operationSample || "mechanical", .038 * v, { ...local, rate: .72, filter: 2800 });
    if (type === "lowAmmo") { this.sample("mechanical", .026 * v, { ...local, rate: .72, filter: 3000 }); this.sample("mechanical", .022 * v, { ...local, at: now + .09, rate: .64, filter: 2500 }); return true; }
    if (type === "equip") { this.sample("whoosh", .024 * v, { ...world, rate: .74, filter: 3600 }); this.sample(handling?.operationSample || "mechanical", .05 * v, { ...world, at: now + .025, rate: 1, filter: 5600 }); return true; }
    if (type === "freeze" || type === "thaw") { this.sample("iceCrack", .06 * v, { ...local, rate: type === "freeze" ? .86 : .66, filter: type === "freeze" ? 7200 : 4200 }); this.sample("whoosh", .028 * v, { ...local, rate: type === "freeze" ? .72 : 1.02, filter: 4600 }); return true; }
    if (type.startsWith("grapple")) {
      const attach = type === "grappleAttach";
      this.sample(attach ? "impact" : "cableSnap", (attach ? .07 : .052) * v, { ...local, rate: type === "grappleWrap" ? .94 : type === "grappleMiss" ? .68 : .82, filter: type === "grappleWrap" ? 5200 : 3400 });
      if (type === "grappleFire" || type === "grappleRelease") this.sample("whoosh", .034 * v, { ...local, rate: type === "grappleRelease" ? 1.04 : .78, filter: 4800 });
      return true;
    }
    if (type === "hitConfirm" || type === "elimination") { const kill = type === "elimination"; this.sample(kill ? "heavyUi" : "mechanical", (kill ? .065 : .032) * v, { ...ui, priority: kill ? 100 : 92, rate: kill ? .72 : .9, filter: kill ? 2800 : 4200 }); if (kill) this.sample("impact", .04 * v, { ...ui, at: now + .035, priority: 100, rate: .68, filter: 2400 }); return true; }
    if (type === "damage" || type === "death") { const death = type === "death"; this.sample(death ? "explosion" : "impact", (death ? .12 : .072) * v, { ...local, priority: death ? 100 : 94, rate: death ? .68 : .88, wet: death ? .14 : .04, filter: death ? 4200 : 5800 }); this.sample("heavyUi", (death ? .05 : .026) * v, { ...local, priority: death ? 100 : 94, rate: .62, filter: 2200 }); this.duckMusic(death ? .52 : .26, death ? .32 : .12); return true; }
    if (type === "respawn") { this.sample("whoosh", .065 * v, { ...local, rate: .84, filter: 6200 }); this.sample("heavyUi", .045 * v, { ...local, at: now + .16, rate: .74, filter: 3000 }); return true; }
    if (type === "bounce") { if (!this._allow(`bounce:${spatial?.ownerId || "world"}:${weapon?.id || "object"}`, .055)) return false; return this.sample("mechanical", .04 * v, { ...world, rate: .62 + (weapon ? weaponPresentation(weapon).signature * .28 : 0), filter: 3800 }); }
    if (type === "stick" || type === "arm") { this.sample("mechanical", .05 * v, { ...world, rate: type === "arm" ? .88 : .62, filter: type === "arm" ? 4600 : 2600 }); this.sample("heavyUi", .024 * v, { ...world, at: now + .04, rate: .7, filter: 2400 }); return true; }
    if (type === "split") { [0, 1, 2].forEach((index) => this.sample(index ? "mechanical" : "impact", (index ? .026 : .05) * v, { ...world, at: now + index * .035, rate: .68 + index * .08, filter: 4200 })); return true; }
    if (["teleport", "steal", "construct"].includes(type)) { this.sample("whoosh", .06 * v, { ...world, rate: type === "construct" ? .68 : .92, filter: 5200 }); this.sample(type === "construct" ? "impact" : "mechanical", .045 * v, { ...world, at: now + .08, rate: .7, filter: 3200 }); return true; }
    if (type === "hazardSpawn" || type === "hazardEnd") { this.sample(type === "hazardSpawn" ? "explosion" : "whoosh", .09 * v, { ...world, rate: type === "hazardSpawn" ? .62 : .72, filter: 3600, wet: .13 }); this.sample("impact", .04 * v, { ...world, at: now + .05, rate: .64, filter: 2400 }); return true; }
    if (type === "power" || type === "pickup") { this.sample("whoosh", .048 * v, { ...local, rate: .86, filter: 5200 }); this.sample("heavyUi", .035 * v, { ...local, at: now + .05, rate: .76, filter: 3200 }); return true; }
    if (type === "impact" && weapon) return this.playImpact(weapon, spatial, fallbackPan);
    return false;
  }

  playWeapon(weapon, spatial = 1, fallbackPan = 0) {
    if (!weapon) return false;
    const profile = weaponPresentation(weapon);
    const authored = weaponAudioProfile(weapon);
    const mix = this._mix(spatial, fallbackPan);
    const remote = typeof spatial === "object" && !spatial.local;
    if (!this._allow(`fire:${spatial?.ownerId || "local"}:${weapon.id}`, remote && profile.rapid ? .08 : profile.rapid ? .025 : .012) || mix.gain <= 0) return false;
    const volume = Math.min(.13, Math.max(.008, .112 * mix.gain));
    const distanceWet = remote ? .045 + mix.distanceRatio * .16 : .025;
    const distanceFilter = mix.occluded ? 1100 : 11000 - mix.distanceRatio * 5200;
    const opts = { bus: "weapon", pan: mix.pan, priority: remote ? 46 : 90, wet: distanceWet, filter: distanceFilter };
    const now = this.context?.currentTime || 0;
    const microVariation = 1 + ((((identityHash(`${weapon.id}:${Math.floor(now * 1000)}`) >>> 4) % 11) - 5) * .0035);
    return this.sample(authored.fireSample, volume, {
      ...opts, rate: microVariation,
      filter: mix.occluded ? 1050 : Math.min(distanceFilter, 7600 + authored.formant * .45)
    });
  }

  playImpact(weapon, spatial = 1, fallbackPan = 0, surface = "world") {
    if (!weapon) return false;
    const authored = weaponAudioProfile(weapon);
    const mix = this._mix(spatial, fallbackPan);
    if (mix.gain <= 0 || !this._allow(`impact:${weapon.id}:${surface}`, weapon.radius ? .055 : .018)) return false;
    const volume = Math.min(.12, Math.max(.005, .09 * mix.gain));
    const opts = { bus: "impact", pan: mix.pan, priority: weapon.radius ? 82 : surface === "player" ? 74 : 58, wet: .055 + mix.distanceRatio * .2, filter: mix.occluded ? 1050 : 11000 - mix.distanceRatio * 5600 };
    const surfaceRate = surface === "player" ? .96 : surface === "metal" ? 1.035 : surface === "wall" ? 1.015 : 1;
    return this.sample(authored.impactSample, volume, {
      ...opts, rate: surfaceRate,
      filter: mix.occluded ? 1050 : surface === "player" ? 4800 : surface === "metal" ? 10500 : 8200,
      wet: weapon.radius ? .14 : .065
    });
  }

  updateChargeLoop(id, weapon, progress = 0, spatial = 1) {
    if (!id || !weapon?.chargeTime || !this.context || !this.enabled) return this.stopChargeLoop(id);
    const mix = this._mix(spatial);
    const level = clamp(progress), now = this.context.currentTime;
    let loop = this.chargeLoops.get(id);
    if (loop?.weaponId !== weapon.id) { this.stopChargeLoop(id); loop = null; }
    if (!loop) {
      const priority = typeof spatial === "object" && spatial.local ? 62 : 28;
      if (!this._claimContinuous(1, priority)) return false;
      const profile = weaponPresentation(weapon), authored = weaponAudioProfile(weapon), source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      source.buffer = this.sampleBank[authored.chargeSample] || this.sampleBank.chargeLoop; source.loop = true; source.playbackRate.value = 1;
      filter.type = "bandpass"; filter.Q.value = .85; gain.gain.value = .0001;
      source.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .025); source.start();
      loop = { nodes: [source], source, panner, filter, gain, profile, weaponId: weapon.id }; this.chargeLoops.set(id, loop); this._trackContinuous(source, { priority, group: "charge", map: this.chargeLoops, id });
    }
    const volume = Math.max(.002, .036 * mix.gain) * (.12 + level ** 1.35 * .88);
    loop.filter.frequency.setTargetAtTime(mix.occluded ? 950 : 420 + level * 2300, now, .035); loop.filter.Q.setTargetAtTime(.85 + level * 1.1, now, .04); loop.gain.gain.setTargetAtTime(volume, now, .025); loop.panner?.pan.setTargetAtTime(mix.pan, now, .035);
    return true;
  }

  stopChargeLoop(id) { return this._stopLoop(this.chargeLoops, id, .085); }
  stopAllChargeLoops() { for (const id of [...this.chargeLoops.keys()]) this.stopChargeLoop(id); }

  updateWeaponLoop(id, weapon, active, spatial = 1) {
    if (!active || !weapon?.maintained || !this.context || !this.enabled) return this.stopWeaponLoop(id);
    const mix = this._mix(spatial), now = this.context.currentTime;
    let loop = this.weaponLoops.get(id);
    if (loop?.weaponId !== weapon.id) { this.stopWeaponLoop(id); loop = null; }
    if (!loop) {
      const priority = typeof spatial === "object" && spatial.local ? 58 : 26;
      const profile = weaponPresentation(weapon), authored = weaponAudioProfile(weapon);
      if (!this._claimContinuous(1, priority)) return false;
      const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      source.buffer = this.sampleBank[authored.loopSample] || this.sampleBank.weaponLoop; source.loop = true; source.playbackRate.value = 1;
      filter.type = "lowpass"; filter.Q.value = .65; gain.gain.value = .0001; source.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .035); source.start();
      const nodes = [source];
      loop = { nodes, source, panner, filter, gain, profile, weaponId: weapon.id }; this.weaponLoops.set(id, loop);
      for (const node of nodes) this._trackContinuous(node, { priority, group: "weapon", map: this.weaponLoops, id });
    }
    const volume = Math.max(.002, .032 * mix.gain);
    loop.filter.frequency.setTargetAtTime(mix.occluded ? 980 : 480 + loop.profile.audioPitch * 1.1, now, .045); loop.gain.gain.setTargetAtTime(volume, now, .025); loop.panner?.pan.setTargetAtTime(mix.pan, now, .035);
    return true;
  }

  stopWeaponLoop(id) { return this._stopLoop(this.weaponLoops, id, .12); }

  updateGrappleLoop(id, active, { tension = 0, speed = 0, ...spatial } = {}) {
    if (!active || !this.context || !this.enabled) return this._stopLoop(this.grappleLoops, id, .1);
    const mix = this._mix(spatial), now = this.context.currentTime;
    let loop = this.grappleLoops.get(id);
    if (!loop) {
      const priority = spatial.local ? 55 : 24;
      if (!this._claimContinuous(1, priority)) return false;
      const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      source.buffer = this.sampleBank.grappleLoop; source.loop = true; source.playbackRate.value = .82;
      filter.type = "bandpass"; filter.Q.value = 1.1; gain.gain.value = .0001; source.connect(filter).connect(gain); const panner = this._route(gain, "movement", mix.pan, .03); source.start();
      loop = { nodes: [source], source, panner, filter, gain }; this.grappleLoops.set(id, loop); this._trackContinuous(source, { priority, group: "grapple", map: this.grappleLoops, id });
    }
    loop.source.playbackRate.setTargetAtTime?.(.78 + clamp(tension) * .18 + Math.min(.16, speed * .004), now, .05); loop.filter.frequency.setTargetAtTime(mix.occluded ? 950 : 540 + clamp(tension) * 1450, now, .05); loop.gain.gain.setTargetAtTime(.004 + mix.gain * (.008 + clamp(tension) * .018), now, .04); loop.panner?.pan.setTargetAtTime(mix.pan, now, .035);
    return true;
  }

  updateHazardLoop(id, weapon, active, spatial = {}) {
    if (!active || !weapon?.hazard || !this.context || !this.enabled) return this._stopLoop(this.hazardLoops, id, .2);
    if (!this.hazardLoops.has(id) && this.hazardLoops.size >= 4) return false;
    const mix = this._mix(spatial), now = this.context.currentTime;
    let loop = this.hazardLoops.get(id);
    if (!loop) {
      if (!this._claimContinuous(1, 68)) return false;
      const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      const authored = weaponAudioProfile(weapon);
      source.buffer = this.sampleBank[authored.hazardSample] || this.sampleBank.hazardLoop; source.loop = true; source.playbackRate.value = 1; filter.type = "lowpass"; gain.gain.value = .0001;
      source.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .1); source.start();
      loop = { nodes: [source], source, panner, filter, gain, weaponId: weapon.id }; this.hazardLoops.set(id, loop); this._trackContinuous(source, { priority: 68, group: "hazard", map: this.hazardLoops, id });
    }
    loop.filter.frequency.setTargetAtTime(mix.occluded ? 880 : 420 + mix.gain * 1800, now, .1); loop.gain.gain.setTargetAtTime(.002 + mix.gain * .025, now, .08); loop.panner?.pan.setTargetAtTime(mix.pan, now, .05);
    return true;
  }

  updateProjectileLoop(id, weapon, active, spatial = {}) {
    if (!active || !id || !this.context || !this.enabled) return this._stopLoop(this.projectileLoops, id, .08);
    if (!this.projectileLoops.has(id) && this.projectileLoops.size >= 6) return false;
    const mix = this._mix(spatial), now = this.context.currentTime;
    let loop = this.projectileLoops.get(id);
    if (!loop) {
      if (!this._claimContinuous(1, 76)) return false;
      const profile = weaponPresentation(weapon), authored = weaponAudioProfile(weapon), source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      source.buffer = this.sampleBank[authored.flightSample] || this.sampleBank.projectileLoop; source.loop = true; source.playbackRate.value = 1;
      filter.type = "bandpass"; filter.Q.value = .75; gain.gain.value = .0001; source.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .055); source.start();
      loop = { nodes: [source], source, panner, filter, gain, profile, weaponId: weapon.id }; this.projectileLoops.set(id, loop); this._trackContinuous(source, { priority: 76, group: "projectile", map: this.projectileLoops, id });
    }
    const speed = spatial.speed || weapon.projectileSpeed || 1;
    loop.filter.frequency.setTargetAtTime(mix.occluded ? 900 : 700 + speed * 22, now, .05);
    loop.gain.gain.setTargetAtTime(.001 + mix.gain * .014, now, .045);
    loop.panner?.pan.setTargetAtTime(mix.pan, now, .03);
    return true;
  }

  _stopLoop(map, id, fade = .1) {
    const loop = map.get(id);
    if (!loop) return false;
    const now = this.context?.currentTime || 0;
    loop.gain?.gain.cancelScheduledValues?.(now); loop.gain?.gain.setTargetAtTime?.(.0001, now, Math.max(.01, fade * .24));
    for (const node of loop.nodes || [loop.source].filter(Boolean)) {
      const priority = this.continuousSources.get(node)?.priority || 0;
      this.continuousSources.delete(node);
      if (fade > 0) this._countFade(node, fade, priority);
      try { node.stop(now + fade); } catch {}
    }
    map.delete(id);
    return true;
  }

  updateFighter(id, state = {}) {
    if (!id) return;
    const previous = this.fighterStates.get(id);
    const spatial = { ...state, actorId: id };
    if (previous) {
      if (previous.alive && state.alive === false) this.play("death", null, spatial);
      else if (!previous.alive && state.alive) this.play("respawn", null, spatial);
      if (!previous.grounded && state.grounded && (state.verticalSpeed ?? -1) <= 0) this.play("land", null, { ...spatial, volume: clamp(Math.abs(previous.verticalSpeed || 0) / 20, .35, 1) });
      if (!state.local && previous.grounded && !state.grounded && state.verticalSpeed > 2) this.play("jump", null, spatial);
      if (!previous.boosted && state.boosted) this.play("boost", null, spatial);
      if (!previous.reloading && state.reloading) this.play("reload", state.weapon, spatial);
      if (previous.reloading && !state.reloading) this.play("reloadComplete", state.weapon, spatial);
      if (!previous.slowed && state.slowed) this.play("freeze", state.weapon, spatial);
      if (previous.slowed && !state.slowed) this.play("thaw", state.weapon, spatial);
      if (!previous.lowAmmo && state.lowAmmo) this.play("lowAmmo", state.weapon, spatial);
    }
    const stepPeriod = clamp(.48 - (state.speed || 0) * .014, .19, .48);
    const now = this.context?.currentTime || 0;
    if (state.grounded && state.alive && state.speed > 3 && now >= (previous?.nextStep || 0)) {
      this.play("footstep", null, { ...spatial, strength: clamp(state.speed / 24), volume: state.local ? .9 : .3 });
      spatial.nextStep = now + stepPeriod;
    } else spatial.nextStep = previous?.nextStep || 0;
    this.fighterStates.set(id, { ...state, nextStep: spatial.nextStep });
  }

  startAmbience(theme = "foundry") {
    if (!this.context || this.ambienceNodes) return false;
    if (!this._claimContinuous(2, 4)) return false;
    const gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    gain.gain.value = .018; filter.type = "lowpass"; filter.frequency.value = 720;
    const buffer = this.sampleBank[`ambience${theme[0].toUpperCase()}${theme.slice(1)}`] || this.sampleBank.ambienceFoundry;
    const nodes = [0, 1].map((index) => { const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true; source.playbackRate.value = index ? .73 : 1; source.connect(filter); source.start(0, index ? .61 : 0); return source; });
    filter.connect(gain).connect(this._bus("ambience")); this.ambienceNodes = { nodes, filter, gain, theme };
    for (const node of nodes) this._trackContinuous(node, { priority: 4, group: "ambience" });
    return true;
  }

  updateAmbience({ danger = 0, speed = 0 } = {}) {
    if (!this.ambienceNodes || !this.context) return;
    const now = this.context.currentTime;
    this.ambienceNodes.filter.frequency.setTargetAtTime(480 + clamp(danger) * 520 + clamp(speed) * 680, now, .3);
    this.ambienceNodes.gain.gain.setTargetAtTime(.012 + clamp(danger) * .01 + clamp(speed) * .008, now, .25);
    if (this._allow("ambience-detail", 2.4)) {
      const foundry = this.ambienceNodes.theme === "foundry";
      this.sample(foundry ? "mechanical" : "whoosh", .012, { bus: "ambience", priority: 6, pan: Math.sin(now * .31), wet: .12, rate: foundry ? .62 : .78, filter: foundry ? 2600 : 5200 });
    }
  }

  stopAmbience() {
    if (!this.ambienceNodes) return;
    for (const node of this.ambienceNodes.nodes) { const priority = this.continuousSources.get(node)?.priority || 4; this.continuousSources.delete(node); this._countFade(node, .1, priority); try { node.stop?.(this.context?.currentTime + .1); } catch {} }
    this.ambienceNodes = null;
  }

  startEngine(id) { if (!this.context || this.engineNodes.has(id)) return; this.engineNodes.set(id, { speed: 0 }); }
  updateEngine(id, speed, boosting) { const node = this.engineNodes.get(id); if (node) Object.assign(node, { speed, boosting }); }

  startMusic(scene = "menu", seed = "BLAST-01") {
    if (!this.context || !this.enabled) return false;
    if (scene === "countdown") return Boolean(this.startCountdown(seed));
    if (!this.musicSamplesReady) {
      this.musicCountdown = null;
      this.pendingMusicStart = { scene, seed };
      this._loadMusicSamples();
      return true;
    }
    this.pendingMusicStart = null;
    this.musicSeed = seed || "BLAST-01"; this.musicPaused = false; this.musicSuspended = false;
    if (this.musicTimer) {
      if (scene === "combat" && this.musicScene === "countdown") return true;
      if (scene === "combat") this._setMusicSceneNow(scene, this.musicTargetIntensity);
      else this.setMusicScene(scene);
      return true;
    }
    this.musicCountdown = null;
    this.musicScene = scene;
    this.musicBpm = scene === "combat" ? tempoForIntensity(this.musicTargetIntensity, this.musicBpm) : MUSIC.tempoTiers[0];
    this.musicStep = 0; this.musicNextTime = this.context.currentTime + .05;
    this.musicTimer = setInterval(() => this._scheduleMusic(), 25);
    this._scheduleMusic();
    return true;
  }

  _setMusicSceneNow(scene, intensity = null, at = null) {
    const now = this.context?.currentTime || 0;
    const startAt = at ?? now + .035;
    this.musicScene = scene;
    this.pendingMusicScene = null;
    this.musicStep = 0;
    this.musicNextTime = startAt;
    if (Number.isFinite(intensity)) this.musicIntensity = this.musicTargetIntensity = clamp(intensity);
    this.musicBarIntensity = this.musicIntensity;
    this.musicBpm = scene === "combat" ? tempoForIntensity(this.musicIntensity, this.musicBpm) : MUSIC.tempoTiers[0];
    this.musicSample(scene.startsWith("results") ? "cymbal" : "battleDrum", .052, { priority: MUSIC_PRIORITY, at: startAt, wet: .14, rate: .86 });
  }

  _stopMusicVoicesAt(at) {
    const now = this.context?.currentTime || 0;
    for (const voice of [...this.activeVoices]) {
      if (voice.group !== "music") continue;
      try { voice.source.stop(at); } catch {}
      this.activeVoices.delete(voice);
      if (at > now) this._countFade(voice.source, at - now, voice.priority);
    }
  }

  startCountdown(seed = "BLAST-01", combatIntensity = .42) {
    if (!this.context || !this.enabled) return null;
    if (!this.musicSamplesReady) {
      const beatDuration = 60 / MUSIC.countdownBpm;
      this.musicSeed = seed || "BLAST-01";
      this.musicCountdown = { pending: true, startTime: null, endTime: null, beatDuration, combatIntensity: clamp(combatIntensity), completed: false };
      this.pendingMusicStart = { scene: "countdown", seed, combatIntensity };
      this._loadMusicSamples();
      return this.getCountdownState();
    }
    this.pendingMusicStart = null;
    const now = this.context.currentTime;
    const beatDuration = 60 / MUSIC.countdownBpm;
    const startTime = now + .05;
    const endTime = startTime + beatDuration * 8;
    this.musicSeed = seed || "BLAST-01";
    this.musicPaused = false;
    this.musicSuspended = false;
    this._stopMusicVoicesAt(startTime);
    this.musicScene = "countdown";
    this.pendingMusicScene = null;
    this.musicStep = 0;
    this.musicNextTime = startTime;
    this.musicIntensity = this.musicBarIntensity = .3;
    this.musicTargetIntensity = .3;
    this.musicBpm = MUSIC.countdownBpm;
    this.countdownStepsScheduled = 0;
    this.musicCountdown = { startTime, endTime, beatDuration, combatIntensity: clamp(combatIntensity), completed: false };
    if (!this.musicTimer) this.musicTimer = setInterval(() => this._scheduleMusic(), 25);
    this._scheduleMusic();
    return this.getCountdownState();
  }

  getCountdownState() {
    if (!this.context || !this.musicCountdown) return null;
    const gate = this.musicCountdown;
    if (gate.pending) return { startTime: null, endTime: null, remaining: gate.beatDuration * 8, beatsRemaining: 8, active: true, pending: true };
    const now = this.musicPaused && this.musicPauseTime != null ? this.musicPauseTime : this.context.currentTime;
    const remaining = Math.max(0, gate.endTime - now);
    const elapsed = Math.max(0, now - gate.startTime);
    const beatIndex = Math.min(8, Math.floor(elapsed / gate.beatDuration));
    return { startTime: gate.startTime, endTime: gate.endTime, remaining, beatsRemaining: Math.max(0, 8 - beatIndex), active: now < gate.endTime };
  }

  _finishCountdownAt(at) {
    if (!this.musicCountdown || this.musicCountdown.completed) return;
    this._stopMusicVoicesAt(at);
    this.lastCountdownStepCount = this.countdownStepsScheduled;
    this.musicCountdown.completed = true;
    const intensity = this.musicCountdown.combatIntensity;
    this.musicScene = "combat";
    this.musicStep = 0;
    this.musicNextTime = at;
    this.musicIntensity = this.musicTargetIntensity = this.musicBarIntensity = intensity;
    this.musicBpm = tempoForIntensity(intensity, MUSIC.bpm);
    this.musicSample("battleDrum", .1, { priority: 96, at, wet: .1, rate: .86 });
    this.musicSample("cymbal", .06, { priority: 96, at, wet: .18 });
    this.sample("explosion", .09, { bus: "movement", group: "go", priority: 100, at, rate: .68, filter: 3800, wet: .12 });
  }

  setMusicScene(scene, outcome = "win") {
    const target = scene === "results" ? `results-${outcome}` : scene;
    if (target !== "countdown" && target !== "combat") this.musicCountdown = null;
    if (!this.musicTimer) this.musicScene = target;
    else if (target !== this.musicScene) this.pendingMusicScene = { scene: target, reset: ["combat", "countdown"].includes(target) || target.startsWith("results") };
    if (target === "menu") this.musicTargetIntensity = .22;
    if (this.context) this.musicNextTime = Math.max(this.musicNextTime, this.context.currentTime + .03);
  }

  setMusicIntensity(value) { this.musicTargetIntensity = clamp(Number(value) || 0); }

  _scheduleMusic() {
    if (!this.context || !this.enabled || this.musicPaused) return;
    const horizon = this.context.currentTime + .12;
    this.musicIntensity += (this.musicTargetIntensity - this.musicIntensity) * .08;
    while (this.musicNextTime < horizon) {
      if (this.musicScene === "countdown" && this.musicCountdown && this.musicNextTime >= this.musicCountdown.endTime - 1e-6) this._finishCountdownAt(this.musicCountdown.endTime);
      let step = this.musicStep % MUSIC.stepsPerBar;
      if (this.pendingMusicScene && (step === 0 || (this.pendingMusicScene.scene.startsWith("results") && step % MUSIC.stepsPerBeat === 0))) {
        const transition = this.pendingMusicScene;
        this.pendingMusicScene = null;
        this.musicScene = transition.scene;
        if (transition.reset) this.musicStep = 0;
        this.musicBpm = this.musicScene === "combat" ? tempoForIntensity(this.musicIntensity, this.musicBpm) : MUSIC.tempoTiers[0];
        this.musicSample(this.musicScene.startsWith("results") ? "cymbal" : "battleDrum", .052, { priority: MUSIC_PRIORITY, at: this.musicNextTime, wet: .14, rate: .86 });
        step = 0;
      }
      const bar = Math.floor(this.musicStep / MUSIC.stepsPerBar);
      if (step === 0) {
        this.musicBarIntensity = this.musicIntensity;
        if (this.musicScene === "combat") this.musicBpm = tempoForIntensity(this.musicBarIntensity, this.musicBpm);
        if (this.musicDelay) this.musicDelay.delayTime.setTargetAtTime?.((60 / this.musicBpm) * .75, this.musicNextTime, .015);
      }
      const stepDuration = 60 / (this.musicScene === "countdown" ? MUSIC.countdownBpm : this.musicBpm) / MUSIC.stepsPerBeat;
      if (this.musicScene === "countdown") {
        this.countdownStepsScheduled++;
      }
      const events = musicEventsForStep({ seed: this.musicSeed, bar, step, scene: this.musicScene, intensity: this.musicBarIntensity });
      for (const event of events) this._scheduleMusicEvent(event, this.musicNextTime, stepDuration);
      this.musicStep += 1; this.musicNextTime += stepDuration;
    }
  }

  _scheduleMusicEvent(event, at, stepDuration) {
    const duration = Math.max(.035, event.durationSteps * stepDuration * .94);
    const priority = event.layer.startsWith("countdown-") ? 92 : MUSIC_PRIORITY;
    this.musicSample(event.sample, event.gain, {
      priority, at, duration, pan: event.pan, filter: event.filterHz,
      wet: event.wet, attack: event.attack, release: event.release,
      midi: event.midi, rootMidi: event.rootMidi, rate: event.rate, delay: 0
    });
  }

  duckMusic(amount = .3, duration = .14) {
    const bus = this.buses.music;
    if (!bus || !this.context) return;
    const now = this.context.currentTime, base = this._musicBusGain();
    bus.gain.cancelScheduledValues?.(now); bus.gain.setTargetAtTime(base * (1 - clamp(amount)), now, .012); bus.gain.setTargetAtTime(base, now + duration, .06);
  }

  setPaused(paused) {
    const wasPaused = this.musicPaused;
    this.musicPaused = Boolean(paused);
    if (!this.context) return;
    const now = this.context.currentTime;
    if (this.musicPaused && !wasPaused) this.musicPauseTime = now;
    if (!this.musicPaused && wasPaused && this.musicPauseTime != null && this.musicCountdown && !this.musicCountdown.completed) {
      const shift = Math.max(0, now - this.musicPauseTime);
      this.musicCountdown.startTime += shift;
      this.musicCountdown.endTime += shift;
      this.musicNextTime = this.musicCountdown.startTime + this.musicStep * (60 / MUSIC.countdownBpm / MUSIC.stepsPerBeat);
    }
    if (!this.musicPaused) this.musicPauseTime = null;
    if (!this.musicPaused) this._resumePendingMusic();
    this.buses.music?.gain.setTargetAtTime(this._musicBusGain(), now, .08);
    this.musicFilter?.frequency.setTargetAtTime(paused ? 650 : 6400, now, .09);
    this.buses.ambience?.gain.setTargetAtTime(this._ambienceBusGain(), now, .08);
    if (paused && this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; this.musicSuspended = true; }
    else if (!paused && this.musicSuspended) { this.musicSuspended = false; if (!this.musicCountdown || this.musicCountdown.completed) this.musicNextTime = now + .04; this.musicTimer = setInterval(() => this._scheduleMusic(), 25); }
  }

  stopMusic(fade = .2) {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.pendingMusicStart = null;
    this.musicTimer = null;
    this.musicCountdown = null;
    this.musicPauseTime = null;
    const now = this.context?.currentTime || 0;
    const bus = this.buses.music;
    if (bus && this.context) {
      bus.gain.cancelScheduledValues?.(now);
      bus.gain.setValueAtTime?.(Math.max(.0001, bus.gain.value), now);
      bus.gain.linearRampToValueAtTime?.(.0001, now + fade);
    }
    for (const voice of [...this.activeVoices]) if (voice.group === "music") { try { voice.source.stop(now + fade); } catch {} this.activeVoices.delete(voice); if (fade > 0) this._countFade(voice.source, fade, voice.priority); }
    if (bus) setTimeout(() => bus.gain.setTargetAtTime?.(this._musicBusGain(), this.context?.currentTime || 0, .02), Math.max(0, fade * 1000 + 20));
    return true;
  }

  stopOwner(id) {
    this.stopWeaponLoop(id); this.stopChargeLoop(id); this._stopLoop(this.grappleLoops, id, .08); this.fighterStates.delete(id);
  }

  stopAll() {
    this.stopAllChargeLoops();
    for (const id of [...this.weaponLoops.keys()]) this.stopWeaponLoop(id);
    for (const id of [...this.grappleLoops.keys()]) this._stopLoop(this.grappleLoops, id, .08);
    for (const id of [...this.hazardLoops.keys()]) this._stopLoop(this.hazardLoops, id, .15);
    for (const id of [...this.projectileLoops.keys()]) this._stopLoop(this.projectileLoops, id, .08);
    this.stopAmbience(); this.fighterStates.clear();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) { this.stopAll(); this.stopMusic(); }
    this.setVolume(this.volume);
    return this.enabled;
  }

  dispose() {
    if (this.musicRetryTimer) clearTimeout(this.musicRetryTimer);
    this.musicRetryTimer = null;
    this.stopAll(); this.stopMusic(0); for (const voice of [...this.activeVoices]) try { voice.source.stop?.(); } catch {} this.activeVoices.clear(); this.context?.close?.(); this.context = null;
  }
}
