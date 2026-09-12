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
const before = originalState(), cameraUpdate = game.updateCamera, impactMethod = game.combatVisuals.impact, ringUpdate = game.combatVisuals.updateRings, rng = game.combatVisuals.random, globalRng = Math.random;
const run = async (options, inspect = () => {}) => {
  const frames = [], beforeQueries = collisionQueries, beforeTerrain = terrainCalls, beforeAudio = impactAudio.length;
  const effectTime = game.combatVisuals.effectTime;
  await withWallImpactReview(game, { impactBurst: "previous", previousContact: true, previousSparks: !options?.sparkAspect, ...options }, async state => {
    inspect(state);
    assert.equal(Math.random, globalRng);
    if(options?.sparkAspect || options?.previousSparks===false) for(const spark of state.sparkLayers) {
      const x=new THREE.Vector3().fromArray(spark.matrix,0), y=new THREE.Vector3().fromArray(spark.matrix,4), z=new THREE.Vector3().fromArray(spark.matrix,8);
      assert.ok(Math.abs(y.length()/x.length()-2)<1e-6 && Math.abs(y.length()/z.length()-2)<1e-6,"actual spark aspect is 2:1 on both transverse axes");
      const velocity=game.combatVisuals.sparks[spark.index].velocity;
      assert.ok(y.normalize().dot(velocity.clone().normalize())>1-1e-10,"actual longitudinal axis follows post-gravity velocity");
    }
    frames.push(structuredClone(state));
  });
  assert.deepEqual(frames.map(s => s.frame), options?.ringDissipation && options.ringDissipation !== "off" ? [0,1,2,4,8,16,20,22,23,24,26,90] : [0,1,2,4,8,16,90]);
  assert.ok(collisionQueries > beforeQueries && terrainCalls === beforeTerrain + 1, "every run reaches real collision and exactly one terrain call");
  assert.equal(impactAudio.length, beforeAudio + 1, "every real collision emits exactly one new impact audio call");
  assert.deepEqual(originalState(), before); assert.equal(game.players[0], original); assert.equal(game.updateCamera, cameraUpdate);
  assert.equal(game.combatVisuals.impact, impactMethod); assert.equal(game.combatVisuals.random, rng); assert.equal(Math.random, globalRng);
  assert.equal(game.combatVisuals.updateRings, ringUpdate);
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
const grazingOptions={previousContact:false,previousSparks:false,ringDissipation:"integrated"};
const normalCamera=await run(grazingOptions),grazingCamera=await run({...grazingOptions,grazing:true});
for(let i=0;i<grazingCamera.length;i++) {
  const a=normalCamera[i],b=grazingCamera[i];assert.equal(b.cameraKind,"fixed-surface-grazing");
  for(const key of ["initial","impact","rings","ringLayers","sparks","sparkLayers","lights","paidAmmo","projection"])assert.deepEqual(b[key],a[key]);
  const sight=new THREE.Vector3().fromArray(b.cameraMatrix,12).sub(new THREE.Vector3().fromArray(b.impact.emissionPosition));
  assert.ok(sight.x<0,"camera stays inside the wall");
  const cosine=sight.normalize().dot(new THREE.Vector3(-1,0,0));
  assert.ok(cosine>.1&&cosine<.13,"approximately 83-degree grazing angle from the surface normal");
}
await assert.rejects(withWallImpactReview(game,{grazing:true,gameplay:true},async()=>{}),/Choose grazing or gameplay/);
await assert.rejects(withWallImpactReview(game,{grazing:true},async()=>{throw Error("grazing interrupted");}),/grazing interrupted/);
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
const dissipationCurrent = await run({previousContact:false,ringDissipation:"current"});
const dissipationTrial = await run({previousContact:false,ringDissipation:"trial"});
const dissipationIntegrated = await run({previousContact:false,ringDissipation:"integrated"});
for (let i=0;i<dissipationCurrent.length;i++) {
  const a=dissipationCurrent[i], b=dissipationTrial[i];
  assert.deepEqual(b.rings,a.rings); assert.deepEqual(b.sparks,a.sparks); assert.deepEqual(b.lights,a.lights);
  assert.deepEqual(b.ringLayers.map(x=>x.matrix),a.ringLayers.map(x=>x.matrix),"fade never changes geometry, expansion, pose or lifetime");
  if (!a.rings.length) continue;
  const factor=1-THREE.MathUtils.smoothstep(1-a.rings[0].life/a.rings[0].maxLife,.2,1);
  for(let layer=0;layer<2;layer++) for(let channel=0;channel<3;channel++)
    assert.ok(Math.abs(b.ringLayers[layer].color[channel]-a.ringLayers[layer].color[channel]*factor)<1e-7);
  if (a.effectAge<=.08) assert.deepEqual(b.ringLayers,a.ringLayers,"the initial cue is unchanged");
  if (a.effectAge>=.38) assert.ok(b.ringLayers.every(x=>x.color.every(c=>c<.02)),"last living ring frame approaches zero brightness");
}
for(let i=0;i<dissipationTrial.length;i++) {
  const a=dissipationTrial[i],b=dissipationIntegrated[i];
  assert.deepEqual(b.rings,a.rings); assert.deepEqual(b.sparks,a.sparks); assert.deepEqual(b.lights,a.lights);
  assert.deepEqual(b.ringLayers.map(x=>x.matrix),a.ringLayers.map(x=>x.matrix));
  for(let layer=0;layer<2;layer++) for(let channel=0;channel<3;channel++)
    assert.ok(Math.abs(b.ringLayers[layer].color[channel]-a.ringLayers[layer].color[channel])<1e-7,"fused product color writes match reference within Float32 rounding");
}
await assert.rejects(withWallImpactReview(game,{ringDissipation:"trial"},async()=>{throw Error("fade interrupted");}),/fade interrupted/);
assert.equal(game.combatVisuals.updateRings,ringUpdate);
const sparkUpdate = game.combatVisuals.updateSparks;
for (const oblique of [false,true]) for (const gameplay of [false,true]) {
  const options={previousContact:false,ringDissipation:"integrated",oblique,gameplay};
  const current=await run(options), trial=await run({...options,sparkAspect:true}), restored=await run(options);
  const integrated=await run({...options,previousSparks:false});
  assert.deepEqual(restored,current,"spark experiment restores subsequent captures exactly");
  for (let i=0;i<current.length;i++) {
    const a=current[i],b=trial[i];
    assert.equal(b.sparkAspect,true);
    for (const key of ["initial","impact","paidAmmo","projectiles","rings","sparks","lights","ringLayers","cameraMatrix","projection"])
      { assert.deepEqual(b[key],a[key],`spark aspect keeps ${key} exact`); assert.deepEqual(integrated[i][key],b[key],`integrated shape keeps ${key} exact`); }
    assert.equal(b.sparkLayers.length,a.sparkLayers.length);
    for (let j=0;j<a.sparkLayers.length;j++) {
      const old=a.sparkLayers[j], next=b.sparkLayers[j];
      assert.deepEqual(next.color,old.color); assert.equal(next.index,old.index);
      const expected=new THREE.Matrix4().fromArray(old.matrix).scale(new THREE.Vector3(2**(-1/3),2**(2/3),2**(-1/3)));
      for(let n=0;n<16;n++) assert.ok(Math.abs(next.matrix[n]-expected.elements[n])<1e-7,"only volume-preserving velocity-axis aspect changes");
      const determinant=new THREE.Matrix4().fromArray(next.matrix).determinant();
      assert.ok(Math.abs(determinant/new THREE.Matrix4().fromArray(old.matrix).determinant()-1)<1e-5);
      assert.deepEqual(integrated[i].sparkLayers[j].color,next.color);
      for(let n=0;n<16;n++) assert.ok(Math.abs(integrated[i].sparkLayers[j].matrix[n]-next.matrix[n])<1e-7,"integrated shape matches reference within Float32 rounding");
    }
  }
}
await assert.rejects(withWallImpactReview(game,{sparkAspect:true},async()=>{throw Error("spark interrupted");}),/spark interrupted/);
await assert.rejects(withWallImpactReview(game,{sparkAspect:true,previousSparks:true},async()=>{throw Error("must not capture");}),/Choose either/);
assert.equal(game.combatVisuals.updateSparks,sparkUpdate);
for(const gameplay of [false,true]) {
  const options={previousContact:false,previousSparks:false,ringDissipation:"integrated",gameplay};
  const full=await run(options);
  for(const ringLayer of ["outer","inner"]) {
    const isolated=await run({...options,ringLayer});
    for(let i=0;i<full.length;i++) {
      const a=full[i],b=isolated[i];
      assert.equal(b.ringLayer,ringLayer);
      for(const key of ["initial","impact","paidAmmo","projectiles","rings","sparks","sparkLayers","lights","cameraMatrix","projection"])
        assert.deepEqual(b[key],a[key],`ring isolation preserves ${key}`);
      assert.deepEqual(b.ringLayers.map(l=>l.color),a.ringLayers.map(l=>l.color));
      const shown=ringLayer==="outer"?0:1,hidden=1-shown;
      assert.deepEqual(b.ringLayers[shown],a.ringLayers[shown],"selected layer keeps its exact production matrix and color");
      assert.deepEqual(b.ringLayers[hidden].matrix,new THREE.Matrix4().makeScale(0,0,0).toArray(),"only the unselected slot matrix is hidden");
    }
  }
  assert.deepEqual(await run(options),full,"both layers and all effects restore exactly after isolation");
}
await assert.rejects(withWallImpactReview(game,{ringLayer:"invalid"},async()=>{}),/Unknown ring layer/);
await assert.rejects(withWallImpactReview(game,{ringLayer:"outer"},async()=>{throw Error("layer interrupted");}),/layer interrupted/);
assert.equal(game.combatVisuals.updateRings,ringUpdate);
for(const gameplay of [false,true]) {
  const options={previousContact:false,previousSparks:false,ringDissipation:"integrated",gameplay};
  const current=await run(options), nested=await run({...options,nestedRing:true});
  for(let i=0;i<current.length;i++) {
    const a=current[i],b=nested[i];
    assert.equal(b.nestedRing,true);
    for(const key of ["initial","impact","paidAmmo","projectiles","rings","sparks","sparkLayers","lights","cameraMatrix","projection"])
      assert.deepEqual(b[key],a[key],`nesting preserves ${key}`);
    assert.deepEqual(b.ringLayers[0],a.ringLayers[0],"outer layer is untouched");
    assert.deepEqual(b.ringLayers[1].color,a.ringLayers[1].color,"no brightness compensation");
    const expected=[...a.ringLayers[1].matrix];
    if(a.rings.length) for(const n of [0,1,2,4,5,6]) expected[n]=a.ringLayers[0].matrix[n]*.7;
    for(let n=0;n<16;n++) assert.ok(Math.abs(b.ringLayers[1].matrix[n]-expected[n])<1e-7,"inner XY follows outer basis at .7, Z and translation remain exact");
  }
  assert.deepEqual(await run(options),current,"nesting trial restores subsequent production capture exactly");
}
await assert.rejects(withWallImpactReview(game,{nestedRing:true},async()=>{throw Error("nest interrupted");}),/nest interrupted/);
const outerMaterial=game.combatVisuals.ringOuter.material, innerMaterial=game.combatVisuals.ringInner.material;
const outerGeometry=game.combatVisuals.ringOuter.geometry;
let originalDisposals=0;
outerMaterial.addEventListener("dispose",()=>originalDisposals++);
for(const gameplay of [false,true]) {
  const options={previousContact:false,previousSparks:false,ringDissipation:"integrated",gameplay};
  const current=await run(options);
  for(const outerProfile of ["control","soft"]) {
    let temporary,disposals=0;
    const trial=await run({...options,outerProfile}, state=>{
      const material=game.combatVisuals.ringOuter.material;
      assert.notEqual(material,outerMaterial);
      assert.equal(material.isMeshBasicNodeMaterial,true);
      assert.ok(material.opacityNode);
      assert.equal(game.combatVisuals.ringInner.material,innerMaterial);
      assert.equal(game.combatVisuals.ringOuter.geometry,outerGeometry);
      for(const key of ["color","opacity","transparent","blending","depthWrite","depthTest","toneMapped","side"])
        assert.deepEqual(material[key],outerMaterial[key],`profile preserves material ${key}`);
      if(!temporary) { temporary=material; temporary.addEventListener("dispose",()=>disposals++); }
      assert.equal(material,temporary,"one temporary material for the whole isolated event");
      assert.ok(state.rings.length<=1,"no unrelated live ring shares the trial material");
    });
    assert.equal(disposals,1); assert.equal(game.combatVisuals.ringOuter.material,outerMaterial);
    for(let i=0;i<current.length;i++) {
      assert.equal(trial[i].outerProfile,outerProfile);
      assert.deepEqual({...trial[i],outerProfile:"off"},current[i],"opacity trial changes no matrices, RGB, physical state or camera");
    }
  }
  assert.deepEqual(await run(options),current);
}
await assert.rejects(withWallImpactReview(game,{outerProfile:"unknown"},async()=>{}),/Unknown outer profile/);
let interruptedDisposals=0;
await assert.rejects(withWallImpactReview(game,{outerProfile:"soft"},async()=>{
  game.combatVisuals.ringOuter.material.addEventListener("dispose",()=>interruptedDisposals++);
  throw Error("profile interrupted");
}),/profile interrupted/);
assert.equal(interruptedDisposals,1); assert.equal(originalDisposals,0);
assert.equal(game.combatVisuals.ringOuter.material,outerMaterial);
const originals=[game.combatVisuals.ringOuter,game.combatVisuals.ringInner];
for(const gameplay of [false,true]) {
  const options={previousContact:false,previousSparks:false,ringDissipation:"integrated",gameplay};
  const current=await run(options);
  for(const impactBurst of ["control","trial"]) {
    const owned=new Map(),borrowed=new Map();
    const compared=await run({...options,impactBurst},state=>{
      const proxies=game.combatVisuals.group.children.filter(x=>x.name.startsWith("wall-impact-burst-"));
      assert.equal(proxies.length,2); assert.ok(originals.every(x=>!x.visible));
      for(let n=0;n<2;n++) {
        const p=proxies[n],o=originals[n];
        assert.equal(p.parent,o.parent,"proxies retain source hierarchy");
        p.updateWorldMatrix(true,false);o.updateWorldMatrix(true,false);
        assert.deepEqual(p.matrixWorld.toArray(),o.matrixWorld.toArray());
        assert.notEqual(p.instanceMatrix,o.instanceMatrix); assert.notEqual(p.instanceColor,o.instanceColor);
        assert.equal(p.renderOrder,o.renderOrder); assert.equal(p.count,o.count);
        assert.deepEqual(p.material.color,o.material.color); assert.equal(p.material.opacity,o.material.opacity);
        for(const resource of [p,p.geometry,p.material]) {
          const registry=resource===o.geometry||resource===o.material?borrowed:owned;
          if(!registry.has(resource)){registry.set(resource,0); resource.addEventListener("dispose",()=>registry.set(resource,registry.get(resource)+1));}
        }
        if(impactBurst==="control") {assert.equal(p.geometry,o.geometry);assert.equal(p.material,o.material);}
        else { assert.equal(p.geometry.type,"PlaneGeometry");assert.equal(p.material.isMeshBasicNodeMaterial,true);assert.ok(p.material.opacityNode); }
      }
      assert.equal(state.impactBurst,impactBurst);
    });
    assert.ok([...owned.values()].every(n=>n===1),"only owned proxy resources dispose exactly once");
    assert.ok([...borrowed.values()].every(n=>n===0),"borrowed originals never dispose");
    assert.ok(originals.every(x=>x.visible));
    for(let i=0;i<current.length;i++) {
      const a=current[i],b=compared[i];
      const aa={...a},bb={...b};delete aa.impactBurst;delete bb.impactBurst;delete aa.displayRingLayers;delete bb.displayRingLayers;
      assert.deepEqual(bb,aa,"new design preserves all production physical/effect state");
      if(impactBurst==="control") assert.deepEqual(b.displayRingLayers,a.displayRingLayers);
      else if(a.rings.length) for(let n=0;n<2;n++) {
        const m=b.displayRingLayers[n].matrix,x=new THREE.Vector3().fromArray(m),y=new THREE.Vector3().fromArray(m,4);
        const r=Math.hypot(...a.ringLayers[0].matrix.slice(0,3))*1.052,expected=n===0?r:Math.min(r,a.rings[0].size*.28);
        assert.ok(Math.abs(x.length()-expected)<1e-6&&Math.abs(y.length()-expected)<1e-6,"circular front bounded by original long-axis envelope; core capped");
        assert.ok(x.clone().cross(y).normalize().dot(new THREE.Vector3().fromArray(a.rings[0].normal))>1-1e-7,"quad stays on impact surface");
        assert.deepEqual(m.slice(12,15),a.ringLayers[0].matrix.slice(12,15));
        assert.deepEqual(b.displayRingLayers[n].color,a.ringLayers[n].color);
      }
    }
  }
  assert.deepEqual(await run(options),current);
}
await assert.rejects(withWallImpactReview(game,{impactBurst:"invalid"},async()=>{}),/Unknown impact burst/);
for(const oblique of [false,true])for(const gameplay of [false,true]) {
  const options={previousContact:false,previousSparks:false,ringDissipation:"integrated",oblique,gameplay};
  const reference=await run({...options,impactBurst:"trial"});
  const integrated=await run({...options,impactBurst:"off"},state=>{
    assert.ok(game.combatVisuals.rings.some(s=>s.surfaceBurst),"actual paid world collision selects the product surface layers");
    assert.equal(game.combatVisuals.ringOuter.count,0);assert.equal(game.combatVisuals.ringInner.count,0);
    assert.equal(game.combatVisuals.group.children.filter(x=>x.name.startsWith("wall-impact-burst-")).length,0,"product uses no QA proxy");
  });
  for(let i=0;i<reference.length;i++) {
    const a=reference[i],b=integrated[i];
    for(const key of ["initial","impact","paidAmmo","projectiles","rings","sparks","sparkLayers","lights","cameraMatrix","projection"])
      assert.deepEqual(b[key],a[key],`integration preserves actual ${key}`);
    for(let layer=0;layer<2;layer++) {
      assert.deepEqual(b.displayRingLayers[layer].color,a.displayRingLayers[layer].color);
      b.displayRingLayers[layer].matrix.forEach((n,j)=>assert.ok(Math.abs(n-a.displayRingLayers[layer].matrix[j])<1e-7,"integrated/reference Float32 matrix agreement"));
    }
  }
}
await assert.rejects(withWallImpactReview(game,{impactBurst:"trial",ringDissipation:"integrated",nestedRing:true},async()=>{}),/requires published/);
const interruptedBurst=new Map();
await assert.rejects(withWallImpactReview(game,{impactBurst:"trial",ringDissipation:"integrated"},async()=>{
  for(const p of game.combatVisuals.group.children.filter(x=>x.name.startsWith("wall-impact-burst-"))) for(const r of [p,p.geometry,p.material])
    if(!interruptedBurst.has(r)){interruptedBurst.set(r,0);r.addEventListener("dispose",()=>interruptedBurst.set(r,interruptedBurst.get(r)+1));}
  throw Error("burst interrupted");
}),/burst interrupted/);
assert.ok([...interruptedBurst.values()].every(n=>n===1));assert.ok(originals.every(x=>x.visible));
game.combatVisuals.group.position.set(1,2,3);game.combatVisuals.group.rotation.y=.3;
await run({previousContact:false,previousSparks:false,ringDissipation:"integrated",impactBurst:"control"},()=>{
  for(const p of game.combatVisuals.group.children.filter(x=>x.name.startsWith("wall-impact-burst-"))){
    p.updateWorldMatrix(true,false);originals[0].updateWorldMatrix(true,false);
    assert.deepEqual(p.matrixWorld.toArray(),originals[0].matrixWorld.toArray(),"nonidentity parent transform is retained");
  }
});
assert.equal(game.combatVisuals.group.children.filter(x=>x.name.startsWith("wall-impact-burst-")).length,0);
game.combatVisuals.group.position.set(0,0,0);game.combatVisuals.group.rotation.y=0;game.combatVisuals.group.updateMatrixWorld(true);
assert.equal(game.combatVisuals.updateRings,ringUpdate);
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
const freezeSource = html.slice(html.indexOf("async function withFrozenShaderTime("),html.indexOf("async function runWallImpactReview("));
const shaderClock = {value:17,update(){}};
const freeze = new Function("shaderTime",`${freezeSource};return withFrozenShaderTime`)(shaderClock), clockUpdate=shaderClock.update;
await freeze(async()=>assert.equal(shaderClock.value,3),3);
assert.equal(shaderClock.value,17); assert.equal(shaderClock.update,clockUpdate);
await assert.rejects(freeze(async()=>{throw Error("clock interrupted");},3),/clock interrupted/);
assert.equal(shaderClock.value,17); assert.equal(shaderClock.update,clockUpdate);
await freeze(async()=>assert.equal(shaderClock.value,17));
const runnerSource = html.slice(html.indexOf("async function runWallImpactReview("), html.indexOf("function makeTrailShading("));
const links = [], controls = [{ disabled: false }, { disabled: true }], review = { running: false };
const elements = { "camera-captures": { replaceChildren: () => { links.length = 0; }, append: link => links.push(link) },
  "wall-angle": { value: "normal" }, "wall-turn": { checked: false }, "wall-gameplay": { checked: true }, "wall-contact": { checked: false }, "wall-previous": { checked: false }, "wall-ring": {value:"off"}, "wall-sparks": {checked:false}, "wall-previous-sparks": {checked:false}, "wall-ring-layer": {value:"both"}, "wall-nested-ring": {checked:false}, "wall-outer-profile": {value:"off"} };
Object.assign(game, { renderPipeline: { direct: false, profile: "unit-test-no-renderer" }, settings: { graphics: "high" } });
const document = { querySelectorAll: () => controls, createElement: () => ({ dataset: {} }), querySelector: () => ({ toDataURL: () => "unit-test-only" }) };
elements["wall-burst"] = {value:"off"};
elements["wall-grazing"] = {checked:false};
const makeRunner = (stress = false, fail = false, withoutSurfaceResources = false) => new Function("game", "withWallImpactReview", "select", "document", "cameraReview", "stress", "fail", "withoutSurfaceResources", `
  const resetReview={},cacheReview={},decoyReview={},sceneSerial=5,resetPhase='ready',errorCount=0,innerWidth=747,innerHeight=698,devicePixelRatio=1;
  let renderedFrames=100; const shaderTime={value:17,update(){}}; ${freezeSource}
  const waitForReviewFrame=async(serial,predicate)=>{ if(fail) throw Error('render interrupted'); renderedFrames+=4; if(!predicate()) throw Error('unready'); };
  ${runnerSource}; return runWallImpactReview;
`)(game, withWallImpactReview, id => elements[id], document, review, stress, fail, withoutSurfaceResources);
await assert.rejects(makeRunner(false,false,true)(),/Hidden-resource control cannot validate artwork/);
await makeRunner()();
assert.equal(review.error, null); assert.equal(links.length, 7); assert.equal(review.running, false); assert.equal(review.shell, false);
assert.deepEqual(controls.map(c => c.disabled), [false, true]);
const stamp = JSON.parse(links[0].dataset.review);
assert.equal(stamp.effectAge, 1 / 60); assert.equal(stamp.sceneSerial, 5); assert.equal(stamp.cameraKind, "production-collision-aware-camera-settled-240");
assert.equal(stamp.shaderClockSeconds,3);
review.samples[0].impact.ownerAim[0] = 9;
assert.equal(JSON.parse(links[0].dataset.review).impact.ownerAim[0], 1, "per-PNG evidence is immutable after capture");
elements["wall-sparks"].checked = true;
await makeRunner()();
assert.equal(review.error,null); assert.equal(JSON.parse(links[0].dataset.review).sparkAspect,true);
elements["wall-sparks"].checked = false;
elements["wall-ring-layer"].value = "outer";
await makeRunner()();
assert.equal(review.error,null); assert.equal(JSON.parse(links[0].dataset.review).ringLayer,"outer");
elements["wall-ring-layer"].value = "both";
elements["wall-nested-ring"].checked = true;
await makeRunner()();
assert.equal(review.error,null); assert.equal(JSON.parse(links[0].dataset.review).nestedRing,true);
elements["wall-nested-ring"].checked = false;
elements["wall-outer-profile"].value = "soft";
await makeRunner()();
assert.equal(review.error,null); assert.equal(JSON.parse(links[0].dataset.review).outerProfile,"soft");
elements["wall-outer-profile"].value = "off";
elements["wall-burst"].value = "trial"; elements["wall-ring"].value = "integrated";
await makeRunner()();
assert.equal(review.error,null); assert.equal(JSON.parse(links[0].dataset.review).impactBurst,"trial");
assert.notDeepEqual(JSON.parse(links[0].dataset.review).displayRingLayers,JSON.parse(links[0].dataset.review).ringLayers);
elements["wall-burst"].value = "off";
elements["wall-gameplay"].checked=false;elements["wall-grazing"].checked=true;
await makeRunner()();assert.equal(review.error,null);assert.equal(JSON.parse(links[0].dataset.review).cameraKind,"fixed-surface-grazing");
elements["wall-grazing"].checked=false;elements["wall-gameplay"].checked=true;
await makeRunner(true)(); assert.match(review.error, /Stop stress/); assert.equal(links.length, 0);
await makeRunner(false, true)(); assert.match(review.error, /render interrupted/); assert.equal(review.running, false); assert.equal(review.shell, false);
assert.deepEqual(controls.map(c => c.disabled), [false, true]); assert.deepEqual(originalState(), before);
original.dispose(); game.combatVisuals.dispose();
console.log("Real wall-impact QA: paid shots, collision/aim reproduction, ages, cleanup and restoration passed.");
