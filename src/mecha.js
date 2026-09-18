import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Cross sections author the volume, not just the front outline: shoulders taper
// on all three axes, breastplates have a prow, and calves flare behind the shin.
// Each ring is [height, width, depth, fore/aft offset, corner fraction].
function shell(rings) {
  const vertices = rings.map(([y, w, d, z = 0, c = .23]) => {
    const x = w / 2, f = d / 2;
    return [[-x*(1-c),y,z+f],[x*(1-c),y,z+f],[x,y,z+f*(1-c)],
      [x,y,z-f*(1-c)],[x*(1-c),y,z-f],[-x*(1-c),y,z-f],[-x,y,z-f*(1-c)],[-x,y,z+f*(1-c)]];
  });
  const positions = [], uv = [];
  const triangle = (a,b,c) => { positions.push(...a,...b,...c); uv.push(a[0],a[1],b[0],b[1],c[0],c[1]); };
  for (let r=0;r<rings.length-1;r++) for(let i=0;i<8;i++) {
    const j=(i+1)%8; triangle(vertices[r][i],vertices[r][j],vertices[r+1][j]);
    triangle(vertices[r][i],vertices[r+1][j],vertices[r+1][i]);
  }
  for (let i=1;i<7;i++) {
    triangle(vertices[0][0],vertices[0][i+1],vertices[0][i]);
    const top=vertices.at(-1); triangle(top[0],top[i],top[i+1]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.computeVertexNormals();
  return geometry;
}
function plate(outline, depth, bevel = .006) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(shape, {depth,steps:1,bevelEnabled:bevel>0,bevelSegments:1,
    bevelSize:bevel,bevelThickness:bevel,curveSegments:1}).translate(0,0,-depth/2);
}
function panel(w,h,d,cut=.15) {
  const x=w/2,y=h/2,c=Math.min(w,h)*cut;
  return plate([[-x+c,y],[x-c,y],[x,y-c],[x,-y+c],[x-c,-y],[-x+c,-y],[-x,-y+c],[-x,y-c]],d,Math.min(.005,d*.12));
}
function assembly(material,name,author) {
  const pieces=[];
  const add=(geometry,color,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{
    const source=geometry.index?geometry.toNonIndexed():geometry;
    if(source!==geometry)geometry.dispose();
    source.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)),new THREE.Vector3(1,1,1)));
    const paint=new THREE.Color(color),colors=new Float32Array(source.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3){colors[i]=paint.r;colors[i+1]=paint.g;colors[i+2]=paint.b;}
    source.setAttribute("color",new THREE.BufferAttribute(colors,3));pieces.push(source);
  };
  author(add);
  const geometry=mergeGeometries(pieces,false);for(const piece of pieces)piece.dispose();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;return mesh;
}

export function createMechaRig(fighter) {
  const variant=[...fighter.id].reduce((sum,letter)=>sum+letter.charCodeAt(0),0)%4;
  const paint=fighter.color,light=fighter.accent,frame=0x111a25,steel=0x536777,ceramic=0xcbd5db;
  const darkPaint=new THREE.Color(paint).multiplyScalar(.42);
  const edge=new THREE.Color(paint).lerp(new THREE.Color(0xc6e2ed),.35);
  const armor=new THREE.MeshPhysicalMaterial({color:0xffffff,vertexColors:true,roughness:.31,
    metalness:.68,clearcoat:.48,clearcoatRoughness:.21,envMapIntensity:1,emissive:light,emissiveIntensity:.025});
  const glow=new THREE.MeshPhysicalMaterial({color:light,emissive:light,emissiveIntensity:.7,
    roughness:.28,metalness:.15,toneMapped:false});
  fighter.armorMaterial=armor;fighter.accentMaterial=glow;
  const rig=new THREE.Group();rig.name="Mecha articulated armor";rig.scale.set(1.07,1.04,1.07);fighter.rig=rig;

  rig.add(assembly(armor,"Mecha torso and backpack",add=>{
    add(shell([[1.26,.28,.25],[1.41,.44,.29],[1.69,.66,.33],[1.81,.5,.25]]),frame);
    // Exposed narrow abdominal mechanism, separated from the chest and pelvis.
    for(const y of [1.30,1.355,1.41]){
      add(shell([[-.019,.28,.25],[.019,.32,.26]]),steel,0,y);
      add(panel(.22,.017,.018),frame,0,y,.144);
    }
    add(shell([[1.08,.34,.26],[1.17,.48,.31],[1.25,.38,.25]]),darkPaint);
    add(shell([[-.14,.07,.05,.035],[-.045,.18,.12],[.07,.22,.09]]),ceramic,0,1.12,.20);
    add(shell([[1.47,.18,.32,.045],[1.67,.35,.44,.075],[1.8,.32,.3]]),darkPaint);
    add(shell([[-.11,.07,.055,.02],[.05,.16,.12],[.1,.20,.045,-.03]]),paint,0,1.62,.29);
    add(panel(.073,.038,.014),light,0,1.705,.305,-.23);
    add(panel(.26,.045,.19),steel,0,1.84,-.008);
    for(const side of [-1,1]){
      // Separate swept breastplate, undercut flank, white clavicle and slatted vent.
      add(shell([[-.17,.14,.18,-.025],[-.025,.31,.29,.02],[.09,.33,.3],[.155,.25,.17,-.025]]),
        paint,side*.245,1.65,.045,0,side*-.14,-side*.19);
      add(shell([[-.09,.08,.08],[.10,.12,.12]]),ceramic,side*.30,1.49,.092,0,0,-side*.32);
      add(panel(.23,.033,.05),ceramic,side*.22,1.805,.137,-.25,side*.15,-side*.23);
      add(panel(.13,.16,.023),frame,side*.24,1.663,.226,-.24,side*.12,-side*.18);
      for(let i=0;i<4;i++) add(panel(.105,.018,.024,.04),0x2b414e,side*.24,1.612+i*.035,.243+i*.006,-.2,side*.12,-side*.18);
      add(panel(.085,.012,.017,.02),edge,side*.37,1.744,.17,0,0,-side*.18);
      add(shell([[-.06,.055,.12],[.045,.06,.19],[.08,.04,.17]]),darkPaint,side*.165,1.847,-.04,0,0,-side*.25);
      add(panel(.03,.07,.015),steel,side*.148,1.875,.065,0,0,-side*.25);
      add(panel(.007,.11,.012,.02),frame,side*.34,1.61,.179,-.2,side*.12,-side*.25);
      add(plate([[-.014,-.012],[.014,-.012],[0,.014]],.007,.001),0xe3ac53,side*.327,1.727,.228,0,side*.15);
      // Angled slim backpack housings with metal turbine throats.
      add(shell([[-.29,.14,.18],[-.17,.22,.26],[.17,.21,.22],[.26,.12,.16]]),frame,side*.19,1.60,-.32,-.12);
      add(shell([[-.17,.11,.03],[.13,.18,.07],[.19,.10,.035]]),paint,side*.19,1.63,-.478,-.12);
      add(shell([[-.09,.09,.11],[.20,.10,.12],[.24,.05,.07]]),steel,side*.24,1.87,-.31,-.15);
      add(panel(.035,.062,.015),light,side*.24,2.02,-.24,-.15);
      add(new THREE.CylinderGeometry(.098,.125,.18,12,1,true),frame,side*.2,1.19,-.49);
      add(new THREE.CylinderGeometry(.104,.13,.032,12,1,true),steel,side*.2,1.10,-.49);
      // Hip armor belongs to the pelvis, so it doesn't flap with the running thigh.
      add(shell([[-.22,.085,.04,.08],[-.12,.18,.065,.045],[.08,.18,.06]]),paint,side*.19,1.115,.195,-.20,0,-side*.16);
      add(panel(.085,.018,.01),ceramic,side*.185,1.13,.24,0,0,-side*.16);
      add(shell([[-.22,.05,.09],[-.09,.10,.21],[.08,.11,.18]]),paint,side*.32,1.125,-.015,0,0,side*.22);
      add(panel(.028,.07,.035),steel,side*.354,1.20,.09,0,0,side*.22);
    }
  }));

  const head=new THREE.Group();head.name="Mecha helmet";head.position.set(0,2.065,.006);head.scale.setScalar(.70);fighter.helmet=head;
  head.add(assembly(armor,"Mecha helmet armor",add=>{
    add(new THREE.CylinderGeometry(.095,.085,.16,10),steel,0,-.23);
    add(shell([[-.19,.25,.23,-.04],[-.065,.43,.34,-.04],[.11,.40,.31,-.06],[.23,.19,.20,-.07]]),paint);
    add(plate([[-.195,.08],[0,.1],[.195,.08],[.135,-.125],[0,-.17],[-.135,-.125]],.024),frame,0,0,.144);
    for(const side of [-1,1]){
      add(shell([[-.19,.045,.05,.05],[-.05,.095,.10],[.02,.065,.10]]),ceramic,side*.156,0,.143,0,0,-side*.19);
      add(shell([[-.115,.06,.15],[.085,.075,.16],[.14,.035,.09]]),steel,side*.22,-.012,-.025);
      add(panel(.13,.023,.028),ceramic,side*.10,.083,.17,0,0,side*.12);
      add(panel(.007,.075,.012,.02),frame,side*.18,-.083,.177,0,0,-side*.19);
      const crestX=[.34,.27,.18,.31][variant],crestY=[.46,.50,.40,.49][variant];
      add(plate([[side*.025,.12],[side*crestX,crestY],[side*.105,.10]],.023,.002),ceramic,0,0,.17);
      if(variant===1||variant===3)add(plate([[side*.2,.05],[side*.28,.23],[side*.24,-.02]],.025,.002),paint,0,0,-.035);
      add(panel(.023,.047,.011),light,side*.235,.055,.047);
    }
    add(shell([[-.13,.035,.035,.02],[-.07,.095,.065,.018],[.025,.074,.06]]),ceramic,0,-.045,.201);
    for(const y of [-.09,-.068])add(panel(.047,.008,.008,.04),frame,0,y,.256);
    add(plate([[-.04,.04],[0,.09],[.04,.04],[0,-.035]],.033,.002),paint,0,.12,.197);
    add(shell([[-.02,.053,.07],[.1,.066,.07],[.15,.036,.04]]),steel,0,.13,-.045);
  }));
  const eyes=assembly(glow,"Mecha twin eye lenses",add=>{
    for(const side of [-1,1])add(plate([[side*.025,.047],[side*.162,.065],[side*.131,.023],[side*.038,.016]],.01,.001),0xffffff,0,0,.168);
    add(panel(.03,.043,.01),0xffffff,0,.189,.135);
  });fighter.visor=eyes;head.add(eyes);rig.add(head);

  for(const side of [-1,1]){
    const prefix=side<0?"left":"right";
    const upper=new THREE.Group();upper.name=`Mecha ${prefix} arm`;upper.position.set(side*.565,1.78,0);
    const forearm=new THREE.Group();forearm.name=`Mecha ${prefix} forearm`;forearm.position.y=-.55;
    upper.add(assembly(armor,`Mecha ${prefix} shoulder and upper arm`,add=>{
      add(new THREE.SphereGeometry(.112,10,8),frame,0,-.01);
      add(shell([[-.44,.13,.16],[-.31,.165,.18],[-.15,.14,.15]]),ceramic);
      add(new THREE.CylinderGeometry(.025,.025,.20,8),steel,side*.078,-.295,-.038);
      add(panel(.078,.19,.02),frame,0,-.31,.096);
      const width=[.39,.35,.43,.36][variant];
      add(shell([[-.19,width*.52,.19,.008],[-.12,width*.86,.29],[.075,width,.36,-.015],[.15,width*.74,.23,-.03]]),paint,side*.045,.045,0,0,0,-side*.25);
      add(shell([[-.07,.12,.025,.025],[.07,.23,.045],[.11,.19,.022]]),darkPaint,side*.065,.03,.179,0,0,-side*.25);
      add(panel(width*.62,.016,.019,.03),edge,side*.031,.161,.116,0,0,-side*.25);
      add(panel(.057,.025,.018),ceramic,side*.09,.07,.212,0,0,-side*.25);
      add(panel(.008,.058,.014,.02),frame,side*.147,.065,.166,0,0,-side*.25);
      add(panel(.043,.008,.014,.02),frame,side*.153,.034,.168,0,0,-side*.25);
      add(panel(.009,.030,.014,.02),ceramic,side*.023,.073,.214,0,0,-side*.25);
      add(plate([[-.012,-.01],[.012,-.01],[0,.012]],.005,.001),0xe3ac53,side*.13,-.026,.20,0,0,-side*.25);
      // Overlapping lower lip leaves a visible shadow seam below the shell.
      add(shell([[-.07,.075,.08],[.025,.18,.16],[.065,.20,.13]]),darkPaint,side*.103,-.137,-.025,0,0,-side*.25);
      for(const x of [-.1,.1])add(new THREE.CylinderGeometry(.012,.012,.014,8),steel,x+side*.045,.08,.17,Math.PI/2);
      add(panel(.14,.074,.023),frame,side*.055,-.054,-.165,0,0,-side*.25);
      for(const y of [-.078,-.048,-.018])add(panel(.115,.012,.025,.03),steel,side*.055,y,-.18,0,0,-side*.25);
      if(variant===1||variant===3)add(plate([[-.05,-.08],[.08,-.13],[.12,.25]],.055),paint,side*.17,.01,-.13,0,0,-side*.4);
    }));
    forearm.add(assembly(armor,`Mecha ${prefix} bracer and hand`,add=>{
      add(new THREE.CylinderGeometry(.086,.086,.18,12),frame,0,0,0,0,0,Math.PI/2);
      add(new THREE.CylinderGeometry(.06,.06,.19,10),steel,0,0,0,0,0,Math.PI/2);
      add(shell([[-.425,.12,.15,.02],[-.31,.18,.24,.04],[-.09,.21,.24],[.01,.12,.13,-.018]]),paint);
      add(shell([[-.15,.04,.02,.015],[.07,.073,.04],[.12,.038,.02,-.02]]),ceramic,-side*.035,-.23,.151,-.13,0,-side*.10);
      add(panel(.055,.019,.016),light,0,-.32,.175);
      add(panel(.032,.20,.025),darkPaint,side*.092,-.20,.11,0,0,side*.05);
      add(panel(.008,.13,.014,.02),frame,side*.035,-.20,.174,-.13,0,-side*.10);
      add(panel(.055,.025,.01,.03),steel,side*.018,-.382,.152,-.35);
      for(const y of [-.19,-.23,-.27])add(panel(.016,.013,.055,.03),steel,side*.105,y,-.012);
      add(new THREE.CylinderGeometry(.057,.057,.08,10),steel,0,-.465,.033);
      add(shell([[-.075,.125,.12],[.055,.14,.14]]),frame,0,-.565,.05);
      for(const x of [-.05,-.017,.017,.05]){
        add(panel(.025,.065,.031),steel,x,-.593,.121);
        add(panel(.025,.027,.031),frame,x,-.555,.126);
      }
      add(panel(.047,.085,.065),frame,-side*.079,-.552,.103,0,0,side*.25);
    }));
    upper.add(forearm);rig.add(upper);fighter[`${prefix}Arm`]=upper;fighter[`${prefix}Forearm`]=forearm;
    fighter[`${prefix}Hand`]={position:new THREE.Vector3(0,-.58,.05)};

    const leg=new THREE.Group();leg.name=`Mecha ${prefix} leg`;leg.position.set(side*.215,1.14,0);
    leg.add(assembly(armor,`Mecha ${prefix} thigh`,add=>{
      add(new THREE.SphereGeometry(.102,10,8),frame,0,-.018);
      add(shell([[-.43,.14,.155],[-.26,.19,.23,.025],[-.06,.205,.21],[.005,.13,.15]]),ceramic);
      add(shell([[-.33,.085,.025],[.035,.11,.044]]),steel,0,-.08,-.122);
      add(shell([[-.11,.07,.026,.008],[.09,.11,.037],[.15,.07,.025,-.008]]),paint,side*.044,-.24,.132,0,0,-side*.12);
      add(new THREE.CylinderGeometry(.022,.022,.24,8),steel,side*.083,-.27,-.05,0,0,-side*.075);
    }));
    const knee=new THREE.Group();knee.name=`Mecha ${prefix} knee`;knee.position.y=-.5;
    knee.add(assembly(armor,`Mecha ${prefix} shin`,add=>{
      add(new THREE.CylinderGeometry(.092,.092,.195,12),frame,0,0,0,0,0,Math.PI/2);
      add(new THREE.CylinderGeometry(.059,.059,.209,12),steel,0,0,0,0,0,Math.PI/2);
      add(shell([[-.49,.13,.16,.025],[-.37,.20,.22],[-.18,.255,.285,-.035],[-.06,.215,.225,-.03],[.04,.13,.16]]),paint);
      add(shell([[-.14,.038,.037,.023],[-.045,.13,.075,.013],[.07,.15,.055],[.105,.05,.025,-.025]]),ceramic,0,-.018,.149);
      add(panel(.043,.023,.012),light,0,.021,.195);
      add(shell([[-.21,.043,.025,.02],[.035,.067,.045],[.115,.037,.022,-.025]]),ceramic,-side*.035,-.278,.137,-.10,0,-side*.07);
      add(shell([[-.15,.067,.027],[.04,.115,.035],[.11,.09,.025]]),darkPaint,side*.092,-.28,.047,0,side*.8,0);
      add(shell([[-.15,.045,.027,.016],[-.04,.09,.051],[.08,.064,.037,-.025]]),paint,side*.095,-.27,.086,0,side*.7,side*.13);
      add(panel(.008,.115,.012,.02),frame,side*.042,-.22,.155,-.10,0,side*.1);
      for(const y of [-.21,-.25,-.29])add(panel(.036,.012,.014,.02),steel,side*.079,y,.14,-.10);
      add(panel(.105,.17,.024),frame,0,-.226,-.194,-.20);
      for(const y of [-.17,-.21,-.25,-.29])add(panel(.084,.012,.025,.03),steel,0,y,-.207,-.20);
      add(new THREE.CylinderGeometry(.023,.023,.24,8),steel,-side*.083,-.37,-.056);
    }));
    const ankle=new THREE.Group();ankle.name=`Mecha ${prefix} ankle`;ankle.position.y=-.54;
    ankle.add(assembly(armor,`Mecha ${prefix} foot armor`,add=>{
      add(new THREE.SphereGeometry(.072,10,8),steel,0,.022);
      // Long, low wedge boot with a sloped instep and a split dark toe sole.
      add(shell([[-.113,.218,.39,.085],[-.083,.233,.42,.09],[-.052,.22,.405,.09],[.054,.16,.22,.015]]),paint);
      add(shell([[-.126,.22,.397,.085],[-.108,.23,.413,.085]]),frame);
      add(shell([[-.026,.152,.092],[.025,.105,.073,-.034]]),ceramic,0,-.061,.242);
      add(panel(.012,.013,.11,.02),frame,0,-.036,.254,-.43);
      add(panel(.08,.055,.055),steel,0,-.028,-.132);
      for(const x of [-.065,.065])add(panel(.024,.02,.012),edge,x,-.065,.3);
    }));
    knee.add(ankle);leg.add(knee);rig.add(leg);
    fighter[`${prefix}Leg`]=leg;fighter[`${prefix}Knee`]=knee;fighter[`${prefix}Ankle`]=ankle;
  }

  fighter.thrusterMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(light).multiplyScalar(2.1),
    transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
  const flame=new THREE.ConeGeometry(.105,.36,6,1,true).rotateX(Math.PI);
  const left=flame.clone().translate(-.2,0,0),right=flame.translate(.2,0,0);
  fighter.thrusterLights=new THREE.Mesh(mergeGeometries([left,right],false),fighter.thrusterMaterial);left.dispose();right.dispose();
  fighter.thrusterLights.name="Fighter thruster pair";fighter.thrusterLights.position.set(0,1.02,-.49);fighter.thrusterScale=1;rig.add(fighter.thrusterLights);

  const inverse=new THREE.Matrix4(),target=new THREE.Vector3(),orientation=new THREE.Quaternion();
  fighter.strideVelocity=new THREE.Vector2();
  const legs=[[fighter.leftLeg,fighter.leftKnee,fighter.leftAnkle,0],[fighter.rightLeg,fighter.rightKnee,fighter.rightAnkle,Math.PI]];
  fighter.poseGroundedLegs=(dt,phase,weight)=>{
    rig.updateMatrix();inverse.copy(rig.matrix).invert();
    const angle=fighter.group.rotation.y,c=Math.cos(angle),s=Math.sin(angle);
    const speed=Math.hypot(fighter.velocity.x,fighter.velocity.z);
    fighter.strideVelocity.x=THREE.MathUtils.damp(fighter.strideVelocity.x,fighter.velocity.x/Math.max(9,speed),9,dt);
    fighter.strideVelocity.y=THREE.MathUtils.damp(fighter.strideVelocity.y,fighter.velocity.z/Math.max(9,speed),9,dt);
    const dx=fighter.strideVelocity.x*c-fighter.strideVelocity.y*s;
    const dz=fighter.strideVelocity.x*s+fighter.strideVelocity.y*c;
    for(const [leg,knee,ankle,offset] of legs){
      const cycle=phase+offset,stride=Math.cos(cycle)*.36;
      const lift=Math.max(0,-Math.sin(cycle))**2*.25*weight;
      // Solve the two bones to the foot trajectory. The pelvis never reacts to
      // the rotating geometry bounds, and planted soles stay level with the floor.
      target.set(leg.position.x*rig.scale.x+dx*stride,.15+lift,dz*stride).applyMatrix4(inverse).sub(leg.position);
      const down=Math.hypot(target.x,target.y),distance=Math.min(1.0399,Math.hypot(down,target.z));
      const bend=Math.acos(THREE.MathUtils.clamp((distance*distance-.5*.5-.54*.54)/(2*.5*.54),-1,1));
      leg.rotation.set(Math.atan2(-target.z,down)-Math.atan2(.54*Math.sin(bend),.5+.54*Math.cos(bend)),0,Math.atan2(target.x,-target.y),"ZXY");
      knee.rotation.x=bend;
      orientation.copy(rig.quaternion).multiply(leg.quaternion).multiply(knee.quaternion);
      ankle.quaternion.copy(orientation).invert();
    }
  };
  return rig;
}
