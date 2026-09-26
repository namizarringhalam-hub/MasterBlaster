import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GRAPHICS_EFFECTS, normalizeGraphicsEffects, graphicsEffectUnavailable } from '../src/graphicsEffects.js';
import { NeonRenderPipeline } from '../src/renderPipeline.js';
import { ArenaWorld } from '../src/world.js';
import { Fighter } from '../src/player.js';
import { graphicsProfile, loadSettings, saveSettings } from '../src/gameData.js';
import TEXT from '../src/playerText.js';

const on=normalizeGraphicsEffects(), off=Object.fromEntries(Object.keys(on).map(key=>[key,false]));
assert.equal(Object.keys(on).length,19);
assert.ok(Object.values(on).every(Boolean));
assert.deepEqual(normalizeGraphicsEffects({bloom:false,reflections:'false',unknown:false}),{...on,bloom:false});
assert.equal(graphicsEffectUnavailable('reflections',{nativeWebGPU:false}),'webgpu');
assert.equal(graphicsEffectUnavailable('reflections',{quality:'medium'}),'high');
assert.equal(graphicsEffectUnavailable('bloom',{quality:'low'}),'medium');
assert.equal(graphicsEffectUnavailable('motionBlur',{reducedMotion:true}),'reduced');
assert.equal(graphicsEffectUnavailable('wetSurfaces',{quality:'low'}),'');
const renderer=native=>({backend:{isWebGPUBackend:native},xr:{enabled:false},getRenderTarget:()=>null,
  getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,getRenderObjectFunction:()=>null,getPixelRatio:()=>1,getMRT:()=>null,
  getClearColor:c=>c.set(0),getClearAlpha:()=>1,getScissorTest:()=>false});
for(const native of [true,false])for(const quality of ['low','medium','high']) {
  const pipeline=new NeonRenderPipeline(renderer(native),new THREE.Scene(),new THREE.PerspectiveCamera(),{quality,effects:off});
  for(const property of ['bloomPass','highLoadBloom','aoPass','reflectionPass','localFog','contactShadows','heatDistortion','particleDepth','motionBlur'])
    assert.equal(pipeline[property],null,`${quality}/${native}: disabled ${property} has no GPU owner`);
  assert.equal(pipeline.outputTargets.length,0,'no FXAA/blur intermediates when disabled');
  pipeline.setQuality('high');pipeline.setQuality('medium');assert.equal(pipeline.bloomPass,null);
  pipeline.dispose();pipeline.dispose();
}
const withAO=new NeonRenderPipeline(renderer(true),new THREE.Scene(),new THREE.PerspectiveCamera());
let releasedNoise=0;withAO.aoPass._noiseNode.value.addEventListener('dispose',()=>releasedNoise++);
withAO.dispose();withAO.dispose();assert.equal(releasedNoise,1,'live rebuild releases the AO noise texture exactly once');
const world=new ArenaWorld(new THREE.Scene());world.setGraphicsProfile(graphicsProfile('high'));
const obstacles=[...world.obstacles], camera=new THREE.PerspectiveCamera();
world.setGraphicsEffects(off);world.time=10;world.updatePresentation(camera);
assert.equal(world.wetStrength.value,0);assert.equal(world.hazeStrength.value,0);
assert.equal(world.waterLightStrength.value,0);assert.equal(world.atmosphere.steps.value,0);
assert.equal(world.motes.geometry.drawRange.count,0);assert.equal(world.lightShafts.count,0);assert.equal(world.atmosphereTime.value,0);
world.setGraphicsProfile(graphicsProfile('medium'));assert.equal(world.atmosphere.steps.value,0);
world.setGraphicsEffects(on);world.updatePresentation(camera);
assert.equal(world.atmosphere.steps.value,6);assert.equal(world.lightShafts.count,2);assert.equal(world.atmosphereTime.value,10);
assert.deepEqual(world.obstacles,obstacles,'live switches preserve collision objects');world.dispose();

const previousStorage=globalThis.localStorage, stored=new Map();
globalThis.localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
try {
  saveSettings({graphicsEffects:off});assert.deepEqual(loadSettings().graphicsEffects,off);
  saveSettings({graphicsEffects:{bloom:false}});assert.deepEqual(loadSettings().graphicsEffects,{...on,bloom:false});
  const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const controller=source.slice(source.indexOf('class BlasterBattle'),source.indexOf('\nconst game = new BlasterBattle')).replaceAll('import.meta.url','"test"');
  const ui={querySelector:()=>null,querySelectorAll:()=>[]};
  const Game=new Function('THREE','TEXT','ui','GRAPHICS_EFFECTS','normalizeGraphicsEffects','graphicsEffectUnavailable','saveSettings','Fighter',`return ${controller}`)
    (THREE,TEXT,ui,GRAPHICS_EFFECTS,normalizeGraphicsEffects,graphicsEffectUnavailable,saveSettings,Fighter);
  const game=Object.create(Game.prototype);game.settings=loadSettings();game.paused=true;
  const input={dataset:{graphicsEffect:'reflections'},checked:false};
  assert.equal(game.changeGraphicsPreference(input),true);
  assert.equal(game.pendingPipelineEffects,true);assert.equal(loadSettings().graphicsEffects.reflections,false);
  assert.equal(game.paused,true,'toggling never resumes or replaces a match');
  game.pendingPipelineEffects=false;
  game.changeGraphicsPreference({dataset:{graphicsEffect:'clouds'},checked:false});
  assert.equal(game.pendingPipelineEffects,false,'world uniforms do not rebuild the render graph');
  assert.equal((game.graphicsControlsMarkup().match(/data-graphics-effect=/g)||[]).length,19);
  let modal;game.showModal=(html,options)=>modal={html,options};game.showGraphicsSettings();
  assert.equal(modal.options.kind,'graphics');assert.equal(modal.options.cancel,'close');
  assert.match(modal.html,/data-action="close-controls"/);
  game.scene=new THREE.Scene();game.controlsNetworkPlayer=()=>false;
  const joining=game.createOnlineFighter({id:'joining',name:'Joining',color:0x227799,accent:0x55ddff,loadout:['blaster']},new THREE.Vector3());
  assert.equal(joining.graphicsEffects,game.settings.graphicsEffects,'late arrivals inherit current animation preferences');joining.dispose();
} finally { globalThis.localStorage=previousStorage; }
console.log('19 live graphics preferences: migration, persistence, tier support, disabled GPU passes, world restoration and paused-menu wiring passed.');
