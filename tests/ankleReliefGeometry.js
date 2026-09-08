import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three/webgpu";
import { clipLegPolygon } from "../src/player.js";

// QA-only section cuts preserve the original rounded shell and every extremum.
export function ankleReliefGeometry(original, centerY, widthRatio, depthRatio, shiftZ, bevel = false) {
  const position = [], normal = [], uv = [], n = new Vector3();
  const p = original.attributes.position, normals = original.attributes.normal, tex = original.attributes.uv;
  const cuts = bevel ? [0, .008, .016, .072, .08, .088, .144, .152, .16].map(u => -.70 + u) : [-.70, -.62, -.54];
  const planes = [-Infinity, ...cuts.map(y => y - centerY), Infinity];
  const profile = (y, section) => {
    if (!bevel) return [Math.max(0, 1 - Math.abs(y + .62) / .08), section === 1 ? 12.5 : section === 2 ? -12.5 : 0];
    const u = y + .70;
    if (u <= 0 || u >= .16) return [0, 0];
    if (u < .016) return [12.5 * u * u / .032, 25 * u / .032];
    if (u < .072) return [12.5 * (u - .008), 12.5];
    if (u < .088) return [.85 - 12.5 * (u - .08) ** 2 / .016, -25 * (u - .08) / .016];
    if (u < .144) return [12.5 * (.152 - u), -12.5];
    return [12.5 * (.16 - u) ** 2 / .032, -25 * (.16 - u) / .032];
  };
  for (let i = 0; i < p.count; i += 3) {
    const triangle = [0, 1, 2].map(k => [p.getX(i + k), p.getY(i + k), p.getZ(i + k),
      normals.getX(i + k), normals.getY(i + k), normals.getZ(i + k), tex.getX(i + k), tex.getY(i + k)]);
    for (let section = 0; section + 1 < planes.length; section++) {
      let polygon = triangle;
      if (section > 0) polygon = clipLegPolygon(polygon, planes[section], true);
      if (section + 2 < planes.length) polygon = clipLegPolygon(polygon, planes[section + 1], false);
      const emit = v => {
        const [t, derivative] = profile(v[1] + centerY, section);
        const sx = 1 + (widthRatio - 1) * t, sz = 1 + (depthRatio - 1) * t;
        position.push(v[0] * sx, v[1], v[2] * sz + shiftZ * t);
        if (derivative === 0) normal.push(v[3], v[4], v[5]);
        else {
          n.set(v[3] / sx, v[4] - derivative * (widthRatio - 1) * v[0] * v[3] / sx
            - derivative * ((depthRatio - 1) * v[2] + shiftZ) * v[5] / sz, v[5] / sz).normalize();
          normal.push(n.x, n.y, n.z);
        }
        uv.push(v[6], v[7]);
      };
      for (let j = 1; j + 1 < polygon.length; j++) {
        emit(polygon[0]); emit(polygon[j]); emit(polygon[j + 1]);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
