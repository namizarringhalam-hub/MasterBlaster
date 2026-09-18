import * as THREE from "three/webgpu";
import { attribute, materialOpacity, normalViewGeometry, positionGeometry, positionViewDirection, sin, time } from "three/tsl";
import { seededRandom } from "./gameData.js";
import { emissiveEffectMaterial } from "./effectMaterials.js";

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const HOT = new THREE.Color(0xffdd75), FIRE = new THREE.Color(0xff4811);
const SMOKE = new THREE.Color(0x85817c), SOOT = new THREE.Color(0x25282d);
const turbulence = sin(positionGeometry.x.mul(17).add(time.mul(2)))
  .mul(sin(positionGeometry.y.mul(13).sub(time.mul(3))))
  .mul(sin(positionGeometry.z.mul(19).add(time))).mul(.35).add(.65);
const opacity = attribute("particleAlpha", "float").mul(materialOpacity)
  .mul(normalViewGeometry.dot(positionViewDirection).abs().smoothstep(.05, .65)).mul(turbulence);

/** Two fixed draw calls, bounded storage, independent visual randomness. */
export class ExplosionParticles {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.name = "Pooled explosion fire and smoke";
    parent.add(this.group);
    this.random = seededRandom(0x3e71a9);
    this.dummy = new THREE.Object3D(); this.color = new THREE.Color();
    this.layers = [false, true].map(smoke => {
      const capacity = smoke ? 96 : 192;
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("particleAlpha", alpha);
      const options = { color: 0xffffff, transparent: true, opacity: smoke ? .42 : .85,
        depthWrite: false, blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending };
      const material = smoke ? new THREE.MeshBasicNodeMaterial(options) : emissiveEffectMaterial(options);
      material.opacityNode = opacity;
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = smoke ? "Explosion smoke" : "Explosion fire";
      mesh.count = 0; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < capacity; i++) { mesh.setMatrixAt(i, HIDDEN); mesh.setColorAt(i, SMOKE); }
      this.group.add(mesh);
      return { smoke, mesh, alpha, cursor: 0, particles: Array.from({ length: capacity }, () => ({
        life: 0, maxLife: 1, size: 1, rotation: new THREE.Vector3(), spin: new THREE.Vector3(),
        position: new THREE.Vector3(), velocity: new THREE.Vector3()
      })) };
    });
  }

  spawn(position, size = 1, quality = 1, reducedMotion = false) {
    const random = this.random;
    for (const layer of this.layers) {
      const count = Math.max(2, Math.round((layer.smoke ? 10 : 20) * quality * (reducedMotion ? .4 : 1)));
      for (let i = 0; i < count; i++) {
        const particle = layer.particles[layer.cursor++ % layer.particles.length];
        particle.life = particle.maxLife = layer.smoke ? 1.2 + random() * .8 : .35 + random() * .4;
        particle.position.copy(position);
        particle.velocity.set(random() - .5, random() * .7 + .1, random() - .5).normalize()
          .multiplyScalar(size * (layer.smoke ? .7 + random() : 2 + random() * 3));
        particle.rotation.set(random() * 6, random() * 6, random() * 6);
        particle.spin.set(random() - .5, random() - .5, random() - .5).multiplyScalar(layer.smoke ? 1.5 : 8);
        particle.size = size * (layer.smoke ? .35 + random() * .25 : .12 + random() * .22);
      }
    }
  }

  update(dt) {
    for (const layer of this.layers) {
      let count = 0, dirty = false;
      for (let i = 0; i < layer.particles.length; i++) {
        const p = layer.particles[i];
        if (p.life <= 0) continue;
        dirty = true; p.life = Math.max(0, p.life - dt);
        if (p.life === 0) { layer.mesh.setMatrixAt(i, HIDDEN); layer.alpha.setX(i, 0); continue; }
        const age = 1 - p.life / p.maxLife;
        p.velocity.multiplyScalar(Math.exp(-dt * (layer.smoke ? 1.4 : 2)));
        p.velocity.y += dt * (layer.smoke ? 1.5 : -.6);
        p.position.addScaledVector(p.velocity, dt); p.rotation.addScaledVector(p.spin, dt);
        this.dummy.position.copy(p.position); this.dummy.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
        this.dummy.scale.setScalar(p.size * (layer.smoke ? .6 + age * 2.2 : (1 + age) * (1 - age)));
        this.dummy.updateMatrix(); layer.mesh.setMatrixAt(i, this.dummy.matrix);
        layer.alpha.setX(i, (layer.smoke ? Math.min(1, age * 8) : 1) * (1 - age) ** 2);
        this.color.copy(layer.smoke ? SMOKE : HOT).lerp(layer.smoke ? SOOT : FIRE, age);
        layer.mesh.setColorAt(i, this.color.multiplyScalar(layer.smoke ? 1 : 2.6));
        count = i + 1;
      }
      layer.mesh.count = count;
      if (dirty) { layer.mesh.instanceMatrix.needsUpdate = true; layer.mesh.instanceColor.needsUpdate = true; layer.alpha.needsUpdate = true; }
    }
  }
}
