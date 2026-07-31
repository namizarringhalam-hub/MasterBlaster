import { weaponPresentation } from "./weaponPresentation.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function isCloseRapid(profile, weapon) {
  return profile.rapid
    && profile.delivery === "projectile"
    && weapon.hitscan
    && weapon.maxUsefulRange <= 40
    && weapon.spread >= .04;
}

export class SoundBoard {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.musicTimer = null;
    this.engineNodes = new Map();
    this.weaponLoops = new Map();
    this.chargeLoops = new Map();
  }

  resume() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.32;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.master.connect(this.compressor).connect(this.context.destination);
      this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const noise = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < noise.length; index++) noise[index] = Math.random() * 2 - 1;
    }
    this.context.resume();
  }

  noise(duration = .12, volume = .05, frequency = 1100) {
    if (!this.enabled || !this.context || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = .8;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration);
  }

  tone(frequency, duration, type = "sine", volume = 0.1, slide = 1) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  play(type, weapon = null, distanceScale = 1) {
    if (type === "impact" && weapon) return this.playImpact(weapon, distanceScale);
    const sounds = {
      countdown: [460, .11, "square", .09, 1.18],
      go: [620, .28, "triangle", .12, 2.1],
      boost: [140, .3, "sawtooth", .11, 3.2],
      pickup: [520, .2, "triangle", .11, 2],
      impact: [115, .14, "square", .08, .45],
      power: [330, .25, "sine", .12, 2.5],
      missile: [240, .32, "sawtooth", .08, 1.8],
      lap: [680, .24, "triangle", .11, 1.55],
      win: [440, .65, "triangle", .13, 2.7]
    };
    this.tone(...(sounds[type] || sounds.pickup));
    if (type === "impact") this.noise(.11, .07, 720);
  }

  playWeapon(weapon, distanceScale = 1) {
    const profile = weaponPresentation(weapon);
    const volume = Math.max(.015, .09 * distanceScale);
    const pitch = profile.audioPitch * (.94 + profile.signature * .12);
    if (profile.payload === "fireball") {
      this.noise(.14, volume * .72, 520);
      this.tone(118, .16, "sawtooth", volume * .82, 1.8);
      this.tone(410 + profile.signature * 90, .09, "triangle", volume * .38, .52);
      return;
    }
    if (profile.delivery === "flame") {
      this.noise(.1, volume * (.62 + profile.audioNoise * .25), 620 + pitch * .28);
      this.tone(92 + profile.signature * 28, .085, "sawtooth", volume * .4, .7);
      return;
    }
    if (profile.delivery === "melee") {
      this.noise(.065 + profile.weight * .045, volume, 1100 + pitch * .75);
      this.tone(82 + profile.weight * 42, .08 + profile.weight * .055, "square", volume * .58, .42 + profile.signature * .16);
      return;
    }
    if (profile.delivery === "chain") {
      this.tone(pitch * 1.35, .075, "square", volume, 1.9);
      this.noise(.085, volume * .52, 1850 + profile.signature * 750);
      return;
    }
    if ((profile.payload === "gravity" || profile.payload === "implosion") && profile.delivery !== "beam") {
      this.tone(Math.max(68, pitch * .38), profile.audioDuration * 1.25, "sine", volume, 2.25);
      this.tone(pitch * .7, profile.audioDuration, "triangle", volume * .42, .48);
      return;
    }
    if (profile.payload === "freeze") {
      this.tone(pitch * 1.25, profile.audioDuration, "triangle", volume, .52);
      this.noise(profile.audioDuration * .65, volume * .28, 2500);
      return;
    }
    if (["teleport", "steal", "wall", "decoy"].includes(profile.payload)) {
      this.tone(pitch, profile.audioDuration, "sine", volume, 1.8);
      this.tone(pitch * 1.62, profile.audioDuration * .7, "triangle", volume * .4, .72);
      return;
    }
    if (profile.payload === "disrupt") {
      this.tone(pitch * .72, profile.audioDuration, "square", volume, .3);
      this.noise(profile.audioDuration * .7, volume * .34, 1350);
      return;
    }
    if (profile.delivery === "beam" || profile.delivery === "rail") {
      const gravity = profile.payload === "gravity";
      this.tone(gravity ? pitch * .38 : pitch * 1.2, profile.audioDuration, gravity ? "sine" : "sawtooth", volume, gravity ? 2.1 : .28);
      this.tone(gravity ? pitch * .82 : 135 + profile.weight * 55, profile.audioDuration * 1.45, "triangle", volume * .48, gravity ? .55 : 2.2);
      return;
    }
    if (isCloseRapid(profile, weapon)) {
      this.tone(pitch * 1.12, .042, "square", volume * .82, .36 + profile.signature * .12);
      this.noise(.036, volume * .62, 2050 + profile.signature * 620);
      return;
    }
    if (["rocket", "grenade"].includes(profile.delivery)) {
      this.tone(Math.max(78, pitch * .52), profile.audioDuration, "sawtooth", volume, .34 + profile.signature * .16);
      this.noise(profile.audioDuration * .88, volume * (.45 + profile.audioNoise * .28), 340 + pitch * .22);
      return;
    }
    if (profile.delivery === "plasma" || profile.energy) {
      this.tone(pitch, profile.audioDuration, "triangle", volume, profile.audioSlide);
      this.tone(pitch * .48, profile.audioDuration * 1.2, "sine", volume * .4, .72 + profile.signature * .35);
      return;
    }
    this.tone(pitch, profile.audioDuration, profile.rapid ? "square" : "triangle", volume, profile.audioSlide);
    this.noise(profile.audioDuration * .8, volume * profile.audioNoise, 1300 + pitch * .72);
  }

  playImpact(weapon, distanceScale = 1) {
    const profile = weaponPresentation(weapon);
    const volume = Math.max(.012, .085 * distanceScale);
    const inward = profile.payload === "gravity" || profile.payload === "implosion";
    if (profile.payload === "fireball") {
      this.noise(.11, volume * .7, 760);
      this.tone(150 + profile.signature * 45, .12, "sawtooth", volume * .72, .44);
      this.tone(680 + profile.signature * 120, .055, "triangle", volume * .3, 1.5);
    } else if (inward) {
      this.tone(74 + profile.signature * 28, .24, "sine", volume, 2.4);
      this.noise(.16, volume * .34, 280);
    } else if (isCloseRapid(profile, weapon)) {
      this.tone(profile.audioPitch * 1.18, .045, "square", volume * .62, .48);
      this.noise(.04, volume * .5, 2200);
    } else if (profile.payload === "freeze") {
      this.tone(920 + profile.signature * 260, .13, "triangle", volume * .82, .46);
      this.noise(.08, volume * .35, 2600);
    } else if (["teleport", "steal", "wall", "decoy"].includes(profile.payload)) {
      this.tone(430 + profile.signature * 240, .17, "sine", volume, 1.9);
      this.tone(860 + profile.signature * 180, .08, "triangle", volume * .42, .7);
    } else if (profile.payload === "disrupt") {
      this.tone(280 + profile.signature * 110, .16, "square", volume, .3);
      this.noise(.11, volume * .38, 1200);
    } else if (profile.payload === "pulse") {
      this.tone(170 + profile.signature * 90, .2, "sine", volume, 2.3);
      this.tone(520 + profile.signature * 160, .1, "triangle", volume * .46, .52);
    } else if (profile.payload === "ricochet" || profile.payload === "drill") {
      this.tone(profile.audioPitch * 1.25, .08, "square", volume * .78, .52);
      this.noise(.075, volume * .45, 1750);
      if (weapon.radius) this.tone(Math.max(58, profile.audioPitch * .3), .18, "sawtooth", volume * .62, .38);
    } else if (["blast", "cluster", "napalm", "mortar"].includes(profile.payload)) {
      this.tone(Math.max(62, profile.audioPitch * .34), .18 + profile.weight * .08, "sawtooth", volume, .38);
      this.noise(.16, volume * (.5 + profile.audioNoise * .3), 360);
    } else {
      this.tone(profile.audioPitch * .62, .09, profile.energy ? "triangle" : "square", volume * .72, .48);
      this.noise(.07, volume * profile.audioNoise * .55, 980 + profile.audioPitch * .35);
    }
  }

  updateChargeLoop(id, weapon, progress = 0, distanceScale = 1) {
    if (!id || !weapon?.chargeTime || !this.context || !this.enabled) {
      this.stopChargeLoop(id);
      return false;
    }
    const level = clamp(progress);
    const now = this.context.currentTime;
    let loop = this.chargeLoops.get(id);
    if (loop?.weaponId !== weapon.id) {
      this.stopChargeLoop(id);
      loop = null;
    }
    if (!loop) {
      const profile = weaponPresentation(weapon);
      const oscillator = this.context.createOscillator();
      const overtone = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      oscillator.type = "sawtooth";
      overtone.type = "triangle";
      filter.type = "bandpass";
      filter.Q.value = 1.2;
      gain.gain.value = .0001;
      oscillator.connect(filter);
      overtone.connect(filter);
      filter.connect(gain).connect(this.master);
      oscillator.start();
      overtone.start();
      loop = { oscillator, overtone, filter, gain, profile, weaponId: weapon.id };
      this.chargeLoops.set(id, loop);
    }
    const base = Math.max(92, loop.profile.audioPitch * .22) * (.94 + loop.profile.signature * .12);
    const volume = Math.max(.003, .035 * distanceScale) * (.16 + Math.pow(level, 1.35) * .84);
    loop.oscillator.frequency.setTargetAtTime(base * (1 + level * 2.7), now, .025);
    loop.overtone.frequency.setTargetAtTime(base * (2.02 + level * .8), now, .025);
    loop.filter.frequency.setTargetAtTime(360 + level * 2600, now, .035);
    loop.filter.Q.setTargetAtTime(1.2 + level * 3.4, now, .04);
    loop.gain.gain.setTargetAtTime(volume, now, .025);
    return true;
  }

  stopChargeLoop(id) {
    const loop = this.chargeLoops.get(id);
    if (!loop) return false;
    const now = this.context?.currentTime || 0;
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setValueAtTime(Math.max(.0001, loop.gain.gain.value), now);
    loop.gain.gain.linearRampToValueAtTime(.0001, now + .065);
    loop.oscillator.stop(now + .085);
    loop.overtone.stop(now + .085);
    this.chargeLoops.delete(id);
    return true;
  }

  stopAllChargeLoops() {
    for (const id of [...this.chargeLoops.keys()]) this.stopChargeLoop(id);
  }

  updateWeaponLoop(id, weapon, active, distanceScale = 1) {
    if (!active || !weapon?.maintained || !this.context || !this.enabled) return this.stopWeaponLoop(id);
    const now = this.context.currentTime;
    let loop = this.weaponLoops.get(id);
    if (loop?.weaponId !== weapon.id) {
      this.stopWeaponLoop(id);
      loop = null;
    }
    if (!loop) {
      const profile = weaponPresentation(weapon);
      const oscillator = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      oscillator.type = profile.payload === "gravity" ? "sine" : weapon.spin ? "sawtooth" : "triangle";
      filter.type = "lowpass";
      gain.gain.value = .0001;
      oscillator.connect(filter).connect(gain).connect(this.master);
      oscillator.start();
      loop = { oscillator, filter, gain, profile, weaponId: weapon.id };
      this.weaponLoops.set(id, loop);
    }
    const volume = Math.max(.004, .026 * distanceScale);
    const base = loop.profile.payload === "gravity" ? 118 : weapon.id === "chainsaw" ? 72 : 54;
    loop.oscillator.frequency.setTargetAtTime(base + (weapon.spin ? 48 : 18), now, .035);
    loop.filter.frequency.setTargetAtTime(420 + loop.profile.audioPitch * .75, now, .045);
    loop.gain.gain.setTargetAtTime(volume, now, .025);
  }

  stopWeaponLoop(id) {
    const loop = this.weaponLoops.get(id);
    if (!loop) return;
    const now = this.context?.currentTime || 0;
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setTargetAtTime(.0001, now, .025);
    loop.oscillator.stop(now + .12);
    this.weaponLoops.delete(id);
  }

  startEngine(id) {
    if (!this.context || this.engineNodes.has(id)) return;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    osc.type = "sawtooth";
    filter.type = "lowpass";
    filter.frequency.value = 320;
    gain.gain.value = 0.018;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.engineNodes.set(id, { osc, filter, gain });
  }

  updateEngine(id, speed, boosting) {
    const node = this.engineNodes.get(id);
    if (!node || !this.context) return;
    const now = this.context.currentTime;
    node.osc.frequency.setTargetAtTime(55 + speed * 5 + (boosting ? 45 : 0), now, .04);
    node.filter.frequency.setTargetAtTime(260 + speed * 18, now, .05);
    node.gain.gain.setTargetAtTime(.012 + Math.min(speed / 900, .035), now, .05);
  }

  startMusic() {
    if (this.musicTimer) return;
    let step = 0;
    const notes = [220, 277, 330, 415, 330, 277, 247, 330];
    this.musicTimer = setInterval(() => {
      if (this.context && this.enabled) {
        this.tone(notes[step++ % notes.length], .12, "triangle", .024, 1.01);
        if (step % 2 === 0) this.tone(110, .08, "sine", .02, .75);
      }
    }, 220);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stopAllChargeLoops();
    if (this.master) this.master.gain.value = this.enabled ? .32 : 0;
    return this.enabled;
  }
}
