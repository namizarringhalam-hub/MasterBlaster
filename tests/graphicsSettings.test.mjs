import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { GRAPHICS_EFFECTS, normalizeGraphicsEffects, graphicsEffectUnavailable } from '../src/graphicsEffects.js';
import { NeonRenderPipeline } from '../src/renderPipeline.js';
import { ArenaWorld } from '../src/world.js';
import { Fighter } from '../src/player.js';
import { graphicsProfile, loadSettings, saveSettings } from '../src/gameData.js';
import TEXT from '../src/playerText.js';
import { GRAPHICS_PRESETS, GRAPHICS_OPTIONS, GRAPHICS_VERSION, applyGraphicsPreset, isCustomGraphics, normalizeGraphicsOptions, presetEffects } from '../src/graphicsPresets.js';

const on=normalizeGraphicsEffects(), off=Object.fromEntries(Object.keys(on).map(key=>[key,false]));
assert.equal(Object.keys(on).length,19);
assert.ok(Object.values(on).every(Boolean));
assert.deepEqual(normalizeGraphicsEffects({bloom:false,reflections:'false',unknown:false}),{...on,bloom:false});
assert.equal(graphicsEffectUnavailable('reflections',{nativeWebGPU:false}),'webgpu');
assert.equal(graphicsEffectUnavailable('reflections',{quality:'medium'}),'');
assert.equal(graphicsEffectUnavailable('bloom',{quality:'low'}),'');
assert.equal(graphicsEffectUnavailable('localFog',{shadows:false}),'shadows');
assert.equal(graphicsEffectUnavailable('motionBlur',{reducedMotion:true}),'reduced');
assert.equal(graphicsEffectUnavailable('wetSurfaces',{quality:'low'}),'');
const renderer=native=>({backend:{isWebGPUBackend:native},xr:{enabled:false},getRenderTarget:()=>null,
  getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,getRenderObjectFunction:()=>null,getPixelRatio:()=>1,getMRT:()=>null,
  getClearColor:c=>c.set(0),getClearAlpha:()=>1,getScissorTest:()=>false});
for(const native of [true,false])for(const quality of ['low','medium','high']) {
  const pipeline=new NeonRenderPipeline(renderer(native),new THREE.Scene(),new THREE.PerspectiveCamera(),{quality,effects:off});
  for(const property of ['bloomPass','aoPass','reflectionPass','localFog','contactShadows','heatDistortion','particleDepth','motionBlur'])
    assert.equal(pipeline[property] ?? null,null,`${quality}/${native}: disabled ${property} has no GPU owner`);
  assert.ok(pipeline.outputTargets.length>=1,'the color conversion stage remains even with optional effects off');
  assert.equal(pipeline.outputTargets.at(-1).renderTarget.texture.type,THREE.UnsignedByteType,
    'final output applies the display color transform before post effects are disabled');
  assert.equal(pipeline.temporal,null,'disabling antialiasing removes temporal history');
  assert.equal(Boolean(pipeline.spatial),pipeline.options.renderScale<1,'spatial reconstruction follows the selected internal scale');
  pipeline.setQuality('high');pipeline.setQuality('medium');assert.equal(pipeline.bloomPass,null);
  pipeline.dispose();pipeline.dispose();
}
const withAO=new NeonRenderPipeline(renderer(true),new THREE.Scene(),new THREE.PerspectiveCamera());
let releasedNoise=0;withAO.aoPass._noiseNode.value.addEventListener('dispose',()=>releasedNoise++);
withAO.dispose();withAO.dispose();assert.equal(releasedNoise,1,'live rebuild releases the AO noise texture exactly once');
for (const effect of ['softParticles','motionBlur','heatDistortion','localFog','ambientOcclusion','reflections','contactShadows']) {
  const scene=new THREE.Scene(), key=new THREE.DirectionalLight();key.castShadow=true;scene.add(key);
  const pipeline=new NeonRenderPipeline(renderer(true),scene,new THREE.PerspectiveCamera(),{effects:{...off,[effect]:true}});
  const needsNormal=['ambientOcclusion','reflections','contactShadows'].includes(effect);
  assert.equal(pipeline.scenePass.renderTarget.textures.some(texture=>texture.name==='normal'),needsNormal,
    `${effect}: allocate and write normals only for effects that consume them`);
  assert.equal(pipeline.scenePass.renderTarget.textures.length,1+Number(needsNormal)+Number(effect==='motionBlur'),
    'packed normal, reflectivity and roughness share one attachment');
  pipeline.dispose();
}
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
  const Game=new Function('THREE','TEXT','ui','GRAPHICS_EFFECTS','normalizeGraphicsEffects','graphicsEffectUnavailable','saveSettings','Fighter','GRAPHICS_PRESETS','GRAPHICS_OPTIONS','applyGraphicsPreset','isCustomGraphics',`return ${controller}`)
    (THREE,TEXT,ui,GRAPHICS_EFFECTS,normalizeGraphicsEffects,graphicsEffectUnavailable,saveSettings,Fighter,GRAPHICS_PRESETS,GRAPHICS_OPTIONS,applyGraphicsPreset,isCustomGraphics);
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

// The reviewed recipes and their real render graphs agree, including custom effects on Low.
for (const [level,scale,samples,shadow,aoSamples] of [['low',.5,0,0,16],['medium',.65,0,1024,16],['high',.75,0,2048,16],['ultra',1,0,4096,32]]) {
  const settings={};applyGraphicsPreset(settings,level);
  assert.equal(isCustomGraphics(settings),false);
  assert.deepEqual([settings.graphicsOptions.renderScale,settings.graphicsOptions.msaaSamples,settings.graphicsOptions.shadowMapSize,settings.graphicsOptions.aoSamples],[scale,samples,shadow,aoSamples]);
  assert.equal(graphicsProfile(level,false,1,settings.graphicsOptions).pixelRatio,1,'render scale is applied inside the pipeline, not as a browser pixel ratio');
  const pipeline=new NeonRenderPipeline(renderer(true),new THREE.Scene(),new THREE.PerspectiveCamera(),{
    quality:level,effects:settings.graphicsEffects,options:settings.graphicsOptions});
  assert.equal(pipeline.renderQuality,level==='low'?'medium':'high');
  if(pipeline.aoPass)assert.equal(pipeline.aoPass.samples.value,aoSamples);
  const bloom=pipeline.bloomPass;
  if(bloom)assert.equal(bloom.getResolutionScale(),scale*settings.graphicsOptions.bloomScale);
  pipeline.dispose();
  settings.graphicsOptions.renderScale=.25;assert.equal(isCustomGraphics(settings),true);
  applyGraphicsPreset(settings,level);settings.graphicsEffects.wetSurfaces=false;assert.equal(isCustomGraphics(settings),true);
}
const custom=new NeonRenderPipeline(renderer(true),new THREE.Scene(),new THREE.PerspectiveCamera(),{
  quality:'low',effects:{...presetEffects('low'),ambientOcclusion:true,bloom:true},options:{aoSamples:32,bloomScale:1}});
assert.equal(custom.renderQuality,'high');assert.equal(custom.aoPass.samples.value,32);assert.equal(custom.bloomPass.getResolutionScale(),.5);custom.dispose();
const mediumAO=new NeonRenderPipeline(renderer(true),new THREE.Scene(),new THREE.PerspectiveCamera(),{
  quality:'medium',effects:{...presetEffects('medium'),ambientOcclusion:true}});
assert.equal(mediumAO.bloomPass.strength.value,.36,'enabling AO does not change the preset bloom strength');
assert.equal(mediumAO.bloomPass.radius.value,.25);mediumAO.dispose();
const highBloom=new NeonRenderPipeline(renderer(true),new THREE.Scene(),new THREE.PerspectiveCamera(),{
  quality:'high',effects:{...off,bloom:true}});
assert.equal(highBloom.bloomPass.strength.value,.52,'disabling advanced effects preserves High bloom');
assert.equal(highBloom.bloomPass.radius.value,.3);highBloom.setReducedMotion(true);
assert.equal(highBloom.bloomPass.strength.value,.22);highBloom.dispose();
const webglUltra=new NeonRenderPipeline(renderer(false),new THREE.Scene(),new THREE.PerspectiveCamera(),{quality:'ultra'});
assert.equal(webglUltra.bloomPass.strength.value,.52,'Ultra retains full tier bloom on the compatibility renderer');webglUltra.dispose();
assert.deepEqual(normalizeGraphicsOptions({renderScale:NaN,msaaSamples:8,shadowMapSize:-1},'low'),GRAPHICS_PRESETS.low);
globalThis.localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
try {
  const settings={};applyGraphicsPreset(settings,'low');settings.graphicsEffects.reflections=true;settings.graphicsOptions.ssrScale=1;
  saveSettings(settings);const restored=loadSettings();assert.equal(restored.graphicsVersion,GRAPHICS_VERSION);
  assert.equal(restored.graphicsEffects.reflections,true);assert.equal(restored.graphicsOptions.ssrScale,1);assert.equal(isCustomGraphics(restored),true);
  saveSettings({graphics:'low',graphicsEffects:on});assert.deepEqual(loadSettings().graphicsEffects,presetEffects('low'),'old locked effects do not silently activate in new Low');
} finally {globalThis.localStorage=previousStorage;}
console.log('Four benchmark presets, custom controls, bloom resolution, capability support, migration/persistence and paused-menu wiring passed.');
