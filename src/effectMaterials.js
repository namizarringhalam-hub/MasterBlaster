import * as THREE from "three/webgpu";
import { diffuseColor, positionGeometry, sin, time } from "three/tsl";

// One shared TSL graph compiles to WGSL or GLSL with the active renderer.
// Surface bands travel through the core instead of pulsing a solid-color mesh.
const flow = sin(positionGeometry.y.mul(19).add(positionGeometry.x.mul(11)).sub(time.mul(17)))
  .mul(sin(positionGeometry.z.mul(13).add(time.mul(9)))).mul(.16).add(.55);
export function emissiveEffectMaterial(options = {}) {
  const material = new THREE.MeshBasicNodeMaterial({ toneMapped: false, ...options });
  material.emissiveNode = diffuseColor.rgb.mul(flow);
  return material;
}
