const freeze = (value) => Object.freeze(value);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

// The countdown keeps its original 132 BPM grid. Combat tempo moves between
// musical tiers only on bar boundaries, so rising action feels intentional.
export const MUSIC = freeze({
  bpm: 132,
  countdownBpm: 132,
  tempoTiers: freeze([118, 132, 146, 156]),
  stepsPerBeat: 4,
  beatsPerBar: 4,
  stepsPerBar: 16,
  tonicMidi: 38, // D2
  roots: freeze([0, -4, 3, -2, -5, -4, -5, -5]), // Dm - Bb - F - C - Gm - Bb - A - A
  chords: freeze([
    freeze([0, 3, 7]), freeze([0, 4, 7]), freeze([0, 4, 7]), freeze([0, 4, 7]),
    freeze([0, 3, 7]), freeze([0, 4, 7]), freeze([0, 4, 7]), freeze([0, 4, 7])
  ]),
  motifs: freeze([
    freeze([0, 3, 7, 10, 7, 5, 3, 2]),
    freeze([7, 10, 12, 10, 7, 5, 3, 0]),
    freeze([0, 7, 5, 3, 2, 3, 5, 7]),
    freeze([12, 10, 7, 5, 3, 5, 2, 0])
  ]),
  form: freeze([
    freeze({ name: "intro", from: 0, to: 3, energy: .36 }),
    freeze({ name: "pursuit", from: 4, to: 11, energy: .68 }),
    freeze({ name: "assault", from: 12, to: 15, energy: .88 }),
    freeze({ name: "breath", from: 16, to: 19, energy: .42 }),
    freeze({ name: "onslaught", from: 20, to: 27, energy: 1 }),
    freeze({ name: "resolve", from: 28, to: 31, energy: .66 })
  ])
});

export const MUSIC_SAMPLE_MANIFEST = freeze({
  battleDrum: freeze({ files: freeze([
    freeze({ url: "/audio/music/battle-drum.wav", trim: 1.41 }), freeze({ url: "/audio/music/battle-drum-2.wav", trim: 1.46 }), freeze({ url: "/audio/music/battle-drum-3.wav", trim: 1.71 })
  ]) }),
  fieldSnare: freeze({ files: freeze([
    freeze({ url: "/audio/music/field-snare.wav", trim: 1 }), freeze({ url: "/audio/music/field-snare-2.wav", trim: 1.01 }), freeze({ url: "/audio/music/field-snare-3.wav", trim: 1.03 })
  ]) }),
  cymbal: freeze({ files: freeze([
    freeze({ url: "/audio/music/cymbal.wav", trim: 1.73 }), freeze({ url: "/audio/music/cymbal-2.wav", trim: 1.4 })
  ]) }),
  anvil: freeze({ files: freeze([
    freeze({ url: "/audio/music/anvil.wav", trim: 1.43 }), freeze({ url: "/audio/music/anvil-2.wav", trim: 1.21 }), freeze({ url: "/audio/music/anvil-3.wav", trim: 1.55 })
  ]) }),
  celloPizz: freeze({ files: freeze([
    freeze({ url: "/audio/music/cello-pizz.wav", rootMidi: 38, trim: 1.21 }), freeze({ url: "/audio/music/cello-pizz-a2.wav", rootMidi: 45, trim: 1.01 }), freeze({ url: "/audio/music/cello-pizz-c3.wav", rootMidi: 48, trim: 1.01 }), freeze({ url: "/audio/music/cello-pizz-d4.wav", rootMidi: 62, trim: 1.03 })
  ]) }),
  celloSpic: freeze({ files: freeze([
    freeze({ url: "/audio/music/cello-spic.wav", rootMidi: 38, trim: .93 }), freeze({ url: "/audio/music/cello-spic-a2.wav", rootMidi: 45, trim: .95 }), freeze({ url: "/audio/music/cello-spic-c3.wav", rootMidi: 48, trim: 1.28 })
  ]) }),
  celloTrem: freeze({ files: freeze([
    freeze({ url: "/audio/music/cello-trem.wav", rootMidi: 38, trim: .96 }), freeze({ url: "/audio/music/cello-trem-a2.wav", rootMidi: 45, trim: .89 }), freeze({ url: "/audio/music/cello-trem-c3.wav", rootMidi: 48, trim: .96 })
  ]) }),
  hornStaccato: freeze({ files: freeze([
    freeze({ url: "/audio/music/horn-staccato.wav", rootMidi: 38, trim: .68 }), freeze({ url: "/audio/music/horn-staccato-a2.wav", rootMidi: 45, trim: .64 }), freeze({ url: "/audio/music/horn-staccato-c3.wav", rootMidi: 48, trim: .51 }), freeze({ url: "/audio/music/horn-staccato-d4.wav", rootMidi: 62, trim: .6 })
  ]) }),
  hornSustain: freeze({ files: freeze([
    freeze({ url: "/audio/music/horn-sustain.wav", rootMidi: 38, trim: .25 }), freeze({ url: "/audio/music/horn-sustain-a2.wav", rootMidi: 45, trim: .38 }), freeze({ url: "/audio/music/horn-sustain-c3.wav", rootMidi: 48, trim: .3 }), freeze({ url: "/audio/music/horn-sustain-d4.wav", rootMidi: 62, trim: .28 })
  ]) }),
  tromboneBuzz: freeze({ files: freeze([freeze({ url: "/audio/music/trombone-buzz.wav", rootMidi: 38, trim: 1.2 })]) }),
  violinSpic: freeze({ files: freeze([
    freeze({ url: "/audio/music/violin-spic.wav", rootMidi: 60, trim: .76 }), freeze({ url: "/audio/music/violin-spic-g4.wav", rootMidi: 67, trim: .97 }), freeze({ url: "/audio/music/violin-spic-c5.wav", rootMidi: 72, trim: .94 })
  ]) })
});

const SCENES = freeze({
  menu: freeze({ intensity: .2, percussion: false, melody: false }),
  countdown: freeze({ intensity: .72, percussion: true, melody: false }),
  combat: freeze({ percussion: true, melody: true }),
  paused: freeze({ intensity: 0, percussion: false, melody: false }),
  "results-win": freeze({ intensity: .54, percussion: false, melody: true }),
  "results-loss": freeze({ intensity: .28, percussion: false, melody: false })
});

const SECTION_RULES = freeze({
  intro: freeze({ pulse: 4, drums: freeze([0, 8]), snare: freeze([]) }),
  pursuit: freeze({ pulse: 2, drums: freeze([0, 6, 8, 14]), snare: freeze([4, 12]) }),
  assault: freeze({ pulse: 1, drums: freeze([0, 3, 6, 8, 11, 14]), snare: freeze([4, 12, 15]) }),
  breath: freeze({ pulse: 4, drums: freeze([0]), snare: freeze([12]) }),
  onslaught: freeze({ pulse: 1, drums: freeze([0, 3, 6, 8, 10, 14]), snare: freeze([4, 12, 15]) }),
  resolve: freeze({ pulse: 2, drums: freeze([0, 8]), snare: freeze([4, 12]) })
});

export function noteFrequency(midi) {
  if (!Number.isFinite(midi)) throw new TypeError("midi note must be finite");
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hashMusicSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function seededMusicRandom(seed) {
  let state = hashMusicSeed(seed) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededMusicChoice(items, seed) {
  if (!items?.length) return undefined;
  return items[Math.floor(seededMusicRandom(seed)() * items.length)];
}

export function musicSectionForBar(bar) {
  const position = ((Math.floor(Number(bar) || 0) % 32) + 32) % 32;
  return MUSIC.form.find((section) => position >= section.from && position <= section.to);
}

// Hysteresis prevents tempo hunting when combat hovers around a threshold.
// At most one tier changes per bar, keeping every transition beat-aligned.
export function tempoForIntensity(intensity, currentBpm = MUSIC.bpm) {
  const value = clamp(Number(intensity) || 0);
  const tiers = MUSIC.tempoTiers;
  let index = tiers.reduce((best, bpm, candidate) => Math.abs(bpm - currentBpm) < Math.abs(tiers[best] - currentBpm) ? candidate : best, 0);
  const up = [.36, .62, .84];
  const down = [.26, .52, .74];
  if (index < tiers.length - 1 && value >= up[index]) index++;
  else if (index > 0 && value < down[index - 1]) index--;
  return tiers[index];
}

export function combatMusicIntensity({
  combatPulse = 0, nearbyEnemies = 0, nearbyProjectiles = 0, nearbyHazards = 0,
  healthDanger = 0, speed = 0, finalMinute = 0, scorePressure = 0
} = {}) {
  return clamp(.16
    + clamp(combatPulse) * .31
    + clamp(nearbyEnemies) * .16
    + clamp(nearbyProjectiles) * .13
    + clamp(nearbyHazards) * .08
    + clamp(healthDanger) * .07
    + clamp(speed) * .04
    + clamp(finalMinute) * .03
    + clamp(scorePressure) * .02);
}

function recorded(layer, step, sample, durationSteps, gain, options = {}) {
  if (!MUSIC_SAMPLE_MANIFEST[sample]) throw new TypeError(`Unknown music sample: ${sample}`);
  const midi = Number.isFinite(options.midi) ? options.midi : null;
  return freeze({
    kind: "recorded", layer, step, sample, midi,
    rootMidi: Number.isFinite(options.rootMidi) ? options.rootMidi : null,
    frequency: midi == null ? 1 : noteFrequency(midi),
    durationSteps,
    gain: clamp(gain),
    pan: clamp(options.pan || 0, -1, 1),
    filterHz: options.filterHz || 12000,
    wet: clamp(options.wet ?? .08),
    attack: Math.max(0, options.attack || 0),
    release: Math.max(.02, options.release || .1),
    rate: clamp(options.rate || 1, .7, 1.35)
  });
}

function scoreContext({ seed = "BLAST-01", bar = 0, step = 0, scene = "combat", intensity = .5 } = {}) {
  const safeBar = Math.max(0, Math.floor(Number(bar) || 0));
  const safeStep = Math.min(15, Math.max(0, Math.floor(Number(step) || 0)));
  const sceneName = Object.hasOwn(SCENES, scene) ? scene : "combat";
  const sceneRule = SCENES[sceneName];
  const section = musicSectionForBar(safeBar);
  const requested = Number.isFinite(Number(intensity)) ? Number(intensity) : .5;
  const energy = sceneRule.intensity ?? clamp(requested) * (.76 + section.energy * .24);
  const chordIndex = safeBar % MUSIC.roots.length;
  const root = MUSIC.tonicMidi + MUSIC.roots[chordIndex];
  return { seed: String(seed), bar: safeBar, step: safeStep, scene: sceneName, sceneRule, section, rule: SECTION_RULES[section.name], energy: clamp(energy), chordIndex, root };
}

function harmonicInterval(interval, chordIndex) {
  return chordIndex >= 6 && ((interval % 12) + 12) % 12 === 3 ? interval + 1 : interval;
}

export function musicEventsForStep(input = {}) {
  const score = scoreContext(input);
  const { seed, bar, step, scene, sceneRule, section, rule, energy, chordIndex, root } = score;
  if (scene === "paused") return freeze([]);
  const events = [];
  const chord = MUSIC.chords[chordIndex];
  const fillBar = bar % 4 === 3;

  if (scene === "countdown") {
    if (step % 4 === 0) events.push(recorded("countdown-drum", step, "battleDrum", 3, .105 + step * .002, { rate: 1 + step / 128, wet: .05 }));
    if (step === 12) events.push(recorded("countdown-anvil", step, "anvil", 4, .08, { wet: .14 }));
    return freeze(events);
  }

  if (scene.startsWith("results")) {
    if (step === 0) {
      events.push(recorded("result-bed", step, "celloTrem", 16, .042, { midi: root + 12, wet: .18, attack: .08, release: .32 }));
      events.push(recorded("result-horn", step, "hornSustain", 12, scene === "results-win" ? .065 : .04, { midi: root + 12, wet: .2, attack: .035, release: .3 }));
      if (scene === "results-win") events.push(recorded("result-cymbal", step, "cymbal", 10, .055, { wet: .18 }));
    }
    if (step % 4 === 0) {
      const interval = scene === "results-win" ? [0, 3, 7, 12][step / 4] : [7, 5, 3, 0][step / 4];
      events.push(recorded("result-motif", step, "violinSpic", 3, .05, { midi: root + 24 + harmonicInterval(interval, chordIndex), pan: step < 8 ? -.12 : .12, wet: .16 }));
    }
    return freeze(events);
  }

  if (scene === "menu") {
    if (step === 0) {
      events.push(recorded("menu-bed", step, "celloTrem", 16, .034, { midi: root + 12, wet: .2, attack: .12, release: .34 }));
      events.push(recorded("menu-horizon", step, "hornSustain", 14, .025, { midi: root + 19, pan: .16, wet: .24, attack: .16, release: .38 }));
    }
    if (step === 2 || step === 10) events.push(recorded("menu-pulse", step, "celloPizz", 3, .035, { midi: root + (step === 2 ? 12 : 19), pan: step === 2 ? -.18 : .18, wet: .12 }));
    return freeze(events);
  }

  if (step === 0) {
    events.push(recorded("low-strings", step, "celloTrem", 16, .035 + energy * .025, { midi: root + 12, pan: -.14, wet: .15, attack: .08, release: .3, filterHz: 5200 }));
    if (energy >= .36) {
      const hornNotes = energy >= .7 ? [0, 7] : [0];
      for (const interval of hornNotes) events.push(recorded("brass-bed", step, "hornSustain", 14, .025 + energy * .025, { midi: root + 12 + harmonicInterval(interval, chordIndex), pan: interval ? .18 : -.08, wet: .18, attack: .05, release: .28 }));
    }
    if (energy >= .72 && ["assault", "onslaught"].includes(section.name)) events.push(recorded("crash", step, "cymbal", 12, .045 + energy * .02, { wet: .17 }));
  }

  if (step % rule.pulse === 0) {
    const pulseIndex = Math.floor(step / Math.max(1, rule.pulse));
    const interval = [0, 0, 7, 3, 0, 7, 10, 7][pulseIndex % 8];
    events.push(recorded("cello-ostinato", step, energy >= .52 ? "celloSpic" : "celloPizz", Math.max(1, rule.pulse), .038 + energy * .032, {
      midi: root + harmonicInterval(interval, chordIndex), pan: step % 4 ? -.1 : .1, wet: .055, filterHz: 4300 + energy * 3300
    }));
  }

  if ([0, 8].includes(step) || (energy >= .8 && [4, 12].includes(step))) {
    events.push(recorded("low-brass", step, "tromboneBuzz", energy >= .8 ? 4 : 7, .04 + energy * .035, { midi: root, pan: .04, wet: .075, filterHz: 2600 }));
  }
  if (sceneRule.percussion && energy >= .3 && rule.drums.includes(step)) events.push(recorded("battle-drum", step, "battleDrum", 3, .065 + energy * .05, { rate: .96 + (step % 3) * .018, wet: .045 }));
  if (sceneRule.percussion && energy >= .48 && rule.snare.includes(step)) events.push(recorded("field-snare", step, "fieldSnare", 2, .045 + energy * .034, { rate: .98 + (bar % 3) * .012, pan: step === 4 ? -.08 : .08, wet: .08 }));

  if (energy >= .62 && [2, 6, 10, 14].includes(step)) {
    const accents = [0, 7, 3, 10];
    events.push(recorded("horn-accent", step, "hornStaccato", 2, .036 + energy * .03, { midi: root + 12 + harmonicInterval(accents[step / 4 | 0], chordIndex), pan: step < 8 ? -.16 : .16, wet: .12 }));
  }

  if (sceneRule.melody && energy >= .76 && !["intro", "breath"].includes(section.name)) {
    const rhythm = fillBar ? [1, 5, 9, 12, 14] : [2, 6, 10, 14];
    if (rhythm.includes(step)) {
      const motif = seededMusicChoice(MUSIC.motifs, `${seed}:orchestral:${Math.floor(bar / 4)}`);
      const index = rhythm.indexOf(step) + (bar % 2) * 2;
      events.push(recorded("violin-answer", step, "violinSpic", step >= 12 ? 3 : 2, .032 + energy * .024, {
        midi: root + 24 + harmonicInterval(motif[index % motif.length], chordIndex), pan: step % 4 ? .2 : -.2, wet: .15, filterHz: 8500
      }));
    }
  }

  if (fillBar && energy >= .68 && step === 12) events.push(recorded("metal-transition", step, "anvil", 4, .04 + energy * .025, { wet: .14 }));
  if (fillBar && energy >= .78 && [13, 14, 15].includes(step)) events.push(recorded("drum-fill", step, "battleDrum", 1, .045 + energy * .025, { rate: 1 + (step - 14) * .08, pan: (step - 14) * .13, wet: .055 }));
  if (section.name === "resolve" && bar % 32 === 31 && step === 12) {
    events.push(recorded("cadence", step, "hornSustain", 4, .07, { midi: MUSIC.tonicMidi + 12, wet: .22, attack: .02, release: .3 }));
    events.push(recorded("cadence-cymbal", step, "cymbal", 4, .055, { wet: .18 }));
  }
  return freeze(events);
}

export function musicEventsForBar(input = {}) {
  const events = [];
  for (let step = 0; step < MUSIC.stepsPerBar; step++) events.push(...musicEventsForStep({ ...input, step }));
  return freeze(events);
}
