import * as THREE from "three/webgpu";
import { seedFromText } from "./gameData.js";

// Matched albedo/normal/ORM channels: recessed seams, bevel highlights and
// fine brushed grain. Geometry, collision and structural IDs remain untouched.
export function surfaceTextures(seed, repeat, machined = false) {
  const size = 256, tile = machined ? 128 : 64, fastenerInset = machined ? 20 : 6, seedValue = seedFromText(seed);
  const buffers = Array.from({ length: 3 }, () => new Uint8Array(size * size * 4));
  const hash = (x, y) => ((Math.imul(x + seedValue, 374761393) ^ Math.imul(y, 668265263)) >>> 0) % 251 / 251;
  const heights = new Float64Array(tile * tile);
  for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
    const edge = Math.min(x, y, tile - 1 - x, tile - 1 - y);
    const rivet = Math.hypot(Math.min(Math.abs(x - fastenerInset), Math.abs(x - tile + fastenerInset + 1)), Math.min(Math.abs(y - fastenerInset), Math.abs(y - tile + fastenerInset + 1)));
    heights[y * tile + x] = machined
      ? Math.min(1, edge) * .45 - Math.max(0, 1 - rivet / 1.4) * .16
      : Math.min(1, edge / 2.4) * .45 + Math.max(0, 1 - rivet / 1.6) * .25;
  }
  const height = (x, y) => heights[((y + size) % tile) * tile + (x + size) % tile];
  const [diffuse, normals, roughnessData] = buffers;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 4, h = height(x, y);
    const grain = machined ? (hash(x, y) + hash(Math.floor(x / 32), y)) * 1.5 : hash(x, y) * 3 + hash(Math.floor(x / 12), y) * 2;
    const variation = hash(Math.floor(x / tile), Math.floor(y / tile)) * 12;
    const albedo = machined ? (h < .4 ? 145 : 184) + variation * .25 + grain : 154 + h * 52 + variation + grain;
    diffuse[at] = albedo; diffuse[at + 1] = albedo + 3; diffuse[at + 2] = albedo + 7; diffuse[at + 3] = 255;
    const dx = (height(x - 1, y) - height(x + 1, y)) * .7;
    const dy = (height(x, y - 1) - height(x, y + 1)) * .7;
    const length = Math.hypot(dx, dy, 1);
    normals[at] = (dx / length * .5 + .5) * 255; normals[at + 1] = (dy / length * .5 + .5) * 255;
    normals[at + 2] = (1 / length * .5 + .5) * 255; normals[at + 3] = 255;
    const roughness = h < .4 ? 230 : (machined ? 184 : 207) + grain;
    // Linear ORM: occlusion in red, roughness in green, metalness in blue.
    // Seams/fasteners collect dirt; exposed plates retain the authored finish.
    roughnessData[at] = h < .4 ? 165 + h * 180 : 255;
    roughnessData[at + 1] = roughness;
    roughnessData[at + 2] = h < .4 ? 145 + h * 180 : 244 + grain;
    roughnessData[at + 3] = 255;
  }
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
let sharedMaps;
export function surfaceMaps(textures) {
  if (!textures) return sharedMaps ??= surfaceMaps(surfaceTextures("machined-details", 1, true));
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
