import * as THREE from "three";
import { WEAPONS } from "./gameData.js";

const clamp = THREE.MathUtils.clamp;

function material(color, emissive = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: .42,
    metalness: .22,
    emissive,
    emissiveIntensity: emissive ? .45 : 0
  });
}

function part(geometry, mat, x, y, z) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class Fighter {
  constructor(scene, config, loadout, position, isBot = false) {
    this.scene = scene;
    this.id = config.id;
    this.name = config.name;
    this.color = config.color;
    this.accent = config.accent;
    this.loadout = loadout;
    this.isBot = isBot;
    this.group = this.createModel();
    this.position = this.group.position;
    this.position.copy(position);
    this.velocity = new THREE.Vector3();
    this.controlMove = new THREE.Vector3();
    this.aim = new THREE.Vector3(0, 0, 1);
    this.radius = .72;
    this.health = 100;
    this.slotIndex = 0;
    this.ammo = Object.fromEntries(loadout.map((id) => [id, WEAPONS[id].ammo]));
    this.reloadTimer = 0;
    this.attackTimer = 0;
    this.hitTimer = 0;
    this.grounded = true;
    this.alive = true;
    this.deaths = 0;
    this.botThink = 0;
    this.botDodge = 1;
    this.botTarget = null;
    this.grapple = null;
    scene.add(this.group);
    this.updateWeaponModel();
  }

  get weapon() {
    return WEAPONS[this.loadout[this.slotIndex]];
  }

  createModel() {
    const group = new THREE.Group();
    const armor = material(this.color, this.color);
    const accent = material(this.accent, this.accent);
    const dark = material(0x09111f);

    this.rig = new THREE.Group();
    group.add(this.rig);
    const torso = part(new THREE.CapsuleGeometry(.48, .92, 5, 10), armor, 0, 1.22, 0);
    const helmet = part(new THREE.SphereGeometry(.48, 14, 10), dark, 0, 2.08, 0);
    const visor = part(new THREE.BoxGeometry(.75, .18, .18), accent, 0, 2.1, .42);
    this.leftArm = part(new THREE.BoxGeometry(.22, .78, .24), armor, -.66, 1.4, 0);
    this.rightArm = part(new THREE.BoxGeometry(.22, .78, .24), armor, .66, 1.4, 0);
    this.leftLeg = part(new THREE.BoxGeometry(.27, .75, .28), dark, -.25, .42, 0);
    this.rightLeg = part(new THREE.BoxGeometry(.27, .75, .28), dark, .25, .42, 0);
    this.rig.add(torso, helmet, visor, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);

    this.weaponGroup = new THREE.Group();
    this.weaponGroup.position.set(.72, 1.42, .34);
    this.rig.add(this.weaponGroup);

    const shadow = part(new THREE.CircleGeometry(.85, 24), material(0x000000), 0, .025, 0);
    shadow.rotation.x = -Math.PI / 2;
    shadow.material.transparent = true;
    shadow.material.opacity = .24;
    group.add(shadow);
    return group;
  }

  updateWeaponModel() {
    this.weaponGroup.clear();
    const weapon = this.weapon;
    const glow = material(weapon.color, weapon.color);
    const dark = material(0x111c2c);
    if (weapon.type === "mine") {
      this.weaponGroup.add(part(new THREE.CylinderGeometry(.28, .34, .18, 10), glow, .05, .08, .2));
      return;
    }
    const scale = weapon.type === "rocket" || weapon.type === "plasma" ? 1.18 : .82;
    const barrel = part(new THREE.CylinderGeometry(.11 * scale, .16 * scale, .9 * scale, 10), glow, .08, .06, .45);
    barrel.rotation.x = Math.PI / 2;
    const grip = part(new THREE.BoxGeometry(.2, .4, .22), dark, .08, -.18, .08);
    this.weaponGroup.add(barrel, grip);
  }

  switchSlot(index) {
    if (index < 0 || index >= this.loadout.length || index === this.slotIndex) return;
    this.slotIndex = index;
    this.attackTimer = Math.min(this.attackTimer, .12);
    this.updateWeaponModel();
  }

  reload() {
    const weapon = this.weapon;
    if (this.reloadTimer > 0 || this.ammo[weapon.id] === weapon.ammo) return false;
    this.reloadTimer = weapon.reload;
    return true;
  }

  recoil(amount = this.weapon.recoil) {
    this.velocity.addScaledVector(this.aim, -amount);
  }

  takeHit(amount, push = null) {
    if (!this.alive) return false;
    this.health = clamp(this.health - amount, 0, 100);
    this.hitTimer = .18;
    if (push) this.velocity.add(push);
    if (this.health > 0) return false;
    this.alive = false;
    this.deaths += 1;
    this.group.visible = false;
    return true;
  }

  respawn(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.grounded = true;
    this.group.visible = true;
    this.reloadTimer = 0;
    this.attackTimer = .7;
    this.grapple = null;
  }

  update(dt, move, look, actions, world) {
    if (!this.alive) return;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const reloading = this.reloadTimer > 0;
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    if (reloading && this.reloadTimer === 0) this.ammo[this.weapon.id] = this.weapon.ammo;
    this.hitTimer = Math.max(0, this.hitTimer - dt);

    if (look.lengthSq() > .001) this.aim.copy(look).setY(0).normalize();
    if (actions.jump && this.grounded) {
      this.velocity.y = 7.5;
      this.grounded = false;
    }

    const moving = move.lengthSq() > .001;
    this.controlMove.copy(move);
    const desired = moving ? move.clone().normalize().multiplyScalar(9) : new THREE.Vector3();
    if (this.grounded) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, 11, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, 11, dt);
    } else {
      const acceleration = this.grapple ? 15 : 7;
      this.velocity.x += desired.x / 9 * acceleration * dt;
      this.velocity.z += desired.z / 9 * acceleration * dt;
      const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const limit = this.grapple ? 44 : 16;
      if (horizontalSpeed > limit) {
        this.velocity.x *= limit / horizontalSpeed;
        this.velocity.z *= limit / horizontalSpeed;
      }
    }
    this.velocity.y -= 19 * dt;
    const previous = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);

    const collision = world.resolve(this.position, this.radius, previous);
    if (collision.grounded && this.velocity.y <= 0) {
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    const boost = this.grounded ? world.boostAt(this.position) : null;
    if (boost) {
      this.velocity.y = boost.strength;
      this.grounded = false;
    }

    const angle = Math.atan2(this.aim.x, this.aim.z);
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, angle, 15, dt);
    const time = performance.now() * .009;
    const swing = moving ? Math.sin(time) * .55 : .06;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * .5;
    this.rightArm.rotation.x = swing * .4 - (this.attackTimer > this.weapon.cooldown * .55 ? .75 : 0);
    this.rig.position.y = moving ? Math.abs(Math.sin(time)) * .05 : Math.sin(time * .45) * .018;
    this.rig.traverse((child) => {
      if (!child.material?.emissive) return;
      child.material.emissiveIntensity = this.hitTimer > 0 ? 1.4 : .45;
    });
  }

  forwardPoint(distance) {
    return this.position.clone().add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(this.aim, distance);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  }
}

export function applyGrapplePhysics(player, dt) {
  if (!player.grapple) return;
  const chest = player.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  const towardAnchor = player.grapple.anchor.clone().sub(chest);
  const distance = towardAnchor.length();
  if (distance < .01) return;

  const direction = towardAnchor.multiplyScalar(1 / distance);
  player.grapple.ropeLength = Math.max(5, player.grapple.ropeLength - 18 * dt);
  const stretch = Math.max(0, distance - player.grapple.ropeLength);
  player.velocity.addScaledVector(direction, (30 + stretch * 11) * dt);

  // A taut rope cancels only outward velocity. Tangential speed survives and becomes the swing.
  if (stretch > 0) {
    const radialSpeed = player.velocity.dot(direction);
    if (radialSpeed < 0) player.velocity.addScaledVector(direction, -radialSpeed * .96);
  }

  const steering = player.controlMove.clone().sub(direction.clone().multiplyScalar(player.controlMove.dot(direction)));
  if (steering.lengthSq() > .01) player.velocity.addScaledVector(steering.normalize(), 14 * dt);
  if (player.velocity.length() > 48) player.velocity.setLength(48);
}

export function boostGrappleRelease(player) {
  const speed = player.velocity.length();
  if (speed < 5) return;
  player.velocity.multiplyScalar(1 + Math.min(.28, 6 / speed));
  player.velocity.y += 2.2;
}

export function directionFromKeys(input) {
  const value = new THREE.Vector3(
    (input.down("KeyD") ? 1 : 0) - (input.down("KeyA") ? 1 : 0),
    0,
    (input.down("KeyS") ? 1 : 0) - (input.down("KeyW") ? 1 : 0)
  );
  return value.lengthSq() ? value.normalize() : value;
}

export function cameraRelative(vector, yaw) {
  return vector.lengthSq() ? vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw) : vector;
}

export function aimWithSpread(aim, spread, random = Math.random) {
  return aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (random() - .5) * spread).normalize();
}

export function projectileTouchesPlayer(player, position, radius = .22) {
  if (!player.alive) return false;
  const chest = player.position.clone().add(new THREE.Vector3(0, 1.15, 0));
  return chest.distanceTo(position) < player.radius + radius;
}
