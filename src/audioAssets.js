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

function structuralWarning(sampleRate) {
  return render(sampleRate, .82, 0xc5f1, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .012;
    const strain = state.low * 4.2 * Math.sin(Math.PI * Math.min(1, t / .82)) ** 1.25;
    const scrape = (white - state.low) * (.18 + Math.max(0, Math.sin(t * 53)) * .34) * Math.sin(Math.PI * Math.min(1, t / .82));
    const pulse = [0, .19, .38, .57].reduce((sum, offset) => sum + (t >= offset ? state.low * 3.8 * Math.exp(-(t - offset) * 26) : 0), 0);
    return strain * .64 + scrape * .28 + pulse * .38;
  }, .84);
}

function structuralBreak(sampleRate) {
  return render(sampleRate, 1.1, 0xc6a2, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .026;
    const fracture = (white - state.low) * curve(t, .0005, 5.8);
    const body = state.low * 5.4 * curve(t, .001, 3.7);
    const tearing = random() * (Math.sin(t * 79 + Math.sin(t * 17)) > .34 ? 1 : .14) * Math.exp(-t * 4.6);
    const secondary = t > .16 ? (white - state.low) * Math.exp(-(t - .16) * 9) : 0;
    return body * .7 + fracture * .58 + tearing * .24 + secondary * .36;
  }, .92);
}

function structuralFall(sampleRate) {
  return render(sampleRate, 1.05, 0xc7b3, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * (.009 + t * .016);
    const acceleration = Math.min(1, t / .72) ** 1.5;
    const mass = state.low * 5.2 * acceleration * Math.exp(-Math.max(0, t - .78) * 8);
    const air = (white - state.low) * (.12 + acceleration * .42) * Math.exp(-Math.max(0, t - .84) * 9);
    const joints = random() * (Math.sin(t * 91) > .67 ? 1 : .08) * acceleration * .24;
    return mass * .68 + air * .36 + joints;
  }, .82);
}

function structuralLand(sampleRate) {
  return render(sampleRate, 1.7, 0xc8d4, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * .018;
    const body = state.low * 6.8 * curve(t, .001, 2.65);
    const crack = (white - state.low) * curve(t, .0005, 4.8);
    const debris = [0, .055, .13, .24, .38].reduce((sum, offset, index) => sum + (t >= offset ? (white - state.low) * Math.exp(-(t - offset) * (8 + index * 1.4)) : 0), 0);
    const sub = Math.sin(Math.PI * 2 * 34 * t) * curve(t, .002, 3.3);
    return body * .66 + sub * .72 + crack * .48 + debris * .16;
  }, .94);
}

function loopSafe(data, sampleRate, fadeSeconds = .035) {
  const fade = Math.min(Math.floor(data.length / 4), Math.max(8, Math.floor(sampleRate * fadeSeconds)));
  for (let index = 0; index < fade; index++) {
    const phase = index / Math.max(1, fade - 1);
    const gain = Math.sin(phase * Math.PI / 2) ** 2;
    data[index] *= gain;
    data[data.length - 1 - index] *= gain;
  }
  return data;
}

function texture(sampleRate, seconds, seed, color = .03, grit = .35, peak = .72) {
  return loopSafe(render(sampleRate, seconds, seed, (t, random, state) => {
    const white = random(); state.low += (white - state.low) * color;
    const broad = white - state.low;
    const movement = .72 + .18 * Math.sin(t * 3.7) + .1 * Math.sin(t * 11.3 + 1.2);
    return (state.low * (2.4 - grit) + broad * grit) * movement;
  }, peak), sampleRate);
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

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function weaponFamily(weapon = {}) {
  if (weapon.type === "melee") return "melee";
  if (weapon.type === "flame" || weapon.id === "fireball" || weapon.hazard === "napalm") return "fire";
  if (weapon.hazard === "black_hole" || weapon.pull || weapon.id === "gravity_beam") return "gravity";
  if (weapon.effect === "freeze") return "ice";
  if (["rocket", "grenade", "mine", "remote"].includes(weapon.type)) return "launcher";
  if (["rail", "beam", "chain", "plasma"].includes(weapon.type) || weapon.energy) return "energy";
  if (["wall", "decoy"].includes(weapon.type) || ["teleport", "steal"].includes(weapon.effect)) return "utility";
  return "ballistic";
}

function weaponSpec(weapon, identity = []) {
  const hash = hashText(`${weapon.id}:${identity[0] || weapon.name}`);
  const family = weaponFamily(weapon);
  const unit = (shift) => ((hash >>> shift) & 255) / 255;
  const durations = { ballistic: .16, launcher: .48, energy: .38, fire: .66, gravity: .72, ice: .43, utility: .4, melee: .36 };
  return {
    hash, family,
    duration: durations[family] + unit(2) * (family === "ballistic" ? .13 : .22),
    weight: clamp(.22 + (weapon.recoil || 1) / 10 + unit(10) * .24, .2, 1),
    grit: clamp((identity[2] ?? .45) * .72 + unit(18) * .28, .08, 1),
    tail: clamp((identity[3] ?? .45) * .75 + unit(24) * .25, .08, 1),
    bodyHz: 38 + unit(6) * 118,
    detailHz: 900 + unit(14) * 4300,
    mechanismAt: .018 + (hash % 7) * .011,
    secondAt: .07 + ((hash >>> 7) % 8) * .016
  };
}

function transientAt(t, at, decay) {
  return t >= at ? Math.exp(-(t - at) * decay) : 0;
}

function weaponFire(sampleRate, weapon, identity) {
  const spec = weaponSpec(weapon, identity);
  const seconds = weapon.id === "chainsaw" ? .54 : weapon.id === "flamethrower" ? .78 : spec.duration;
  return render(sampleRate, seconds, spec.hash ^ 0x1f3d5b79, (t, random, state) => {
    const white = random();
    state.low += (white - state.low) * (.012 + spec.grit * .075);
    state.slow = (state.slow || 0) + (white - (state.slow || 0)) * (.003 + spec.weight * .01);
    const air = white - state.low;
    const mid = state.low - state.slow;
    const attack = curve(t, .0006 + (1 - spec.weight) * .0018, 9 + (1 - spec.tail) * 22);
    const bodyFrequency = spec.bodyHz + 96 * Math.exp(-t * (12 + spec.weight * 12));
    state.phase += Math.PI * 2 * bodyFrequency / sampleRate;
    const body = Math.sin(state.phase) * curve(t, .001, 7 + (1 - spec.tail) * 9);
    const mechanism = (air * .8 + mid * 1.7) * transientAt(t, spec.mechanismAt, 62 + spec.grit * 45);
    const signature = (air * .65 + mid * 2.1) * transientAt(t, spec.secondAt, 34 + spec.grit * 35);

    if (spec.family === "ballistic") {
      const crack = air * Math.exp(-t * (42 + spec.grit * 35));
      const receiver = mechanism + signature * (weapon.id === "burst_rifle" ? .9 : .42);
      const mass = weapon.id === "shotgun" ? 1.2 : weapon.id === "needle_launcher" ? .22 : .55 + spec.weight * .3;
      return crack * (.72 + spec.grit * .34) + body * mass + receiver * .42;
    }
    if (spec.family === "launcher") {
      const backblast = (air * .38 + mid * 2.4) * curve(t, .002, 3.8 + (1 - spec.tail) * 5);
      const tube = body * (.75 + spec.weight * .55);
      const latch = mechanism * (weapon.type === "mine" || weapon.type === "remote" ? 1.1 : .28);
      return tube + backblast + latch + signature * .32;
    }
    if (spec.family === "fire") {
      const roar = state.slow * 5 + mid * 1.8 + air * .18;
      const flutter = .72 + .18 * Math.sin(t * (47 + (spec.hash % 23))) + .1 * Math.sin(t * 113);
      return roar * curve(t, .006, 3.3 + (1 - spec.tail) * 3) * flutter + body * .34 + mechanism * .16;
    }
    if (spec.family === "gravity") {
      const collapse = (state.slow * 7 + mid * 1.5) * curve(t, .012, 2.4 + (1 - spec.tail) * 3.2);
      const inward = air * Math.sin(Math.PI * Math.min(1, t / seconds)) ** 2;
      return collapse + body * 1.05 + inward * .25 + signature * .2;
    }
    if (spec.family === "ice") {
      const shards = air * (Math.sin(t * (181 + spec.hash % 91)) > .18 ? 1 : .08) * Math.exp(-t * (5 + spec.tail * 5));
      return shards * .86 + mid * attack * .65 + body * .18 + mechanism * .3;
    }
    if (spec.family === "melee") {
      const sweep = air * Math.sin(Math.PI * Math.min(1, t / seconds)) ** 1.45;
      const strike = (mid * 2.2 + body) * transientAt(t, seconds * (.52 + ((spec.hash >>> 9) % 17) / 100), 18 + spec.weight * 20);
      if (weapon.id === "chainsaw") return (mid * 2.6 + air * .42) * (.64 + .36 * Math.sin(t * 137) ** 2) * curve(t, .004, 2.4) + strike * .44;
      if (weapon.id === "hammer") return sweep * .28 + strike * 1.45 + body * .74;
      if (weapon.id === "knife" || weapon.id === "spear") return sweep * 1.12 + strike * .48 + mechanism * .34;
      return sweep * .72 + strike * (.72 + spec.weight * .38) + mechanism * .28;
    }
    if (spec.family === "utility") {
      const deploy = (mid * 2.5 + state.slow * 4) * curve(t, .004, 4.8);
      return deploy * .7 + mechanism * .7 + signature * .48 + air * attack * .22 + body * .28;
    }
    const electrical = air * (Math.sin(t * (97 + spec.hash % 79)) > .42 ? 1 : .12) * Math.exp(-t * (6 + spec.grit * 7));
    const surge = (mid * 2.8 + state.slow * 4.2) * curve(t, .002, 4.2 + (1 - spec.tail) * 5);
    const railWeight = weapon.type === "rail" || weapon.type === "beam" ? 1.18 : .72;
    return surge * railWeight + electrical * (.32 + spec.grit * .48) + body * (.38 + spec.weight * .55) + signature * .22;
  }, .91);
}

function weaponImpact(sampleRate, weapon, identity) {
  const spec = weaponSpec(weapon, identity);
  const explosive = Boolean(weapon.radius || weapon.hazard || ["launcher", "gravity", "fire"].includes(spec.family));
  const seconds = (explosive ? .62 : .24) + spec.tail * (explosive ? .72 : .26);
  return render(sampleRate, seconds, spec.hash ^ 0xa7c9214d, (t, random, state) => {
    const white = random();
    state.low += (white - state.low) * (.016 + spec.grit * .065);
    state.slow = (state.slow || 0) + (white - (state.slow || 0)) * (.003 + spec.weight * .008);
    const debris = white - state.low;
    const grit = state.low - state.slow;
    const decay = explosive ? 3.2 + (1 - spec.tail) * 3.4 : 10 + (1 - spec.tail) * 18;
    state.phase += Math.PI * 2 * (spec.bodyHz * (explosive ? .62 : 1.25) + 70 * Math.exp(-t * 15)) / sampleRate;
    const body = Math.sin(state.phase) * curve(t, .0008, decay);
    const scatter = debris * curve(t, .0003, decay * (1.1 + spec.grit));
    const late = (grit * 2.4 + debris * .3) * transientAt(t, .035 + (spec.hash % 8) * .012, decay * 1.7);
    if (spec.family === "ice") return scatter * 1.05 * (Math.sin(t * 223) > .08 ? 1 : .1) + body * .2 + late * .54;
    if (spec.family === "fire") return (state.slow * 5 + grit * 2) * curve(t, .003, 3.4) + scatter * .42 + body * .58;
    if (spec.family === "gravity") return state.slow * 7 * Math.sin(Math.PI * Math.min(1, t / seconds)) + body * 1.2 + grit * .52;
    if (spec.family === "energy") return grit * 2.8 * curve(t, .001, decay * .72) + scatter * .55 + body * .62 + late * .35;
    if (spec.family === "melee") return body * (weapon.id === "hammer" ? 1.35 : .55) + scatter * .48 + late * (.52 + spec.weight * .48);
    return body * (.62 + spec.weight * .66) + scatter * (.48 + spec.grit * .5) + late * .44 + state.slow * (explosive ? 3.6 : 1.1) * Math.exp(-t * decay);
  }, explosive ? .94 : .86);
}

function weaponOperation(sampleRate, weapon, identity) {
  const spec = weaponSpec(weapon, identity);
  const seconds = .16 + spec.weight * .16 + (weapon.type === "melee" ? .08 : 0);
  return render(sampleRate, seconds, spec.hash ^ 0x9c40e62b, (t, random, state) => {
    const white = random();
    state.low += (white - state.low) * (.04 + spec.grit * .08);
    state.slow = (state.slow || 0) + (white - (state.slow || 0)) * .008;
    const click = (white - state.low) * transientAt(t, .008, 92);
    const action = (state.low - state.slow) * 2.8 * transientAt(t, spec.mechanismAt + .025, 54);
    const lock = (white - state.low) * transientAt(t, spec.secondAt, 72);
    const cloth = (white - state.low) * Math.sin(Math.PI * Math.min(1, t / seconds)) ** 1.5;
    const heavy = state.slow * 5.2 * curve(t, .002, 12);
    if (spec.family === "melee") return cloth * .62 + action * .58 + heavy * spec.weight;
    if (spec.family === "fire") return action * .5 + heavy * .7 + (state.low - state.slow) * curve(t, .003, 7);
    if (spec.family === "energy" || spec.family === "gravity" || spec.family === "ice") return click * .42 + action * .72 + lock * .36 + heavy * .48;
    return click * .7 + action * (.62 + spec.weight * .45) + lock * .56 + heavy * .4;
  }, .78);
}

function weaponTexture(sampleRate, weapon, identity, kind) {
  const spec = weaponSpec(weapon, identity);
  const seeds = { loop: 0x32d8a511, charge: 0x47be9203, projectile: 0x58fc7337, hazard: 0x6e1a4cc9 };
  const seconds = kind === "charge" ? 1.35 : kind === "hazard" ? 1.8 : 1.45;
  return loopSafe(render(sampleRate, seconds, spec.hash ^ seeds[kind], (t, random, state) => {
    const white = random();
    const color = kind === "projectile" ? .045 : kind === "hazard" ? .012 : .026;
    state.low += (white - state.low) * (color + spec.grit * .035);
    state.slow = (state.slow || 0) + (white - (state.slow || 0)) * (.0025 + spec.weight * .006);
    const air = white - state.low, mid = state.low - state.slow;
    const cycleA = .68 + .2 * Math.sin(t * (2.7 + (spec.hash % 9) * .17)) + .12 * Math.sin(t * (9 + ((spec.hash >>> 5) % 15)));
    const cycleB = .72 + .28 * Math.sin(t * (kind === "charge" ? 17 : 37 + (spec.hash % 31))) ** 2;
    const low = state.slow * (spec.family === "gravity" || spec.family === "launcher" ? 7 : 3.4);
    const mechanical = mid * (weapon.id === "minigun" || weapon.id === "chainsaw" ? 3.5 : 1.7) * cycleB;
    const combustion = spec.family === "fire" ? (state.slow * 4.5 + air * .22) * cycleA : 0;
    const electrical = spec.family === "energy" || spec.family === "ice" ? air * (Math.sin(t * (71 + spec.hash % 53)) > .48 ? .8 : .12) : 0;
    return (low * .38 + mechanical * .45 + combustion + electrical * .38 + air * (.12 + spec.grit * .2)) * cycleA;
  }, kind === "hazard" ? .75 : .7), sampleRate);
}

// These are authored per weapon rather than generic layers with renamed
// metadata. Each fire, impact and relevant sustained/flight source owns a
// different rendered buffer and a different temporal/material recipe.
export function createWeaponAudioAssets(sampleRate = 48000, weapons = [], identities = {}) {
  const rate = Math.max(8000, Math.floor(Number(sampleRate) || 48000));
  const assets = {};
  for (const weapon of weapons) {
    const identity = identities[weapon.id] || [];
    assets[`weaponFire:${weapon.id}`] = weaponFire(rate, weapon, identity);
    assets[`weaponImpact:${weapon.id}`] = weaponImpact(rate, weapon, identity);
    assets[`weaponOperate:${weapon.id}`] = weaponOperation(rate, weapon, identity);
    if (weapon.maintained) assets[`weaponLoop:${weapon.id}`] = weaponTexture(rate, weapon, identity, "loop");
    if (weapon.chargeTime) assets[`weaponCharge:${weapon.id}`] = weaponTexture(rate, weapon, identity, "charge");
    if ((weapon.projectileSpeed || 0) > 0 && !weapon.hitscan) assets[`weaponFlight:${weapon.id}`] = weaponTexture(rate, weapon, identity, "projectile");
    if (weapon.hazard) assets[`weaponHazard:${weapon.id}`] = weaponTexture(rate, weapon, identity, "hazard");
  }
  return Object.freeze(assets);
}

export function createProceduralAudioAssets(sampleRate = 48000) {
  const rate = Math.max(8000, Math.floor(Number(sampleRate) || 48000));
  return Object.freeze({
    kick: kick(rate), snare: snare(rate), clap: clap(rate), hatClosed: hat(rate), hatOpen: hat(rate, true),
    impact: impact(rate), explosion: impact(rate, true), ballistic: ballistic(rate), energy: energy(rate),
    mechanical: mechanical(rate), heavyUi: heavyUi(rate), whoosh: whoosh(rate), iceCrack: iceCrack(rate), cableSnap: cableSnap(rate),
    flame: flame(rate), footstep: footstep(rate), transition: transition(rate),
    structuralWarning: structuralWarning(rate), structuralBreak: structuralBreak(rate), structuralFall: structuralFall(rate), structuralLand: structuralLand(rate),
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
