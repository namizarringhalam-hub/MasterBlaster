import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { WEAPONS, graphicsProfile } from "../src/gameData.js";
import { CombatVisuals } from "../src/combatVisuals.js";

const owner={color:0x129dba,accent:0x6ff6ff,aim:new THREE.Vector3(1,0,0)}, position=new THREE.Vector3(2,3,4);
for (const reducedMotion of [false,true]) for (const tier of ["low","medium","high"]) {
const effects=new CombatVisuals(new THREE.Scene(),{reducedMotion}), reference=new CombatVisuals(new THREE.Scene(),{reducedMotion});
effects.setGraphicsProfile(graphicsProfile(tier)); reference.setGraphicsProfile(graphicsProfile(tier));
for(const weapon of Object.values(WEAPONS)) {
  // Deliberately reuse one slot after a Blaster impact to catch leaked scope.
  for(const visual of [effects,reference]) {
    visual.update(2); visual.cursors.ring=0;
    visual.impact(position,WEAPONS.blaster,owner);
    visual.cursors.ring=0; visual.impact(position,weapon,owner);
  }
  assert.equal(effects.rings[0].dissipate,weapon.id==="blaster","pooled scope is overwritten for every weapon");
  reference.rings[0].dissipate=false;
  for(let frame=0;frame<30;frame++) {
    effects.update(1/60); reference.update(1/60);
    for(const key of ["ringOuter","ringInner","sparkLayer"]) {
      assert.equal(effects[key].count,reference[key].count);
      assert.deepEqual(effects[key].instanceMatrix.array,reference[key].instanceMatrix.array);
      if(key==="sparkLayer"||weapon.id!=="blaster"||frame<4)
        assert.deepEqual(effects[key].instanceColor.array,reference[key].instanceColor.array);
    }
    assert.deepEqual(effects.combatLights.map(x=>[x.position.toArray(),x.intensity,x.userData.life]),reference.combatLights.map(x=>[x.position.toArray(),x.intensity,x.userData.life]));
    const slot=effects.rings[0];
    if(weapon.id==="blaster"&&slot.life>0) {
      const factor=1-THREE.MathUtils.smoothstep(1-slot.life/slot.maxLife,.2,1);
      for(const key of ["ringOuter","ringInner"]) for(let channel=0;channel<3;channel++)
        assert.ok(Math.abs(effects[key].instanceColor.array[channel]-reference[key].instanceColor.array[channel]*factor)<1e-7);
    }
  }
}
effects.cursors.ring=0; effects.impact(position,WEAPONS.blaster,owner,{explosive:true});
assert.equal(effects.rings[0].dissipate,false,"the reviewed plasma-ring fade does not affect blast-family variants");
effects.dispose(); reference.dispose();
}
console.log("Blaster ring dissipation: all 47 weapons, tiers/reduced motion, slot reuse, initial cue, matrices, particles and lights passed.");
