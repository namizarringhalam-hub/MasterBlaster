import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { WEAPONS, graphicsProfile } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";

const owner={color:0x129dba,accent:0x6ff6ff,aim:new THREE.Vector3(1,0,0)}, position=new THREE.Vector3(2,3,4);
const aspect=new THREE.Vector3(2**(-1/3),2**(2/3),2**(-1/3));
for(const reducedMotion of [false,true]) for(const tier of ["low","medium","high"]) {
  const effects=new CombatVisuals(new THREE.Scene(),{reducedMotion}), reference=new CombatVisuals(new THREE.Scene(),{reducedMotion});
  effects.setGraphicsProfile(graphicsProfile(tier)); reference.setGraphicsProfile(graphicsProfile(tier));
  for(const weapon of Object.values(WEAPONS)) {
    for(const visual of [effects,reference]) {
      visual.update(2); visual.cursors.spark=0; visual.impact(position,WEAPONS.blaster,owner);
      visual.update(2); visual.cursors.spark=0; visual.impact(position,weapon,owner);
    }
    for(const spark of effects.sparks.filter(s=>s.life>0)) assert.equal(spark.directional,weapon.id==="blaster","classification is overwritten on every impact reuse");
    for(const spark of reference.sparks) spark.directional=false;
    for(let frame=0;frame<40;frame++) {
      effects.update(1/60); reference.update(1/60);
      for(const key of ["ringOuter","ringInner","sparkLayer"]) {
        assert.equal(effects[key].count,reference[key].count);
        assert.deepEqual(effects[key].instanceColor.array,reference[key].instanceColor.array);
        if(key!=="sparkLayer"||weapon.id!=="blaster") assert.deepEqual(effects[key].instanceMatrix.array,reference[key].instanceMatrix.array);
      }
      assert.deepEqual(effects.combatLights.map(l=>[l.position.toArray(),l.intensity,l.userData.life]),reference.combatLights.map(l=>[l.position.toArray(),l.intensity,l.userData.life]));
      for(let i=0;i<effects.sparks.length;i++) {
        const a=effects.sparks[i],b=reference.sparks[i];
        assert.deepEqual([a.life,a.position?.toArray(),a.velocity?.toArray(),a.size,a.family],[b.life,b.position?.toArray(),b.velocity?.toArray(),b.size,b.family]);
        if(!a.directional||a.life<=0) continue;
        const expected=new THREE.Matrix4().fromArray(reference.sparkLayer.instanceMatrix.array,i*16).scale(aspect);
        for(let n=0;n<16;n++) assert.ok(Math.abs(effects.sparkLayer.instanceMatrix.array[i*16+n]-expected.elements[n])<1e-7,"fused matrix agrees with reviewed reference within Float32 rounding");
      }
    }
  }
  effects.cursors.spark=0; effects.impact(position,WEAPONS.blaster,owner,{explosive:true});
  assert.ok(effects.sparks.filter(s=>s.life>0).every(s=>s.directional===false),"explosive variant is excluded");
  for(const emit of [
    v=>v.flameStream(position,owner.aim,WEAPONS.flamethrower,owner,8),
    v=>v.burst(position,0x66ffff,8,{family:"plasma"}),
    v=>v.burst(position,0xff2222,8,{family:"blood"})
  ]) {
    for(const visual of [effects,reference]) {
      visual.update(2); visual.cursors.spark=0; visual.impact(position,WEAPONS.blaster,owner);
      visual.update(2); visual.cursors.spark=0; emit(visual);
      assert.ok(visual.sparks.filter(s=>s.life>0).every(s=>s.directional===false),"flame/burst pool reuse clears impact-only classification");
    }
  }
  effects.dispose(); reference.dispose();
}
console.log("Blaster spark shape: all 47 weapons, H/M/L, reduced motion, impact reuse, exact trajectories/colors/lights and reference matrix parity passed.");
