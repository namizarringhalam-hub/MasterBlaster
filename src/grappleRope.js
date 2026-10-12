import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import * as THREE from "three/webgpu";
import { diffuseColor, materialOpacity, sin, uniform, uv } from "three/tsl";
import { emissiveEffectMaterial } from "./effectMaterials.js";

export const MAX_GRAPPLE_SEGMENTS = 9;

export function createGrappleRopeGeometry(capacity = MAX_GRAPPLE_SEGMENTS) {
  const geometry = new LineGeometry();
  geometry.setPositions(new Float32Array((capacity + 1) * 3));
  geometry.userData.segmentCapacity = capacity;
  geometry.instanceCount = 0;
  return geometry;
}

export function updateGrappleRopeGeometry(geometry, points) {
  const segmentCount = Math.max(0, Math.min(geometry.userData.segmentCapacity || MAX_GRAPPLE_SEGMENTS, points.length - 1));
  const positions = geometry.attributes.instanceStart.data.array;
  for (let index = 0; index < segmentCount; index++) {
    const start = points[index];
    const end = points[index + 1];
    const offset = index * 6;
    positions[offset] = start.x;
    positions[offset + 1] = start.y;
    positions[offset + 2] = start.z;
    positions[offset + 3] = end.x;
    positions[offset + 4] = end.y;
    positions[offset + 5] = end.z;
  }
  geometry.instanceCount = segmentCount;
  geometry.attributes.instanceStart.data.needsUpdate = true;
  return segmentCount;
}

const SUBDIVISIONS = 4;
const VISUAL_SEGMENTS = MAX_GRAPPLE_SEGMENTS * SUBDIVISIONS;

/** Create once per fighter before warmup; keep this exact line/hook on release. */
export function createGrappleVisual(player) {
  const accent = new THREE.Color(player.accent ?? player.color).multiplyScalar(2.2);
  // Opaque Line2 never enters Three's manual viewportOpaqueMipTexture blend.
  const material = new THREE.Line2NodeMaterial({ color: accent, linewidth: player.isBot ? 1.55 : 2.35,
    transparent: false, opacity: 1, depthWrite: false, toneMapped: false, alphaToCoverage: true });
  const line = new Line2(createGrappleRopeGeometry(VISUAL_SEGMENTS), material);
  line.name = "Persistent grapple energy cable"; line.frustumCulled = false;
  const positions = new THREE.BufferAttribute(new Float32Array((VISUAL_SEGMENTS + 1) * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const coordinates = new THREE.BufferAttribute(new Float32Array((VISUAL_SEGMENTS + 1) * 4), 2).setUsage(THREE.DynamicDrawUsage);
  const indices = [];
  for (let i = 0; i < VISUAL_SEGMENTS; i++) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", positions); geometry.setAttribute("uv", coordinates); geometry.setIndex(indices);
  const phase = uniform(0);
  const pulse = sin(uv().x.mul(1.8).sub(phase.mul(15))).mul(.5).add(.5).pow(12);
  const glow = emissiveEffectMaterial({ color: accent, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, opacity: .32, toneMapped: false });
  glow.opacityNode = materialOpacity.mul(uv().y.sub(.5).abs().mul(2).oneMinus().pow(2)).mul(pulse.mul(.75).add(.25));
  glow.emissiveNode = diffuseColor.rgb.mul(pulse.mul(2).add(.45));
  const halo = new THREE.Mesh(geometry, glow); halo.name = "Grapple travelling pulse halo"; halo.frustumCulled = false; halo.renderOrder = 7;
  line.add(halo);
  const hook = new THREE.Mesh(new THREE.OctahedronGeometry(.22), emissiveEffectMaterial({ color: accent, toneMapped: false }));
  hook.name = "Grapple hook"; hook.scale.y = 1.4; line.add(hook);
  const arcMaterial = emissiveEffectMaterial({ color: accent, transparent: true, opacity: .6, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(.34, .017, 4, 16, Math.PI * 1.6), arcMaterial);
  const arc2 = new THREE.Mesh(arc.geometry, arcMaterial); arc2.rotation.y = Math.PI / 2;
  hook.add(arc, arc2);
  line.userData.grappleVisual = { halo, hook, arc, arc2, phase,
    points: Array.from({ length: VISUAL_SEGMENTS + 1 }, () => new THREE.Vector3()),
    route: [], tangent: new THREE.Vector3(), view: new THREE.Vector3(), side: new THREE.Vector3(), time: 0 };
  line.userData.releaseVisual = () => { line.visible = false; line.geometry.instanceCount = 0; geometry.setDrawRange(0, 0); };
  return { line, hook };
}

/** Render-time only; points start at the interpolated chest, not physics root. */
export function updateGrappleVisual(line, points, camera, { slack = 0, dt = 0, reducedMotion = false } = {}) {
  const visual = line?.userData.grappleVisual;
  if (!visual) return updateGrappleRopeGeometry(line.geometry, points);
  visual.time += reducedMotion ? 0 : dt; visual.phase.value = visual.time;
  let count = 0, distance = 0;
  const spans = Math.min(MAX_GRAPPLE_SEGMENTS, points.length - 1);
  for (let i = 0; i < spans; i++) {
    const start = points[i], end = points[i + 1];
    const sag = reducedMotion ? 0 : Math.min(.38, Math.max(0, slack) * .18, start.distanceTo(end) * .015);
    for (let step = 0; step < SUBDIVISIONS; step++) {
      const t = step / SUBDIVISIONS, point = visual.points[count++];
      point.lerpVectors(start, end, t); point.y -= Math.sin(t * Math.PI) * sag;
    }
  }
  if (!spans) return;
  visual.points[count++].copy(points[spans]); visual.route.length = count;
  for (let i = 0; i < count; i++) visual.route[i] = visual.points[i];
  updateGrappleRopeGeometry(line.geometry, visual.route);
  const positions = visual.halo.geometry.getAttribute("position"), coordinates = visual.halo.geometry.getAttribute("uv");
  for (let i = 0; i < count; i++) {
    const point = visual.points[i];
    visual.tangent.subVectors(visual.points[Math.min(count - 1, i + 1)], visual.points[Math.max(0, i - 1)]).normalize();
    visual.view.subVectors(camera.position, point).normalize(); visual.side.crossVectors(visual.tangent, visual.view).normalize().multiplyScalar(.09);
    if (i) distance += point.distanceTo(visual.points[i - 1]);
    positions.setXYZ(i * 2, point.x - visual.side.x, point.y - visual.side.y, point.z - visual.side.z);
    positions.setXYZ(i * 2 + 1, point.x + visual.side.x, point.y + visual.side.y, point.z + visual.side.z);
    coordinates.setXY(i * 2, distance, 0); coordinates.setXY(i * 2 + 1, distance, 1);
  }
  positions.needsUpdate = coordinates.needsUpdate = true; visual.halo.geometry.setDrawRange(0, (count - 1) * 6);
  visual.hook.position.copy(points[spans]);
  visual.arc.rotation.z = visual.time * 5; visual.arc2.rotation.x = -visual.time * 6.4;
  line.visible = true;
  return count - 1;
}

export function disposeGrappleVisual(visual) {
  const line = visual?.line || visual;
  if (!line) return;
  line.removeFromParent();
  const geometries = new Set(), materials = new Set();
  line.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  line.clear();
}
