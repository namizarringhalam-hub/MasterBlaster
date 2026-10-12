import * as THREE from "three/webgpu";
import { attribute, diffuseColor, materialColor, materialOpacity, sin, uv } from "three/tsl";
import { seededRandom } from "./gameData.js";
import { emissiveEffectMaterial } from "./effectMaterials.js";
import { softParticleFade } from "./softParticles.js";
import { queueParticlePrefix } from "./particleUploads.js";

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const HOT = new THREE.Color(0xfff5e0), FIRE = new THREE.Color(0xff4811);
const SMOKE = new THREE.Color(0x444850), SOOT = new THREE.Color(0x151c24);
const YELLOW = new THREE.Color(0xffb633), RED = new THREE.Color(0x8e1909);
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
// Particle age freezes with the game and can be frozen independently for reduced motion.
const phase = attribute("particlePhase", "float");
const radial = uv().sub(.5).mul(2), radius = radial.length();
const ageNode = attribute("particleAge", "float");
const turbulence = sin(radial.x.mul(11).add(phase.mul(5)))
  .mul(sin(radial.y.mul(13).sub(phase.mul(7))))
  .add(sin(radial.x.add(radial.y).mul(21).add(phase.mul(3))).mul(.35));
const erosion = radius.add(turbulence.mul(.11)).add(ageNode.mul(.18)).smoothstep(.4, 1).oneMinus();
const opacity = attribute("particleAlpha", "float").mul(materialOpacity)
  .mul(erosion).mul(radius.smoothstep(.02, .82).oneMinus().mul(.55).add(.45));
const smokeOpacity = attribute("particleAlpha", "float").mul(materialOpacity)
  .mul(radius.add(turbulence.mul(.08)).smoothstep(.3, 1).oneMinus());

/** Four bounded batches: soft fire, cheaply lit soot, shock rings and scorch. */
export class ExplosionParticles {
  constructor(parent) {
    this.group = new THREE.Group(); this.group.name = "Pooled explosion fire and smoke";
    parent.add(this.group);
    this.random = seededRandom(0x3e71a9);
    this.dummy = new THREE.Object3D(); this.color = new THREE.Color(); this.cameraInverse = new THREE.Quaternion();
    this.layers = ["fire", "smoke", "shell", "scorch"].map(kind => {
      const smoke = kind === "smoke", shell = kind === "shell", scorch = kind === "scorch";
      const capacity = smoke ? 96 : shell || scorch ? 32 : 192;
      const geometry = shell ? new THREE.RingGeometry(.86, 1, 48) : new THREE.PlaneGeometry(scorch ? 2 : Math.SQRT2, scorch ? 2 : Math.SQRT2);
      const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      const age = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("particleAlpha", alpha);
      geometry.setAttribute("particlePhase", phase);
      geometry.setAttribute("particleAge", age);
      const options = { color: 0xffffff, transparent: true, opacity: scorch ? .48 : smoke ? .55 : shell ? .3 : .65,
        depthWrite: false, side: THREE.DoubleSide, blending: smoke || scorch ? THREE.NormalBlending : THREE.AdditiveBlending };
      const material = smoke ? new THREE.MeshBasicNodeMaterial(options)
        : scorch ? new THREE.MeshBasicNodeMaterial(options) : emissiveEffectMaterial(options);
      // Key wrap + warm fire under-light, no scene-light loop, PBR or shadows.
      if (smoke) material.colorNode = materialColor.rgb.mul(radial.y.add(radial.x.mul(-.4)).mul(.16).add(.8))
        .add(materialColor.rgb.mul(new THREE.Color(0xff6b26)).mul(ageNode.oneMinus()).mul(radial.y.oneMinus()).mul(.15));
      if (!smoke && !scorch) material.emissiveNode = diffuseColor.rgb;
      material.opacityNode = scorch ? attribute("particleAlpha", "float").mul(materialOpacity).mul(uv().sub(.5).length().smoothstep(.1, .5).oneMinus())
        : shell ? attribute("particleAlpha", "float").mul(materialOpacity) : smoke ? smokeOpacity : opacity;
      if (!scorch) material.opacityNode = material.opacityNode.mul(softParticleFade());
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.receiveShadow = false;
      mesh.name = `Explosion ${kind}`;
      mesh.count = 0; mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < capacity; i++) { mesh.setMatrixAt(i, HIDDEN); mesh.setColorAt(i, SMOKE); }
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return { kind, smoke, mesh, alpha, phase, age, cursor: 0, particles: Array.from({ length: capacity }, () => ({
        life: 0, maxLife: 1, size: 1, rotation: new THREE.Vector3(), spin: new THREE.Vector3(),
        position: new THREE.Vector3(), velocity: new THREE.Vector3(), tint: new THREE.Color()
      })) };
    });
    this.group.userData.explosionHeat = this.layers[2].particles;
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
        if (particle.mode === "flash") particle.life = particle.maxLife = reducedMotion ? .1 : 1 / 60;
        particle.justSpawned = particle.mode === "flash";
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
    p.surface = null;
  }

  damageSmoke(position, size = .45, reducedMotion = false) {
    const layer = this.layers[1], p = layer.particles[layer.cursor++ % layer.particles.length];
    p.life = p.maxLife = 1.2 + this.random() * .5; p.mode = "smoke"; p.surface = null;
    p.position.copy(position); p.velocity.set((this.random() - .5) * .3, .7, (this.random() - .5) * .3);
    p.rotation.set(0, 0, this.random() * Math.PI * 2); p.spin.set(0, 0, reducedMotion ? 0 : .2);
    p.size = size; p.tint.copy(SMOKE); p.reducedMotion = reducedMotion;
  }

  surfaceMark(position, normal, size, surface = null) {
    if (!normal?.lengthSq() || surface?.removed || surface?.active === false) return;
    if (surface) {
      if (![surface.x, surface.z, surface.baseY, surface.top, surface.w, surface.d].every(Number.isFinite)) return;
      // The collider faces are axis aligned. Keep the entire decal on its face.
      const gaps = [];
      if (Math.abs(normal.x) < .5) gaps.push(surface.w / 2 - Math.abs(position.x - surface.x));
      if (Math.abs(normal.y) < .5) gaps.push(position.y - surface.baseY, surface.top - position.y);
      if (Math.abs(normal.z) < .5) gaps.push(surface.d / 2 - Math.abs(position.z - surface.z));
      size = Math.min(size, ...gaps);
    }
    if (size < .025) return;
    this.scorch(position, size);
    const layer = this.layers[3], p = layer.particles[(layer.cursor - 1) % layer.particles.length];
    p.life = p.maxLife = 6;
    p.position.copy(position).addScaledVector(normal, .018);
    this.dummy.quaternion.setFromUnitVectors(FRONT, normal.clone().normalize());
    this.dummy.rotateZ(this.random() * Math.PI * 2);
    p.rotation.copy(this.dummy.rotation);
    p.surface = surface;
    p.surfaceOffset ||= new THREE.Vector3();
    if (surface) p.surfaceOffset.copy(p.position).sub(new THREE.Vector3(surface.x, surface.baseY, surface.z));
  }

  update(dt, camera = this.camera) {
    if (camera) { this.camera = camera; this.cameraInverse.copy(camera.quaternion).invert(); }
    for (const layer of this.layers) {
      let count = 0, dirty = false;
      for (let i = 0; i < layer.particles.length; i++) {
        const p = layer.particles[i];
        if (p.life <= 0) continue;
        dirty = true; p.life = Math.max(0, p.life - (p.justSpawned ? 0 : dt));
        if (dt > 0) p.justSpawned = false;
        if (p.surface) {
          if (p.surface.removed || p.surface.active === false) p.life = 0;
          else p.position.copy(p.surfaceOffset).add(this.dummy.position.set(p.surface.x, p.surface.baseY, p.surface.z));
        }
        if (p.life === 0) { p.surface = null; layer.mesh.setMatrixAt(i, HIDDEN); layer.alpha.setX(i, 0); continue; }
        const age = 1 - p.life / p.maxLife;
        layer.age.setX(i, age);
        layer.phase.setX(i, p.reducedMotion ? 0 : p.maxLife - p.life);
        p.velocity.multiplyScalar(Math.exp(-dt * (layer.smoke ? 1.4 : 2)));
        if (p.mode !== "shell" && p.mode !== "scorch" && p.mode !== "flash") p.velocity.y += dt * (layer.smoke ? 1.5 : -.6);
        p.position.addScaledVector(p.velocity, dt); p.rotation.addScaledVector(p.spin, dt);
        this.dummy.position.copy(p.position); this.dummy.rotation.set(p.rotation.x, p.rotation.y, p.rotation.z);
        if (p.mode !== "shell" && p.mode !== "scorch" && camera) {
          this.dummy.quaternion.copy(camera.quaternion); this.dummy.rotateZ(p.rotation.z);
        }
        this.dummy.scale.setScalar(p.size * (layer.smoke ? .6 + age * 2.2 : (1 + age) * (1 - age)));
        if (p.mode === "shell") {
          this.dummy.rotation.set(-Math.PI / 2, 0, 0);
          this.dummy.scale.setScalar(p.size * (.2 + (1 - (1 - age) ** 3) * (p.reducedMotion ? .8 : 1.8)));
        }
        if (p.mode === "scorch") this.dummy.scale.set(p.size, p.size, 1);
        if ((p.mode === "ribbon" || p.mode === "ember") && !p.reducedMotion) {
          // Streak angle in the camera plane; it stays legible from every side.
          if (camera) {
            this.dummy.up.copy(p.velocity).applyQuaternion(this.cameraInverse);
            this.dummy.quaternion.copy(camera.quaternion); this.dummy.rotateZ(-Math.atan2(this.dummy.up.x, this.dummy.up.y));
          }
          this.dummy.scale.x *= .28; this.dummy.scale.y *= p.mode === "ember" ? 4.8 : 3.8;
        }
        this.dummy.updateMatrix(); layer.mesh.setMatrixAt(i, this.dummy.matrix);
        layer.alpha.setX(i, (layer.smoke ? Math.min(1, age * 8) : 1) * (1 - age) ** 2);
        this.color.copy(layer.smoke ? SMOKE : p.mode === "flash" ? HOT : p.tint);
        if (layer.smoke) this.color.lerp(SOOT, age);
        else if (p.mode !== "scorch" && p.mode !== "shell" && p.mode !== "flash") {
          this.color.copy(age < .25 ? HOT : age < .62 ? YELLOW : FIRE)
            .lerp(age < .25 ? YELLOW : age < .62 ? FIRE : RED, age < .25 ? age / .25 : age < .62 ? (age - .25) / .37 : (age - .62) / .38)
            .lerp(p.tint, .16);
        }
        layer.mesh.setColorAt(i, this.color.multiplyScalar(layer.smoke || p.mode === "scorch" ? 1 : p.reducedMotion ? 1.2 : p.mode === "flash" ? 7 : 2.5));
        count = i + 1;
      }
      layer.mesh.count = count;
      if (dirty) {
        queueParticlePrefix(layer.mesh.instanceMatrix, count);
        queueParticlePrefix(layer.mesh.instanceColor, count);
        queueParticlePrefix(layer.alpha, count);
        queueParticlePrefix(layer.phase, count);
        queueParticlePrefix(layer.age, count);
      }
    }
  }
}
