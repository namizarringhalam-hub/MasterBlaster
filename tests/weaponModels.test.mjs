import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { Fighter } from "../src/player.js";
import { WEAPONS } from "../src/gameData.js";

// Appearance changes retain the firing and hand-placement contracts of the
// existing arsenal. These values are independent of the new mesh topology.
const muzzles = Object.fromEntries([
  [.55, ["mine", "remote_explosive"]],
  [1.05, ["punch_glove"]], [1.12, ["fireball"]],
  [1.17, ["machine_gun", "minigun"]], [1.18, ["boomerang_blade"]],
  [1.19, ["shotgun"]],
  [1.21, ["plasma_cannon", "pulse_cannon", "black_hole_generator", "tornado_generator", "grapple_disrupting_pulse"]],
  [1.28, ["rocket_launcher", "napalm_launcher", "drill_missile"]],
  [1.31, ["laser_beam", "arc_lightning", "gravity_beam", "disintegration_weapon"]],
  [1.38, ["mortar"]], [1.42, ["railgun", "charged_energy_rifle"]],
  [1.52, ["flamethrower"]], [1.72, ["hammer"]], [1.88, ["chainsaw"]],
  [1.7340000000000002, ["energy_sword"]], [3.0749999999999997, ["spear"]],
  [1.3911428571428575, ["shock_baton"]], [1.0105714285714287, ["knife"]]
].flatMap(([distance, ids]) => ids.map(id => [id, distance])));
const grips = {
  mine: [.04, -.08, .2], remote_explosive: [.04, -.08, .2],
  fireball: [.05, -.04, .28], boomerang_blade: [.05, -.04, .28],
  flamethrower: [.05, -.15, .13], hammer: [.06, .04, .18], chainsaw: [.06, -.07, .15]
};
const spinners = new Set(["minigun", "chainsaw", "boomerang_blade"]);
const magazines = new Set(["machine_gun", "minigun", "submachine_gun", "grenade_launcher", "cluster_grenade",
  "sticky_launcher", "bouncing_bomb", "implosion_bomb", "gravity_grenade"]);
const unsupported = new Set(["mine", "remote_explosive", "fireball", "boomerang_blade", "energy_sword",
  "spear", "punch_glove", "shock_baton", "knife"]);
const world = { resolve(position) { const grounded = position.y <= 0; if (grounded) position.y = 0; return { grounded }; }, boostAt: () => null };
const still = new THREE.Vector3(), look = new THREE.Vector3(0, 0, 1);
let maxTriangles = 0, maxDraws = 0;

for (const [id, weapon] of Object.entries(WEAPONS)) {
  const fighter = new Fighter(new THREE.Scene(), { id: "weapon-model-qa", color: 0x129dba, accent: 0x6ff6ff },
    [id, id === "blaster" ? "shotgun" : "blaster"], new THREE.Vector3());
  assert.equal(fighter.weaponMuzzleDistance, muzzles[id] ?? 1.08, `${id}: logical firing origin is preserved`);
  assert.deepEqual(fighter.weaponGrip.toArray(), grips[id] ?? (weapon.type === "melee" ? [.06, -.01, .03] : [.05, -.2, .11]), `${id}: dominant-hand anchor`);
  assert.deepEqual(fighter.weaponSupportGrip.toArray(), id === "hammer" ? [-.055, .04, .12] : id === "chainsaw" ? [-.18, -.04, .2] : [-.14, -.1, .32], `${id}: support-hand anchor`);
  assert.equal(fighter.weaponHasSupportGrip, !unsupported.has(id), `${id}: existing hand pose is preserved`);
  assert.equal(Boolean(fighter.weaponSpinner), spinners.has(id), `${id}: spinning mechanism remains animated`);
  assert.equal(Boolean(fighter.weaponPiston), id === "punch_glove", `${id}: piston remains animated`);
  assert.equal(Boolean(fighter.weaponMagazine), magazines.has(id), `${id}: magazine remains animated`);

  const resources = new Set(), materials = new Set();
  let meshes = 0, triangles = 0, draws = 0;
  fighter.weaponGroup.traverse(object => {
    if (!object.isMesh) return;
    meshes++; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    draws += Array.isArray(object.material) ? object.geometry.groups.length || 1 : 1;
    if (!object.geometry.userData.sharedFighterGeometry) resources.add(object.geometry);
    for (const material of [object.material].flat()) { materials.add(material); resources.add(material); }
    for (const attribute of Object.values(object.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), `${id}: finite vertex data`);
    object.geometry.computeBoundingSphere();
    assert.ok(Number.isFinite(object.geometry.boundingSphere.radius), `${id}: finite culling bounds`);
    assert.equal(object.castShadow, false, `${id}: weapon detail retains the bounded fighter shadow proxy`);
  });
  assert.ok(meshes > 0 && meshes <= 5, `${id}: bounded weapon renderables (${meshes})`);
  assert.ok(materials.size >= 3 && materials.size <= 6, `${id}: bounded material palette (${materials.size})`);
  assert.ok(materials.has(fighter.weaponGlowMaterial), `${id}: firing and charge feedback reaches visible geometry`);
  assert.ok(triangles >= 80 && triangles <= 4000, `${id}: bounded weapon geometry (${triangles})`);
  assert.ok(draws <= 16, `${id}: bounded material draws (${draws})`);
  maxTriangles = Math.max(maxTriangles, triangles); maxDraws = Math.max(maxDraws, draws);
  const disposed = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener("dispose", () => disposed.set(resource, disposed.get(resource) + 1));

  const refs = [fighter.weaponSpinner, fighter.weaponPiston, fighter.weaponMagazine];
  const spinnerRotation = fighter.weaponSpinner?.quaternion.clone(), pistonPosition = fighter.weaponPiston?.position.clone();
  const magazinePosition = fighter.weaponMagazine?.position.clone(), magazineRotation = fighter.weaponMagazine?.rotation.clone();
  const visibleMeshes = [];
  fighter.weaponGroup.traverse(object => { if (object.isMesh) visibleMeshes.push(object); });
  fighter.attackTimer = weapon.cooldown * .9;
  if (fighter.weaponMagazine) { fighter.ammo[id] = 0; fighter.reload(); fighter.reloadTimer = weapon.reload * .5; }
  fighter.update(1 / 120, still, look, {}, world);
  if (fighter.weaponSpinner) assert.ok(fighter.weaponSpinner.quaternion.angleTo(spinnerRotation) > .001, `${id}: spinning parts survive batching`);
  if (fighter.weaponPiston) assert.ok(fighter.weaponPiston.position.z > pistonPosition.z, `${id}: piston survives batching`);
  if (fighter.weaponMagazine) assert.ok(fighter.weaponMagazine.position.y < magazinePosition.y - .25, `${id}: reload mechanism survives batching`);
  const muzzle = fighter.muzzlePoint();
  fighter.switchSlot(1);
  assert.ok(visibleMeshes.every(mesh => !fighter.weaponGroup.getObjectById(mesh.id)), `${id}: inactive geometry is detached from the visible weapon`);
  assert.ok([...disposed.values()].every(count => count === 0), `${id}: switching preserves cached resources`);
  fighter.switchSlot(0);
  assert.ok(refs.every((ref, index) => ref === [fighter.weaponSpinner, fighter.weaponPiston, fighter.weaponMagazine][index]), `${id}: switching restores animation references`);
  assert.ok(visibleMeshes.every(mesh => fighter.weaponGroup.getObjectById(mesh.id)), `${id}: cached mesh identity is retained`);
  if (spinnerRotation) assert.ok(fighter.weaponSpinner.quaternion.equals(spinnerRotation), `${id}: spinning rest pose is restored`);
  if (pistonPosition) assert.ok(fighter.weaponPiston.position.equals(pistonPosition), `${id}: piston rest pose is restored`);
  if (magazinePosition) {
    assert.ok(fighter.weaponMagazine.position.equals(magazinePosition), `${id}: magazine rest position is restored`);
    assert.ok(fighter.weaponMagazine.rotation.equals(magazineRotation), `${id}: magazine rest rotation is restored`);
  }
  assert.ok(fighter.muzzlePoint().equals(muzzle), `${id}: model switching never shifts the firing line`);
  fighter.dispose();
  assert.ok([...disposed.values()].every(count => count === 1), `${id}: cached and visible resources dispose exactly once`);
}

console.log(`All ${Object.keys(WEAPONS).length} weapon models preserve firing origins, hand anchors, animation caches and resource ownership (${maxTriangles} maximum triangles, ${maxDraws} maximum material draws).`);
