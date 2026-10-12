import * as THREE from "three/webgpu";
import { color, equirectUV, mix, normalWorldGeometry, positionWorld, smoothstep, texture, uniform, vec2 } from "three/tsl";

// Integrate the cloud volume once under the loader. The two slowly drifting
// radiance layers retain volumetric self-shadowing without marching every sky
// fragment every frame. Immutable maps are shared across rematches.
const cache = new Map();
const blend = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const sx = smooth(0, 1, x - ix), sy = smooth(0, 1, y - iy), sz = smooth(0, 1, z - iz);
  const h = (dx, dy, dz) => ((Math.imul(ix + dx, 374761393) ^ Math.imul(iy + dy, 668265263) ^ Math.imul(iz + dz, 2147483647)) >>> 0) / 4294967295;
  return blend(blend(blend(h(0, 0, 0), h(1, 0, 0), sx), blend(h(0, 1, 0), h(1, 1, 0), sx), sy),
    blend(blend(h(0, 0, 1), h(1, 0, 1), sx), blend(h(0, 1, 1), h(1, 1, 1), sx), sy), sz);
}
function density(x, y, z) {
  const qx = x * .006, qy = y * .006, qz = z * .006;
  const shape = noise(qx, qy, qz) * .62 + noise(qx * 2.07, qy * 2.07, qz * 2.07) * .28 + noise(qx * 4.13, qy * 4.13, qz * 4.13) * .1;
  return smooth(.38, .63, shape) * smooth(140, 159, y) * (1 - smooth(196, 220, y));
}
function dataTexture(data, width, height, name, type = THREE.UnsignedByteType) {
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, type);
  map.name = name; map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  return map;
}
export function createCloudAtmosphere(theme) {
  if (cache.has(theme.id)) return cache.get(theme.id);
  const width = 512, height = 128, bytes = new Uint16Array(width * height * 4);
  const dark = new THREE.Color(0x02050c), blue = new THREE.Color(0x0b2335);
  const cyan = new THREE.Color(0x125d85), pink = new THREE.Color(0x642550);
  const shade = new THREE.Color(0x173049), light = new THREE.Color(0x8dacc3);
  const darkRGB = dark.toArray(), blueRGB = blue.toArray(), cyanRGB = cyan.toArray(), pinkRGB = pink.toArray(), shadeRGB = shade.toArray(), lightRGB = light.toArray();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const elevation = ((y + .5) / height - .5) * Math.PI, angle = ((x + .5) / width - .5) * Math.PI * 2;
    const dy = Math.sin(elevation), dx = Math.cos(elevation) * Math.cos(angle), dz = Math.cos(elevation) * Math.sin(angle);
    const cg = Math.max(0, dx * -.553 + dy * .282 + dz * -.784) ** 9 * .55;
    const pg = Math.max(0, dx * .815 + dy * .143 + dz * .561) ** 15 * .3;
    const base = darkRGB.map((v, i) => v + blueRGB[i] * Math.exp(-Math.max(0, dy) * 5) * .35 + cyanRGB[i] * cg * .6 + pinkRGB[i] * pg * .6);
    let transmittance = 1;
    const scatter = [0, 0, 0];
    if (dy > .035) {
      const stride = 80 / dy / 12, start = 105 / dy;
      for (let step = 0; step < 12; step++) {
        const distance = start + (step + .5) * stride, px = dx * distance, py = 35 + dy * distance, pz = dz * distance;
        const amount = density(px, py, pz), extinction = Math.exp(-amount * stride * .038);
        const lit = Math.exp(-density(px - 11, py + 20, pz + 9) * 2.5);
        for (let c = 0; c < 3; c++) scatter[c] += (blend(shadeRGB[c], lightRGB[c], lit) * .18 + cyanRGB[c] * cg * .14 + pinkRGB[c] * pg * .14) * (1 - extinction) * transmittance;
        transmittance *= extinction;
      }
    }
    const at = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) bytes[at + c] = THREE.DataUtils.toHalfFloat(blend(base[c], base[c] * transmittance + scatter[c], smooth(.035, .3, dy)));
    bytes[at + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const panorama = dataTexture(bytes, width, height, "Cached integrated cloud radiance", THREE.HalfFloatType);
  const shadowSize = 128, shadowBytes = new Uint8Array(shadowSize * shadowSize * 4);
  for (let y = 0; y < shadowSize; y++) for (let x = 0; x < shadowSize; x++) {
    // Periodic four-corner interpolation makes scrolling tile edges seamless.
    const u = x / shadowSize, v = y / shadowSize;
    const field = (dx, dz) => density((u + dx) * 512, 176, (v + dz) * 512);
    const value = blend(blend(field(0, 0), field(-1, 0), u), blend(field(0, -1), field(-1, -1), u), v);
    const at = (y * shadowSize + x) * 4; shadowBytes.fill(Math.round(value * 255), at, at + 3); shadowBytes[at + 3] = 255;
  }
  const shadowTexture = dataTexture(shadowBytes, shadowSize, shadowSize, "Scrolling cloud occlusion");
  shadowTexture.wrapT = THREE.RepeatWrapping;
  const clock = uniform(0), steps = uniform(12, "int"), lightning = uniform(0);
  const coordinates = equirectUV(normalWorldGeometry);
  const drift = vec2(clock.mul(.0007), 0);
  const radiance = mix(texture(panorama, coordinates.add(drift)).rgb, texture(panorama, coordinates.sub(drift.mul(.37))).rgb, .24);
  const sky = mix(color(0x02050c), radiance, steps.greaterThan(0).select(1, .48)).add(color(0x7994c0).mul(lightning).mul(smoothstep(-.05, .4, normalWorldGeometry.y)));
  const shadow = texture(shadowTexture, positionWorld.xz.add(vec2(clock.mul(.7), clock.mul(.3))).div(512)).r.mul(-.16).add(1);
  const result = { sky, shadow: mix(1, shadow, steps.greaterThan(0).select(1, 0)), clock, steps, lightning, panorama, shadowTexture };
  cache.set(theme.id, result);
  return result;
}
