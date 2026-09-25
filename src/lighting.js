import * as THREE from "three/webgpu";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export const LIGHTING = {
  // Set to "/assets/textures/equirectangular.hdr" after adding the asset under public/.
  // An empty URL uses the generated HDR city, with no network dependency.
  hdrUrl: "",
  exposure: 1.0,
  environmentIntensity: .42,
  shadowBias: -.0005,
  shadowNormalBias: .02,
  shadowPadding: 2
};

// ponytail: bake distant city lighting once into the existing PMREM. This is
// an authored radiance approximation, not a live reflection of arena geometry.
// Moving fighters and destruction reflections belong to the later reflection pass.
export class CityEnvironment extends THREE.Scene {
  constructor() {
    super();
    this.name = "CityEnvironment";
    // Match the previous fill's readability while retaining colored sources.
    const radiance = 2;
    const geometry = new THREE.SphereGeometry(60, 48, 24);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const zenith = new THREE.Color().setRGB(.10, .15, .23);
    const horizon = new THREE.Color().setRGB(.24, .31, .38);
    const ground = new THREE.Color().setRGB(.095, .075, .065);
    const tint = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const elevation = positions.getY(i) / 60;
      tint.copy(horizon).lerp(elevation >= 0 ? zenith : ground, Math.sqrt(Math.abs(elevation)));
      tint.multiplyScalar(radiance).toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, toneMapped: false
    })));

    const panelGeometry = new THREE.PlaneGeometry(1, 1);
    const addPanel = (name, position, size, color, intensity) => {
      const panel = new THREE.Mesh(panelGeometry, new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity * radiance), toneMapped: false
      }));
      panel.name = name;
      panel.position.set(...position);
      panel.scale.set(size[0], size[1], 1);
      panel.lookAt(0, 0, 0);
      this.add(panel);
    };
    // Broad, softened sources follow the cyan/magenta sky glow and warm key.
    // Narrow window bands give polished armor a city-shaped highlight, while
    // PMREM's roughness levels blend them into restrained diffuse fill.
    const districts = [
      { x: -18, z: -25, color: 0x79dfff },
      { x: 25, z: 18, color: 0xf19bc7 },
      { x: -22, z: 18, color: 0xffd3a1 },
      { x: 22, z: -25, color: 0xa6bfff }
    ];
    districts.forEach(({ x, z, color }, district) => {
      addPanel(`District ${district} reflected sign`, [x, 5, z], [3.5, 11], color, 5);
      for (let row = 0; row < 4; row++) {
        addPanel(`District ${district} window band ${row}`,
          [x * 1.08, 2 + row * 3.8, z * .9], [9, .75], color, 2.4);
      }
      // Low radiance from below approximates light returning from the deck.
      // It affects underside normals through IBL without another per-frame light.
      addPanel(`District ${district} ground bounce`, [x * .5, -12, z * .5], [12, 9], color, .28);
    });
    addPanel("Warm key reflection", [-22, 40, 18], [16, 12], 0xffeee0, 2.8);
    addPanel("Cool rim reflection", [22, 15, -25], [8, 14], 0x91bfff, 1.2);
  }

  dispose() {
    const resources = new Set();
    this.traverse(object => {
      if (object.isMesh) { resources.add(object.geometry); resources.add(object.material); }
    });
    for (const resource of resources) resource.dispose();
  }
}

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
      console.warn("HDR environment unavailable; using the generated city lighting.", error);
    }
  }
  if (!environment) {
    const generator = new THREE.PMREMGenerator(renderer);
    const city = new CityEnvironment();
    try {
      environment = generator.fromScene(city, .04);
      environment.texture.name = "City lighting radiance";
    } finally {
      city.dispose();
      generator.dispose();
    }
  }
  // Three prepares roughness-dependent IBL automatically for equirectangular HDRs.
  // Generated environments already have CubeUV mapping; do not relabel their PMREM.
  scene.environment = environment.texture;
  scene.environmentIntensity = environmentIntensity;
  return environment;
}
