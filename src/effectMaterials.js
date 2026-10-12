import * as THREE from "three/webgpu";
import { abs, atan, cos, diffuseColor, materialOpacity, positionGeometry, sin, time, uv } from "three/tsl";

// One shared TSL graph compiles to WGSL or GLSL with the active renderer.
// Surface bands travel through the core instead of pulsing a solid-color mesh.
const flow = sin(positionGeometry.y.mul(19).add(positionGeometry.x.mul(11)).sub(time.mul(17)))
  .mul(sin(positionGeometry.z.mul(13).add(time.mul(9)))).mul(.16).add(.55);
export function emissiveEffectMaterial(options = {}) {
  const material = new THREE.MeshBasicNodeMaterial({ toneMapped: false, ...options });
  material.emissiveNode = diffuseColor.rgb.mul(flow);
  return material;
}

const point = uv().sub(.5).mul(2), radius = point.length();
const angle = atan(point.y, point.x);
// A hot central aperture and six soft petals, independent of polygon outlines.
export const muzzlePetalOpacity = materialOpacity.mul(
  radius.div(cos(angle.mul(6)).abs().mul(.34).add(.58)).smoothstep(.05, 1).oneMinus()
);
export const ribbonOpacity = materialOpacity.mul(point.x.abs().smoothstep(.06, 1).oneMinus().pow(1.7))
  .mul(point.y.abs().smoothstep(.8, 1).oneMinus());
export const ribbonEmission = diffuseColor.rgb.mul(point.x.abs().smoothstep(0, .22).oneMinus().mul(2.8).add(.45))
  .mul(sin(uv().y.mul(45).sub(time.mul(28))).mul(.5).add(.5).pow(10).mul(.8).add(1));
export const flameOpacity = materialOpacity.mul(radius.add(sin(point.x.mul(17).add(time.mul(11))).mul(sin(point.y.mul(13).sub(time.mul(8)))).mul(.12))
  .smoothstep(.25, 1).oneMinus());

/** Three intersecting quads share one draw and one authored petal shader. */
export function muzzlePetalGeometry() {
  const positions = [], coordinates = [], indices = [];
  for (let face = 0; face < 3; face++) {
    const angle = face * Math.PI / 3, x = Math.cos(angle), z = Math.sin(angle), base = face * 4;
    positions.push(-x, -.5, -z, x, -.5, z, -x, .5, -z, x, .5, z);
    coordinates.push(0, 0, 1, 0, 0, 1, 1, 1); indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(coordinates, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Seven expanding billows; every tongue is a quad, all in a single batch. */
export function flameStreamGeometry() {
  const positions = [], coordinates = [], indices = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6, width = .55 + t * .75, centre = -.44 + t * .88, height = .16 + t * .12;
    const base = i * 4, drift = Math.sin(i * 2.3) * t * .26;
    positions.push(drift - width, centre - height, 0, drift + width, centre - height, 0,
      drift - width, centre + height, 0, drift + width, centre + height, 0);
    coordinates.push(0, 0, 1, 0, 0, 1, 1, 1); indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(coordinates, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
