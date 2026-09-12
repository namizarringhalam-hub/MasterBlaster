import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import * as data from "../src/gameData.js";
import { Fighter, PROJECTILE_SPAWN_OFFSET, aimWithSpread, projectileTouchesPlayer, cameraCollisionFirstPerson } from "../src/player.js";
import { ArenaWorld } from "../src/world.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import { withWallImpactReview } from "./wallImpactReview.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const controller = source.slice(source.indexOf("class BlasterBattle"), source.indexOf("\nconst game = new BlasterBattle"))
  .replaceAll("import.meta.url", JSON.stringify(new URL("../src/main.js", import.meta.url).href));
const audio = source.slice(source.indexOf("function projectileNeedsLoop("), source.indexOf("function setText("));
const bindings = { THREE, ...data, PROJECTILE_SPAWN_OFFSET, aimWithSpread, projectileTouchesPlayer, cameraCollisionFirstPerson, clamp: THREE.MathUtils.clamp };
const Game = new Function(...Object.keys(bindings), `${audio};return ${controller}`)(...Object.values(bindings));
// Every weapon retains its original finish branch; only direct impact VFX use
// the owned contact. Explosion/split origins and all audio positions stay exact.
for (const weapon of Object.values(data.WEAPONS)) {
  const position = new THREE.Vector3(3,4,5), point = new THREE.Vector3(2,4,5), normal = new THREE.Vector3(-1,0,0);
  const calls = [], shot = { weapon, owner:{id:'owner'}, mesh:{position}, split:false };
  Game.prototype.finishProjectile.call({
    combatVisuals:{impact:(p,w,o,options)=>calls.push(['impact',p.toArray(),w.id,o.id,options.normal.toArray(),options.size])},
    sound:{playImpact:(w,p,d,k)=>calls.push(['audio',w.id,p.toArray(),d,k])},
    audioSpatial:p=>p, splitProjectile:s=>calls.push(['split',s===shot]), explode:s=>calls.push(['explode',s===shot]),
    removeProjectile:i=>calls.push(['remove',i])
  },7,shot,{point,normal});
  assert.deepEqual(position.toArray(),[3,4,5]);
  assert.deepEqual(calls,weapon.split ? [['split',true],['remove',7]] : weapon.radius ? [['explode',true],['remove',7]] :
    [['impact',[1.988,4,5],weapon.id,'owner',[-1,0,0],1.05],['audio',weapon.id,[3,4,5],0,'wall'],['remove',7]]);
}
const scene = new THREE.Scene(), original = new Fighter(scene, { id: "impact-test", color: 0x129dba, accent: 0x6ff6ff }, ["blaster"], new THREE.Vector3());
const game = Object.create(Game.prototype), wall = { x: 112, z: 0, w: 1.2, d: 224, baseY: 0, top: 44 };
let collisionQueries = 0, terrainCalls = 0;
const impactAudio = [];
Object.assign(game, { scene, paused: true, mode: "training", players: [original], projectiles: [], hazards: [], effects: [], decoys: [],
  combatMusicPulse: .27, camera: new THREE.PerspectiveCamera(62, 16 / 9, .1, 520), updateCamera() {},
  settings: { reducedMotion: false }, cameraYaw: .4, cameraPitch: .2, cameraFirstPerson: false, cameraFirstPersonRequested: false,
  cameraClearance: { actual: 5, target: 6 }, cameraScratch: Object.fromEntries(["forward", "flatForward", "right", "pivot", "desired", "target", "constrained", "focus", "menuPosition"].map(key => [key, new THREE.Vector3()])),
  combatVisuals: new CombatVisuals(scene), sound: new Proxy({}, { get: (_, name) => (...args) => {
    if (name === "playImpact") impactAudio.push({ weapon: args[0].id, spatial: structuredClone(args[1]), damage: args[2], kind: args[3] });
  } }), audioSpatial: (position,local,gain,owner) => ({ position: position.toArray(), local,gain,owner }),
  nearestAudioDistances: new Float64Array(6), nearestAudioIds: [], audibleProjectileIds: new Set(),
  world: { size: 112, height: 92, nearbyObstacles: () => [wall], resolve: () => ({ grounded: false }), surfaceHeightAt: () => 0,
    collisionDirection: new THREE.Vector3(), collisionRay: new THREE.Ray(), collisionBox: new THREE.Box3(), collisionHit: new THREE.Vector3(),
    cameraRaycaster: new THREE.Raycaster(), cameraOccluders: [], constrainCamera: ArenaWorld.prototype.constrainCamera,
    projectileContact: ArenaWorld.prototype.projectileContact,
    boostAt: () => null, projectileHit(position, radius) { collisionQueries++; return ArenaWorld.prototype.projectileHit.call(this, position, radius); },
    destroy() { terrainCalls++; return 0; } } });
game.camera.position.set(4, 18, 6); game.camera.lookAt(0, 16, 8); game.camera.updateMatrixWorld(true);
const originalState = () => ({ position: original.position.toArray(), aim: original.aim.toArray(), ammo: { ...original.ammo },
  attackTimer: original.attackTimer, visible: original.group.visible, camera: game.camera.matrixWorld.toArray(), children: scene.children.length,
  yaw: game.cameraYaw, pitch: game.cameraPitch, firstPerson: game.cameraFirstPerson, requested: game.cameraFirstPersonRequested,
  clearance: { ...game.cameraClearance }, scratch: Object.fromEntries(Object.entries(game.cameraScratch).map(([k,v]) => [k,v.toArray()])) });
const before = originalState(), cameraUpdate = game.updateCamera, impactMethod = game.combatVisuals.impact, rng = game.combatVisuals.random, globalRng = Math.random;
const run = async options => {
  const frames = [], beforeQueries = collisionQueries, beforeTerrain = terrainCalls, beforeAudio = impactAudio.length;
  const effectTime = game.combatVisuals.effectTime;
  await withWallImpactReview(game, { previousContact: true, ...options }, async state => { assert.equal(Math.random, globalRng); frames.push(structuredClone(state)); });
  assert.deepEqual(frames.map(s => s.frame), [0, 1, 2, 4, 8, 16, 90]);
  assert.ok(collisionQueries > beforeQueries && terrainCalls === beforeTerrain + 1, "every run reaches real collision and exactly one terrain call");
  assert.equal(impactAudio.length, beforeAudio + 1, "every real collision emits exactly one new impact audio call");
  assert.deepEqual(originalState(), before); assert.equal(game.players[0], original); assert.equal(game.updateCamera, cameraUpdate);
  assert.equal(game.combatVisuals.impact, impactMethod); assert.equal(game.combatVisuals.random, rng); assert.equal(Math.random, globalRng);
  assert.equal(game.combatMusicPulse, .27); assert.equal(game.projectiles.length, 0);
  assert.equal(game.combatVisuals.effectTime, effectTime);
  assert.equal(frames[0].paidAmmo, data.WEAPONS.blaster.ammo - 1);
  assert.equal(frames[0].rings.length, 1); assert.deepEqual(frames[0].impact.suppliedNormal, [-1,0,0]);
  assert.ok(Math.abs(frames[0].rings[0].maxLife - frames[0].rings[0].life - 1 / 60) < 1e-8, "first visible frame uses production post-collision effect step");
  assert.equal(frames.at(-1).rings.length, 0); assert.equal(frames.at(-1).sparks.length, 0);
  assert.ok(frames.at(-1).lights.every(light => light.life === 0 && light.intensity < 1e-10));
  return frames;
};
for (const oblique of [false, true]) {
  const baseline = await run({ oblique }), turned = await run({ oblique, turn: true });
  assert.deepEqual(baseline[0].initial, turned[0].initial, "post-shot aim diagnostic keeps initial projectile trajectory exact");
  assert.deepEqual(baseline[0].impact.position, turned[0].impact.position);
  assert.deepEqual(baseline[0].impact.velocity, turned[0].impact.velocity);
  assert.deepEqual(baseline[0].rings[0].normal, baseline[0].impact.ownerAim, "records current owner-aim fallback, not a synthetic surface normal");
  assert.deepEqual(turned[0].rings[0].normal, [0, 0, -1]);
  assert.notDeepEqual(baseline[0].rings[0].normal, turned[0].rings[0].normal, "reproduces direction change with unchanged real wall collision");
  assert.ok(baseline[0].lights.some(light => light.intensity > 0 && light.position[0] > wall.x - wall.w / 2), "current impact light is inside the opaque wall");
}
const gameplayFrame = (await run({ gameplay: true }))[0];
assert.equal(gameplayFrame.cameraKind, "production-collision-aware-camera-settled-240");
assert.equal(gameplayFrame.cameraState.firstPerson, false);
assert.ok(gameplayFrame.cameraState.clearance.actual > 8 && gameplayFrame.cameraState.clearance.actual < 9);
for (const oblique of [false, true]) {
  const current = await run({ oblique }), candidate = await run({ oblique, surfaceContact: true }), turned = await run({ oblique, surfaceContact: true, turn: true });
  assert.deepEqual(candidate[0].initial, current[0].initial); assert.deepEqual(candidate[0].impact.position, current[0].impact.position);
  assert.deepEqual(candidate[0].impact.velocity, current[0].impact.velocity);
  assert.deepEqual(candidate[0].rings[0].normal, [-1, 0, 0]); assert.equal(candidate[0].rings[0].position[0], 111.4 - .012);
  assert.equal(candidate[0].rings[0].size, current[0].rings[0].size); assert.equal(candidate[0].rings[0].maxLife, current[0].rings[0].maxLife);
  assert.equal(candidate[0].sparks.length, current[0].sparks.length);
  assert.deepEqual(candidate.map(s => s.sparks.map(p => [p.size, p.life, p.maxLife])), current.map(s => s.sparks.map(p => [p.size, p.life, p.maxLife])));
  assert.deepEqual(candidate.map(s => s.lights.map(l => [l.life,l.intensity])), current.map(s => s.lights.map(l => [l.life,l.intensity])));
  assert.equal(JSON.stringify(candidate.map(s => [s.rings,s.sparks,s.lights])) === JSON.stringify(turned.map(s => [s.rings,s.sparks,s.lights])), true,
    "surface contact trial ignores later aim changes (all ring/spark/light values exact)");
}
for (const oblique of [false,true]) {
  const legacy = await run({oblique}), legacyAudio = structuredClone(impactAudio.at(-1));
  const current = await run({oblique, previousContact:false}), currentAudio = structuredClone(impactAudio.at(-1));
  const turned = await run({oblique, previousContact:false, turn:true});
  assert.deepEqual(currentAudio,legacyAudio,"presentation contact preserves actual impact audio arguments at original projectile center");
  assert.deepEqual(currentAudio.spatial.position,current[0].impact.position);
  assert.deepEqual(current[0].initial,legacy[0].initial); assert.deepEqual(current[0].impact.position,legacy[0].impact.position);
  assert.deepEqual(current[0].rings[0].normal,[-1,0,0]); assert.ok(Math.abs(current[0].rings[0].position[0] - 111.388)<1e-9);
  assert.equal(JSON.stringify(current.map(s=>[s.rings,s.sparks,s.lights]))===JSON.stringify(turned.map(s=>[s.rings,s.sparks,s.lights])),true,"integrated contacts ignore post-shot aim");
  assert.equal(current[0].sparks.length,legacy[0].sparks.length); assert.equal(current[0].rings[0].size,legacy[0].rings[0].size);
}
await assert.rejects(withWallImpactReview(game, {}, async () => { throw Error("capture interrupted"); }), /capture interrupted/);
assert.deepEqual(originalState(), before); assert.equal(Math.random, globalRng); assert.equal(game.combatVisuals.random, rng);
assert.equal(game.combatVisuals.impact, impactMethod); assert.equal(game.projectiles.length, 0); assert.equal(game.updateCamera, cameraUpdate);
game.paused = false;
await assert.rejects(withWallImpactReview(game, {}, async () => {}), /paused/);
game.paused = true; game.combatVisuals.rings[0].life = 1;
await assert.rejects(withWallImpactReview(game, {}, async () => {}), /transient-free/);
game.combatVisuals.rings[0].life = 0;
assert.deepEqual(originalState(), before);
// Exercise the actual DOM runner too: immutable per-image stamps, guard and
// control restoration must not depend on the once-per-second metrics panel.
const html = readFileSync(new URL("./graphics.browser.html", import.meta.url), "utf8");
const runnerSource = html.slice(html.indexOf("async function runWallImpactReview("), html.indexOf("function makeTrailShading("));
const links = [], controls = [{ disabled: false }, { disabled: true }], review = { running: false };
const elements = { "camera-captures": { replaceChildren: () => { links.length = 0; }, append: link => links.push(link) },
  "wall-angle": { value: "normal" }, "wall-turn": { checked: false }, "wall-gameplay": { checked: true }, "wall-contact": { checked: false }, "wall-previous": { checked: false } };
Object.assign(game, { renderPipeline: { direct: false, profile: "unit-test-no-renderer" }, settings: { graphics: "high" } });
const document = { querySelectorAll: () => controls, createElement: () => ({ dataset: {} }), querySelector: () => ({ toDataURL: () => "unit-test-only" }) };
const makeRunner = (stress = false, fail = false) => new Function("game", "withWallImpactReview", "select", "document", "cameraReview", "stress", "fail", `
  const resetReview={},cacheReview={},decoyReview={},sceneSerial=5,resetPhase='ready',errorCount=0,innerWidth=747,innerHeight=698,devicePixelRatio=1;
  let renderedFrames=100; const withFrozenShaderTime=fn=>fn();
  const waitForReviewFrame=async(serial,predicate)=>{ if(fail) throw Error('render interrupted'); renderedFrames+=4; if(!predicate()) throw Error('unready'); };
  ${runnerSource}; return runWallImpactReview;
`)(game, withWallImpactReview, id => elements[id], document, review, stress, fail);
await makeRunner()();
assert.equal(review.error, null); assert.equal(links.length, 7); assert.equal(review.running, false); assert.equal(review.shell, false);
assert.deepEqual(controls.map(c => c.disabled), [false, true]);
const stamp = JSON.parse(links[0].dataset.review);
assert.equal(stamp.effectAge, 1 / 60); assert.equal(stamp.sceneSerial, 5); assert.equal(stamp.cameraKind, "production-collision-aware-camera-settled-240");
review.samples[0].impact.ownerAim[0] = 9;
assert.equal(JSON.parse(links[0].dataset.review).impact.ownerAim[0], 1, "per-PNG evidence is immutable after capture");
await makeRunner(true)(); assert.match(review.error, /Stop stress/); assert.equal(links.length, 0);
await makeRunner(false, true)(); assert.match(review.error, /render interrupted/); assert.equal(review.running, false); assert.equal(review.shell, false);
assert.deepEqual(controls.map(c => c.disabled), [false, true]); assert.deepEqual(originalState(), before);
original.dispose(); game.combatVisuals.dispose();
console.log("Real wall-impact QA: paid shots, collision/aim reproduction, ages, cleanup and restoration passed.");
