import * as THREE from "three/webgpu";
import { weaponPresentation } from "./weaponPresentation.js";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const BLACK = new THREE.Color(0x000000);
const WHITE = new THREE.Color(0xffffff);
const FIRE = new THREE.Color(0xff5a1f);
const FIRE_HOT = new THREE.Color(0xffd36a);
const FIRE_DARK = new THREE.Color(0xff2608);
const HDR_GLOW = 2.2;
const FIRE_TONGUES = [
  ["flameA", 0, 0, 3.4, .72, 0],
  ["flameB", .54, .24, 2.45, .46, 2.1],
  ["flameC", -.5, -.18, 2.15, .4, 4.3]
];
export const FIREBALL_INSTANCE_CAPACITY = 4096;

function glowMaterial(opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffffff).multiplyScalar(HDR_GLOW),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
}

function visualMesh(geometry, material, position = null) {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.copy(position);
  mesh.frustumCulled = false;
  return mesh;
}

function ownerColor(owner, weapon) {
  return new THREE.Color(owner?.accent ?? owner?.color ?? weapon.color);
}

function isCloseRapid(profile, weapon) {
  return profile.rapid
    && profile.delivery === "projectile"
    && weapon.hitscan
    && weapon.maxUsefulRange <= 40
    && weapon.spread >= .04;
}

function impactFamily(profile, explosive) {
  if (["gravity", "implosion", "freeze", "disrupt", "cluster", "sticky", "ricochet", "drill", "pulse"].includes(profile.payload)) return profile.payload;
  if (["teleport", "steal", "wall", "decoy"].includes(profile.payload)) return "scan";
  if (profile.delivery === "flame" || ["napalm", "fireball"].includes(profile.payload)) return "flame";
  if (["plasma", "wall", "decoy"].includes(profile.delivery)) return "plasma";
  if (profile.precision) return "precision";
  if (profile.delivery === "chain") return "arc";
  if (profile.delivery === "melee") return "melee";
  if (explosive || profile.payload === "blast") return "blast";
  return "kinetic";
}

function addTail(group, radius, length, material) {
  const tail = visualMesh(new THREE.ConeGeometry(radius, length, 6, 1, true), material);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -length * .55;
  tail.userData.trail = { axis: "y", length, offset: .55 };
  group.add(tail);
  return tail;
}

function addScreenTrail(group, radius, length, color) {
  const trailMaterial = glowMaterial(.82);
  trailMaterial.color.copy(color).multiplyScalar(HDR_GLOW);
  return addTail(group, Math.max(.08, radius), length, trailMaterial);
}

function addPayloadDecorator(group, profile, radius, materials, movingParts, pulseParts) {
  const decoratedPayloads = [
    "gravity", "implosion", "freeze", "teleport", "steal", "disrupt", "cluster", "sticky",
    "ricochet", "drill", "wall", "decoy", "tornado", "napalm", "penetrator", "pulse", "mortar"
  ];
  if (!decoratedPayloads.includes(profile.payload)) return [];
  const identity = materials.identity().clone();
  const payloadParts = [];
  let mesh;
  let motion = "spin";
  if (profile.payload === "gravity" || profile.payload === "implosion") {
    mesh = visualMesh(new THREE.TorusGeometry(radius * 1.8, radius * .12, 5, 18), identity);
    mesh.rotation.x = Math.PI / 2;
    motion = "inward";
  } else if (profile.payload === "freeze") {
    identity.wireframe = true;
    mesh = visualMesh(new THREE.OctahedronGeometry(radius * 1.75, 0), identity);
    mesh.scale.set(.72, 1.45, .72);
    motion = "crystal";
  } else if (profile.payload === "teleport" || profile.payload === "steal") {
    mesh = profile.payload === "teleport"
      ? visualMesh(new THREE.TorusGeometry(radius * 1.75, radius * .09, 4, 18), identity)
      : visualMesh(new THREE.TorusKnotGeometry(radius * .78, radius * .11, 24, 4, 2, 3), identity);
    mesh.rotation.x = Math.PI / 2;
    motion = "scan";
  } else if (profile.payload === "disrupt") {
    mesh = visualMesh(new THREE.TorusGeometry(radius * 2.05, radius * .09, 4, 20), identity);
    mesh.rotation.x = Math.PI / 2;
    motion = "hoop";
  } else if (profile.payload === "cluster") {
    mesh = visualMesh(new THREE.TorusGeometry(radius * 1.52, radius * .2, 3, 6), identity);
    mesh.rotation.x = Math.PI / 2;
  } else if (profile.payload === "sticky") {
    mesh = visualMesh(new THREE.TorusGeometry(radius * 1.34, radius * .16, 4, 8), identity);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = -radius * .28;
    motion = "armed";
  } else if (profile.payload === "ricochet") {
    identity.wireframe = true;
    mesh = visualMesh(new THREE.OctahedronGeometry(radius * 1.42, 0), identity);
    mesh.rotation.z = Math.PI / 4;
  } else if (profile.payload === "drill") {
    mesh = visualMesh(new THREE.ConeGeometry(radius * 1.18, radius * 2.7, 7), materials.hot);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = radius * 1.75;
    motion = "drill";
  } else if (profile.payload === "wall") {
    identity.wireframe = true;
    mesh = visualMesh(new THREE.BoxGeometry(radius * 2.15, radius * 1.55, radius * .48), identity);
    motion = "scan";
  } else if (profile.payload === "decoy") {
    identity.wireframe = true;
    mesh = visualMesh(new THREE.DodecahedronGeometry(radius * 1.42, 0), identity);
    motion = "scan";
  } else if (profile.payload === "tornado") {
    mesh = visualMesh(new THREE.TorusKnotGeometry(radius * .78, radius * .1, 22, 4, 2, 3), identity);
    motion = "hoop";
  } else if (profile.payload === "napalm") {
    mesh = visualMesh(new THREE.TorusGeometry(radius * 1.4, radius * .13, 4, 9), identity);
    mesh.rotation.x = Math.PI / 2;
    motion = "armed";
  } else if (profile.payload === "penetrator") {
    mesh = visualMesh(new THREE.BoxGeometry(radius * .38, radius * .38, radius * 3.3), identity);
    motion = "drill";
  } else if (profile.payload === "pulse") {
    mesh = visualMesh(new THREE.TorusGeometry(radius * 1.62, radius * .12, 5, 20), identity);
    mesh.rotation.x = Math.PI / 2;
    motion = "hoop";
  } else if (profile.payload === "mortar") {
    mesh = visualMesh(new THREE.ConeGeometry(radius * .72, radius * 1.65, 6, 1, true), identity);
    mesh.rotation.x = Math.PI;
    mesh.position.y = radius * 1.35;
    motion = "armed";
  }
  if (!mesh) return payloadParts;
  group.add(mesh);
  movingParts.push(mesh);
  pulseParts.push(mesh);
  payloadParts.push({ mesh, motion, baseScale: mesh.scale.clone(), basePosition: mesh.position.clone() });
  return payloadParts;
}

/**
 * Creates one gameplay projectile with a weapon-shaped core and a shooter-colored trail.
 * The returned Group is a drop-in replacement for the Mesh currently stored on `shot.mesh`.
 */
export function createProjectileVisual(weapon, owner, collisionRadius = .11, { mine = false } = {}) {
  const group = new THREE.Group();
  const radius = Math.max(.08, collisionRadius);
  const profile = weaponPresentation(weapon);
  const family = mine ? "grenade" : ["wall", "decoy"].includes(profile.delivery) ? "plasma" : profile.delivery;
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(weapon.color).multiplyScalar(1.85), toneMapped: false });
  const hot = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3), toneMapped: false });
  const shotIdentity = ownerColor(owner, weapon);
  let identity;
  const identityMaterial = () => {
    if (!identity) {
      identity = glowMaterial(.72);
      identity.color.copy(shotIdentity).multiplyScalar(HDR_GLOW);
    }
    return identity;
  };
  let softIdentity;
  const soft = () => {
    if (!softIdentity) {
      softIdentity = identityMaterial().clone();
      softIdentity.opacity = .34;
    }
    return softIdentity;
  };
  const movingParts = [];
  const pulseParts = [];
  const speedTail = profile.trailLength;

  if (family === "rail") {
    addScreenTrail(group, Math.max(.14, radius * 1.18), Math.max(4.2, speedTail), shotIdentity);
    const needle = visualMesh(new THREE.BoxGeometry(radius * .72, radius * .72, 2.45), hot);
    needle.position.z = -.55;
    const railHalo = visualMesh(new THREE.OctahedronGeometry(radius * 1.18, 0), core);
    railHalo.scale.z = 2.1;
    group.add(needle, railHalo);
    pulseParts.push(railHalo);
  } else if (family === "rocket") {
    const dark = new THREE.MeshStandardMaterial({ color: 0x07101c, roughness: .32, metalness: .65 });
    const body = visualMesh(new THREE.CylinderGeometry(radius * .68, radius * .9, radius * 2.7, 8), dark);
    body.rotation.x = Math.PI / 2;
    const nose = visualMesh(new THREE.ConeGeometry(radius * .82, radius * 1.45, 8), core);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = radius * 1.85;
    const band = visualMesh(new THREE.TorusGeometry(radius * .83, radius * .15, 5, 12), identityMaterial());
    band.position.z = -.1;
    const flame = visualMesh(new THREE.ConeGeometry(radius * .62, radius * 1.2, 6), hot);
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -radius * 1.76;
    group.add(body, nose, band, flame);
    pulseParts.push(flame, addTail(group, radius * 1.6, Math.max(1.65, speedTail), soft()));
  } else if (family === "grenade") {
    const shell = visualMesh(new THREE.IcosahedronGeometry(radius, 0), core);
    const cageMaterial = identityMaterial().clone();
    cageMaterial.wireframe = true;
    const cage = visualMesh(new THREE.IcosahedronGeometry(radius * 1.36, 1), cageMaterial);
    const belt = visualMesh(new THREE.TorusGeometry(radius * 1.08, radius * .13, 5, 12), identityMaterial());
    belt.rotation.x = Math.PI / 2;
    const fuse = visualMesh(new THREE.OctahedronGeometry(radius * .33, 0), hot);
    fuse.position.y = radius * 1.2;
    group.add(shell, cage, belt, fuse);
    movingParts.push(cage, belt);
    pulseParts.push(cage, fuse);
    if (!mine) {
      for (let index = 0; index < 3; index++) {
        const dot = visualMesh(new THREE.SphereGeometry(radius * (.42 - index * .07), 6, 4), soft());
        dot.position.z = -radius * (2.2 + index * 1.45);
        group.add(dot);
      }
    }
  } else if (profile.payload === "fireball") {
    const auraMaterial = soft().clone();
    auraMaterial.color.copy(FIRE_DARK).multiplyScalar(1.8);
    const flameMaterial = glowMaterial(.78);
    flameMaterial.color.copy(FIRE).multiplyScalar(2.5);
    const aura = visualMesh(new THREE.SphereGeometry(radius * 1.42, 9, 7), auraMaterial);
    const ember = visualMesh(new THREE.SphereGeometry(radius, 11, 8), core);
    const whiteCore = visualMesh(new THREE.IcosahedronGeometry(radius * .54, 1), hot);
    const flames = [
      [0, .12, 2.7, .62],
      [.48, -.12, 1.9, .38],
      [-.42, .22, 1.65, .34]
    ].map(([x, y, length, width]) => {
      const flame = visualMesh(new THREE.ConeGeometry(radius * width, radius * length, 7, 1, true), flameMaterial);
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(radius * x, radius * y, -radius * length * .48);
      return flame;
    });
    group.add(aura, ember, whiteCore, ...flames);
    movingParts.push(ember, ...flames);
    pulseParts.push(aura, whiteCore, ...flames, addTail(group, radius * .68, Math.max(1.7, speedTail * 1.15), flameMaterial.clone()));
  } else if (family === "plasma") {
    const orb = visualMesh(new THREE.SphereGeometry(radius, 10, 8), core);
    const hotOrb = visualMesh(new THREE.OctahedronGeometry(radius * .48, 1), hot);
    const cageMaterial = identityMaterial().clone();
    cageMaterial.wireframe = true;
    const cage = visualMesh(new THREE.IcosahedronGeometry(radius * 1.38, 1), cageMaterial);
    const orbit = visualMesh(new THREE.TorusGeometry(radius * 1.55, radius * .08, 4, 16), identityMaterial());
    orbit.rotation.x = Math.PI / 2;
    group.add(orb, hotOrb, cage, orbit);
    movingParts.push(cage, orbit);
    pulseParts.push(cage, orbit, addTail(group, radius * .8, Math.max(.65, speedTail * .75), soft()));
  } else if (family === "disc") {
    const blade = visualMesh(new THREE.TorusGeometry(radius * 1.15, radius * .28, 6, 16), core);
    const rim = visualMesh(new THREE.TorusGeometry(radius * 1.52, radius * .09, 5, 18), identityMaterial());
    blade.rotation.x = rim.rotation.x = Math.PI / 2;
    const hub = visualMesh(new THREE.OctahedronGeometry(radius * .48, 0), hot);
    group.add(blade, rim, hub);
    movingParts.push(blade, rim);
    pulseParts.push(addTail(group, radius * .45, speedTail, soft()));
  } else {
    const length = Math.max(.18, radius * 2.8);
    const bolt = visualMesh(new THREE.CapsuleGeometry(radius * .62, length, 2, 6), hot);
    bolt.rotation.x = Math.PI / 2;
    const tip = visualMesh(new THREE.ConeGeometry(radius * .92, Math.max(.22, radius * 2), 5), core);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = Math.max(.12, radius * 1.4);
    const fast = profile.rapid || profile.delivery === "spread";
    group.add(bolt, tip);
    const trailRadius = Math.max(radius * .82, profile.trailWidth);
    if (fast) {
      addScreenTrail(group, trailRadius, speedTail, shotIdentity);
    } else {
      const collar = visualMesh(new THREE.TorusGeometry(radius * .82, radius * .1, 4, 10), identityMaterial());
      collar.position.z = -length * .3;
      group.add(collar);
      pulseParts.push(collar, addTail(group, trailRadius, speedTail, soft()));
    }
  }

  const payloadParts = addPayloadDecorator(
    group,
    profile,
    radius,
    { core, hot, identity: identityMaterial },
    movingParts,
    pulseParts
  );

  group.userData.combatVisual = {
    family, profile,
    time: 0,
    movingParts, payloadParts,
    trailParts: group.children.filter((mesh) => mesh.userData.trail),
    pulseParts: pulseParts.map((mesh) => ({ mesh, opacity: mesh.material.opacity }))
  };
  return group;
}

function instancedLayer(geometry, capacity, opacity) {
  const mesh = new THREE.InstancedMesh(geometry, glowMaterial(opacity), capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  for (let index = 0; index < capacity; index++) {
    mesh.setMatrixAt(index, HIDDEN);
    mesh.setColorAt(index, BLACK);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function slots(length) {
  return Array.from({ length }, () => ({ life: 0 }));
}

/** Capped, pooled combat effects: seven draw calls regardless of fire rate. */
export class CombatVisuals {
  constructor(scene, { reducedMotion = false, quality = 1 } = {}) {
    this.scene = scene;
    this.reducedMotion = reducedMotion;
    this.quality = clamp(quality, .5, 1);
    this.group = new THREE.Group();
    this.group.name = "Combat visuals";
    scene.add(this.group);

    const flashCapacity = Math.round(40 * this.quality);
    const tracerCapacity = Math.round(72 * this.quality);
    const ringCapacity = Math.round(36 * this.quality);
    const sparkCapacity = Math.round(180 * this.quality);
    this.flashes = slots(flashCapacity);
    this.tracers = slots(tracerCapacity);
    this.rings = slots(ringCapacity);
    this.sparks = slots(sparkCapacity);
    this.cursors = { flash: 0, tracer: 0, ring: 0, spark: 0 };

    this.flashOuter = instancedLayer(new THREE.ConeGeometry(1, 1, 6, 1, true), flashCapacity, .42);
    this.flashInner = instancedLayer(new THREE.ConeGeometry(1, 1, 6), flashCapacity, 1);
    this.tracerOuter = instancedLayer(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), tracerCapacity, .44);
    this.tracerOuter.material.blending = THREE.NormalBlending;
    this.tracerOuter.material.opacity = .62;
    this.tracerOuter.renderOrder = 7;
    this.tracerInner = instancedLayer(new THREE.CylinderGeometry(1, 1, 1, 6), tracerCapacity, .96);
    this.ringOuter = instancedLayer(new THREE.TorusGeometry(1, .052, 5, 24), ringCapacity, .34);
    this.ringInner = instancedLayer(new THREE.TorusGeometry(1, .026, 4, 24), ringCapacity, .78);
    this.sparkLayer = instancedLayer(new THREE.OctahedronGeometry(1, 0), sparkCapacity, .92);
    this.group.add(this.flashOuter, this.flashInner, this.tracerOuter, this.tracerInner, this.ringOuter, this.ringInner, this.sparkLayer);

    this.fireballs = new Set();
    this.fireballGroup = new THREE.Group();
    this.fireballGroup.name = "Instanced persistent Fireballs";
    this.fireballLayers = {
      aura: instancedLayer(new THREE.SphereGeometry(1, 8, 6), FIREBALL_INSTANCE_CAPACITY, .2),
      shell: instancedLayer(new THREE.SphereGeometry(1, 11, 8), FIREBALL_INSTANCE_CAPACITY, .96),
      core: instancedLayer(new THREE.IcosahedronGeometry(1, 1), FIREBALL_INSTANCE_CAPACITY, 1),
      flameA: instancedLayer(new THREE.ConeGeometry(1, 1, 7, 1, true), FIREBALL_INSTANCE_CAPACITY, .86),
      flameB: instancedLayer(new THREE.ConeGeometry(1, 1, 7, 1, true), FIREBALL_INSTANCE_CAPACITY, .72),
      flameC: instancedLayer(new THREE.ConeGeometry(1, 1, 7, 1, true), FIREBALL_INSTANCE_CAPACITY, .62),
      cinder: instancedLayer(new THREE.DodecahedronGeometry(1, 0), FIREBALL_INSTANCE_CAPACITY, .9)
    };
    this.fireballLayerList = Object.values(this.fireballLayers);
    for (const layer of this.fireballLayerList) {
      layer.count = 0;
      this.fireballGroup.add(layer);
    }
    this.group.add(this.fireballGroup);

    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.twistQuaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.color = new THREE.Color();
    this.normal = new THREE.Vector3();
    this.fireSide = new THREE.Vector3();
    this.fireRise = new THREE.Vector3();
    this.fireBack = new THREE.Vector3();
  }

  setReducedMotion(reducedMotion) {
    this.reducedMotion = Boolean(reducedMotion);
  }

  createProjectile(owner, weapon, radius, options) {
    if (weapon.presentationPayload === "fireball") {
      const anchor = new THREE.Object3D();
      anchor.userData.combatVisual = {
        instancedFireball: true,
        time: 0,
        radius,
        weaponColor: new THREE.Color(weapon.color),
        ownerColor: ownerColor(owner, weapon)
      };
      this.fireballs.add(anchor);
      return anchor;
    }
    return createProjectileVisual(weapon, owner, radius, options);
  }

  removeProjectile(shot) {
    if (shot?.mesh?.userData?.combatVisual?.instancedFireball) this.fireballs.delete(shot.mesh);
  }

  updateProjectile(shot, dt) {
    const visual = shot.mesh?.userData?.combatVisual;
    if (!visual) return;
    visual.time += dt;
    if (visual.instancedFireball) return;
    const moving = shot.velocity?.lengthSq() > .001;
    if (moving) {
      this.direction.copy(shot.velocity).normalize();
      shot.mesh.lookAt(this.position.copy(shot.mesh.position).add(this.direction));
    }
    const travel = visual.lastPosition
      ? visual.lastPosition.distanceTo(shot.mesh.position)
      : moving ? shot.velocity.length() * dt : 0;
    if (!visual.lastPosition) visual.lastPosition = new THREE.Vector3();
    visual.lastPosition.copy(shot.mesh.position);
    for (const tail of visual.trailParts) {
      const { axis, length, offset, screen } = tail.userData.trail;
      const visibleLength = moving ? Math.max(length, travel + .28) : length * .12;
      tail.scale[axis] = screen ? visibleLength : visibleLength / length;
      if (!screen) tail.position.z = -visibleLength * offset;
    }
    const spin = dt * (visual.family === "disc" ? 22 : visual.family === "grenade" ? 7 : 3.5);
    for (const part of visual.movingParts) part.rotation.z += spin;
    const pulse = .82 + Math.sin(visual.time * (visual.family === "plasma" ? 14 : 9)) * .18;
    for (const { mesh, opacity } of visual.pulseParts) mesh.material.opacity = opacity * pulse;
    for (const part of visual.payloadParts || []) {
      let scale = 1;
      if (part.motion === "inward") scale = 1.18 - (visual.time * 2.4 % 1) * .42;
      else if (part.motion === "crystal") scale = .92 + Math.sin(visual.time * 13) * .1;
      else if (part.motion === "scan") part.mesh.position.z = part.basePosition.z + Math.sin(visual.time * 9) * .14;
      else if (part.motion === "hoop") scale = .86 + Math.sin(visual.time * 10) * .15;
      else if (part.motion === "drill") part.mesh.rotation.z += dt * 24;
      part.mesh.scale.copy(part.baseScale).multiplyScalar(scale);
    }
  }

  muzzle(owner, weapon, direction = owner?.aim) {
    if (!owner || !weapon || !direction?.lengthSq()) return;
    const slot = this.flashes[this.cursors.flash++ % this.flashes.length];
    const profile = weaponPresentation(weapon);
    slot.life = slot.maxLife = this.reducedMotion ? .075 : profile.precision ? .15 : profile.tempo === "heavy" ? .135 : profile.rapid ? .115 : .1;
    slot.position = owner.muzzlePoint?.(slot.position || new THREE.Vector3()) || owner.forwardPoint(.9);
    slot.direction = (slot.direction || new THREE.Vector3()).copy(direction).normalize();
    slot.weaponColor = (slot.weaponColor || new THREE.Color()).set(weapon.color);
    slot.ownerColor = (slot.ownerColor || new THREE.Color()).copy(ownerColor(owner, weapon));
    slot.profile = profile;
    slot.closeRapid = isCloseRapid(profile, weapon);
    slot.length = profile.muzzleLength * (.94 + profile.signature * .12);
    slot.width = profile.muzzleWidth;
    if (slot.closeRapid) {
      slot.length *= .68;
      slot.width *= 1.28;
      slot.life = slot.maxLife = this.reducedMotion ? .06 : .085;
    } else if (profile.delivery === "melee") {
      slot.length *= .46;
      slot.width *= 1.35;
    } else if (profile.delivery === "flame") {
      slot.length *= .72;
      slot.width *= 1.65;
    }
    if (weapon.type !== "mine" && weapon.type !== "melee" && weapon.type !== "flame") {
      const end = slot.position.clone().addScaledVector(slot.direction, slot.length * 1.45);
      this.addTracer(slot.position, end, weapon, owner, this.reducedMotion ? .06 : .085, profile.rapid ? .072 : .06);
    }
  }

  tracer(start, end, weapon, owner, { life = .14, width = .055 } = {}) {
    if (!start || !end || !weapon || start.distanceToSquared(end) < .0001) return;
    const profile = weaponPresentation(weapon);
    if (isCloseRapid(profile, weapon)) {
      const direction = end.clone().sub(start);
      const distance = direction.length();
      const readableDistance = Math.min(distance, 11 + profile.signature * 4);
      const readableEnd = start.clone().addScaledVector(direction.multiplyScalar(1 / distance), readableDistance);
      this.addTracer(start, readableEnd, weapon, owner, Math.min(life, .095), width * 1.18);
      return;
    }
    if (profile.delivery === "melee") {
      const direction = this.direction.copy(end).sub(start).normalize();
      const side = this.normal.crossVectors(direction, UP);
      if (side.lengthSq() < .01) side.set(1, 0, 0);
      else side.normalize();
      if (["thrust", "stab", "punch"].includes(weapon.meleeMotion)) {
        this.addTracer(start, end, weapon, owner, life, width * (weapon.meleeMotion === "punch" ? 1.45 : .82));
        if (weapon.meleeMotion === "punch") {
          this.addTracer(start.clone().addScaledVector(side, width * 1.8), end.clone().addScaledVector(side, width * .45), weapon, owner, life * .72, width * .55);
        }
        return;
      }
      if (weapon.meleeMotion === "overhead") {
        const apex = start.clone().lerp(end, .48).addScaledVector(UP, Math.min(1.8, start.distanceTo(end) * .5));
        this.addTracer(start, apex, weapon, owner, life, width * 1.25);
        this.addTracer(apex, end, weapon, owner, life * .86, width * 1.5);
        return;
      }
      if (weapon.meleeMotion === "shock") {
        const points = [start.clone()];
        for (let index = 1; index < 4; index++) points.push(start.clone().lerp(end, index / 4).addScaledVector(side, (index % 2 ? 1 : -1) * .18));
        points.push(end.clone());
        for (let index = 0; index < points.length - 1; index++) this.addTracer(points[index], points[index + 1], weapon, owner, life, width * .72);
        return;
      }
      if (weapon.meleeMotion === "saw") {
        this.addTracer(start, end, weapon, owner, life, width * 1.35);
        this.addTracer(start.clone().addScaledVector(side, .13), end.clone().addScaledVector(side, -.13), weapon, owner, life * .7, width * .55);
        return;
      }
      const midpoint = start.clone().lerp(end, .54)
        .addScaledVector(side, (profile.signature < .5 ? -1 : 1) * Math.min(start.distanceTo(end) * .3, .55 + (weapon.arc || .4)))
        .addScaledVector(UP, .22 + (weapon.arc || .4) * .25);
      this.addTracer(start, midpoint, weapon, owner, life, width);
      this.addTracer(midpoint, end, weapon, owner, life * .82, width * .82);
      return;
    }
    if (profile.delivery === "beam" && profile.payload === "gravity") {
      const direction = this.direction.copy(end).sub(start).normalize();
      const side = this.normal.crossVectors(direction, UP);
      if (side.lengthSq() < .01) side.set(1, 0, 0);
      else side.normalize();
      this.addTracer(start, end, weapon, owner, life, width);
      for (const offset of [-1, 1]) {
        this.addTracer(
          start.clone().addScaledVector(side, offset * width * 2.2),
          end.clone().addScaledVector(side, offset * width * 2.2),
          weapon, owner, life * .86, width * .38
        );
      }
      return;
    }
    if (profile.delivery === "beam" && profile.payload === "penetrator") {
      const direction = this.direction.copy(end).sub(start).normalize();
      const side = this.normal.crossVectors(direction, UP);
      if (side.lengthSq() < .01) side.set(1, 0, 0);
      else side.normalize();
      const offset = width * (1.2 + profile.signature);
      this.addTracer(start.clone().addScaledVector(side, -offset), end.clone().addScaledVector(side, offset), weapon, owner, life, width * .72);
      this.addTracer(start.clone().addScaledVector(side, offset), end.clone().addScaledVector(side, -offset), weapon, owner, life * .88, width * .72);
      return;
    }
    if (weapon.type !== "chain") return this.addTracer(start, end, weapon, owner, life, width);

    const direction = this.direction.copy(end).sub(start).normalize();
    const side = this.normal.crossVectors(direction, UP);
    if (side.lengthSq() < .01) side.set(1, 0, 0);
    else side.normalize();
    const points = [start.clone()];
    for (let index = 1; index < 4; index++) {
      const point = start.clone().lerp(end, index / 4);
      point.addScaledVector(side, (index % 2 ? 1 : -1) * .24);
      point.y += index % 2 ? .12 : -.12;
      points.push(point);
    }
    points.push(end.clone());
    for (let index = 0; index < points.length - 1; index++) this.addTracer(points[index], points[index + 1], weapon, owner, life, width);
  }

  flameStream(origin, direction, weapon, owner, distance) {
    if (!origin || !direction?.lengthSq() || distance <= .05) return;
    const forward = direction.clone().normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP);
    if (right.lengthSq() < .01) right.set(1, 0, 0);
    else right.normalize();
    const rise = new THREE.Vector3().crossVectors(right, forward).normalize();
    const ownerTint = ownerColor(owner, weapon);
    const streams = [
      { length: 1, side: 0, lift: .035, width: .13 },
      { length: .78, side: -.12, lift: .1, width: .105 },
      { length: .62, side: .14, lift: -.045, width: .09 }
    ];
    for (const stream of streams) {
      const end = origin.clone().addScaledVector(forward, distance * stream.length);
      end.addScaledVector(right, distance * stream.side).addScaledVector(rise, distance * stream.lift);
      this.addTracer(origin, end, weapon, owner, .1, stream.width);
    }

    const sparks = this.reducedMotion ? 2 : 4;
    for (let index = 0; index < sparks; index++) {
      const fraction = .18 + (index + Math.random() * .45) / sparks * .78;
      const spark = this.sparks[this.cursors.spark++ % this.sparks.length];
      spark.life = spark.maxLife = .16 + Math.random() * .13;
      spark.position = (spark.position || new THREE.Vector3()).copy(origin).addScaledVector(forward, distance * fraction);
      spark.position.addScaledVector(right, (Math.random() - .5) * distance * fraction * .18);
      spark.position.addScaledVector(rise, (Math.random() - .35) * distance * fraction * .11);
      spark.velocity = (spark.velocity || new THREE.Vector3()).copy(forward).multiplyScalar(2 + Math.random() * 3).addScaledVector(rise, 1.2 + Math.random() * 2.4);
      spark.color = (spark.color || new THREE.Color()).copy(index % 3 ? new THREE.Color(weapon.color) : ownerTint);
      spark.size = .11 + fraction * .12;
      spark.family = "flame";
      spark.gravity = -1.5;
    }
  }

  addTracer(start, end, weapon, owner, life, width) {
    const slot = this.tracers[this.cursors.tracer++ % this.tracers.length];
    const profile = weaponPresentation(weapon);
    slot.life = slot.maxLife = profile.rapid ? Math.max(.1, life) : life;
    slot.start = (slot.start || new THREE.Vector3()).copy(start);
    slot.end = (slot.end || new THREE.Vector3()).copy(end);
    slot.weaponColor = (slot.weaponColor || new THREE.Color()).set(weapon.color);
    slot.ownerColor = (slot.ownerColor || new THREE.Color()).copy(ownerColor(owner, weapon));
    slot.profile = profile;
    slot.closeRapid = isCloseRapid(profile, weapon);
    slot.width = Math.max(width, profile.trailWidth * .52)
      * (profile.delivery === "rail" ? 1.25 : profile.delivery === "beam" ? 1.08 : slot.closeRapid ? 1.18 : 1);
    slot.outerWidth = profile.precision ? 4.6 : slot.closeRapid ? 3.55 : profile.rapid ? 4.15 : profile.delivery === "melee" ? 2.25 : 3;
  }

  impact(position, weapon, owner, { size = 1.5, normal = null, explosive = false } = {}) {
    if (!position || !weapon) return;
    const profile = weaponPresentation(weapon);
    const family = isCloseRapid(profile, weapon) ? "closeRapid" : impactFamily(profile, explosive);
    const ring = this.rings[this.cursors.ring++ % this.rings.length];
    ring.life = ring.maxLife = ["gravity", "implosion"].includes(family) ? .46
      : ["freeze", "disrupt", "scan", "pulse"].includes(family) ? .36
        : family === "blast" || family === "cluster" ? .34
          : family === "plasma" ? .4
            : family === "closeRapid" ? .19
        : family === "precision" ? .2
          : family === "flame" ? .18
          : .28;
    ring.position = (ring.position || new THREE.Vector3()).copy(position);
    ring.normal = (ring.normal || new THREE.Vector3()).copy(normal || (!explosive && owner?.aim) || UP).normalize();
    ring.weaponColor = (ring.weaponColor || new THREE.Color()).set(weapon.color);
    ring.ownerColor = (ring.ownerColor || new THREE.Color()).copy(ownerColor(owner, weapon));
    ring.size = size * (.78 + profile.impactScale * .22);
    ring.family = family;
    ring.profile = profile;

    const blastLike = family === "blast" || family === "cluster"
      || (explosive && !["gravity", "implosion", "pulse", "disrupt"].includes(family));
    const count = this.reducedMotion ? 3
      : blastLike ? 14
        : family === "freeze" ? 10
          : family === "gravity" || family === "implosion" || family === "disrupt" ? 8
            : family === "closeRapid" ? 4
        : family === "flame" ? 4
        : family === "plasma" || family === "arc" ? 9
          : family === "precision" ? 5
            : 7;
    for (let index = 0; index < count; index++) {
      const spark = this.sparks[this.cursors.spark++ % this.sparks.length];
      spark.life = spark.maxLife = (family === "plasma" || family === "gravity" || family === "freeze" ? .34 : family === "flame" ? .13 : .22) + Math.random() * (family === "flame" ? .14 : .24);
      spark.position = (spark.position || new THREE.Vector3()).copy(position);
      spark.velocity = (spark.velocity || new THREE.Vector3()).set(
        (Math.random() - .5) * (blastLike ? 14 : family === "precision" ? 2.5 : 7),
        (family === "precision" ? .3 : 1.5) + Math.random() * (blastLike ? 10 : 5),
        (Math.random() - .5) * (blastLike ? 14 : family === "precision" ? 2.5 : 7)
      ).addScaledVector(ring.normal, family === "precision" ? 9 + Math.random() * 8 : 2 + Math.random() * 4);
      if (family === "gravity" || family === "implosion") {
        const inwardDirection = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
        spark.position.addScaledVector(inwardDirection, ring.size * (.65 + Math.random() * .5));
        spark.velocity.copy(inwardDirection).multiplyScalar(-(5 + Math.random() * 7));
      }
      spark.color = (spark.color || new THREE.Color()).copy(index % 3 ? ring.weaponColor : ring.ownerColor);
      spark.size = (blastLike ? .14 : family === "plasma" || family === "freeze" ? .11 : family === "flame" ? .09 : .075) + Math.random() * .09;
      spark.family = family;
      spark.gravity = family === "flame" ? -1.5 : ["plasma", "arc", "gravity", "implosion", "disrupt", "scan"].includes(family) ? 4 : 13;
    }
  }

  update(dt) {
    this.updateFireballs();
    this.updateFlashes(dt);
    this.updateTracers(dt);
    this.updateRings(dt);
    this.updateSparks(dt);
  }

  updateFireballs() {
    const layers = this.fireballLayers;
    let index = 0;
    for (const anchor of this.fireballs) {
      if (index >= FIREBALL_INSTANCE_CAPACITY) break;
      const visual = anchor.userData.combatVisual;
      const radius = visual.radius;
      const pulse = 1 + Math.sin(visual.time * 14 + index * .37) * .1;
      const spin = visual.time * 3.2 + index * .19;
      const velocity = anchor.userData.projectileVelocity;
      this.direction.copy(velocity?.lengthSq() > .001 ? velocity : FORWARD).normalize();
      this.fireBack.copy(this.direction).multiplyScalar(-1);
      this.fireSide.crossVectors(this.direction, UP);
      if (this.fireSide.lengthSq() < .01) this.fireSide.set(1, 0, 0);
      else this.fireSide.normalize();
      this.fireRise.crossVectors(this.fireSide, this.direction).normalize();

      this.quaternion.identity();
      this.scale.set(radius * 1.48 * pulse, radius * 1.38 / pulse, radius * 1.48 * pulse);
      this.matrix.compose(anchor.position, this.quaternion, this.scale);
      layers.aura.setMatrixAt(index, this.matrix);

      this.quaternion.setFromAxisAngle(UP, spin);
      this.scale.set(radius * (1 + Math.sin(spin * 1.7) * .08), radius * (1 + Math.cos(spin * 1.3) * .11), radius * (1 + Math.sin(spin * 1.1 + 2) * .09));
      this.matrix.compose(anchor.position, this.quaternion, this.scale);
      layers.shell.setMatrixAt(index, this.matrix);

      this.quaternion.setFromAxisAngle(FORWARD, -spin * 1.4);
      this.scale.setScalar(radius * .54 * (1.08 - (pulse - 1) * .7));
      this.matrix.compose(anchor.position, this.quaternion, this.scale);
      layers.core.setMatrixAt(index, this.matrix);

      for (const [layerName, side, rise, length, width, phase] of FIRE_TONGUES) {
        const flicker = 1 + Math.sin(visual.time * (11 + phase) + index * .29 + phase) * .18;
        this.normal.copy(this.fireBack)
          .addScaledVector(this.fireSide, Math.sin(spin + phase) * .14)
          .addScaledVector(this.fireRise, Math.cos(spin * 1.3 + phase) * .1)
          .normalize();
        this.quaternion.setFromUnitVectors(UP, this.normal);
        this.position.copy(anchor.position)
          .addScaledVector(this.normal, radius * length * .47)
          .addScaledVector(this.fireSide, radius * side)
          .addScaledVector(this.fireRise, radius * rise);
        this.scale.set(radius * width * flicker, radius * length * flicker, radius * width * flicker);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        layers[layerName].setMatrixAt(index, this.matrix);
      }

      const cinderFlicker = .18 + (.5 + Math.sin(spin * 2.7) * .5) * .16;
      this.position.copy(anchor.position)
        .addScaledVector(this.fireBack, radius * (3.7 + Math.sin(spin) * .45))
        .addScaledVector(this.fireSide, Math.sin(spin * 1.9) * radius * .75)
        .addScaledVector(this.fireRise, Math.cos(spin * 1.5) * radius * .48);
      this.quaternion.setFromAxisAngle(UP, spin * 2.2);
      this.scale.setScalar(radius * cinderFlicker);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      layers.cinder.setMatrixAt(index, this.matrix);

      layers.aura.setColorAt(index, FIRE_DARK);
      layers.shell.setColorAt(index, visual.weaponColor);
      layers.core.setColorAt(index, FIRE_HOT);
      layers.flameA.setColorAt(index, FIRE);
      layers.flameB.setColorAt(index, FIRE_HOT);
      layers.flameC.setColorAt(index, FIRE_DARK);
      layers.cinder.setColorAt(index, visual.ownerColor);
      index += 1;
    }
    for (const layer of this.fireballLayerList) layer.count = index;
    this.markUpdated(...this.fireballLayerList);
  }

  updateFlashes(dt) {
    for (let index = 0; index < this.flashes.length; index++) {
      const slot = this.flashes[index];
      slot.life -= dt;
      if (slot.life <= 0) {
        this.flashOuter.setMatrixAt(index, HIDDEN);
        this.flashInner.setMatrixAt(index, HIDDEN);
        continue;
      }
      const fade = clamp(slot.life / slot.maxLife, 0, 1);
      const flicker = .9 + Math.sin((1 - fade) * 18 + slot.profile.signature * 9) * .1;
      this.quaternion.setFromUnitVectors(UP, slot.direction);
      this.position.copy(slot.position).addScaledVector(slot.direction, slot.length * .5);
      this.scale.set(slot.width * 1.8 * fade * flicker, slot.length, slot.width * 1.8 * fade * flicker);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.flashOuter.setMatrixAt(index, this.matrix);
      this.scale.set(slot.width * .7 * fade, slot.length * .86, slot.width * .7 * fade);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.flashInner.setMatrixAt(index, this.matrix);
      this.flashOuter.setColorAt(index, this.color.copy(slot.ownerColor).multiplyScalar(.55 + fade * .45));
      const hotMix = slot.profile.delivery === "flame" || slot.profile.delivery === "melee" ? .28 : slot.profile.energy ? .76 : .58;
      this.flashInner.setColorAt(index, this.color.copy(slot.weaponColor).lerp(WHITE, hotMix).multiplyScalar(.78 + fade * .22));
    }
    this.markUpdated(this.flashOuter, this.flashInner);
  }

  updateTracers(dt) {
    for (let index = 0; index < this.tracers.length; index++) {
      const slot = this.tracers[index];
      slot.life -= dt;
      if (slot.life <= 0) {
        this.tracerOuter.setMatrixAt(index, HIDDEN);
        this.tracerInner.setMatrixAt(index, HIDDEN);
        continue;
      }
      const fade = clamp(slot.life / slot.maxLife, 0, 1);
      this.direction.copy(slot.end).sub(slot.start);
      const length = this.direction.length();
      this.direction.multiplyScalar(1 / length);
      this.quaternion.setFromUnitVectors(UP, this.direction);
      const flame = slot.profile.delivery === "flame";
      const melee = slot.profile.delivery === "melee";
      const beamPulse = slot.closeRapid
        ? .86 + Math.sin((1 - fade) * 28 + slot.profile.signature * 9) * .14
        : slot.profile.delivery === "beam" ? .88 + Math.sin((1 - fade) * 22 + slot.profile.signature * 7) * .12 : 1;
      const visibleLength = flame ? length * (.68 + fade * .28) : length;
      this.position.copy(slot.start).addScaledVector(this.direction, visibleLength * .5);
      this.scale.set(slot.width * slot.outerWidth * fade * beamPulse, visibleLength, slot.width * slot.outerWidth * fade * beamPulse);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.tracerOuter.setMatrixAt(index, this.matrix);
      const innerWidth = flame ? 1.05 : melee || slot.closeRapid ? .9 : slot.profile.precision ? .58 : slot.profile.delivery === "chain" ? .66 : .72;
      this.scale.set(slot.width * innerWidth * fade, visibleLength * (flame ? .9 : 1), slot.width * innerWidth * fade);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.tracerInner.setMatrixAt(index, this.matrix);
      this.tracerOuter.setColorAt(index, this.color.copy(slot.ownerColor).multiplyScalar(.28 + fade * .16));
      const hotMix = flame ? .18 : melee ? .28 : slot.closeRapid ? .72 : slot.profile.payload === "gravity" ? .42 : slot.profile.precision ? .84 : slot.profile.energy ? .68 : .58;
      this.tracerInner.setColorAt(index, this.color.copy(slot.weaponColor).lerp(WHITE, hotMix).multiplyScalar(.74 + fade * .26));
    }
    this.markUpdated(this.tracerOuter, this.tracerInner);
  }

  updateRings(dt) {
    for (let index = 0; index < this.rings.length; index++) {
      const slot = this.rings[index];
      slot.life -= dt;
      if (slot.life <= 0) {
        this.ringOuter.setMatrixAt(index, HIDDEN);
        this.ringInner.setMatrixAt(index, HIDDEN);
        continue;
      }
      const progress = 1 - clamp(slot.life / slot.maxLife, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const inward = slot.family === "gravity" || slot.family === "implosion";
      const radius = inward ? slot.size * (1.08 - eased * .88) : slot.size * (.14 + eased * .86);
      const fade = 1 - progress;
      let outer = [radius, radius, radius];
      let inner = [radius * .72, radius * .72, radius * .72];
      let outerTurn = 0;
      let innerTurn = 0;
      if (inward) {
        const squeeze = slot.family === "gravity" ? .62 : .38;
        outer = [radius * 1.3, radius * squeeze, radius];
        inner = [radius * .62, radius * 1.38, radius * .72];
        outerTurn = progress * Math.PI * (1.4 + slot.profile.signature);
        innerTurn = -progress * Math.PI * (1.8 + slot.profile.signature);
      } else if (slot.family === "freeze") {
        outer = [radius * .28, radius * 1.72, radius * .3];
        inner = [radius * 1.45, radius * .24, radius * .32];
        outerTurn = .78 + slot.profile.signature * .4;
        innerTurn = -.78 - slot.profile.signature * .4;
      } else if (slot.family === "scan") {
        outer = [radius * 1.22, radius * .18, radius];
        inner = [radius * .78, radius * 1.18, radius * .74];
        outerTurn = progress * Math.PI * 1.4 + slot.profile.signature * Math.PI;
        innerTurn = -progress * Math.PI * 1.8;
      } else if (slot.family === "disrupt") {
        outer = [radius * 1.55, radius * .22, radius * 1.05];
        inner = [radius * .42, radius * 1.48, radius * .86];
        outerTurn = progress * Math.PI * 2;
        innerTurn = -progress * Math.PI * 2.4;
      } else if (slot.family === "cluster") {
        outer = [radius * 1.35, radius * .72, radius * 1.35];
        inner = [radius * .48, radius * 1.28, radius * .48];
        outerTurn = slot.profile.signature * Math.PI;
        innerTurn = progress * Math.PI;
      } else if (slot.family === "sticky") {
        outer = [radius * .82, radius * .82, radius * .24];
        inner = [radius * 1.22, radius * .2, radius * .58];
        outerTurn = .38;
        innerTurn = -.38;
      } else if (slot.family === "ricochet") {
        outer = [radius * 1.38, radius * .24, radius * .34];
        inner = [radius * .24, radius * 1.38, radius * .34];
        outerTurn = .78 + progress * Math.PI;
        innerTurn = -.78 - progress * Math.PI;
      } else if (slot.family === "drill") {
        outer = [radius * .32, radius * 1.65, radius * .32];
        inner = [radius * .2, radius * 1.1, radius * .2];
        outerTurn = progress * Math.PI * 2.5;
        innerTurn = -outerTurn;
      } else if (slot.family === "precision") {
        outer = [radius * 1.7, radius * .24, radius * .42];
        inner = [radius * .22, radius * 1.25, radius * .38];
        outerTurn = innerTurn = Math.PI / 4;
      } else if (slot.family === "plasma") {
        outer = [radius, radius * (.68 + Math.sin(progress * Math.PI * 3) * .12), radius];
        inner = [radius * .7, radius * 1.06, radius * .8];
        outerTurn = progress * Math.PI;
        innerTurn = -progress * Math.PI * 1.4;
      } else if (slot.family === "pulse") {
        outer = [radius * 1.7, radius * .12, radius * 1.7];
        inner = [radius * 1.08, radius * .08, radius * 1.08];
        outerTurn = progress * Math.PI * .5;
        innerTurn = -progress * Math.PI * .7;
      } else if (slot.family === "arc") {
        const twitch = Math.sin(progress * Math.PI * 8) * .16;
        outer = [radius * 1.35, radius * .3, radius * .5];
        inner = [radius * .32, radius * 1.05, radius * .45];
        outerTurn = .45 + twitch;
        innerTurn = -.45 - twitch;
      } else if (slot.family === "melee") {
        outer = [radius * 1.5, radius * .25, radius * .38];
        inner = [radius * 1.12, radius * .16, radius * .3];
        outerTurn = .52;
        innerTurn = -.52;
      } else if (slot.family === "closeRapid") {
        outer = [radius * 1.42, radius * .2, radius * .32];
        inner = [radius * .22, radius * 1.05, radius * .3];
        outerTurn = .2 + slot.profile.signature * .35;
        innerTurn = -.42 - slot.profile.signature * .28;
      } else if (slot.family === "kinetic") {
        outer = [radius * 1.15, radius * .5, radius * .55];
        inner = [radius * .42, radius * .82, radius * .48];
        outerTurn = .2;
        innerTurn = -.2;
      } else {
        const echo = clamp((progress - .13) / .87, 0, 1);
        inner = [slot.size * (.1 + echo * .66), slot.size * (.1 + echo * .66), slot.size * (.1 + echo * .66)];
      }
      this.quaternion.setFromUnitVectors(FORWARD, slot.normal);
      this.quaternion.multiply(this.twistQuaternion.setFromAxisAngle(FORWARD, outerTurn));
      this.scale.set(...outer);
      this.matrix.compose(slot.position, this.quaternion, this.scale);
      this.ringOuter.setMatrixAt(index, this.matrix);
      this.quaternion.setFromUnitVectors(FORWARD, slot.normal);
      this.quaternion.multiply(this.twistQuaternion.setFromAxisAngle(FORWARD, innerTurn));
      this.scale.set(...inner);
      this.matrix.compose(slot.position, this.quaternion, this.scale);
      this.ringInner.setMatrixAt(index, this.matrix);
      this.ringOuter.setColorAt(index, this.color.copy(slot.ownerColor).multiplyScalar(.35 + fade * .65));
      const hotMix = slot.family === "freeze" || slot.family === "precision" ? .78
        : inward ? .38
          : slot.family === "scan" || slot.family === "disrupt" ? .56
            : .62;
      this.ringInner.setColorAt(index, this.color.copy(slot.weaponColor).lerp(WHITE, hotMix).multiplyScalar(.65 + fade * .35));
    }
    this.markUpdated(this.ringOuter, this.ringInner);
  }

  updateSparks(dt) {
    for (let index = 0; index < this.sparks.length; index++) {
      const slot = this.sparks[index];
      slot.life -= dt;
      if (slot.life <= 0) {
        this.sparkLayer.setMatrixAt(index, HIDDEN);
        continue;
      }
      const fade = clamp(slot.life / slot.maxLife, 0, 1);
      slot.velocity.y -= slot.gravity * dt;
      slot.position.addScaledVector(slot.velocity, dt);
      if (slot.velocity.lengthSq() > .001) this.quaternion.setFromUnitVectors(UP, this.direction.copy(slot.velocity).normalize());
      else this.quaternion.identity();
      const stretch = slot.family === "precision" ? 4.2
        : slot.family === "freeze" || slot.family === "drill" ? 3.8
          : slot.family === "ricochet" || slot.family === "disrupt" ? 2.8
        : slot.family === "melee" ? 3
          : slot.family === "flame" ? 1.8
          : slot.family === "plasma" || slot.family === "arc" ? 1.15
            : 1.7 + slot.velocity.length() * .08;
      const width = slot.family === "precision" || slot.family === "freeze" || slot.family === "drill" ? .55
        : slot.family === "flame" ? 1.25
          : slot.family === "plasma" || slot.family === "arc" ? 1.15 : 1;
      this.scale.set(slot.size * width * fade, slot.size * stretch * fade, slot.size * width * fade);
      this.matrix.compose(slot.position, this.quaternion, this.scale);
      this.sparkLayer.setMatrixAt(index, this.matrix);
      this.sparkLayer.setColorAt(index, this.color.copy(slot.color).multiplyScalar(.45 + fade * .55));
    }
    this.markUpdated(this.sparkLayer);
  }

  markUpdated(...layers) {
    for (const layer of layers) {
      layer.instanceMatrix.needsUpdate = true;
      if (layer.instanceColor) layer.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.fireballs.clear();
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
    this.group.clear();
  }
}
