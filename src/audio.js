export class SoundBoard {
  constructor() {
    this.context = null;
    this.master = null;
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
      this.master.connect(this.context.destination);
    }
    this.context.resume();
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
