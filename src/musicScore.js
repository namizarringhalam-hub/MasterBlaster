const freeze = (value) => Object.freeze(value);

export const MUSIC = freeze({
  bpm: 132,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  stepsPerBar: 16,
  tonicMidi: 38, // D2
  roots: freeze([0, -4, -2, -5, 0, 5, -4, -5]), // Dm - Bb - C - A - Dm - Gm - Bb - A
  chords: freeze([
    freeze([0, 3, 7]),
    freeze([0, 4, 7]),
    freeze([0, 4, 7]),
    freeze([0, 4, 7]),
    freeze([0, 3, 7, 10]),
    freeze([0, 3, 7]),
    freeze([0, 4, 7, 9]),
    freeze([0, 4, 7])
  ]),
  motifs: freeze([
    freeze([0, 3, 7, 10, 7, 5, 3, 2]),
    freeze([7, 10, 12, 15, 12, 10, 7, 5]),
    freeze([0, 7, 5, 3, 2, 3, 5, 7]),
    freeze([12, 10, 7, 5, 3, 5, 2, 0])
  ]),
  kick: freeze([1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0]),
  snare: freeze([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
  bass: freeze([0, null, 0, 7, null, 0, null, 10, 0, null, 7, null, 0, 10, null, 7]),
  form: freeze([
    freeze({ name: "intro", from: 0, to: 3, energy: .42 }),
    freeze({ name: "a", from: 4, to: 11, energy: .72 }),
    freeze({ name: "b", from: 12, to: 15, energy: .86 }),
    freeze({ name: "breakdown", from: 16, to: 19, energy: .46 }),
    freeze({ name: "drop", from: 20, to: 27, energy: 1 }),
    freeze({ name: "resolve", from: 28, to: 31, energy: .64 })
  ])
});

const SCENES = freeze({
  menu: freeze({ intensity: .22, percussion: false, lead: false }),
  countdown: freeze({ intensity: .82, percussion: true, lead: false }),
  combat: freeze({ percussion: true, lead: true }),
  paused: freeze({ intensity: 0, percussion: false, lead: false }),
  "results-win": freeze({ intensity: .58, percussion: false, lead: true }),
  "results-loss": freeze({ intensity: .34, percussion: false, lead: false })
});

const SECTION_RULES = freeze({
  intro: freeze({ bassDivisor: 4, hat: 0, kick: freeze([0, 8]), voicing: 0 }),
  a: freeze({ bassDivisor: 2, hat: 4, kick: freeze([0, 6, 8, 14]), voicing: 0 }),
  b: freeze({ bassDivisor: 1, hat: 2, kick: freeze([0, 3, 6, 8, 11, 14]), voicing: 7 }),
  breakdown: freeze({ bassDivisor: 8, hat: 0, kick: freeze([0]), voicing: -5 }),
  drop: freeze({ bassDivisor: 1, hat: 2, kick: freeze([0, 3, 6, 8, 10, 14]), voicing: 12 }),
  resolve: freeze({ bassDivisor: 2, hat: 4, kick: freeze([0, 8]), voicing: 0 })
});

const LEAD_RHYTHMS = freeze([
  freeze([0, 3, 6, 10, 12]), freeze([0, 2, 7, 9, 14]),
  freeze([1, 4, 6, 11, 15]), freeze([0, 5, 8, 10, 13])
]);

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function noteFrequency(midi) {
  if (!Number.isFinite(midi)) throw new TypeError("midi note must be finite");
  return 440 * 2 ** ((midi - 69) / 12);
}

export function hashMusicSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
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

function tone(layer, step, midi, durationSteps, gain, wave, pan = 0, filterHz = 8000) {
  return freeze({
    kind: "tone", layer, step, midi, frequency: noteFrequency(midi), durationSteps,
    gain: clamp(gain), wave, pan: clamp(pan, -1, 1), filterHz
  });
}

function noise(layer, step, durationSteps, gain, filterHz, pan = 0) {
  return freeze({
    kind: "noise", layer, step, frequency: filterHz, durationSteps,
    gain: clamp(gain), wave: "noise", pan: clamp(pan, -1, 1), filterHz
  });
}

function scoreContext({ seed = "BLAST-01", bar = 0, step = 0, scene = "combat", intensity = .5 } = {}) {
  const safeBar = Math.max(0, Math.floor(Number(bar) || 0));
  const safeStep = Math.min(MUSIC.stepsPerBar - 1, Math.max(0, Math.floor(Number(step) || 0)));
  const sceneName = Object.hasOwn(SCENES, scene) ? scene : "combat";
  const sceneRule = SCENES[sceneName];
  const section = musicSectionForBar(safeBar);
  const sectionRule = SECTION_RULES[section.name];
  const requested = Number.isFinite(Number(intensity)) ? Number(intensity) : .5;
  const energy = sceneRule.intensity ?? clamp(requested) * (.78 + section.energy * .22);
  const chordIndex = safeBar % MUSIC.roots.length;
  const root = MUSIC.tonicMidi + MUSIC.roots[chordIndex];
  const random = seededMusicRandom(`${seed}:${sceneName}:${safeBar}`);
  return { seed: String(seed), bar: safeBar, step: safeStep, scene: sceneName, sceneRule, section, sectionRule, energy: clamp(energy), chordIndex, root, random };
}

function harmonicInterval(interval, chordIndex) {
  return chordIndex % 4 === 3 && ((interval % 12) + 12) % 12 === 3 ? interval + 1 : interval;
}

export function musicEventsForStep(input = {}) {
  const score = scoreContext(input);
  const { seed, bar, step, scene, sceneRule, section, sectionRule, energy, chordIndex, root, random } = score;
  if (scene === "paused") return freeze([]);
  const events = [];
  const chord = MUSIC.chords[chordIndex];
  const fillBar = bar % 4 === 3;

  if (step === 0) {
    const padGain = scene === "menu" ? .034 : .026 + energy * .018;
    for (const interval of chord) events.push(tone("pad", step, root + 24 + harmonicInterval(interval, chordIndex) + sectionRule.voicing, 16, padGain / Math.sqrt(chord.length / 3), "triangle", (interval - 3.5) / 9, 1800 + energy * 2600));
    if (scene === "combat" && energy >= .78 && ["b", "drop"].includes(section.name)) events.push(noise("crash", step, 6, .038 + energy * .012, 7600, -.16));
  }

  if (scene === "countdown") {
    if (step % 4 === 0) events.push(tone("countdown-pulse", step, root + 24 + step / 4 * 2, 2, .07 + step * .002, "square", 0, 2400));
    if (step === 12) events.push(noise("riser", step, 4, .06, 4200));
    return freeze(events);
  }

  if (scene.startsWith("results")) {
    if (step % 4 === 0) {
      const lift = scene === "results-win" ? [0, 3, 7, 12][step / 4] : [7, 5, 3, 0][step / 4];
      events.push(tone("result-motif", step, root + 24 + harmonicInterval(lift, chordIndex), 4, .055, scene === "results-win" ? "triangle" : "sine", 0, 3600));
    }
    return freeze(events);
  }

  if (scene === "menu") {
    if (step === 0 || step === 8) events.push(tone("sub", step, root, 4, .035, "sine", 0, 560));
    if (step % 4 === 2) {
      const motif = MUSIC.motifs[Math.floor(random() * MUSIC.motifs.length)];
      events.push(tone("menu-motif", step, root + 24 + harmonicInterval(motif[(step >> 2) % motif.length], chordIndex), 2, .028, "triangle", step % 8 ? .18 : -.18, 2800));
    }
    return freeze(events);
  }

  if (energy >= .15 && MUSIC.bass[step] != null && step % sectionRule.bassDivisor === 0) {
    events.push(tone("bass", step, root + MUSIC.bass[step], step % 4 === 3 ? 1 : 2, .035 + energy * .025, "square", 0, 460 + energy * 460));
  }
  if (sceneRule.percussion && energy >= .2 && (sectionRule.kick.includes(step) || (fillBar && step === 13 && random() > .48))) {
    events.push(tone("kick", step, 45, 2, .075 + energy * .035, "sine", 0, 180));
  }
  if (sceneRule.percussion && energy >= .3 && MUSIC.snare[step]) {
    events.push(noise("snare", step, 2, .048 + energy * .025, 1650));
    events.push(tone("snare-body", step, 54, 1, .026, "triangle", 0, 520));
    if (energy >= .72) events.push(noise("clap", step, 2, .022 + energy * .012, 3200, step === 4 ? -.09 : .09));
  }
  const hatInterval = sectionRule.hat && energy >= .72 ? Math.min(2, sectionRule.hat) : sectionRule.hat || 99;
  if (sceneRule.percussion && energy >= .42 && step % hatInterval === (hatInterval === 2 ? 1 : 2)) {
    const open = energy >= .86 && (step === 7 || (fillBar && step === 15));
    events.push(noise(open ? "open-hat" : "hat", step, open ? 3 : 1, .018 + energy * .012, 7200, step % 4 ? .32 : -.32));
  }
  if (energy >= .45 && step % 2 === 0 && section.name !== "breakdown" && !([6, 14].includes(step) && bar % 2)) {
    const direction = seededMusicChoice([1, -1], `${seed}:arp:${bar}`);
    const index = direction > 0 ? (step / 2) % chord.length : chord.length - 1 - ((step / 2) % chord.length);
    const octave = section.name === "drop" && step >= 8 ? 12 : 0;
    events.push(tone("arp", step, root + 24 + harmonicInterval(chord[index], chordIndex) + octave, 1, .018 + energy * .015, "triangle", step % 4 ? .24 : -.24, 3400 + energy * 2200));
  }
  const leadRhythm = LEAD_RHYTHMS[Math.floor(bar / 2) % LEAD_RHYTHMS.length];
  if (sceneRule.lead && energy >= .8 && !["intro", "breakdown"].includes(section.name) && leadRhythm.includes(step)) {
    const motif = seededMusicChoice(MUSIC.motifs, `${seed}:motif:${Math.floor(bar / 8)}`);
    const phraseIndex = leadRhythm.indexOf(step) + (bar % 2) * 3;
    events.push(tone("lead", step, root + 24 + harmonicInterval(motif[phraseIndex % motif.length], chordIndex), step >= 12 ? 3 : 2, .03 + energy * .02, "sawtooth", step % 2 ? .12 : -.12, 4200));
  }
  if (sceneRule.lead && energy >= .92 && section.name === "drop" && [5, 13].includes(step)) {
    const answer = harmonicInterval(chord[(bar + step) % chord.length], chordIndex);
    events.push(tone("counterlead", step, root + 36 + answer, 2, .022, "triangle", step === 5 ? -.28 : .28, 5200));
  }
  if (energy >= .72 && fillBar && step === 12 && ["b", "drop"].includes(section.name)) {
    events.push(noise("riser", step, 4, .045, 4800));
  }
  if (sceneRule.percussion && energy >= .74 && fillBar && [13, 14, 15].includes(step)) {
    events.push(tone("tom", step, 50 - (step - 13) * 4, 1, .037 + energy * .012, "sine", (step - 14) * .18, 720));
  }
  if (section.name === "resolve" && bar % 32 === 31 && step === 12) {
    events.push(tone("cadence", step, MUSIC.tonicMidi + 36, 4, .06, "triangle", 0, 3600));
  }
  return freeze(events);
}

export function musicEventsForBar(input = {}) {
  const events = [];
  for (let step = 0; step < MUSIC.stepsPerBar; step++) events.push(...musicEventsForStep({ ...input, step }));
  return freeze(events);
}
