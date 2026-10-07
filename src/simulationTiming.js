import * as THREE from "three/webgpu";

export class SimulationTiming {
  constructor(step = 1 / 60, maxSteps = 15) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.reset();
  }

  reset() { this.accumulator = this.steps = this.dropped = 0; }

  advance(elapsed, update) {
    elapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const total = this.accumulator + elapsed;
    // ponytail: cap catch-up at 250ms, never replay a long suspended frame.
    this.accumulator = Math.min(total, this.step * this.maxSteps);
    this.dropped = total - this.accumulator;
    this.steps = 0;
    while (this.accumulator + 1e-10 >= this.step && this.steps < this.maxSteps) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      const realDt = this.step + (this.steps === 0 ? this.dropped : 0);
      this.steps++;
      if (update(this.step, realDt) === false) { this.accumulator = 0; break; }
    }
    return this.steps;
  }

  get alpha() { return Math.min(1, this.accumulator / this.step); }
}

// Presentation temporarily blends root transforms; physics keeps its own positions.
export class RenderInterpolation {
  constructor() { this.transforms = new Map(); }

  clear() { this.transforms.clear(); }

  capture(objects) {
    for (const object of this.transforms.keys()) if (!objects.has(object)) this.transforms.delete(object);
    for (const object of objects) {
      let state = this.transforms.get(object);
      if (!state) {
        state = { previous: new THREE.Vector3(), previousRotation: new THREE.Quaternion(),
          current: new THREE.Vector3(), currentRotation: new THREE.Quaternion() };
        this.transforms.set(object, state);
      }
      state.previous.copy(object.position);
      state.previousRotation.copy(object.quaternion);
    }
  }

  apply(alpha) {
    for (const [object, state] of this.transforms) {
      state.current.copy(object.position);
      state.currentRotation.copy(object.quaternion);
      // Respawns/teleports should appear at the destination immediately.
      if (state.previous.distanceToSquared(state.current) <= 64) {
        object.position.lerpVectors(state.previous, state.current, alpha);
        object.quaternion.slerpQuaternions(state.previousRotation, state.currentRotation, alpha);
      }
      object.updateMatrix();
    }
  }

  restore() {
    for (const [object, state] of this.transforms) {
      object.position.copy(state.current);
      object.quaternion.copy(state.currentRotation);
      object.updateMatrix();
    }
  }
}
