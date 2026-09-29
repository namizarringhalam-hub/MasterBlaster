import * as THREE from "three/webgpu";
import { surfaceTextureData } from "./surfaceTextureData.js";
import { backgroundYield } from "./resourceVersion.js";

const preparedData = new Map();
let preparing = Promise.resolve();

export function prepareSurfaceTextures(seeds = [], report = () => {}) {
  const entries = [
    ...["metal", "concrete", "rubber", "glass"].map(finish => [`machined-${finish}`, true, finish]),
    ...seeds.flatMap(seed => [[`${seed}-structure`, false, "metal"], [`${seed}-ground`, false, "concrete"], [`${seed}-cover`, true, "metal"]])
  ];
  preparing = preparing.catch(() => {}).then(async () => {
    const missing = entries.filter(entry => !preparedData.has(JSON.stringify(entry)));
    let complete = entries.length - missing.length;
    report(complete, entries.length);
    const accept = (key, buffers) => {
      preparedData.set(key, buffers);
      // Bound random-arena CPU data; active DataTextures retain their own arrays.
      while (preparedData.size > 20) preparedData.delete(preparedData.keys().next().value);
      report(++complete, entries.length);
    };
    if (missing.length && typeof Worker !== "undefined") {
      try {
        await new Promise((resolve, reject) => {
          const worker = new Worker(new URL("./surfaceTextures.worker.js", import.meta.url), { type: "module" });
          const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Texture preparation timed out")); }, 60000);
          const finish = error => { clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(); };
          worker.onerror = () => finish(new Error("Texture worker failed"));
          worker.onmessage = ({ data }) => {
            if (data.error) finish(new Error("Texture generation failed"));
            else if (data.done) finish();
            else accept(data.key, data.buffers);
          };
          worker.postMessage(missing);
        });
      } catch {
        for (const entry of missing) if (!preparedData.has(JSON.stringify(entry))) {
          await backgroundYield();
          accept(JSON.stringify(entry), surfaceTextureData(...entry));
        }
      }
    } else for (const entry of missing) {
      await backgroundYield();
      accept(JSON.stringify(entry), surfaceTextureData(...entry));
    }
    for (const finish of ["metal", "concrete", "rubber", "glass"]) surfaceMaps(finish);
  });
  return preparing;
}

export function sharedSurfaceTextures() {
  return [...new Set([...sharedMaps.values()].flatMap(maps => Object.values(maps)))];
}

// Matched albedo/normal/ORM channels: recessed seams, bevel highlights and
// fine brushed grain. Geometry, collision and structural IDs remain untouched.
export function surfaceTextures(seed, repeat, machined = false, finish = "metal") {
  const size = 256;
  const key = JSON.stringify([seed, machined, finish]);
  const buffers = preparedData.get(key) || surfaceTextureData(seed, machined, finish);
  return buffers.map((data, index) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.name = `${seed}-${["albedo", "normal", "orm"][index]}`;
    texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.generateMipmaps = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  });
}

// One immutable default set lives for the module lifetime, shared by fighters,
// projectiles and small arena details. Arena-specific sets keep arena ownership.
const sharedMaps = new Map();
export function surfaceMaps(textures) {
  if (!textures || typeof textures === "string") {
    const finish = textures || "metal";
    if (!sharedMaps.has(finish)) sharedMaps.set(finish, surfaceMaps(surfaceTextures(`machined-${finish}`, 1, true, finish)));
    return sharedMaps.get(finish);
  }
  const [map, normalMap, orm] = textures;
  return { map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm };
}

// Project each triangle onto its dominant plane without changing its normals.
// Custom shells and lathed shrouds otherwise have collapsed side/cap UVs.
export function projectSurfaceUVs(geometry) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  const positions = result.attributes.position, uvs = new Float32Array(positions.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i); b.fromBufferAttribute(positions, i + 1); c.fromBufferAttribute(positions, i + 2);
    b.sub(a).cross(c.sub(a));
    const axis = Math.abs(b.x) > Math.abs(b.y) && Math.abs(b.x) > Math.abs(b.z) ? 0 : Math.abs(b.y) > Math.abs(b.z) ? 1 : 2;
    for (let j = i; j < i + 3; j++) {
      uvs[j * 2] = axis === 0 ? positions.getZ(j) : positions.getX(j);
      uvs[j * 2 + 1] = axis === 1 ? positions.getZ(j) : positions.getY(j);
    }
  }
  result.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return result;
}
