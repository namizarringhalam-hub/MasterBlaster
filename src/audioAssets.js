const clamp = (value, min = -1, max = 1) => Math.min(max, Math.max(min, value));

function randomSource(seed = 0x4e454f4e) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) / 4294967296) * 2 - 1;
  };
}

const curve = (t, attack, decay) => Math.min(1, t / Math.max(.0001, attack)) * Math.exp(-t * decay);
const saturate = (value, drive = 1.6) => Math.tanh(value * drive) / Math.tanh(drive);

function render(sampleRate, seconds, seed, voice, peak = .94) {
  const data = new Float32Array(Math.max(1, Math.floor(sampleRate * seconds)));
  const random = randomSource(seed);
  const state = { phase: 0, low: 0, previous: 0 };
  let highest = 0;
  for (let index = 0; index < data.length; index++) {
    const t = index / sampleRate;
    const value = saturate(voice(t, random, state, sampleRate), 1.45);
    data[index] = Number.isFinite(value) ? value : 0;
    highest = Math.max(highest, Math.abs(data[index]));
  }
  const scale = highest > 0 ? peak / highest : 1;
  for (let index = 0; index < data.length; index++) data[index] = clamp(data[index] * scale);
  return data;
}

function kick(sampleRate) {
  return render(sampleRate, .58, 0x11a9, (t, random, state) => {
    const frequency = 43 + 132 * Math.exp(-t * 28);
    state.phase += Math.PI * 2 * frequency / sampleRate;
    const body = Math.sin(state.phase) * curve(t, .0015, 8.4);
    const sub = Math.sin(Math.PI * 2 * 43 * t) * curve(t, .006, 6.2) * .38;
    const click = (random() - state.previous) * Math.exp(-t * 95) * .14;
    state.previous = random();
    return body + sub + click;
  });
}

function snare(sampleRate) {
  return render(sampleRate, .42, 0x22b7, (t, random, state) => {
    const white = random();
    state.low += (white - state.low) * .075;
    const bright = white - state.low;
    const body = (Math.sin(Math.PI * 2 * 183 * t) + .38 * Math.sin(Math.PI * 2 * 109 * t)) * curve(t, .001, 17);
    const clap = [0, .012, .025].reduce((sum, offset) => sum + (t >= offset ? bright * Math.exp(-(t - offset) * 48) : 0), 0);
    return body * .34 + bright * curve(t, .001, 11) * .58 + clap * .15;
  });
}

function hat(sampleRate, open = false) {
  const seconds = open ? .48 : .105;
  return render(sampleRate, seconds, open ? 0x33c3 : 0x33c2, (t, random, state) => {
    const metallic = [4171, 5537, 6893, 8279, 10331].reduce((sum, hz, index) => sum + Math.sin(Math.PI * 2 * hz * t + index * .71), 0) / 5;
    const white = random();
    state.low += (white - state.low) * .18;
    return (metallic * .65 + (white - state.low) * .6) * curve(t, .0004, open ? 8.5 : 42);
  }, open ? .82 : .74);
}

function clap(sampleRate) {
  return render(sampleRate, .31, 0x44d9, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .04;
    const noise = white - state.low;
    const bursts = [0, .014, .031, .054].reduce((sum, offset, index) => sum + (t >= offset ? noise * Math.exp(-(t - offset) * (54 - index * 7)) : 0), 0);
    return bursts * .52;
  }, .78);
}

function impact(sampleRate, large = false) {
  return render(sampleRate, large ? 1.18 : .38, large ? 0x55e8 : 0x55e7, (t, random, state) => {
    const frequency = (large ? 31 : 62) + (large ? 88 : 140) * Math.exp(-t * 18);
    state.phase += Math.PI * 2 * frequency / sampleRate;
    const body = Math.sin(state.phase) * curve(t, .001, large ? 4.2 : 10);
    const white = random(); state.low += (white - state.low) * (large ? .025 : .08);
    const debris = (white - state.low) * curve(t, .0005, large ? 5.8 : 15);
    const tail = state.low * Math.exp(-t * (large ? 2.8 : 9));
    return body * .74 + debris * .62 + tail * .42;
  });
}

function ballistic(sampleRate) {
  return render(sampleRate, .19, 0x6615, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .11;
    const crack = (white - state.low) * Math.exp(-t * 68);
    const body = Math.sin(Math.PI * 2 * (142 - t * 240) * t) * curve(t, .0004, 20);
    const mechanism = t > .035 ? Math.sin(Math.PI * 2 * 1350 * (t - .035)) * Math.exp(-(t - .035) * 88) : 0;
    return crack * .86 + body * .5 + mechanism * .15;
  });
}

function energy(sampleRate) {
  return render(sampleRate, .34, 0x773a, (t, random, state) => {
    const chirp = 310 + 2100 * (1 - Math.exp(-t * 19));
    state.phase += Math.PI * 2 * chirp / sampleRate;
    const core = Math.sin(state.phase) + .28 * Math.sin(state.phase * 2.013) + .13 * Math.sin(state.phase * 3.97);
    const fizz = random() * Math.exp(-t * 18);
    return core * curve(t, .001, 8.2) * .62 + fizz * .16;
  }, .86);
}

function mechanical(sampleRate) {
  return render(sampleRate, .115, 0x8871, (t, random, state) => {
    const clickA = Math.sin(Math.PI * 2 * 1780 * t) * Math.exp(-t * 95);
    const clickB = t > .036 ? Math.sin(Math.PI * 2 * 940 * (t - .036)) * Math.exp(-(t - .036) * 120) : 0;
    const grit = random() * Math.exp(-t * 82);
    return clickA * .68 + clickB * .4 + grit * .18;
  }, .76);
}

function flame(sampleRate) {
  return render(sampleRate, .48, 0x99af, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .018;
    const roar = state.low * 2.8 + (white - state.low) * .25;
    const flutter = .72 + .28 * Math.sin(Math.PI * 2 * (17 + 5 * Math.sin(t * 19)) * t);
    return roar * curve(t, .008, 5.4) * flutter;
  }, .84);
}

function footstep(sampleRate) {
  return render(sampleRate, .22, 0xaae1, (t, random, state) => {
    const thump = Math.sin(Math.PI * 2 * (76 - 25 * t) * t) * curve(t, .001, 17);
    const grit = random() * curve(t, .0004, 25);
    return thump * .7 + grit * .24;
  }, .72);
}

function transition(sampleRate) {
  return render(sampleRate, 1.4, 0xbbf4, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * (.012 + t * .03);
    const air = white - state.low;
    const rise = Math.min(1, t / 1.05) ** 1.8;
    const hit = t > 1.02 ? Math.sin(Math.PI * 2 * (84 - (t - 1.02) * 45) * (t - 1.02)) * Math.exp(-(t - 1.02) * 7) : 0;
    return air * rise * .52 + hit * .78;
  }, .9);
}

export function createProceduralAudioAssets(sampleRate = 48000) {
  const rate = Math.max(8000, Math.floor(Number(sampleRate) || 48000));
  return Object.freeze({
    kick: kick(rate), snare: snare(rate), clap: clap(rate), hatClosed: hat(rate), hatOpen: hat(rate, true),
    impact: impact(rate), explosion: impact(rate, true), ballistic: ballistic(rate), energy: energy(rate),
    mechanical: mechanical(rate), flame: flame(rate), footstep: footstep(rate), transition: transition(rate)
  });
}

export function analyzeAudioAsset(data) {
  let peak = 0, energy = 0, delta = 0, crossings = 0, previous = data[0] || 0;
  for (const sample of data) {
    peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; delta += Math.abs(sample - previous);
    if ((sample >= 0) !== (previous >= 0)) crossings++;
    previous = sample;
  }
  const rms = Math.sqrt(energy / Math.max(1, data.length));
  return Object.freeze({ peak, rms, crest: peak / Math.max(.000001, rms), motion: delta / Math.max(1, data.length), crossings });
}
