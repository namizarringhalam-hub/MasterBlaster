import * as THREE from "three/webgpu";
import { abs, attribute, color, cos, diffuseColor, fract, length, mix, normalViewGeometry, positionLocal, positionViewDirection, sin, smoothstep, texture, uv, vec2, vec3 } from "three/tsl";

// These signs are deliberately graphic wayfinding, not fictional UI controls.
// An atlas keeps hazard paint, district numerals and holo advertisements in one
// persistent draw; no DOM/canvas texture redraw is needed during a match.
function signageAtlas() {
  const size = 512, height = 256, data = new Uint8Array(size * height * 4);
  const digits = [[1, 2], [0, 1, 6, 4, 3], [0, 1, 6, 2, 3], [5, 6, 1, 2]];
  const segments = [[38, 100, 89, 108], [88, 106, 96, 148], [88, 154, 96, 196], [38, 194, 89, 202], [30, 154, 38, 196], [30, 106, 38, 148], [38, 147, 89, 155]];
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) {
    const district = Math.floor(x / 128), px = x % 128, py = height - 1 - y;
    const numeral = digits[district].some(index => { const r = segments[index]; return px >= r[0] && px < r[2] && py >= r[1] && py < r[3]; });
    const hazard = (py > 24 && py < 40 || py > 220 && py < 234) && (px + py) % 28 < 15;
    const frame = px < 3 || px > 124 || py < 3 || py > 252;
    const type = py > 61 && py < 72 && px > 15 && px < 111 && (px % 11 < 7);
    const schematic = py > 78 && py < 85 && px > 26 && px < 102 || py > 206 && py < 210 && px > 27 && px < 99;
    const grime = ((Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0) % 97 / 97;
    const value = numeral ? 255 : hazard ? 180 : frame ? 90 : type ? 180 : schematic ? 110 : 0;
    const at = (y * size + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = value * (.78 + grime * .22);
    data[at + 3] = value ? 255 : 0;
  }
  const map = new THREE.DataTexture(data, size, height, THREE.RGBAFormat);
  map.name = "District wayfinding and hazard atlas"; map.needsUpdate = true;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true;
  return map;
}

function phaseAttribute(geometry, count, name = "cityPhase") {
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) values[i] = (i * .61803398875) % 1;
  geometry.setAttribute(name, new THREE.InstancedBufferAttribute(values, 1));
}

export function addCityLife(world) {
  const clock = world.atmosphereTime, marker = new THREE.Object3D();
  const atlas = signageAtlas(); world.textures.push(atlas);
  const signGeometry = new THREE.PlaneGeometry(1, 1);
  const districtIndices = new Float32Array(16);
  for (let i = 0; i < 16; i++) districtIndices[i] = Math.floor(i / 4);
  signGeometry.setAttribute("signDistrict", new THREE.InstancedBufferAttribute(districtIndices, 1));
  const ink = texture(atlas, uv().mul(vec2(.25, 1)).add(attribute("signDistrict", "float").mul(vec2(.25, 0))));
  const scan = sin(uv().y.mul(180).sub(clock.mul(2))).mul(.08).add(.92);
  const signMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  signMaterial.colorNode = ink.rgb.mul(scan).mul(1.05);
  signMaterial.emissiveNode = diffuseColor.rgb;
  signMaterial.opacityNode = ink.a.mul(.56);
  const signs = new THREE.InstancedMesh(signGeometry, signMaterial, 16);
  signs.name = "Holographic district signs and weathered hazard numerals";
  for (let i = 0; i < 16; i++) {
    const side = Math.floor(i / 4), offset = (i % 4 - 1.5) * 48;
    marker.position.set(side % 2 ? (side === 1 ? 111.25 : -111.25) : offset, i % 2 ? 31 : 11, side % 2 ? offset : (side === 0 ? -111.25 : 111.25));
    marker.rotation.set(0, [0, -Math.PI / 2, Math.PI, Math.PI / 2][side], 0); marker.scale.set(9, 16, 1); marker.updateMatrix();
    const district = world.districtIndexAt(marker.position.x, marker.position.z);
    districtIndices[i] = district;
    signs.setMatrixAt(i, marker.matrix); signs.setColorAt(i, new THREE.Color(world.districtColors[district]));
  }
  signs.computeBoundingSphere(); world.group.add(signs);

  const trafficGeometry = new THREE.SphereGeometry(1, 5, 3);
  phaseAttribute(trafficGeometry, 64);
  const phase = attribute("cityPhase", "float");
  const angle = phase.mul(Math.PI * 2).add(clock.mul(.035));
  const radius = phase.mul(27).add(178);
  const trafficMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, toneMapped: false });
  trafficMaterial.emissiveNode = diffuseColor.rgb.mul(.6);
  trafficMaterial.positionNode = positionLocal.mul(vec3(.24, .14, .6)).add(vec3(cos(angle).mul(radius), phase.mul(50).add(55).add(sin(angle.mul(2)).mul(3)), sin(angle).mul(radius)));
  const traffic = new THREE.InstancedMesh(trafficGeometry, trafficMaterial, 64);
  traffic.name = "Distant aerial traffic routes"; traffic.frustumCulled = false;
  marker.position.set(0, 0, 0); marker.rotation.set(0, 0, 0); marker.scale.setScalar(1); marker.updateMatrix();
  for (let i = 0; i < traffic.count; i++) { traffic.setMatrixAt(i, marker.matrix); traffic.setColorAt(i, new THREE.Color(world.districtColors[i % 4]).multiplyScalar(2.2)); }
  world.group.add(traffic);

  const beaconGeometry = new THREE.SphereGeometry(.36, 5, 3); phaseAttribute(beaconGeometry, 16);
  const beaconMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xff846c, transparent: true, depthWrite: false, toneMapped: false });
  const blink = sin(clock.mul(2.4).add(phase.mul(Math.PI * 2))).max(0).pow(12);
  beaconMaterial.emissiveNode = diffuseColor.rgb.mul(.5);
  beaconMaterial.colorNode = color(0xff624d).mul(blink.mul(4).add(.12));
  beaconMaterial.opacityNode = blink.mul(.85).add(.15);
  const beacons = new THREE.InstancedMesh(beaconGeometry, beaconMaterial, 16);
  beacons.name = "Aircraft warning beacons";
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8; marker.position.set(Math.cos(a) * 194, 89 + i % 3 * 11, Math.sin(a) * 194); marker.updateMatrix(); beacons.setMatrixAt(i, marker.matrix);
  }
  beacons.computeBoundingSphere(); world.group.add(beacons);

  const steamGeometry = new THREE.PlaneGeometry(1, 1); phaseAttribute(steamGeometry, 24);
  const steamAge = fract(clock.mul(.1).add(phase));
  const steamMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x536778, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const shape = smoothstep(.12, .5, length(uv().sub(.5))).oneMinus();
  steamMaterial.opacityNode = shape.pow(2).mul(sin(steamAge.mul(Math.PI))).mul(.18);
  steamMaterial.positionNode = positionLocal.mul(steamAge.mul(.8).add(.6)).add(vec3(sin(clock.mul(.3).add(phase.mul(8))).mul(.15), steamAge.mul(1.6), 0));
  const steam = new THREE.InstancedMesh(steamGeometry, steamMaterial, 24);
  steam.name = "Perimeter cooling vent steam"; steam.frustumCulled = false;
  for (let i = 0; i < steam.count; i++) {
    const side = Math.floor(i / 6), offset = (i % 6 - 2.5) * 31;
    marker.position.set(side % 2 ? (side === 1 ? 110.7 : -110.7) : offset, 3.4 + i % 3 * 9, side % 2 ? offset : (side === 0 ? -110.7 : 110.7));
    marker.lookAt(0, marker.position.y, 0); marker.scale.set(3, 6, 1); marker.updateMatrix(); steam.setMatrixAt(i, marker.matrix);
  }
  world.group.add(steam);

  const beamGeometry = new THREE.ConeGeometry(1, 1, 12, 1, true); phaseAttribute(beamGeometry, 4);
  const beamMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x376887, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  beamMaterial.opacityNode = abs(normalViewGeometry.dot(positionViewDirection)).pow(2).mul(smoothstep(0, .28, uv().y)).mul(.026);
  beamMaterial.positionNode = positionLocal.add(vec3(sin(clock.mul(.12).add(phase.mul(6))).mul(positionLocal.y.add(.5)).mul(.7), 0, cos(clock.mul(.09).add(phase.mul(6))).mul(positionLocal.y.add(.5)).mul(.7)));
  const beams = new THREE.InstancedMesh(beamGeometry, beamMaterial, 4);
  beams.name = "Slow skyline searchlights"; beams.frustumCulled = false;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .7; marker.position.set(Math.cos(a) * 180, 137, Math.sin(a) * 180); marker.rotation.set(Math.PI, 0, .1); marker.scale.set(18, 105, 18); marker.updateMatrix(); beams.setMatrixAt(i, marker.matrix); }
  world.group.add(beams);
  world.cityLife = { signs, traffic, beacons, steam, beams };
  world.updateCityLife = () => {
    const t = world.atmosphereTime.value % 97;
    world.atmosphere.lightning.value = world.reducedMotion ? 0 : t > 81 && t < 81.45 ? Math.max(0, Math.sin((t - 81) * 35)) ** 8 * .035 : 0;
  };
}
