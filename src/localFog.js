import * as THREE from "three/webgpu";
import { Fn, If, Loop, color, float, getViewPosition, mix, sin, texture, uniform, vec2, vec3, vec4 } from "three/tsl";

// Integrate only the air in front of the nearest solid. The main light's live
// shadow depth blocks shafts behind walls, fighters and collapsing structures.
export function localFog(depth, camera, light) {
  const placeholder = new THREE.DepthTexture(1, 1);
  const shadow = texture(placeholder), ready = uniform(0), strength = uniform(1);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const cameraWorld = uniform(camera.matrixWorld), shadowMatrix = uniform(light.shadow.matrix);
  const lightDirection = uniform(light.position.clone().sub(light.target.position).normalize());
  const node = Fn(([coord]) => {
    const view = getViewPosition(coord, depth.sample(coord).r, inverseProjection);
    const origin = cameraWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const endpoint = cameraWorld.mul(vec4(view, 1)).xyz;
    const ray = endpoint.sub(origin).normalize();
    const stride = endpoint.sub(origin).length().min(64).div(16);
    const transmission = float(1).toVar(), scattering = vec3(0).toVar();
    const phase = ray.dot(lightDirection).max(0).pow(6).mul(.75).add(.25);
    Loop(16, ({ i }) => {
      const point = origin.add(ray.mul(float(i).add(.5).mul(stride))).toVar();
      const bank = sin(point.x.mul(.065)).mul(sin(point.z.mul(.08))).mul(.5).add(.5);
      const density = point.y.max(0).mul(-.09).exp().mul(bank.mul(.8).add(.2));
      const opacity = density.mul(stride).mul(strength).mul(-.006).exp().oneMinus();
      const lit = float(0).toVar();
      const projected = shadowMatrix.mul(vec4(point, 1));
      const s = projected.xyz.div(projected.w).toVar();
      If(ready.greaterThan(.5).and(s.x.greaterThan(0)).and(s.x.lessThan(1))
        .and(s.y.greaterThan(0)).and(s.y.lessThan(1)).and(s.z.greaterThan(0)).and(s.z.lessThan(1)), () => {
        // The game uses VSM, whose original depth texture has no comparison
        // sampler. Compare the fetched depth explicitly without changing it.
        lit.assign(s.z.sub(.0004).lessThanEqual(shadow.sample(vec2(s.x, s.y.oneMinus())).r).select(1, 0));
      });
      const illumination = mix(color(0x183446), color(0x90adbc), lit.mul(phase));
      scattering.addAssign(illumination.mul(opacity).mul(transmission));
      transmission.mulAssign(opacity.oneMinus());
    });
    return vec4(scattering, transmission);
  });
  return { node, shadow, ready, strength, placeholder, light };
}
