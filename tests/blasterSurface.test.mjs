import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { WEAPONS, graphicsProfile } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import { withSurfaceBurstRuntime } from "./surfaceBurstReview.js";

const owner={color:0x129dba,accent:0x6ff6ff,aim:new THREE.Vector3(1,0,0)}, position=new THREE.Vector3(2,3,4);
const normal=new THREE.Vector3(-1,0,0),hidden=new THREE.Matrix4().makeScale(0,0,0).elements;
const layerNames=["ringOuter","ringInner","surfaceFront","surfaceCore"];
const matrixAt=(layer,i)=>Array.from(layer.instanceMatrix.array.slice(i*16,i*16+16));
const colorAt=(layer,i)=>Array.from(layer.instanceColor.array.slice(i*3,i*3+3));
const physical=v=>({rings:v.rings.map(s=>[s.life,s.maxLife,s.position?.toArray(),s.normal?.toArray(),s.size,s.family]),
  sparks:v.sparks.map(s=>[s.life,s.position?.toArray(),s.velocity?.toArray(),s.size,s.family]),
  lights:v.combatLights.map(l=>[l.position.toArray(),l.intensity,l.userData.life])});
const verifyTails=v=>{
  for(const [name,surface] of [["ringOuter",false],["ringInner",false],["surfaceFront",true],["surfaceCore",true]]) {
    let tail=0;
    for(let i=0;i<v.rings.length;i++) {
      const s=v.rings[i],active=s.life>0&&s.surfaceBurst===surface;
      if(active)tail=i+1;else assert.deepEqual(matrixAt(v[name],i),hidden,`${name} masks opposite/expired slot ${i}`);
    }
    assert.equal(v[name].count,tail,`${name} has its own last-live tail`);
  }
};
for(const reducedMotion of [false,true])for(const tier of ["low","medium","high"]) {
  const effects=new CombatVisuals(new THREE.Scene(),{reducedMotion}),reference=new CombatVisuals(new THREE.Scene(),{reducedMotion});
  effects.setGraphicsProfile(graphicsProfile(tier));reference.setGraphicsProfile(graphicsProfile(tier));
  assert.ok(effects.surfaceFront&&effects.surfaceCore,"surface resources exist before the first hit");
  assert.equal(effects.surfaceFront.material.opacityNode,reference.surfaceFront.material.opacityNode,"immutable front graph is shared across matches");
  assert.equal(effects.surfaceCore.material.opacityNode,reference.surfaceCore.material.opacityNode);
  assert.notEqual(effects.surfaceFront.geometry,effects.surfaceCore.geometry,"each layer owns its geometry for existing teardown");
  let instanceBytes=0,geometryBytes=0;
  for(const name of ["surfaceFront","surfaceCore"]) {
    const layer=effects[name];assert.equal(layer.count,0);assert.equal(layer.instanceMatrix.count,128);
    assert.equal(layer.material.isMeshBasicNodeMaterial,true);assert.equal(layer.material.depthWrite,false);assert.equal(layer.material.toneMapped,false);
    assert.equal(layer.material.blending,THREE.AdditiveBlending);
    instanceBytes+=layer.instanceMatrix.array.byteLength+layer.instanceColor.array.byteLength;
    geometryBytes+=layer.geometry.index.array.byteLength+Object.values(layer.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0);
  }
  assert.equal(instanceBytes,19456);assert.equal(geometryBytes,280);
  for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,2,3]]) {
    const supplied=new THREE.Vector3(...axis);
    for(const v of [effects,reference]) { v.update(2);v.cursors.ring=0;v.impact(position,WEAPONS.blaster,owner,{normal:supplied});v.update(1/60); }
    verifyTails(effects);
    const m=matrixAt(effects.surfaceFront,0),x=new THREE.Vector3().fromArray(m),y=new THREE.Vector3().fromArray(m,4);
    assert.ok(x.cross(y).normalize().dot(supplied.clone().normalize())>1-1e-7,"plane faces every supplied world normal");
    assert.deepEqual(supplied.toArray(),axis,"caller normal is never modified");
  }
  for(const weapon of Object.values(WEAPONS)) {
    for(const v of [effects,reference]) {
      v.update(2);v.cursors.ring=0;v.impact(position,WEAPONS.blaster,owner,{normal});v.update(1/60);
      v.cursors.ring=0;v.impact(position,weapon,owner,{normal});
    }
    const scoped=weapon.id==="blaster";
    assert.equal(effects.rings[0].surfaceBurst,scoped,"every weapon overwrites the reused scope");
    reference.rings[0].surfaceBurst=false;
    for(const dt of [1/60,.1,.17,.5]) {
      effects.update(dt);reference.update(dt);verifyTails(effects);verifyTails(reference);
      assert.ok(JSON.stringify(physical(effects))===JSON.stringify(physical(reference)),"all physical effect state remains exact");
      assert.deepEqual(effects.sparkLayer.instanceMatrix.array,reference.sparkLayer.instanceMatrix.array);
      assert.deepEqual(effects.sparkLayer.instanceColor.array,reference.sparkLayer.instanceColor.array);
      if(!scoped)for(const name of layerNames)assert.deepEqual(effects[name].instanceMatrix.array,reference[name].instanceMatrix.array);
      if(scoped&&effects.rings[0].life>0) {
        const slot=effects.rings[0],outer=matrixAt(reference.ringOuter,0),radius=Math.hypot(...outer.slice(0,3))*1.052;
        for(const [name,oldName,extent] of [["surfaceFront","ringOuter",radius],["surfaceCore","ringInner",Math.min(radius,slot.size*.28)]]) {
          const actual=matrixAt(effects[name],0),expected=new THREE.Matrix4().compose(slot.position,new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),slot.normal),new THREE.Vector3(extent,extent,1));
          actual.forEach((n,i)=>assert.ok(Math.abs(n-expected.elements[i])<1e-7,"integrated shape agrees with reviewed reference within Float32 rounding"));
          assert.deepEqual(colorAt(effects[name],0),colorAt(reference[oldName],0));
        }
      }
    }
  }
  for(const options of [{},{normal:null},{normal:new THREE.Vector3()},{normal:new THREE.Vector3(NaN,0,0)},{normal,explosive:true}]) {
    effects.update(2);effects.cursors.ring=0;effects.impact(position,WEAPONS.blaster,owner,options);
    assert.equal(effects.rings[0].surfaceBurst,false,"player/airburst/invalid normal/explosive variants retain the torus path");
  }
  // Mixed holes, final slot, overwrite before expiry, wrap, and a 112-hit volley.
  effects.update(2);effects.cursors.ring=127;
  for(let i=0;i<112;i++) {
    effects.impact(position,i%3===0?WEAPONS.rocket_launcher:WEAPONS.blaster,owner,i%2?{}:{normal});
    effects.update(1/1000);verifyTails(effects);
  }
  for(let i=0;i<160;i++)effects.impact(position,WEAPONS.blaster,owner,i%2?{normal}:{});
  effects.update(1/60);verifyTails(effects);assert.equal(effects.rings.length,128);
  effects.update(2);verifyTails(effects);
  const owned=[effects.surfaceFront.geometry,effects.surfaceCore.geometry,effects.surfaceFront.material,effects.surfaceCore.material];
  const disposed=new Map(owned.map(r=>[r,0]));for(const r of owned)r.addEventListener("dispose",()=>disposed.set(r,disposed.get(r)+1));
  effects.dispose();reference.dispose();assert.ok([...disposed.values()].every(n=>n===1));assert.equal(effects.group.children.length,0);
}
console.log("Blaster surface burst: scoped all-weapon/tier state, shared graphs, matrix/color parity, mixed tails/reuse/wrap and disposal passed.");
const uploadEffects=new CombatVisuals(new THREE.Scene());
const versions=()=>[uploadEffects.surfaceFront,uploadEffects.surfaceCore].flatMap(l=>[l.instanceMatrix.version,l.instanceColor.version]);
const initialVersions=versions();
uploadEffects.impact(position,WEAPONS.rocket_launcher,owner,{normal});uploadEffects.update(1/60);
assert.deepEqual(versions(),initialVersions,"legacy-only activity never uploads dormant surface buffers");
uploadEffects.impact(position,WEAPONS.blaster,owner,{normal});uploadEffects.update(1/60);
assert.ok(versions().every((n,i)=>n>initialVersions[i]));
const activeVersions=versions();uploadEffects.update(2);
assert.ok(versions().every((n,i)=>n>activeVersions[i]),"surface expiry uploads its hidden matrices");
const expiredVersions=versions();uploadEffects.impact(position,WEAPONS.rocket_launcher,owner,{normal});uploadEffects.update(1/60);
assert.deepEqual(versions(),expiredVersions,"subsequent legacy-only activity leaves expired surface buffers dormant");uploadEffects.dispose();
const runtimeEffects=new CombatVisuals(new THREE.Scene()), backend=Object.create({createRenderPipeline(...args){assert.equal(this,backend);return args;}}), originalPipeline=backend.createRenderPipeline;
const runtimeGame={renderer:{backend},paused:true,combatVisuals:runtimeEffects,players:[{...owner,position}],projectiles:[],hazards:[],effects:[],decoys:[]};
const priorCursor={...runtimeEffects.cursors}, priorRandom=runtimeEffects.random, samples=[];
await withSurfaceBurstRuntime(runtimeGame,async state=>{
  if(state.phase==="first-surface")assert.deepEqual(backend.createRenderPipeline(1,"probe"),[1,"probe"]);
  samples.push({...state});verifyTails(runtimeEffects);
});
assert.equal(samples[0].pipelineBuilds,0);assert.equal(samples[1].pipelineBuilds,1);assert.equal(backend.createRenderPipeline,originalPipeline);
assert.equal(Object.hasOwn(backend,"createRenderPipeline"),false,"inherited pipeline method retains original ownership");
assert.deepEqual(samples.map(s=>s.phase),["empty","first-surface","expired","repeat-surface","mixed-112","final-expired"]);
assert.equal(samples[1].surfaceLives,1);assert.equal(samples[4].surfaceLives,56);assert.equal(samples[4].legacyLives,56);
assert.ok(samples.at(-1).counts.every(n=>n===0));assert.deepEqual(runtimeEffects.cursors,priorCursor);assert.equal(runtimeEffects.random,priorRandom);
await assert.rejects(withSurfaceBurstRuntime(runtimeGame,async s=>{if(s.phase==="first-surface")throw Error("interrupted");}),/interrupted/);
verifyTails(runtimeEffects);assert.ok(runtimeEffects.rings.every(s=>s.life<=0));assert.deepEqual(runtimeEffects.cursors,priorCursor);
assert.equal(backend.createRenderPipeline,originalPipeline,"instrumentation restores even on interrupted capture");
assert.equal(Object.hasOwn(backend,"createRenderPipeline"),false);
runtimeGame.paused=false;await assert.rejects(withSurfaceBurstRuntime(runtimeGame,async()=>{}),/paused/);runtimeEffects.dispose();
const qa=readFileSync(new URL("./graphics.browser.html",import.meta.url),"utf8");
const control=new Function(`return ${qa.slice(qa.indexOf("function withSurfaceResourceControl("),qa.indexOf("\nif (withoutSurfaceResources)"))}`)();
const startupEffects=new CombatVisuals(new THREE.Scene());let profileCalls=0;
const apply=control(function(profile){assert.equal(this,startupEffects);assert.equal(profile,"sentinel");profileCalls++;return 73;});
assert.equal(apply.call(startupEffects,"sentinel"),73);assert.equal(profileCalls,1);
assert.equal(startupEffects.surfaceFront.visible,false);assert.equal(startupEffects.surfaceCore.visible,false);
assert.equal(startupEffects.ringOuter.visible,true);assert.equal(startupEffects.ringInner.visible,true);startupEffects.dispose();
