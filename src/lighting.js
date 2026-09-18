import * as THREE from "three/webgpu";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const LIGHTING = {
  // Set to "/assets/textures/equirectangular.hdr" after adding the asset under public/.
  // An empty URL uses the generated HDR room, with no network dependency.
  hdrUrl: "",
  exposure: 1.0,
  environmentIntensity: .82
};

// Call after renderer.init(), before constructing the world: its selectively
// tuned materials retain references to this same environment texture.
export async function setupEnvironment(renderer, scene, { hdrUrl = LIGHTING.hdrUrl,
  environmentIntensity = LIGHTING.environmentIntensity } = {}) {
  let environment;
  if (hdrUrl) {
    try {
      // HDRLoader is the current name for RGBELoader in Three r185.
      const texture = await new HDRLoader().loadAsync(hdrUrl);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      environment = { texture, dispose: () => texture.dispose() };
    } catch (error) {
      console.warn("HDR environment unavailable; using the generated room lighting.", error);
    }
  }
  if (!environment) {
    const generator = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    try {
      environment = generator.fromScene(room, .04);
    } finally {
      room.dispose();
      generator.dispose();
    }
  }
  // Three prepares roughness-dependent IBL automatically for equirectangular HDRs.
  // Generated rooms already have CubeUV mapping; do not relabel their PMREM.
  scene.environment = environment.texture;
  scene.environmentIntensity = environmentIntensity;
  return environment;
}
