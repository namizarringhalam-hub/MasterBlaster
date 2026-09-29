import { surfaceTextureData } from "./surfaceTextureData.js";
import { generatedResource } from "./generatedResourceStore.js";

self.onmessage = async ({ data: entries }) => {
  try {
    for (const [seed, machined, finish] of entries) {
      const buffers = await generatedResource(["surface", seed, machined, finish],
        () => surfaceTextureData(seed, machined, finish),
        value => Array.isArray(value) && value.length === 3 && value.every(data => data instanceof Uint8Array && data.length === 256 * 256 * 4));
      self.postMessage({ key: JSON.stringify([seed, machined, finish]), buffers }, buffers.map(data => data.buffer));
    }
    self.postMessage({ done: true });
  } catch { self.postMessage({ error: true }); }
};
