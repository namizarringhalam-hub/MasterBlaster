import * as THREE from "three";
import { WEAPONS } from "./gameData.js";

const clamp = THREE.MathUtils.clamp;
export const PROJECTILE_SPAWN_OFFSET = .08;

let haloTexture;
const badgeTextures = new Map();

function material(color, emissive = 0, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: .36,
    metalness: .32,
    emissive,
    emissiveIntensity: emissive ? .45 : 0,
    flatShading: true,
    ...options
  });
}

function part(geometry, mat, x, y, z, shadows = true) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

function radialTexture() {
  if (haloTexture) return haloTexture;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x / (size - 1) * 2 - 1, y / (size - 1) * 2 - 1);
      const alpha = Math.round(255 * Math.pow(Math.max(0, 1 - distance), 2.4));
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  haloTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  haloTexture.minFilter = THREE.LinearFilter;
  haloTexture.magFilter = THREE.LinearFilter;
  haloTexture.generateMipmaps = false;
  haloTexture.needsUpdate = true;
  return haloTexture;
}

function badgeTexture(id) {
  const number = Math.max(1, Number(String(id).match(/\d+/)?.[0] || 1));
  if (badgeTextures.has(number)) return badgeTextures.get(number);
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const shape = (x, y, style) => {
    if (style === 0) return Math.abs(x) + Math.abs(y) < .92;
    if (style === 1) return x * x + y * y < .76;
    if (style === 2) return y > -.82 && y < .78 && Math.abs(x) < (.78 - y) * .55;
    return Math.abs(x) < .76 && Math.abs(y) < .84 && Math.abs(x) + Math.abs(y) * .5 < 1.04;
  };
  const style = (number - 1) % 4;
  const cut = Math.floor((number - 1) / 4) % 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + .5) / size * 2 - 1;
      const ny = (y + .5) / size * 2 - 1;
      const outer = shape(nx, ny, style);
      const inner = shape(nx / .7, ny / .7, style);
      if (!outer) continue;
      const pattern = cut === 0 ? Math.abs(nx) < .105
        : cut === 1 ? Math.abs(ny) < .105
          : cut === 2 ? Math.abs(nx - ny) < .13
            : Math.abs(nx + ny) < .12 || Math.abs(nx - ny) < .12;
      const bright = inner && !pattern;
      const offset = (y * size + x) * 4;
      data[offset] = bright ? 255 : 4;
      data[offset + 1] = bright ? 255 : 7;
      data[offset + 2] = bright ? 255 : 13;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  badgeTextures.set(number, texture);
  return texture;
}

function limb(geometry, mat, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(part(geometry, mat, 0, -geometry.parameters.height / 2, 0));
  return pivot;
}

function disposeChildren(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse((child) => {
    if (child !== group && child.geometry) geometries.add(child.geometry);
    if (child !== group && child.material) {
      for (const entry of Array.isArray(child.material) ? child.material : [child.material]) materials.add(entry);
    }
  });
  group.clear();
  for (const geometry of geometries) geometry.dispose();
  for (const entry of materials) entry.dispose();
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
    this.slowTimer = 0;
    this.landTimer = 0;
    this.landStrength = 0;
    this.recoilVisual = 0;
    this.gaitPhase = 0;
    this.grounded = true;
    this.ledgeContact = null;
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
    const armor = material(this.color, this.color, { emissiveIntensity: .16, roughness: .3, metalness: .48 });
    const accent = material(this.accent, this.accent, { emissiveIntensity: 1.25, roughness: .2, metalness: .2 });
    const dark = material(0x07101d, this.accent, { emissiveIntensity: .025, roughness: .48, metalness: .56 });
    this.armorMaterial = armor;
    this.accentMaterial = accent;
    this.darkMaterial = dark;

    this.rig = new THREE.Group();
    this.rig.scale.set(1.07, 1.04, 1.07);
    group.add(this.rig);
    const torso = part(new THREE.CapsuleGeometry(.39, .68, 4, 8), dark, 0, 1.25, 0);
    const chest = part(new THREE.CylinderGeometry(.37, .49, .65, 6), armor, 0, 1.43, .015);
    chest.scale.z = .76;
    const pelvis = part(new THREE.BoxGeometry(.72, .23, .45), armor, 0, .91, -.01);
    const spine = part(new THREE.BoxGeometry(.38, .56, .18), armor, 0, 1.38, -.37);
    const chestLight = part(new THREE.BoxGeometry(.48, .075, .055), accent, 0, 1.47, .36, false);
    chestLight.rotation.z = -.18;
    const helmet = part(new THREE.SphereGeometry(.47, 12, 8), dark, 0, 2.08, 0);
    helmet.scale.set(1, .92, .94);
    const visor = part(new THREE.BoxGeometry(.72, .16, .12), accent, 0, 2.1, .43, false);
    const brow = part(new THREE.BoxGeometry(.78, .1, .16), armor, 0, 2.27, .3);
    brow.rotation.x = -.18;

    this.leftArm = limb(new THREE.BoxGeometry(.25, .7, .28), dark, -.59, 1.64, 0);
    this.rightArm = limb(new THREE.BoxGeometry(.25, .7, .28), dark, .59, 1.64, 0);
    this.leftLeg = limb(new THREE.BoxGeometry(.3, .78, .34), dark, -.23, .82, 0);
    this.rightLeg = limb(new THREE.BoxGeometry(.3, .78, .34), dark, .23, .82, 0);
    this.leftArm.add(part(new THREE.BoxGeometry(.31, .34, .34), armor, 0, -.51, .025));
    this.rightArm.add(part(new THREE.BoxGeometry(.31, .34, .34), armor, 0, -.51, .025));
    this.leftLeg.add(part(new THREE.BoxGeometry(.255, .4, .39), armor, 0, -.54, .035));
    this.rightLeg.add(part(new THREE.BoxGeometry(.255, .4, .39), armor, 0, -.54, .035));
    const leftShoulder = part(new THREE.BoxGeometry(.34, .27, .48), armor, -.57, 1.62, -.02);
    const rightShoulder = part(new THREE.BoxGeometry(.34, .27, .48), armor, .57, 1.62, -.02);
    leftShoulder.rotation.z = -.16;
    rightShoulder.rotation.z = .16;
    const leftFin = part(new THREE.ConeGeometry(.13, .48, 4), accent, -.46, 1.83, -.25, false);
    const rightFin = part(new THREE.ConeGeometry(.13, .48, 4), accent, .46, 1.83, -.25, false);
    leftFin.rotation.z = -.42;
    rightFin.rotation.z = .42;
    this.rig.add(
      torso, chest, pelvis, spine, chestLight, helmet, visor, brow,
      this.leftArm, this.rightArm, this.leftLeg, this.rightLeg,
      leftShoulder, rightShoulder, leftFin, rightFin
    );

    this.weaponGroup = new THREE.Group();
    this.weaponGroup.position.set(.58, 1.4, .28);
    this.rig.add(this.weaponGroup);

    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .28, depthWrite: false });
    const shadow = part(new THREE.CircleGeometry(.86, 24), shadowMaterial, 0, .021, 0, false);
    shadow.rotation.x = -Math.PI / 2;
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: .46,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    this.identityRing = part(new THREE.RingGeometry(.72, .91, 28), ringMaterial, 0, .035, 0, false);
    this.identityRing.rotation.x = -Math.PI / 2;
    this.identityRing.renderOrder = 3;
    const haloMaterial = new THREE.SpriteMaterial({
      map: radialTexture(),
      color: this.accent,
      transparent: true,
      opacity: .14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    this.readabilityHalo = new THREE.Sprite(haloMaterial);
    this.readabilityHalo.position.set(0, 1.38, -.08);
    this.readabilityHalo.scale.set(2.85, 3.65, 1);
    this.readabilityHalo.renderOrder = 2;
    this.identityBeacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: badgeTexture(this.id),
      color: this.accent,
      transparent: true,
      opacity: .94,
      alphaTest: .04,
      depthWrite: false,
      sizeAttenuation: false,
      toneMapped: false
    }));
    this.identityBeacon.position.set(0, 2.82, 0);
    this.identityBeacon.scale.set(.034, .034, 1);
    this.identityBeacon.renderOrder = 5;
    group.add(shadow, this.identityRing, this.readabilityHalo, this.identityBeacon);
    return group;
  }

  updateWeaponModel() {
    disposeChildren(this.weaponGroup);
    const weapon = this.weapon;
    const glow = material(weapon.color, weapon.color, { emissiveIntensity: 1.35, roughness: .24, metalness: .38 });
    const identity = material(this.accent, this.accent, { emissiveIntensity: 1.1, roughness: .18, metalness: .3 });
    const dark = material(0x091424, this.accent, { emissiveIntensity: .035, roughness: .34, metalness: .7 });
    this.weaponMuzzleDistance = .92;
    if (weapon.type === "mine" || weapon.type === "remote") {
      const body = part(new THREE.CylinderGeometry(.3, .36, .2, 10), dark, .04, .04, .2);
      const cap = part(new THREE.CylinderGeometry(.22, .28, .05, 10), glow, .04, .17, .2, false);
      const marker = part(new THREE.TorusGeometry(.18, .035, 4, 12), identity, .04, .205, .2, false);
      marker.rotation.x = Math.PI / 2;
      this.weaponGroup.add(body, cap, marker);
      this.weaponMuzzleDistance = .55;
      return;
    }
    if (weapon.type === "melee") {
      const reachScale = Math.min(1.5, weapon.reach / 3.5);
      const bladeLength = 1.12 * reachScale;
      const blade = part(new THREE.BoxGeometry(.1, .11, bladeLength), glow, .06, .04, .43 + bladeLength * .35, false);
      const grip = part(new THREE.CylinderGeometry(.07, .085, .34, 8), dark, .06, -.01, .03);
      grip.rotation.x = Math.PI / 2;
      const guard = part(new THREE.BoxGeometry(.38, .09, .1), identity, .06, .04, .18, false);
      this.weaponGroup.add(blade, grip, guard);
      this.weaponMuzzleDistance = .55 + bladeLength;
      return;
    }
    const heavy = ["rocket", "plasma", "grenade"].includes(weapon.type);
    const receiver = part(new THREE.BoxGeometry(heavy ? .34 : .27, .3, heavy ? .66 : .5), dark, .05, .02, .26);
    const grip = part(new THREE.BoxGeometry(.18, .38, .2), dark, .05, -.2, .11);
    grip.rotation.x = -.18;
    const ownerBand = part(new THREE.BoxGeometry(heavy ? .4 : .32, .07, .14), identity, .05, .12, .22, false);
    this.weaponGroup.add(receiver, grip, ownerBand);

    if (weapon.type === "rocket") {
      const tube = part(new THREE.CylinderGeometry(.17, .2, .92, 10), glow, .05, .06, .72);
      tube.rotation.x = Math.PI / 2;
      const muzzle = part(new THREE.TorusGeometry(.23, .055, 5, 12), identity, .05, .06, 1.17, false);
      this.weaponGroup.add(tube, muzzle);
      this.weaponMuzzleDistance = 1.28;
    } else if (weapon.type === "plasma") {
      const chamber = part(new THREE.IcosahedronGeometry(.24, 1), glow, .05, .07, .58, false);
      const cageMaterial = identity.clone();
      cageMaterial.wireframe = true;
      const cage = part(new THREE.IcosahedronGeometry(.3, 1), cageMaterial, .05, .07, .58, false);
      const barrel = part(new THREE.CylinderGeometry(.08, .13, .55, 8), dark, .05, .07, .92);
      barrel.rotation.x = Math.PI / 2;
      this.weaponGroup.add(chamber, cage, barrel);
      this.weaponMuzzleDistance = 1.21;
    } else if (weapon.type === "rail") {
      const railA = part(new THREE.BoxGeometry(.08, .1, 1.18), glow, -.055, .08, .78, false);
      const railB = part(new THREE.BoxGeometry(.08, .1, 1.18), glow, .155, .08, .78, false);
      const bridge = part(new THREE.BoxGeometry(.31, .08, .16), identity, .05, .08, 1.19, false);
      this.weaponGroup.add(railA, railB, bridge);
      this.weaponMuzzleDistance = 1.42;
    } else {
      const scale = weapon.type === "grenade" ? 1.15 : .82;
      const barrel = part(new THREE.CylinderGeometry(.095 * scale, .135 * scale, .76 * scale, 9), glow, .05, .06, .69);
      barrel.rotation.x = Math.PI / 2;
      const muzzle = part(new THREE.TorusGeometry(.13 * scale, .035, 4, 10), identity, .05, .06, .98, false);
      this.weaponGroup.add(barrel, muzzle);
      this.weaponMuzzleDistance = 1.08;
    }
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
    this.recoilVisual = Math.max(this.recoilVisual, clamp(amount * .11, .12, .72));
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
    this.slowTimer = 0;
    this.landTimer = 0;
    this.landStrength = 0;
    this.recoilVisual = 0;
    this.grapple = null;
    this.ledgeContact = null;
  }

  update(dt, move, look, actions, world) {
    if (!this.alive) return;
    const wasGrounded = this.grounded;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const reloading = this.reloadTimer > 0;
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    if (reloading && this.reloadTimer === 0) this.ammo[this.weapon.id] = this.weapon.ammo;
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.recoilVisual = THREE.MathUtils.damp(this.recoilVisual, 0, 13, dt);

    if (look.lengthSq() > .001) this.aim.copy(look).normalize();
    if (actions.jump && this.grounded) {
      this.velocity.y = 7.5;
      this.grounded = false;
    }

    const moving = move.lengthSq() > .001;
    this.controlMove.copy(move);
    const movementScale = this.slowTimer > 0 ? .48 : 1;
    const desired = moving ? move.clone().normalize().multiplyScalar(9 * movementScale) : new THREE.Vector3();
    if (this.grounded) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, desired.x, 11, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, desired.z, 11, dt);
    } else {
      const acceleration = (this.grapple ? 15 : 7) * movementScale;
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
    const fallSpeed = Math.max(0, -this.velocity.y);
    const previous = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);

    const collision = world.resolve(this.position, this.radius, previous);
    this.ledgeContact = collision.ledge;
    if (collision.ceiling && this.velocity.y > 0) this.velocity.y = 0;
    if (collision.grounded && this.velocity.y <= 0) {
      if (!wasGrounded && fallSpeed > 2.5) {
        this.landTimer = .22;
        this.landStrength = clamp((fallSpeed - 2) / 15, .18, 1);
      }
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
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const locomotion = clamp(horizontalSpeed / 9, 0, 1);
    if (this.grounded && moving) this.gaitPhase = (this.gaitPhase + dt * (5.2 + horizontalSpeed * .72)) % (Math.PI * 2);
    const gait = Math.sin(this.gaitPhase);
    const landing = this.landTimer > 0
      ? this.landStrength * Math.sin((1 - this.landTimer / .22) * Math.PI)
      : 0;
    const grappled = Boolean(this.grapple);
    let leftLegTarget;
    let rightLegTarget;
    if (this.grounded) {
      leftLegTarget = moving ? gait * (.42 + locomotion * .26) + landing * .42 : landing * .42;
      rightLegTarget = moving ? -gait * (.42 + locomotion * .26) + landing * .42 : landing * .42;
    } else if (grappled) {
      leftLegTarget = .48 + clamp(-this.velocity.y * .018, -.2, .24);
      rightLegTarget = -.16 + clamp(-this.velocity.y * .012, -.14, .2);
    } else {
      const tuck = clamp(Math.abs(this.velocity.y) / 18, .12, .52);
      leftLegTarget = .16 + tuck;
      rightLegTarget = -.08 + tuck * .72;
    }
    this.leftLeg.rotation.x = THREE.MathUtils.damp(this.leftLeg.rotation.x, leftLegTarget, 15, dt);
    this.rightLeg.rotation.x = THREE.MathUtils.damp(this.rightLeg.rotation.x, rightLegTarget, 15, dt);

    const aimPitch = Math.asin(clamp(this.aim.y, -1, 1));
    const melee = this.weapon.type === "melee";
    const attacking = this.attackTimer > this.weapon.cooldown * .55;
    let leftArmTarget = -1.06 - aimPitch * .65 - gait * locomotion * .035;
    let rightArmTarget = -1.24 - aimPitch * .72 + this.recoilVisual * .68;
    let leftArmRoll = .38;
    let rightArmRoll = -.1;
    if (melee) {
      leftArmTarget = -.42;
      rightArmTarget = attacking ? -1.72 : -.48;
      leftArmRoll = .1;
      rightArmRoll = -.2;
    } else if (grappled) {
      const anchor = this.grapple.wraps?.[0] || this.grapple.anchor;
      const ropeLength = anchor ? this.position.distanceTo(anchor) : 1;
      const ropePitch = anchor ? Math.asin(clamp((anchor.y - this.position.y - 1.4) / Math.max(.01, ropeLength), -1, 1)) : 0;
      leftArmTarget = -1.48 - ropePitch * .72;
      leftArmRoll = .5;
      rightArmTarget -= .08;
    }
    this.leftArm.rotation.x = THREE.MathUtils.damp(this.leftArm.rotation.x, leftArmTarget, 19, dt);
    this.rightArm.rotation.x = THREE.MathUtils.damp(this.rightArm.rotation.x, rightArmTarget, 19, dt);
    this.leftArm.rotation.z = THREE.MathUtils.damp(this.leftArm.rotation.z, leftArmRoll, 17, dt);
    this.rightArm.rotation.z = THREE.MathUtils.damp(this.rightArm.rotation.z, rightArmRoll, 17, dt);
    this.leftArm.rotation.y = THREE.MathUtils.damp(this.leftArm.rotation.y, melee ? 0 : -.26, 17, dt);
    this.rightArm.rotation.y = THREE.MathUtils.damp(this.rightArm.rotation.y, melee ? .15 : .08, 17, dt);

    this.weaponGroup.rotation.x = THREE.MathUtils.damp(this.weaponGroup.rotation.x, -aimPitch + this.recoilVisual * .22, 22, dt);
    this.weaponGroup.rotation.z = THREE.MathUtils.damp(this.weaponGroup.rotation.z, grappled ? Math.sin(time * .42) * .035 : 0, 13, dt);
    this.weaponGroup.position.y = THREE.MathUtils.damp(this.weaponGroup.position.y, 1.4 - landing * .07, 20, dt);
    this.weaponGroup.position.z = THREE.MathUtils.damp(this.weaponGroup.position.z, .28 - this.recoilVisual * .22, 24, dt);
    const bob = this.grounded && moving ? Math.abs(gait) * .055 : Math.sin(time * .45) * .018;
    this.rig.position.y = bob - landing * .13;
    this.rig.scale.set(1.07 + landing * .07, 1.04 - landing * .11, 1.07 + landing * .07);
    const strafe = this.velocity.x * this.aim.z - this.velocity.z * this.aim.x;
    this.rig.rotation.z = THREE.MathUtils.damp(this.rig.rotation.z, clamp(-strafe * .025, -.14, .14), 9, dt);
    const bodyPitch = grappled
      ? clamp(-.1 - this.velocity.y * .012, -.28, .12)
      : moving ? -.045 * locomotion : 0;
    this.rig.rotation.x = THREE.MathUtils.damp(this.rig.rotation.x, bodyPitch, 9, dt);
    const hit = this.hitTimer > 0;
    this.armorMaterial.emissiveIntensity = hit ? 1.45 : .16;
    this.accentMaterial.emissiveIntensity = hit ? 2.15 : 1.25;
    this.darkMaterial.emissiveIntensity = hit ? .48 : .025;
    const pulse = .5 + Math.sin(time * .55 + this.id.length) * .5;
    this.identityRing.material.opacity = hit ? .85 : .34 + pulse * .17;
    this.identityRing.scale.setScalar(1 + pulse * .045);
    this.identityRing.rotation.z += dt * .32;
    this.readabilityHalo.material.opacity = hit ? .32 : .12 + locomotion * .06;
    this.identityBeacon.position.y = 2.82 + Math.sin(time * .7) * .04;
    this.identityBeacon.material.opacity = hit ? 1 : .86 + pulse * .12;
    this.identityBeacon.scale.setScalar((hit ? .041 : .034) * (1 + pulse * .06));
  }

  forwardPoint(distance) {
    return this.position.clone().add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(this.aim, distance);
  }

  muzzlePoint(target = new THREE.Vector3()) {
    const flatLength = Math.hypot(this.aim.x, this.aim.z);
    const rightX = flatLength > .001 ? this.aim.z / flatLength : Math.cos(this.group.rotation.y);
    const rightZ = flatLength > .001 ? -this.aim.x / flatLength : -Math.sin(this.group.rotation.y);
    target.copy(this.position).add(new THREE.Vector3(0, 1.43, 0)).addScaledVector(this.aim, this.weaponMuzzleDistance || .92);
    target.x += rightX * .5;
    target.z += rightZ * .5;
    return target;
  }

  dispose() {
    this.scene.remove(this.group);
    const geometries = new Set();
    const materials = new Set();
    this.group.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) {
        for (const entry of Array.isArray(child.material) ? child.material : [child.material]) materials.add(entry);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const entry of materials) entry.dispose();
  }
}

export function applyGrapplePhysics(player, dt) {
  if (!player.grapple) return;
  const chest = player.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  const wraps = player.grapple.wraps || [];
  const pullPoint = wraps[0] || player.grapple.anchor;
  const towardAnchor = pullPoint.clone().sub(chest);
  const distance = towardAnchor.length();
  if (distance < .01) return;

  const direction = towardAnchor.multiplyScalar(1 / distance);
  const movementScale = player.slowTimer > 0 ? .55 : 1;
  player.grapple.ropeLength = Math.max(5, player.grapple.ropeLength - 22 * movementScale * dt);
  let wrappedLength = 0;
  for (let index = 0; index < wraps.length; index++) wrappedLength += wraps[index].distanceTo(wraps[index + 1] || player.grapple.anchor);
  const stretch = Math.max(0, distance - Math.max(1, player.grapple.ropeLength - wrappedLength));
  player.velocity.addScaledVector(direction, (38 + stretch * 13) * movementScale * dt);

  // A taut rope cancels only outward velocity. Tangential speed survives and becomes the swing.
  if (stretch > 0) {
    const radialSpeed = player.velocity.dot(direction);
    if (radialSpeed < 0) player.velocity.addScaledVector(direction, -radialSpeed * .96);
  }

  const steering = player.controlMove.clone().sub(direction.clone().multiplyScalar(player.controlMove.dot(direction)));
  if (steering.lengthSq() > .01) player.velocity.addScaledVector(steering.normalize(), 14 * movementScale * dt);
  if (player.ledgeContact && Math.max(pullPoint.y, player.grapple.anchor.y) >= player.ledgeContact.top - .35) {
    player.velocity.y = Math.max(player.velocity.y, 11);
    const inwardSpeed = player.velocity.dot(player.ledgeContact.inward);
    if (inwardSpeed < 7) player.velocity.addScaledVector(player.ledgeContact.inward, 7 - inwardSpeed);
  }
  if (player.velocity.length() > 48) player.velocity.setLength(48);
}

export function boostGrappleRelease(player) {
  const speed = player.velocity.length();
  if (speed < 5) return;
  player.velocity.multiplyScalar(1 + Math.min(.28, 6 / speed));
  player.velocity.y += 2.2;
}

export function grappleSightline(player, camera) {
  if (player.isBot) {
    return {
      origin: player.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
      direction: player.aim.clone()
    };
  }
  return {
    origin: camera.position.clone(),
    direction: camera.getWorldDirection(new THREE.Vector3())
  };
}

export function directionFromKeys(input) {
  const value = new THREE.Vector3(
    (input.down("KeyD") ? 1 : 0) - (input.down("KeyA") ? 1 : 0),
    0,
    (input.down("KeyS") ? 1 : 0) - (input.down("KeyW") ? 1 : 0)
  );
  return value.lengthSq() ? value.normalize() : value;
}

export function directionFromTouch(touch) {
  const value = new THREE.Vector3(
    (touch.right ? 1 : 0) - (touch.left ? 1 : 0),
    0,
    (touch.down ? 1 : 0) - (touch.up ? 1 : 0)
  );
  return value.lengthSq() ? value.normalize() : value;
}

export function cameraRelative(vector, yaw) {
  if (!vector.lengthSq()) return vector;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  return right.multiplyScalar(vector.x).addScaledVector(forward, -vector.z);
}

export function aimWithSpread(aim, spread, random = Math.random) {
  return aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (random() - .5) * spread).normalize();
}

export function reticleAim(player, cameraOrigin, cameraDirection, world, targets) {
  const direction = cameraDirection.clone().normalize();
  const ray = new THREE.Ray(cameraOrigin, direction);
  const surface = world.grapplePoint(cameraOrigin, direction);
  let distance = surface ? cameraOrigin.distanceTo(surface) : 520;
  let point = surface || cameraOrigin.clone().addScaledVector(direction, distance);
  let selectedTarget = null;
  const hit = new THREE.Vector3();

  // Exact ray intersections only: this corrects third-person parallax without aim assist.
  for (const target of targets) {
    if (target === player || !target.alive) continue;
    for (const [height, radius] of [[.55, target.radius * .72], [1.2, target.radius], [2.08, target.radius * .72]]) {
      const sphere = new THREE.Sphere(target.position.clone().add(new THREE.Vector3(0, height, 0)), radius);
      if (!ray.intersectSphere(sphere, hit)) continue;
      const hitDistance = cameraOrigin.distanceTo(hit);
      if (hitDistance >= distance) continue;
      distance = hitDistance;
      point = hit.clone();
      selectedTarget = target;
    }
  }

  const muzzle = player.position.clone().add(new THREE.Vector3(0, 1.25, 0));
  const aim = point.sub(muzzle);
  if (selectedTarget && aim.dot(direction) <= 0) aim.copy(selectedTarget.position).add(new THREE.Vector3(0, 1.2, 0)).sub(muzzle);
  return (aim.lengthSq() > .001 ? aim : direction).normalize();
}

export function projectileTouchesPlayer(player, position, radius = .22) {
  if (!player.alive) return false;
  const body = new THREE.Vector3(
    player.position.x,
    clamp(position.y, player.position.y + .72, player.position.y + 1.85),
    player.position.z
  );
  return body.distanceTo(position) < player.radius + radius;
}
