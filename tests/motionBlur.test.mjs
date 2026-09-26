import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CinematicMotionBlur } from '../src/cinematicMotionBlur.js';
import { SoftParticleDepth } from '../src/softParticles.js';
import { loadSettings, saveSettings } from '../src/gameData.js';

const camera = new THREE.PerspectiveCamera(60, 2, .1, 100), depth = new SoftParticleDepth();
const blur = new CinematicMotionBlur(depth, camera);
let width = 800, now = 0;
const renderer = { getDrawingBufferSize: target => target.set(width, 400) };
const tick = (enabled = true, dt = 1000 / 60) => blur.update(renderer, 35, enabled, now += dt);
tick(); tick(); tick(); assert.ok(Math.abs(blur.amount.value - .35) < 1e-9);
camera.position.x += .1; camera.fov += .1;
tick(); assert.ok(blur.amount.value > 0, 'smooth tracking and zoom preserve blur');
camera.position.x += 30; tick(); assert.equal(blur.amount.value, 0, 'teleport clears motion');
tick(); tick(); assert.ok(blur.amount.value > 0);
camera.rotation.y += Math.PI; tick(); assert.equal(blur.amount.value, 0, 'camera cuts clear motion');
tick(); tick(); width = 1000; tick(); assert.equal(blur.amount.value, 0, 'resize clears motion');
tick(); tick(); tick(true, 300); assert.equal(blur.amount.value, 0, 'suspended frames clear motion');
tick(); tick(); tick(false); assert.equal(blur.amount.value, 0, 'reduced motion disables blur');
tick(); assert.equal(blur.amount.value, 0, 're-enable warms current transforms');
tick(); tick(); blur.reset(); assert.equal(blur.amount.value, 0, 'match and tier reset');
assert.equal(depth.target.texture.type, THREE.HalfFloatType, 'signed motion vectors retain direction');
assert.equal(depth.target.samples, 0);
assert.ok(depth.material.fragmentNode, 'shared depth prepass also writes rigid-object velocity');
depth.dispose();

const originalStorage = globalThis.localStorage;
const saved = new Map();
globalThis.localStorage = { getItem:key=>saved.get(key) ?? null, setItem:(key,value)=>saved.set(key,value) };
try {
  assert.equal(loadSettings().motionBlur, 35);
  for (const [input, expected] of [[0,0],[58,58],[1000,100],[-3,0],['invalid',35]]) {
    saveSettings({motionBlur:input}); assert.equal(loadSettings().motionBlur,expected);
  }
} finally { globalThis.localStorage = originalStorage; }
console.log('Motion blur camera cuts, tracking, resize, pause, reduced motion, resets and saved intensity passed.');
