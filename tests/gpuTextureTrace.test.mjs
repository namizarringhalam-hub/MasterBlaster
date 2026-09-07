import assert from "node:assert/strict";
import { installGPUTextureUseTrace } from "./gpuTextureTrace.js";

const calls = [], info = { calls: 1 };
const device = {
  createTexture(descriptor) {
    assert.equal(this, device); calls.push(descriptor);
    return { createView: descriptor => ({ descriptor }), destroy: () => "destroyed" };
  },
  createBindGroup: descriptor => ({ descriptor }),
  createRenderBundleEncoder: () => ({ setBindGroup() {}, finish: () => ({}) }),
  createCommandEncoder: () => ({
    beginRenderPass: descriptor => ({ descriptor, setBindGroup() {}, executeBundles() {} }),
    beginComputePass: () => ({ setBindGroup() {} }), finish: () => ({})
  }),
  queue: { submit(buffers) { assert.equal(this, device.queue); calls.push(buffers); return "submitted"; } }
};
const state = { serial: 0, checked: 0, dropped: 0, untracked: 0, stale: [] };
const renderer = { backend: { device }, info, copyFramebufferToTexture(...args) {
  assert.equal(this, renderer); calls.push(args); return "copied";
} };
installGPUTextureUseTrace(renderer, state);
assert.equal(renderer.copyFramebufferToTexture("texture", "viewport"), "copied");
assert.deepEqual(calls.pop(), ["texture", "viewport"]); assert.equal(state.copies, 1);
const descriptor = { label: "old output", format: "rgba16float", size: { width: 390, height: 844 } };
const texture = device.createTexture(descriptor), view = texture.createView({ label: "sampled" });
assert.equal(calls[0], descriptor, "diagnostics cannot modify texture descriptors");
const group = device.createBindGroup({ entries: [{ binding: 0, resource: view }] });
const encoder = device.createCommandEncoder({ label: "frame" });
const pass = encoder.beginRenderPass({ colorAttachments: [{ view, resolveTarget: view }], depthStencilAttachment: { view } });
pass.setBindGroup(0, group);
const bundleEncoder = device.createRenderBundleEncoder({}); bundleEncoder.setBindGroup(0, group);
pass.executeBundles([bundleEncoder.finish()]);
const commands = [encoder.finish()];
assert.equal(device.queue.submit(commands), "submitted");
assert.equal(calls.at(-1), commands, "submission identity is preserved");
assert.equal(state.stale.length, 0);
info.calls = 2; assert.equal(texture.destroy(), "destroyed");
info.calls = 3; device.queue.submit(commands);
assert.equal(state.stale.length, 1);
assert.deepEqual(state.stale[0].uses.sort(), ["bind-group", "color", "depth", "resolve"]);
assert.equal(state.stale[0].texture.created.calls, 1);
assert.equal(state.stale[0].texture.destroyed.calls, 2);
assert.equal(state.stale[0].calls, 3); assert.equal(state.stale[0].command, "frame");
assert.notEqual(state.stale[0].texture.size, descriptor.size);
for (let i = 0; i < 70; i++) device.queue.submit(commands);
assert.equal(state.stale.length, 64); assert.equal(state.dropped, 7);
assert.equal(state.untracked, 0);
const compute = device.createCommandEncoder({ label: "compute" });
compute.beginComputePass().setBindGroup(1, group); device.queue.submit([compute.finish()]);
assert.deepEqual(state.stale.at(-1).uses, ["bind-group"]);
console.log("GPU texture trace preserves calls and detects destroyed attachment, sampled and bundled views.");
