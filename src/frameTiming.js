// Bounded recent frame tails; totals and worst stalls cover the whole match.
export class FrameTiming {
  constructor(capacity = 600) {
    this.intervals = new Float64Array(capacity);
    this.updates = new Float64Array(capacity);
    this.renders = new Float64Array(capacity);
    this.elapsed = this.frames = this.windowElapsed = this.windowFrames = 0;
    this.fps = this.worstMs = this.longFrames = this.stallFrames = 0;
    this.updateTotal = this.renderTotal = this.simulationSteps = this.droppedSimulationMs = 0;
    this.longTasks = this.longTaskMs = 0;
    this.minimum = Infinity;
  }

  record(dt, updateMs = 0, renderMs = 0, steps = 0, dropped = 0) {
    if (!(dt > 0) || !Number.isFinite(dt)) return false;
    const index = this.frames % this.intervals.length, ms = dt * 1000;
    this.intervals[index] = ms;
    this.updates[index] = Math.max(0, updateMs);
    this.renders[index] = Math.max(0, renderMs);
    this.elapsed += dt;
    this.frames++;
    this.windowElapsed += dt;
    this.windowFrames++;
    this.worstMs = Math.max(this.worstMs, ms);
    if (ms > 1000 / 30 + .001) this.longFrames++;
    if (ms > 50) this.stallFrames++;
    this.updateTotal += Math.max(0, updateMs);
    this.renderTotal += Math.max(0, renderMs);
    this.simulationSteps += steps;
    this.droppedSimulationMs += dropped * 1000;
    if (this.windowElapsed < 1) return false;
    this.fps = this.windowFrames / this.windowElapsed;
    this.minimum = Math.min(this.minimum, this.fps);
    this.windowElapsed = this.windowFrames = 0;
    return true;
  }

  snapshot() {
    const count = Math.min(this.frames, this.intervals.length);
    const sorted = values => Array.from(values.subarray(0, count)).sort((a, b) => a - b);
    const intervals = sorted(this.intervals), updates = sorted(this.updates), renders = sorted(this.renders);
    const percentile = (values, p) => values[Math.max(0, Math.ceil(values.length * p) - 1)] || 0;
    return {
      frames: this.frames, elapsed: this.elapsed, recentFrames: count, fps: this.fps,
      averageFps: this.elapsed ? this.frames / this.elapsed : 0,
      minimumFps: Number.isFinite(this.minimum) ? this.minimum : 0,
      medianMs: percentile(intervals, .5), p95Ms: percentile(intervals, .95), p99Ms: percentile(intervals, .99),
      worstMs: this.worstMs, longFrames: this.longFrames, stallFrames: this.stallFrames,
      updateMs: this.frames ? this.updateTotal / this.frames : 0,
      renderMs: this.frames ? this.renderTotal / this.frames : 0,
      updateP95Ms: percentile(updates, .95), renderP95Ms: percentile(renders, .95),
      simulationSteps: this.simulationSteps, droppedSimulationMs: this.droppedSimulationMs,
      longTasks: this.longTasks, longTaskMs: this.longTaskMs
    };
  }
}
