import * as THREE from 'three/webgpu';
import { Fn, If, Loop, float, perspectiveDepthToViewZ, screenUV, uniform, vec2 } from 'three/tsl';

export class CinematicMotionBlur {
  constructor(depthPass, camera) {
    this.depthPass = depthPass;
    this.camera = camera;
    this.amount = uniform(0);
    this.pixelSize = uniform(new THREE.Vector2(1, 1));
    this.near = uniform(camera.near); this.far = uniform(camera.far);
    this.size = new THREE.Vector2(); this.previousSize = new THREE.Vector2();
    this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion();
    this.reset();
  }

  reset() { this.lastTime = null; this.warmup = 2; this.amount.value = 0; }

  update(renderer, strength, enabled, now = performance.now()) {
    const camera = this.camera;
    camera.updateWorldMatrix(true, false);
    renderer.getDrawingBufferSize(this.size);
    const dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    const cut = dt <= 0 || dt > .15 || this.position.distanceToSquared(camera.position) > 25
      || Math.abs(this.rotation.dot(camera.quaternion)) < .9 || Math.abs(this.fov - camera.fov) > 5
      || !this.size.equals(this.previousSize);
    if (!enabled || cut) this.warmup = 2;
    this.amount.value = enabled && this.warmup === 0 ? strength / 100 * Math.min(2, 1 / (60 * dt)) : 0;
    if (enabled && this.warmup > 0) this.warmup--;
    this.lastTime = now; this.fov = camera.fov;
    this.position.copy(camera.position); this.rotation.copy(camera.quaternion); this.previousSize.copy(this.size);
    this.pixelSize.value.set(1 / this.size.x, 1 / this.size.y);
    this.near.value = camera.near; this.far.value = camera.far;
  }

  node(input) {
    return Fn(() => {
      const coord = screenUV;
      const center = input.sample(coord);
      const result = center.toVar();
      const vectors = this.depthPass.velocity.sample(coord).xy;
      // Camera/object cuts must never smear across the screen.
      If(this.amount.greaterThan(0).and(vectors.length().lessThan(.2)), () => {
        const motion = vectors.mul(vec2(.5, -.5)).mul(this.amount)
          .clamp(this.pixelSize.mul(-20), this.pixelSize.mul(20));
        const centerZ = perspectiveDepthToViewZ(this.depthPass.node.sample(coord).r, this.near, this.far);
        const total = float(1).toVar();
        Loop(8, ({ i }) => {
          const sampleUV = coord.add(motion.mul(float(i).div(7).sub(.5))).clamp(0, 1);
          const z = perspectiveDepthToViewZ(this.depthPass.node.sample(sampleUV).r, this.near, this.far);
          const weight = z.sub(centerZ).abs().lessThan(centerZ.abs().mul(.015).max(.1)).select(1, 0);
          result.addAssign(input.sample(sampleUV).mul(weight)); total.addAssign(weight);
        });
        result.divAssign(total);
      });
      return result;
    })();
  }
}
