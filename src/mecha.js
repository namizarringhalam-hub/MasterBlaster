import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const footMatrix = new THREE.Matrix4();

// Armor is baked by joint, with vertex colors for the paint, ceramic and frame.
// Each moving assembly costs one draw regardless of how many plates it carries.
function plate(outline, depth, bevel = .012) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: bevel > 0, bevelSegments: 1, bevelSize: bevel,
    bevelThickness: bevel, curveSegments: 1
  }).translate(0, 0, -depth / 2);
}

function panel(w, h, d, cut = .15) {
  const x = w / 2, y = h / 2, c = Math.min(w, h) * cut;
  return plate([[-x + c, y], [x - c, y], [x, y - c], [x, -y + c],
    [x - c, -y], [-x + c, -y], [-x, -y + c], [-x, y - c]], d, Math.min(.012, d * .15));
}

function assembly(material, name, author) {
  const pieces = [];
  const add = (geometry, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    source.applyMatrix4(transform);
    const paint = new THREE.Color(color), colors = new Float32Array(source.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = paint.r; colors[i + 1] = paint.g; colors[i + 2] = paint.b; }
    source.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pieces.push(source);
  };
  author(add);
  const geometry = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

export function createMechaRig(fighter) {
  const variant = [...fighter.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  const paint = fighter.color, light = fighter.accent, frame = 0x152333, steel = 0x43586b, ceramic = 0xd2dce0;
  const armor = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: .34,
    metalness: .62, clearcoat: .42, clearcoatRoughness: .24, envMapIntensity: .8,
    emissive: fighter.accent, emissiveIntensity: .025 });
  const glow = new THREE.MeshPhysicalMaterial({ color: fighter.accent, emissive: fighter.accent,
    emissiveIntensity: .7, roughness: .28, metalness: .15, toneMapped: false });
  fighter.armorMaterial = armor;
  fighter.accentMaterial = glow;
  const rig = new THREE.Group();
  rig.name = "Mecha articulated armor";
  rig.scale.set(1.07, 1.04, 1.07);
  fighter.rig = rig;

  rig.add(assembly(armor, "Mecha torso and backpack", add => {
    add(panel(.65, .64, .38), frame, 0, 1.43);
    add(panel(.4, .22, .31), steel, 0, 1.17);
    for (const y of [1.12, 1.19, 1.26]) add(panel(.34, .035, .045, .08), frame, 0, y, .2);
    add(panel(.64, .16, .38), paint, 0, 1.055);
    add(plate([[-.12, .11], [.12, .11], [.15, -.05], [0, -.15], [-.15, -.05]], .12), ceramic, 0, 1.035, .25);
    add(plate([[-.46, .15], [-.31, .27], [.31, .27], [.46, .15], [.38, -.16], [0, -.27], [-.38, -.16]], .34), paint, 0, 1.51, .04);
    // The raised collar, inset vents and prow establish a mobile-suit chest.
    add(panel(.5, .075, .22), ceramic, 0, 1.81, .03);
    add(plate([[-.13, .14], [0, .19], [.13, .14], [.1, -.07], [0, -.15], [-.1, -.07]], .16), paint, 0, 1.49, .25);
    add(panel(.105, .055, .018), light, 0, 1.53, .343);
    for (const side of [-1, 1]) {
      add(panel(.185, .18, .035), frame, side * .255, 1.6, .237, 0, side * .12);
      for (const y of [1.55, 1.60, 1.65]) add(panel(.135, .019, .024, .05), steel, side * .255, y, .267, 0, side * .12);
      add(panel(.09, .18, .07), ceramic, side * .365, 1.39, .17, 0, 0, -side * .18);
      add(panel(.22, .032, .025), ceramic, side * .23, 1.755, .23, 0, 0, -side * .16);
      add(panel(.055, .028, .015), light, side * .34, 1.74, .233);
      add(panel(.22, .55, .23), frame, side * .21, 1.53, -.38);
      add(panel(.18, .4, .075), paint, side * .21, 1.58, -.525);
      add(panel(.12, .31, .13), steel, side * .21, 1.86, -.40, -.18);
      add(panel(.07, .11, .025), light, side * .21, 1.7, -.575);
      add(new THREE.CylinderGeometry(.115, .145, .19, 8, 1, true), frame, side * .2, 1.19, -.49);
      add(new THREE.CylinderGeometry(.102, .12, .035, 8, 1, true), steel, side * .2, 1.085, -.49);
    }
  }));

  const head = new THREE.Group();
  head.name = "Mecha helmet";
  head.position.set(0, 2.08, 0);
  head.scale.setScalar(.86);
  fighter.helmet = head;
  head.add(assembly(armor, "Mecha helmet armor", add => {
    add(panel(.14, .16, .14), frame, 0, -.24);
    add(plate([[-.235, -.13], [-.25, .06], [-.15, .21], [.15, .21], [.25, .06], [.235, -.13], [0, -.23]], .34), paint, 0, .005, -.04);
    add(plate([[-.205, .075], [0, .115], [.205, .075], [.17, -.1], [0, -.17], [-.17, -.1]], .04), frame, 0, .005, .159);
    for (const side of [-1, 1]) {
      add(plate([[-.055, .035], [.055, .01], [.05, -.12], [-.04, -.15]], .08), ceramic, side * .17, -.065, .175, 0, side * .12, -side * .12);
      add(panel(.07, .19, .17), steel, side * .255, -.03, -.02);
      // Four crest/shoulder families share the same readable face and proportions.
      const crestX = [.32, .25, .16, .29][variant], crestY = [.38, .46, .40, .43][variant];
      add(plate([[side * .04, .09], [side * crestX, crestY], [side * .125, .095]], .035, .004),
        variant === 2 ? paint : ceramic, 0, .01, .183);
      add(panel(.045, .04, .018), light, side * .265, .045, .073);
    }
    add(plate([[-.065, .035], [0, .085], [.065, .035], [.055, -.09], [0, -.135], [-.055, -.09]], .07), ceramic, 0, -.07, .235);
    for (const y of [-.105, -.075]) add(panel(.065, .011, .012, .05), frame, 0, y, .282);
    add(plate([[-.055, .04], [0, .075], [.055, .04], [0, -.055]], .05), paint, 0, .12, .219);
    add(panel(.055, .13, .13), steel, 0, .18, -.09);
  }));
  const eyes = assembly(glow, "Mecha twin eye lenses", add => {
    for (const side of [-1, 1]) add(plate([[side * .028, .04], [side * .174, .061], [side * .146, .008], [side * .042, .008]], .012, .002),
      0xffffff, 0, 0, .211);
    add(panel(.035, .045, .01), 0xffffff, 0, .177, .221);
  });
  fighter.visor = eyes;
  head.add(eyes); rig.add(head);

  for (const side of [-1, 1]) {
    const prefix = side < 0 ? "left" : "right";
    const upper = new THREE.Group(); upper.name = `Mecha ${prefix} arm`; upper.position.set(side * .61, 1.67, 0);
    const forearm = new THREE.Group(); forearm.name = `Mecha ${prefix} forearm`; forearm.position.y = -.55;
    upper.add(assembly(armor, `Mecha ${prefix} shoulder and upper arm`, add => {
      add(new THREE.SphereGeometry(.145, 8, 6), frame, 0, -.045);
      add(panel(.19, .32, .2), ceramic, 0, -.29);
      add(panel(.11, .21, .035), steel, 0, -.28, .12);
      const width = [.4, .35, .43, .36][variant];
      add(plate([[-width / 2, .09], [-width * .3, .155], [width * .35, .18], [width * .55, .10], [width * .6, -.08], [width * .33, -.20], [-width * .48, -.15]], .33),
        paint, side * .045, .045, 0, 0, 0, -side * .08);
      add(panel(width * .70, .03, .032), ceramic, side * .04, .13, .184);
      add(panel(.09, .035, .02), light, side * .075, .065, .184);
      add(panel(width * .54, .05, .018), frame, side * .045, -.07, .184);
      for (const y of [-.025, .035]) add(panel(.17, .023, .02), steel, side * .04, y, -.18);
      if (variant === 1 || variant === 3) add(plate([[-.05, -.09], [.08, -.16], [.1, .23]], .06),
        paint, side * .17, .02, -.12, 0, 0, -side * .35);
    }));
    forearm.add(assembly(armor, `Mecha ${prefix} bracer and hand`, add => {
      add(new THREE.CylinderGeometry(.125, .125, .22, 10), steel, 0, 0, 0, 0, 0, Math.PI / 2);
      add(panel(.25, .37, .26), paint, 0, -.235, .022);
      add(plate([[-.045, .14], [.045, .14], [.055, -.17], [-.055, -.17]], .045), ceramic, 0, -.23, .166);
      add(panel(.14, .035, .02), light, 0, -.35, .198);
      add(panel(.13, .075, .13), steel, 0, -.462, .035);
      add(panel(.18, .17, .16), frame, 0, -.575, .05);
      for (const x of [-.067, -.022, .022, .067]) add(panel(.032, .05, .047), steel, x, -.615, .136);
      add(panel(.06, .09, .075), frame, -side * .102, -.56, .11, 0, 0, side * .25);
    }));
    upper.add(forearm); rig.add(upper);
    fighter[`${prefix}Arm`] = upper; fighter[`${prefix}Forearm`] = forearm;
    fighter[`${prefix}Hand`] = { position: new THREE.Vector3(0, -.58, .05) };

    const leg = new THREE.Group(); leg.name = `Mecha ${prefix} leg`; leg.position.set(side * .235, 1.04, 0);
    leg.scale.y = 1.15;
    leg.add(assembly(armor, `Mecha ${prefix} thigh and skirt`, add => {
      add(new THREE.SphereGeometry(.13, 8, 6), frame, 0, -.025);
      add(panel(.23, .31, .25), ceramic, 0, -.2);
      add(panel(.13, .21, .03), steel, 0, -.2, -.148);
      add(plate([[-.13, .11], [.13, .11], [.155, -.16], [-.1, -.17]], .085), paint, 0, -.12, .204, -.16, 0, side * .075);
      add(panel(.13, .035, .015), ceramic, 0, -.14, .267);
      add(plate([[-.08, .12], [.08, .08], [.13, -.18], [-.07, -.14]], .16), paint, side * .17, -.105, -.025, 0, 0, side * .17);
    }));
    const knee = new THREE.Group(); knee.name = `Mecha ${prefix} knee`; knee.position.y = -.385;
    knee.add(assembly(armor, `Mecha ${prefix} shin and boot`, add => {
      add(new THREE.CylinderGeometry(.12, .12, .22, 10), steel, 0, 0, 0, 0, 0, Math.PI / 2);
      add(plate([[-.115, .10], [.115, .10], [.16, -.27], [.11, -.36], [-.11, -.36], [-.16, -.27]], .29), paint, 0, -.115, -.015);
      add(plate([[-.11, .09], [0, .145], [.11, .09], [.085, -.055], [0, -.1], [-.085, -.055]], .06), ceramic, 0, -.005, .173);
      add(panel(.055, .035, .016), light, 0, .042, .212);
      add(plate([[-.06, .10], [.06, .10], [.08, -.14], [-.08, -.14]], .035), ceramic, 0, -.235, .158);
      for (const y of [-.17, -.23]) add(panel(.07, .025, .025), frame, side * .11, y, .152);
      add(panel(.14, .23, .02), frame, 0, -.215, -.185);
      for (const y of [-.145, -.205, -.265]) add(panel(.11, .019, .022), steel, 0, y, -.202);
      add(panel(.29, .145, .44), paint, 0, -.397, .085);
      add(panel(.24, .065, .17), ceramic, 0, -.37, .246, .1);
      add(panel(.295, .035, .44), frame, 0, -.479, .086);
      add(panel(.075, .12, .08), steel, side * .137, -.36, -.02);
    }));
    leg.add(knee); rig.add(leg);
    fighter[`${prefix}Leg`] = leg; fighter[`${prefix}Knee`] = knee;
  }

  fighter.thrusterMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(light).multiplyScalar(2.1),
    transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false });
  const flame = new THREE.ConeGeometry(.105, .36, 6, 1, true).rotateX(Math.PI);
  const left = flame.clone().translate(-.2, 0, 0), right = flame.translate(.2, 0, 0);
  fighter.thrusterLights = new THREE.Mesh(mergeGeometries([left, right], false), fighter.thrusterMaterial);
  left.dispose(); right.dispose();
  fighter.thrusterLights.name = "Fighter thruster pair";
  fighter.thrusterLights.position.set(0, 1.02, -.49);
  fighter.thrusterScale = 1;
  rig.add(fighter.thrusterLights);
  const feet = [[fighter.leftLeg, fighter.leftKnee], [fighter.rightLeg, fighter.rightKnee]];
  fighter.plantFeet = () => {
    // Correct only the visual root. Pitch, hit recoil and the longer boots must
    // never push armor through the floor or change the gameplay collider.
    rig.updateMatrix();
    let bottom = Infinity;
    for (const [leg, knee] of feet) {
      leg.updateMatrix(); knee.updateMatrix();
      footMatrix.copy(rig.matrix).multiply(leg.matrix).multiply(knee.matrix);
      const m = footMatrix.elements, bounds = knee.children[0].geometry.boundingBox;
      for (let corner = 0; corner < 8; corner++) bottom = Math.min(bottom,
        m[1] * (corner & 1 ? bounds.max.x : bounds.min.x) + m[5] * (corner & 2 ? bounds.max.y : bounds.min.y) +
        m[9] * (corner & 4 ? bounds.max.z : bounds.min.z) + m[13]);
    }
    rig.position.y += Math.max(0, .012 - bottom);
  };
  return rig;
}
