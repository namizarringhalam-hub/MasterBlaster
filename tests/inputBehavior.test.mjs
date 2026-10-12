import assert from "node:assert/strict";
import { InputManager, pointerLookDelta, requestGamePointerLock, touchLookDelta } from "../src/input.js";

assert.deepEqual(pointerLookDelta({ movementX: 140, movementY: -95 }), { x: 140, y: -95 },
  "a deliberately large pointer-lock flick is preserved");
assert.deepEqual(pointerLookDelta({ getCoalescedEvents: () => [
  { movementX: 42, movementY: -14 }, { movementX: NaN, movementY: 10 }, { movementX: -7, movementY: Infinity }
] }), { x: 35, y: -4 }, "coalesced movement sums finite samples and rejects malformed axes");
assert.deepEqual(touchLookDelta(0, 0, 180, -120), { x: 630, y: -420 },
  "touch look also preserves a deliberate large movement instead of clamping it");
assert.deepEqual(touchLookDelta(0, 0, Infinity, 4), { x: 0, y: 14 }, "invalid touch axes are rejected independently");

const calls = [];
const canvas = {
  tabIndex: 0,
  listeners: new Map(),
  addEventListener(type, listener) { this.listeners.set(type, listener); },
  requestPointerLock(options) {
    calls.push(options);
    if (calls.length === 1) return Promise.reject(Object.assign(new Error("raw movement unsupported"), { name: "NotSupportedError" }));
    return Promise.resolve();
  }
};
requestGamePointerLock(canvas);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(calls, [{ unadjustedMovement: true }, undefined],
  "unsupported raw movement retries with ordinary pointer lock exactly once");

const previousDocument = globalThis.document;
const previousGlobalListener = globalThis.addEventListener;
const documentListeners = new Map(), globalListeners = new Map();
try {
  globalThis.document = {
    pointerLockElement: canvas,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    exitPointerLock() { this.pointerLockElement = null; }
  };
  globalThis.addEventListener = (type, listener) => globalListeners.set(type, listener);
  const input = new InputManager(canvas);
  globalListeners.get("pointermove")({ pointerType: "mouse", movementX: 120, movementY: -90 });
  globalListeners.get("pointermove")({ pointerType: "mouse", getCoalescedEvents: () => [
    { movementX: 45, movementY: 20 }, { movementX: 35, movementY: -15 }
  ] });
  assert.deepEqual(input.consumeLook(), { x: 200, y: -85 }, "locked mouse input preserves full movement across events");
  assert.deepEqual(input.consumeLook(), { x: 0, y: 0 }, "consuming look input clears the accumulated delta");
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousGlobalListener === undefined) delete globalThis.addEventListener;
  else globalThis.addEventListener = previousGlobalListener;
}

console.log("Raw pointer-lock fallback and unclamped/coalesced mouse look pass.");
