import * as THREE from "three/webgpu";
import { attribute, materialOpacity } from "three/tsl";
import { emissiveEffectMaterial } from "./effectMaterials.js";
import { queueParticlePrefix } from "./particleUploads.js";

function vortexRibbonGeometry(radius = 2.25, height = 3.8, turns = 3.4, segments = 76) {
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const angle = t * Math.PI * 2 * turns;
    const centreRadius = radius * (1 - t * .58) + Math.sin(t * Math.PI * 7) * .08;
    const halfWidth = .07 + (1 - t) * .05;
    for (const side of [-1, 1]) {
      const r = centreRadius + side * halfWidth;
      positions.push(Math.cos(angle) * r, t * height, Math.sin(angle) * r);
    }
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createHazardVisual(weapon, pool = null) {
    if (pool) return pool.acquire(weapon);
    const hazardRadius = weapon.hazard === "black_hole" ? 9 : weapon.hazard === "tornado" ? 7 : 6;
    const mesh = new THREE.Group();
    const ringOpacity = weapon.hazard === "tornado" ? .12 : weapon.hazard === "black_hole" ? .18 : .28;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(hazardRadius * .48, .22, 8, 34),
      new THREE.MeshBasicMaterial({ color: weapon.color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
    let instances = null;
    const fadeMaterials = [{ material: ring.material, baseOpacity: ringOpacity }];
    if (weapon.hazard === "napalm") {
      const count = 9;
      const flames = new THREE.InstancedMesh(
        new THREE.ConeGeometry(.42, 1.8, 7),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .46, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        count
      );
      const dummy = new THREE.Object3D();
      const bases = [];
      const phases = [];
      for (let index = 0; index < 9; index++) {
        const angle = index / 9 * Math.PI * 2;
        const base = new THREE.Vector3(Math.cos(angle) * hazardRadius * .42, .65 + index % 2 * .25, Math.sin(angle) * hazardRadius * .42);
        bases.push(base);
        phases.push(index * .73);
        dummy.position.copy(base);
        dummy.scale.set(.82 + index % 3 * .12, .78 + index % 2 * .24, .82 + index % 3 * .12);
        dummy.updateMatrix();
        flames.setMatrixAt(index, dummy.matrix);
        flames.setColorAt(index, new THREE.Color(index % 2 ? weapon.color : 0xffd061));
      }
      flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.add(flames);
      fadeMaterials.push({ material: flames.material, baseOpacity: .46 });
      instances = { kind: "flame", mesh: flames, dummy, bases, phases };
    } else if (weapon.hazard === "black_hole") {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 10), new THREE.MeshBasicMaterial({ color: 0x210337, transparent: true, opacity: .58, depthWrite: false, toneMapped: false }));
      const vertical = new THREE.Mesh(new THREE.TorusGeometry(2.1, .13, 7, 28), ring.material.clone());
      vertical.material.opacity = .24;
      vertical.rotation.y = Math.PI / 2;
      mesh.add(core, vertical);
      fadeMaterials.push({ material: core.material, baseOpacity: .58 }, { material: vertical.material, baseOpacity: .24 });
    } else {
      const vortexMaterial = ring.material.clone();
      vortexMaterial.opacity = .1;
      vortexMaterial.side = THREE.DoubleSide;
      vortexMaterial.blending = THREE.NormalBlending;
      const ribbon = new THREE.Mesh(vortexRibbonGeometry(), vortexMaterial);
      ribbon.position.y = .18;
      mesh.add(ribbon);
      fadeMaterials.push({ material: vortexMaterial, baseOpacity: .1 });
      instances = { kind: "ribbon", mesh: ribbon };
    }
    return { mesh, radius: hazardRadius, instances, fadeMaterials };
}

/** All 24 gameplay hazards reuse these same render objects across their life. */
export class HazardVisualPool {
  constructor(parent, weapons) {
    this.group = new THREE.Group(); this.group.name = "Persistent hazard families"; parent.add(this.group);
    this.templates = new Map(); this.active = new Set(); this.free = [];
    this.dummy = new THREE.Object3D(); this.matrix = new THREE.Matrix4(); this.color = new THREE.Color();
    for (const weapon of Object.values(weapons)) {
      if (!weapon.hazard || this.templates.has(weapon.hazard)) continue;
      const source = createHazardVisual(weapon);
      const template = { radius: source.radius, layers: [], kind: weapon.hazard };
      for (const child of source.mesh.children) {
        const flames = child.isInstancedMesh, capacity = flames ? 24 * 9 : 24;
        const geometry = child.geometry;
        const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("hazardAlpha", alpha);
        const original = child.material;
        const material = emissiveEffectMaterial({ color: original.color, transparent: true, opacity: original.opacity,
          depthWrite: false, blending: original.blending, side: original.side, toneMapped: false });
        material.opacityNode = materialOpacity.mul(attribute("hazardAlpha", "float"));
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.name = `Hazard ${weapon.hazard}${flames ? " flame field" : " envelope"}`;
        mesh.count = 0; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, this.color.set(0xffffff)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        template.layers.push({ mesh, alpha, flames, basePosition: child.position.clone(), baseRotation: child.rotation.clone(), count: 0 });
        original.dispose();
      }
      this.templates.set(weapon.hazard, template);
    }
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Object3D();
      const entry = { mesh, radius: 0, instances: null, fadeMaterials: [], template: null, color: new THREE.Color(), born: 0 };
      mesh.userData.releaseVisual = () => {
        if (!this.active.delete(entry)) return;
        mesh.removeFromParent(); entry.template = null; this.free.push(entry);
      };
      this.free.push(entry);
    }
  }

  acquire(weapon) {
    const entry = this.free.pop();
    if (!entry) throw new Error("Hazard presentation capacity exhausted (24)");
    entry.template = this.templates.get(weapon.hazard); entry.radius = entry.template.radius;
    entry.mesh.position.set(0, 0, 0); entry.mesh.rotation.set(0, 0, 0); entry.mesh.scale.setScalar(1);
    entry.color.set(weapon.color); entry.born = this.time || 0; this.active.add(entry);
    return entry;
  }

  sync(camera, time = 0, reducedMotion = false) {
    this.time = time;
    for (const template of this.templates.values()) for (const layer of template.layers) layer.count = 0;
    for (const entry of this.active) {
      const template = entry.template, elapsed = reducedMotion ? 0 : time - entry.born;
      entry.mesh.updateMatrix();
      const proximity = camera ? THREE.MathUtils.clamp((camera.position.distanceTo(entry.mesh.position) - 2) / 7, .025, 1) : 1;
      for (const layer of template.layers) {
        for (let flame = 0; flame < (layer.flames ? 9 : 1); flame++) {
          const index = layer.count++;
          this.dummy.position.copy(layer.basePosition); this.dummy.rotation.copy(layer.baseRotation); this.dummy.scale.setScalar(1);
          if (layer.flames) {
            const angle = flame / 9 * Math.PI * 2, phase = flame * .73;
            const flicker = 1 + Math.sin(elapsed * 11 + phase) * .22;
            this.dummy.position.set(Math.cos(angle) * template.radius * .42, .65 + flame % 2 * .25, Math.sin(angle) * template.radius * .42);
            this.dummy.rotation.set(0, phase, 0); this.dummy.scale.set(flicker, .78 + flicker * .42, flicker);
          } else if (template.kind === "tornado" && layer.basePosition.y > 0) {
            this.dummy.rotation.y += elapsed * 1.8; this.dummy.scale.y = 1 + Math.sin(elapsed * 5) * .035;
          }
          this.dummy.updateMatrix(); this.matrix.multiplyMatrices(entry.mesh.matrix, this.dummy.matrix);
          layer.mesh.setMatrixAt(index, this.matrix); layer.alpha.setX(index, proximity);
          layer.mesh.setColorAt(index, layer.flames ? (flame % 2 ? entry.color : this.color.set(0xffd061)) : this.color.set(0xffffff));
        }
      }
    }
    for (const template of this.templates.values()) for (const layer of template.layers) {
      layer.mesh.count = layer.count;
      queueParticlePrefix(layer.mesh.instanceMatrix, layer.count); queueParticlePrefix(layer.mesh.instanceColor, layer.count);
      queueParticlePrefix(layer.alpha, layer.count);
    }
  }
}
