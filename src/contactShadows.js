import { Fn, If, Loop, float, getViewPosition, uniform, vec2, vec4 } from 'three/tsl';

// Short rays complement the arena-sized shadow map at feet and cover edges.
// They only use current visible depth; offscreen occlusion remains the map's job.
export function contactShadows(depth, normal, camera, light) {
  const strength = uniform(.24);
  const projection = uniform(camera.projectionMatrix);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const viewMatrix = uniform(camera.matrixWorldInverse);
  const direction = uniform(light.position.clone().sub(light.target.position).normalize());
  const node = Fn(([coord]) => {
    const depthHere = depth.sample(coord).r;
    const view = getViewPosition(coord, depthHere, inverseProjection);
    const n = normal.sample(coord).xyz.normalize();
    const towardLight = viewMatrix.mul(vec4(direction, 0)).xyz.normalize();
    const occlusion = float(0).toVar();
    If(depthHere.lessThan(.99999).and(n.dot(towardLight).greaterThan(.05)), () => {
      Loop(8, ({ i }) => {
        const point = view.add(n.mul(.025)).add(towardLight.mul(float(i).add(1).mul(.075)));
        const clip = projection.mul(vec4(point, 1));
        const ndc = clip.xy.div(clip.w);
        const sampleUV = vec2(ndc.x.mul(.5).add(.5), ndc.y.mul(-.5).add(.5));
        If(clip.w.greaterThan(0).and(sampleUV.x.greaterThan(0)).and(sampleUV.x.lessThan(1))
          .and(sampleUV.y.greaterThan(0)).and(sampleUV.y.lessThan(1)), () => {
          const solid = getViewPosition(sampleUV, depth.sample(sampleUV).r, inverseProjection);
          const gap = solid.z.sub(point.z);
          const hit = gap.smoothstep(.015, .04).mul(gap.smoothstep(.12, .2).oneMinus());
          const edge = sampleUV.min(sampleUV.oneMinus()).mul(24).clamp(0, 1);
          occlusion.assign(occlusion.max(hit.mul(edge.x.mul(edge.y))));
        });
      });
    });
    return occlusion.mul(strength).oneMinus();
  });
  return { node, strength };
}
