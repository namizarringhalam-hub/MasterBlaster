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
    const white = random();
    state.low += (white - state.low) * .035;
    const crack = (white - state.low) * (t < .045 ? 1 : .26) * Math.exp(-t * 13);
    const surge = state.low * 3.2 * curve(t, .001, 7.4);
    const arc = random() * (Math.sin(t * 117) > .72 ? 1 : .12) * Math.exp(-t * 9);
    return crack * .72 + surge * .58 + arc * .24;
  }, .86);
}

function mechanical(sampleRate) {
  return render(sampleRate, .115, 0x8871, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .11;
    const attack = (white - state.low) * Math.exp(-t * 92);
    const latch = t > .036 ? state.low * 3.6 * Math.exp(-(t - .036) * 78) : 0;
    const grit = random() * Math.exp(-t * 58);
    return attack * .82 + latch * .56 + grit * .18;
  }, .76);
}

function heavyUi(sampleRate) {
  return render(sampleRate, .24, 0xc191, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .028;
    const thud = state.low * 4.6 * curve(t, .001, 14);
    const latch = t > .055 ? (white - state.low) * Math.exp(-(t - .055) * 52) : 0;
    return thud * .82 + latch * .32;
  }, .82);
}

function whoosh(sampleRate) {
  return render(sampleRate, .62, 0xc2a7, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * (.012 + t * .05);
    const air = white - state.low;
    const envelope = Math.sin(Math.PI * Math.min(1, t / .62)) ** 1.6;
    return air * envelope * (.62 + state.low * 1.8);
  }, .84);
}

function iceCrack(sampleRate) {
  return render(sampleRate, .46, 0xc3bd, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .22;
    const shards = (white - state.low) * (Math.sin(t * 173) > .45 ? 1 : .18) * Math.exp(-t * 7.5);
    const body = state.low * 2.4 * curve(t, .001, 9);
    return shards * .72 + body * .28;
  }, .8);
}

function cableSnap(sampleRate) {
  return render(sampleRate, .38, 0xc4d3, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .06;
    const tension = (white - state.low) * Math.exp(-t * 11);
    const clamp = t > .09 ? state.low * 3.4 * Math.exp(-(t - .09) * 30) : 0;
    return tension * .52 + clamp * .64;
  }, .82);
}

function texture(sampleRate, seconds, seed, color = .03, grit = .35, peak = .72) {
  return render(sampleRate, seconds, seed, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * color;
    const broad = white - state.low;
    const movement = .72 + .18 * Math.sin(t * 3.7) + .1 * Math.sin(t * 11.3 + 1.2);
    return (state.low * (2.4 - grit) + broad * grit) * movement;
  }, peak);
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
    mechanical: mechanical(rate), heavyUi: heavyUi(rate), whoosh: whoosh(rate), iceCrack: iceCrack(rate), cableSnap: cableSnap(rate),
    flame: flame(rate), footstep: footstep(rate), transition: transition(rate),
    chargeLoop: texture(rate, 1.6, 0xd101, .018, .42), weaponLoop: texture(rate, 1.7, 0xd202, .045, .58),
    grappleLoop: texture(rate, 1.5, 0xd303, .08, .7), hazardLoop: texture(rate, 1.8, 0xd404, .014, .46),
    projectileLoop: texture(rate, 1.45, 0xd505, .065, .66), ambienceFoundry: texture(rate, 2.2, 0xd606, .009, .32, .64),
    ambienceIon: texture(rate, 2.2, 0xd707, .035, .56, .66), ambienceSolar: texture(rate, 2.2, 0xd808, .02, .42, .65)
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
