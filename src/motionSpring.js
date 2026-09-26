// Closed-form damped motion stays stable across frame rates and long frames.
export function advanceSpring(state, target, dt, frequency = 18, damping = .72) {
  if (!(dt > 0)) return state.value;
  const elapsed = Math.min(dt, .25), decay = Math.exp(-damping * frequency * elapsed);
  const oscillation = frequency * Math.sqrt(1 - damping * damping);
  const displacement = state.value - target;
  const phase = oscillation * elapsed, cosine = Math.cos(phase), sine = Math.sin(phase);
  const coefficient = (state.velocity + damping * frequency * displacement) / oscillation;
  state.value = target + decay * (displacement * cosine + coefficient * sine);
  state.velocity = decay * (state.velocity * cosine - (damping * frequency * coefficient + oscillation * displacement) * sine);
  return state.value;
}
