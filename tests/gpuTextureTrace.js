// Opt-in QA only. Weak keys and copied metadata never retain GPU resources.
// This identifies stale native views; traced runs are not FPS benchmarks.
export function installGPUTextureUseTrace(renderer, state) {
  const device = renderer.backend.device;
  const copy = renderer.copyFramebufferToTexture;
  if (copy) renderer.copyFramebufferToTexture = function (...args) {
    state.copies = (state.copies || 0) + 1; return copy.apply(this, args);
  };
  const textures = new WeakMap(), views = new WeakMap(), groups = new WeakMap(), buffers = new WeakMap();
  let currentDraw = null;
  const backend = renderer.backend, draw = backend.draw;
  if (draw) backend.draw = function (object, ...args) {
    const previous = currentDraw;
    currentDraw = { object: object.object.name, material: object.material.type,
      bindings: object.getBindings().flatMap(group => group.bindings.filter(binding => binding.isSampledTexture).map(binding => ({
        name: binding.name, textureId: binding.texture?.id, version: binding.texture?.version,
        bindingVersion: binding.version, generation: binding.generation, nodeTextureId: binding.textureNode?.value?.id,
        gpuId: binding.texture ? textures.get(backend.get(binding.texture).texture)?.id : null
      }))) };
    try { return draw.call(this, object, ...args); } finally { currentDraw = previous; }
  };
  const createTexture = device.createTexture;
  device.createTexture = function (descriptor) {
    const texture = createTexture.call(this, descriptor);
    const entry = { id: ++state.serial, label: descriptor.label || "", format: descriptor.format,
      size: { ...descriptor.size }, samples: descriptor.sampleCount ?? 1,
      created: { calls: renderer.info.calls, stack: new Error().stack }, destroyed: null };
    textures.set(texture, entry);
    const createView = texture.createView, destroy = texture.destroy;
    texture.createView = function (...args) {
      const view = createView.apply(this, args); views.set(view, entry); return view;
    };
    texture.destroy = function (...args) {
      const result = destroy.apply(this, args);
      entry.destroyed = { calls: renderer.info.calls, stack: new Error().stack }; return result;
    };
    return texture;
  };
  const createBindGroup = device.createBindGroup;
  device.createBindGroup = function (descriptor) {
    const group = createBindGroup.call(this, descriptor), entries = [];
    if (Array.isArray(descriptor.entries)) {
      for (const binding of descriptor.entries) {
        const entry = views.get(binding.resource); if (entry) entries.push(entry);
      }
    } else state.untracked++;
    groups.set(group, entries); return group;
  };
  function use(used, entry, kind) {
    if (!entry) return;
    if (!used.has(entry)) used.set(entry, new Set());
    used.get(entry).add(kind);
  }
  function trackBindings(encoder, used) {
    const bind = encoder.setBindGroup;
    encoder.setBindGroup = function (...args) {
      const result = bind.apply(this, args);
      for (const entry of groups.get(args[1]) || []) {
        use(used, entry, "bind-group"); entry.lastBoundBy = currentDraw;
      }
      return result;
    };
  }
  function trackFinish(encoder, used, label) {
    const finish = encoder.finish;
    encoder.finish = function (...args) {
      const buffer = finish.apply(this, args); buffers.set(buffer, { used, label }); return buffer;
    };
  }
  const createBundle = device.createRenderBundleEncoder;
  device.createRenderBundleEncoder = function (...args) {
    const encoder = createBundle.apply(this, args), used = new Map();
    trackBindings(encoder, used); trackFinish(encoder, used, args[0]?.label || "bundle"); return encoder;
  };
  const createEncoder = device.createCommandEncoder;
  device.createCommandEncoder = function (...args) {
    const encoder = createEncoder.apply(this, args), used = new Map();
    const beginRenderPass = encoder.beginRenderPass, beginComputePass = encoder.beginComputePass;
    encoder.beginRenderPass = function (descriptor) {
      const pass = beginRenderPass.call(this, descriptor);
      if (Array.isArray(descriptor.colorAttachments)) {
        for (const attachment of descriptor.colorAttachments) {
          use(used, views.get(attachment?.view), "color");
          use(used, views.get(attachment?.resolveTarget), "resolve");
        }
      } else state.untracked++;
      use(used, views.get(descriptor.depthStencilAttachment?.view), "depth");
      trackBindings(pass, used);
      const execute = pass.executeBundles;
      pass.executeBundles = function (bundles) {
        const result = execute.call(this, bundles);
        if (Array.isArray(bundles)) {
          for (const bundle of bundles) for (const [entry, kinds] of buffers.get(bundle)?.used || []) {
            for (const kind of kinds) use(used, entry, kind);
          }
        } else state.untracked++;
        return result;
      };
      return pass;
    };
    encoder.beginComputePass = function (...args) {
      const pass = beginComputePass.apply(this, args); trackBindings(pass, used); return pass;
    };
    trackFinish(encoder, used, args[0]?.label || ""); return encoder;
  };
  const submit = device.queue.submit;
  device.queue.submit = function (commands) {
    if (Array.isArray(commands)) {
      for (const command of commands) {
        const recorded = buffers.get(command);
        if (!recorded) { state.untracked++; continue; }
        state.checked++;
        for (const [entry, kinds] of recorded.used) if (entry.destroyed) {
          state.stale.push({ calls: renderer.info.calls, command: recorded.label, uses: [...kinds],
            texture: { ...entry }, submitStack: new Error().stack });
          if (state.stale.length > 64) { state.stale.shift(); state.dropped++; }
        }
      }
    } else state.untracked++;
    return submit.call(this, commands);
  };
}
