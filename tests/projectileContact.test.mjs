import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";

const box = { x: 0, z: 0, w: 4, d: 6, baseY: 4, top: 10 };
const world = { size: 112, height: 92, collisionDirection: new THREE.Vector3(), collisionBox: new THREE.Box3(),
  collisionHit: new THREE.Vector3(), collisionRay: new THREE.Ray(), nearbyObstacles: () => [box] };
const contact = (from, to, radius = .11) => ArenaWorld.prototype.projectileContact.call(world, new THREE.Vector3(...from), new THREE.Vector3(...to), radius);
assert.equal(typeof ArenaWorld.prototype.projectileContact, "function", "wall presentation needs an actual swept contact query");
for (const [from, to, normal, point] of [
  [[-4,7,0],[-1.8,7,0],[-1,0,0],[-2,7,0]], [[4,7,0],[1.8,7,0],[1,0,0],[2,7,0]],
  [[0,2,0],[0,4.2,0],[0,-1,0],[0,4,0]], [[0,12,0],[0,9.8,0],[0,1,0],[0,10,0]],
  [[0,7,-5],[0,7,-2.8],[0,0,-1],[0,7,-3]], [[0,7,5],[0,7,2.8],[0,0,1],[0,7,3]]
]) {
  const result = contact(from, to);
  assert.deepEqual(result.normal.toArray(), normal); assert.ok(result.point.distanceTo(new THREE.Vector3(...point)) < 1e-9);
}
// Radius-only contact: center has not crossed the actual surface yet.
for (const [from, to, normal, point] of [
  [[-2.125,7,0],[-2,7,0],[-1,0,0],[-2,7,0]], [[2.125,7,0],[2,7,0],[1,0,0],[2,7,0]],
  [[0,3.875,0],[0,4,0],[0,-1,0],[0,4,0]], [[0,10.125,0],[0,10,0],[0,1,0],[0,10,0]],
  [[0,7,-3.125],[0,7,-3],[0,0,-1],[0,7,-3]], [[0,7,3.125],[0,7,3],[0,0,1],[0,7,3]]
]) {
  assert.equal(ArenaWorld.prototype.projectileHit.call(world,new THREE.Vector3(...from),.125),false);
  assert.equal(ArenaWorld.prototype.projectileHit.call(world,new THREE.Vector3(...to),.125),true);
  const result = contact(from,to,.125);
  assert.ok(result,"a free center exactly on an expanded face has a valid inward entry");
  assert.deepEqual(result.normal.toArray(),normal); assert.ok(result.point.distanceTo(new THREE.Vector3(...point))<1e-9);
  assert.equal(contact(from,from.map((value,i)=>value+normal[i]*.5),.125),null,"all six boundary exits are not entries");
}
for (const invalid of [NaN, Infinity, -Infinity]) {
  assert.equal(contact([0,1,0],[invalid,-1,0]),null,"nonfinite segments cannot emit nonfinite VFX contacts");
  assert.equal(contact([invalid,1,0],[0,-1,0]),null);
}
assert.ok(contact([-3,7,0],[-2.05,7,0]).point.distanceTo(new THREE.Vector3(-2,7,0)) < 1e-9);
const diagonal = contact([-3,7,0],[-1.8,7,1.2]);
assert.ok(diagonal.point.distanceTo(new THREE.Vector3(-2,7,.89)) < 1e-9);
assert.deepEqual(diagonal.normal.toArray(), [-1,0,0]);
const corner = contact([-3,7,-4],[-1.9,7,-2.9]);
assert.deepEqual(corner.normal.toArray(), [-1,0,0], "equal-distance corner faces use stable X/Y/Z order");
assert.ok(corner.point.distanceTo(new THREE.Vector3(-2,7,-3)) < 1e-9);
assert.equal(contact([-4,7,0],[-3,7,0]), null, "no contact beyond this finite movement segment");
assert.equal(contact([-3,7,0],[-3,7,0]), null, "zero movement has no inferred surface entry");
assert.equal(contact([0,7,0],[.1,7,0]), null, "starting overlapped does not invent a valid entry face");
for (const [from,to,second,point,normal] of [
  [[-2.125,7,0],[-3,7,0],{x:-3,z:0,w:.4,d:.4},[-2.8,7,0],[1,0,0]],
  [[-2.125,7,-3.125],[-3,7,-4],{x:-3,z:-4,w:.4,d:.4},[-2.8,7,-3.8],[1,0,0]],
  [[-2.125,7,-3.125],[-2,7,-4],{x:-2,z:-4,w:.4,d:.4},[-2.0464285714285713,7,-3.8],[0,0,1]],
  [[-2.125,7,0],[-2.125,7,4],{x:-2.125,z:4,w:.4,d:.4},[-2.125,7,3.8],[0,0,-1]]
]) {
  world.nearbyObstacles = () => [box];
  assert.equal(contact(from,to,.125),null,"without the second collider exits/grazes have no contact");
  for (const obstacles of [[box,{...box,...second}],[{...box,...second},box]]) {
    world.nearbyObstacles = () => obstacles;
    assert.equal(ArenaWorld.prototype.projectileHit.call(world,new THREE.Vector3(...from),.125),false);
    assert.equal(ArenaWorld.prototype.projectileHit.call(world,new THREE.Vector3(...to),.125),true);
    const result=contact(from,to,.125);
    assert.ok(result.point.distanceTo(new THREE.Vector3(...point))<1e-9,`boundary exit/graze ${from}: actual ${result.point.toArray()}, expected ${point}`);
    assert.deepEqual(result.normal.toArray(),normal);
  }
}
world.nearbyObstacles = () => [box];
assert.deepEqual(contact([-2.125,7,-3.125],[-2,7,-3],.125).normal.toArray(),[-1,0,0],"inward corner entries remain valid");
world.nearbyObstacles = () => [{ ...box, x: 10 }, box];
assert.ok(contact([-4,7,0],[12,7,0]).point.distanceTo(new THREE.Vector3(-2,7,0)) < 1e-9, "nearest entry wins independently of grid order");
world.nearbyObstacles = () => [];
for (const [from,to,normal,point] of [
  [[0,1,0],[0,-.1,0],[0,1,0],[0,0,0]], [[0,109,0],[0,111,0],[0,-1,0],[0,110,0]],
  [[111,7,0],[113,7,0],[-1,0,0],[112,7,0]], [[-111,7,0],[-113,7,0],[1,0,0],[-112,7,0]],
  [[0,7,111],[0,7,113],[0,0,-1],[0,7,112]], [[0,7,-111],[0,7,-113],[0,0,1],[0,7,-112]]
]) {
  const result = contact(from,to);
  assert.deepEqual(result.normal.toArray(),normal); assert.deepEqual(result.point.toArray(),point);
}
world.nearbyObstacles = () => [box];
const a = contact([-3,7,0],[-1.8,7,0]), saved = a.point.toArray();
contact([3,7,0],[1.8,7,0]); assert.deepEqual(a.point.toArray(),saved,"returned contact does not alias shared collision scratch");
for (let i=0;i<200;i++) {
  const previous = new THREE.Vector3(-4,4+i*.02,-2), position = new THREE.Vector3(-2.3+i*.003,4+i*.02,-2+i*.006);
  const from = previous.toArray(), to = position.toArray(), before = ArenaWorld.prototype.projectileHit.call(world,position,.11);
  ArenaWorld.prototype.projectileContact.call(world,previous,position,.11);
  assert.deepEqual(previous.toArray(),from); assert.deepEqual(position.toArray(),to);
  assert.equal(ArenaWorld.prototype.projectileHit.call(world,position,.11),before,"presentation query does not mutate collision inputs or decisions");
}
console.log("Swept presentation contact: all faces, radius-only hits, diagonals, nearest entry, boundaries and safe fallbacks passed.");
