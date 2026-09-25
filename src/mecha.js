import * as THREE from "three/webgpu";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { attribute, color, materialEmissive, normalViewGeometry, positionViewDirection, texture } from "three/tsl";
import { surfaceMaps, projectSurfaceUVs } from "./surfaceTextures.js";

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
  // Shared, area-weighted normals let the metal highlights roll over the
  // compound shell; inset plates retain their own crisp bevels and seams.
  const smooth = mergeVertices(geometry);
  geometry.dispose();
  smooth.computeVertexNormals();
  return projectSurfaceUVs(smooth);
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
    // Paint, ceramic and the dark mechanical frame cannot all share the same
    // chrome response. Bake finish values beside color to keep one joint draw.
    const hex=paint.getHex();
    const finish=hex===0xcbd5db?[.46,.12]:[0x111a25,0x070d14,0x25323e].includes(hex)?[.72,.05]
      :[0x536777,0x40505d,0x2b414e].includes(hex)?[.44,.62]:[.34,.45];
    const surface=new Float32Array(source.attributes.position.count*2);
    for(let i=0;i<surface.length;i+=2){surface[i]=finish[0];surface[i+1]=finish[1];}
    source.setAttribute("surface",new THREE.BufferAttribute(surface,2));
    source.setAttribute("color",new THREE.BufferAttribute(colors,3));pieces.push(source);
  };
  author(add);
  const geometry=mergeGeometries(pieces,false);for(const piece of pieces)piece.dispose();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;return mesh;
}

function fitArmor(mesh, x, y, z, lift = 0) {
  mesh.geometry.scale(x, y, z).translate(0, lift, 0);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

export function createMechaRig(fighter) {
  const variant=[...fighter.id].reduce((sum,letter)=>sum+letter.charCodeAt(0),0)%4;
  const paint=fighter.color,light=fighter.accent,frame=0x111a25,steel=0x536777,ceramic=0xcbd5db;
  const darkPaint=new THREE.Color(paint).multiplyScalar(.42);
  const edge=new THREE.Color(paint).lerp(new THREE.Color(0xc6e2ed),.35);
  const armor=new THREE.MeshPhysicalNodeMaterial({...surfaceMaps(),normalScale:new THREE.Vector2(.3,.3),color:0xffffff,vertexColors:true,roughness:.38,
    metalness:.52,clearcoat:.16,clearcoatRoughness:.27,envMapIntensity:.85,emissive:light,emissiveIntensity:.025});
  const surface=attribute("surface","vec2");
  armor.roughnessNode=surface.x.mul(texture(armor.roughnessMap).g);
  armor.metalnessNode=surface.y.mul(texture(armor.metalnessMap).b);armor.clearcoatNode=surface.y.mul(.25);
  // View-dependent team rim preserves silhouettes without lighting the whole arena.
  armor.emissiveNode=materialEmissive.add(color(light).mul(normalViewGeometry.dot(positionViewDirection).abs().oneMinus().pow(3).mul(.22)));
  const glow=new THREE.MeshPhysicalMaterial({...surfaceMaps(),normalScale:new THREE.Vector2(.2,.2),color:paint,emissive:light,emissiveIntensity:.7,
    roughness:.8,metalness:0,toneMapped:false});
  fighter.armorMaterial=armor;fighter.accentMaterial=glow;
  const rig=new THREE.Group();rig.name="Mecha articulated armor";rig.scale.set(1.07,1.04,1.07);rig.position.y=-.035;fighter.rig=rig;

  rig.add(assembly(armor,"Mecha torso and backpack",add=>{
    add(shell([[1.26,.28,.25],[1.41,.44,.29],[1.69,.66,.33],[1.81,.5,.25]]),frame);
    // Exposed narrow abdominal mechanism, separated from the chest and pelvis.
    for(const y of [1.30,1.355,1.41]){
      add(shell([[-.019,.28,.25],[.019,.32,.26]]),steel,0,y);
      add(panel(.22,.017,.018),frame,0,y,.144);
    }
    add(shell([[1.08,.34,.26],[1.17,.48,.31],[1.25,.38,.25]]),darkPaint);
    add(shell([[-.245,.035,.055,.065],[-.07,.19,.14,.025],[.085,.24,.10]]),paint,0,1.12,.20);
    add(panel(.105,.034,.012),ceramic,0,1.169,.281,-.18);
    add(shell([[1.46,.18,.29,.03],[1.64,.38,.43,.055],[1.81,.48,.33,.02]]),darkPaint);
    add(shell([[-.20,.17,.08,.04],[-.05,.36,.14,.06],[.10,.42,.16],[.155,.39,.07,-.025]]),paint,0,1.66,.208,-.07);
    add(plate([[-.095,.07],[.10,.09],[.066,-.065],[-.052,-.095]],.018,.004),frame,0,1.625,.361,-.22);
    add(panel(.18,.027,.018),ceramic,-.065,1.772,.281,-.3,0,-.09);
    add(panel(.032,.022,.012),light,.10,1.73,.315,-.22);
    add(panel(.26,.045,.19),steel,0,1.84,-.008);
    for(const side of [-1,1]){
      // Separate swept breastplate, undercut flank, white clavicle and slatted vent.
      add(shell([[-.17,.14,.18,-.025],[-.025,.31,.29,.02],[.09,.33,.3],[.155,.25,.17,-.025]]),
        paint,side*.245,1.65,.045,0,side*-.14,-side*.19);
      add(shell([[-.09,.08,.08],[.10,.12,.12]]),ceramic,side*.30,1.49,.092,0,0,-side*.32);
      add(panel(.23,.033,.05),ceramic,side*.22,1.805,.137,-.25,side*.15,-side*.23);
      add(panel(.095,.155,.027),frame,side*.32,1.665,.185,-.24,side*.58,-side*.18);
      for(let i=0;i<3;i++) add(panel(.08,.017,.027,.04),steel,side*.32,1.626+i*.036,.203+i*.005,-.2,side*.58,-side*.18);
      add(plate([[-.055,.085],[.036,.09],[.074,-.033],[.017,-.088],[-.017,-.06]],.048,.009),ceramic,side*.23,1.47,.205,-.18,side*.28,-side*.5);
      add(panel(.015,.135,.017),frame,side*.155,1.438,.239,-.18,side*.28,-side*.38);
      add(panel(.085,.012,.017,.02),edge,side*.37,1.744,.17,0,0,-side*.18);
      add(shell([[-.06,.055,.12],[.045,.06,.19],[.08,.04,.17]]),darkPaint,side*.165,1.847,-.04,0,0,-side*.25);
      add(panel(.03,.07,.015),steel,side*.148,1.875,.065,0,0,-side*.25);
      add(panel(.007,.11,.012,.02),frame,side*.34,1.61,.179,-.2,side*.12,-side*.25);
      add(plate([[-.014,-.012],[.014,-.012],[0,.014]],.007,.001),0xe3ac53,side*.327,1.727,.228,0,side*.15);
      // Angled slim backpack housings with metal turbine throats.
      add(shell([[-.29,.14,.18],[-.17,.22,.26],[.17,.21,.22],[.26,.12,.16]]),frame,side*.19,1.60,-.32,-.12);
      add(shell([[-.17,.11,.03],[.13,.18,.07],[.19,.10,.035]]),paint,side*.19,1.63,-.478,-.12);
      // The concept has two broad, dark booster pods, splayed behind the
      // shoulders. Their hollow vent faces and painted rails replace the bars.
      const mount = new THREE.Object3D();
      mount.position.set(side*.435,1.92,-.32);
      mount.rotation.set(-.22,0,-side*.22);mount.updateMatrix();
      const pod = (geometry,color,x=0,y=0,z=0) => add(geometry.translate(x,y,z).applyMatrix4(mount.matrix),color);
      pod(shell([[-.21,.125,.12],[-.08,.19,.14],[.20,.19,.13],[.26,.135,.10]]),frame,0,0,-.045);
      pod(panel(.13,.345,.012,.06),0x070d14,0,.027,.037);
      for(const rail of [-1,1]) {
        pod(shell([[-.18,.023,.09],[.18,.028,.09],[.22,.018,.055]]),frame,rail*.076,.005,.075);
        pod(shell([[-.16,.012,.024],[.18,.015,.025],[.20,.01,.02]]),paint,rail*.091,.01,.113);
      }
      for(const y of [-.16,.013,.204])pod(panel(.132,.025,.08),0x25323e,0,y,.081);
      for(const y of [-.125,-.075,.058,.112,.16])pod(new THREE.BoxGeometry(.093,.008,.026).rotateX(-.5),0x25323e,0,y,.046);
      pod(panel(.025,.19,.10),paint,side*.095,-.025,-.04);
      pod(panel(.022,.014,.010),ceramic,-side*.043,.207,.127);
      add(new THREE.CylinderGeometry(.098,.125,.18,12,1,true),frame,side*.2,1.19,-.49);
      add(new THREE.CylinderGeometry(.104,.13,.032,12,1,true),steel,side*.2,1.10,-.49);
      // Hip armor belongs to the pelvis, so it doesn't flap with the running thigh.
      add(shell([[-.35,.065,.04,.09],[-.20,.19,.065,.045],[.08,.23,.06]]),paint,side*.235,1.115,.195,-.20,0,-side*.24);
      add(panel(.065,.025,.012),ceramic,side*.23,1.15,.24,0,0,-side*.24);
      add(panel(.012,.15,.012),frame,side*.258,1.04,.257,-.20,0,-side*.24);
      add(shell([[-.30,.035,.09],[-.09,.12,.21],[.08,.14,.18]]),paint,side*.39,1.125,-.015,0,0,side*.3);
      add(panel(.028,.07,.035),steel,side*.42,1.20,.09,0,0,side*.3);
    }
  }));

  const head=new THREE.Group();head.name="Mecha helmet";head.position.set(0,2.065,.006);head.scale.setScalar(.70);fighter.helmet=head;
  head.add(assembly(armor,"Mecha helmet armor",add=>{
    add(new THREE.CylinderGeometry(.073,.064,.12,12),steel,0,-.235,-.025);
    add(shell([[-.18,.22,.22,-.045,.55],[-.07,.37,.29,-.05,.55],[.10,.36,.29,-.06,.5],[.20,.18,.20,-.065,.4]]),paint);
    add(plate([[-.174,.09],[0,.106],[.174,.09],[.139,-.075],[0,-.157],[-.139,-.075]],.024,.002),frame,0,0,.127);
    for(const side of [-1,1]){
      add(plate([[side*.092,.007],[side*.145,.024],[side*.134,-.060],[side*.083,-.127],[side*.077,-.055]],.025,.003),ceramic,0,0,.155,0,side*.12);
      add(plate([[side*.157,.055],[side*.196,.032],[side*.171,-.125],[side*.136,-.160],[side*.132,-.098]],.034,.004),paint,0,0,.109);
      add(shell([[-.12,.043,.10],[.055,.072,.12],[.09,.045,.075]]),paint,side*.205,-.005,-.035);
      add(panel(.035,.075,.016),frame,side*.211,-.01,.032);
      add(new THREE.CylinderGeometry(.014,.014,.02,10),steel,side*.245,-.048,-.015,0,0,Math.PI/2);
      add(plate([[side*.025,.119],[side*.172,.110],[side*.150,.073],[side*.035,.076]],.020,.002),ceramic,0,0,.158);
      for(const y of [-.050,-.075])add(panel(.020,.008,.009,.02),frame,side*.106,y,.180,0,side*.12,-side*.40);
      const crestX=[.42,.32,.23,.38][variant],crestY=[.43,.46,.37,.45][variant];
      add(plate([[side*.022,.102],[side*crestX,crestY],[side*.132,.083]],.020,.002),ceramic,0,0,.173);
      add(plate([[side*.033,.105],[side*crestX*.78,crestY*.78],[side*.11,.09]],.008,.001),paint,0,0,.187);
      if(variant===1||variant===3)add(plate([[side*.2,.05],[side*.28,.23],[side*.24,-.02]],.025,.002),paint,0,0,-.035);
      add(panel(.012,.033,.009),light,side*.220,.022,.043);
    }
    add(plate([[-.059,.019],[.059,.019],[.058,-.078],[.029,-.127],[0,-.143],[-.029,-.127],[-.058,-.078]],.027,.004),ceramic,0,0,.172);
    add(plate([[-.019,.024],[.019,.024],[.018,-.035],[0,-.052],[-.017,-.034]],.013,.003),ceramic,0,-.006,.197);
    add(panel(.022,.007,.006,.02),frame,0,-.083,.191);
    add(plate([[-.052,.082],[0,.172],[.052,.082],[0,.036]],.024,.003),paint,0,.037,.184);
    // Raised camera crest sits inside a painted housing, above the V-fin root.
    add(shell([[-.055,.093,.10],[.105,.101,.09],[.143,.066,.062]]),frame,0,.202,-.021);
    add(panel(.078,.158,.025),paint,0,.244,.039);
    add(panel(.049,.083,.015),frame,0,.254,.058);
  }));
  const eyes=assembly(glow,"Mecha twin eye lenses",add=>{
    for(const side of [-1,1])add(plate([[side*.024,.055],[side*.145,.066],[side*.12,.026],[side*.035,.019]],.008,.001),0xffffff,0,0,.182);
    add(new THREE.CylinderGeometry(.021,.021,.009,12),0xffffff,0,.253,.073,Math.PI/2);
  });fighter.visor=eyes;head.add(eyes);rig.add(head);

  for(const side of [-1,1]){
    const prefix=side<0?"left":"right";
    const upper=new THREE.Group();upper.name=`Mecha ${prefix} arm`;upper.position.set(side*.565,1.78,0);
    const forearm=new THREE.Group();forearm.name=`Mecha ${prefix} forearm`;forearm.position.y=-.55;
    upper.add(assembly(armor,`Mecha ${prefix} shoulder and upper arm`,add=>{
      add(new THREE.SphereGeometry(.112,10,8),frame,0,-.01);
      add(new THREE.CylinderGeometry(.062,.052,.29,12),frame,0,-.29);
      add(shell([[-.075,.10,.125],[.04,.16,.16],[.095,.115,.12]]),ceramic,0,-.23,0,0,0,side*.16);
      add(plate([[-.055,.072],[.052,.038],[.036,-.085],[-.023,-.104],[-.057,-.023]],.048,.007),ceramic,0,-.365,.074,0,side*.2,-side*.10);
      add(new THREE.CylinderGeometry(.025,.025,.20,8),steel,side*.078,-.295,-.038);
      add(panel(.068,.026,.022),frame,0,-.31,.108,0,0,side*.22);
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
      add(shell([[-.43,.105,.13],[-.26,.15,.155],[-.06,.17,.17],[.005,.13,.15]]),frame);
      add(plate([[-.085,.17],[.058,.145],[.081,-.09],[.025,-.185],[-.039,-.15],[-.09,-.022]],.071,.01),ceramic,0,-.235,.093,0,side*.12,-side*.10);
      add(plate([[-.05,.145],[.046,.083],[.06,-.09],[.007,-.164],[-.039,-.117]],.05,.009),ceramic,side*.081,-.23,-.005,0,side*1.04,-side*.11);
      add(shell([[-.33,.085,.025],[.035,.11,.044]]),steel,0,-.08,-.122);
      add(shell([[-.11,.055,.035,.008],[.05,.11,.055],[.10,.08,.025,-.008]]),paint,side*.076,-.14,.117,0,side*.37,-side*.18);
      add(panel(.009,.13,.012,.02),steel,-side*.061,-.246,.143,0,side*.12,-side*.10);
      add(new THREE.CylinderGeometry(.022,.022,.24,8),steel,side*.083,-.27,-.05,0,0,-side*.075);
    }));
    const knee=new THREE.Group();knee.name=`Mecha ${prefix} knee`;knee.position.y=-.5;
    knee.add(assembly(armor,`Mecha ${prefix} shin`,add=>{
      add(new THREE.CylinderGeometry(.092,.092,.195,12),frame,0,0,0,0,0,Math.PI/2);
      add(new THREE.CylinderGeometry(.059,.059,.209,12),steel,0,0,0,0,0,Math.PI/2);
      add(shell([[-.49,.13,.16,.025],[-.37,.20,.22],[-.18,.255,.285,-.035],[-.06,.215,.225,-.03],[.04,.13,.16]]),paint);
      add(shell([[-.14,.038,.037,.023],[-.045,.13,.075,.013],[.07,.15,.055],[.105,.05,.025,-.025]]),ceramic,0,-.018,.149);
      add(panel(.043,.023,.012),light,0,.021,.195);
      add(shell([[-.15,.043,.025,.02],[.015,.067,.045],[.055,.037,.022,-.025]]),ceramic,-side*.035,-.278,.137,-.10,0,-side*.07);
      add(shell([[-.15,.067,.027],[.04,.115,.035],[.11,.09,.025]]),darkPaint,side*.092,-.28,.047,0,side*.8,0);
      add(shell([[-.15,.045,.027,.016],[-.04,.09,.051],[.08,.064,.037,-.025]]),paint,side*.095,-.27,.086,0,side*.7,side*.13);
      add(panel(.008,.115,.012,.02),frame,side*.042,-.22,.155,-.10,0,side*.1);
      for(const y of [-.21,-.25,-.29])add(panel(.036,.012,.014,.02),steel,side*.079,y,.14,-.10);
      add(panel(.105,.17,.024),frame,0,-.226,-.194,-.20);
      for(const y of [-.17,-.21,-.25,-.29])add(panel(.084,.012,.025,.03),steel,0,y,-.207,-.20);
      add(new THREE.CylinderGeometry(.023,.023,.24,8),steel,-side*.083,-.37,-.056);
      add(plate([[-.055,.18],[.052,.14],[.083,-.15],[.027,-.235],[-.043,-.13]],.032,.009),paint,side*.093,-.265,.107,-.07,side*.46,-side*.13);
      add(plate([[-.016,.084],[.016,.07],[.027,-.115],[-.009,-.134]],.013,.003),frame,side*.098,-.25,.144,-.07,side*.46,-side*.13);
      add(panel(.009,.12,.011,.02),steel,side*.112,-.275,.151,-.07,side*.46,-side*.13);
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
      add(plate([[-.084,.071],[.078,.068],[.106,-.036],[.039,-.071],[-.077,-.048]],.044,.007),ceramic,0,.025,.185,-.50);
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

  // The concept's shoulder span is less than half its height. Fit the authored
  // armor to that skeleton, with long legs and compact arms/head above the waist.
  fitArmor(rig.getObjectByName("Mecha torso and backpack"), .62, .80, .82, .54);
  head.position.y = 2.20;
  head.scale.setScalar(.53);
  for (const prefix of ["left", "right"]) {
    const side = prefix === "left" ? -1 : 1;
    const upper = fighter[`${prefix}Arm`], forearm = fighter[`${prefix}Forearm`];
    upper.position.set(side * .34, 1.92, 0);
    fitArmor(upper.children[0], .72, .80, .78);
    forearm.position.y = -.44;
    fitArmor(forearm.children[0], .74, .80, .78);
    fighter[`${prefix}Hand`].position.set(0, -.464, .039);
    forearm.userData.handRest = fighter[`${prefix}Hand`].position;
    const leg = fighter[`${prefix}Leg`], knee = fighter[`${prefix}Knee`];
    leg.position.set(side * .185, 1.33, 0);
    fitArmor(leg.children[0], .84, 1.18, .84);
    knee.position.y = -.59;
    fitArmor(knee.children[0], .84, 7 / 6, .84);
    fighter[`${prefix}Ankle`].position.y = -.63;
  }
  fighter.thrusterLights.position.set(0, 1.356, -.402);
  fighter.thrusterLights.scale.set(.62, 1, .82);

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
      const stance = Math.sign(leg.position.x) * .32 * (1 - weight);
      target.set(leg.position.x*rig.scale.x+stance+dx*stride,.15+lift,dz*stride).applyMatrix4(inverse).sub(leg.position);
      const down=Math.hypot(target.x,target.y),distance=Math.min(1.2199,Math.hypot(down,target.z));
      const bend=Math.acos(THREE.MathUtils.clamp((distance*distance-.59*.59-.63*.63)/(2*.59*.63),-1,1));
      leg.rotation.set(Math.atan2(-target.z,down)-Math.atan2(.63*Math.sin(bend),.59+.63*Math.cos(bend)),0,Math.atan2(target.x,-target.y),"ZXY");
      knee.rotation.x=bend;
      orientation.copy(rig.quaternion).multiply(leg.quaternion).multiply(knee.quaternion);
      ankle.quaternion.copy(orientation).invert();
    }
  };
  return rig;
}
