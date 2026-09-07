import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { getCurrentStack, getNormalFromDepth, normalView, setCurrentStack, stack, uniform, vec2, vec4 } from "three/tsl";
import WebGPUPipelineUtils from "../node_modules/three/src/renderers/webgpu/utils/WebGPUPipelineUtils.js";
import { ArenaWorld, structuralPanelGeometry, structuralRouteGeometry } from "../src/world.js";
import { Fighter } from "../src/player.js";
import { graphicsProfile, swapStolenWeapon, WEAPONS } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import { NeonRenderPipeline, recoverInvalidAONormals } from "../src/renderPipeline.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { surfaceTextures } from "../src/surfaceTextures.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { weaponUsesAmmo } from "../src/gameData.js";
import { weaponPresentation } from "../src/weaponPresentation.js";

// Execute the previous clone path against the same complete fighter/weapon builder.
// Only the three transient merge copies differ; no frozen art data to maintain.
const playerMergeSource = readFileSync(new URL("../src/player.js", import.meta.url), "utf8");
const fistProbe = new Fighter(new THREE.Scene(), { id: "fist-probe", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
for (const hand of [fistProbe.leftHand, fistProbe.rightHand]) {
  assert.ok(!hand.geometry, "grip metadata must not retain the disposed source palm buffers");
  assert.deepEqual(hand.position.toArray(), [0, -.58, .05], "hand shaping cannot change the IK grip center");
}
for (const forearm of [fistProbe.leftForearm, fistProbe.rightForearm]) {
  const positions = forearm.children[2].geometry.attributes.position;
  let wristWidth = 0, fingerWidth = 0;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i), x = Math.abs(positions.getX(i));
    if (y > -.51 && y < -.475) wristWidth = Math.max(wristWidth, x);
    if (y < -.63) fingerWidth = Math.max(fingerWidth, x);
  }
  assert.ok(wristWidth > .05 && wristWidth < .095 && fingerWidth > .1, "actual merged fist tapers from curl to wrist");
}
const fistVertices = (forearm, mirror) => {
  const { position, normal } = forearm.children[2].geometry.attributes;
  // Rounded-box face diagonals duplicate corner vertices with different valence;
  // compare the actual surface samples/normals, not their triangulation counts.
  return [...new Set(Array.from({ length: position.count }, (_, i) => [position.getX(i) * mirror, position.getY(i), position.getZ(i),
    normal.getX(i) * mirror, normal.getY(i), normal.getZ(i)].map(value => Math.round(value * 1e5)).join(",")))].sort();
};
assert.deepEqual(fistVertices(fistProbe.leftForearm, 1), fistVertices(fistProbe.rightForearm, -1), "merged left/right fist vertices and normals are true mirrors");
fistProbe.dispose();
const satinProbe = new Fighter(new THREE.Scene(), { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
assert.ok(satinProbe.helmetShell?.isMesh, "capsule shell needs its own finish without changing the shared dark hardware");
assert.equal(satinProbe.helmetShell.material.roughness, .56);
assert.equal(satinProbe.helmetShell.material.clearcoatRoughness, .4);
satinProbe.dispose();
assert.equal(playerMergeSource.split("new THREE.BufferGeometry().copy(mesh.geometry)").length - 1, 3,
  "transient merge copies must not rebuild each procedural geometry constructor");
const legacyPlayerSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replaceAll("new THREE.BufferGeometry().copy(mesh.geometry)", "mesh.geometry.clone()");
const LegacyMergeFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${legacyPlayerSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const beforeSatinSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("costumeVariant === 2 ? visorFrame : [helmet, ...visorFrame]", "[helmet, ...visorFrame]")
  .replace(/    if \(costumeVariant === 2\) \{\r?\n      \/\/ Separate only the shell finish;[\s\S]*?    \}\r?\n/, "");
const BeforeSatinFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeSatinSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const beforeFistSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace(/  \/\/ Fixed armored fist:[\s\S]*?(?=  const elbowJoint)/, `  const hand = part(new THREE.BoxGeometry(.25, .22, .29), dark, 0, -.58, .05);
  const knuckle = part(new THREE.BoxGeometry(.2, .055, .18), accent, 0, -.59, .19, false);
`)
  .replace("[wristLight, ...knuckles]", "[wristLight, knuckle]")
  .replace("[hand, thumb, ...curledFingers, elbowJoint]", "[hand, elbowJoint]")
  .replace("hand: { position: hand.position.clone() }", "hand");
const BeforeFistFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${beforeFistSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
function assertFingerSeparations(fighter) {
  for (const arm of [fighter.leftForearm, fighter.rightForearm]) {
    const dark = new THREE.Mesh(arm.children[2].geometry, arm.children[2].material);
    const accent = new THREE.Mesh(arm.children[1].geometry, arm.children[1].material);
    const hit = (mesh, x) => new THREE.Raycaster(new THREE.Vector3(x, -.654, .3), new THREE.Vector3(0, 0, -1)).intersectObject(mesh, false)[0];
    for (const x of [-.0475, 0, .0475]) {
      assert.ok(!hit(dark, x) || hit(dark, x).point.z < .178, "three finger separations must remain recessed in the actual dark batch");
      assert.equal(hit(accent, x), undefined, "the light insets must not bridge the finger separations");
    }
    for (const x of [-.07125, -.02375, .02375, .07125]) {
      assert.ok(Math.abs(hit(dark, x).point.z - .183) < 1e-6);
      assert.ok(Math.abs(hit(accent, x).point.z - .184) < 1e-6, "each inset sits on the flat finger face without covering its bevel");
    }
  }
}
{
  const scene = new THREE.Scene(), config = { id: "finger-qa", color: 0x129dba, accent: 0x6ff6ff };
  const before = new BeforeFistFighter(scene, config, ["blaster"], new THREE.Vector3());
  const after = new Fighter(scene, config, ["blaster"], new THREE.Vector3());
  assert.throws(() => assertFingerSeparations(before), /three finger separations/, "the original undivided hand fails the finger-readability regression");
  assertFingerSeparations(after); before.dispose(); after.dispose();
}
function mergedFighterSnapshot(fighter, excluded = new Set()) {
  const meshes = [];
  fighter.group.updateMatrixWorld(true);
  fighter.group.traverse(object => {
    if (!object.geometry || excluded.has(object)) return;
    const geometry = object.geometry, digest = createHash("sha256");
    const attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      digest.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      attributes[name] = [attribute.itemSize, attribute.count, attribute.normalized];
    }
    if (geometry.index) digest.update(new Uint8Array(geometry.index.array.buffer, geometry.index.array.byteOffset, geometry.index.array.byteLength));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    meshes.push({ attributes, hash: digest.digest("hex"), groups: geometry.groups, drawRange: geometry.drawRange,
      bounds: [geometry.boundingBox.min.toArray(), geometry.boundingBox.max.toArray(), geometry.boundingSphere.center.toArray(), geometry.boundingSphere.radius],
      matrix: object.matrixWorld.toArray(), shadow: [object.castShadow, object.receiveShadow],
      materials: [].concat(object.material).map(material => ({ type: material.type, color: material.color?.getHexString(), emissive: material.emissive?.getHexString(),
        intensity: material.emissiveIntensity, roughness: material.roughness, metalness: material.metalness, clearcoat: material.clearcoat,
        opacity: material.opacity, transparent: material.transparent, blending: material.blending, side: material.side, depthWrite: material.depthWrite })) });
  });
  return { meshes, grip: fighter.weaponGrip.toArray(), support: fighter.weaponSupportGrip.toArray(), muzzle: fighter.weaponMuzzleDistance };
}
for (const weapon of Object.values(WEAPONS)) {
  const config = { id: "fist-parity", color: 0x129dba, accent: 0x6ff6ff }, scene = new THREE.Scene();
  const after = new Fighter(scene, config, [weapon.id], new THREE.Vector3());
  const before = new BeforeFistFighter(scene, config, [weapon.id], new THREE.Vector3());
  const changedBatches = fighter => new Set([fighter.leftForearm, fighter.rightForearm].flatMap(arm => arm.children.slice(1)));
  assert.deepEqual(mergedFighterSnapshot(after, changedBatches(after)), mergedFighterSnapshot(before, changedBatches(before)),
    `${weapon.id}: hand art must not alter other geometry/materials, grip anchors or weapon/muzzle transforms`);
  assert.equal(mergedFighterSnapshot(after).meshes.length, mergedFighterSnapshot(before).meshes.length, "fist uses existing render batches");
  for (const forearm of [after.leftForearm, after.rightForearm]) {
    const geometry = forearm.children[2].geometry;
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.x > -.16 && geometry.boundingBox.max.x < .16 && geometry.boundingBox.min.y > -.7,
      "tucked thumb and curl stay within the compact forearm envelope");
    for (const name of ["position", "normal", "uv"]) assert.ok([...geometry.attributes[name].array].every(Number.isFinite));
    const normals = geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-6);
  }
  const world = { resolve: p => { p.y = 0; return { grounded: true }; }, boostAt: () => null }, move = new THREE.Vector3();
  for (const pose of ["aim", "reload", "fire"]) for (let i = 0; i < 24; i++) {
    for (const fighter of [before, after]) {
      fighter.reloadTimer = pose === "reload" ? 1 : 0; fighter.attackTimer = pose === "fire" ? weapon.cooldown : 0;
      fighter.update(1 / 60, move, new THREE.Vector3(0, .4, -1), {}, world);
    }
    assert.deepEqual(after.weaponGroup.matrix.toArray(), before.weaponGroup.matrix.toArray(), `${weapon.id}/${pose}: weapon animation remains exact`);
    for (const key of ["leftArm", "rightArm", "leftForearm", "rightForearm"]) assert.deepEqual(after[key].quaternion.toArray(), before[key].quaternion.toArray());
  }
  after.dispose(); before.dispose(); assert.equal(scene.children.length, 0);
}
for (let variant = 0; variant < 4; variant++) {
  const config = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const fighter = new Fighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  const before = new BeforeSatinFighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  if (variant !== 2) {
    assert.equal(fighter.helmetShell, undefined); assert.ok(fighter.shellMaterial === fighter.darkMaterial);
    assert.deepEqual(mergedFighterSnapshot(fighter), mergedFighterSnapshot(before), "other variants retain all geometry, materials and transforms");
  } else {
    const shell = fighter.helmetShell;
    assert.ok(shell.parent === fighter.helmet && shell.material === fighter.shellMaterial && shell.material !== fighter.darkMaterial);
    assert.deepEqual(shell.position.toArray(), [0, 0, 0]); assert.deepEqual(shell.scale.toArray(), [1, 1, 1]);
    assert.deepEqual(mergedFighterSnapshot(fighter, new Set([fighter.helmet, shell])), mergedFighterSnapshot(before, new Set([before.helmet])),
      "hardware children, weapons, body, armor, lenses and all other materials remain exact");
    const combined = mergeGeometries([shell.geometry, fighter.helmet.geometry], false);
    for (const name of ["position", "normal", "uv"]) assert.deepEqual(combined.attributes[name].array, before.helmet.geometry.attributes[name].array,
      `splitting the shell preserves every existing ${name} value and triangle order`);
    combined.dispose();
    const oldJSON = before.darkMaterial.toJSON(), satinJSON = shell.material.toJSON();
    for (const key of ["uuid", "roughness", "clearcoatRoughness"]) { delete oldJSON[key]; delete satinJSON[key]; }
    assert.deepEqual(satinJSON, oldJSON, "only the two approved finish properties differ, no lighting/color/emission loss");
    assert.ok(shell.material.envMap === null, "shell keeps full shared scene environment lighting");
    assert.equal(shell.castShadow, before.helmet.castShadow); assert.equal(shell.receiveShadow, before.helmet.receiveShadow);
    assert.equal(shell.frustumCulled, true);
    assert.deepEqual(new THREE.Box3().setFromObject(fighter.group), new THREE.Box3().setFromObject(before.group));
    const relative = fighter.helmet.matrixWorld.clone().invert().multiply(shell.matrixWorld);
    const world = { resolve: () => ({ grounded: true }), boostAt: () => null };
    for (const pitch of [-Math.PI / 2, -Math.PI / 3, 0, Math.PI / 3, Math.PI / 2]) {
      fighter.takeHit(1);
      for (let frame = 0; frame < 60; frame++) {
        fighter.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)), {}, world);
        fighter.group.updateMatrixWorld(true);
        const actual = fighter.helmet.matrixWorld.clone().invert().multiply(shell.matrixWorld);
        actual.elements.forEach((value, i) => assert.ok(Math.abs(value - relative.elements[i]) < 1e-12));
        assert.equal(shell.material.emissiveIntensity, fighter.darkMaterial.emissiveIntensity, "hit/idle shell feedback stays synchronized");
      }
    }
    fighter.takeHit(100);
    for (let frame = 0; frame < 90; frame++) {
      fighter.updateDeath(1 / 60);
      assert.equal(shell.material.emissiveIntensity, fighter.darkMaterial.emissiveIntensity, "death flash/fade remains synchronized");
    }
    fighter.respawn(new THREE.Vector3(1, 2, 3));
    assert.equal(shell.material.emissiveIntensity, .025);
    assert.equal(shell.material.roughness, .56); assert.equal(shell.material.clearcoatRoughness, .4);
    const owned = [shell.geometry, shell.material], disposals = new Map(owned.map(resource => [resource, 0]));
    for (const resource of owned) resource.addEventListener("dispose", () => disposals.set(resource, disposals.get(resource) + 1));
    fighter.dispose();
    assert.ok([...disposals.values()].every(count => count === 1), "nested shell buffers and owned finish dispose exactly once");
  }
  if (variant !== 2) fighter.dispose();
  before.dispose();
}
for (const id of Object.keys(WEAPONS)) {
  const config = { id: "merge-parity", color: 0x129dba, accent: 0x6ff6ff };
  const modern = new Fighter(new THREE.Scene(), config, [id], new THREE.Vector3(3, 4, 5));
  const legacy = new LegacyMergeFighter(new THREE.Scene(), config, [id], new THREE.Vector3(3, 4, 5));
  assert.deepEqual(mergedFighterSnapshot(modern), mergedFighterSnapshot(legacy), `${id}: direct buffer copies preserve the full fighter/weapon output`);
  modern.dispose(); legacy.dispose();
}
const mergeHelperSource = playerMergeSource.slice(playerMergeSource.indexOf("function mergeStaticParts("), playerMergeSource.indexOf("const armDown"));
const mergeCopies = [];
const mergeHelpers = new Function("THREE", "mergeGeometries", "disposeGeometry", `${mergeHelperSource}; return { mergeStaticParts, mergeRigidMeshes, combineMaterialBatches };`)(THREE,
  (geometries, groups) => {
    for (const geometry of geometries) {
      const copy = { geometry, disposals: 0 }; mergeCopies.push(copy);
      geometry.addEventListener("dispose", () => copy.disposals++);
    }
    return mergeGeometries(geometries, groups);
  }, geometry => { if (!geometry.userData.sharedFighterGeometry) geometry.dispose(); });
let proceduralCopies = 0;
class CountedMergeGeometry extends THREE.BufferGeometry {
  constructor() { super(); proceduralCopies++; }
}
for (const indexed of [true, false]) for (const name of Object.keys(mergeHelpers)) {
  const box = new THREE.BoxGeometry(1, 2, 3), flat = indexed ? box : box.toNonIndexed();
  const source = new CountedMergeGeometry().copy(flat);
  if (flat !== box) flat.dispose(); box.dispose();
  source.userData.sharedFighterGeometry = true;
  source.morphAttributes.position = [source.attributes.position.clone()]; source.morphTargetsRelative = true;
  source.computeBoundingBox(); source.computeBoundingSphere(); source.setDrawRange(0, 12);
  const sourceData = source.toJSON(), sourceBuffers = Object.values(source.attributes).map(attribute => attribute.array);
  let sourceDisposals = 0; source.addEventListener("dispose", () => sourceDisposals++);
  const beforeConstructors = proceduralCopies, beforeCopies = mergeCopies.length;
  const root = new THREE.Group();
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const meshes = materials.map((material, i) => { const mesh = new THREE.Mesh(source, name === "mergeRigidMeshes" ? materials[0] : material); mesh.position.set(i, 2, 3); mesh.updateMatrix(); root.add(mesh); return mesh; });
  const output = name === "mergeStaticParts" ? mergeHelpers[name](materials[0], meshes) : (mergeHelpers[name](root), root);
  assert.equal(proceduralCopies, beforeConstructors, `${name} must not invoke a source subclass constructor (${indexed ? "indexed" : "flat"})`);
  assert.equal(sourceDisposals, 0, "shared source buffers remain owned by their cache");
  assert.deepEqual(source.toJSON(), sourceData, "transforms/copying cannot mutate source geometry data, morphs or bounds");
  assert.deepEqual(Object.values(source.attributes).map(attribute => attribute.array), sourceBuffers);
  assert.ok(mergeCopies.slice(beforeCopies).every(copy => copy.disposals === 1), "all transient merge inputs are disposed exactly once");
  output.traverse(object => { if (object.geometry && object.geometry !== source) object.geometry.dispose(); });
  source.dispose(); materials.forEach(material => material.dispose());
}
if (process.argv.includes("--bench-merge")) {
  const results = [];
  for (let batch = 0; batch < 6; batch++) {
    const variants = [["current", Fighter], ["legacy", LegacyMergeFighter]];
    if (batch % 2) variants.reverse();
    for (const [name, Type] of variants) {
      let constructionMs = 0, disposalMs = 0;
      for (const id of Object.keys(WEAPONS)) {
        const start = performance.now();
        const fighter = new Type(new THREE.Scene(), { id: "merge-bench", color: 0x129dba, accent: 0x6ff6ff }, [id], new THREE.Vector3());
        const built = performance.now(); fighter.dispose();
        constructionMs += built - start; disposalMs += performance.now() - built;
      }
      results.push({ batch, name, weapons: Object.keys(WEAPONS).length, constructionMs, disposalMs });
    }
  }
  console.log(JSON.stringify({ mergeBenchmark: results }));
}

// Execute the fixture's actual wait helper with a stopped animation clock.
const graphicsFixture = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
const resetCaptureSource = graphicsFixture.slice(graphicsFixture.indexOf('  resetPhase = "starting";'), graphicsFixture.indexOf('  clearThrusterSortControl();', graphicsFixture.indexOf("async function reset()")));
const staleLink = { hidden: false, href: "old-frame", removeAttribute(name) { delete this[name]; } };
const clearedCapture = new Function("select", `let resetPhase='ready', captureCanvas=true, canvasCapture={old:true}; ${resetCaptureSource}; return {resetPhase,captureCanvas,canvasCapture};`)(() => staleLink);
assert.deepEqual(clearedCapture, { resetPhase: "starting", captureCanvas: false, canvasCapture: null });
assert.equal(staleLink.hidden, true); assert.equal(staleLink.href, undefined);
const requestCaptureSource = graphicsFixture.match(/select\("capture-canvas"\)\.onclick = ([^\n]+);/)[1];
for (const phase of ["starting", "started", "ready"]) {
  const requested = new Function("resetPhase", `let captureCanvas=false; (${requestCaptureSource})(); return captureCanvas;`)(phase);
  assert.equal(requested, phase === "ready");
}
let deferredReset, resetCalls = 0;
const costumeChangeSource = graphicsFixture.match(/select\("costume"\)\.onchange = ([^\n]+);/)[1];
new Function("setTimeout", "reset", `(${costumeChangeSource})();`)((fn, delay) => { assert.equal(delay, 0); deferredReset = fn; }, () => resetCalls++);
assert.equal(resetCalls, 0); deferredReset(); assert.equal(resetCalls, 1);
assert.ok(graphicsFixture.includes('if (captureCanvas && resetPhase === "ready")'));
assert.ok(graphicsFixture.includes("function replaceReviewCostume("), "helmet review uses all four actual Fighter variants");
const reviewCostumeSource = graphicsFixture.slice(graphicsFixture.indexOf("function replaceReviewCostume("), graphicsFixture.indexOf("function setView("));
for (const variant of ["", "0", "1", "2", "3"]) {
  const scene = new THREE.Scene();
  const original = new Fighter(scene, { id: "p1", name: "Review", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(2, 3, 4));
  const originalLoadout = original.loadout, neighbor = { id: "untouched" };
  let disposed = 0;
  const dispose = original.dispose.bind(original);
  original.dispose = () => { disposed++; dispose(); };
  const reviewGame = { scene, players: [original, neighbor] };
  new Function("game", "select", "Fighter", `${reviewCostumeSource}; replaceReviewCostume();`)(reviewGame, () => ({ value: variant }), Fighter);
  const selected = reviewGame.players[0];
  assert.equal(reviewGame.players.length, 2); assert.ok(reviewGame.players[1] === neighbor);
  assert.equal(disposed, variant === "" ? 0 : 1);
  assert.equal(scene.children.length, 1);
  assert.deepEqual(selected.position.toArray(), [2, 3, 4]);
  assert.equal(selected.color, original.color); assert.equal(selected.accent, original.accent); assert.equal(selected.name, "Review");
  assert.deepEqual(selected.loadout, originalLoadout);
  if (variant === "") assert.ok(selected === original);
  else {
    assert.equal([...selected.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4, Number(variant));
    assert.ok(selected.loadout !== originalLoadout); assert.equal(original.group.parent, null);
    assert.equal(original.weaponModels.size, 0);
  }
  selected.dispose(); assert.equal(scene.children.length, 0);
}
const settleReviewSource = graphicsFixture.slice(graphicsFixture.indexOf("const stillMove"), graphicsFixture.indexOf("function replaceReviewCostume("));
for (const view of ["hand-front", "hand-side", "hand-palm", "player-camera"]) assert.ok(graphicsFixture.includes(`<option>${view}</option>`), `missing actual ${view} review view`);
for (const weaponId of ["blaster", "rocket_launcher", "energy_sword"]) for (const pose of ["aim", "reload", "reacquire-early", "reacquire-complete"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "hand-qa", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  const world = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
  const review = new Function("THREE", "game", "select", `${settleReviewSource}; settlePose(); return poseReview;`)(THREE,
    { players: [hero], world, clearTransientNetworkCombat() {} }, name => ({ value: name === "aim-height" ? "0" : pose }));
  assert.equal(review.requested, pose);
  if (pose !== "aim") assert.equal(review.reloadAccepted, weaponUsesAmmo(hero.weapon));
  if (weaponUsesAmmo(hero.weapon) && pose === "reload") {
    assert.ok(hero.reloadTimer > 0); assert.equal(hero.supportGripProgress, 0);
  } else if (weaponUsesAmmo(hero.weapon) && pose.startsWith("reacquire")) {
    assert.equal(hero.reloadTimer, 0); assert.equal(hero.reloadWeaponId, null); assert.equal(hero.ammo[weaponId], hero.weapon.ammo);
    if (pose === "reacquire-early") assert.ok(hero.supportGripProgress > 0 && hero.supportGripProgress < 1);
    else assert.equal(hero.supportGripProgress, 1);
  }
  if (pose === "aim" || pose === "reacquire-complete") {
    const grip = hero.weaponGrip.clone().applyMatrix4(hero.weaponGroup.matrixWorld);
    const hand = hero.rightHand.position.clone().applyMatrix4(hero.rightForearm.matrixWorld);
    assert.ok(hand.distanceTo(grip) < .03, "review uses the existing grip solve, not a synthetic hand pose");
  }
  hero.dispose();
}
for (const height of [0, Math.sqrt(3), -Math.sqrt(3)]) {
  const aims = [], hero = { velocity: new THREE.Vector3(2, 3, 4), group: { updateMatrixWorld() {} },
    update(dt, move, aim) { assert.equal(dt, 1 / 60); assert.equal(move.length(), 0); aims.push(aim.clone()); } };
  let clears = 0;
  new Function("THREE", "game", "select", `${settleReviewSource}; settlePose();`)(THREE,
    { players: [hero], world: {}, clearTransientNetworkCombat() { clears++; } }, name => ({ value: name === "aim-height" ? String(height) : "aim" }));
  assert.equal(clears, 1); assert.equal(aims.length, 60); assert.equal(hero.velocity.length(), 0);
  assert.ok(aims.every(aim => Math.abs(aim.length() - 1) < 1e-12 && Math.abs(aim.y - height / Math.hypot(height, 1)) < 1e-12 && aim.z < 0));
}
// Execute the exact capture block: later frame counters must not alter evidence.
const handViewSource = graphicsFixture.slice(graphicsFixture.indexOf("function setView()"), graphicsFixture.indexOf("async function reset()"));
const weaponSelectSource = graphicsFixture.slice(graphicsFixture.indexOf('select("weapon").onchange ='), graphicsFixture.indexOf('select("pose").onchange ='));
for (const view of ["hand-front", "hand-side", "hand-palm"]) for (const previousPose of ["aim", "reload", "reacquire-early"]) {
  const hero = new Fighter(new THREE.Scene(), { id: "hand-view", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const controls = { view: { value: view }, weapon: { value: "blaster" }, pose: { value: "aim" }, "aim-height": { value: "0" } };
  const game = { players: [hero], camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 300), clearTransientNetworkCombat() {},
    world: { resolve: position => { position.y = 15.01; return { grounded: true }; }, boostAt: () => null } };
  const review = new Function("THREE", "game", "select", `let stress=false, cameraOffset=0;
    const clearThrusterSortControl=()=>{}, resetSamples=()=>{}, cameraUpdate=()=>{};
    ${settleReviewSource}; ${handViewSource}; ${weaponSelectSource}; return {setView,settlePose};`)(THREE, game, name => controls[name]);
  review.setView();
  controls.pose.value = previousPose; review.settlePose();
  controls.weapon.value = "hammer";
  assert.ok(WEAPONS[controls.weapon.value], "use a real alternate grip");
  controls.weapon.onchange();
  assert.equal(controls.pose.value, "aim", "hand view/weapon changes visibly reset to ready pose before framing");
  game.updateCamera(); game.camera.updateMatrixWorld(true);
  const target = (view === "hand-palm" ? hero.leftHand.position.clone().applyMatrix4(hero.leftForearm.matrixWorld)
    : hero.weaponGrip.clone().applyMatrix4(hero.weaponGroup.matrixWorld)).project(game.camera);
  assert.ok(Math.abs(target.x) < 1e-6 && Math.abs(target.y) < 1e-6, "weapon switching must reframe the current grip, not retain the old anchor");
  const cameraPosition = game.camera.position.clone();
  controls.pose.value = "fire";
  // A weapon transform change must NOT be followed after the view is established.
  hero.weaponGroup.position.x += .3; hero.group.updateMatrixWorld(true); game.updateCamera();
  assert.deepEqual(game.camera.position, cameraPosition, "fixed framing preserves visible weapon travel");
  hero.dispose();
}
const captureSource = graphicsFixture.slice(graphicsFixture.indexOf("    const grapple = game.players[0]?.grapple;"), graphicsFixture.indexOf('    const link = select("canvas-capture");'));
const captureFrame = new Function("game", "renderedFrames", "sceneSerial", "select", "ropeRenders", "ropeRendersBefore", "errorCount", "thrusterSortControl", "thrusterRenderOrder", "poseReview", `let canvasCapture; ${captureSource}; return canvasCapture;`);
{
  const hero = new Fighter(new THREE.Scene(), { id: "hand-metadata", color: 0x129dba, accent: 0x6ff6ff }, ["rocket_launcher"], new THREE.Vector3());
  hero.group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 300); camera.position.set(1, 2, 3); camera.updateMatrixWorld(true);
  const game = { players: [hero], scene: { children: [] }, camera, settings: { graphics: "high" },
    renderer: { info: { render: { drawCalls: 1, triangles: 1 } } }, renderPipeline: { direct: false, profile: "WEBGPU ULTRA" } };
  const review = { requested: "aim", reloadAccepted: null, additionalReacquireFrames: 0 };
  const captured = captureFrame(game, 10, 3, () => ({ value: "hand-front" }), 0, 0, 0, null, [], review);
  assert.equal(captured.handPose.weapon, "rocket_launcher"); assert.equal(captured.tier, "high"); assert.equal(captured.profile, "WEBGPU ULTRA");
  assert.equal(captured.camera.gameplay, false);
  assert.deepEqual(captured.handPose.rightForearmMatrix, hero.rightForearm.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.leftForearmMatrix, hero.leftForearm.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.weaponMatrix, hero.weaponGroup.matrixWorld.toArray());
  assert.deepEqual(captured.handPose.rightHandLocal, [0, -.58, .05]);
  const stored = JSON.stringify(captured);
  hero.rightHand.position.x = 8; hero.rightForearm.matrixWorld.elements[12] = 9; hero.weaponGrip.y = 8;
  camera.matrixWorld.elements[12] = 10; review.requested = "reload";
  assert.equal(JSON.stringify(captured), stored, "later pose/camera changes cannot rewrite saved evidence");
  hero.dispose();
}
for (const renders of [0, 1]) {
  const captureGame = { players: [{ id: "helmet-2", aim: new THREE.Vector3(0, 0, -1), helmet: { matrixWorld: new THREE.Matrix4() }, visor: { matrixWorld: new THREE.Matrix4() },
    grapple: { anchor: new THREE.Vector3(1, 2, 3), line: { geometry: { instanceCount: 1 }, material: { blending: THREE.NoBlending } } } }],
    scene: { children: [{ isLine2: true }, {}] },
    renderer: { info: { render: { drawCalls: 378, triangles: 169330 } } }, renderPipeline: { direct: false } };
  const captured = captureFrame(captureGame, 8, 1, () => ({ value: "effects" }), 4 + renders, 4, 0);
  captureGame.renderer.info.render.drawCalls = 1;
  assert.equal(captured.draws, 378);
  assert.equal(captured.rope.rendersThisFrame, renders, "a live grapple object alone cannot certify a rendered rope");
  assert.equal(captured.rope.segments, 1);
  assert.equal(captured.grappleLines, 1);
  captureGame.players[0].aim.y = 1; captureGame.players[0].helmet.matrixWorld.elements[12] = 8;
  assert.equal(captured.fighter.id, "helmet-2"); assert.deepEqual(captured.fighter.aim, [0, 0, -1]); assert.equal(captured.fighter.helmetMatrix[12], 0);
  captureGame.players = []; captureGame.scene.children = [];
  const released = captureFrame(captureGame, 9, 1, () => ({ value: "effects" }), 4, 4, 0);
  assert.equal(released.rope, null); assert.equal(released.grappleLines, 0); assert.equal(released.fighter, null);
}
const sortControlSource = graphicsFixture.slice(graphicsFixture.indexOf("function clearThrusterSortControl("), graphicsFixture.indexOf("let settleUntil"));
const sortScene = new THREE.Scene(), sortCamera = new THREE.PerspectiveCamera(62, 16 / 9, .1, 300);
sortCamera.position.set(1.6, 1.7, 2.3); sortCamera.lookAt(0, 1.15, .49); sortCamera.updateMatrixWorld(true);
const sortFighter = new Fighter(sortScene, { id: "sort-control", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const modernFlames = sortFighter.thrusterLights, originalParent = modernFlames.parent, originalCallback = modernFlames.onBeforeRender;
const sortHarness = new Function("THREE", "game", `let stress=false, resetReview={}, cacheReview={}, cameraReview={}, decoyReview={}, thrusterSortControl=null, thrusterRenderOrder=[], captureCanvas=false;
  ${sortControlSource}; return { toggle: toggleThrusterSortControl, clear: clearThrusterSortControl, state: () => thrusterSortControl };`)(THREE, { scene: sortScene, camera: sortCamera, players: [sortFighter] });
sortHarness.toggle();
const sortControl = sortHarness.state();
assert.ok(sortControl.quadZ > Math.min(sortControl.legacyZ, sortControl.modernZ) && sortControl.quadZ < Math.max(sortControl.legacyZ, sortControl.modernZ),
  "overlap control must exercise the changed transparent sort keys");
assert.equal(sortControl.mode, "merged");
sortHarness.toggle();
assert.equal(sortControl.mode, "legacy"); assert.equal(modernFlames.parent, null);
assert.ok(sortControl.legacy.parent === originalParent);
const controlResources = [sortControl.legacy.geometry, sortControl.legacy.material, sortControl.quad.geometry, sortControl.quad.material];
const disposed = new Map(controlResources.map(resource => [resource, 0]));
for (const resource of controlResources) resource.addEventListener("dispose", () => disposed.set(resource, disposed.get(resource) + 1));
sortHarness.clear(); sortHarness.clear();
assert.ok(modernFlames.parent === originalParent && modernFlames.onBeforeRender === originalCallback, "cleanup restores the real fighter even when the legacy control is active");
assert.ok([...disposed.values()].every(count => count === 1));
sortFighter.dispose();
const hideAOObjectSource = graphicsFixture.slice(graphicsFixture.indexOf("function hideAOObjectForReview("), graphicsFixture.indexOf("const requestedAOOutput"));
for (const hidden of [null, "grid", "route", "unknown"]) {
  const hide = new Function("hiddenAOObject", `${hideAOObjectSource}; return hideAOObjectForReview;`)(hidden);
  const objects = [{ type: "GridHelper", visible: true }, { name: "District route floor", visible: true }, { name: "Arena floor", visible: true }];
  objects.forEach(hide);
  assert.deepEqual(objects.map(object => object.visible), [hidden !== "grid", hidden !== "route", true], "QA visibility isolation changes only the requested object, never the ground");
}
const aoWrapperSource = graphicsFixture.slice(graphicsFixture.indexOf("function withAODiagnostics("), graphicsFixture.indexOf("// QA-only causal comparison"));
assert.ok(graphicsFixture.includes("async function withHelmetShellDiagnostic("), "shell diagnosis needs an isolated, restoring material control");
const shellControlSource = graphicsFixture.slice(graphicsFixture.indexOf("async function withHelmetShellDiagnostic("), graphicsFixture.indexOf("function shellReviewState("));
const shellOriginal = new THREE.MeshPhysicalMaterial({ roughness: .4, metalness: .68, clearcoat: .32, clearcoatRoughness: .2, envMapIntensity: 1.2 });
const shellEnvironment = new THREE.Texture(), shellOutput = {}, shellRawOutput = {};
const shellGame = { players: [{ helmet: { material: shellOriginal } }], renderer: { toneMapping: THREE.ACESFilmicToneMapping },
  scene: { environment: shellEnvironment, environmentIntensity: .82, environmentRotation: new THREE.Euler(0, .3, 0) },
  renderPipeline: { pipeline: { outputNode: shellOutput }, scenePass: { getTextureNode: name => { assert.equal(name, "output"); return shellRawOutput; } } } };
const shellControl = new Function("THREE", "game", `${shellControlSource}; return withHelmetShellDiagnostic;`)(THREE, shellGame);
let sharedShellDisposals = 0;
shellOriginal.addEventListener("dispose", () => sharedShellDisposals++);
shellEnvironment.addEventListener("dispose", () => sharedShellDisposals++);
const shellOriginalJSON = shellOriginal.toJSON();
for (const mode of ["baseline", "explicit-environment", "no-environment", "normals", "previous-finish", "restored"]) for (const fail of [false, true]) {
  let temporaryDisposals = 0;
  const action = async () => {
    const current = shellGame.players[0].helmet.material;
    if (mode === "baseline" || mode === "restored") assert.ok(current === shellOriginal);
    else {
      assert.notEqual(current, shellOriginal);
      current.addEventListener("dispose", () => temporaryDisposals++);
      if (mode === "previous-finish") {
        assert.equal(current.roughness, .4); assert.equal(current.clearcoatRoughness, .2);
        assert.equal(current.envMap, shellOriginal.envMap); assert.equal(current.envMapIntensity, shellOriginal.envMapIntensity);
        assert.equal(current.metalness, shellOriginal.metalness); assert.equal(current.clearcoat, shellOriginal.clearcoat);
      } else if (mode !== "normals") {
        assert.ok(current.envMap === shellEnvironment, "explicit texture makes the zero intensity effective in pinned Three");
        assert.equal(current.envMapIntensity, mode === "no-environment" ? 0 : .82);
        assert.ok(current.envMapRotation.equals(shellGame.scene.environmentRotation));
        for (const key of ["roughness", "metalness", "clearcoat", "clearcoatRoughness", "side", "depthWrite", "normalMap", "roughnessMap"])
          assert.equal(current[key], shellOriginal[key], `isolation preserves ${key}`);
        assert.ok(current.color.equals(shellOriginal.color));
      } else assert.equal(current.isMeshNormalMaterial, true);
    }
    assert.ok(shellGame.renderPipeline.pipeline.outputNode === (mode === "normals" ? shellRawOutput : shellOutput));
    assert.equal(shellGame.renderer.toneMapping, mode === "normals" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping);
    await Promise.resolve();
    if (fail) throw new Error("deliberate capture failure");
    return 42;
  };
  if (fail) await assert.rejects(shellControl(mode, action), /deliberate capture failure/);
  else assert.equal(await shellControl(mode, action), 42);
  assert.ok(shellGame.players[0].helmet.material === shellOriginal);
  assert.ok(shellGame.renderPipeline.pipeline.outputNode === shellOutput);
  assert.equal(shellGame.renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(temporaryDisposals, ["explicit-environment", "no-environment", "normals", "previous-finish"].includes(mode) ? 1 : 0);
  assert.equal(sharedShellDisposals, 0, "temporary controls never dispose shared environment or original material");
  assert.deepEqual(shellOriginal.toJSON(), shellOriginalJSON);
}
await assert.rejects(shellControl("unknown", () => assert.fail("invalid mode ran")), /Unknown shell/);
const hardwareMaterial = new THREE.MeshPhysicalMaterial();
shellGame.players[0].helmetShell = shellGame.players[0].helmet;
shellGame.players[0].helmet = { material: hardwareMaterial };
await shellControl("previous-finish", async () => {
  assert.ok(shellGame.players[0].helmet.material === hardwareMaterial, "split-shell QA never changes hardware material");
  assert.notEqual(shellGame.players[0].helmetShell.material, shellOriginal);
});
assert.ok(shellGame.players[0].helmetShell.material === shellOriginal);
// A forearm diagnostic targets the existing whole dark batch (elbow AND fist),
// without replacing any other mesh that shares its production material.
const armDiagnosticProbe = new Fighter(new THREE.Scene(), { id: "arm-diagnostic", color: 0x129dba, accent: 0x6ff6ff }, ["energy_sword"], new THREE.Vector3());
const armTarget = armDiagnosticProbe.rightForearm.children[2], armOriginal = armTarget.material;
const armOriginalJSON = armOriginal.toJSON(), otherArmMaterials = new Map();
armDiagnosticProbe.group.traverse(mesh => { if (mesh.isMesh && mesh !== armTarget) otherArmMaterials.set(mesh, mesh.material); });
for (const mode of ["baseline", "explicit-environment", "no-environment", "normals", "restored"]) for (const fail of [false, true]) {
  let disposed = 0;
  const action = async () => {
    assert.ok(shellGame.players[0].helmetShell.material === shellOriginal, "forearm diagnosis must not replace the helmet material");
    assert.ok(shellGame.players[0].helmet.material === hardwareMaterial);
    for (const [mesh, original] of otherArmMaterials) assert.ok(mesh.material === original,
      "temporary material is isolated to the selected batch, not every shared dark surface");
    if (["baseline", "restored"].includes(mode)) assert.ok(armTarget.material === armOriginal);
    else {
      assert.ok(armTarget.material !== armOriginal);
      armTarget.material.addEventListener("dispose", () => disposed++);
      if (mode === "normals") assert.equal(armTarget.material.isMeshNormalMaterial, true);
      else assert.equal(armTarget.material.envMapIntensity, mode === "no-environment" ? 0 : .82);
    }
    if (fail) throw new Error("deliberate arm capture failure");
  };
  if (fail) await assert.rejects(shellControl(mode, action, armTarget), /deliberate arm capture failure/);
  else await shellControl(mode, action, armTarget);
  assert.ok(armTarget.material === armOriginal);
  assert.deepEqual(armOriginal.toJSON(), armOriginalJSON);
  assert.equal(disposed, ["baseline", "restored"].includes(mode) ? 0 : 1);
  assert.equal(sharedShellDisposals, 0);
}
armDiagnosticProbe.dispose();
hardwareMaterial.dispose();
shellOriginal.dispose(); shellEnvironment.dispose();
const shellRunSource = graphicsFixture.slice(graphicsFixture.indexOf("async function runShellReview("), graphicsFixture.indexOf('select("shell-diagnosis").onclick'));
const shellControlElements = [{ disabled: false }, { disabled: true }];
const shellRunState = { running: false }, shellRunGame = { paused: true, settings: { graphics: "high" },
  renderPipeline: { direct: false }, combatVisuals: { combatLights: [{ intensity: 0, userData: { life: 0 } }] }, updateCamera() {} };
let shellWaits = 0, interruptShell = false;
const runShellHarness = new Function("game", "cameraReview", "document", "select", "waitForReviewFrame", "withHelmetShellDiagnostic", `
  const resetReview={}, cacheReview={}, decoyReview={}, resetPhase="ready", sceneSerial=1, errorCount=0, renderedFrames=0, aoOutput="final";
  let stress=false, cameraOffset=.31;
  ${shellRunSource}
  return { run: runShellReview, offset: () => cameraOffset };
`)(shellRunGame, shellRunState, { querySelectorAll: () => shellControlElements },
  id => id === "view" ? { value: "helmet-profile" } : { replaceChildren() {} }, async () => {
    shellWaits++;
    assert.deepEqual(shellControlElements.map(control => control.disabled), [true, true]);
    if (interruptShell) { shellRunGame.paused = false; return; }
    throw new Error("deliberate shell frame timeout");
  }, async (mode, action) => action());
await runShellHarness.run();
assert.match(shellRunState.error, /deliberate shell frame timeout/);
assert.equal(shellRunState.running, false); assert.equal(shellRunState.shell, false);
assert.equal(runShellHarness.offset(), .31);
assert.deepEqual(shellControlElements.map(control => control.disabled), [false, true], "outer failure restores prior disabled states");
assert.equal(shellRunGame.paused, true);
shellRunState.running = true;
await runShellHarness.run();
assert.equal(shellWaits, 1, "an already running camera review cannot start a duplicate shell run");
shellRunState.running = false; shellRunGame.combatVisuals.combatLights[0].intensity = .1;
await runShellHarness.run();
assert.match(shellRunState.error, /combat lights/);
assert.equal(shellWaits, 1, "active combat lighting invalidates the fixed-light diagnostic before capture");
assert.deepEqual(shellControlElements.map(control => control.disabled), [false, true]);
shellRunGame.combatVisuals.combatLights[0].intensity = 0; interruptShell = true;
await runShellHarness.run();
assert.match(shellRunState.error, /paused/, "Escape can resume simulation despite disabled navigation; discard that comparison");
assert.equal(shellRunState.running, false); assert.equal(shellRunState.shell, false);
assert.equal(shellRunGame.paused, false, "cleanup preserves the user's new pause choice");
assert.deepEqual(shellControlElements.map(control => control.disabled), [false, true]);
const armRunState = { running: false }, armRunMaterial = {}, armRunTarget = { isMesh: true, material: armRunMaterial }, armRunLinks = [], armRunModes = [];
const armRunControls = [{ disabled: false }, { disabled: true }];
const armRunGame = { ...shellRunGame, paused: true, players: [{ darkMaterial: armRunMaterial, rightForearm: { children: [null, null, armRunTarget] } }] };
let armRunView = "hand-side", armWaits = 0;
const armRunHarness = new Function("game", "cameraReview", "document", "select", "waitForReviewFrame", "withHelmetShellDiagnostic", "shellReviewState", `
  const resetReview={}, cacheReview={}, decoyReview={}, resetPhase="ready", sceneSerial=1, errorCount=0, renderedFrames=0, aoOutput="final";
  let stress=false, cameraOffset=.31;
  ${shellRunSource}
  return { run: runShellReview, offset: () => cameraOffset };
`)(armRunGame, armRunState, { querySelectorAll: () => armRunControls, createElement: () => ({}),
  querySelector: () => ({ toDataURL: type => { assert.equal(type, "image/png"); return "data:image/png;base64,test"; } }) },
  id => id === "view" ? { value: armRunView } : { replaceChildren() { armRunLinks.length = 0; }, append(link) { armRunLinks.push(link); } },
  async () => { armWaits++; assert.equal(armRunState.shell, true, "freeze flag spans every forearm capture");
    assert.deepEqual(armRunControls.map(control => control.disabled), [true, true]); },
  async (mode, action, target) => { assert.ok(target === armRunTarget); armRunModes.push(mode); await action(); },
  target => { assert.ok(target === armRunTarget, "every sample records the material target actually overridden"); return { targetName: "actual forearm batch" }; });
await armRunHarness.run(false, true);
assert.equal(armRunState.error, null); assert.equal(armWaits, 13); assert.equal(armRunLinks.length, 13);
assert.ok(armRunLinks.every(link => link.download.startsWith("forearm-")), "download names disclose the actual diagnostic scope");
assert.deepEqual(armRunModes, ["baseline", "explicit-environment", "no-environment", "normals", "restored"]);
assert.deepEqual(armRunState.samples.map(sample => sample.offset), [-.04, 0, .04, 0, -.04, 0, .04, -.04, 0, .04, -.04, 0, .04]);
assert.ok(armRunState.samples.every(sample => sample.diagnosticTarget === "right forearm dark batch: elbow and fist"));
assert.deepEqual(armRunState.samples.filter(sample => sample.mode === "normals").map(sample => sample.output), ["scene-color", "scene-color", "scene-color"]);
assert.equal(armRunHarness.offset(), .31); assert.equal(armRunState.running, false); assert.equal(armRunState.shell, false);
assert.deepEqual(armRunControls.map(control => control.disabled), [false, true]);
armRunView = "helmet-profile"; await armRunHarness.run(false, true);
assert.match(armRunState.error, /matching view/); assert.equal(armWaits, 13, "wrong view cannot begin a forearm diagnostic");
armRunView = "hand-side"; await armRunHarness.run(true, true);
assert.match(armRunState.error, /capsule helmet/); assert.equal(armWaits, 13, "capsule finish comparison cannot accidentally target the forearm");
armRunTarget.material = {};
await armRunHarness.run(false, true);
assert.match(armRunState.error, /forearm batch layout/, "a future child reorder must fail closed instead of silently diagnosing another surface");
assert.equal(armWaits, 13);
armRunTarget.material = armRunMaterial;
const geometryNormalToken = {}, colorOutputToken = {};
const makeAOWrapper = new Function("mrt", "normalViewGeometry", "output", "geometryAONormals", "aoOutput", "vec3", "vec4", "depthAONormals", "legacyAONormals", "normalView", "materialBlendAONormals", "THREE", "recoverAONormals", "singleSampleAO", "emulateCompatibilityAO", `${aoWrapperSource}; return withAODiagnostics;`);
const wrapAONormals = makeAOWrapper(value => value, geometryNormalToken, colorOutputToken, true, "final");
let aoOverrides = 0, aoBuildCalls = 0;
const aoFixture = { ensure: wrapAONormals(function (value) {
  aoBuildCalls++; this.aoPass = {};
  this.scenePass ??= { setMRT(value) { aoOverrides++; assert.ok(value.normal === geometryNormalToken && value.output === colorOutputToken); } };
  return value;
}) };
assert.equal(aoFixture.ensure(7), 7);
assert.equal(aoFixture.ensure(8), 8);
assert.equal(aoBuildCalls, 2); assert.equal(aoOverrides, 1, "QA normal comparison overrides only newly created AO scene passes");
const noAOFixture = { ensure: wrapAONormals(function () { this.scenePass = { setMRT() { throw new Error("non-AO pass changed"); } }; }) };
noAOFixture.ensure();
const depthAOFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, true)(function () {
  this.aoPass = { normalNode: {} }; this.scenePass = {};
}) };
depthAOFixture.ensure();
assert.equal(depthAOFixture.aoPass.normalNode, null, "depth-normal diagnostic changes only the AO normal source");
const legacyAOFixture = { ensure: makeAOWrapper(value => value, null, colorOutputToken, false, "final", null, null, false, true, normalView)(function () {
  this.aoPass = {}; this.scenePass = { setMRT(value) { assert.ok(value.normal === normalView && value.output === colorOutputToken); } };
}) };
legacyAOFixture.ensure();
let normalBlend;
const materialBlendFixture = { ensure: makeAOWrapper(null, null, null, false, "final", null, null, false, false, null, true, THREE)(function () {
  this.aoPass = {}; this.scenePass = { getMRT: () => ({ setBlendMode(name, blend) { assert.equal(name, "normal"); normalBlend = blend; } }) };
}) };
materialBlendFixture.ensure();
assert.equal(normalBlend.blending, THREE.MaterialBlending);

function assertCompatibleAONormals(root) {
  root.traverse(object => {
    for (const material of [].concat(object.material || [])) {
      if (material.depthWrite || !material.colorWrite) continue;
      assert.equal(material.transparent, true, "visible non-depth writers need alpha blending on compatibility GPUs");
      assert.equal(material.premultipliedAlpha, false, "a premultiplied normal needs separate coverage handling");
      assert.ok([THREE.NormalBlending, THREE.AdditiveBlending].includes(material.blending), "new blend modes need AO compatibility coverage");
      const blend = WebGPUPipelineUtils.prototype._getBlending.call({}, material);
      assert.equal(blend.color.srcFactor, "src-alpha");
      assert.ok(["one", "one-minus-src-alpha"].includes(blend.color.dstFactor));
      assert.equal(blend.color.operation, "add", "alpha zero preserves the destination normal in compatibility mode");
    }
  });
}
for (const mode of ["raw", "color"]) {
  const rawToken = {}, colorToken = {};
  const wrap = makeAOWrapper(() => { throw new Error("diagnostic changed material normals"); }, geometryNormalToken, colorOutputToken, false, mode,
    value => value, value => value);
  const target = { ensure: wrap(function () {
    this.aoPass = { getTextureNode: () => ({ r: rawToken }) };
    this.scenePass = { getTextureNode: () => colorToken };
    this.pipeline = {};
  }) };
  target.ensure();
  assert.ok(target.pipeline.outputNode === (mode === "raw" ? rawToken : colorToken));
  assert.equal(target.pipeline.needsUpdate, true);
}
const waitSource = graphicsFixture.slice(graphicsFixture.indexOf("function waitForReviewFrame("), graphicsFixture.indexOf("const stillMove"));
let timeoutCallback, timeoutDelay, frameCallback, cleared = 0, cancelled = 0, serial = 3;
const makeWait = new Function("setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "getSerial",
  waitSource.replaceAll("sceneSerial", "getSerial()") + "; return waitForReviewFrame;");
const waitReview = makeWait((callback, delay) => { timeoutCallback = callback; timeoutDelay = delay; return 9; }, () => cleared++,
  callback => { frameCallback = callback; return 7; }, () => cancelled++, () => serial);
const stalledWait = waitReview(3, () => false);
assert.equal(timeoutDelay, 20000);
timeoutCallback();
await assert.rejects(stalledWait, /timed out/, "a suspended rAF cannot prevent the independent timeout");
assert.equal(cleared, 1); assert.equal(cancelled, 1);
await waitReview(3, () => true);
assert.equal(cleared, 2); assert.equal(cancelled, 2);
const interruptedWait = waitReview(3, () => false);
serial = 4; frameCallback();
await assert.rejects(interruptedWait, /scene change/);
const coldResetWait = waitReview(4, () => false, 60000);
assert.equal(timeoutDelay, 60000, "cold lifecycle readiness can request a longer bounded window");
timeoutCallback();
await assert.rejects(coldResetWait, /60 seconds/, "a stalled reset still terminates independently of rAF");
const decoySampleStart = graphicsFixture.indexOf("    const sample = async (cycle, phase) => {", graphicsFixture.indexOf("async function runDecoyReview"));
const decoySampleSource = graphicsFixture.slice(decoySampleStart, graphicsFixture.indexOf("    if (overlap) {", decoySampleStart));
const decoyWaits = [], decoySampleReview = { samples: [] };
const decoySample = new Function("game", "waitForReviewFrame", "decoyReview", "renderedFrames", "serial", "pipelineCreations", "errorCount",
  decoySampleSource + "; return sample;")({ settings: { graphics: "high" }, decoys: [], renderer: { info: { memory: {} } }, renderPipeline: { direct: false } },
  async (scene, ready, timeout) => { assert.equal(scene, 4); assert.equal(ready(), false); decoyWaits.push(timeout); }, decoySampleReview, 0, 4, 0, 0);
await decoySample(-1, "baseline"); await decoySample(0, "spawned"); await decoySample(0, "removed"); await decoySample(3, "cleanup");
assert.deepEqual(decoyWaits, [60000, 20000, 20000, 20000], "only cold decoy baseline gets reset readiness budget; warmed phases keep their original deadline");
assert.deepEqual(decoySampleReview.samples.map(sample => sample.phase), ["baseline", "spawned", "removed", "cleanup"]);

const botTraceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceBotMethod("), graphicsFixture.indexOf("if (traceFrames) for"));
let botTraceClock = 0, botTraceContext = null, botTraceCpu = {}, projectileTraceActive = false;
const traceBotMethod = new Function("performance", "getBot", "getCpu", "getProjectiles", botTraceSource.replaceAll("activeTraceBot", "getBot()").replaceAll("activeTraceProjectiles", "getProjectiles()").replaceAll("cpu.botCalls", "getCpu().botCalls").replaceAll("cpu[", "getCpu()[") + "; return traceBotMethod;")(
  { now: () => ++botTraceClock }, () => botTraceContext, () => botTraceCpu, () => projectileTraceActive);
const botTraceTarget = { value: 4, run(n) { return this.value + n; } };
assert.throws(() => traceBotMethod(botTraceTarget, "missing", "test"), /Unknown trace method: test.missing/, "stale hook names must fail visibly rather than silently lose attribution");
traceBotMethod(botTraceTarget, "run", "test");
assert.equal(botTraceTarget.run(3), 7);
assert.equal(botTraceClock, 0, "nested timing is inactive outside bot updates");
botTraceContext = { id: "p3", weapon: { id: "blaster" } };
for (let i = 0; i < 30; i++) assert.equal(botTraceTarget.run(i), 4 + i);
assert.deepEqual(botTraceCpu.botCalls["test.run"], { calls: 30, totalMs: 30, maxMs: 1, bot: "p3", weapon: "blaster" });
const botTraceError = new Error("bot call failed");
botTraceTarget.fail = () => { throw botTraceError; };
traceBotMethod(botTraceTarget, "fail", "test");
assert.throws(() => botTraceTarget.fail(), error => error === botTraceError);
assert.equal(botTraceCpu.botCalls["test.fail"].calls, 1);
botTraceCpu = {};
botTraceTarget.run(1);
assert.equal(botTraceCpu.botCalls["test.run"].calls, 1, "nested counters follow the current frame rather than retaining old state");
const queryPoint = new THREE.Vector3(1, 2, 3);
const queryTrace = { resolve(point) { point.x = 8; }, ropeObstacle(point) { return point; } };
traceBotMethod(queryTrace, "resolve", "world"); traceBotMethod(queryTrace, "ropeObstacle", "world");
queryTrace.resolve(queryPoint);
assert.equal(botTraceCpu.botCalls["world.resolve"].inputs, undefined, "mutating query coordinates cannot be mislabeled as inputs");
queryTrace.ropeObstacle(queryPoint); queryPoint.set(0, 0, 0);
assert.deepEqual(botTraceCpu.botCalls["world.ropeObstacle"].inputs, [[8, 2, 3]], "read-only query evidence owns numeric copies");
const ropeTrace = { updateGrapple() {} }, ropeTraceBot = { grapple: { wraps: Array.from({ length: 10 }, () => new THREE.Vector3(1, 2, 3)) } };
traceBotMethod(ropeTrace, "updateGrapple", "game"); ropeTrace.updateGrapple(ropeTraceBot);
ropeTraceBot.grapple.wraps[0].set(0, 0, 0);
assert.equal(botTraceCpu.botCalls["game.updateGrapple"].wraps.length, 8);
assert.deepEqual(botTraceCpu.botCalls["game.updateGrapple"].wraps[0], [1, 2, 3], "grapple evidence cannot retain mutable vectors");
botTraceContext = null; projectileTraceActive = true;
assert.equal(botTraceTarget.run(8), 12);
assert.deepEqual(botTraceCpu.projectileCalls["test.run"], { calls: 1, totalMs: 1, maxMs: 1, bot: null, weapon: null }, "projectile-loop timing must not be mislabeled as a bot update");
assert.throws(() => botTraceTarget.fail(), error => error === botTraceError);
assert.equal(botTraceCpu.projectileCalls["test.fail"].calls, 1);
const shotTrace = { damagePlayer() { return 7; } }, shotWeapon = { id: "rocket_launcher" };
traceBotMethod(shotTrace, "damagePlayer", "game");
assert.equal(shotTrace.damagePlayer({}, 10, {}, {}, shotWeapon), 7);
shotWeapon.id = "changed";
assert.equal(botTraceCpu.projectileCalls["game.damagePlayer"].weapon, "rocket_launcher", "max projectile attribution owns the relevant weapon label");
projectileTraceActive = false;
const stoppedTraceClock = botTraceClock;
botTraceTarget.run(1);
assert.equal(botTraceClock, stoppedTraceClock, "combat tracing stops outside both update phases");

const traceSource = graphicsFixture.slice(graphicsFixture.indexOf("function traceStartupMethod("), graphicsFixture.indexOf("if (traceStartup) {"));
assert.ok(graphicsFixture.includes("function createStartupIdentityRecorder("), "startup diagnostics distinguish actual cache keys from shader source identities");
const identitySource = graphicsFixture.slice(graphicsFixture.indexOf("function createStartupIdentityRecorder("), graphicsFixture.indexOf("const startupIdentityRecorder ="));
let clearedSources = 0;
class SourceMap extends Map { clear() { clearedSources += this.size; super.clear(); } }
const identityRecorder = new Function("Map", `${identitySource}; return createStartupIdentityRecorder();`)(SourceMap);
const identityObject = { initialCacheKey: 1, context: { id: 2 }, material: { type: "MeshStandardMaterial", isShadowPassMaterial: false },
  object: { id: 3, name: "Test slats", type: "Mesh", isInstancedMesh: true, count: 4, receiveShadow: false },
  getGeometryCacheKey: () => "position,3,uv,2,index," };
const identityBuilder = { material: identityObject.material, vertexShader: "vertex-a", fragmentShader: "fragment-a" };
identityRecorder.build(identityBuilder, identityObject);
identityObject.initialCacheKey = 4; identityRecorder.build(identityBuilder, identityObject);
identityObject.initialCacheKey = 1; identityRecorder.build(identityBuilder, identityObject);
identityRecorder.program({ code: "fragment-a", stage: "fragment" });
identityRecorder.program({ code: "fragment-b", stage: "fragment" });
assert.deepEqual(identityRecorder.state.builds.map(entry => entry.key), [1, 4, 1]);
assert.deepEqual(identityRecorder.state.builds.map(entry => entry.sources), [[1, 2], [1, 2], [1, 2]], "distinct/repeated keys retain identical exact shader IDs");
assert.deepEqual(identityRecorder.state.programs.map(entry => entry.source), [2, 3], "backend programs share the same exact source identity space");
assert.equal(identityRecorder.state.builds[0].instanced, true);
assert.equal(identityRecorder.state.builds[0].geometryKey, identityObject.getGeometryCacheKey(), "record the pinned renderer's full layout discriminator");
identityRecorder.build({ ...identityBuilder, material: { type: "NodeMaterial" } }, identityObject);
assert.equal(identityRecorder.state.builds[3].material, "NodeMaterial", "successful fallback builds report the actual material, not the original request");
assert.equal(identityRecorder.state.builds[3].requestedMaterial, "MeshStandardMaterial");
identityObject.object.name = "changed"; identityBuilder.fragmentShader = "changed";
assert.equal(identityRecorder.state.builds[0].object, "Test slats", "records retain primitives, never live scene objects");
assert.ok(!JSON.stringify(identityRecorder.state).includes("vertex-a"), "shader text is not copied into DOM metrics");
for (let i = 0; i < 600; i++) {
  identityRecorder.build({ material: identityObject.material, vertexShader: `vertex-${i}`, fragmentShader: `fragment-${i}` }, identityObject);
  identityRecorder.program({ code: `other-${i}`, stage: "vertex" });
}
assert.equal(identityRecorder.state.builds.length, 256);
assert.equal(identityRecorder.state.programs.length, 256);
assert.ok(identityRecorder.state.dropped > 0);
identityRecorder.close(); identityRecorder.close();
assert.equal(clearedSources, 512, "bounded source strings are released once capture finishes");
const closedIdentity = JSON.stringify(identityRecorder.state);
identityRecorder.build(identityBuilder, identityObject); identityRecorder.program({ code: "after", stage: "fragment" });
assert.equal(JSON.stringify(identityRecorder.state), closedIdentity, "closed captures cannot retain more sources");
let traceClock = 0;
const startupCalls = {};
const traceMethod = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, startupCalls);
const tracedTarget = { offset: 4, draw(value) { return this.offset + value; } };
traceMethod(tracedTarget, "draw", "test");
for (let i = 0; i < 20; i++) assert.equal(tracedTarget.draw(i), i + 4, "timing preserves receiver, arguments and return values");
assert.equal(startupCalls["test.draw"].calls, 20, "startup totals include calls beyond the old twelve-pipeline sample");
assert.equal(startupCalls["test.draw"].totalMs, 20);
assert.equal(startupCalls["test.draw"].slowest.length, 8, "startup detail retention stays bounded");
const shaderTarget = { object: { name: "Fighter thruster pair" }, material: { type: "MeshBasicMaterial" }, build() { return this.object; } };
traceMethod(shaderTarget, "build", "nodeBuilder");
assert.ok(shaderTarget.build() === shaderTarget.object);
assert.equal(startupCalls["nodeBuilder.build"].calls, 1, "actual shader builds are counted separately from cache lookups");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].object, "Fighter thruster pair");
assert.equal(startupCalls["nodeBuilder.build"].slowest[0].material, "MeshBasicMaterial");
for (let i = 0; i < 20; i++) shaderTarget.build();
assert.deepEqual(startupCalls["nodeBuilder.build"].thrusters, { calls: 21, totalMs: 21, maxMs: 1 }, "target aggregate counts every build, not just the top eight");
assert.equal(startupCalls["nodeBuilder.build"].slowest.length, 8);
shaderTarget.object = { name: "Other mesh" }; shaderTarget.build();
assert.equal(startupCalls["nodeBuilder.build"].thrusters.calls, 21, "other objects cannot inflate target attribution");
const expectedFailure = new Error("original failure");
tracedTarget.fail = () => { throw expectedFailure; };
traceMethod(tracedTarget, "fail", "test");
assert.throws(() => tracedTarget.fail(), error => error === expectedFailure, "instrumentation cannot swallow rendering errors");
assert.equal(startupCalls["test.fail"].calls, 1);
const inactiveTrace = new Function("performance", "startupCalls", `${traceSource}; return traceStartupMethod;`)({ now() { throw new Error("inactive timing"); } }, null);
const inactiveTarget = { draw: value => value };
inactiveTrace(inactiveTarget, "draw", "test");
assert.equal(inactiveTarget.draw(7), 7, "timing stops after the bounded startup capture");
const capturedKinds = [];
const identityHooks = { build: (builder, object) => capturedKinds.push(["build", builder, object]), program: program => capturedKinds.push(["program", program]) };
const identityTrace = new Function("performance", "startupCalls", "startupIdentityRecorder", `${traceSource}; return traceStartupMethod;`)({ now: () => ++traceClock }, {}, identityHooks);
const identityBuildTarget = { build: () => 7 };
identityTrace(identityBuildTarget, "build", "nodeBuilder", identityObject);
assert.equal(identityBuildTarget.build(), 7);
assert.ok(capturedKinds[0][1] === identityBuildTarget && capturedKinds[0][2] === identityObject);
const identityBackend = { createProgram: program => program, fail() { throw expectedFailure; } };
identityTrace(identityBackend, "createProgram", "backend");
const sourceProgram = { stage: "vertex", code: "source" };
assert.ok(identityBackend.createProgram(sourceProgram) === sourceProgram);
assert.ok(capturedKinds[1][1] === sourceProgram);
identityTrace(identityBackend, "fail", "nodeBuilder", identityObject);
assert.throws(() => identityBackend.fail(), error => error === expectedFailure);
assert.equal(capturedKinds.length, 2, "failed builds never become successful source-identity evidence");
const tracedFrameAt = graphicsFixture.indexOf("    frame(time);");
const finishStartupSource = graphicsFixture.slice(graphicsFixture.lastIndexOf("  try {", tracedFrameAt), graphicsFixture.indexOf("  renderedFrames++;", tracedFrameAt));
const finishStartup = new Function("frame", "startupTrace", "startupIdentityRecorder", `const time=0, now=0, performance={now:()=>1}, game={renderer:{info:{render:{},memory:{}}}}; let startupCalls={}; ${finishStartupSource}; return startupCalls;`);
let startupClosures = 0;
assert.equal(finishStartup(() => {}, [{}, {}], { close: () => startupClosures++ }), null);
assert.equal(startupClosures, 1, "third successful frame releases transient shader-source identities");
assert.throws(() => finishStartup(() => { throw expectedFailure; }, [], { close: () => startupClosures++ }), error => error === expectedFailure);
assert.equal(startupClosures, 2, "render failure releases transient identities without swallowing the original error");
const destroyReviewSource = graphicsFixture.slice(graphicsFixture.indexOf("function destroyReviewCovers("), graphicsFixture.indexOf('select("destroy-cover").onclick'));
for (const all of [false, true]) {
  const items = [{ x: 1, z: 2, baseY: 0, h: 4 }, { x: 2, z: 3, baseY: 1, h: 6 }];
  const reviewWorld = { destructibles: [...items], detachedDestructibleMeshes: [], districtIndexAt: x => x,
    destroy(point, radius, context) {
      assert.equal(radius, .001); assert.equal(context.partId, "qa-cover-only");
      const item = this.destructibles.find(item => item.x === point.x);
      assert.equal(point.y, item.baseY + item.h / 2);
      this.detachedDestructibleMeshes.push(item); this.destructibles.splice(this.destructibles.indexOf(item), 1);
    } };
  const review = new Function("THREE", "game", "select", `let coverDestruction, sceneSerial=2; ${destroyReviewSource}; return {run:destroyReviewCovers,state:()=>coverDestruction};`)(THREE, { world: reviewWorld }, () => ({ value: "cover-shield" }));
  assert.equal(review.run(all), all ? 2 : 1);
  assert.deepEqual(review.state().targets, all ? [[1, 2], [2, 3]] : [[1, 2]]);
  items[0].x = 99; assert.equal(review.state().targets[0][0], 1, "destruction evidence keeps owned numeric positions");
}

for (const [seed, expected] of [
  ["GRAPHICS-QA-structure", ["3fcaf9d84ec4401241287fef3d3288259e9493dd3171fc3d3bd7ccf8cec086ec", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "183e544aca3ae4ebc7b6ada691287b7adfd03daeab38bd51a0c6056b5153a381"]],
  ["FOUNDRY111-ground", ["8464cd7f25660d46d3c91713d3f67e7a41d2a473a713646b75f8c02a6c5ec38b", "39cdd4e5bbe8932bb96e6b805f99647f9c5723cf63edace962550765be1769f5", "0ad986808bd82a92fd56401c5747bee252f9a867a786b82e462f4839fd7ca2bf"]]
]) {
  const maps = surfaceTextures(seed, 4);
  assert.deepEqual(maps.map(map => createHash("sha256").update(map.image.data).digest("hex")), expected, "height-field reuse preserves every texture byte");
  maps.forEach(map => map.dispose());
}

const coverMaps = surfaceTextures("COVER-TEST", 4, true);
const normalPixel = (x, y) => coverMaps[1].image.data[(y * 256 + x) * 4];
assert.equal(normalPixel(2, 24), 127, "machined plate is flat two texels from a narrow seam, not broadly rounded");
assert.equal(normalPixel(64, 24), 127, "cover has two large plates per axis, not a four-cell upholstered grid");
assert.ok(Math.abs(normalPixel(128, 24) - 127) > 15, "the narrow inter-plate seam remains visibly recessed");
for (const x of [20, 107, 148, 235]) for (const y of [20, 107, 148, 235]) {
  assert.ok(coverMaps[0].image.data[(y * 256 + x) * 4] < 170, "recessed fasteners stay inside the visible cover UV crop");
}
assert.deepEqual(coverMaps.map(map => map.image.width), [256, 256, 256]);
assert.deepEqual(coverMaps.map(map => map.colorSpace), [THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.NoColorSpace]);
coverMaps.forEach(map => map.dispose());

const plate = structuralPanelGeometry();
plate.computeBoundingBox();
assert.deepEqual(plate.boundingBox.min.toArray(), [-.5, -.5, -.5]);
assert.deepEqual(plate.boundingBox.max.toArray(), [.5, .5, .5]);
assert.ok(plate.index.count / 3 <= 108, "macro plates have a fixed small triangle budget");
assert.ok(Math.min(...plate.attributes.color.array) < .4, "frames and inset panels have distinct values");
const pillarPlate = structuralPanelGeometry(.25);
assert.equal(Math.max(...pillarPlate.attributes.uv.array), .25, "pillar service panels use a quarter of the previous repeat cadence");
for (const name of ["position", "normal", "color"]) assert.ok(
  Buffer.from(pillarPlate.attributes[name].array.buffer).equals(Buffer.from(plate.attributes[name].array.buffer)),
  "pillar UV cadence cannot change geometry, normals or frame values");
pillarPlate.dispose();
const route = new THREE.Mesh(structuralRouteGeometry(), new THREE.MeshBasicMaterial());
route.updateMatrixWorld();
const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
assert.equal(ray.intersectObject(route).length, 0, "route lighting leaves the deck material visible through its center");
route.geometry.dispose(); route.material.dispose(); plate.dispose();

const rendererStub = nativeWebGPU => ({
  backend: { isWebGPUBackend: nativeWebGPU }, xr: { enabled: false },
  getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
  getRenderObjectFunction: () => null, getPixelRatio: () => 1, getMRT: () => null,
  getClearColor: target => target.set(0), getClearAlpha: () => 1, getScissorTest: () => false
});
// Inspect the real TSL graph, including the lazy branch's real depth sampler.
for (const alpha of [0, 1]) {
  const previousStack = getCurrentStack(), shaderStack = stack();
  try {
    setCurrentStack(shaderStack);
    const coord = vec2(.5), stored = vec4(.2, .3, .4, alpha);
    const depth = { value: new THREE.DepthTexture(4, 4) }, inverse = uniform(new THREE.Matrix4());
    const sample = recoverInvalidAONormals({ sample(uv) { assert.ok(uv === coord); return stored; } }, depth, inverse);
    const result = sample.sample.shaderNode.jsFunc([coord]);
    const conditions = shaderStack.nodes.filter(node => node.constructor.name === "ConditionalNode");
    assert.equal(conditions.length, 1);
    const condition = conditions[0], operator = condition.condNode.node;
    assert.equal(operator.op, "<");
    assert.equal(operator.bNode.value, .5);
    assert.equal(operator.aNode.components, "w");
    assert.ok(operator.aNode.node.node === stored, "test the stored normal's alpha, not scene opacity");
    assert.equal(result.node.components, "xyz");
    assert.ok(result.node.node === operator.aNode.node, "valid normals keep their exact material RGB");
    assert.equal(condition.elseNode, null);
    const invalidStack = stack(); setCurrentStack(invalidStack);
    condition.ifNode.jsFunc();
    const assign = invalidStack.nodes.find(node => node.isAssignNode);
    assert.ok(assign.targetNode === result);
    assert.ok(assign.sourceNode.node.shaderNode === getNormalFromDepth.shaderNode);
    assert.deepEqual(assign.sourceNode.node.rawInputs, [coord, depth.value, inverse]);
    depth.value.dispose();
  } finally { setCurrentStack(previousStack); }
}
for (const compatibilityMode of [undefined, false, true]) {
  const renderer = rendererStub(true); renderer.backend.compatibilityMode = compatibilityMode;
  renderer.samples = compatibilityMode === true ? 0 : 4;
  const pipeline = new NeonRenderPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.equal(pipeline.aoPass.normalNode === pipeline.scenePass.getTextureNode("normal"), compatibilityMode !== true,
    "only actual compatibility mode installs conditional recovery");
  assert.equal(renderer.samples, compatibilityMode === true ? 0 : 4, "normal recovery cannot change antialiasing");
  assert.equal(pipeline.scenePass.options.samples, undefined, "product leaves sample selection to the renderer");
  pipeline.dispose();
}
for (const nativeWebGPU of [true, false]) for (const quality of ["low", "medium", "high"]) {
  const pipeline = new NeonRenderPipeline(rendererStub(nativeWebGPU), new THREE.Scene(), new THREE.PerspectiveCamera(), { quality });
  assert.equal(Boolean(pipeline.pipeline), quality !== "low" && (!nativeWebGPU || quality === "high"));
  assert.equal(Boolean(pipeline.highLoadPipeline), nativeWebGPU && quality === "medium");
  assert.equal(Boolean(pipeline.aoPass), nativeWebGPU && quality === "high");
  pipeline.setQuality("high");
  if (nativeWebGPU) {
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("normal").blending, THREE.NormalBlending,
      "AO normals must preserve the opaque normal behind non-depth-writing decoration");
    assert.equal(pipeline.scenePass.getMRT().getBlendMode("output").blending, THREE.MaterialBlending,
      "scene color keeps the original per-material blend modes");
    const makeNormal = pipeline.scenePass.getMRT().get("normal").node.shaderNode.jsFunc;
    for (const depthWrite of [true, false]) for (const transparent of [true, false]) for (const opacity of [0, .11, 1]) {
      const normal = makeNormal([], { material: { depthWrite, transparent, opacity } }).node;
      assert.ok(normal.nodes[0] === normalView, "solid surface normal mapping is preserved");
      assert.equal(normal.nodes[1].value, Number(depthWrite), "AO normal coverage follows depth writes, not opacity or color blend mode");
    }
    assert.deepEqual([pipeline.aoPass.resolutionScale, pipeline.aoPass.samples.value, pipeline.aoPass.radius.value,
      pipeline.aoPass.thickness.value, pipeline.aoPass.distanceExponent.value, pipeline.aoPass.distanceFallOff.value],
      [.5, 16, 1.6, 2.2, 1.35, .7], "depth-matched normals do not reduce AO quality");
  }
  const full = pipeline.pipeline;
  pipeline.setQuality("medium");
  const balanced = pipeline.highLoadPipeline;
  for (let i = 0; i < 5; i++) for (const level of ["low", "high", "medium"]) pipeline.setQuality(level);
  assert.ok(pipeline.pipeline === full, "tier toggles reuse the full graph without recompiling it");
  assert.ok(pipeline.highLoadPipeline === balanced, "tier toggles reuse the balanced graph");
  pipeline.dispose(); pipeline.dispose();
  assert.equal(pipeline.pipeline, null);
  assert.equal(pipeline.highLoadPipeline, null);
}

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const frameSource = main.slice(main.indexOf("  frame(time) {"), main.indexOf("  update(dt, realDt = dt) {"));
const firstFrameEvents = [];
const frameMethod = new Function("performance", `return ({${frameSource}}).frame`)({
  mark: name => firstFrameEvents.push(name), measure: name => firstFrameEvents.push(name)
});
const firstFrameState = {
  state: "play", paused: true, hideMatchLoadingAfterFrame: true,
  commitResize() {}, timer: { update() {}, getDelta: () => 1 / 60 },
  input: { tapped: () => false, endFrame() {} }, renderScene: () => false,
  setMatchLoading: value => firstFrameEvents.push(value)
};
frameMethod.call(firstFrameState, 100);
assert.equal(firstFrameState.hideMatchLoadingAfterFrame, true, "a skipped frame cannot dismiss the loader");
assert.equal(firstFrameEvents.length, 0);
firstFrameState.renderScene = () => true;
frameMethod.call(firstFrameState, 116);
assert.deepEqual(firstFrameEvents, ["blaster-arena-first-frame", "blaster-arena-first-render", false]);
frameMethod.call(firstFrameState, 133);
assert.equal(firstFrameEvents.length, 3, "first-render completion is emitted only once per match");
const resize = main.slice(main.indexOf("  commitResize() {"), main.indexOf("  applyGraphicsSettings() {"));
const commitResize = new Function(`return ({${resize}}).commitResize`)();
const submitted = [], renderer = { setDrawingBufferSize: (...args) => submitted.push(args) };
const resizeState = { renderer, pendingResize: { width: 1280, height: 720, pixelRatio: 1.65 } };
commitResize.call(resizeState);
resizeState.pendingResize = { width: 1280, height: 720, pixelRatio: 1.65 };
commitResize.call(resizeState);
assert.equal(submitted.length, 1, "same-size events never recreate framebuffer attachments");
resizeState.pendingResize = { width: 390, height: 844, pixelRatio: 1.3 };
commitResize.call(resizeState);
assert.deepEqual(submitted[1], [390, 844, 1.3]);
const qualityEvents = [];
Object.assign(resizeState, {
  pendingGraphics: true, graphics: graphicsProfile("low"),
  renderer: { ...renderer, getMaxAnisotropy: () => 8 },
  renderPipeline: { setQuality: level => qualityEvents.push(level) },
  world: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  combatVisuals: { setGraphicsProfile: profile => qualityEvents.push(profile.level) },
  keyLight: { shadow: { mapSize: new THREE.Vector2(4096, 4096), map: { dispose: () => qualityEvents.push("dispose-shadow") } } }
});
commitResize.call(resizeState);
assert.deepEqual(qualityEvents, ["low", "low", "low", "dispose-shadow"]);
assert.equal(resizeState.keyLight.shadow.map, null);
commitResize.call(resizeState);
assert.equal(qualityEvents.length, 4, "graphics resources change only once at the frame boundary");

for (const [level, shadowMapSize, anisotropy] of [["low", 1024, 4], ["medium", 2048, 8], ["high", 4096, 16]]) {
  const profile = graphicsProfile(level, false, 3);
  assert.equal(profile.shadowMapSize, shadowMapSize);
  assert.equal(profile.anisotropy, anisotropy);
  assert.deepEqual(graphicsProfile(level, true, 3), profile, "touch input never silently lowers the selected tier");
  const effects = new CombatVisuals(new THREE.Scene(), { quality: profile.combatQuality });
  effects.setGraphicsProfile(profile);
  assert.equal(effects.rings.length, 128, "all tiers retain enough core impacts for the 112-hit maximum-player volley");
  assert.equal(effects.tracers.length, 128);
  assert.equal(effects.flashes.length, 64);
  const gameplayRandom = Math.random;
  let gameplayRandomCalls = 0;
  Math.random = () => { gameplayRandomCalls++; return .5; };
  try {
    for (const weapon of Object.values(WEAPONS)) {
      effects.impact(new THREE.Vector3(), weapon, { color: 0x129dba, accent: 0x6ff6ff }, { explosive: Boolean(weapon.radius) });
    }
    effects.burst(new THREE.Vector3(), 0x6ff6ff, 16);
    effects.blood(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  } finally { Math.random = gameplayRandom; }
  assert.equal(gameplayRandomCalls, 0, "visual density never consumes gameplay randomness");
  effects.dispose();
}
const scene = new THREE.Scene();
const createOnlineSource = main.slice(main.indexOf("  createOnlineFighter(data, position) {"), main.indexOf("  async startMatch("));
const createOnlineFighter = new Function("Fighter", `return ({${createOnlineSource}}).createOnlineFighter`)(Fighter);
const restoredWeapon = createOnlineFighter.call({ scene, controlsNetworkPlayer: () => true }, {
  id: "cache-online", name: "QA", color: 0x129dba, accent: 0x6ff6ff,
  loadout: ["blaster", "rocket_launcher"], slotIndex: 1, health: 37, ammo: { rocket_launcher: 1 }
}, new THREE.Vector3());
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "authoritative nonzero initial slot restores the corresponding model");
assert.equal(restoredWeapon.health, 37); assert.equal(restoredWeapon.ammo.rocket_launcher, 1);
const reconnectSource = main.slice(main.indexOf("  handleNetworkReconnect(welcome) {"), main.indexOf("  clearTransientNetworkCombat() {"));
const reconnect = new Function("THREE", "uniquePlayersById", `return ({${reconnectSource}}).handleNetworkReconnect`)(THREE, players => players);
restoredWeapon.switchSlot(0);
restoredWeapon.reloadTimer = .7; restoredWeapon.reloadWeaponId = "blaster";
reconnect.call({
  state: "play", world: {}, multiplayer: { playerId: restoredWeapon.id }, players: [restoredWeapon],
  hideNetworkReconnecting() {}, clearTransientNetworkCombat() {}, syncOnlineRoster() {}, updateCamera() {}
}, { players: [{ id: restoredWeapon.id, slotIndex: 1, health: 37, alive: true, ammo: { rocket_launcher: 1 } }] });
assert.equal(restoredWeapon.weaponModelId, "rocket_launcher", "in-place reconnect restores the authoritative weapon visual");
assert.deepEqual([restoredWeapon.health, restoredWeapon.ammo.rocket_launcher, restoredWeapon.reloadTimer, restoredWeapon.reloadWeaponId], [37, 1, .7, "blaster"]);
restoredWeapon.dispose();
// Matrices/colors are captured from the full-capacity implementation before
// trimming dead draw tails. Stable slots keep transparent blending order intact.
const effectDigests = [];
const effectGroups = [
  ["flashes", "flashOuter", "flashInner"], ["tracers", "tracerOuter", "tracerInner"],
  ["rings", "ringOuter", "ringInner"], ["sparks", "sparkLayer"], ["bloodDecals", "bloodLayer"]
];
for (const quality of [.5, .75, 1]) {
  const effects = new CombatVisuals(new THREE.Scene(), { quality });
  assertCompatibleAONormals(effects.group);
  const digest = createHash("sha256");
  const start = new THREE.Vector3(1, 2, 3), end = new THREE.Vector3(5, 6, 7), normal = new THREE.Vector3(0, 1, 0);
  const owner = { color: 0x129dba, accent: 0x6ff6ff, aim: normal, muzzlePoint: target => target.copy(start) };
  for (let volley = 0; volley < 3; volley++) for (const weapon of Object.values(WEAPONS)) {
    effects.muzzle(owner, weapon); effects.tracer(start, end, weapon, owner);
    effects.impact(end, weapon, owner, { explosive: Boolean(weapon.radius) }); effects.blood(end, normal);
    for (const dt of [.008, .016, .09, .4]) {
      effects.update(dt);
      for (const [slots, ...names] of effectGroups) {
        const count = effects[slots].findLastIndex(slot => slot.life > 0) + 1;
        for (const name of names) assert.equal(effects[name].count, count, `${name} must retain every live slot through wrap/expiry`);
      }
      for (const [, ...names] of effectGroups) for (const name of names) {
        digest.update(new Uint8Array(effects[name].instanceMatrix.array.buffer));
        digest.update(new Uint8Array(effects[name].instanceColor.array.buffer));
      }
    }
  }
  effectDigests.push(digest.digest("hex"));
  for (const [slots] of effectGroups) {
    const pool = effects[slots];
    pool.forEach(slot => { slot.life = 0; });
    pool[0].life = .05; pool.at(-1).life = .01;
  }
  for (const [dt, bound] of [[.008, "full"], [.008, 1], [.05, 0], [.01, 0]]) {
    effects.update(dt);
    for (const [slots, ...names] of effectGroups) for (const name of names) {
      assert.equal(effects[name].count, bound === "full" ? effects[slots].length : bound, "sparse wrap retains the last slot until it expires, then keeps slot zero");
    }
  }
  effects.dispose();
}
assert.deepEqual(effectDigests, [
  "0210fb48d26f44d6745b45316c6f35b61c952e414de0e9ad78352308ef7279e4",
  "0f54f2d5a66f74c80741732d45bd2164a9ae59df2eb4c67b526163edbe1f5e77",
  "2a4ff06b7d57d1718b4a4ca63c6d3ccd0c8e5703ebe452b7a7fa50bf1fc6deaf"
], "all 47 weapons at all tiers retain byte-identical effect transforms and colours");
const emptyEffects = new CombatVisuals(new THREE.Scene());
for (const [, ...names] of effectGroups) for (const name of names) assert.equal(emptyEffects[name].count, 0, "countdown frames start with empty draw ranges");
emptyEffects.update(1 / 60);
assert.equal(emptyEffects.ringOuter.count, 0, "an empty impact pool must submit no triangles");
emptyEffects.dispose();
scene.environment = new THREE.Texture();
const lightingEnvironment = scene.environment;
const world = new ArenaWorld(scene, "GRAPHICS-QA");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.geometry)).size, 1, "all eight pads reuse one immutable housing");
assert.equal(world.boostPads[0].mesh.geometry.index.count / 3, 384, "housing triangle cost remains explicitly bounded");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.children[2].material.opacityNode)).size, 1,
  "all plumes must share one shader expression rather than compiling identical per-pad graphs");
assert.equal(new Set(world.boostPads.map(pad => pad.mesh.children[2].material.customProgramCacheKey())).size, 1);
assert.deepEqual(world.boostPads.map(pad => [...pad.position.toArray(), pad.strength]), [
  [-18, 0, -18, 24], [18, 0, 18, 24], [-66, 0, 22, 29], [66, 0, -22, 29],
  [-52, 15, -48, 26], [53, 15, 49, 26], [42, 31, -22, 27], [-42, 47, 30, 28]
], "boost artwork preserves all gameplay positions and launch strengths");
for (const pad of world.boostPads) {
  assert.equal(pad.radius, 2.5); assert.equal(pad.mesh.position.y, pad.position.y + .12);
  assert.equal(pad.mesh.material.transparent, false, "boost hardware is opaque, not a translucent light source");
  assert.equal(pad.mesh.material.emissiveIntensity, 0, "the body cannot compete with its inset emitters");
  pad.mesh.geometry.computeBoundingBox();
  const bounds = pad.mesh.geometry.boundingBox;
  assert.ok(Math.abs(bounds.min.y + .11) < 1e-6 && Math.abs(bounds.max.y - .11) < 1e-6);
  assert.ok(Math.abs(bounds.min.x + 2.5) < 1e-6 && Math.abs(bounds.max.x - 2.5) < 1e-6);
  const housingNormals = pad.mesh.geometry.attributes.normal;
  assert.ok(Array.from({ length: housingNormals.count }, (_, i) => Math.abs(housingNormals.getY(i)))
    .some(y => y > .1 && y < .99), "housing has an authored bevel between the flat top and cylindrical side");
  const [ring, arrows, plume] = pad.mesh.children;
  assert.equal(pad.mesh.children.length, 3, "material refinement adds no pad objects or light sources");
  assert.equal(ring.material.opacity, .38); assert.equal(arrows.material.opacity, .42);
  assert.equal(ring.material.blending, THREE.AdditiveBlending);
  assert.equal(plume.geometry.parameters.height, 3.4);
  assert.equal(plume.geometry.parameters.radiusTop, 1.55); assert.equal(plume.geometry.parameters.radiusBottom, 2.15);
  assert.equal(plume.material.depthWrite, false); assert.equal(plume.material.side, THREE.DoubleSide);
  assert.ok(plume.material.opacityNode?.isNode, "plume transparency fades continuously in its actual shader");
  const unwrap = node => node.isVarNode ? node.node : node;
  const opacity = unwrap(plume.material.opacityNode), inverse = unwrap(opacity.aNode), fade = unwrap(inverse.aNode);
  assert.equal(opacity.op, "*"); assert.equal(unwrap(opacity.bNode).value, .055, "lower lift cue keeps its original alpha");
  assert.equal(inverse.method, "oneMinus"); assert.equal(fade.method, "smoothstep");
  assert.equal(unwrap(fade.aNode).value, .5); assert.equal(unwrap(fade.bNode).value, 1);
  const heightUV = unwrap(fade.cNode);
  assert.equal(heightUV.components, "y"); assert.equal(unwrap(heightUV.node).getAttributeName(), "uv");
  const positions = plume.geometry.attributes.position, uvs = plume.geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) assert.equal(uvs.getY(i), positions.getY(i) > 0 ? 1 : 0,
    "actual cylinder UVs place full intensity at the base and zero at the upper rim");
  const pulse = world.pulsers.find(pulse => pulse.object === ring);
  assert.deepEqual([pulse.base, pulse.amplitude, pulse.speed, pulse.phase], [1, .055, 3.8, pad.position.x + pad.position.z]);
}
const triggerPad = world.boostPads[0], trigger = triggerPad.position;
assert.ok(world.boostAt(trigger) === triggerPad);
assert.equal(world.boostAt(trigger.clone().add(new THREE.Vector3(2.5, 0, 0))), undefined);
assert.equal(world.boostAt(trigger.clone().add(new THREE.Vector3(0, .35, 0))), undefined);
assertCompatibleAONormals(world.group);
const coverSource = readFileSync(new URL("../src/world.js", import.meta.url), "utf8");
const legacyLightGeometry = new Function("THREE", `${coverSource.slice(coverSource.indexOf("function coverLightGeometry("), coverSource.indexOf("function segmentCircle("))}; return coverLightGeometry;`)(THREE);
const legacyDecorateSource = coverSource.slice(coverSource.indexOf("  decorateBreakable("), coverSource.indexOf("  addBox(", coverSource.indexOf("  decorateBreakable(")))
  .replace(/^\s*if \(inset\) slats = bakeCoverSlats\(slats\);\r?\n/m, "");
const legacyDecorate = new Function("THREE", "coverLightGeometry", `return function ${legacyDecorateSource};`)(THREE, legacyLightGeometry);
const legacyCoverRoots = world.destructibles.map(obstacle => {
  const root = new THREE.Mesh(obstacle.mesh.geometry, obstacle.mesh.material);
  legacyDecorate.call(world, root, obstacle.x, obstacle.z, true); return root;
});
const legacyCoverLights = legacyCoverRoots.map(root => root.children.find(child => child.isInstancedMesh));
const coverLights = world.destructibles.map((obstacle, index) => obstacle.mesh.getObjectByName(legacyCoverLights[index].name));
assert.equal(coverLights.length, 34);
assert.equal(createHash("sha256").update(Buffer.concat(legacyCoverLights.map(mesh => Buffer.from(mesh.instanceMatrix.array.buffer)))).digest("hex"),
  "79e8a017067ce8ec1fed7ae87de457878322758c2d9d4c73c0128e90df5d8849", "symbol instances keep their authored positions, rotations and illuminated scale");
for (const [coverIndex, light] of legacyCoverLights.entries()) {
  const baked = coverLights[coverIndex], { geometry } = baked;
  assert.ok(baked.isMesh && !baked.isInstancedMesh, "opaque cover symbols use one locally baked mesh without object-specific instance bindings");
  assert.equal(geometry.index, null); assert.equal(geometry.attributes.position.count, 240);
  assert.ok(baked.material === light.material && baked.parent === world.destructibles[coverIndex].mesh);
  for (const flag of ["castShadow", "receiveShadow", "renderOrder", "frustumCulled", "visible"]) assert.equal(baked[flag], light[flag]);
  assert.equal(baked.layers.mask, light.layers.mask);
  assert.deepEqual(baked.matrix.toArray(), light.matrix.toArray());
  assert.deepEqual(geometry.boundingSphere, light.boundingSphere, "baked symbols retain the original conservative culling volume");
  const storedMatrix = new THREE.Matrix4(), storedNormal = new THREE.Matrix3(), point = new THREE.Vector3();
  for (let piece = 0; piece < 4; piece++) {
    light.getMatrixAt(piece, storedMatrix); storedNormal.getNormalMatrix(storedMatrix);
    for (let vertex = 0; vertex < light.geometry.attributes.position.count; vertex++) {
      const bakedIndex = piece * 60 + vertex;
      for (const name of ["position", "normal"]) {
        point.fromBufferAttribute(light.geometry.attributes[name], vertex);
        if (name === "position") point.applyMatrix4(storedMatrix); else point.applyNormalMatrix(storedNormal);
        const actual = new THREE.Vector3().fromBufferAttribute(geometry.attributes[name], bakedIndex);
        assert.ok(actual.distanceTo(point) < 3e-7, `${light.name}: stored Float32 transform and ${name} remain within rounding tolerance`);
        if (name === "position") assert.ok(actual.distanceTo(geometry.boundingSphere.center) <= geometry.boundingSphere.radius + 3e-7);
      }
      for (const name of ["uv", "color"]) {
        const before = light.geometry.attributes[name], after = geometry.attributes[name];
        for (let axis = 0; axis < before.itemSize; axis++) assert.equal(after.array[bakedIndex * before.itemSize + axis], before.array[vertex * before.itemSize + axis]);
      }
    }
  }
  const { position, normal, uv, color } = light.geometry.attributes;
  assert.equal((light.geometry.index?.count ?? position.count) / 3, 20, "closed light housing uses ten planar quads within its existing draw");
  assert.equal(light.count, 4);
  assert.equal(light.material.color.getHex(), 0xffffff, "vertex colors separate neutral housing from colored diffuser");
  assert.equal(light.material.emissiveIntensity, .3, "diffuser brightness is unchanged");
  assert.ok(light.material.emissiveMap === world.coverLightMask, "one shared mask keeps the neutral bezel unlit");
  const face = [];
  for (let i = 0; i < position.count; i++) if (uv.getX(i) > .5) {
    face.push(i);
    assert.ok(Math.abs(position.getZ(i) - .488) < 1e-6);
    assert.ok(Math.abs(normal.getZ(i) - 1) < 1e-6);
    assert.ok(Math.abs(Math.abs(position.getX(i)) - .445) < 1e-6 && Math.abs(Math.abs(position.getY(i)) - .445) < 1e-6, "colored face retains its exact old local bounds");
  }
  assert.equal(face.length, 6, "only the inset front diffuser emits light");
  for (let i = 0; i < position.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(color[axis](i), color[axis](i + 5), "bezel and diffuser colors never interpolate across a triangle");
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "light housing corners are planar without diagonal patches");
  }
}
const bakeSource = coverSource.slice(coverSource.indexOf("function bakeCoverSlats("), coverSource.indexOf("// Three owns and reuses"));
const temporaryBakes = new Map();
const actualBake = new Function("THREE", "mergeGeometries", `${bakeSource}; return bakeCoverSlats;`)(THREE, (pieces, groups) => {
  pieces.forEach(piece => { temporaryBakes.set(piece, 0); piece.addEventListener("dispose", () => temporaryBakes.set(piece, temporaryBakes.get(piece) + 1)); });
  return mergeGeometries(pieces, groups);
});
const bakeInput = new THREE.InstancedMesh(legacyCoverLights[0].geometry.clone(), legacyCoverLights[0].material.clone(), 4);
bakeInput.instanceMatrix.copy(legacyCoverLights[0].instanceMatrix); bakeInput.computeBoundingSphere();
let inputGeometryDisposals = 0, instanceDisposals = 0, bakeMaterialDisposals = 0;
bakeInput.geometry.addEventListener("dispose", () => inputGeometryDisposals++);
bakeInput.addEventListener("dispose", () => instanceDisposals++);
bakeInput.material.addEventListener("dispose", () => bakeMaterialDisposals++);
const bakeOutput = actualBake(bakeInput);
assert.equal(temporaryBakes.size, 4); assert.ok([...temporaryBakes.values()].every(count => count === 1));
assert.equal(inputGeometryDisposals, 1); assert.equal(instanceDisposals, 1);
assert.equal(bakeMaterialDisposals, 0, "baking cannot dispose the material still used by the new mesh and other covers");
bakeOutput.geometry.dispose(); bakeOutput.material.dispose();
for (const root of legacyCoverRoots) for (const child of root.children) { child.geometry.dispose(); child.dispose?.(); }
assert.ok(scene.backgroundNode?.isNode, "arena sky has a continuous horizon-to-zenith background");
assert.equal(scene.fog.density, .0044, "sky treatment cannot hide content with extra fog");
assert.ok(scene.environment === lightingEnvironment, "background must not replace the scene lighting environment");
for (const segment of world.structures.flatMap(structure => structure.segments)) {
  const rails = segment.instanceVisuals.filter(visual => visual.mesh.name === "Instanced pillar load rails");
  assert.equal(rails.length, 4, "each destructible module retains its four owned load rails");
  for (const rail of rails) for (const [axis, span] of [["x", segment.w], ["z", segment.d]]) {
    const outer = Math.abs(rail.offset[axis]) + rail.scale[axis] / 2;
    assert.ok(outer > span / 2 + .005, "pillar rails must be visible beyond the opaque body, not buried inside it");
    assert.ok(outer <= span / 2 + .07, "decorative rail clearance remains under seven centimetres; collision envelope is unchanged");
  }
}
const centralDeck = world.platforms.find(platform => platform.x === 0 && platform.z === 0 && platform.top === 15);
assert.equal(centralDeck.mesh.material.color.getHexString(), "162b3b", "walking surfaces keep a neutral slate base");
assert.ok(centralDeck.mesh.material.envMap === scene.environment, "deck reflections share the existing environment texture");
assert.equal(centralDeck.mesh.material.envMapIntensity, .24, "deck reflection tuning actually overrides scene intensity");
assert.ok(world.structuralBatchMeshes.find(mesh => mesh.name === "Instanced destructible platform decks").material.envMap === scene.environment);
for (const texture of world.textures) {
  if (texture === world.coverLightMask) {
    assert.deepEqual(Array.from(texture.image.data), [0, 0, 0, 255, 255, 255, 255, 255]);
    assert.equal(texture.minFilter, THREE.NearestFilter);
    assert.equal(texture.magFilter, THREE.NearestFilter);
    assert.equal(texture.generateMipmaps, false, "constant per-face emission lookup must not average the unlit and lit texels");
    continue;
  }
  assert.ok(texture.generateMipmaps, "procedural filtered textures must generate their mip chain");
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
}
assert.ok(world.panelTexture.image.width >= 256);
assert.equal(world.panelTexture.colorSpace, THREE.SRGBColorSpace);
assert.equal(world.panelNormal.colorSpace, THREE.NoColorSpace);
assert.equal(world.panelRoughness.colorSpace, THREE.NoColorSpace);
for (const level of ["low", "medium", "high", "low", "high"]) {
  world.setGraphicsProfile(graphicsProfile(level), 8);
  assert.equal(world.panelTexture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8));
  for (const texture of world.coverTextures) assert.equal(texture.anisotropy, Math.min(graphicsProfile(level).anisotropy, 8), "cover filtering follows every selected tier and device limit");
  assert.equal(world.structures.length, 20, "tier changes never alter structural/collision content");
}
const gripFighter = new Fighter(scene, { id: "grip-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3(0, 15.01, 8));
const cacheFighter = new Fighter(scene, { id: "cache-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff },
  ["blaster", "minigun", "punch_glove", "fireball", "plasma_cannon"], new THREE.Vector3());
const cachedChildren = [];
for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  cachedChildren[slot] = [...cacheFighter.weaponGroup.children];
}
cacheFighter.switchSlot(0);
assert.ok(cacheFighter.weaponGroup.children[0] === cachedChildren[0][0], "returning to a selected weapon must reuse its existing visual resources");
const cachedResources = new Map();
const recordResource = resource => {
  if (!resource || resource.userData?.sharedFighterGeometry || cachedResources.has(resource)) return;
  cachedResources.set(resource, 0);
  resource.addEventListener("dispose", () => cachedResources.set(resource, cachedResources.get(resource) + 1));
};
for (const root of [cacheFighter.group, ...[...cacheFighter.weaponModels.values()].map(model => model.group)]) root.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
for (let cycle = 0; cycle < 3; cycle++) for (let slot = 0; slot < 5; slot++) {
  cacheFighter.switchSlot(slot);
  assert.ok(cacheFighter.weaponGroup.children.every((child, i) => child === cachedChildren[slot][i]));
  assert.equal(cacheFighter.weaponModelId, cacheFighter.loadout[slot]);
  const activeObjects = new Set();
  cacheFighter.group.traverse(object => activeObjects.add(object));
  for (const [id, model] of cacheFighter.weaponModels) if (id !== cacheFighter.weaponModelId) {
    model.group.traverse(object => assert.ok(!activeObjects.has(object), "inactive cached weapons cannot be cloned into decoys"));
  }
}
assert.ok([...cachedResources.values()].every(count => count === 0), "switching never disposes a retained resource");
cacheFighter.loadout[0] = "rocket_launcher";
cacheFighter.switchSlot(0);
assert.equal(cacheFighter.weaponModelId, "rocket_launcher");
assert.equal(cacheFighter.weaponModels.has("blaster"), false, "removed loadout models are evicted");
cacheFighter.weaponGroup.traverse(object => {
  recordResource(object.geometry);
  for (const mat of Array.isArray(object.material) ? object.material : [object.material]) recordResource(mat);
});
cacheFighter.dispose();
assert.ok([...cachedResources.values()].every(count => count === 1), "all original active, inactive and evicted owned resources dispose exactly once");
assert.equal(cacheFighter.weaponModels.size, 0);
for (const id of Object.keys(WEAPONS)) {
  const alternate = id === "blaster" ? "machine_gun" : "blaster";
  const fighter = new Fighter(scene, { id: "cache-parity", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [id, alternate], new THREE.Vector3());
  const model = fighter.weaponModels.get(id), originalChildren = [...fighter.weaponGroup.children];
  const geometryHash = () => {
    const hash = createHash("sha256");
    fighter.weaponGroup.traverse(object => {
      for (const attribute of Object.values(object.geometry?.attributes || {})) hash.update(new Uint8Array(attribute.array.buffer));
    });
    return hash.digest("hex");
  };
  const before = geometryHash();
  fighter.weaponGlowMaterial.emissiveIntensity = 3;
  fighter.weaponSpinner?.rotateZ(.7);
  if (fighter.weaponPiston) fighter.weaponPiston.position.z += .3;
  fighter.switchSlot(1); fighter.switchSlot(0);
  assert.ok(fighter.weaponGroup.children.every((child, i) => child === originalChildren[i]));
  assert.equal(geometryHash(), before, `${id}: cached geometry is byte-identical`);
  assert.deepEqual(fighter.weaponGrip.toArray(), model.grip.toArray());
  assert.deepEqual(fighter.weaponSupportGrip.toArray(), model.supportGrip.toArray());
  assert.equal(fighter.weaponMuzzleDistance, model.state.weaponMuzzleDistance);
  assert.equal(fighter.weaponGlowMaterial.emissiveIntensity, .25);
  if (fighter.weaponSpinner) assert.deepEqual(fighter.weaponSpinner.quaternion.toArray(), model.spinnerRotation.toArray());
  if (fighter.weaponPiston) assert.deepEqual(fighter.weaponPiston.position.toArray(), model.pistonPosition.toArray());
  fighter.health = 37; fighter.ammo[id] = 1; fighter.reloadTimer = .7; fighter.reloadWeaponId = id;
  fighter.updateWeaponModel();
  assert.deepEqual([fighter.health, fighter.ammo[id], fighter.reloadTimer, fighter.reloadWeaponId], [37, 1, .7, id], "visual refresh cannot reset authoritative or weapon state");
  fighter.dispose();
}
const stealingId = "weapon_stealing_projectile";
const stealingFighters = [[stealingId, "blaster", "minigun"], ["blaster", stealingId, "fireball"]].map((loadout, i) =>
  new Fighter(scene, { id: `cache-steal-${i}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, loadout, new THREE.Vector3()));
for (const fighter of stealingFighters) for (let slot = 0; slot < 3; slot++) fighter.switchSlot(slot);
swapStolenWeapon(...stealingFighters, stealingId, 0, 0);
for (const fighter of stealingFighters) {
  for (let slot = 0; slot < 3; slot++) { fighter.slotIndex = slot; fighter.updateWeaponModel(); assert.equal(fighter.weaponModelId, fighter.loadout[slot]); }
  fighter.dispose();
}
for (let frame = 0; frame < 60; frame++) gripFighter.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), {}, world);
gripFighter.group.updateMatrixWorld(true);
const handCenter = new THREE.Vector3(0, -.58, .05).applyMatrix4(gripFighter.rightForearm.matrixWorld);
const gripCenter = new THREE.Vector3(.05, -.2, .11).applyMatrix4(gripFighter.weaponGroup.matrixWorld);
assert.ok(handCenter.distanceTo(gripCenter) < .03, `aiming hand must meet its grip, gap=${handCenter.distanceTo(gripCenter).toFixed(3)}m`);
gripFighter.dispose();
const poseWorld = { resolve: position => { position.y = 0; return { grounded: true }; }, boostAt: () => null };
const noMovement = new THREE.Vector3(), poseLook = new THREE.Vector3();
// Reconstruct the old separate-pivot builder from the current builder. Put its
// armor parts in body-then-head order only for a direct buffer comparison.
const legacyHeadSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace("visor.position.set(0, .02, .469)", "visor.position.set(0, 2.1, .469)")
  .replace(/    const headArmor = mergeStaticParts\(armor, \[brow, helmetCrest\]\);[\s\S]*?    helmetAssembly.add\(visor, headArmor\);\r?\n/, "")
  .replace("[chest, breastplate, pelvis, leftShoulder, rightShoulder]", "[chest, breastplate, pelvis, leftShoulder, rightShoulder, brow, helmetCrest]")
  .replace("staticDark, staticArmor, staticAccent, helmetAssembly,", "staticDark, staticArmor, staticAccent, helmetAssembly, visor,")
  .replace("    const thrust = landing", "    this.visor.rotation.x = this.helmet.rotation.x;\n    const thrust = landing");
const LegacyHeadFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${legacyHeadSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
// Exercise the production update: equal Euler angles on different pivots do
// not keep a lens inside its housing, especially at steep aim or on landing.
for (let variant = 0; variant < 4; variant++) {
  const fighter = new Fighter(scene, { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  const legacy = new LegacyHeadFighter(new THREE.Scene(), { id: fighter.id, color: fighter.color, accent: fighter.accent }, ["blaster"], new THREE.Vector3());
  const headArmor = fighter.helmet.getObjectByName("Helmet brow and crest");
  assert.ok(headArmor, "head armor belongs to the moving head");
  const bodyArmor = fighter.rig.children[1], oldArmor = legacy.rig.children[1];
  for (const name of ["position", "normal", "uv"]) {
    const body = bodyArmor.geometry.attributes[name], head = headArmor.geometry.attributes[name], old = oldArmor.geometry.attributes[name];
    assert.equal(body.count + head.count, old.count, "splitting the armor never changes vertex/triangle count");
    assert.deepEqual(body.array, old.array.slice(0, body.array.length), "body buffers remain byte-identical");
    for (let i = 0; i < head.array.length; i++) {
      const inRig = head.array[i] + (name === "position" && i % 3 === 1 ? 2.08 : 0);
      assert.ok(Math.abs(inRig - old.array[body.array.length + i]) < 3e-7, `${variant}/${name}/${i}: neutral brow and crest geometry is preserved`);
    }
  }
  const modernSnapshot = mergedFighterSnapshot(fighter, new Set([bodyArmor, headArmor]));
  const legacySnapshot = mergedFighterSnapshot(legacy, new Set([oldArmor]));
  assert.equal(modernSnapshot.meshes.length, legacySnapshot.meshes.length);
  for (let i = 0; i < modernSnapshot.meshes.length; i++) {
    const current = modernSnapshot.meshes[i], old = legacySnapshot.meshes[i];
    assert.ok(current.matrix.every((value, index) => Math.abs(value - old.matrix[index]) < 1e-12), "all other neutral world transforms are unchanged");
    assert.deepEqual({ ...current, matrix: null }, { ...old, matrix: null }, "all other geometry, UVs, bounds and materials are unchanged");
  }
  fighter.group.updateMatrixWorld(true);
  const neutralLens = fighter.helmet.matrixWorld.clone().invert().multiply(fighter.visor.matrixWorld);
  for (const pitch of [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, 0]) {
    const aim = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch));
    for (let frame = 0; frame < 60; frame++) {
      if (pitch === 0) { fighter.landTimer = .15; fighter.landStrength = 1; }
      fighter.update(1 / 60, noMovement, aim, {}, poseWorld);
      if (pitch === 0) { legacy.landTimer = .15; legacy.landStrength = 1; }
      legacy.update(1 / 60, noMovement, aim, {}, poseWorld);
      assert.deepEqual(fighter.muzzlePoint().toArray(), legacy.muzzlePoint().toArray(), "head motion cannot change projectile origins");
      assert.deepEqual(fighter.weaponGroup.matrix.elements, legacy.weaponGroup.matrix.elements, "weapon poses remain unchanged");
      fighter.group.updateMatrixWorld(true);
      const relative = fighter.helmet.matrixWorld.clone().invert().multiply(fighter.visor.matrixWorld);
      assert.ok(relative.elements.every((value, i) => Math.abs(value - neutralLens.elements[i]) < 1e-10),
        `helmet ${variant}/${pitch}/${frame}: lens must stay fixed inside the moving frame`);
    }
  }
  assert.equal(fighter.visor.parent, fighter.helmet, "the existing helmet is the only head pitch pivot");
  assert.deepEqual(fighter.visor.rotation.toArray(), [0, 0, 0, "XYZ"], "a child must not receive the head rotation twice");
  assert.equal(headArmor?.parent, fighter.helmet, "brow and crest must follow the same pivot");
  assert.equal(headArmor.material, fighter.armorMaterial, "head armor keeps its existing material");
  const resources = new Map();
  fighter.group.traverse(object => {
    for (const resource of [object.geometry, ...[].concat(object.material || [])]) {
      if (!resource || resource.userData?.sharedFighterGeometry || resources.has(resource)) continue;
      resources.set(resource, 0); resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
    }
  });
  fighter.dispose();
  legacy.dispose();
  assert.ok([...resources.values()].every(count => count === 1), "nested head resources are disposed exactly once with the fighter");
  assert.equal(fighter.group.parent, null);
}
const browFighter = new Fighter(scene, { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const browPositions = browFighter.helmet.getObjectByName("Helmet brow and crest").geometry.attributes.position;
for (const side of [-1, 1]) {
  assert.ok(Array.from({ length: browPositions.count }, (_, i) => i).some(i =>
    side * browPositions.getX(i) > .3 && browPositions.getY(i) > .1 && browPositions.getZ(i) < .16),
  "capsule brow ends must sweep back toward the temples, not remain a straight plank");
}
browFighter.dispose();
const straightBrowSource = playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")
  .replace(/    let browGeometry;[\s\S]*?    brow.rotation.x = -.18;/,
    "    const brow = part(new THREE.BoxGeometry(.78, .1, .16), armor, 0, 2.27, .3);\n    brow.rotation.x = -.18;")
  .replace("    } else if (costumeVariant === 2) {", "    } else if (costumeVariant === 2) {\n      brow.scale.set(1.22, .7, 1.14);");
const StraightBrowFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${straightBrowSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
const browSources = [];
class TrackedBrowGeometry extends THREE.ExtrudeGeometry {
  constructor(...args) {
    super(...args);
    const record = { disposed: 0 }; browSources.push(record);
    this.addEventListener("dispose", () => record.disposed++);
  }
}
const TrackedBrowFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${playerMergeSource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "")}; return Fighter;`)(
  { ...THREE, ExtrudeGeometry: TrackedBrowGeometry }, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
for (const variant of [0, 1, 3, 2]) {
  const fighter = new TrackedBrowFighter(scene, { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
  assert.deepEqual(browSources.map(source => source.disposed), variant === 2 ? [1] : [], "only capsule creates an extrusion and merge disposes that owned source exactly once");
  fighter.dispose();
  assert.deepEqual(browSources.map(source => source.disposed), variant === 2 ? [1] : [], "fighter teardown owns the merged geometry, not its already-disposed source");
}
for (let variant = 0; variant < 4; variant++) {
  const config = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const fighter = new Fighter(scene, config, ["blaster"], new THREE.Vector3());
  const before = new StraightBrowFighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  if (variant !== 2) assert.deepEqual(mergedFighterSnapshot(fighter), mergedFighterSnapshot(before), "non-capsule brow geometry and materials remain byte-identical");
  else {
    const head = fighter.helmet.getObjectByName("Helmet brow and crest"), oldHead = before.helmet.getObjectByName("Helmet brow and crest");
    assert.deepEqual(mergedFighterSnapshot(fighter, new Set([head])), mergedFighterSnapshot(before, new Set([oldHead])), "only capsule brow changes, not visor/socket/ears/weapons/body");
    assert.equal(head.material, fighter.armorMaterial);
    assert.deepEqual(head.matrix.elements, oldHead.matrix.elements);
    for (const name of ["position", "normal", "uv"]) {
      const current = head.geometry.attributes[name], old = oldHead.geometry.attributes[name];
      assert.equal(current.count, old.count - 48, "swept brow uses 92 triangles instead of 108, in the same existing mesh");
      assert.deepEqual(current.array.slice(276 * current.itemSize), old.array.slice(324 * old.itemSize), "crest buffers remain untouched");
      assert.ok([...current.array].every(Number.isFinite));
    }
    assert.deepEqual(new THREE.Box3().setFromObject(fighter.group), new THREE.Box3().setFromObject(before.group), "swept brow does not enlarge complete fighter bounds");
    const positions = head.geometry.attributes.position, normals = head.geometry.attributes.normal, edges = new Map();
    const key = point => point.toArray().map(value => value.toFixed(6)).join(",");
    for (let i = 0; i < 276; i += 3) {
      const [a, b, c] = [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(positions, i + corner));
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      assert.ok(normal.length() > 1e-8, "beveled brow has no degenerate triangles");
      normal.normalize();
      for (const [corner, point] of [a, b, c].entries()) {
        const stored = new THREE.Vector3().fromBufferAttribute(normals, i + corner);
        assert.ok(Math.abs(stored.length() - 1) < 1e-6 && stored.dot(normal) > .99999, "bevel normals agree with outward triangle winding");
        assert.ok(Math.abs(point.x) < .4758 && point.y < .241 && point.z < .399, "brow stays within its old upper/front/width silhouette");
        assert.ok(point.z < .4, "brow remains behind the nearest lens surface at z.4515");
      }
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const ka = key(start), kb = key(end), edgeKey = [ka, kb].sort().join("|");
        const edge = edges.get(edgeKey) || { count: 0, winding: 0 };
        edge.count++; edge.winding += ka < kb ? 1 : -1; edges.set(edgeKey, edge);
      }
    }
    assert.ok([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0), "swept brow is a closed consistently wound solid");
  }
  fighter.dispose(); before.dispose();
}
const posedHand = new THREE.Vector3(), posedGrip = new THREE.Vector3();
const wristAxis = new THREE.Vector3(), wristNormal = new THREE.Vector3(), barrelNormal = new THREE.Vector3();
for (const weaponId of ["blaster", "rocket_launcher", "machine_gun"]) for (const release of ["reload", "grapple"]) {
  const fighter = new Fighter(scene, { id: "transition-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weaponId], new THREE.Vector3());
  for (let frame = 0; frame < 60; frame++) {
    fighter.reloadTimer = release === "reload" ? 1 : 0;
    fighter.grapple = release === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
  }
  fighter.group.updateMatrixWorld(true);
  const rigInverse = fighter.rig.matrixWorld.clone().invert();
  const previousPalm = new THREE.Vector3(0, -.58, .05).applyMatrix4(fighter.leftForearm.matrixWorld).applyMatrix4(rigInverse);
  const localPalm = new THREE.Vector3();
  fighter.reloadTimer = 0; fighter.grapple = null;
  for (let frame = 0; frame < 24; frame++) {
    fighter.update(1 / 60, noMovement, new THREE.Vector3(0, 0, -1), {}, poseWorld);
    fighter.group.updateMatrixWorld(true);
    posedHand.set(0, -.58, .05).applyMatrix4(fighter.leftForearm.matrixWorld);
    // Isolate joint return from the existing grapple-release body roll/movement.
    rigInverse.copy(fighter.rig.matrixWorld).invert();
    localPalm.copy(posedHand).applyMatrix4(rigInverse);
    const jump = localPalm.distanceTo(previousPalm);
    assert.ok(jump < .2, `${weaponId}/${release}/${frame}: support-hand jump ${jump.toFixed(3)}m`);
    previousPalm.copy(localPalm);
  }
  posedGrip.copy(fighter.weaponSupportGrip).applyMatrix4(fighter.weaponGroup.matrixWorld);
  assert.ok(posedHand.distanceTo(posedGrip) < .03, "support hand returns exactly to the grip after its release transition");
  fighter.dispose();
}
for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: "pose-qa", name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  for (const pitch of [-.9, 0, .9]) for (const pose of ["aim", "fire", "reload", "grapple"]) {
    poseLook.set(0, Math.sin(pitch), -Math.cos(pitch));
    fighter.grapple = pose === "grapple" ? { anchor: new THREE.Vector3(-4, 9, 8), wraps: [] } : null;
    for (let frame = 0; frame < 24; frame++) {
      fighter.reloadTimer = pose === "reload" ? 1 : 0;
      fighter.recoilVisual = pose === "fire" ? .9 : 0;
      fighter.attackTimer = pose === "fire" ? weapon.cooldown * .75 : 0;
      fighter.update(1 / 60, noMovement, poseLook, {}, poseWorld);
    }
    fighter.group.updateMatrixWorld(true);
    const hands = [[fighter.rightArm, fighter.rightForearm, fighter.weaponGrip]];
    if (fighter.weaponHasSupportGrip && pose !== "reload" && pose !== "grapple") hands.push([fighter.leftArm, fighter.leftForearm, fighter.weaponSupportGrip]);
    for (const [upper, forearm, grip] of hands) {
      posedHand.set(0, -.58, .05).applyMatrix4(forearm.matrixWorld);
      posedGrip.copy(grip).applyMatrix4(fighter.weaponGroup.matrixWorld);
      const gap = posedHand.distanceTo(posedGrip);
      assert.ok(gap < .04, `${weapon.id}/${pitch}/${pose}: grip gap ${gap.toFixed(3)}m`);
      assert.deepEqual(forearm.position.toArray(), [0, -.55, 0], "joint solve never stretches a limb");
      assert.ok(Math.abs(upper.quaternion.length() - 1) < .000001);
      assert.ok(Math.abs(forearm.quaternion.length() - 1) < .000001);
      wristAxis.set(0, -.58, .05).transformDirection(forearm.matrixWorld);
      wristNormal.set(0, 0, 1).transformDirection(forearm.matrixWorld).projectOnPlane(wristAxis).normalize();
      barrelNormal.set(0, 0, 1).transformDirection(fighter.weaponGroup.matrixWorld).projectOnPlane(wristAxis).normalize();
      assert.ok(wristNormal.dot(barrelNormal) > .998, `${weapon.id}/${pitch}/${pose}: wrist follows the weapon instead of twisting across its grip`);
    }
  }
  fighter.dispose();
}
for (const variant of [0, 1, 2, 3]) for (const weapon of Object.values(WEAPONS)) {
  const fighter = new Fighter(scene, { id: `graphics-qa-${variant}`, name: "QA", color: 0x129dba, accent: 0x6ff6ff }, [weapon.id], new THREE.Vector3());
  assertCompatibleAONormals(fighter.group);
  assert.equal(fighter.visor.name, "Segmented inset visor");
  assert.equal(fighter.helmet.name, "Helmet and recessed visor housing");
  assert.ok(fighter.helmet.material === fighter.darkMaterial, "housing uses the existing dark batch material");
  fighter.visor.geometry.computeBoundingBox();
  assert.ok(fighter.visor.geometry.boundingBox.max.x < .33);
  assert.ok(fighter.visor.geometry.boundingBox.max.y < .05, "lens is smaller than its surrounding frame");
  assert.ok(fighter.visor.geometry.boundingBox.max.z + fighter.visor.position.z < .5, "lens sits behind housing front");
  assert.ok(fighter.accentMaterial.emissiveIntensity < 1, "idle armor keeps chroma and highlight detail");
  assert.ok(fighter.weaponGlowMaterial.emissiveIntensity < 1, "idle weapon casing is not a clipped light source");
  fighter.group.traverse(object => {
    if (!object.geometry) return;
    assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite), `${weapon.id}: finite authored geometry`);
  });
  fighter.dispose();
}
// The narrow capsule shell used to end before the common visor frame began.
// Probe the actual merged geometry from both sides, not an analytic capsule.
const socketFighter = new Fighter(scene, { id: "helmet-2", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const socketHead = new THREE.Mesh(socketFighter.helmet.geometry, socketFighter.darkMaterial);
socketHead.updateMatrixWorld(true);
const socketRay = new THREE.Raycaster();
for (const side of [-1, 1]) for (const y of [-.04, .02, .08]) for (const z of [.35, .37, .39]) {
  socketRay.set(new THREE.Vector3(side * 2, y, z), new THREE.Vector3(-side, 0, 0));
  assert.ok(socketRay.intersectObject(socketHead, false).length > 0, `capsule visor backing must close the side gap at ${side}/${y}/${z}`);
}
for (const side of [-1, 1]) for (const x of [-.22, 0, .22]) for (const z of [.35, .37, .39]) {
  socketRay.set(new THREE.Vector3(x, side * 2, z), new THREE.Vector3(0, -side, 0));
  assert.ok(socketRay.intersectObject(socketHead, false).length > 0, "the backing also closes the upper and lower gap");
}
for (const side of [-1, 1]) for (const y of [-.05, 0, .05]) for (const x of [.39, .41, .423]) {
  socketRay.set(new THREE.Vector3(side * x, y, 2), new THREE.Vector3(0, 0, -1));
  assert.ok(socketRay.intersectObject(socketHead, false).length > 0, "capsule ear mounts must bridge shell to existing ear caps");
}
socketFighter.dispose();

const socketStart = playerMergeSource.indexOf("    // Close the capsule's shell-to-frame gap");
const socketEnd = playerMergeSource.indexOf("    const helmetAssembly", socketStart);
assert.ok(socketStart >= 0 && socketEnd > socketStart);
const withoutSocketSource = (playerMergeSource.slice(0, socketStart) + playerMergeSource.slice(socketEnd))
  .replace(/^import .*;\r?\n/gm, "").replaceAll("export ", "");
const WithoutSocketFighter = new Function("THREE", "mergeGeometries", "RoundedBoxGeometry", "weaponUsesAmmo", "WEAPONS", "weaponPresentation",
  `${withoutSocketSource}; return Fighter;`)(THREE, mergeGeometries, RoundedBoxGeometry, weaponUsesAmmo, WEAPONS, weaponPresentation);
for (let variant = 0; variant < 4; variant++) {
  const config = { id: `helmet-${variant}`, color: 0x129dba, accent: 0x6ff6ff };
  const fighter = new Fighter(scene, config, ["blaster"], new THREE.Vector3());
  const before = new WithoutSocketFighter(new THREE.Scene(), config, ["blaster"], new THREE.Vector3());
  if (variant !== 2) assert.deepEqual(mergedFighterSnapshot(fighter), mergedFighterSnapshot(before), "other helmet variants remain byte-identical");
  else {
    // Reassemble the two actual buffers for the existing shell/hardware contact checks.
    const headGeometry = mergeGeometries([fighter.helmetShell.geometry, fighter.helmet.geometry], false);
    const oldHeadGeometry = mergeGeometries([before.helmetShell.geometry, before.helmet.geometry], false);
    assert.deepEqual(mergedFighterSnapshot(fighter, new Set([fighter.helmet])), mergedFighterSnapshot(before, new Set([before.helmet])),
      "only the capsule housing changes; lens, pivot, armor, weapons and materials stay intact");
    const added = {};
    for (const name of ["position", "normal", "uv"]) {
      const current = headGeometry.attributes[name], old = oldHeadGeometry.attributes[name];
      assert.equal(current.count - old.count, 228, "socket and two closed eight-sided ear mounts add exactly 76 triangles and no draw");
      assert.deepEqual(current.array.slice(0, old.array.length), old.array, "existing shell and frame buffers stay byte-identical");
      added[name] = new THREE.BufferAttribute(current.array.slice(old.array.length), current.itemSize);
    }
    for (const fighterGeometry of [headGeometry, oldHeadGeometry]) {
      fighterGeometry.computeBoundingBox(); fighterGeometry.computeBoundingSphere();
    }
    assert.deepEqual(new THREE.Box3().setFromObject(fighter.group), new THREE.Box3().setFromObject(before.group), "mounts stay inside the existing complete fighter bounds");
    const headBounds = headGeometry.boundingBox, oldBounds = oldHeadGeometry.boundingBox;
    assert.ok(Math.abs(headBounds.max.x - .44) < 1e-7 && Math.abs(headBounds.min.x + .44) < 1e-7, "head culling bounds include both mounts");
    for (const axis of ["y", "z"]) { assert.equal(headBounds.min[axis], oldBounds.min[axis]); assert.equal(headBounds.max[axis], oldBounds.max[axis]); }
    assert.deepEqual(headGeometry.boundingSphere, oldHeadGeometry.boundingSphere);
    const vertices = Array.from({ length: 36 }, (_, i) => new THREE.Vector3().fromBufferAttribute(added.position, i));
    const edges = new Map(), center = new THREE.Vector3(0, .02, (.13 + .405) / 2);
    const pointKey = point => point.toArray().map(value => value.toFixed(6)).join(",");
    for (let i = 0; i < vertices.length; i += 3) {
      const [a, b, c] = vertices.slice(i, i + 3), normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      assert.ok(normal.dot(a.clone().add(b).add(c).divideScalar(3).sub(center)) > 0, "each face winds outward");
      for (let corner = 0; corner < 3; corner++) {
        const stored = new THREE.Vector3().fromBufferAttribute(added.normal, i + corner);
        assert.ok(stored.distanceTo(normal) < 1e-6, "deformed box retains correct hard face normals");
      }
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const ka = pointKey(start), kb = pointKey(end), key = [ka, kb].sort().join("|");
        const entry = edges.get(key) || { count: 0, winding: 0 };
        entry.count++; entry.winding += ka < kb ? 1 : -1; edges.set(key, entry);
      }
    }
    assert.ok([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0), "backing is closed with no missing face or duplicate triangle");
    assert.ok([...added.uv.array].every(value => value >= 0 && value <= 1));
    fighter.visor.geometry.computeBoundingBox();
    const front = Math.max(...vertices.map(point => point.z));
    assert.ok(fighter.visor.position.z + fighter.visor.geometry.boundingBox.min.z - front > .0464, "backing stays behind every lens");
    const oldHead = new THREE.Mesh(oldHeadGeometry, before.darkMaterial); oldHead.updateMatrixWorld(true);
    for (const vertex of vertices.filter(point => point.z < .14)) for (const side of [-1, 1]) {
      socketRay.set(new THREE.Vector3(side * 2, vertex.y, vertex.z), new THREE.Vector3(-side, 0, 0));
      const hit = socketRay.intersectObject(oldHead, false)[0];
      assert.ok(hit && side * hit.point.x > Math.abs(vertex.x) + .005, "each rear corner overlaps the actual faceted capsule shell");
    }
    for (let i = 36; i < added.position.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(added.position, i);
      assert.ok(Math.abs(Math.abs(vertex.x) - .25) < 1e-7 || Math.abs(Math.abs(vertex.x) - .44) < 1e-7, "closed mounts run from inside shell into the ear caps");
      if (Math.abs(vertex.x) < .3) {
        // CapsuleGeometry's duplicated angular seam can miss rays at z ~= -1e-17.
        // Probe both sides of that numerical seam; retain the full 5 mm overlap margin.
        for (const z of Math.abs(vertex.z) < 1e-8 ? [-1e-8, 1e-8] : [vertex.z]) {
          socketRay.set(new THREE.Vector3(Math.sign(vertex.x) * 2, vertex.y, z), new THREE.Vector3(-Math.sign(vertex.x), 0, 0));
          const hit = socketRay.intersectObject(oldHead, false)[0];
          assert.ok(hit && Math.abs(hit.point.x) > Math.abs(vertex.x) + .005, `inner mount vertex ${i} must overlap the actual shell`);
        }
      } else {
        assert.ok(Math.hypot(vertex.y, vertex.z) < .12 * Math.cos(Math.PI / 8), "outer mount stays inside the existing ear disc at every pitch");
        assert.ok(Math.abs(vertex.x) > .425 && Math.abs(vertex.x) < .515, "outer mount overlaps the unchanged ear cap depth");
      }
    }
    headGeometry.dispose(); oldHeadGeometry.dispose();
  }
  fighter.dispose(); before.dispose();
}
const outsideSprite = new THREE.Sprite();
for (const batch of world.destructibleBatches) {
  assert.ok(batch.material.map === world.coverTextures[0] && batch.material.normalMap === world.coverTextures[1] && batch.material.roughnessMap === world.coverTextures[2], "cover batches share one dedicated matched surface atlas");
  assert.ok(batch.material.map !== world.panelTexture, "cover tuning cannot alter pillar and deck textures");
  batch.geometry.computeBoundingBox();
  assert.deepEqual(batch.geometry.boundingBox.min.toArray(), [-.5, -.5, -.5]);
  assert.deepEqual(batch.geometry.boundingBox.max.toArray(), [.5, .5, .5]);
  assert.equal(batch.geometry.attributes.position.count / 3, 60, "cover uses four planar mitered rim sections and one panel per face");
  assert.ok(Math.abs(Math.max(...batch.geometry.attributes.uv.array) - .23625) < 1e-6, "infill retains its .25 UV cadence inside the 5.5% frame");
  assert.equal(batch.material.vertexColors, true, "cover perimeter retains its machined dark frame");
  const colors = batch.geometry.attributes.color;
  for (let i = 0; i < colors.count; i += 3) for (const axis of ["getX", "getY", "getZ"]) {
    assert.equal(colors[axis](i), colors[axis](i + 1));
    assert.equal(colors[axis](i), colors[axis](i + 2), "each face triangle has a crisp frame/infill boundary");
  }
  const uv = batch.geometry.attributes.uv, normal = batch.geometry.attributes.normal;
  for (let i = 0; i < colors.count; i += 6) for (const axis of ["getX", "getY", "getZ"]) {
    assert.ok(Math.abs(normal[axis](i) - normal[axis](i + 3)) < 1e-6, "each mitered frame quad is planar, without triangular corner patches");
  }
  for (let i = 0; i < colors.count; i += 3) {
    const area = (uv.getX(i + 1) - uv.getX(i)) * (uv.getY(i + 2) - uv.getY(i)) - (uv.getY(i + 1) - uv.getY(i)) * (uv.getX(i + 2) - uv.getX(i));
    assert.ok(Math.abs(area) > 1e-10, "frame sampling keeps a valid tangent basis");
    for (const axis of ["getX", "getY", "getZ"]) {
      assert.equal(normal[axis](i), normal[axis](i + 1));
      assert.equal(normal[axis](i), normal[axis](i + 2), "split frame faces have geometric bevel normals");
    }
  }
}
scene.add(outsideSprite);
let sharedSpriteDisposals = 0;
const onSharedSpriteDispose = () => sharedSpriteDisposals++;
outsideSprite.geometry.addEventListener("dispose", onSharedSpriteDispose);
for (const arena of [world, new ArenaWorld(scene, "RESET-2"), new ArenaWorld(scene, "RESET-3")]) {
  let spriteMaterialsDisposed = 0, ownedGeometryDisposed = 0;
  const boostDisposals = new Map(arena.boostPads.flatMap(pad => [pad.mesh, ...pad.mesh.children])
    .flatMap(mesh => [mesh.geometry, mesh.material]).map(resource => [resource, 0]));
  for (const resource of boostDisposals.keys()) resource.addEventListener("dispose", () => boostDisposals.set(resource, boostDisposals.get(resource) + 1));
  const coverDisposals = new Map([...arena.coverTextures, arena.coverLightMask].map(texture => [texture, 0]));
  for (const texture of coverDisposals.keys()) texture.addEventListener("dispose", () => coverDisposals.set(texture, coverDisposals.get(texture) + 1));
  arena.group.traverse(object => {
    if (object.isSprite) object.material.addEventListener("dispose", () => spriteMaterialsDisposed++);
    else if (object.geometry) object.geometry.addEventListener("dispose", () => ownedGeometryDisposed++);
  });
  const victim = arena.destructibles[0], neighbor = arena.destructibles.at(-1);
  const secondVictim = arena.destructibles.find(item => item !== victim && item !== neighbor && arena.districtIndexAt(item.x, item.z) === arena.districtIndexAt(victim.x, victim.z));
  const removedCases = arena.seed === "RESET-3" ? [] : [victim, secondVictim];
  const detachedResources = new Map();
  for (const removed of removedCases) removed.mesh.traverse(object => {
    for (const resource of [object.geometry, ...[].concat(object.material || [])].filter(Boolean)) detachedResources.set(resource, 0);
  });
  for (const resource of detachedResources.keys()) resource.addEventListener("dispose", () => detachedResources.set(resource, detachedResources.get(resource) + 1));
  for (const removed of removedCases) {
    const point = new THREE.Vector3(removed.x, removed.baseY + removed.h / 2, removed.z), eventId = `cover-disposal-${removed.x}-${removed.z}`;
    arena.destroy(point, .001, { eventId, structuralDamage: .01 });
    arena.destroy(point, .001, { eventId, structuralDamage: .01 });
  }
  for (const removed of removedCases) assert.equal(removed.mesh.parent, null);
  assert.equal(arena.detachedDestructibleMeshes.length, removedCases.length, "duplicate destruction cannot enqueue a detached cover twice");
  assert.ok(neighbor.mesh.parent === arena.group && arena.destructibles.includes(neighbor), "removing one cover cannot remove its neighbor");
  assert.ok([...detachedResources.values()].every(count => count === 0), "shared resources remain valid for surviving covers until world teardown");
  arena.dispose();
  assert.equal(arena.detachedDestructibleMeshes.length, 0, "teardown releases its detached-root references");
  assert.ok([...detachedResources.values()].every(count => count === 1), "destroyed cover buffers and shared materials still dispose exactly once at teardown");
  assert.ok([...boostDisposals.values()].every(count => count === 1), "all boost geometry and materials dispose exactly once, including shared route marks");
  assert.ok([...coverDisposals.values()].every(count => count === 1), "shared cover textures dispose exactly once per arena");
  assert.ok(scene.backgroundNode === arena.previousBackgroundNode, "teardown restores the previous sky expression without disposing Three's owned sky mesh");
  assert.equal(sharedSpriteDisposals, 0, "arena teardown must not destroy Three's shared Sprite quad used by the next arena");
  assert.ok(spriteMaterialsDisposed > 0, "owned sprite materials are still released");
  assert.ok(ownedGeometryDisposed > 0, "owned arena geometry is still released");
  assert.ok(!scene.children.includes(arena.group));
}
outsideSprite.geometry.removeEventListener("dispose", onSharedSpriteDispose);
scene.remove(outsideSprite); outsideSprite.material.dispose();
console.log("Graphics profiles, mip chains, texture color spaces, unchanged structures and all 47 authored weapons passed.");
