import * as THREE from "three/webgpu";
import { Fn, If, Loop, perspectiveDepthToViewZ, sin, uniform, uniformArray, vec2 } from "three/tsl";

// Eight current explosion sources, no history, texture allocation or extra draw.
export class HeatDistortion {
  constructor(depth, camera) {
    this.sources = Array.from({ length: 8 }, () => new THREE.Vector4());
    this.parameters = Array.from({ length: 8 }, () => new THREE.Vector4());
    this.strength = uniform(1);
    this.projected = new THREE.Vector3(); this.view = new THREE.Vector3();
    const sources = uniformArray(this.sources), parameters = uniformArray(this.parameters);
    const near = uniform(camera.near), far = uniform(camera.far);
    this.node = Fn(([coord]) => {
      const offset = vec2(0).toVar();
      const solidDistance = perspectiveDepthToViewZ(depth.sample(coord).r, near, far).negate();
      Loop(8, ({ i }) => {
        const source = sources.element(i), data = parameters.element(i);
        If(data.w.greaterThan(0).and(this.strength.greaterThan(0)), () => {
          const delta = coord.sub(source.xy).div(source.zw.max(.0001));
          const radius = delta.length();
          const edge = radius.smoothstep(.3, 1).oneMinus();
          const visible = solidDistance.sub(data.x.sub(data.y)).div(data.y.max(.1)).clamp(0, 1);
          const wave = vec2(sin(delta.y.mul(12).sub(data.z.mul(17))), sin(delta.x.mul(10).add(data.z.mul(13))));
          offset.addAssign(wave.mul(edge).mul(visible).mul(data.w).mul(this.strength).mul(.002));
        });
      });
      return coord.add(offset.clamp(-.006, .006)).clamp(0, 1);
    });
  }

  update(scene, camera, reducedMotion = false) {
    for (const source of this.parameters) source.set(0, 0, 0, 0);
    if (reducedMotion) return;
    const effects = scene.children.find(child => child.name === "Combat visuals");
    const particles = effects?.children.find(child => child.name === "Pooled explosion fire and smoke")?.userData.explosionHeat;
    if (!particles) return;
    camera.updateWorldMatrix(true, false);
    let index = 0;
    for (const particle of particles) {
      if (particle.life <= 0 || particle.reducedMotion) continue;
      this.view.copy(particle.position).applyMatrix4(camera.matrixWorldInverse);
      const distance = -this.view.z;
      if (distance <= camera.near) continue;
      const age = 1 - particle.life / particle.maxLife;
      const radius = particle.size * (1 + age * 1.5);
      this.projected.copy(particle.position).project(camera);
      this.sources[index].set(this.projected.x * .5 + .5, .5 - this.projected.y * .5,
        radius * camera.projectionMatrix.elements[0] / distance * .5, radius * camera.projectionMatrix.elements[5] / distance * .5);
      this.parameters[index].set(distance, radius, particle.maxLife - particle.life, (1 - age) ** 2);
      if (++index === this.sources.length) break;
    }
  }
}
