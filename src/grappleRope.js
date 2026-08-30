import { LineGeometry } from "three/addons/lines/LineGeometry.js";

export const MAX_GRAPPLE_SEGMENTS = 9;

export function createGrappleRopeGeometry() {
  const geometry = new LineGeometry();
  geometry.setPositions(new Float32Array((MAX_GRAPPLE_SEGMENTS + 1) * 3));
  geometry.instanceCount = 0;
  return geometry;
}

export function updateGrappleRopeGeometry(geometry, points) {
  const segmentCount = Math.max(0, Math.min(MAX_GRAPPLE_SEGMENTS, points.length - 1));
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
