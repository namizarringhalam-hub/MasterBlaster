import * as THREE from "three/webgpu";
import { Fn, If, Loop, color, float, fract, getViewPosition, mix, perspectiveDepthToViewZ, rtt, screenUV, sin, texture, textureSize, uniform, vec2, vec3, vec4 } from "three/tsl";

// Integrate only the air in front of the nearest solid. The main light's live
// shadow depth blocks shafts behind walls, fighters and collapsing structures.
export function localFog(depth, camera, light, { resolutionScale = .5 } = {}) {
  const placeholder = new THREE.DepthTexture(1, 1);
  // ArenaShadowRig has two independent depth maps. Keep each map paired with
  // its own matrix; the distant cascade deliberately excludes nearby rays.
  const shadowBindings = Array.from({ length: 2 }, () => ({
    texture: texture(placeholder), matrix: uniform(light.shadow.matrix.clone()), ready: uniform(0)
  }));
  const shadow = shadowBindings[0].texture, ready = uniform(0), strength = uniform(1);
  const cascadeSplit = uniform(100000);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const cameraWorld = uniform(camera.matrixWorld);
  const lightDirection = uniform(light.position.clone().sub(light.target.position).normalize());
  const integrate = Fn(([coord]) => {
    const view = getViewPosition(coord, depth.sample(coord).r, inverseProjection);
    const origin = cameraWorld.mul(vec4(0, 0, 0, 1)).xyz;
    const endpoint = cameraWorld.mul(vec4(view, 1)).xyz;
    const ray = endpoint.sub(origin).normalize();
    const stride = endpoint.sub(origin).length().min(64).div(16);
    const transmission = float(1).toVar(), scattering = vec3(0).toVar();
    const phase = ray.dot(lightDirection).max(0).pow(6).mul(.75).add(.25);
    // Interleaved gradient noise distributes the ray offsets in screen space;
    // the depth-guided reconstruction removes grain without crossing a wall.
    const pixel = coord.mul(textureSize(depth));
    const jitter = fract(fract(pixel.dot(vec2(.06711056, .00583715))).mul(52.9829189));
    Loop(16, ({ i }) => {
      const distance = float(i).add(jitter).mul(stride);
      const point = origin.add(ray.mul(distance)).toVar();
      const bank = sin(point.x.mul(.065)).mul(sin(point.z.mul(.08))).mul(.5).add(.5);
      const density = point.y.max(0).mul(-.09).exp().mul(bank.mul(.8).add(.2));
      const opacity = density.mul(stride).mul(strength).mul(-.006).exp().oneMinus();
      const lit = float(0).toVar();
      const projected = shadowBindings.map(binding => {
        const p = binding.matrix.mul(vec4(point, 1));
        return p.xyz.div(p.w).toVar();
      });
      const valid = projected.map((s, index) => shadowBindings[index].ready.greaterThan(.5)
        .and(s.x.greaterThan(0)).and(s.x.lessThan(1)).and(s.y.greaterThan(0)).and(s.y.lessThan(1))
        .and(s.z.greaterThan(0)).and(s.z.lessThan(1)));
      // CSM splits use forward camera depth, not Euclidean ray distance. At an
      // edge of the screen those differ appreciably. Validate the volume as
      // well, and use the other cascade when snap-to-texel bounds overlap.
      const preferNear = distance.mul(view.z.negate()).div(view.length()).lessThanEqual(cascadeSplit);
      const sampleCascade = index => {
        const s = projected[index];
        // The game uses VSM, whose original depth texture has no comparison
        // sampler. Compare the fetched depth explicitly without changing it.
        lit.assign(s.z.sub(.0004).lessThanEqual(shadowBindings[index].texture.sample(vec2(s.x, s.y.oneMinus())).r).select(1, 0));
      };
      If(valid[0].and(preferNear.or(valid[1].not())), () => sampleCascade(0))
        .ElseIf(valid[1], () => sampleCascade(1));
      const neon = mix(color(0x10242e), color(0x291b35), point.x.mul(.025).add(.5).clamp(0, 1));
      const illumination = mix(neon, color(0x90adbc), lit.mul(phase));
      scattering.addAssign(illumination.mul(opacity).mul(transmission));
      transmission.mulAssign(opacity.oneMinus());
    });
    return vec4(scattering, transmission);
  });
  const low = rtt(integrate(screenUV), null, null, { type: THREE.HalfFloatType, depthBuffer: false });
  low.setResolutionScale(resolutionScale);
  const near = uniform(camera.near), far = uniform(camera.far);
  const node = Fn(([coord]) => {
    const size = textureSize(low), texel = size.reciprocal();
    const base = coord.mul(size).sub(.5).floor().add(.5).div(size);
    const centerZ = perspectiveDepthToViewZ(depth.sample(coord).r, near, far);
    const sum = vec4(0).toVar(), total = float(0).toVar();
    // Nine low-res samples perform bilateral smoothing and upsampling together.
    // View-space distance, rather than nonlinear hardware depth, keeps the
    // rejection threshold meaningful both near the mecha and across the arena.
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const sampleUV = base.add(texel.mul(vec2(x, y))).clamp(texel.mul(.5), vec2(1).sub(texel.mul(.5)));
      const sampleZ = perspectiveDepthToViewZ(depth.sample(sampleUV).r, near, far);
      const rangeWeight = sampleZ.sub(centerZ).abs().div(centerZ.abs().mul(.02).max(.25)).negate().exp();
      const delta = sampleUV.sub(coord).mul(size);
      const weight = delta.dot(delta).mul(-.8).exp().mul(rangeWeight).max(.00001);
      sum.addAssign(low.sample(sampleUV).mul(weight));
      total.addAssign(weight);
    }
    return sum.div(total);
  });
  return {
    node, shadow, shadowBindings, cascadeSplit, ready, strength, placeholder, light, low,
    update() {
      const rig = light.shadow.shadowNode, cascades = rig?.lights;
      const lights = cascades?.length ? cascades : [light];
      ready.value = 0;
      for (let index = 0; index < shadowBindings.length; index++) {
        const binding = shadowBindings[index], shadowLight = lights[index];
        const map = shadowLight?.shadow.map;
        binding.ready.value = map?.depthTexture ? 1 : 0;
        binding.texture.value = map?.depthTexture || placeholder;
        if (map?.depthTexture) {
          binding.matrix.value.copy(shadowLight.shadow.matrix);
          ready.value = 1;
        }
      }
      cascadeSplit.value = cascades?.length > 1
        ? camera.near + rig.breaks[0] * (Math.min(camera.far, rig.maxFar) - camera.near) : 100000;
      near.value = camera.near; far.value = camera.far;
      lightDirection.value.copy(light.position).sub(light.target.position).normalize();
    },
    dispose() {
      placeholder.dispose(); low.renderTarget.dispose(); low._quadMesh.material.dispose();
    }
  };
}
