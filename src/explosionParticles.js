import * as THREE from "three/webgpu";
import { attribute, diffuseColor, materialOpacity, normalViewGeometry, positionGeometry, positionViewDirection, sin, uv } from "three/tsl";
import { seededRandom } from "./gameData.js";
import { emissiveEffectMaterial } from "./effectMaterials.js";

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const HOT = new THREE.Color(0xfff5e0), FIRE = new THREE.Color(0xff4811);
const SMOKE = new THREE.Color(0x343e4c), SOOT = new THREE.Color(0x101721);
const UP = new THREE.Vector3(0, 1, 0);
// Particle age freezes with the game and can be frozen independently for reduced motion.
const phase = attribute("particlePhase", "float");
const turbulence = sin(positionGeometry.x.mul(17).add(phase.mul(2)))
  .mul(sin(positionGeometry.y.mul(13).sub(phase.mul(3))))
  .mul(sin(positionGeometry.z.mul(19).add(phase))).mul(.35).add(.65);
const opacity = attribute("particleAlpha", "float").mul(materialOpacity)
  .mul(normalViewGeometry.dot(positionViewDirection).abs().smoothstep(.05, .65)).mul(turbulence);

/** Four bounded batches: energy, smoke, hollow shells and ground scorch marks. */
export class ExplosionParticles {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.name = "Pooled explosion fire and smoke";
    parent.add(this.group);
    this.random = seededRandom(0x3e71a9);
    this.dummy = new THREE.Object3D(); this.color = new THREE.Color();
    this.layers = ["fire", "smoke", "shell", "scorch"].map(kind => {
      const smoke = kind === "smoke", shell = kind === "shell", scorch = kind === "scorch";
      const capacity = smoke ? 96 : shell || scorch ? 32 : 192;
      const geometry = scorch ? new THREE.PlaneGeometry(2, 2) : new THREE.IcosahedronGeometry(1, shell ? 2 : 1);
      const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("particleAlpha", alpha);
      geometry.setAttribute("particlePhase", phase);
      const options = { color: 0xffffff, transparent: true, opacity: scorch ? .48 : smoke ? .3 : shell ? .3 : .65,
        depthWrite: false, blending: smoke || scorch ? THREE.NormalBlending : THREE.AdditiveBlending };
      const material = smoke || scorch ? new THREE.MeshBasicNodeMaterial(options) : emissiveEffectMaterial(options);
      if (!smoke && !scorch) material.emissiveNode = diffuseColor.rgb;
      material.opacityNode = scorch ? attribute("particleAlpha", "float").mul(materialOpacity).mul(uv().sub(.5).length().smoothstep(.1, .5).oneMinus())
        : shell ? attribute("particleAlpha", "float").mul(materialOpacity).mul(normalViewGeometry.dot(positionViewDirection).abs().oneMinus().pow(3)) : opacity;
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = `Explosion ${kind}`;
      mesh.count = 0; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < capacity; i++) { mesh.setMatrixAt(i, HIDDEN); mesh.setColorAt(i, SMOKE); }
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return { kind, smoke, mesh, alpha, phase, cursor: 0, particles: Array.from({ length: capacity }, () => ({
        life: 0, maxLife: 1, size: 1, rotation: new THREE.Vector3(), spin: new THREE.Vector3(),
        position: new THREE.Vector3(), velocity: new THREE.Vector3(), tint: new THREE.Color()
      })) };
    });
  }

  spawn(position, size = 1, quality = 1, reducedMotion = false, tint = FIRE) {
    const random = this.random;
    for (const layer of this.layers) {
      if (layer.kind === "scorch") continue;
      const shell = layer.kind === "shell";
      const count = shell ? 1 : Math.max(2, Math.round((layer.smoke ? 10 : 20) * quality * (reducedMotion ? .4 : 1)));
      for (let i = 0; i < count; i++) {
        const particle = layer.particles[layer.cursor++ % layer.particles.length];
        particle.life = particle.maxLife = layer.smoke ? 1.2 + random() * .8 : .35 + random() * .4;
        particle.mode = !layer.smoke && !shell ? i === 0 ? "flash" : i % 3 === 0 ? "ember" : i % 3 === 1 ? "ribbon" : "fire" : layer.kind;
        particle.reducedMotion = reducedMotion;
        particle.tint.set(tint);
        if (particle.mode === "flash") particle.life = particle.maxLife = reducedMotion ? .16 : .1;
        if (particle.mode === "ember") particle.life = particle.maxLife = .85 + random() * .45;
        if (shell) particle.life = particle.maxLife = .48;
        particle.position.copy(position);
        particle.velocity.set(random() - .5, random() * .7 + .1, random() - .5).normalize()
          .multiplyScalar(size * (layer.smoke ? .7 + random() : 2 + random() * 3));
        particle.rotation.set(random() * 6, random() * 6, random() * 6);
        particle.spin.set(random() - .5, random() - .5, random() - .5).multiplyScalar(layer.smoke ? 1.5 : 8);
        particle.size = size * (layer.smoke ? .35 + random() * .25 : .12 + random() * .22);
        if (shell) { particle.size = size; particle.velocity.set(0, 0, 0); }
        if (particle.mode === "flash") { particle.size = size * .3; particle.velocity.set(0, 0, 0); }
        if (particle.mode === "ember") particle.size *= .22;
        if (reducedMotion) { particle.velocity.multiplyScalar(.4); particle.spin.set(0, 0, 0); }
      }
    }
  }

  scorch(position, size) {
    const layer = this.layers[3], p = layer.particles[layer.cursor++ % layer.particles.length];
    p.life = p.maxLife = 4;
    p.size = size; p.position.copy(position); p.position.y += .025;
    p.rotation.set(-Math.PI / 2, 0, this.random() * Math.PI * 2);
    p.velocity.set(0, 0, 0); p.spin.set(0, 0, 0); p.tint.set(0x080d16);
    p.mode = "scorch"; p.reducedMotion = true;
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
        layer.phase.setX(i, p.reducedMotion ? 0 : p.maxLife - p.life);
        p.velocity.multiplyScalar(Math.exp(-dt * (layer.smoke ? 1.4 : 2)));
        if (p.mode !== "shell" && p.mode !== "scorch" && p.mode !== "flash") p.velocity.y += dt * (layer.smoke ? 1.5 : -.6);
        p.position.addScaledVector(p.velocity, dt); p.rotation.addScaledVector(p.spin, dt);
        this.dummy.position.copy(p.position); this.dummy.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
        this.dummy.scale.setScalar(p.size * (layer.smoke ? .6 + age * 2.2 : (1 + age) * (1 - age)));
        if (p.mode === "shell") this.dummy.scale.setScalar(p.size * (.2 + (1 - (1 - age) ** 3) * (p.reducedMotion ? .8 : 1.8)));
        if (p.mode === "scorch") this.dummy.scale.set(p.size, p.size, 1);
        if (p.mode === "ribbon" && !p.reducedMotion) {
          this.dummy.quaternion.setFromUnitVectors(UP, this.dummy.up.copy(p.velocity).normalize());
          this.dummy.scale.x *= .38; this.dummy.scale.y *= 3.8; this.dummy.scale.z *= .38;
        }
        this.dummy.updateMatrix(); layer.mesh.setMatrixAt(i, this.dummy.matrix);
        layer.alpha.setX(i, (layer.smoke ? Math.min(1, age * 8) : 1) * (1 - age) ** 2);
        this.color.copy(layer.smoke ? SMOKE : p.mode === "flash" ? HOT : p.tint);
        if (layer.smoke) this.color.lerp(SOOT, age);
        layer.mesh.setColorAt(i, this.color.multiplyScalar(layer.smoke || p.mode === "scorch" ? 1 : p.reducedMotion ? 1.2 : p.mode === "flash" ? 3.2 : 1.8));
        count = i + 1;
      }
      layer.mesh.count = count;
      if (dirty) { layer.mesh.instanceMatrix.needsUpdate = true; layer.mesh.instanceColor.needsUpdate = true; layer.alpha.needsUpdate = true; layer.phase.needsUpdate = true; }
    }
  }
}
