import * as THREE from "three/webgpu";
import { attribute, materialOpacity } from "three/tsl";
import { projectileHitRadius } from "./headshots.js";
import { queueParticlePrefix } from "./particleUploads.js";
import { weaponFireMode } from "./gameData.js";

// Match-owned meshes never change identity between warmup and live shots. The
// anchors contain transforms only: acquiring/releasing a shot touches no GPU
// resource. 4096 matches the existing persistent-fireball envelope.
export const PROJECTILE_BATCH_CAPACITY = 4096;
const IDENTITY = { color: 0xffffff, accent: 0xffffff };

export class ProjectileBatches {
  constructor(parent, weapons, createTemplate) {
    this.group = new THREE.Group(); this.group.name = "Persistent projectile family batches";
    parent.add(this.group);
    this.templates = new Map(); this.active = new Set(); this.free = [];
    this.matrix = new THREE.Matrix4(); this.local = new THREE.Matrix4(); this.anchorMatrix = new THREE.Matrix4();
    this.position = new THREE.Vector3(); this.scale = new THREE.Vector3();
    this.rotation = new THREE.Euler(); this.quaternion = new THREE.Quaternion(); this.color = new THREE.Color();
    for (const weapon of Object.values(weapons)) {
      if (weapon.presentationPayload === "fireball") continue;
      if (!["projectile", "spread", "mine"].includes(weaponFireMode(weapon))) continue;
      this.prepare(weapon, false, createTemplate);
      if (weapon.type === "mine") this.prepare(weapon, true, createTemplate);
      if (weapon.split) this.prepare({ ...weapon, id: `${weapon.id}_bomblet`, type: "grenade", split: 0,
        damage: Math.max(14, weapon.damage), projectileSpeed: 18, fuse: .62, gravity: 15,
        bounces: 1, bounceEnergy: .55, arcLift: 0, projectileRadius: .16 }, false, createTemplate);
    }
    for (let i = 0; i < PROJECTILE_BATCH_CAPACITY; i++) {
      const anchor = new THREE.Object3D();
      anchor.userData.combatVisual = { instancedProjectile: true, time: 0, lastPosition: new THREE.Vector3(), ownerColor: new THREE.Color() };
      anchor.userData.releaseVisual = () => this.release(anchor);
      this.free.push(anchor);
    }
  }

  prepare(weapon, mine, createTemplate) {
    const radius = mine ? .35 : projectileHitRadius(weapon);
    const source = createTemplate(weapon, IDENTITY, radius, { mine });
    const visual = source.userData.combatVisual;
    const template = { radius, family: visual.family, profile: visual.profile, layers: [], count: 0,
      ownerColors: null, pulseAlpha: null, fixedMatrix: null };
    for (const child of source.children) {
      const geometry = child.geometry.clone();
      // The source geometry is a session cache. Only batch-owned copies are
      // disposed with the match; never invalidate templates held by another match.
      delete geometry.userData.sharedProjectile;
      const material = child.material.clone();
      const payload = visual.payloadParts.find(part => part.mesh === child);
      const moving = visual.movingParts.includes(child), pulse = visual.pulseParts.some(part => part.mesh === child);
      const ownerTint = Boolean(material.userData.projectileOwnerTint), trail = child.userData.trail || null;
      const fixed = !moving && !payload && !trail;
      let alpha = null;
      if (pulse) {
        // All layers of one family enumerate exactly the same shots. Their
        // pulse is a property of the shot, not a separately allocated layer.
        alpha = template.pulseAlpha ||= new THREE.InstancedBufferAttribute(new Float32Array(PROJECTILE_BATCH_CAPACITY).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("projectileAlpha", alpha);
        material.opacityNode = (material.opacityNode || materialOpacity).mul(attribute("projectileAlpha", "float"));
      }
      if (fixed) {
        // M * radiusScale * localTransform * vertex is unchanged. Baking the
        // immutable local transform lets all rigid parts share one shot matrix.
        child.updateMatrix(); geometry.applyMatrix4(child.matrix);
        template.fixedMatrix ||= new THREE.InstancedBufferAttribute(new Float32Array(PROJECTILE_BATCH_CAPACITY * 16), 16).setUsage(THREE.DynamicDrawUsage);
      }
      const mesh = new THREE.InstancedMesh(geometry, material, PROJECTILE_BATCH_CAPACITY);
      mesh.name = `${weapon.id}${mine ? " mine" : ""} ${template.layers.length}`;
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = child.renderOrder;
      if (fixed) mesh.instanceMatrix = template.fixedMatrix;
      else mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (ownerTint) mesh.instanceColor = template.ownerColors ||= new THREE.InstancedBufferAttribute(new Float32Array(PROJECTILE_BATCH_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      template.layers.push({ mesh, alpha, basePosition: child.position.clone(), baseScale: child.scale.clone(),
        baseRotation: child.rotation.clone(), ownerTint, fixed, moving, pulse,
        payload: payload?.motion, trail, count: 0 });
    }
    const materials = new Set(source.children.map(child => child.material));
    for (const material of materials) material.dispose();
    this.templates.set(`${weapon.id}:${mine ? 1 : 0}`, template);
  }

  acquire(owner, weapon, radius, { mine = false } = {}) {
    const template = this.templates.get(`${weapon.id}:${mine ? 1 : 0}`) || this.templates.get(`${weapon.id}:0`);
    if (!template) throw new Error(`Projectile family was not prepared: ${weapon.id}`);
    // Gameplay already bounds shots by ammunition/lifetime. Report a broken
    // envelope explicitly instead of silently omitting a visible projectile.
    const anchor = this.free.pop();
    if (!anchor) throw new Error("Projectile presentation capacity exhausted (4096)");
    anchor.position.set(0, 0, 0); anchor.quaternion.identity(); anchor.scale.setScalar(1); anchor.visible = true;
    const visual = anchor.userData.combatVisual;
    Object.assign(visual, { template, family: template.family, profile: template.profile, radiusScale: radius / template.radius,
      time: 0, travel: 0, moving: false, hasLastPosition: false });
    visual.ownerColor.set(owner?.accent ?? owner?.color ?? weapon.color);
    this.active.add(anchor);
    return anchor;
  }

  release(anchor) {
    if (!this.active.delete(anchor)) return;
    anchor.removeFromParent(); anchor.userData.combatVisual.template = null;
    this.free.push(anchor);
  }

  sync() {
    for (const template of this.templates.values()) {
      template.count = 0;
      for (const layer of template.layers) layer.count = 0;
    }
    for (const anchor of this.active) {
      const visual = anchor.userData.combatVisual, template = visual.template;
      const index = template.count++;
      anchor.updateMatrix();
      const pulse = .82 + Math.sin(visual.time * (template.family === "plasma" ? 14 : 9)) * .18;
      const spin = visual.time * (template.family === "disc" ? 22 : template.family === "grenade" ? 7 : 3.5);
      template.ownerColors?.setXYZ(index, visual.ownerColor.r, visual.ownerColor.g, visual.ownerColor.b);
      template.pulseAlpha?.setX(index, pulse);
      if (template.fixedMatrix) {
        this.anchorMatrix.copy(anchor.matrix).scale(this.scale.setScalar(visual.radiusScale));
        this.anchorMatrix.toArray(template.fixedMatrix.array, index * 16);
      }
      for (const layer of template.layers) {
        layer.count++;
        if (layer.fixed) continue;
        this.position.copy(layer.basePosition); this.scale.copy(layer.baseScale); this.rotation.copy(layer.baseRotation);
        if (layer.moving) this.rotation.z += spin;
        if (layer.trail) {
          const { axis, length, offset } = layer.trail;
          const visibleLength = visual.moving ? Math.max(length, visual.travel + .28) : length * .12;
          this.scale[axis] *= visibleLength / length; this.position.z = -visibleLength * offset;
        }
        let payloadScale = 1;
        if (layer.payload === "inward") payloadScale = 1.18 - (visual.time * 2.4 % 1) * .42;
        else if (layer.payload === "crystal") payloadScale = .92 + Math.sin(visual.time * 13) * .1;
        else if (layer.payload === "scan") this.position.z += Math.sin(visual.time * 9) * .14;
        else if (layer.payload === "hoop") payloadScale = .86 + Math.sin(visual.time * 10) * .15;
        else if (layer.payload === "drill") this.rotation.z += visual.time * 24;
        this.scale.multiplyScalar(payloadScale * visual.radiusScale); this.position.multiplyScalar(visual.radiusScale);
        this.quaternion.setFromEuler(this.rotation);
        this.local.compose(this.position, this.quaternion, this.scale);
        this.matrix.multiplyMatrices(anchor.matrix, this.local);
        layer.mesh.setMatrixAt(index, this.matrix);
      }
    }
    for (const template of this.templates.values()) {
      queueParticlePrefix(template.ownerColors, template.count);
      queueParticlePrefix(template.pulseAlpha, template.count);
      queueParticlePrefix(template.fixedMatrix, template.count);
      for (const layer of template.layers) {
        layer.mesh.count = layer.count;
        // Three updates dynamic instance buffers before rejecting a zero-count
        // draw. Keep idle families out of the render list, retaining all pools.
        layer.mesh.visible = layer.count > 0;
        if (!layer.fixed) queueParticlePrefix(layer.mesh.instanceMatrix, layer.count);
      }
    }
  }
}
