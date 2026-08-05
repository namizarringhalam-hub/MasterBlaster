import * as THREE from "three/webgpu";
import { WEAPONS } from "./gameData.js";
import { weaponPresentation } from "./weaponPresentation.js";

const clamp = THREE.MathUtils.clamp;
export const PROJECTILE_SPAWN_OFFSET = .08;

let haloTexture;
const badgeTextures = new Map();

function material(color, emissive = 0, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: .29,
    metalness: .42,
    clearcoat: .42,
    clearcoatRoughness: .2,
    envMapIntensity: 1.2,
    specularIntensity: .92,
    emissive,
    emissiveIntensity: emissive ? .62 : 0,
    flatShading: false,
    ...options
  });
}

function part(geometry, mat, x, y, z, shadows = false) {
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

function articulatedArm(dark, armor, accent, x) {
  const upper = new THREE.Group();
  upper.position.set(x, 1.67, 0);
  const upperArmor = part(new THREE.BoxGeometry(.27, .55, .3), dark, 0, -.28, 0);
  const upperStripe = part(new THREE.BoxGeometry(.285, .08, .32), accent, 0, -.19, .012, false);
  const forearm = new THREE.Group();
  forearm.position.y = -.55;
  const bracer = part(new THREE.BoxGeometry(.34, .5, .38), armor, 0, -.24, .035);
  bracer.scale.set(.92, 1, 1.06);
  const wristLight = part(new THREE.BoxGeometry(.25, .075, .4), accent, 0, -.43, .04, false);
  const hand = part(new THREE.BoxGeometry(.25, .22, .29), dark, 0, -.58, .05);
  const knuckle = part(new THREE.BoxGeometry(.2, .055, .18), accent, 0, -.59, .19, false);
  forearm.add(bracer, wristLight, hand, knuckle);
  upper.add(upperArmor, upperStripe, forearm);
  return { upper, forearm, hand };
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
    this.reloadWeaponId = null;
    this.attackTimer = 0;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.hitTimer = 0;
    this.hitStagger = 1;
    this.slowTimer = 0;
    this.landTimer = 0;
    this.landStrength = 0;
    this.recoilVisual = 0;
    this.deathTimer = 0;
    this.gaitPhase = 0;
    this.grounded = true;
    this.boosted = false;
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
    const costumeVariant = [...this.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
    const armor = material(this.color, this.color, {
      emissiveIntensity: .14, roughness: .24, metalness: .52, clearcoat: .58,
      sheen: .22, sheenColor: new THREE.Color(this.color).lerp(new THREE.Color(0xffffff), .28), sheenRoughness: .42
    });
    const accent = material(this.accent, this.accent, {
      emissiveIntensity: 1.1, roughness: .14, metalness: .24, clearcoat: .82,
      iridescence: .34, iridescenceIOR: 1.32, iridescenceThicknessRange: [120, 340]
    });
    const dark = material(0x07101d, this.accent, { emissiveIntensity: .022, roughness: .4, metalness: .68, clearcoat: .32 });
    this.armorMaterial = armor;
    this.accentMaterial = accent;
    this.darkMaterial = dark;

    this.rig = new THREE.Group();
    this.rig.scale.set(1.07, 1.04, 1.07);
    group.add(this.rig);
    const torso = part(new THREE.CapsuleGeometry(.39, .68, 4, 8), dark, 0, 1.25, 0);
    const chest = part(new THREE.CylinderGeometry(.37, .49, .65, [6, 8, 5, 7][costumeVariant]), armor, 0, 1.43, .015);
    chest.scale.z = .76;
    const pelvis = part(new THREE.BoxGeometry(.72, .23, .45), armor, 0, .91, -.01);
    const spine = part(new THREE.BoxGeometry(.38, .56, .18), armor, 0, 1.38, -.37);
    const breastplate = part(new THREE.BoxGeometry(.62, .42, .12), armor, 0, 1.51, .31);
    breastplate.rotation.x = -.08;
    const sternum = part(new THREE.OctahedronGeometry(.13, 0), accent, 0, 1.51, .405, false);
    sternum.scale.set(.72, 1.3, .5);
    const chestLight = part(new THREE.BoxGeometry(.48, .075, .055), accent, 0, 1.47, .36, false);
    chestLight.rotation.z = -.18;
    const helmetGeometry = costumeVariant === 0
      ? new THREE.DodecahedronGeometry(.47, 1)
      : costumeVariant === 1
        ? new THREE.SphereGeometry(.47, 16, 10)
        : costumeVariant === 2
          ? new THREE.CapsuleGeometry(.37, .22, 4, 10)
          : new THREE.IcosahedronGeometry(.47, 1);
    const helmet = part(helmetGeometry, dark, 0, 2.08, 0);
    helmet.scale.set(1, .92, .94);
    const visor = part(new THREE.BoxGeometry(.72, .16, .12), accent, 0, 2.1, .43, false);
    this.helmet = helmet;
    this.visor = visor;
    const brow = part(new THREE.BoxGeometry(.78, .1, .16), armor, 0, 2.27, .3);
    brow.rotation.x = -.18;
    const helmetCrest = part(new THREE.BoxGeometry(.13, .34, .48), armor, 0, 2.35, -.08);
    helmetCrest.rotation.x = -.32;
    const leftEar = part(new THREE.CylinderGeometry(.12, .12, .09, 8), accent, -.47, 2.08, 0, false);
    const rightEar = part(new THREE.CylinderGeometry(.12, .12, .09, 8), accent, .47, 2.08, 0, false);
    leftEar.rotation.z = rightEar.rotation.z = Math.PI / 2;

    const leftArmRig = articulatedArm(dark, armor, accent, -.61);
    const rightArmRig = articulatedArm(dark, armor, accent, .61);
    this.leftArm = leftArmRig.upper;
    this.rightArm = rightArmRig.upper;
    this.leftForearm = leftArmRig.forearm;
    this.rightForearm = rightArmRig.forearm;
    this.leftHand = leftArmRig.hand;
    this.rightHand = rightArmRig.hand;
    this.leftLeg = limb(new THREE.BoxGeometry(.3, .78, .34), dark, -.23, .82, 0);
    this.rightLeg = limb(new THREE.BoxGeometry(.3, .78, .34), dark, .23, .82, 0);
    this.leftLeg.add(part(new THREE.BoxGeometry(.255, .4, .39), armor, 0, -.54, .035));
    this.rightLeg.add(part(new THREE.BoxGeometry(.255, .4, .39), armor, 0, -.54, .035));
    const leftKnee = part(new THREE.BoxGeometry(.29, .18, .13), accent, 0, -.39, .23, false);
    const rightKnee = part(new THREE.BoxGeometry(.29, .18, .13), accent, 0, -.39, .23, false);
    this.leftLeg.add(leftKnee);
    this.rightLeg.add(rightKnee);
    const shoulderGeometry = costumeVariant === 1
      ? new THREE.CylinderGeometry(.2, .25, .42, 6)
      : costumeVariant === 3
        ? new THREE.DodecahedronGeometry(.25, 0)
        : new THREE.BoxGeometry(.34, .27, .48);
    const leftShoulder = part(shoulderGeometry, armor, -.57, 1.62, -.02);
    const rightShoulder = part(shoulderGeometry, armor, .57, 1.62, -.02);
    if (costumeVariant === 1) leftShoulder.rotation.x = rightShoulder.rotation.x = Math.PI / 2;
    leftShoulder.rotation.z = -.16;
    rightShoulder.rotation.z = .16;
    const leftFin = part(new THREE.ConeGeometry(.13, .48, 4), accent, -.46, 1.83, -.25, false);
    const rightFin = part(new THREE.ConeGeometry(.13, .48, 4), accent, .46, 1.83, -.25, false);
    leftFin.rotation.z = -.42;
    rightFin.rotation.z = .42;
    const backpack = part(new THREE.BoxGeometry(.58, .72, .25), dark, 0, 1.42, -.43);
    const packLight = part(new THREE.BoxGeometry(.38, .32, .055), accent, 0, 1.42, -.58, false);
    const leftThruster = part(new THREE.ConeGeometry(.105, .36, 6, 1, true), accent, -.2, 1.02, -.49, false);
    const rightThruster = part(new THREE.ConeGeometry(.105, .36, 6, 1, true), accent, .2, 1.02, -.49, false);
    const thrusterMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.accent).multiplyScalar(2.1), transparent: true, opacity: .5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    leftThruster.material = rightThruster.material = thrusterMaterial;
    this.thrusterMaterial = thrusterMaterial;
    leftThruster.rotation.x = rightThruster.rotation.x = Math.PI;
    this.thrusterLights = [leftThruster, rightThruster];
    if (costumeVariant === 0) {
      leftShoulder.scale.set(1.3, .82, 1.22); rightShoulder.scale.copy(leftShoulder.scale);
      helmetCrest.scale.set(.94, 1.34, 1.12);
      breastplate.scale.set(1.06, .94, 1.18);
    } else if (costumeVariant === 1) {
      helmet.scale.set(.92, 1.02, .96);
      breastplate.scale.set(.88, 1.18, 1.08);
      leftFin.scale.set(.66, 1.46, .66); rightFin.scale.copy(leftFin.scale);
    } else if (costumeVariant === 2) {
      brow.scale.set(1.22, .7, 1.14);
      leftShoulder.scale.set(.84, 1.34, .92); rightShoulder.scale.copy(leftShoulder.scale);
      backpack.scale.set(1.08, 1.16, 1.08);
    } else {
      helmetCrest.rotation.z = .28;
      helmetCrest.scale.set(.72, 1.12, 1.3);
      packLight.scale.set(.72, 1.28, 1);
      leftFin.scale.set(1.2, .82, 1.16); rightFin.scale.copy(leftFin.scale);
    }
    armor.roughness += costumeVariant * .025;
    armor.clearcoat = .68 - costumeVariant * .08;
    this.rig.add(
      torso, chest, breastplate, sternum, pelvis, spine, chestLight, helmet, visor, brow, helmetCrest, leftEar, rightEar,
      this.leftArm, this.rightArm, this.leftLeg, this.rightLeg,
      leftShoulder, rightShoulder, leftFin, rightFin, backpack, packLight, leftThruster, rightThruster
    );

    this.weaponGroup = new THREE.Group();
    this.weaponGroup.position.set(.38, 1.4, .28);
    this.rig.add(this.weaponGroup);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: radialTexture(), color: 0x000000, transparent: true, opacity: .2,
      alphaTest: .015, depthWrite: false, toneMapped: false
    });
    const shadow = part(new THREE.PlaneGeometry(1.8, 1.35), shadowMaterial, 0, .022, 0);
    shadow.name = "Soft contact shadow";
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
    this.freezeRing = part(new THREE.RingGeometry(.82, 1.08, 32), new THREE.MeshBasicMaterial({
      color: 0xa9efff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide
    }), 0, .055, 0, false);
    this.freezeRing.rotation.x = -Math.PI / 2;
    this.freezeRing.renderOrder = 4;
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
    this.freezeAura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(),
      color: 0xa9efff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }));
    this.freezeAura.position.set(0, 1.35, -.05);
    this.freezeAura.scale.set(3.15, 3.95, 1);
    this.freezeAura.renderOrder = 3;
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
    group.add(shadow, this.identityRing, this.freezeRing, this.readabilityHalo, this.freezeAura, this.identityBeacon);
    return group;
  }

  updateWeaponModel() {
    disposeChildren(this.weaponGroup);
    const weapon = this.weapon;
    const glow = material(weapon.color, weapon.color, {
      emissiveIntensity: 1.18, roughness: .14, metalness: .38, clearcoat: .76,
      iridescence: .22, iridescenceIOR: 1.28, iridescenceThicknessRange: [90, 280]
    });
    const identity = material(this.accent, this.accent, { emissiveIntensity: .92, roughness: .12, metalness: .34, clearcoat: .82, iridescence: .38 });
    const dark = material(0x091424, this.accent, { emissiveIntensity: .03, roughness: .28, metalness: .76, clearcoat: .48 });
    const presentation = weaponPresentation(weapon);
    this.weaponGlowMaterial = glow;
    this.weaponSpinner = null;
    this.weaponPiston = null;
    this.weaponMuzzleDistance = .92;
    const addSignature = () => {
      const z = Math.min(1.18, Math.max(.28, this.weaponMuzzleDistance * .58));
      let marker;
      if (["gravity", "implosion"].includes(presentation.payload)) {
        marker = part(new THREE.TorusGeometry(.18, .045, 5, 14), identity, .05, .16, z, false);
        marker.rotation.x = Math.PI / 2;
        const inner = part(new THREE.TorusGeometry(.11, .028, 4, 12), glow, .05, .16, z, false);
        inner.rotation.x = Math.PI / 2;
        this.weaponGroup.add(inner);
      } else if (presentation.payload === "freeze") {
        marker = part(new THREE.OctahedronGeometry(.17, 0), glow, .05, .17, z, false);
        marker.scale.set(.72, 1.35, .72);
      } else if (presentation.payload === "fireball") {
        marker = part(new THREE.SphereGeometry(.17, 9, 7), glow, .05, .17, z, false);
        const flame = part(new THREE.ConeGeometry(.12, .38, 7), glow, .05, .38, z, false);
        this.weaponGroup.add(flame);
      } else if (["teleport", "steal", "decoy"].includes(presentation.payload)) {
        marker = part(new THREE.TorusKnotGeometry(.1, .025, 24, 5), identity, .05, .17, z, false);
      } else if (presentation.payload === "cluster") {
        marker = new THREE.Group();
        for (let index = 0; index < 3; index++) {
          const angle = index / 3 * Math.PI * 2;
          marker.add(part(new THREE.SphereGeometry(.055, 6, 4), glow, .05 + Math.cos(angle) * .14, .16 + Math.sin(angle) * .14, z, false));
        }
      } else if (["sticky", "ricochet", "disrupt"].includes(presentation.payload)) {
        marker = part(new THREE.TorusGeometry(.16, .038, 4, presentation.payload === "ricochet" ? 4 : 12), identity, .05, .16, z, false);
        marker.rotation.x = Math.PI / 2;
      } else if (presentation.payload === "drill") {
        marker = part(new THREE.ConeGeometry(.13, .42, 7), glow, .05, .16, z, false);
        marker.rotation.x = Math.PI / 2;
      } else if (["wall", "kinetic"].includes(presentation.payload)) {
        marker = part(new THREE.BoxGeometry(.3, .055, .16), identity, .05, .17, z, false);
        marker.rotation.z = presentation.variant * Math.PI / 6;
      } else {
        marker = part(new THREE.IcosahedronGeometry(.13 + presentation.signature * .045, 0), glow, .05, .17, z, false);
      }
      this.weaponGroup.add(marker);
      const bands = 1 + presentation.variant;
      for (let index = 0; index < bands; index++) {
        const band = part(new THREE.TorusGeometry(.1 + index * .025, .018, 4, 9), index % 2 ? glow : identity, .05, .06, Math.min(this.weaponMuzzleDistance - .08, .42 + index * .19), false);
        band.rotation.x = Math.PI / 2;
        this.weaponGroup.add(band);
      }
    };
    if (weapon.type === "mine" || weapon.type === "remote") {
      const body = part(new THREE.CylinderGeometry(.3, .36, .2, 10), dark, .04, .04, .2);
      const cap = part(new THREE.CylinderGeometry(.22, .28, .05, 10), glow, .04, .17, .2, false);
      const marker = part(new THREE.TorusGeometry(.18, .035, 4, 12), identity, .04, .205, .2, false);
      marker.rotation.x = Math.PI / 2;
      this.weaponGroup.add(body, cap, marker);
      this.weaponMuzzleDistance = .55;
      addSignature();
      return;
    }
    if (weapon.id === "fireball") {
      const bracer = part(new THREE.CylinderGeometry(.2, .26, .62, 8), dark, .05, -.04, .28);
      bracer.rotation.x = Math.PI / 2;
      const cuff = part(new THREE.TorusGeometry(.25, .055, 5, 10), identity, .05, -.04, .03, false);
      const palm = part(new THREE.BoxGeometry(.34, .12, .36), dark, .05, .03, .62);
      const ember = part(new THREE.SphereGeometry(.22, 10, 8), glow, .05, .24, .82, false);
      const flameA = part(new THREE.ConeGeometry(.14, .48, 7), glow, .05, .55, .82, false);
      const flameB = part(new THREE.ConeGeometry(.09, .32, 6), identity, -.11, .43, .82, false);
      const flameC = part(new THREE.ConeGeometry(.08, .28, 6), glow, .19, .4, .82, false);
      const clawA = part(new THREE.ConeGeometry(.055, .42, 5), glow, -.17, .11, .86, false);
      const clawB = part(new THREE.ConeGeometry(.055, .42, 5), glow, .27, .11, .86, false);
      clawA.rotation.x = clawB.rotation.x = Math.PI / 2;
      this.weaponGroup.add(bracer, cuff, palm, ember, flameA, flameB, flameC, clawA, clawB);
      this.weaponMuzzleDistance = 1.12;
      addSignature();
      return;
    }
    if (weapon.type === "flame") {
      const receiver = part(new THREE.BoxGeometry(.34, .34, .58), dark, .05, .01, .28);
      const fuelTank = part(new THREE.CylinderGeometry(.19, .19, .58, 10), glow, -.18, -.04, .18, false);
      fuelTank.rotation.z = Math.PI / 2;
      const nozzle = part(new THREE.CylinderGeometry(.075, .14, 1.05, 10), dark, .05, .06, .83);
      nozzle.rotation.x = Math.PI / 2;
      const heatShield = part(new THREE.CylinderGeometry(.18, .18, .42, 10, 1, true), glow, .05, .06, .94, false);
      heatShield.rotation.x = Math.PI / 2;
      const muzzle = part(new THREE.TorusGeometry(.19, .045, 5, 12), identity, .05, .06, 1.37, false);
      const pilot = part(new THREE.ConeGeometry(.08, .26, 7), glow, .05, .06, 1.52, false);
      pilot.rotation.x = Math.PI / 2;
      this.weaponGroup.add(receiver, fuelTank, nozzle, heatShield, muzzle, pilot);
      this.weaponMuzzleDistance = 1.52;
      addSignature();
      return;
    }
    if (weapon.type === "melee") {
      const reachScale = Math.min(1.5, weapon.reach / 3.5);
      const grip = part(new THREE.CylinderGeometry(.07, .085, .34, 8), dark, .06, -.01, .03);
      grip.rotation.x = Math.PI / 2;
      this.weaponGroup.add(grip);
      if (weapon.id === "hammer") {
        const shaft = part(new THREE.CylinderGeometry(.06, .075, 1.28, 8), dark, .06, .04, .62);
        shaft.rotation.x = Math.PI / 2;
        const head = part(new THREE.BoxGeometry(.72, .42, .4), glow, .06, .04, 1.28, false);
        const face = part(new THREE.BoxGeometry(.82, .2, .24), identity, .06, .04, 1.28, false);
        this.weaponGroup.add(shaft, head, face);
        this.weaponMuzzleDistance = 1.72;
      } else if (weapon.id === "punch_glove") {
        const pistonGroup = new THREE.Group();
        const piston = part(new THREE.CylinderGeometry(.1, .13, .55, 8), dark, .06, .04, .35);
        piston.rotation.x = Math.PI / 2;
        const fist = part(new THREE.DodecahedronGeometry(.31, 0), glow, .06, .04, .72, false);
        const knuckles = part(new THREE.BoxGeometry(.52, .13, .19), identity, .06, .1, .88, false);
        pistonGroup.add(piston, fist, knuckles);
        this.weaponGroup.add(pistonGroup);
        this.weaponPiston = pistonGroup;
        this.weaponMuzzleDistance = 1.05;
      } else if (weapon.id === "chainsaw") {
        const body = part(new THREE.BoxGeometry(.34, .34, .55), dark, .06, .04, .37);
        const blade = part(new THREE.CapsuleGeometry(.09, .98, 3, 7), glow, .06, .04, 1.1, false);
        blade.rotation.x = Math.PI / 2;
        const teeth = part(new THREE.TorusGeometry(.19, .045, 4, 18), identity, .06, .04, 1.58, false);
        teeth.rotation.x = Math.PI / 2;
        teeth.scale.set(1, 1, 2.35);
        this.weaponGroup.add(body, blade, teeth);
        this.weaponSpinner = teeth;
        this.weaponMuzzleDistance = 1.88;
      } else if (weapon.id === "spear") {
        const shaft = part(new THREE.CylinderGeometry(.045, .065, 1.9 * reachScale, 8), dark, .06, .04, .78);
        shaft.rotation.x = Math.PI / 2;
        const blade = part(new THREE.ConeGeometry(.16, .62, 5), glow, .06, .04, 1.76 * reachScale, false);
        blade.rotation.x = Math.PI / 2;
        this.weaponGroup.add(shaft, blade);
        this.weaponMuzzleDistance = 2.05 * reachScale;
      } else {
        const bladeLength = (weapon.id === "knife" ? .62 : weapon.id === "shock_baton" ? .92 : 1.12) * reachScale;
        const bladeGeometry = weapon.id === "knife"
          ? new THREE.ConeGeometry(.12, bladeLength, 5)
          : weapon.id === "shock_baton"
            ? new THREE.CylinderGeometry(.055, .075, bladeLength, 8)
            : new THREE.CapsuleGeometry(.055, Math.max(.16, bladeLength - .12), 3, 7);
        const blade = part(bladeGeometry, glow, .06, .04, .43 + bladeLength * .35, false);
        blade.rotation.x = Math.PI / 2;
        const guard = part(new THREE.BoxGeometry(.38, .09, .1), identity, .06, .04, .18, false);
        this.weaponGroup.add(blade, guard);
        this.weaponMuzzleDistance = .55 + bladeLength;
      }
      addSignature();
      return;
    }
    if (presentation.delivery === "disc") {
      const bracer = part(new THREE.CylinderGeometry(.18, .24, .54, 8), dark, .05, -.04, .25);
      bracer.rotation.x = Math.PI / 2;
      const blade = part(new THREE.TorusGeometry(.34, .085, 5, 18), glow, .05, .11, .72, false);
      blade.rotation.x = Math.PI / 2;
      const rim = part(new THREE.TorusGeometry(.43, .035, 4, 24), identity, .05, .11, .72, false);
      rim.rotation.x = Math.PI / 2;
      const hub = part(new THREE.OctahedronGeometry(.13, 0), identity, .05, .11, .72, false);
      const grip = part(new THREE.BoxGeometry(.18, .22, .45), dark, .05, -.08, .48);
      this.weaponGroup.add(bracer, blade, rim, hub, grip);
      this.weaponSpinner = blade;
      this.weaponMuzzleDistance = 1.18;
      addSignature();
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
      const sight = part(new THREE.BoxGeometry(.12, .16, .46), identity, -.17, .2, .61, false);
      const fin = part(new THREE.BoxGeometry(.42, .08, .28), dark, .05, -.09, .72);
      this.weaponGroup.add(tube, muzzle, sight, fin);
      this.weaponMuzzleDistance = 1.28;
    } else if (weapon.type === "plasma") {
      const chamber = part(new THREE.IcosahedronGeometry(.24, 1), glow, .05, .07, .58, false);
      const cageMaterial = identity.clone();
      cageMaterial.wireframe = true;
      const cage = part(new THREE.IcosahedronGeometry(.3, 1), cageMaterial, .05, .07, .58, false);
      const barrel = part(new THREE.CylinderGeometry(.08, .13, .55, 8), dark, .05, .07, .92);
      barrel.rotation.x = Math.PI / 2;
      const prongA = part(new THREE.BoxGeometry(.07, .08, .5), identity, -.15, .08, .94, false);
      const prongB = part(new THREE.BoxGeometry(.07, .08, .5), identity, .25, .08, .94, false);
      this.weaponGroup.add(chamber, cage, barrel, prongA, prongB);
      this.weaponMuzzleDistance = 1.21;
    } else if (weapon.type === "rail") {
      const railA = part(new THREE.BoxGeometry(.08, .1, 1.18), glow, -.055, .08, .78, false);
      const railB = part(new THREE.BoxGeometry(.08, .1, 1.18), glow, .155, .08, .78, false);
      const bridge = part(new THREE.BoxGeometry(.31, .08, .16), identity, .05, .08, 1.19, false);
      const capacitor = part(new THREE.CylinderGeometry(.17, .17, .38, 10), identity, .05, .19, .46, false);
      capacitor.rotation.z = Math.PI / 2;
      const stock = part(new THREE.BoxGeometry(.28, .22, .42), dark, .05, .01, -.14);
      this.weaponGroup.add(railA, railB, bridge, capacitor, stock);
      this.weaponMuzzleDistance = 1.42;
    } else if (weapon.type === "beam" || weapon.type === "chain") {
      const emitter = part(new THREE.CylinderGeometry(.1, .16, .92, 8), dark, .05, .06, .69);
      emitter.rotation.x = Math.PI / 2;
      const coil = part(new THREE.TorusGeometry(.21, .065, 5, 12), glow, .05, .06, .61, false);
      const forkA = part(new THREE.BoxGeometry(.07, .08, .62), identity, -.13, .07, .93, false);
      const forkB = part(new THREE.BoxGeometry(.07, .08, .62), identity, .23, .07, .93, false);
      if (weapon.type === "chain") {
        forkA.rotation.y = -.15;
        forkB.rotation.y = .15;
      }
      this.weaponGroup.add(emitter, coil, forkA, forkB);
      this.weaponMuzzleDistance = 1.31;
    } else if (weapon.type === "spread") {
      const barrelA = part(new THREE.CylinderGeometry(.08, .11, .82, 8), glow, -.07, .08, .74);
      const barrelB = part(new THREE.CylinderGeometry(.08, .11, .82, 8), glow, .17, .08, .74);
      barrelA.rotation.x = barrelB.rotation.x = Math.PI / 2;
      const shroud = part(new THREE.BoxGeometry(.42, .17, .62), dark, .05, .04, .61);
      const pump = part(new THREE.BoxGeometry(.46, .11, .3), identity, .05, -.07, .63, false);
      this.weaponGroup.add(shroud, barrelA, barrelB, pump);
      this.weaponMuzzleDistance = 1.19;
    } else if (weapon.id === "submachine_gun") {
      const shortBody = part(new THREE.BoxGeometry(.34, .28, .54), dark, .05, .02, .38);
      const vent = part(new THREE.BoxGeometry(.39, .08, .32), glow, .05, .15, .42, false);
      const barrel = part(new THREE.CylinderGeometry(.055, .08, .48, 7), glow, .05, .05, .82);
      barrel.rotation.x = Math.PI / 2;
      const stickMagazine = part(new THREE.BoxGeometry(.15, .42, .18), identity, .05, -.27, .31, false);
      stickMagazine.rotation.x = -.16;
      const compactStock = part(new THREE.BoxGeometry(.28, .08, .35), identity, .05, .04, -.13, false);
      const muzzle = part(new THREE.TorusGeometry(.1, .028, 4, 9), identity, .05, .05, 1.05, false);
      this.weaponGroup.add(shortBody, vent, barrel, stickMagazine, compactStock, muzzle);
      this.weaponMuzzleDistance = 1.08;
    } else if (weapon.id === "mortar") {
      const tube = part(new THREE.CylinderGeometry(.2, .29, 1.08, 10), dark, .05, .08, .72);
      tube.rotation.x = Math.PI / 2;
      const muzzle = part(new THREE.TorusGeometry(.29, .065, 5, 12), glow, .05, .08, 1.25, false);
      const breech = part(new THREE.CylinderGeometry(.25, .25, .32, 10), identity, .05, .08, .18, false);
      breech.rotation.z = Math.PI / 2;
      const rangeSight = part(new THREE.TorusGeometry(.16, .025, 4, 12, Math.PI), identity, -.22, .25, .68, false);
      rangeSight.rotation.y = Math.PI / 2;
      const shoulderBrace = part(new THREE.BoxGeometry(.38, .16, .45), dark, .05, -.08, -.08);
      this.weaponGroup.add(tube, muzzle, breech, rangeSight, shoulderBrace);
      this.weaponMuzzleDistance = 1.38;
    } else if (weapon.id === "minigun" || weapon.id === "machine_gun") {
      const barrelCount = weapon.id === "minigun" ? 4 : 2;
      const barrelCluster = new THREE.Group();
      for (let index = 0; index < barrelCount; index++) {
        const angle = index / barrelCount * Math.PI * 2;
        const barrel = part(new THREE.CylinderGeometry(.045, .06, .86, 6), glow, .05 + Math.cos(angle) * .11, .06 + Math.sin(angle) * .11, .72, false);
        barrel.rotation.x = Math.PI / 2;
        barrelCluster.add(barrel);
      }
      const drum = part(new THREE.CylinderGeometry(.2, .2, .32, 10), identity, .05, -.11, .34, false);
      drum.rotation.z = Math.PI / 2;
      this.weaponGroup.add(barrelCluster, drum);
      if (weapon.id === "minigun") this.weaponSpinner = barrelCluster;
      this.weaponMuzzleDistance = 1.17;
    } else {
      const scale = weapon.type === "grenade" ? 1.15 : .82;
      const barrel = part(new THREE.CylinderGeometry(.095 * scale, .135 * scale, .76 * scale, 9), glow, .05, .06, .69);
      barrel.rotation.x = Math.PI / 2;
      const muzzle = part(new THREE.TorusGeometry(.13 * scale, .035, 4, 10), identity, .05, .06, .98, false);
      this.weaponGroup.add(barrel, muzzle);
      if (weapon.type === "grenade") {
        const drum = part(new THREE.CylinderGeometry(.22, .22, .36, 10), dark, .05, -.12, .39);
        drum.rotation.z = Math.PI / 2;
        this.weaponGroup.add(drum);
      } else if (weapon.id === "needle_launcher") {
        const needle = part(new THREE.ConeGeometry(.08, .52, 5), identity, .05, .06, 1.16, false);
        needle.rotation.x = Math.PI / 2;
        this.weaponGroup.add(needle);
      }
      this.weaponMuzzleDistance = 1.08;
    }
    addSignature();
  }

  switchSlot(index) {
    if (index < 0 || index >= this.loadout.length || index === this.slotIndex) return;
    this.slotIndex = index;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.updateWeaponModel();
  }

  reload() {
    const weapon = this.weapon;
    if (this.reloadTimer > 0 || this.ammo[weapon.id] === weapon.ammo) return false;
    this.reloadTimer = weapon.reload;
    this.reloadWeaponId = weapon.id;
    return true;
  }

  recoil(amount = this.weapon.recoil) {
    this.velocity.addScaledVector(this.aim, -amount);
    this.recoilVisual = Math.max(this.recoilVisual, clamp(.15 + amount * .12, .18, .9));
  }

  takeHit(amount, push = null) {
    if (!this.alive) return false;
    this.health = clamp(this.health - amount, 0, 100);
    this.hitTimer = .5;
    this.hitStagger = push?.lengthSq()
      ? Math.sign(push.x * this.aim.z - push.z * this.aim.x) || 1
      : (Number(String(this.id).match(/\d+/)?.[0] || 1) % 2 ? 1 : -1);
    if (push) this.velocity.add(push);
    if (this.health > 0) return false;
    this.alive = false;
    this.slowTimer = 0;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.freezeRing.material.opacity = 0;
    this.freezeAura.material.opacity = 0;
    this.deaths += 1;
    this.deathTimer = 1.4;
    return true;
  }

  updateDeath(dt) {
    if (this.alive || this.deathTimer <= 0) return;
    this.deathTimer = Math.max(0, this.deathTimer - dt);
    const progress = 1 - this.deathTimer / 1.4;
    const side = Number(String(this.id).match(/\d+/)?.[0] || 1) % 2 ? 1 : -1;
    const burst = Math.sin(progress * Math.PI);
    const fade = 1 - progress;
    this.rig.rotation.set(progress * .88, side * progress * 1.5, side * progress * 1.28);
    this.rig.position.y = burst * .28 - progress * .78;
    this.leftArm.rotation.z = .72 + side * progress * .7;
    this.rightArm.rotation.z = -.72 + side * progress * .5;
    this.leftLeg.rotation.x = .35 + progress * .9;
    this.rightLeg.rotation.x = -.2 - progress * .7;
    this.group.scale.setScalar(1 + burst * .1 - progress * .78);
    this.armorMaterial.emissiveIntensity = 1.65 * fade;
    this.accentMaterial.emissiveIntensity = 2.8 * fade;
    this.darkMaterial.emissiveIntensity = .5 * burst;
    this.identityRing.material.opacity = .62 * fade;
    this.readabilityHalo.material.opacity = .32 * burst * fade;
    this.identityBeacon.material.opacity = fade;
    if (this.deathTimer === 0) this.group.visible = false;
  }

  respawn(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.deathTimer = 0;
    this.grounded = true;
    this.boosted = false;
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.rig.position.y = 0;
    this.rig.rotation.set(0, 0, 0);
    this.rig.scale.set(1.07, 1.04, 1.07);
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);
    this.leftLeg.rotation.set(0, 0, 0);
    this.rightLeg.rotation.set(0, 0, 0);
    this.armorMaterial.emissiveIntensity = .16;
    this.accentMaterial.emissiveIntensity = 1.25;
    this.darkMaterial.emissiveIntensity = .025;
    this.identityRing.material.opacity = .46;
    this.readabilityHalo.material.opacity = .14;
    this.identityBeacon.material.opacity = .94;
    this.reloadTimer = 0;
    this.reloadWeaponId = null;
    this.attackTimer = .7;
    this.pendingBurst = null;
    this.chargeTimer = 0;
    this.chargeLevel = 0;
    this.chargingWeaponId = null;
    this.slowTimer = 0;
    this.landTimer = 0;
    this.landStrength = 0;
    this.recoilVisual = 0;
    this.hitStagger = 1;
    this.grapple = null;
    this.ledgeContact = null;
  }

  update(dt, move, look, actions, world) {
    if (!this.alive) return;
    const wasGrounded = this.grounded;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const reloading = this.reloadTimer > 0;
    this.reloadTimer = Math.max(0, this.reloadTimer - dt);
    if (reloading && this.reloadTimer === 0 && this.reloadWeaponId) {
      this.ammo[this.reloadWeaponId] = WEAPONS[this.reloadWeaponId].ammo;
      this.reloadWeaponId = null;
    }
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);
    this.recoilVisual = THREE.MathUtils.damp(this.recoilVisual, 0, 8, dt);

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
    this.boosted = Boolean(boost);
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
    const hitProgress = 1 - clamp(this.hitTimer / .5, 0, 1);
    const hitWave = this.hitTimer > 0 ? Math.sin(hitProgress * Math.PI) : 0;
    let grappleSide = 0;
    if (grappled) {
      const anchor = this.grapple.wraps?.[0] || this.grapple.anchor;
      const dx = anchor.x - this.position.x;
      const dz = anchor.z - this.position.z;
      grappleSide = (dx * this.aim.z - dz * this.aim.x) / Math.max(1, Math.hypot(dx, dz));
    }
    let leftLegTarget;
    let rightLegTarget;
    if (this.grounded) {
      leftLegTarget = moving ? gait * (.5 + locomotion * .34) + landing * .8 : landing * .8;
      rightLegTarget = moving ? -gait * (.5 + locomotion * .34) + landing * .8 : landing * .8;
    } else if (grappled) {
      leftLegTarget = .94 + clamp(-this.velocity.y * .024, -.28, .34) - grappleSide * .18;
      rightLegTarget = -.52 + clamp(-this.velocity.y * .018, -.2, .28) + grappleSide * .18;
    } else {
      const tuck = clamp(Math.abs(this.velocity.y) / 18, .12, .52);
      leftLegTarget = this.velocity.y > 0 ? .48 + tuck * .55 : .18 + tuck;
      rightLegTarget = this.velocity.y > 0 ? -.32 + tuck * .38 : -.14 + tuck * .78;
    }
    this.leftLeg.rotation.x = THREE.MathUtils.damp(this.leftLeg.rotation.x, leftLegTarget, 15, dt);
    this.rightLeg.rotation.x = THREE.MathUtils.damp(this.rightLeg.rotation.x, rightLegTarget, 15, dt);

    const aimPitch = Math.asin(clamp(this.aim.y, -1, 1));
    const melee = this.weapon.type === "melee";
    const meleeMotion = this.weapon.meleeMotion;
    const attacking = this.attackTimer > this.weapon.cooldown * .55;
    const attackPhase = this.weapon.cooldown > 0 ? clamp(this.attackTimer / this.weapon.cooldown, 0, 1) : 0;
    const attackSwing = attacking ? Math.sin((1 - attackPhase) * Math.PI) : 0;
    const reloadingPose = this.reloadTimer > 0 ? 1 : 0;
    let leftArmTarget = -1.06 - aimPitch * .65 - gait * locomotion * .075;
    let rightArmTarget = -1.24 - aimPitch * .72 + this.recoilVisual * 1.06 + gait * locomotion * .045;
    let leftArmRoll = .64;
    let rightArmRoll = -.18;
    if (melee) {
      leftArmTarget = -.42;
      rightArmTarget = attacking
        ? meleeMotion === "overhead" ? -2.28 + attackSwing * .92
          : ["thrust", "stab", "punch"].includes(meleeMotion) ? -.7 - attackSwing * .65
            : -1.72 + attackSwing * .46
        : -.48;
      leftArmRoll = .1;
      rightArmRoll = -.2 - attackSwing * (meleeMotion === "saw" ? .12 : meleeMotion === "overhead" ? .3 : .78);
    } else if (grappled) {
      const anchor = this.grapple.wraps?.[0] || this.grapple.anchor;
      const ropeLength = anchor ? this.position.distanceTo(anchor) : 1;
      const ropePitch = anchor ? Math.asin(clamp((anchor.y - this.position.y - 1.4) / Math.max(.01, ropeLength), -1, 1)) : 0;
      leftArmTarget = -1.78 - ropePitch * .82;
      leftArmRoll = .5 + grappleSide * .3;
      rightArmTarget -= .22;
    } else if (reloadingPose) {
      leftArmTarget = -.58;
      rightArmTarget = -.82;
      leftArmRoll = .72;
      rightArmRoll = -.38;
    }
    if (landing > .05) {
      leftArmTarget -= landing * .24;
      rightArmTarget -= landing * .2;
      leftArmRoll += landing * .18;
      rightArmRoll -= landing * .18;
    }
    if (hitWave > .01) {
      leftArmTarget += hitWave * .24;
      rightArmTarget -= hitWave * .2;
      leftArmRoll += this.hitStagger * hitWave * .34;
      rightArmRoll += this.hitStagger * hitWave * .28;
    }
    this.leftArm.rotation.x = THREE.MathUtils.damp(this.leftArm.rotation.x, leftArmTarget, 19, dt);
    this.rightArm.rotation.x = THREE.MathUtils.damp(this.rightArm.rotation.x, rightArmTarget, 19, dt);
    this.leftArm.rotation.z = THREE.MathUtils.damp(this.leftArm.rotation.z, leftArmRoll, 17, dt);
    this.rightArm.rotation.z = THREE.MathUtils.damp(this.rightArm.rotation.z, rightArmRoll, 17, dt);
    this.leftArm.rotation.y = THREE.MathUtils.damp(this.leftArm.rotation.y, melee ? 0 : -.26, 17, dt);
    this.rightArm.rotation.y = THREE.MathUtils.damp(this.rightArm.rotation.y, melee ? .15 : .08, 17, dt);

    let leftElbow = melee ? -.22 : -.78 - aimPitch * .16;
    let rightElbow = melee ? -.18 : -.42 - aimPitch * .12 + this.recoilVisual * .48;
    let leftElbowRoll = melee ? .08 : -.18;
    let rightElbowRoll = melee ? -.05 : .12;
    if (grappled) {
      leftElbow = .08;
      leftElbowRoll = .03;
      rightElbow = -.55;
    } else if (reloadingPose) {
      leftElbow = -1.08;
      rightElbow = -.72;
      leftElbowRoll = -.38;
      rightElbowRoll = .26;
    } else if (landing > .05) {
      leftElbow -= landing * .38;
      rightElbow -= landing * .38;
      leftElbowRoll -= landing * .24;
      rightElbowRoll += landing * .24;
    }
    this.leftForearm.rotation.x = THREE.MathUtils.damp(this.leftForearm.rotation.x, leftElbow, 22, dt);
    this.rightForearm.rotation.x = THREE.MathUtils.damp(this.rightForearm.rotation.x, rightElbow, 22, dt);
    this.leftForearm.rotation.z = THREE.MathUtils.damp(this.leftForearm.rotation.z, leftElbowRoll, 18, dt);
    this.rightForearm.rotation.z = THREE.MathUtils.damp(this.rightForearm.rotation.z, rightElbowRoll, 18, dt);

    const overheadPitch = meleeMotion === "overhead" ? -attackSwing * 1.05 : 0;
    const thrustMotion = ["thrust", "stab", "punch"].includes(meleeMotion) ? attackSwing : 0;
    this.weaponGroup.rotation.x = THREE.MathUtils.damp(this.weaponGroup.rotation.x, -aimPitch + this.recoilVisual * .46 + overheadPitch, 22, dt);
    this.weaponGroup.rotation.y = THREE.MathUtils.damp(this.weaponGroup.rotation.y, melee && !thrustMotion ? attackSwing * (meleeMotion === "saw" ? .12 : .72) : 0, 19, dt);
    this.weaponGroup.rotation.z = THREE.MathUtils.damp(this.weaponGroup.rotation.z, melee ? -.18 - attackSwing * (meleeMotion === "overhead" ? .26 : meleeMotion === "saw" ? .1 : .85) : grappled ? Math.sin(time * .42) * .035 : 0, 16, dt);
    this.weaponGroup.position.x = THREE.MathUtils.damp(this.weaponGroup.position.x, melee ? .45 : reloadingPose ? .22 : .38, 18, dt);
    this.weaponGroup.position.y = THREE.MathUtils.damp(this.weaponGroup.position.y, 1.4 - landing * .11 + (this.grounded && moving ? gait * .025 : 0), 20, dt);
    this.weaponGroup.position.z = THREE.MathUtils.damp(this.weaponGroup.position.z, .28 - this.recoilVisual * .46 + thrustMotion * .58, 24, dt);
    this.weaponGroup.scale.set(1 + this.recoilVisual * .04, 1 + this.recoilVisual * .04, 1 - this.recoilVisual * .08);
    if (this.weaponGlowMaterial) this.weaponGlowMaterial.emissiveIntensity = 1.35 + this.chargeLevel * (2.4 + Math.sin(time * 2.4) * .55);
    if (this.weaponSpinner) this.weaponSpinner.rotation.z += dt * (this.attackTimer > 0 ? 32 : 5);
    if (this.weaponPiston) this.weaponPiston.position.z = THREE.MathUtils.damp(this.weaponPiston.position.z, attacking ? .42 * attackSwing : 0, 24, dt);
    const bob = this.grounded && moving ? Math.abs(gait) * .075 : Math.sin(time * .45) * .018;
    this.rig.position.y = bob - landing * .27;
    const airStretch = this.grounded ? 0 : clamp(Math.abs(this.velocity.y) / 36, 0, .09);
    this.rig.scale.set(1.07 + landing * .14 - airStretch * .35, 1.04 - landing * .27 + airStretch, 1.07 + landing * .14 - airStretch * .35);
    const strafe = this.velocity.x * this.aim.z - this.velocity.z * this.aim.x;
    const bodyRoll = clamp(-strafe * .032, -.2, .2) + grappleSide * .36 + this.hitStagger * hitWave * .4;
    this.rig.rotation.z = THREE.MathUtils.damp(this.rig.rotation.z, bodyRoll, 12, dt);
    const bodyPitch = grappled
      ? clamp(-.38 - this.velocity.y * .02, -.62, .12)
      : !this.grounded ? clamp(-this.velocity.y * .015, -.18, .2)
        : moving ? -.1 * locomotion + landing * .12 : landing * .12;
    this.rig.rotation.x = THREE.MathUtils.damp(this.rig.rotation.x, bodyPitch + hitWave * .2, 11, dt);
    this.rig.rotation.y = THREE.MathUtils.damp(this.rig.rotation.y, melee ? -attackSwing * .34 : clamp(-strafe * .009, -.09, .09) - this.recoilVisual * .12, 12, dt);
    const legBrace = landing * .22 + (this.grounded && !moving ? .025 : 0) + (grappled ? Math.abs(grappleSide) * .08 : 0);
    this.leftLeg.rotation.z = THREE.MathUtils.damp(this.leftLeg.rotation.z, legBrace, 14, dt);
    this.rightLeg.rotation.z = THREE.MathUtils.damp(this.rightLeg.rotation.z, -legBrace, 14, dt);
    this.helmet.rotation.x = THREE.MathUtils.damp(this.helmet.rotation.x, -aimPitch * .18 + landing * .07, 12, dt);
    this.visor.rotation.x = this.helmet.rotation.x;
    const thrust = landing > .05 ? 1.7 + landing * .7 : grappled ? 1.8 : this.grounded ? .65 : 1.2 + clamp(horizontalSpeed / 32, 0, .65);
    for (const thruster of this.thrusterLights) thruster.scale.y = THREE.MathUtils.damp(thruster.scale.y, thrust, 11, dt);
    if (this.thrusterMaterial) this.thrusterMaterial.opacity = .32 + clamp(thrust / 2.4, 0, 1) * .48;
    const hit = this.hitTimer > 0;
    const hitFlash = hit ? .55 + hitWave * .95 : 0;
    this.armorMaterial.emissiveIntensity = .16 + hitFlash * 1.45;
    this.accentMaterial.emissiveIntensity = 1.25 + hitFlash * 1.15;
    this.darkMaterial.emissiveIntensity = .025 + hitFlash * .44;
    const pulse = .5 + Math.sin(time * .55 + this.id.length) * .5;
    const frozen = this.slowTimer > 0;
    const freezePulse = .5 + Math.sin(time * 1.8) * .5;
    this.freezeRing.material.opacity = frozen ? .4 + freezePulse * .28 : 0;
    this.freezeRing.scale.setScalar(1 + freezePulse * .16);
    this.freezeRing.rotation.z -= dt * (frozen ? 1.6 : 0);
    this.freezeAura.material.opacity = frozen ? .16 + freezePulse * .08 : 0;
    this.identityRing.material.opacity = hit ? .62 + hitWave * .32 : .34 + pulse * .17;
    this.identityRing.scale.setScalar(1 + pulse * .045);
    this.identityRing.rotation.z += dt * .32;
    this.readabilityHalo.material.opacity = hit ? .22 + hitWave * .18 : .12 + locomotion * .06;
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
  const value = new THREE.Vector3(touch?.x || 0, 0, touch?.y || 0);
  return value.lengthSq() > 1 ? value.normalize() : value;
}

export function cameraRelative(vector, yaw) {
  if (!vector.lengthSq()) return vector;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  return right.multiplyScalar(vector.x).addScaledVector(forward, -vector.z);
}

export function aimWithSpread(aim, spread, random = Math.random) {
  if (!spread) return aim.clone().normalize();
  const forward = aim.clone().normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < .001) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return forward
    .addScaledVector(right, (random() - .5) * spread)
    .addScaledVector(up, (random() - .5) * spread)
    .normalize();
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

export function flameConeFactor(origin, direction, target, targetRadius = .72, reach = 11.5, halfAngle = .22) {
  const aim = direction.clone().normalize();
  const offset = target.clone().sub(origin);
  const along = offset.dot(aim);
  if (along < -targetRadius || along > reach + targetRadius) return 0;
  const radial = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
  const coneRadius = .32 + Math.max(0, along) * Math.tan(halfAngle);
  if (radial > coneRadius + targetRadius) return 0;
  const edge = clamp((radial - targetRadius * .65) / Math.max(.01, coneRadius), 0, 1);
  const distance = clamp(along / reach, 0, 1);
  return (1 - edge * .45) * (1 - Math.max(0, distance - .45) / .55 * .28);
}

export function applyWeaponStatus(target, weapon) {
  if (!target?.alive || weapon?.effect !== "freeze") return;
  target.slowTimer = Math.max(target.slowTimer || 0, weapon.effectDuration || 2);
}
