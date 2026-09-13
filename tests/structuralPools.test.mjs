import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three/webgpu";
import { ArenaWorld } from "../src/world.js";
import { graphicsProfile } from "../src/gameData.js";

// Recorded before the culling correction: every matrix/color byte and physical
// fields listed below must survive the new draw tails and bound refresh.
const goldenWorld=new ArenaWorld(new THREE.Scene(),"POOL-BOUNDS");
const point=new THREE.Vector3(-50,6,-42),bounds={w:5,h:3,d:5};
goldenWorld.spawnStructuralDebris(point,0xc468ff,14,bounds,"golden");
goldenWorld.spawnStructuralDust(point,0xc468ff,18,bounds,"golden");
const hash=createHash("sha256");
for(const dt of [0,1/60,.25,1,3,10]){
  goldenWorld.updateStructuralDebris(dt);
  for(const mesh of [goldenWorld.debrisMesh,goldenWorld.dustMesh])for(const a of [mesh.instanceMatrix.array,mesh.instanceColor.array])hash.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));
  for(const pool of [goldenWorld.debrisParticles,goldenWorld.dustParticles])hash.update(JSON.stringify(pool.map(p=>({active:p.active,life:p.life,maxLife:p.maxLife,
    position:p.position.toArray(),velocity:p.velocity.toArray(),scale:p.scale.toArray(),rotation:p.rotation?.toArray(),contacted:p.contacted}))));
}
assert.equal(hash.digest("hex"),"6cdee2e45c4621ed46096dcbaa41eaa870de7ba49088c1899710f3efb3fa5411");
goldenWorld.dispose();

for(const tier of ["low","medium","high"]){
  const world=new ArenaWorld(new THREE.Scene(),"POOL-BOUNDS");world.setGraphicsProfile(graphicsProfile(tier));
  const pairs=[[world.debrisMesh,world.debrisParticles],[world.dustMesh,world.dustParticles]];
  let refreshes=0;
  for(const [mesh] of pairs){
    assert.equal(mesh.count,0,"inactive pool submits no instances");
    mesh.computeBoundingSphere();
    const compute=mesh.computeBoundingSphere;mesh.computeBoundingSphere=function(){refreshes++;return compute.call(this);};
  }
  const verify=()=>{
    for(const [mesh,pool] of pairs){
      const active=pool.flatMap((p,i)=>p.active?[i]:[]);
      assert.equal(mesh.count,active.length?active.at(-1)+1:0,"draw tail retains sparse stable slot indices");
      const actual=mesh.boundingSphere,geometry=mesh.geometry.boundingSphere,matrix=new THREE.Matrix4();
      for(const index of active){mesh.getMatrixAt(index,matrix);const s=geometry.clone().applyMatrix4(matrix);
        assert.ok(actual.center.distanceTo(s.center)+s.radius<=actual.radius+1e-6,"cached bound contains every moving/expanding instance extent");}
    }
  };
  world.updateStructuralDebris(.1);assert.equal(refreshes,0,"idle update does no bound work");
  for(let cycle=0;cycle<3;cycle++){
    world.debrisCursor=world.dustCursor=126;
    world.spawnStructuralDebris(point,0xc468ff,4,bounds,"wrapped"+cycle);
    world.spawnStructuralDust(point,0xc468ff,4,bounds,"wrapped"+cycle);
    world.updateStructuralDebris(1/60);verify();assert.equal(world.dustMesh.count,128);
    const first=world.dustMesh.boundingSphere.clone();world.updateStructuralDebris(.5);verify();
    assert.ok(!world.dustMesh.boundingSphere.equals(first),"bounds refresh as particles move and expand");
    for(const [,pool] of pairs){pool[126].life=pool[127].life=.001;}
    world.updateStructuralDebris(.01);verify();assert.equal(world.dustMesh.count,2);assert.equal(world.debrisMesh.count,2);
    world.updateStructuralDebris(20);verify();
    for(const [mesh] of pairs)assert.equal(mesh.count,0,"last expiry drops the complete batch");
    const final=refreshes;world.updateStructuralDebris(.1);assert.equal(refreshes,final,"cleaned pool does not refresh repeatedly");
  }
  world.spawnStructuralDebris(point,0xc468ff,4,bounds,"clear");world.spawnStructuralDust(point,0xc468ff,4,bounds,"clear");
  world.updateStructuralDebris(.1);world.clearStructuralTransients();
  for(const [mesh] of pairs){assert.equal(mesh.count,0,"explicit cleanup immediately drops the draw range");assert.ok(mesh.boundingSphere.isEmpty());}
  world.dispose();
}
console.log("Structural pools: exact physical/render payloads, bounded sparse tails, moving bounds, expiry and reuse passed.");
