export class SoundBoard {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.musicTimer = null;
    this.engineNodes = new Map();
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

  play(type) {
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
    const volume = Math.max(.015, .09 * distanceScale);
    if (weapon.type === "flame") {
      this.noise(.09, volume * .68, 760);
      this.tone(105, .08, "sawtooth", volume * .42, .78);
      return;
    }
    if (["rail", "beam", "chain"].includes(weapon.type)) {
      this.tone(820, .09, "sawtooth", volume, .24);
      this.tone(150, .18, "sine", volume * .55, 2.4);
      return;
    }
    if (["rocket", "plasma", "grenade", "remote"].includes(weapon.type)) {
      this.tone(125, .18, "sawtooth", volume, .42);
      this.noise(.16, volume * .6, 430);
      return;
    }
    if (weapon.type === "melee") {
      this.noise(.08, volume, 1450);
      this.tone(95, .1, "square", volume * .6, .5);
      return;
    }
    this.tone(260 + Math.min(520, weapon.projectileSpeed || 0), .055, "square", volume, .45);
    this.noise(.045, volume * .48, 1800);
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
    if (this.master) this.master.gain.value = this.enabled ? .32 : 0;
    return this.enabled;
  }
}
