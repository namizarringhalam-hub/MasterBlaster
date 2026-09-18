import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { surfaceMaps } from "../src/surfaceTextures.js";
import { ArenaWorld } from "../src/world.js";
import { Fighter } from "../src/player.js";
import { createProjectileVisual } from "../src/combatVisuals.js";
import { WEAPONS } from "../src/gameData.js";

let checked = 0;
function check(root) {
  root.traverse(object => {
    for (const material of [object.material].flat().filter(Boolean)) {
      if (!material.isMeshStandardMaterial && !material.isMeshStandardNodeMaterial) continue;
      checked++;
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) {
        const map = material[key];
        assert.ok(map?.isTexture, `${object.name}/${material.type} needs ${key}`);
        assert.equal(map.colorSpace, key === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace);
        assert.ok(object.geometry.getAttribute(map.channel === 0 ? "uv" : `uv${map.channel}`), `${object.name}: ${key} UV channel`);
      }
      const p = object.geometry.attributes.position, uv = object.geometry.attributes.uv, indices = object.geometry.index;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i < (indices?.count ?? p.count); i += 3) {
        const [ia, ib, ic] = [0, 1, 2].map(k => indices ? indices.getX(i + k) : i + k);
        a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
        if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) continue;
        const area = (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) - (uv.getX(ic) - uv.getX(ia)) * (uv.getY(ib) - uv.getY(ia));
        assert.ok(Math.abs(area) > 1e-12, `${object.name}: collapsed texture UV triangle ${i / 3}`);
      }
    }
  });
}

const maps = surfaceMaps(), orm = maps.roughnessMap.image.data;
assert.equal(maps.roughnessMap, maps.metalnessMap);
assert.equal(maps.roughnessMap, maps.aoMap);
for (const channel of [0, 1, 2]) {
  const values = new Set();
  for (let i = channel; i < orm.length; i += 4) values.add(orm[i]);
  assert.ok(values.size > 1, "ORM channels contain surface detail, not constant placeholders");
}
assert.ok(orm[0] < orm[(64 * 256 + 64) * 4], "seams occlude more ambient light than plate centers");
const scene = new THREE.Scene(), world = new ArenaWorld(scene, "PBR-QA");
check(world.group);
const fighter = new Fighter(scene, { id: "pbr-qa", color: 0x129dba, accent: 0x6ff6ff }, Object.keys(WEAPONS), new THREE.Vector3());
for (let slot = 0; slot < Object.keys(WEAPONS).length; slot++) { fighter.switchSlot(slot); check(fighter.group); }
for (const weapon of Object.values(WEAPONS)) check(createProjectileVisual(weapon, fighter));
assert.ok(fighter.armorMaterial.roughnessNode && fighter.armorMaterial.metalnessNode);
fighter.dispose(); world.dispose();
assert.equal(surfaceMaps().map, maps.map, "shared detail textures survive arena/fighter disposal");
assert.ok(checked > 100);
console.log(`PBR maps, color spaces and UV coverage passed (${checked} material uses).`);
