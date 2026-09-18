import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three/webgpu";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LIGHTING, setupEnvironment } from "../src/lighting.js";

// Exercise the actual RGBE parser, including highlights above display white.
const hdrBytes = Buffer.concat([
  Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n"),
  Buffer.from([128, 64, 32, 132, 32, 64, 128, 129])
]);
const parsed = new HDRLoader().setDataType(THREE.FloatType).parse(
  hdrBytes.buffer.slice(hdrBytes.byteOffset, hdrBytes.byteOffset + hdrBytes.byteLength));
assert.ok(Math.max(...parsed.data) > 1, "HDR highlights survive decoding");
const texture = new THREE.DataTexture(parsed.data, parsed.width, parsed.height, THREE.RGBAFormat, THREE.FloatType);
const load = mock.method(HDRLoader.prototype, "loadAsync", async url => {
  assert.equal(url, "/assets/textures/equirectangular.hdr");
  return texture;
});
const roomDispose = mock.method(RoomEnvironment.prototype, "dispose");
const generated = new THREE.RenderTarget(16, 16);
generated.texture.mapping = THREE.CubeUVReflectionMapping;
const generate = mock.method(THREE.PMREMGenerator.prototype, "fromScene", room => {
  assert.equal(room.name, "RoomEnvironment");
  return generated;
});
const generatorDispose = mock.method(THREE.PMREMGenerator.prototype, "dispose", () => {});
const scene = new THREE.Scene();
const sky = scene.backgroundNode = { isNode: true };
try {
  const loaded = await setupEnvironment({}, scene, { hdrUrl: "/assets/textures/equirectangular.hdr" });
  assert.equal(scene.environment, texture);
  assert.equal(texture.mapping, THREE.EquirectangularReflectionMapping);
  assert.equal(scene.backgroundNode, sky, "IBL preserves the authored sky");
  assert.equal(generate.mock.callCount(), 0, "successful HDR does not generate a second environment");
  let disposed = false;
  texture.addEventListener("dispose", () => { disposed = true; });
  loaded.dispose();
  assert.ok(disposed, "HDR resource can be released by its owner");

  const offline = await setupEnvironment({}, scene);
  assert.equal(offline, generated);
  assert.equal(load.mock.callCount(), 1, "default offline lighting makes no HTTP request");
  assert.equal(scene.environment.mapping, THREE.CubeUVReflectionMapping);
  load.mock.mockImplementation(async () => { throw new Error("missing or invalid HDR"); });
  const warning = mock.method(console, "warn", () => {});
  assert.equal(await setupEnvironment({}, scene, { hdrUrl: "/bad.hdr", environmentIntensity: .6 }), generated);
  assert.equal(scene.environmentIntensity, .6);
  assert.equal(warning.mock.callCount(), 1);
  assert.equal(roomDispose.mock.callCount(), 2);
  assert.equal(generatorDispose.mock.callCount(), 2);
  generate.mock.mockImplementation(() => { throw new Error("GPU failure"); });
  await assert.rejects(setupEnvironment({}, scene), /GPU failure/);
  assert.equal(roomDispose.mock.callCount(), 3, "temporary room is released even on GPU failure");
  assert.equal(generatorDispose.mock.callCount(), 3);
  assert.equal(LIGHTING.exposure, 1);
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /new THREE\.(AmbientLight|HemisphereLight)/);
  assert.match(source, /toneMapping = THREE\.ACESFilmicToneMapping/);
  assert.match(source, /toneMappingExposure = LIGHTING\.exposure/);
  assert.match(source, /await this\.renderer\.init\(\)[\s\S]*await setupEnvironment[\s\S]*this\.rebuildRenderPipeline\(\)/);
} finally {
  mock.restoreAll();
  generated.dispose();
}
console.log("HDR decoding, scene IBL, offline/error fallback and temporary resource cleanup passed.");
