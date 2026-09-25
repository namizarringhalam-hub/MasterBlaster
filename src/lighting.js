import * as THREE from "three/webgpu";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const LIGHTING = {
  // Set to "/assets/textures/equirectangular.hdr" after adding the asset under public/.
  // An empty URL uses the generated HDR room, with no network dependency.
  hdrUrl: "",
  exposure: 1.0,
  environmentIntensity: .7,
  shadowBias: -.0005,
  shadowNormalBias: .02,
  shadowPadding: 2
};

// Fit once per arena, not per frame, so moving players cannot shimmer the map.
export function fitArenaShadow(light, { size, height }) {
  const padding = LIGHTING.shadowPadding;
  const bounds = new THREE.Box3(
    new THREE.Vector3(-size, -1, -size),
    new THREE.Vector3(size, height + 4, size)
  );
  const direction = light.position.clone().sub(light.target.position).normalize();
  bounds.getCenter(light.target.position);
  // Keep the entire playable volume in front of the light, preserving sun angle.
  light.position.copy(light.target.position).addScaledVector(direction,
    bounds.getSize(new THREE.Vector3()).length() / 2 + padding + 1);
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  light.shadow.updateMatrices(light);
  const camera = light.shadow.camera;
  bounds.applyMatrix4(camera.matrixWorldInverse);
  Object.assign(camera, {
    left: bounds.min.x - padding, right: bounds.max.x + padding,
    bottom: bounds.min.y - padding, top: bounds.max.y + padding,
    near: Math.max(.1, -bounds.max.z - padding), far: -bounds.min.z + padding
  });
  camera.updateProjectionMatrix();
  light.shadow.updateMatrices(light);
}

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
