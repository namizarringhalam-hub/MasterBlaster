import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const BLACK = new THREE.Color(0x000000);
const WHITE = new THREE.Color(0xffffff);

function glowMaterial(opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
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

function projectileFamily(weapon) {
  if (weapon.returning) return "disc";
  if (["grenade", "remote", "mine"].includes(weapon.type)) return "grenade";
  if (["plasma", "wall", "decoy"].includes(weapon.type)) return "plasma";
  return weapon.type;
}

function impactFamily(weapon, explosive) {
  if (["plasma", "wall", "decoy"].includes(weapon.type)) return "plasma";
  if (["rail", "beam"].includes(weapon.type)) return "precision";
  if (weapon.type === "chain") return "arc";
  if (weapon.type === "melee") return "melee";
  if (explosive || weapon.radius) return "blast";
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -1, 0, 0, 1, 0, 0, -1, 0, -1, 1, 0, -1
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 1, 1
  ], 2));
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: color.clone() },
      worldWidth: { value: radius },
      minWidth: { value: .0019 }
    },
    vertexShader: `
      uniform float worldWidth;
      uniform float minWidth;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 headView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 tailView = modelViewMatrix * vec4(0.0, 0.0, -1.0, 1.0);
        if (headView.z > -0.11 || tailView.z > -0.11) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec4 headClip = projectionMatrix * headView;
        vec4 tailClip = projectionMatrix * tailView;
        vec2 axis = headClip.xy / headClip.w - tailClip.xy / tailClip.w;
        vec2 facing = length(axis) > 0.00001 ? normalize(vec2(-axis.y, axis.x)) : vec2(1.0, 0.0);
        float along = -position.z;
        vec4 center = mix(headClip, tailClip, along);
        float depth = max(1.0, -mix(headView.z, tailView.z, along));
        float halfWidth = max(minWidth, worldWidth * projectionMatrix[1][1] / depth);
        center.xy += facing * position.x * halfWidth * center.w;
        gl_Position = center;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying vec2 vUv;
      void main() {
        float lateral = abs(vUv.x * 2.0 - 1.0);
        float edge = 1.0 - smoothstep(0.28, 1.0, lateral);
        float spine = 1.0 - smoothstep(0.0, 0.22, lateral);
        float history = pow(max(0.0, 1.0 - vUv.y), 0.48);
        float dart = smoothstep(0.68, 1.0, history);
        vec3 hot = mix(color, vec3(1.0), spine * (0.58 + dart * 0.42));
        gl_FragColor = vec4(hot, edge * history * (0.72 + spine * 0.28));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const trail = visualMesh(geometry, material);
  trail.scale.z = length;
  trail.userData.trail = { axis: "z", length, offset: 0, screen: true };
  group.add(trail);
  return trail;
}

/**
 * Creates one gameplay projectile with a weapon-shaped core and a shooter-colored trail.
 * The returned Group is a drop-in replacement for the Mesh currently stored on `shot.mesh`.
 */
export function createProjectileVisual(weapon, owner, collisionRadius = .11, { mine = false } = {}) {
  const group = new THREE.Group();
  const radius = Math.max(.08, collisionRadius);
  const family = mine ? "grenade" : projectileFamily(weapon);
  const core = new THREE.MeshBasicMaterial({ color: weapon.color, toneMapped: false });
  const hot = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const shotIdentity = ownerColor(owner, weapon);
  let identity;
  const identityMaterial = () => {
    if (!identity) {
      identity = glowMaterial(.72);
      identity.color.copy(shotIdentity);
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
  const speedTail = clamp((weapon.projectileSpeed || 22) * .02, .65, 5.4);

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
    const fast = weapon.projectileSpeed >= 135 || weapon.cooldown <= .12 || weapon.type === "spread";
    group.add(bolt, tip);
    const trailRadius = Math.max(radius * .82, weapon.projectileSpeed >= 140 ? .12 : .09);
    if (fast) {
      addScreenTrail(group, trailRadius, speedTail, shotIdentity);
    } else {
      const collar = visualMesh(new THREE.TorusGeometry(radius * .82, radius * .1, 4, 10), identityMaterial());
      collar.position.z = -length * .3;
      group.add(collar);
      pulseParts.push(collar, addTail(group, trailRadius, speedTail, soft()));
    }
  }

  group.userData.combatVisual = {
    family,
    time: 0,
    movingParts,
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

    this.matrix = new THREE.Matrix4();
    this.quaternion = new THREE.Quaternion();
    this.twistQuaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.color = new THREE.Color();
    this.normal = new THREE.Vector3();
  }

  setReducedMotion(reducedMotion) {
    this.reducedMotion = Boolean(reducedMotion);
  }

  createProjectile(owner, weapon, radius, options) {
    return createProjectileVisual(weapon, owner, radius, options);
  }

  updateProjectile(shot, dt) {
    const visual = shot.mesh?.userData?.combatVisual;
    if (!visual) return;
    visual.time += dt;
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
  }

  muzzle(owner, weapon, direction = owner?.aim) {
    if (!owner || !weapon || !direction?.lengthSq()) return;
    const slot = this.flashes[this.cursors.flash++ % this.flashes.length];
    const heavy = ["rocket", "plasma", "grenade", "rail"].includes(weapon.type);
    const precision = weapon.type === "rail" || weapon.type === "beam";
    const rapid = weapon.projectileSpeed >= 140 || weapon.cooldown <= .12 || weapon.type === "spread";
    slot.life = slot.maxLife = this.reducedMotion ? .075 : precision ? .15 : heavy ? .135 : rapid ? .115 : .1;
    slot.position = owner.muzzlePoint?.(slot.position || new THREE.Vector3()) || owner.forwardPoint(.9);
    slot.direction = (slot.direction || new THREE.Vector3()).copy(direction).normalize();
    slot.weaponColor = (slot.weaponColor || new THREE.Color()).set(weapon.color);
    slot.ownerColor = (slot.ownerColor || new THREE.Color()).copy(ownerColor(owner, weapon));
    slot.length = precision ? 2.05 : heavy ? 1.62 : rapid ? 1.16 : .92;
    slot.width = precision ? .24 : heavy ? .33 : rapid ? .2 : .16;
    if (weapon.type !== "mine" && weapon.type !== "melee") {
      const end = slot.position.clone().addScaledVector(slot.direction, slot.length * 1.45);
      this.addTracer(slot.position, end, weapon, owner, this.reducedMotion ? .06 : .085, rapid ? .072 : .06);
    }
  }

  tracer(start, end, weapon, owner, { life = .14, width = .055 } = {}) {
    if (!start || !end || !weapon || start.distanceToSquared(end) < .0001) return;
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

  addTracer(start, end, weapon, owner, life, width) {
    const slot = this.tracers[this.cursors.tracer++ % this.tracers.length];
    const rapid = weapon.projectileSpeed >= 140 || weapon.cooldown <= .12 || weapon.type === "spread";
    const precision = weapon.type === "rail" || weapon.type === "beam";
    slot.life = slot.maxLife = rapid ? Math.max(.1, life) : life;
    slot.start = (slot.start || new THREE.Vector3()).copy(start);
    slot.end = (slot.end || new THREE.Vector3()).copy(end);
    slot.weaponColor = (slot.weaponColor || new THREE.Color()).set(weapon.color);
    slot.ownerColor = (slot.ownerColor || new THREE.Color()).copy(ownerColor(owner, weapon));
    slot.width = Math.max(width, rapid ? .072 : .052) * (weapon.type === "rail" ? 1.35 : weapon.type === "beam" ? 1.15 : 1);
    slot.outerWidth = precision ? 4.6 : rapid ? 4.15 : 3;
  }

  impact(position, weapon, owner, { size = 1.5, normal = null, explosive = false } = {}) {
    if (!position || !weapon) return;
    const family = impactFamily(weapon, explosive);
    const ring = this.rings[this.cursors.ring++ % this.rings.length];
    ring.life = ring.maxLife = family === "blast" ? .34
      : family === "plasma" ? .4
        : family === "precision" ? .2
          : .28;
    ring.position = (ring.position || new THREE.Vector3()).copy(position);
    ring.normal = (ring.normal || new THREE.Vector3()).copy(normal || (!explosive && owner?.aim) || UP).normalize();
    ring.weaponColor = (ring.weaponColor || new THREE.Color()).set(weapon.color);
    ring.ownerColor = (ring.ownerColor || new THREE.Color()).copy(ownerColor(owner, weapon));
    ring.size = size;
    ring.family = family;

    const count = this.reducedMotion ? 3
      : family === "blast" ? 14
        : family === "plasma" || family === "arc" ? 9
          : family === "precision" ? 5
            : 7;
    for (let index = 0; index < count; index++) {
      const spark = this.sparks[this.cursors.spark++ % this.sparks.length];
      spark.life = spark.maxLife = (family === "plasma" ? .34 : .22) + Math.random() * .24;
      spark.position = (spark.position || new THREE.Vector3()).copy(position);
      spark.velocity = (spark.velocity || new THREE.Vector3()).set(
        (Math.random() - .5) * (family === "blast" ? 14 : family === "precision" ? 2.5 : 7),
        (family === "precision" ? .3 : 1.5) + Math.random() * (family === "blast" ? 10 : 5),
        (Math.random() - .5) * (family === "blast" ? 14 : family === "precision" ? 2.5 : 7)
      ).addScaledVector(ring.normal, family === "precision" ? 9 + Math.random() * 8 : 2 + Math.random() * 4);
      spark.color = (spark.color || new THREE.Color()).copy(index % 3 ? ring.weaponColor : ring.ownerColor);
      spark.size = (family === "blast" ? .14 : family === "plasma" ? .11 : .075) + Math.random() * .09;
      spark.family = family;
      spark.gravity = family === "plasma" || family === "arc" ? 4 : 13;
    }
  }

  update(dt) {
    this.updateFlashes(dt);
    this.updateTracers(dt);
    this.updateRings(dt);
    this.updateSparks(dt);
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
      this.quaternion.setFromUnitVectors(UP, slot.direction);
      this.position.copy(slot.position).addScaledVector(slot.direction, slot.length * .5);
      this.scale.set(slot.width * 1.8 * fade, slot.length, slot.width * 1.8 * fade);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.flashOuter.setMatrixAt(index, this.matrix);
      this.scale.set(slot.width * .7 * fade, slot.length * .86, slot.width * .7 * fade);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.flashInner.setMatrixAt(index, this.matrix);
      this.flashOuter.setColorAt(index, this.color.copy(slot.ownerColor).multiplyScalar(.55 + fade * .45));
      this.flashInner.setColorAt(index, this.color.copy(slot.weaponColor).lerp(WHITE, .72).multiplyScalar(.78 + fade * .22));
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
      this.position.copy(slot.start).lerp(slot.end, .5);
      this.scale.set(slot.width * slot.outerWidth * fade, length, slot.width * slot.outerWidth * fade);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.tracerOuter.setMatrixAt(index, this.matrix);
      this.scale.set(slot.width * .72 * fade, length, slot.width * .72 * fade);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.tracerInner.setMatrixAt(index, this.matrix);
      this.tracerOuter.setColorAt(index, this.color.copy(slot.ownerColor).multiplyScalar(.28 + fade * .16));
      this.tracerInner.setColorAt(index, this.color.copy(slot.weaponColor).lerp(WHITE, .76).multiplyScalar(.74 + fade * .26));
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
      const radius = slot.size * (.14 + eased * .86);
      const fade = 1 - progress;
      let outer = [radius, radius, radius];
      let inner = [radius * .72, radius * .72, radius * .72];
      let outerTurn = 0;
      let innerTurn = 0;
      if (slot.family === "precision") {
        outer = [radius * 1.7, radius * .24, radius * .42];
        inner = [radius * .22, radius * 1.25, radius * .38];
        outerTurn = innerTurn = Math.PI / 4;
      } else if (slot.family === "plasma") {
        outer = [radius, radius * (.68 + Math.sin(progress * Math.PI * 3) * .12), radius];
        inner = [radius * .7, radius * 1.06, radius * .8];
        outerTurn = progress * Math.PI;
        innerTurn = -progress * Math.PI * 1.4;
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
      this.ringInner.setColorAt(index, this.color.copy(slot.weaponColor).lerp(WHITE, .62).multiplyScalar(.65 + fade * .35));
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
        : slot.family === "melee" ? 3
          : slot.family === "plasma" || slot.family === "arc" ? 1.15
            : 1.7 + slot.velocity.length() * .08;
      const width = slot.family === "precision" ? .55 : slot.family === "plasma" || slot.family === "arc" ? 1.15 : 1;
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
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
    this.group.clear();
  }
}
