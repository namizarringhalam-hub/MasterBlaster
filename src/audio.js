import { MUSIC, musicEventsForStep } from "./musicScore.js";
import { weaponPresentation } from "./weaponPresentation.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const MASTER_GAIN = .52;
const VOICE_LIMIT = 48;
const CONTINUOUS_LIMIT = 40;

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
    accentWave: ["sine", "triangle", "sawtooth", "square"][hash % 4],
    accentRatio: .72 + ((hash >>> 4) % 17) / 10,
    accentSlide: .35 + ((hash >>> 9) % 21) / 10,
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

function isCloseRapid(profile, weapon) {
  return profile.rapid && profile.delivery === "projectile" && weapon.hitscan && weapon.maxUsefulRange <= 40 && weapon.spread >= .04;
}

export class SoundBoard {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
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
    this.master.connect(this.compressor).connect(this.limiter);
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
    this.buses.music.disconnect?.();
    this.buses.music.connect(this.musicFilter).connect(this.master);
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
    this.noiseBuffer = context.createBuffer(2, context.sampleRate * 2, context.sampleRate);
    for (let channel = 0; channel < this.noiseBuffer.numberOfChannels; channel++) {
      const noise = this.noiseBuffer.getChannelData(channel);
      let previous = 0;
      for (let index = 0; index < noise.length; index++) {
        const white = Math.random() * 2 - 1;
        previous = previous * .86 + white * .14;
        noise[index] = white * .62 + previous * .38;
      }
    }
    if (context.createPeriodicWave) this.musicWave = context.createPeriodicWave(new Float32Array([0, 1, .34, .16, .08, .035]), new Float32Array(6));
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
    if (typeof input === "number") return { gain: clamp(input, 0, 1.5), pan: clamp(fallbackPan, -1, 1), occluded: false };
    if (input?.local) return { gain: clamp(input.volume ?? 1, 0, 1.5), pan: 0, occluded: false };
    const position = input?.position;
    if (!position) return { gain: clamp(input?.volume ?? 1, 0, 1.5), pan: clamp(input?.pan ?? fallbackPan, -1, 1), occluded: Boolean(input?.occluded) };
    const spatial = spatialMix(this.listenerPosition, [position.x || 0, position.y || 0, position.z || 0], this.listenerForward, input.maxDistance || 180);
    return { gain: spatial.gain * clamp(input.volume ?? 1, 0, 1.5), pan: spatial.pan, occluded: Boolean(input.occluded) };
  }

  _allow(key, interval = 0) {
    const now = this.context?.currentTime || 0;
    if (now - (this.eventTimes.get(key) ?? -Infinity) < interval) return false;
    this.eventTimes.set(key, now);
    return true;
  }

  _claimVoice(priority) {
    while (this.totalVoiceCount() >= VOICE_LIMIT) if (!this._evictForPriority(priority)) return false;
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
    while (this.totalVoiceCount() + count > VOICE_LIMIT) if (!this._evictForPriority(priority)) return false;
    return true;
  }

  _trackContinuous(source, metadata = {}) { this.continuousSources.set(source, { priority: 0, ...metadata }); }
  _evictForPriority(priority) {
    const candidates = [
      ...[...this.activeVoices].map((voice) => ({ kind: "active", source: voice.source, priority: voice.priority || 0, voice })),
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

  _route(node, busName, pan = 0, wet = 0) {
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
    return panner;
  }

  tone(frequency, duration, type = "sine", volume = .1, slide = 1, options = {}) {
    if (!this.enabled || !this.context || !this._claimVoice(options.priority ?? 45)) return false;
    const now = Math.max(this.context.currentTime, options.at ?? this.context.currentTime);
    const attack = Math.min(duration * .35, options.attack ?? .004);
    const release = Math.min(duration * .8, options.release ?? Math.max(.025, duration * .45));
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    osc.type = type;
    if (options.periodic && this.musicWave && osc.setPeriodicWave) osc.setPeriodicWave(this.musicWave);
    osc.frequency.setValueAtTime(Math.max(28, frequency), now);
    osc.frequency.exponentialRampToValueAtTime?.(Math.max(28, frequency * slide), now + duration);
    if (osc.detune && Number.isFinite(options.detune)) osc.detune.value = options.detune;
    filter.type = options.filterType || "lowpass";
    filter.frequency.value = options.filter ?? 12000;
    filter.Q.value = options.q ?? .7;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(.0001, volume), now + attack);
    gain.gain.setValueAtTime?.(Math.max(.0001, volume), Math.max(now + attack, now + duration - release));
    gain.gain.exponentialRampToValueAtTime?.(.0001, now + duration);
    osc.connect(filter).connect(gain);
    this._route(gain, options.bus || "weapon", options.pan || 0, options.wet || 0);
    osc.start(now);
    osc.stop(now + duration + .025);
    this._track(osc, options.priority ?? 45, options.group || "sfx");
    return true;
  }

  noise(duration = .12, volume = .05, frequency = 1100, options = {}) {
    if (!this.enabled || !this.context || !this.noiseBuffer || !this._claimVoice(options.priority ?? 40)) return false;
    const now = Math.max(this.context.currentTime, options.at ?? this.context.currentTime);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = options.filterType || "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = options.q ?? .8;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + (options.attack ?? .002));
    gain.gain.exponentialRampToValueAtTime?.(.0001, now + duration);
    source.connect(filter).connect(gain);
    this._route(gain, options.bus || "impact", options.pan || 0, options.wet ?? .03);
    source.start(now, Math.random() * .7);
    source.stop(now + duration + .02);
    this._track(source, options.priority ?? 40, options.group || "sfx");
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
    const handlingPitch = handling ? handling.pitchRatio * (1 + handling.detune / 2400) : 1;
    const v = mix.gain;
    if (type === "uiHover") return this._allow(type, .045) && this.tone(980, .035, "sine", .022 * v, .88, ui);
    if (type === "uiConfirm") { this.tone(620, .075, "triangle", .055 * v, 1.45, ui); this.tone(930, .09, "sine", .032 * v, 1.08, { ...ui, at: now + .035 }); return true; }
    if (type === "uiBack") return this.tone(520, .11, "triangle", .05 * v, .58, ui);
    if (type === "uiInvalid") { this.tone(118, .16, "square", .045 * v, .82, ui); this.noise(.045, .02 * v, 900, ui); return true; }
    if (type === "weaponSelect") { this.noise(.04 + (handling?.tail || .2) * .025, .032 * v, 1700 + (handling?.formant || 2800) * .24, ui); this.tone(330 * handlingPitch, .09, handling?.accentWave || "triangle", .05 * v, 1.35 + (handling?.accentSlide || 1) * .18, ui); return true; }
    if (type === "pause") return this.tone(420, .18, "sine", .06 * v, .5, ui);
    if (type === "resume") { this.tone(330, .12, "triangle", .055 * v, 1.5, ui); this.tone(660, .16, "sine", .035 * v, 1.05, { ...ui, at: now + .06 }); return true; }
    if (type === "matchStart" || type === "go") { this.tone(82, .38, "sine", .12 * v, .48, { ...local, priority: 96 }); this.tone(660, .32, "sawtooth", .075 * v, 1.7, { ...local, priority: 96 }); return true; }
    if (type === "countdown") return this.tone(440, .11, "square", .07 * v, 1.12, ui);
    if (type === "win" || type === "loss") { const up = type === "win"; [0, 3, 7, 12].forEach((semitone, index) => this.tone(293.66 * 2 ** ((up ? semitone : 7 - semitone / 2) / 12), .42, "triangle", .06 * v, 1.02, { ...ui, at: now + index * .11, priority: 100, wet: .08 })); return true; }
    if (type === "jump" || type === "boost") { this.noise(.12, .045 * v, 1450, local); this.tone(type === "boost" ? 105 : 155, .22, "sawtooth", .055 * v, type === "boost" ? 3.2 : 1.8, local); return true; }
    if (type === "land") { this.noise(.11, .065 * v, 260, local); this.tone(62, .16, "sine", .075 * v, .5, local); return true; }
    if (type === "footstep") { if (!this._allow(`step:${spatial?.actorId || "local"}`, spatial?.local ? .12 : .18)) return false; this.noise(.05, .026 * v, 520 + (spatial?.strength || .5) * 420, local); this.tone(86, .055, "sine", .018 * v, .72, local); return true; }
    if (type === "reload" || type === "reloadComplete") { const complete = type === "reloadComplete"; this.noise(.045 + (handling?.noise || .3) * .025, .045 * v, (complete ? 2500 : 1350) * handlingPitch, local); this.tone((complete ? 580 : 230) * handlingPitch, .075 + (handling?.tail || .25) * .055, handling?.accentWave || "square", .035 * v, complete ? 1.18 + (handling?.accentRatio || 1) * .12 : .58 + (handling?.accentSlide || 1) * .06, local); return true; }
    if (type === "empty") return this._allow(`empty:${weapon?.id || "generic"}`, .13) && this.tone(1180 * handlingPitch + (handling?.formant || 2600) * .1, .03 + (handling?.tail || .2) * .018, handling?.accentWave || "square", .035 * v, .26 + (handling?.accentSlide || 1) * .06, local);
    if (type === "lowAmmo") { this.tone(740, .055, "square", .028 * v, .92, local); this.tone(620, .055, "square", .024 * v, .9, { ...local, at: now + .07 }); return true; }
    if (type === "equip") { this.noise(.04 + (handling?.noise || .3) * .025, .034 * v, 1250 + (handling?.formant || 2600) * .18, world); this.tone(260 * handlingPitch, .075 + (handling?.tail || .2) * .05, handling?.accentWave || "triangle", .035 * v, 1.22 + (handling?.accentRatio || 1) * .16, world); return true; }
    if (type === "freeze" || type === "thaw") { const frozen = type === "freeze"; this.noise(.1, .035 * v, frozen ? 4300 : 2500, local); this.tone(frozen ? 1260 : 520, .18, "triangle", .05 * v, frozen ? .42 : 1.9, local); return true; }
    if (type.startsWith("grapple")) {
      const pitches = { grappleFire: 270, grappleAttach: 92, grappleMiss: 180, grappleWrap: 720, grappleRelease: 340 };
      const pitch = pitches[type] || 420;
      this.noise(type === "grappleAttach" ? .12 : .07, .04 * v, type === "grappleWrap" ? 1800 : 900, local);
      this.tone(pitch, type === "grappleAttach" ? .26 : .14, type === "grappleAttach" ? "sine" : "triangle", .06 * v, type === "grappleRelease" ? 2.2 : .54, local);
      return true;
    }
    if (type === "hitConfirm" || type === "elimination") { const kill = type === "elimination"; this.tone(kill ? 920 : 1280, kill ? .16 : .055, "sine", (kill ? .07 : .04) * v, kill ? .62 : 1.3, { ...ui, priority: kill ? 100 : 92 }); if (kill) this.tone(460, .22, "triangle", .055 * v, 1.7, { ...ui, at: now + .045, priority: 100 }); return true; }
    if (type === "damage" || type === "death") { const death = type === "death"; this.noise(death ? .35 : .12, (death ? .1 : .06) * v, death ? 260 : 620, { ...local, priority: death ? 100 : 94 }); this.tone(death ? 74 : 130, death ? .55 : .18, "sawtooth", .07 * v, death ? .35 : .68, { ...local, priority: death ? 100 : 94 }); this.duckMusic(death ? .52 : .26, death ? .32 : .12); return true; }
    if (type === "respawn") { this.noise(.24, .04 * v, 2600, local); this.tone(180, .42, "sine", .07 * v, 3.8, local); return true; }
    if (type === "bounce") { if (!this._allow(`bounce:${spatial?.ownerId || "world"}:${weapon?.id || "object"}`, .055)) return false; this.tone(520 + (weapon ? weaponPresentation(weapon).signature * 820 : 0), .07, "triangle", .05 * v, .56, world); this.noise(.035, .022 * v, 1900, world); return true; }
    if (type === "stick" || type === "arm") { this.noise(.06, .04 * v, type === "stick" ? 620 : 2100, world); this.tone(type === "arm" ? 1120 : 180, .09, "square", .035 * v, type === "arm" ? 1.08 : .62, world); return true; }
    if (type === "split") { this.noise(.12, .07 * v, 1400, world); [0, 1, 2].forEach((index) => this.tone(340 + index * 170, .11, "triangle", .025 * v, 1.4, { ...world, at: now + index * .025 })); return true; }
    if (["teleport", "steal", "construct"].includes(type)) { this.tone(type === "teleport" ? 240 : type === "steal" ? 410 : 180, .28, "sine", .065 * v, 3.1, world); this.tone(type === "construct" ? 720 : 980, .2, "triangle", .04 * v, .48, { ...world, at: now + .045 }); return true; }
    if (type === "hazardSpawn" || type === "hazardEnd") { this.noise(.3, .07 * v, type === "hazardSpawn" ? 420 : 1200, world); this.tone(68, .42, "sine", .08 * v, type === "hazardSpawn" ? 2.4 : .38, world); return true; }
    if (type === "power" || type === "pickup") { this.tone(330, .25, "sine", .08 * v, 2.5, local); return true; }
    if (type === "impact" && weapon) return this.playImpact(weapon, spatial, fallbackPan);
    return false;
  }

  playWeapon(weapon, spatial = 1, fallbackPan = 0) {
    if (!weapon) return false;
    const profile = weaponPresentation(weapon);
    const identity = WEAPON_AUDIO_IDENTITIES[weapon.id] || [weapon.id, 1, profile.audioNoise, .4];
    const authored = weaponAudioProfile(weapon);
    const mix = this._mix(spatial, fallbackPan);
    const remote = typeof spatial === "object" && !spatial.local;
    if (!this._allow(`fire:${spatial?.ownerId || "local"}:${weapon.id}`, remote && profile.rapid ? .08 : profile.rapid ? .025 : .012) || mix.gain <= 0) return false;
    const volume = Math.min(.105, Math.max(.006, .092 * mix.gain));
    const pitch = profile.audioPitch * identity[1] * (.96 + profile.signature * .08);
    const opts = { bus: "weapon", pan: mix.pan, priority: remote ? 46 : 90, wet: remote ? .065 : .025, filter: mix.occluded ? 1100 : 11000, detune: authored.detune };
    const now = this.context?.currentTime || 0;
    const accent = () => this.tone(pitch * authored.accentRatio, .026 + authored.tail * .028, authored.accentWave, volume * (.1 + authored.noise * .09), authored.accentSlide, { ...opts, at: now + .008, filter: mix.occluded ? 1050 : authored.formant });
    if (profile.payload === "fireball") {
      this.noise(.16, volume * .82, 480, opts); this.tone(104, .2, "sawtooth", volume, 1.9, opts); this.tone(pitch * 1.4, .11, "triangle", volume * .42, .44, opts); accent(); return true;
    }
    if (profile.delivery === "flame") {
      this.noise(.11, volume * .82, 520, opts); this.tone(74, .1, "sawtooth", volume * .35, .72, opts); accent(); return true;
    }
    if (profile.delivery === "melee") {
      this.noise(.09 + profile.weight * .06, volume, 900 + pitch * .9, opts); this.tone(68 + profile.weight * 58, .13, "triangle", volume * .62, .38 + profile.signature * .18, opts); accent(); return true;
    }
    if (profile.delivery === "chain") {
      this.tone(pitch * 1.5, .08, "square", volume, 2.4, opts); this.noise(.11, volume * .68, 2700, opts); this.tone(pitch * .48, .16, "sine", volume * .32, .7, { ...opts, at: now + .025 }); accent(); return true;
    }
    if (["gravity", "implosion"].includes(profile.payload) && profile.delivery !== "beam") {
      this.tone(Math.max(46, pitch * .32), .34, "sine", volume, 3.1, opts); this.noise(.2, volume * .28, 310, opts); accent(); return true;
    }
    if (profile.payload === "freeze") {
      this.tone(pitch * 1.35, .2, "triangle", volume, .42, opts); this.tone(pitch * 2.1, .08, "sine", volume * .35, 1.7, { ...opts, at: now + .02 }); this.noise(.1, volume * .28, 4200, opts); accent(); return true;
    }
    if (["teleport", "steal", "wall", "decoy", "disrupt"].includes(profile.payload)) {
      this.tone(pitch, .2, "sine", volume, profile.payload === "disrupt" ? .28 : 2.2, opts); this.tone(pitch * 1.68, .13, "triangle", volume * .44, .56, { ...opts, at: now + .025 }); accent(); return true;
    }
    if (profile.delivery === "beam" || profile.delivery === "rail") {
      const low = profile.payload === "gravity";
      this.noise(.055, volume * (low ? .25 : .52), low ? 420 : 3200, opts); this.tone(low ? 58 : pitch * 1.3, profile.audioDuration * 1.5, low ? "sine" : "sawtooth", volume, low ? 2.2 : .24, opts); this.tone(low ? 116 : 92 + profile.weight * 72, profile.audioDuration * 2.1, "triangle", volume * identity[3] * .55, low ? .52 : 2.4, { ...opts, at: now + .018 }); accent(); return true;
    }
    if (isCloseRapid(profile, weapon)) {
      this.noise(.044, volume * .8, 2200 + profile.signature * 900, opts); this.tone(pitch, .052, "square", volume, .3 + profile.signature * .12, opts); this.tone(118, .075, "triangle", volume * identity[3] * .3, .72, { ...opts, at: now + .012 }); accent(); return true;
    }
    if (["rocket", "grenade"].includes(profile.delivery) || weapon.type === "mine") {
      this.tone(Math.max(56, pitch * .44), profile.audioDuration * 1.3, "sawtooth", volume, .28 + profile.signature * .15, opts); this.noise(profile.audioDuration, volume * identity[2], 320 + pitch * .18, opts); this.tone(980 + profile.signature * 420, .045, "square", volume * .2, .6, { ...opts, at: now + .018 }); accent(); return true;
    }
    if (profile.delivery === "plasma" || profile.energy) {
      this.tone(pitch, profile.audioDuration * 1.2, "triangle", volume, profile.audioSlide, opts); this.tone(pitch * .46, profile.audioDuration * (1.2 + identity[3]), "sine", volume * .46, .68 + profile.signature * .3, { ...opts, at: now + .012 }); accent(); return true;
    }
    this.noise(profile.audioDuration * .8, volume * identity[2], 1200 + pitch, opts); this.tone(pitch, profile.audioDuration, profile.rapid ? "square" : "triangle", volume, profile.audioSlide, opts); this.tone(pitch * .38, profile.audioDuration * (1 + identity[3]), "sine", volume * .28, .7, { ...opts, at: now + .01 }); accent();
    return true;
  }

  playImpact(weapon, spatial = 1, fallbackPan = 0, surface = "world") {
    if (!weapon) return false;
    const profile = weaponPresentation(weapon);
    const identity = WEAPON_AUDIO_IDENTITIES[weapon.id] || [weapon.id, 1, profile.audioNoise, .4];
    const mix = this._mix(spatial, fallbackPan);
    if (mix.gain <= 0 || !this._allow(`impact:${weapon.id}:${surface}`, weapon.radius ? .055 : .018)) return false;
    const volume = Math.min(.12, Math.max(.005, .09 * mix.gain));
    const opts = { bus: "impact", pan: mix.pan, priority: weapon.radius ? 82 : surface === "player" ? 74 : 58, wet: .075, filter: mix.occluded ? 1050 : 11000 };
    const pitch = profile.audioPitch * identity[1];
    const inward = ["gravity", "implosion"].includes(profile.payload);
    if (weapon.radius || ["blast", "cluster", "napalm", "mortar"].includes(profile.payload)) {
      this.noise(.22 + profile.weight * .13, volume, 220 + profile.weight * 220, opts); this.tone(Math.max(38, pitch * .24), .34 + identity[3] * .18, "sawtooth", volume * .9, inward ? 2.7 : .3, opts); this.tone(42, .46, "sine", volume * .54, .52, opts); return true;
    }
    if (profile.payload === "fireball") { this.noise(.16, volume * .82, 720, opts); this.tone(124, .18, "sawtooth", volume, .38, opts); return true; }
    if (profile.payload === "freeze") { this.tone(1180 + profile.signature * 520, .17, "triangle", volume, .42, opts); this.noise(.12, volume * .42, 4800, opts); return true; }
    if (["teleport", "steal", "wall", "decoy", "disrupt"].includes(profile.payload)) { this.tone(pitch * 1.24, .2, "sine", volume, profile.payload === "disrupt" ? .28 : 2.1, opts); this.noise(.1, volume * .32, 2200, opts); return true; }
    if (profile.delivery === "melee") { this.noise(.1, volume, surface === "player" ? 780 : 1260, opts); this.tone(66 + profile.weight * 72, .16, "square", volume * .7, .36, opts); return true; }
    if (["ricochet", "drill", "returning"].includes(profile.payload)) { this.tone(pitch * 1.45, .1, "square", volume, .48, opts); this.noise(.09, volume * .52, 2400, opts); return true; }
    this.tone(pitch * .62, .11, profile.energy ? "triangle" : "square", volume * .78, .44, opts); this.noise(.085, volume * Math.max(.28, identity[2]), surface === "player" ? 720 : 1500, opts);
    return true;
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
      const profile = weaponPresentation(weapon), oscillator = this.context.createOscillator(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      oscillator.type = "sawtooth"; filter.type = "bandpass"; filter.Q.value = 1.2; gain.gain.value = .0001;
      oscillator.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .025); oscillator.start();
      loop = { nodes: [oscillator], oscillator, panner, filter, gain, profile, weaponId: weapon.id }; this.chargeLoops.set(id, loop); this._trackContinuous(oscillator, { priority, group: "charge", map: this.chargeLoops, id });
    }
    const base = Math.max(92, loop.profile.audioPitch * .22) * (.94 + loop.profile.signature * .12);
    const volume = Math.max(.002, .036 * mix.gain) * (.12 + level ** 1.35 * .88);
    loop.oscillator.frequency.setTargetAtTime(base * (1 + level * 2.8), now, .025);
    loop.filter.frequency.setTargetAtTime(mix.occluded ? 1050 : 360 + level * 3100, now, .035); loop.filter.Q.setTargetAtTime(1.2 + level * 3.6, now, .04); loop.gain.gain.setTargetAtTime(volume, now, .025); loop.panner?.pan.setTargetAtTime(mix.pan, now, .035);
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
      if (!this._claimContinuous(1, priority)) return false;
      const profile = weaponPresentation(weapon), oscillator = this.context.createOscillator(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      oscillator.type = profile.payload === "gravity" ? "sine" : weapon.spin || weapon.id === "flamethrower" ? "sawtooth" : "triangle";
      filter.type = "lowpass"; filter.Q.value = .8; gain.gain.value = .0001; oscillator.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .035); oscillator.start();
      loop = { nodes: [oscillator], oscillator, panner, filter, gain, profile, weaponId: weapon.id }; this.weaponLoops.set(id, loop); this._trackContinuous(oscillator, { priority, group: "weapon", map: this.weaponLoops, id });
    }
    const volume = Math.max(.002, .032 * mix.gain), base = loop.profile.payload === "gravity" ? 58 : weapon.id === "chainsaw" ? 72 : weapon.id === "flamethrower" ? 46 : 54;
    loop.oscillator.frequency.setTargetAtTime(base + (weapon.spin ? 54 : 20), now, .035);
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
      const oscillator = this.context.createOscillator(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      oscillator.type = "sawtooth"; filter.type = "bandpass"; filter.Q.value = 3; gain.gain.value = .0001; oscillator.connect(filter).connect(gain); const panner = this._route(gain, "movement", mix.pan, .03); oscillator.start();
      loop = { nodes: [oscillator], oscillator, panner, filter, gain }; this.grappleLoops.set(id, loop); this._trackContinuous(oscillator, { priority, group: "grapple", map: this.grappleLoops, id });
    }
    loop.oscillator.frequency.setTargetAtTime(92 + clamp(tension) * 150 + Math.min(90, speed * 2), now, .04); loop.filter.frequency.setTargetAtTime(mix.occluded ? 950 : 620 + clamp(tension) * 1800, now, .05); loop.gain.gain.setTargetAtTime(.004 + mix.gain * (.008 + clamp(tension) * .018), now, .04); loop.panner?.pan.setTargetAtTime(mix.pan, now, .035);
    return true;
  }

  updateHazardLoop(id, weapon, active, spatial = {}) {
    if (!active || !weapon?.hazard || !this.context || !this.enabled) return this._stopLoop(this.hazardLoops, id, .2);
    if (!this.hazardLoops.has(id) && this.hazardLoops.size >= 4) return false;
    const mix = this._mix(spatial), now = this.context.currentTime;
    let loop = this.hazardLoops.get(id);
    if (!loop) {
      if (!this._claimContinuous(1, 68)) return false;
      const oscillator = this.context.createOscillator(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      oscillator.type = weapon.hazard === "black_hole" ? "sine" : "sawtooth"; filter.type = "lowpass"; gain.gain.value = .0001;
      oscillator.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .1); oscillator.start();
      loop = { nodes: [oscillator], oscillator, panner, filter, gain, weaponId: weapon.id }; this.hazardLoops.set(id, loop); this._trackContinuous(oscillator, { priority: 68, group: "hazard", map: this.hazardLoops, id });
    }
    const base = weapon.hazard === "black_hole" ? 42 : weapon.hazard === "tornado" ? 68 : 86;
    loop.oscillator.frequency.setTargetAtTime(base, now, .08); loop.filter.frequency.setTargetAtTime(mix.occluded ? 880 : 420 + mix.gain * 1800, now, .1); loop.gain.gain.setTargetAtTime(.002 + mix.gain * .025, now, .08); loop.panner?.pan.setTargetAtTime(mix.pan, now, .05);
    return true;
  }

  updateProjectileLoop(id, weapon, active, spatial = {}) {
    if (!active || !id || !this.context || !this.enabled) return this._stopLoop(this.projectileLoops, id, .08);
    if (!this.projectileLoops.has(id) && this.projectileLoops.size >= 6) return false;
    const mix = this._mix(spatial), now = this.context.currentTime;
    let loop = this.projectileLoops.get(id);
    if (!loop) {
      if (!this._claimContinuous(1, 76)) return false;
      const profile = weaponPresentation(weapon), oscillator = this.context.createOscillator(), filter = this.context.createBiquadFilter(), gain = this.context.createGain();
      oscillator.type = profile.payload === "fireball" ? "sawtooth" : profile.payload === "drill" ? "square" : "triangle";
      filter.type = "bandpass"; filter.Q.value = 1.4; gain.gain.value = .0001; oscillator.connect(filter).connect(gain); const panner = this._route(gain, "weapon", mix.pan, .055); oscillator.start();
      loop = { nodes: [oscillator], oscillator, panner, filter, gain, profile, weaponId: weapon.id }; this.projectileLoops.set(id, loop); this._trackContinuous(oscillator, { priority: 76, group: "projectile", map: this.projectileLoops, id });
    }
    const speed = spatial.speed || weapon.projectileSpeed || 1;
    loop.oscillator.frequency.setTargetAtTime(72 + loop.profile.signature * 110 + Math.min(180, speed * 1.2), now, .04);
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
    for (const node of loop.nodes || [loop.oscillator].filter(Boolean)) {
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
    const bases = theme === "solar" ? [42, 63] : theme === "ion" ? [48, 72] : [38, 57];
    if (!this._claimContinuous(3, 4)) return false;
    const gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    gain.gain.value = .018; filter.type = "lowpass"; filter.frequency.value = 520;
    const nodes = bases.map((frequency, index) => { const osc = this.context.createOscillator(); osc.type = index ? "triangle" : "sine"; osc.frequency.value = frequency; osc.connect(filter); osc.start(); return osc; });
    const air = this.context.createBufferSource(); air.buffer = this.noiseBuffer; air.loop = true;
    const airFilter = this.context.createBiquadFilter(); airFilter.type = "bandpass"; airFilter.frequency.value = theme === "solar" ? 380 : theme === "ion" ? 1800 : 760; airFilter.Q.value = .45;
    air.connect(airFilter).connect(gain); air.start(); nodes.push(air);
    filter.connect(gain).connect(this._bus("ambience")); this.ambienceNodes = { nodes, filter, airFilter, gain, theme };
    for (const node of nodes) this._trackContinuous(node, { priority: 4, group: "ambience" });
    return true;
  }

  updateAmbience({ danger = 0, speed = 0 } = {}) {
    if (!this.ambienceNodes || !this.context) return;
    const now = this.context.currentTime;
    this.ambienceNodes.filter.frequency.setTargetAtTime(480 + clamp(danger) * 520 + clamp(speed) * 680, now, .3);
    this.ambienceNodes.airFilter.frequency.setTargetAtTime(620 + clamp(speed) * 1800, now, .25);
    this.ambienceNodes.gain.gain.setTargetAtTime(.012 + clamp(danger) * .01 + clamp(speed) * .008, now, .25);
    if (this._allow("ambience-detail", 2.4)) {
      const foundry = this.ambienceNodes.theme === "foundry";
      this.noise(.18, .012, foundry ? 1250 : 2800, { bus: "ambience", priority: 6, pan: Math.sin(now * .31), wet: .12 });
      this.tone(foundry ? 92 : 180, .34, "sine", .009, 1.25, { bus: "ambience", priority: 6, pan: Math.cos(now * .23), wet: .14 });
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
    this.musicSeed = seed || "BLAST-01"; this.musicPaused = false; this.musicSuspended = false;
    if (this.musicTimer) {
      if (scene === "combat" && this.musicScene === "countdown") return true;
      if (scene === "combat") this._setMusicSceneNow(scene, this.musicTargetIntensity);
      else this.setMusicScene(scene);
      return true;
    }
    this.musicCountdown = null;
    this.musicScene = scene;
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
    this.noise(.24, .025, 3600, { bus: "music", group: "music", priority: 9, at: startAt, attack: .06, wet: .1 });
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
    const now = this.context.currentTime;
    const beatDuration = 60 / MUSIC.bpm;
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
    this.countdownStepsScheduled = 0;
    this.musicCountdown = { startTime, endTime, beatDuration, combatIntensity: clamp(combatIntensity), completed: false };
    if (!this.musicTimer) this.musicTimer = setInterval(() => this._scheduleMusic(), 25);
    this._scheduleMusic();
    return this.getCountdownState();
  }

  getCountdownState() {
    if (!this.context || !this.musicCountdown) return null;
    const gate = this.musicCountdown;
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
    this.noise(.2, .035, 4200, { bus: "music", group: "music", priority: 96, at, attack: .01, wet: .08 });
    this.tone(82, .38, "sine", .12, .48, { bus: "movement", group: "go", priority: 100, at });
    this.tone(660, .32, "sawtooth", .075, 1.7, { bus: "movement", group: "go", priority: 100, at });
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
    const stepDuration = 60 / MUSIC.bpm / MUSIC.stepsPerBeat;
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
        this.noise(.32, .028, 3600, { bus: "music", group: "music", priority: 9, at: this.musicNextTime, attack: .08, wet: .12 });
        this.tone(this.musicScene.startsWith("results") ? 146.83 : 73.42, .42, "sine", .04, this.musicScene === "combat" ? 2.1 : .62, { bus: "music", group: "music", priority: 9, at: this.musicNextTime, wet: .1 });
        step = 0;
      }
      const bar = Math.floor(this.musicStep / MUSIC.stepsPerBar);
      if (step === 0) this.musicBarIntensity = this.musicIntensity;
      if (this.musicScene === "countdown") {
        this.countdownStepsScheduled++;
        if (step % MUSIC.stepsPerBeat === 0) this.tone(440, .11, "square", .07, 1.12, { bus: "ui", group: "countdown", priority: 92, at: this.musicNextTime });
      }
      const events = musicEventsForStep({ seed: this.musicSeed, bar, step, scene: this.musicScene, intensity: this.musicBarIntensity });
      for (const event of events) this._scheduleMusicEvent(event, this.musicNextTime, stepDuration);
      this.musicStep += 1; this.musicNextTime += stepDuration;
    }
  }

  _scheduleMusicEvent(event, at, stepDuration) {
    const duration = Math.max(.035, event.durationSteps * stepDuration * .94);
    const common = { bus: "music", group: "music", priority: 8, at, pan: event.pan, filter: event.filterHz, wet: event.layer === "pad" ? .1 : .035, attack: event.layer === "pad" ? .08 : .003, release: event.layer === "pad" ? .24 : undefined };
    if (event.kind === "noise") this.noise(duration, event.gain, event.filterHz, { ...common, filterType: event.layer === "hat" ? "highpass" : "bandpass" });
    else if (event.layer === "pad") {
      this.tone(event.frequency, duration, "triangle", event.gain * .58, 1.003, { ...common, detune: -7 });
      this.tone(event.frequency, duration, "sawtooth", event.gain * .34, .997, { ...common, detune: 7, pan: -event.pan });
    } else if (event.layer === "bass") {
      this.tone(event.frequency, duration, "sine", event.gain * .82, .998, common);
      this.tone(event.frequency * 2, duration * .72, "square", event.gain * .19, .99, { ...common, filter: Math.min(900, event.filterHz) });
    } else if (event.layer === "kick") {
      this.tone(event.frequency, duration, "sine", event.gain, .34, common);
      this.noise(.022, event.gain * .22, 4200, { ...common, filterType: "highpass", wet: 0 });
    } else this.tone(event.frequency, duration, event.wave, event.gain, event.layer === "riser" ? 2.5 : 1.005, { ...common, periodic: event.layer === "lead" });
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
      this.musicNextTime = this.musicCountdown.startTime + this.musicStep * (60 / MUSIC.bpm / MUSIC.stepsPerBeat);
    }
    if (!this.musicPaused) this.musicPauseTime = null;
    this.buses.music?.gain.setTargetAtTime(this._musicBusGain(), now, .08);
    this.musicFilter?.frequency.setTargetAtTime(paused ? 650 : 6400, now, .09);
    this.buses.ambience?.gain.setTargetAtTime(this._ambienceBusGain(), now, .08);
    if (paused && this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; this.musicSuspended = true; }
    else if (!paused && this.musicSuspended) { this.musicSuspended = false; if (!this.musicCountdown || this.musicCountdown.completed) this.musicNextTime = now + .04; this.musicTimer = setInterval(() => this._scheduleMusic(), 25); }
  }

  stopMusic(fade = .2) {
    if (this.musicTimer) clearInterval(this.musicTimer);
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
    this.stopAll(); this.stopMusic(0); for (const voice of [...this.activeVoices]) try { voice.source.stop?.(); } catch {} this.activeVoices.clear(); this.context?.close?.(); this.context = null;
  }
}
