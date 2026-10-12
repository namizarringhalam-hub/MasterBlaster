import assert from "node:assert/strict";
import { RemoteSnapshots } from "../src/remoteSnapshots.js";

const state = (x, { vx = 0, aim = { x: 0, y: 0, z: 1 }, lifeSequence = 1, grounded = true } = {}) => ({
  position: { x, y: 0, z: 0 }, velocity: { x: vx, y: 0, z: 0 }, aim, lifeSequence, grounded
});

// Arrival jitter must not change the server-time interpolation path.
const jitter = new RemoteSnapshots(100, 8);
assert.equal(jitter.push(state(0), 1000, 1100), true);
assert.equal(jitter.push(state(10), 1100, 1235), true, "a late packet is retained despite transport jitter");
assert.equal(jitter.push(state(30), 1200, 1320), true, "a newer packet arriving late is retained");
const middle = jitter.sample(1250); // 1050ms server-time target
assert.ok(Math.abs(middle.position.x - 5) < .02, "remote pose interpolates between timestamped snapshots");
const later = jitter.sample(1300); // 1100ms target
assert.ok(Math.abs(later.position.x - 10) < .02);
assert.ok(jitter.sample(1200).position.x >= later.position.x,
  "a delayed render timestamp cannot move the presentation clock backwards");
assert.equal(jitter.push(state(9), 1099, 1300), false, "old/out-of-order snapshots are rejected");

// A brief missing-packet gap coasts from velocity, then caps at 100ms.
const gap = new RemoteSnapshots(100, 8);
gap.push(state(2, { vx: 10 }), 1000, 1100);
assert.equal(gap.sample(1200).position.x, 2, "the configured delay holds the last state at its timestamp");
assert.equal(gap.sample(1300).position.x, 3, "a short gap coasts at the last authoritative velocity");
assert.equal(gap.sample(1800).position.x, 3, "coasting stops after 100ms rather than extrapolating indefinitely");

// Life-sequence changes and large spatial jumps reset the interpolation history.
const discontinuity = new RemoteSnapshots(100, 8);
discontinuity.push(state(0), 1000, 1100);
discontinuity.push(state(1), 1100, 1200);
assert.equal(discontinuity.push(state(50, { lifeSequence: 2 }), 1200, 1300), true);
assert.equal(discontinuity.samples.length, 1, "a respawn starts a fresh snapshot timeline");
assert.equal(discontinuity.sample(1300).position.x, 50, "a respawn appears at the new location without blending");
discontinuity.push(state(80, { lifeSequence: 2 }), 1300, 1400);
assert.equal(discontinuity.samples.length, 1, "a teleport also resets the prior trajectory");
assert.equal(discontinuity.sample(1400).position.x, 80);

// Buffer storage stays bounded under a long-lived stream.
const bounded = new RemoteSnapshots(100, 4);
for (let i = 0; i < 20; i++) assert.equal(bounded.push(state(i), 1000 + i * 20, 1100 + i * 20), true);
assert.equal(bounded.samples.length, 4);
assert.equal(bounded.samples.at(-1).state.position.x, 19);

console.log("Remote snapshots buffer jitter, interpolate monotonically, reset discontinuities, coast briefly, and stay bounded.");
