import * as THREE from "three/webgpu";
import { materialOpacity, normalViewGeometry, positionViewDirection } from "three/tsl";
import { Fighter } from "../src/player.js";

// QA only: consumes one fresh training scene through the genuine collapse path.
// The structure stays destroyed; reset the fixture before another run. This is
// not a weapon/damage test. No synthetic dust, suppressed landing or live match.
export async function withStructuralDustReview(game, { gameplay = false, diagnostic = "hide" } = {}, capture) {
  if(!["hide","bounds","camera","profile","compile"].includes(diagnostic))throw Error("Unknown dust diagnostic");
  const materialComparison=diagnostic==="profile"||diagnostic==="compile";
  const world=game.world,v=game.combatVisuals,original=game.players[0];
  const pools=[v.flashes,v.tracers,v.rings,v.sparks,v.bloodDecals];
  if(game.mode!=="training"||game.isOnlineMatch()||!game.paused||!original||world.collapseSerial||world.structuralChanges.length||
      world.dustParticles.some(p=>p.active)||world.debrisParticles.some(p=>p.active)||
      game.projectiles.length||game.hazards.length||game.effects.length||game.decoys.length||pools.some(p=>p.some(s=>s.life>0))||
      v.combatLights.some(l=>l.userData.life>0||l.intensity>1e-10))
    throw Error("Structural dust review requires a fresh, paused training scene without transients");
  const structure=world.structures[2],part=structure?.segments[0];
  if(!part||!structure.platformChunks.length)throw Error("Dust review needs the original third tower and its real landing deck");
  const saved={updateCamera:game.updateCamera,visible:original.group.visible,camera:game.camera.position.clone(),quaternion:game.camera.quaternion.clone(),
    fov:game.camera.fov,yaw:game.cameraYaw,pitch:game.cameraPitch,first:game.cameraFirstPerson,requested:game.cameraFirstPersonRequested,
    clearance:{...game.cameraClearance},scratch:Object.fromEntries(Object.entries(game.cameraScratch).map(([k,x])=>[k,x.clone()]))};
  const descriptors=Object.fromEntries(["spawnStructuralDust","drainStructuralEvents"].map(k=>[k,Object.getOwnPropertyDescriptor(world,k)]));
  const spawn=world.spawnStructuralDust,drain=world.drainStructuralEvents;
  const target=new THREE.Vector3(structure.x,part.baseY+part.h/2,structure.z);
  const position=target.clone().add(new THREE.Vector3(18,0,18));position.y=world.surfaceHeightAt(position,.5)+.01;
  const hero=new Fighter(game.scene,{id:original.id,name:original.name,color:original.color,accent:original.accent},["blaster"],position);
  const cohorts=[],events=[],owned=new Set();let frame=0,firstDustFrame=-1;
  const originalDustMaterial=world.dustMesh.material,profileMaterials=[];
  let suspendedDustColors=null;
  const matrix=new THREE.Matrix4(),hidden=new THREE.Matrix4().makeScale(0,0,0);
  const boundsState=mesh=>{
    mesh.updateWorldMatrix(true,false);
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(game.camera.projectionMatrix,game.camera.matrixWorldInverse),game.camera.coordinateSystem);
    const sphere=mesh.boundingSphere;
    const cached=sphere?{center:sphere.center.toArray(),radius:sphere.radius,inFrustum:frustum.intersectsSphere(sphere.clone().applyMatrix4(mesh.matrixWorld))}:null;
    // Read actual instance extents without updating the cached object bound.
    if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();
    const slots=mesh===world.dustMesh?world.dustParticles:world.debrisParticles;
    let visibleInstances=0;
    slots.forEach((p,i)=>{if(!p.active)return;mesh.getMatrixAt(i,matrix);const s=mesh.geometry.boundingSphere.clone().applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);if(frustum.intersectsSphere(s))visibleInstances++;});
    return {frustumCulled:mesh.frustumCulled,cached,visibleInstances};
  };
  const layerState=(mesh,indices)=>{
    const colors=mesh.instanceColor||(mesh===world.dustMesh?suspendedDustColors:null);
    return indices.map(index=>({index,matrix:Array.from(mesh.instanceMatrix.array.slice(index*16,index*16+16)),
      color:colors?Array.from(colors.array.slice(index*3,index*3+3)):null}));
  };
  const particleState=(p,index)=>({index,active:p.active,life:p.life,maxLife:p.maxLife,position:p.position.toArray(),velocity:p.velocity.toArray(),
    scale:p.scale.toArray(),rotation:p.rotation?.toArray(),contacted:p.contacted,eventId:p.eventId});
  const colorStream=()=>{
    const a=world.dustMesh.instanceColor||suspendedDustColors;
    return a?{id:a.id,uuid:a.uuid??null,type:a.array.constructor.name,count:a.count,itemSize:a.itemSize,normalized:a.normalized,version:a.version,values:Array.from(a.array)}:null;
  };
  const state=(age,mode)=>({age,mode,simulationTime:frame/60,firstDustStep:firstDustFrame/60,workload:"genuine-structural-failure-not-weapon-damage",
    gameplay,diagnostic,structureId:structure.id,partId:part.structuralId,events:structuredClone(events),cohorts:structuredClone(cohorts),
    dust:world.dustParticles.flatMap((p,i)=>p.active?[particleState(p,i)]:[]),dustMatrices:layerState(world.dustMesh,[...owned]),
    debris:world.debrisParticles.flatMap((p,i)=>p.active?[particleState(p,i)]:[]),
    debrisMatrices:layerState(world.debrisMesh,world.debrisParticles.flatMap((p,i)=>p.active?[i]:[])),
    dustMaterial:{type:world.dustMesh.material.type,color:world.dustMesh.material.color.toArray(),opacity:world.dustMesh.material.opacity,
      blending:world.dustMesh.material.blending,depthWrite:world.dustMesh.material.depthWrite,toneMapped:world.dustMesh.material.toneMapped},
    dustCount:world.dustMesh.count,debrisCount:world.debrisMesh.count,dustBounds:boundsState(world.dustMesh),debrisBounds:boundsState(world.debrisMesh),
    dustRenderInstanceColors:Boolean(world.dustMesh.instanceColor),
    dustColorStream:colorStream(),
    changes:world.structuralChanges.map(c=>({id:c.id,phase:c.phase,elapsed:c.elapsed})),
    combat:pools.map(pool=>pool.filter(s=>s.life>0).map(s=>({life:s.life,position:s.position?.toArray(),velocity:s.velocity?.toArray()}))),
    lights:v.combatLights.map(l=>({position:l.position.toArray(),intensity:l.intensity,life:l.userData.life})),
    cameraMatrix:game.camera.matrixWorld.toArray(),projection:game.camera.projectionMatrix.toArray(),cameraClearance:{...game.cameraClearance}});
  const sample=async age=>{
    await capture(state(age,"current"));
    const matrices=[...owned].map(index=>{world.dustMesh.getMatrixAt(index,matrix);return [index,matrix.clone()];});
    const bound=world.dustMesh.boundingSphere,boundCopy=bound?.clone();
    const cameraQuaternion=game.camera.quaternion.clone();
    try{
      if(materialComparison){
        for(let i=0;i<profileMaterials.length;i++){
          const colors=world.dustMesh.instanceColor;
          try{
            if(diagnostic==="profile"){
              if(!game.paused||!colors)throw Error("Dust profile requires paused simulation and its saved color stream");
              // QA control: the published graph was cached before first-spawn colors existed.
              // Preserve their bytes, but render each trial with that same no-color graph.
              suspendedDustColors=colors;world.dustMesh.instanceColor=null;
            }
            world.dustMesh.material=profileMaterials[i];
            await capture(state(age,(diagnostic==="compile"?["fresh-basic","fresh-node"]:["constant-one","soft-edge"])[i]));
          }finally{
            world.dustMesh.material=originalDustMaterial;world.dustMesh.instanceColor=colors;suspendedDustColors=null;
          }
        }
      }
      else if(diagnostic==="bounds")world.dustMesh.computeBoundingSphere();
      else if(diagnostic==="camera"){game.camera.rotateY(Math.PI);game.camera.updateMatrixWorld(true);}
      else{for(const [index] of matrices)world.dustMesh.setMatrixAt(index,hidden);world.dustMesh.instanceMatrix.needsUpdate=true;}
      if(!materialComparison)await capture(state(age,diagnostic==="bounds"?"fresh-bounds":diagnostic==="camera"?"camera-away":"dust-hidden"));
    }finally{
      if(materialComparison){
        world.dustMesh.material=originalDustMaterial;
        if(suspendedDustColors){world.dustMesh.instanceColor=suspendedDustColors;suspendedDustColors=null;}
      }
      else if(diagnostic==="bounds"){world.dustMesh.boundingSphere=bound;if(bound)bound.copy(boundCopy);}
      else if(diagnostic==="camera"){game.camera.quaternion.copy(cameraQuaternion);game.camera.updateMatrixWorld(true);}
      else{for(const [index,m] of matrices)world.dustMesh.setMatrixAt(index,m);world.dustMesh.instanceMatrix.needsUpdate=true;}
    }
    await capture(state(age,"restored"));
  };
  try{
    if(diagnostic==="compile"){
      const fresh=originalDustMaterial.clone();profileMaterials.push(fresh);
      // Equal classic material properties otherwise reuse the original cached node graph.
      fresh.customProgramCacheKey=()=>"qa-structural-dust-fresh-classic";
      profileMaterials.push(new THREE.MeshBasicNodeMaterial().copy(originalDustMaterial));
    }else if(diagnostic==="profile"){
      const control=new THREE.MeshBasicNodeMaterial().copy(originalDustMaterial);profileMaterials.push(control);
      control.opacityNode=materialOpacity.mul(1);
      const soft=control.clone();profileMaterials.push(soft);
      // These accessors normalize interpolated geometry normals and perspective view direction.
      soft.opacityNode=materialOpacity.mul(normalViewGeometry.dot(positionViewDirection).clamp(0,1).pow(2));
    }
    world.spawnStructuralDust=function(...args){
      const start=this.dustCursor,result=spawn.apply(this,args),indices=[];
      for(let cursor=start;cursor<this.dustCursor;cursor++){const index=cursor%this.dustParticles.length;owned.add(index);indices.push(index);}
      if(firstDustFrame<0)firstDustFrame=frame;
      cohorts.push({eventSeed:args[4],landing:Boolean(args[5]),birthStep:frame/60,indices,
        maxLives:indices.map(i=>this.dustParticles[i].maxLife)});
      return result;
    };
    world.drainStructuralEvents=function(){const result=drain.call(this);for(const e of result)events.push({type:e.type,id:e.id,
      simulationTime:frame/60,position:e.position?.toArray(),structureId:e.structureId});return result;};
    original.group.visible=false;game.players[0]=hero;game.updateCamera=()=>{};
    hero.aim.copy(target).sub(hero.position.clone().add(new THREE.Vector3(0,1.05,0))).normalize();
    hero.group.rotation.y=Math.atan2(hero.aim.x,hero.aim.z);
    const clock=Object.getOwnPropertyDescriptor(performance,"now");
    try{Object.defineProperty(performance,"now",{configurable:true,value:()=>1000});hero.update(0,new THREE.Vector3(),hero.aim,{},world);}
    finally{if(clock)Object.defineProperty(performance,"now",clock);else delete performance.now;}
    hero.group.updateMatrixWorld(true);
    if(gameplay){
      game.cameraYaw=Math.atan2(hero.aim.x,hero.aim.z);game.cameraPitch=Math.asin(hero.aim.y);
      game.cameraFirstPerson=false;game.cameraFirstPersonRequested=false;
      for(let i=0;i<240;i++)Object.getPrototypeOf(game).updateCamera.call(game,1/60);
    }else{game.camera.position.copy(target).add(new THREE.Vector3(18,10,20));game.camera.lookAt(target.x,target.y+3,target.z);game.camera.fov=62;game.camera.updateProjectionMatrix();}
    game.camera.updateMatrixWorld(true);
    if(!world.queueStructuralFailure(part,hero.id))throw Error("Genuine structural failure was not accepted");
    const sampleFrames=new Set([0,15,60,180,360,540]);let completed=false;
    for(frame=1;frame<=900;frame++){
      world.update(1/60,[]);game.processStructuralEvents();game.updateEffects(1/60);v.update(1/60);
      if(firstDustFrame>=0&&sampleFrames.has(frame-firstDustFrame))await sample((frame-firstDustFrame)/60);
      if(firstDustFrame>=0&&frame-firstDustFrame>540&&!world.structuralChanges.length&&!world.dustParticles.some(p=>p.active)&&!world.debrisParticles.some(p=>p.active)){
        if(!cohorts.some(c=>c.landing))throw Error("Real landing-generated dust was not observed");
        await sample("cleanup");completed=true;break;
      }
    }
    if(!completed)throw Error("Structural dust did not clean up within 15 simulated seconds");
  }finally{
    if(suspendedDustColors)world.dustMesh.instanceColor=suspendedDustColors;
    world.dustMesh.material=originalDustMaterial;for(const material of profileMaterials)material.dispose();
    for(const key of Object.keys(descriptors))if(descriptors[key])Object.defineProperty(world,key,descriptors[key]);else delete world[key];
    hero.dispose();game.players[0]=original;original.group.visible=saved.visible;game.updateCamera=saved.updateCamera;
    game.camera.position.copy(saved.camera);game.camera.quaternion.copy(saved.quaternion);game.camera.fov=saved.fov;
    game.cameraYaw=saved.yaw;game.cameraPitch=saved.pitch;game.cameraFirstPerson=saved.first;game.cameraFirstPersonRequested=saved.requested;
    game.cameraClearance=saved.clearance;for(const [key,x] of Object.entries(saved.scratch))game.cameraScratch[key].copy(x);
    game.camera.updateProjectionMatrix();game.camera.updateMatrixWorld(true);
  }
}
