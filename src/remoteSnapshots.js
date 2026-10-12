// Server-time interpolation isolates remote presentation from 20 Hz delivery
// jitter. No gameplay authority or local player state lives in this buffer.
export class RemoteSnapshots {
  constructor(delay = 100, capacity = 32) {
    this.delay = delay;
    this.capacity = capacity;
    this.samples = [];
    this.offset = null;
    this.cursor = -Infinity;
    this.output = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, aim: { x: 0, y: 0, z: 1 }, grounded: false };
  }

  reset() { this.samples.length = 0; this.offset = null; this.cursor = -Infinity; }

  push(state, serverTime, receivedAt = performance.now()) {
    if (!state?.position || ![state.position.x, state.position.y, state.position.z, serverTime, receivedAt].every(Number.isFinite)) return false;
    let previous = this.samples.at(-1);
    if (previous && serverTime <= previous.time) return false;
    const teleported = previous && Math.hypot(state.position.x - previous.state.position.x, state.position.y - previous.state.position.y, state.position.z - previous.state.position.z) > 20;
    if (previous && (state.lifeSequence !== previous.state.lifeSequence || teleported)) { this.reset(); previous = null; }
    const observedOffset = receivedAt - serverTime;
    // Best recent transport offset keeps one delayed packet from shifting time.
    this.offset = this.offset === null ? observedOffset : Math.min(observedOffset, this.offset + .05);
    this.samples.push({ state, time: serverTime });
    if (this.samples.length > this.capacity) this.samples.shift();
    return true;
  }

  sample(now = performance.now()) {
    if (!this.samples.length) return null;
    const time = this.cursor = Math.max(this.cursor, now - this.offset - this.delay);
    while (this.samples.length > 2 && this.samples[1].time <= time) this.samples.shift();
    const a = this.samples[0];
    let b = a;
    for (let i = 1; i < this.samples.length; i++) {
      b = this.samples[i];
      if (b.time >= time) break;
    }
    const alpha = b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 0;
    const out = this.output;
    for (const key of ["position", "velocity", "aim"]) {
      const left = a.state[key] || (key === "aim" ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: 0 });
      const right = b.state[key] || left;
      for (const axis of ["x", "y", "z"]) out[key][axis] = left[axis] + (right[axis] - left[axis]) * alpha;
    }
    const length = Math.hypot(out.aim.x, out.aim.y, out.aim.z) || 1;
    out.aim.x /= length; out.aim.y /= length; out.aim.z /= length;
    // Brief packet gaps coast for at most two ticks, then hold; never run away.
    const coast = Math.max(0, Math.min(100, time - b.time)) / 1000;
    out.position.x += out.velocity.x * coast;
    out.position.y += out.velocity.y * coast;
    out.position.z += out.velocity.z * coast;
    out.grounded = (alpha < 1 ? a.state : b.state).grounded;
    return out;
  }
}
