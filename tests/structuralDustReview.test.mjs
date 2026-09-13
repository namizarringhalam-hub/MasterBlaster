import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";
import { Fighter, cameraCollisionFirstPerson } from "../src/player.js";
import { CombatVisuals } from "../src/combatVisuals.js";
import * as data from "../src/gameData.js";
import TEXT from "../src/playerText.js";
import { withStructuralDustReview } from "./structuralDustReview.js";

const source=readFileSync(new URL("../src/main.js",import.meta.url),"utf8");
const controller=source.slice(source.indexOf("class BlasterBattle"),source.indexOf("\nconst game = new BlasterBattle"))
  .replaceAll("import.meta.url",JSON.stringify(new URL("../src/main.js",import.meta.url).href));
const bindings={THREE,...data,TEXT,cameraCollisionFirstPerson,clamp:THREE.MathUtils.clamp};
const collapseSource=source.slice(source.indexOf("const STRUCTURAL_COLLAPSE"),source.indexOf("function projectileNeedsLoop"));
const Game=new Function(...Object.keys(bindings),`${collapseSource};return ${controller}`)(...Object.values(bindings));
function fixture(){
  const scene=new THREE.Scene(),world=new ArenaWorld(scene,"FOUNDRY111"),hero=new Fighter(scene,{id:"dust-review",color:0x129dba,accent:0x6ff6ff},["blaster"],new THREE.Vector3(0,15,8));
  world.dustMesh.computeBoundingSphere();world.debrisMesh.computeBoundingSphere();
  const sounds=[],game=Object.assign(Object.create(Game.prototype),{scene,world,players:[hero],paused:true,mode:"training",
    settings:{graphics:"high",reducedMotion:false},camera:new THREE.PerspectiveCamera(62,747/698,.1,520),updateCamera(){},
    cameraYaw:0,cameraPitch:0,cameraFirstPerson:false,cameraFirstPersonRequested:false,cameraClearance:{actual:9,target:9},
    cameraScratch:Object.fromEntries(["forward","flatForward","right","pivot","desired","target","constrained","focus","menuPosition"].map(k=>[k,new THREE.Vector3()])),
    projectiles:[],hazards:[],effects:[],decoys:[],combatVisuals:new CombatVisuals(scene),combatMusicPulse:0,
    sound:{playStructural:(type,...args)=>sounds.push(type)},audioSpatial:p=>p,isOnlineMatch:()=>false});
  game.camera.position.set(3.7,17.1,3.3);game.camera.lookAt(0,16.35,8);game.camera.updateMatrixWorld(true);
  return {game,sounds,dispose(){hero.dispose();game.combatVisuals.dispose();world.dispose();}};
}
for(const gameplay of [false,true]){
  const f=fixture(),{game}=f,world=game.world,hero=game.players[0],updateCamera=game.updateCamera;
  const camera=game.camera.matrixWorld.toArray(),spawn=world.spawnStructuralDust,drain=world.drainStructuralEvents;
  const samples=[];
  await withStructuralDustReview(game,{gameplay},async state=>samples.push(structuredClone(state)));
  assert.equal(samples.length,21);
  assert.deepEqual(samples.filter(s=>s.mode==="current").map(s=>s.age),[0,.25,1,3,6,9,"cleanup"]);
  for(let i=0;i<samples.length;i+=3){
    const [a,b,c]=samples.slice(i,i+3);assert.deepEqual(c,{...a,mode:"restored"});
    const clean=s=>{const x={...s};delete x.mode;delete x.dustMatrices;delete x.dustBounds;return x;};
    assert.deepEqual(clean(b),clean(a),"hidden contribution preserves physics, events, debris, lights, camera and material");
    assert.ok(b.dustMatrices.every(m=>m.matrix.every((v,k)=>v===(k===15?1:0))),"only dust geometry is masked");
  }
  const last=samples.at(-1);assert.equal(last.dust.length,0);assert.equal(last.debris.length,0);
  assert.equal(last.changes.length,0);assert.equal(last.cohorts.length,2);
  assert.deepEqual(last.cohorts.map(c=>c.landing),[false,true]);assert.deepEqual(f.sounds,["warning","break","land"]);
  assert.equal(last.events.filter(e=>e.type==="land").length,1);assert.equal(world.structures[2].segments.length,2,"one real part remains destroyed; this QA scene is consumed");
  assert.equal(game.players[0],hero);assert.equal(game.updateCamera,updateCamera);assert.deepEqual(game.camera.matrixWorld.toArray(),camera);
  assert.equal(world.spawnStructuralDust,spawn);assert.equal(world.drainStructuralEvents,drain);
  await assert.rejects(withStructuralDustReview(game,{},async()=>{}),/fresh/);
  f.dispose();
}
const boundsFixture=fixture(),boundsSamples=[];
await withStructuralDustReview(boundsFixture.game,{diagnostic:"bounds"},async s=>boundsSamples.push(structuredClone(s)));
for(let i=0;i<boundsSamples.length;i+=3){
  const [a,b,c]=boundsSamples.slice(i,i+3),clean=s=>{const x={...s};delete x.mode;delete x.dustBounds;return x;};
  assert.deepEqual(clean(a),clean(b));assert.deepEqual(c,{...a,mode:"restored"});
  assert.deepEqual(b.dustBounds,a.dustBounds,"product already maintains the same freshly computed bound");
  if(a.dust.length){assert.ok(a.dustBounds.visibleInstances>0,"actual dust lies in this frustum");assert.equal(a.dustBounds.cached.inFrustum,true);}
}
boundsFixture.dispose();
const cameraFixture=fixture(),cameraSamples=[];
await withStructuralDustReview(cameraFixture.game,{diagnostic:"camera"},async s=>cameraSamples.push(structuredClone(s)));
for(let i=0;i<cameraSamples.length;i+=3){
  const [a,b,c]=cameraSamples.slice(i,i+3),clean=s=>{const x={...s};for(const k of ["mode","cameraMatrix","dustBounds","debrisBounds"])delete x[k];return x;};
  assert.equal(b.mode,"camera-away");assert.notDeepEqual(b.cameraMatrix,a.cameraMatrix);
  assert.deepEqual(clean(a),clean(b));assert.deepEqual(c,{...a,mode:"restored"});
}
cameraFixture.dispose();
for(const gameplay of [false,true]){
  const f=fixture(),mesh=f.game.world.dustMesh,material=mesh.material,geometry=mesh.geometry,profiles=new Map(),samples=[];
  let originalDisposals=0;material.addEventListener("dispose",()=>originalDisposals++);
  await withStructuralDustReview(f.game,{gameplay,diagnostic:"profile"},async s=>{
    samples.push(structuredClone(s));assert.equal(mesh.geometry,geometry);
    assert.equal(s.dustColorStream.count,128);assert.equal(s.dustColorStream.itemSize,3);assert.equal(s.dustColorStream.values.length,384);
    if(["constant-one","soft-edge"].includes(s.mode)){
      assert.equal(mesh.instanceColor,null,"profile reproduces the published cached shader without binding the later-created color stream");
      assert.equal(s.dustRenderInstanceColors,false);
      assert.notEqual(mesh.material,material);assert.ok(mesh.material.opacityNode?.isNode);
      if(!profiles.has(mesh.material)){profiles.set(mesh.material,0);const owned=mesh.material;owned.addEventListener("dispose",()=>profiles.set(owned,profiles.get(owned)+1));}
      for(const k of ["opacity","blending","depthWrite","depthTest","transparent","toneMapped","side","vertexColors","flatShading"])
        assert.equal(mesh.material[k],material[k],`profile preserves ${k}`);
      assert.ok(mesh.material.color.equals(material.color));
    }else {assert.equal(mesh.material,material);assert.ok(mesh.instanceColor);assert.equal(s.dustRenderInstanceColors,true);}
  });
  assert.equal(samples.length,28);assert.equal(profiles.size,2);assert.deepEqual([...profiles.values()],[1,1]);
  assert.equal(originalDisposals,0);assert.equal(mesh.material,material);
  for(let i=0;i<samples.length;i+=4){
    const [a,b,c,d]=samples.slice(i,i+4),clean=s=>({...s,mode:"ignored",dustRenderInstanceColors:"explicit-no-color-graph-control",dustMaterial:{...s.dustMaterial,type:"ignored"}});
    assert.deepEqual([a.mode,b.mode,c.mode,d.mode],["current","constant-one","soft-edge","restored"]);
    assert.deepEqual(clean(a),clean(b));assert.deepEqual(clean(a),clean(c));assert.deepEqual(d,{...a,mode:"restored"});
  }
  f.dispose();
}
for(const failMode of ["constant-one","soft-edge","soft-grey","authored-tint"]){
  const f=fixture(),mesh=f.game.world.dustMesh,material=mesh.material,owned=new Map();let colors,version,bytes,count,bound;
  await assert.rejects(withStructuralDustReview(f.game,{diagnostic:["soft-grey","authored-tint"].includes(failMode)?"tint":"profile"},async s=>{
    if(s.mode==="current"){colors=mesh.instanceColor;version=colors.version;bytes=Array.from(colors.array);count=mesh.count;bound=mesh.boundingSphere.clone();}
    if(mesh.material!==material&&!owned.has(mesh.material)){const m=mesh.material;owned.set(m,0);m.addEventListener("dispose",()=>owned.set(m,owned.get(m)+1));}
    if(s.mode===failMode)throw Error("profile interrupted");
  }),/profile interrupted/);
  assert.equal(mesh.material,material);assert.equal(mesh.instanceColor,colors);assert.equal(colors.version,version);assert.deepEqual(Array.from(colors.array),bytes);
  assert.equal(mesh.count,count);assert.ok(mesh.boundingSphere.equals(bound));assert.ok([...owned.values()].every(n=>n===1));f.dispose();
}
const compileFixture=fixture(),compileMesh=compileFixture.game.world.dustMesh,compileMaterial=compileMesh.material,compileSamples=[],compileOwned=new Map();
await withStructuralDustReview(compileFixture.game,{diagnostic:"compile"},async s=>{
  compileSamples.push(structuredClone(s));
  if(s.mode==="fresh-basic"||s.mode==="fresh-node"){
    const m=compileMesh.material;assert.notEqual(m,compileMaterial);
    assert.equal(Boolean(m.isNodeMaterial),s.mode==="fresh-node");assert.equal(m.opacityNode??null,null);
    if(s.mode==="fresh-basic")assert.notEqual(m.customProgramCacheKey(),compileMaterial.customProgramCacheKey(),"force a fresh shader rather than reusing the original equivalent-material graph");
    if(!compileOwned.has(m)){compileOwned.set(m,0);m.addEventListener("dispose",()=>compileOwned.set(m,compileOwned.get(m)+1));}
  }else assert.equal(compileMesh.material,compileMaterial);
});
assert.equal(compileSamples.length,28);assert.deepEqual([...compileOwned.values()],[1,1]);assert.equal(compileMesh.material,compileMaterial);
for(let i=0;i<compileSamples.length;i+=4){
  const [a,b,c,d]=compileSamples.slice(i,i+4),clean=s=>({...s,mode:"ignored",dustMaterial:{...s.dustMaterial,type:"ignored"}});
  assert.deepEqual([a.mode,b.mode,c.mode,d.mode],["current","fresh-basic","fresh-node","restored"]);
  assert.deepEqual(clean(a),clean(b));assert.deepEqual(clean(a),clean(c));assert.deepEqual(d,{...a,mode:"restored"});
}
compileFixture.dispose();
const tintFixture=fixture(),tintMesh=tintFixture.game.world.dustMesh,tintMaterial=tintMesh.material,tintSamples=[];
await withStructuralDustReview(tintFixture.game,{diagnostic:"tint",gameplay:true},async s=>{
  tintSamples.push(structuredClone(s));
  if(s.mode==="soft-grey"){assert.equal(tintMesh.instanceColor,null);assert.ok(tintMesh.material.color.equals(tintMaterial.color));}
  if(s.mode==="authored-tint"){assert.ok(tintMesh.instanceColor);assert.equal(tintMesh.material.color.getHex(),0xffffff);}
});
assert.equal(tintSamples.length,28);
for(let i=0;i<28;i+=4){
  const [a,b,c,d]=tintSamples.slice(i,i+4),clean=s=>({...s,mode:"ignored",dustRenderInstanceColors:"intentional-color-binding",dustMaterial:{...s.dustMaterial,type:"ignored",color:"intentional-rgb-comparison"}});
  assert.deepEqual([a.mode,b.mode,c.mode,d.mode],["current","soft-grey","authored-tint","restored"]);
  assert.deepEqual(clean(a),clean(b));assert.deepEqual(clean(a),clean(c));assert.deepEqual(d,{...a,mode:"restored"});
}
assert.equal(tintMesh.material,tintMaterial);assert.ok(tintMesh.instanceColor);tintFixture.dispose();
for(const diagnostic of ["bounds","camera"]){
  const f=fixture(),camera=f.game.camera.matrixWorld.toArray();let bound,copy;
  await assert.rejects(withStructuralDustReview(f.game,{diagnostic},async s=>{
    if(s.mode==="current"){bound=f.game.world.dustMesh.boundingSphere;copy=bound.clone();}
    else throw Error("probe interrupted");
  }),/probe interrupted/);
  assert.equal(f.game.world.dustMesh.boundingSphere,bound);assert.ok(bound.equals(copy));
  assert.deepEqual(f.game.camera.matrixWorld.toArray(),camera);f.dispose();
}
const failed=fixture(),method=failed.game.world.spawnStructuralDust;
await assert.rejects(withStructuralDustReview(failed.game,{},async state=>{if(state.mode==="dust-hidden")throw Error("capture interrupted");}),/capture interrupted/);
assert.equal(failed.game.world.spawnStructuralDust,method);
assert.ok(failed.game.world.dustMesh.instanceMatrix.array.some((n,i)=>i%16!==15&&n!==0),"interrupted mask restores actual live dust");
failed.dispose();
const html=readFileSync(new URL("./graphics.browser.html",import.meta.url),"utf8");
const runner=html.slice(html.indexOf("async function runStructuralDustReview("),html.indexOf("function makeTrailShading("));
const freezeSource=html.slice(html.indexOf("async function withFrozenShaderTime("),html.indexOf("async function runWallImpactReview("));
const runFixture=fixture(),links=[],controls=[{disabled:false},{disabled:true}],review={running:false};
runFixture.game.renderPipeline={direct:false,profile:"unit-test-no-renderer"};
runFixture.game.renderer={info:{render:{drawCalls:0,triangles:0},memory:{}}};
const elements={"dust-gameplay":{checked:true},"dust-diagnostic":{value:"profile"},"camera-captures":{replaceChildren:()=>{links.length=0;},append:link=>links.push(link)}};
const document={querySelectorAll:()=>controls,createElement:()=>({dataset:{}}),querySelector:()=>({toDataURL:()=>"unit-test-only"})};
const makeRunner=(stress=false,fail=false)=>new Function("game","withStructuralDustReview","select","document","cameraReview","stress","fail",`
  const withoutSurfaceResources=false,resetReview={},cacheReview={},decoyReview={},sceneSerial=1,resetPhase="ready",errorCount=0,innerWidth=747,innerHeight=698,devicePixelRatio=1;
  let renderedFrames=0;const shaderTime={value:17,update(){}};${freezeSource}
  const waitForReviewFrame=async(serial,predicate)=>{if(fail)throw Error("render interrupted");renderedFrames+=4;if(!predicate())throw Error("unready");};
  ${runner};return runStructuralDustReview;
`)(runFixture.game,withStructuralDustReview,id=>elements[id],document,review,stress,fail);
await makeRunner(true)();assert.match(review.error,/Stop stress/);assert.equal(links.length,0);
await makeRunner()();assert.equal(review.error,null);assert.equal(links.length,28);assert.equal(review.running,false);assert.equal(review.shell,false);
const stamp=JSON.parse(links[0].dataset.review);assert.equal(stamp.gameplay,true);assert.equal(stamp.shaderClockSeconds,3);assert.equal(stamp.mode,"current");
assert.equal(stamp.diagnostic,"profile");assert.equal(JSON.parse(links[1].dataset.review).mode,"constant-one");
assert.equal(JSON.parse(links[2].dataset.review).mode,"soft-edge");assert.equal(JSON.parse(links[3].dataset.review).mode,"restored");
assert.deepEqual(controls.map(c=>c.disabled),[false,true]);
review.samples[0].cohorts[0].landing=true;assert.equal(JSON.parse(links[0].dataset.review).cohorts[0].landing,false,"saved stamp is immutable");
runFixture.dispose();
console.log("Structural dust QA: genuine fracture/landing, fixed ages, isolated masking and cleanup passed.");
