import * as THREE from "three/webgpu";
import { abs, color, fract, length, max, min, mix, sin, smoothstep, time, uniform, uv, vec2, vec3 } from "three/tsl";
import { MAP_THEMES, seededRandom, seedFromText } from "./gameData.js";

const TAU = Math.PI * 2;
const DISTRICT_PALETTES = {
  foundry: [0x28e7ff, 0xff4f87, 0xffc247, 0x9d7bff],
  solar: [0xffc34f, 0xff526f, 0x43ddff, 0xa7ff66],
  ion: [0x4dffc2, 0xff58dc, 0x6b9cff, 0xffcc58]
};

function proceduralPanelTexture(seed, repeat = 4) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const random = seededRandom(seedFromText(`${seed}-panels-${repeat}`));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const seam = x % 16 < 1 || y % 16 < 1;
      const bevel = x % 16 === 1 || y % 16 === 1;
      const rivet = (x % 16 === 3 || x % 16 === 13) && (y % 16 === 3 || y % 16 === 13);
      const grain = Math.floor(random() * 18);
      const value = rivet ? 250 : seam ? 142 + grain : bevel ? 226 : 196 + grain;
      data[index] = value;
      data[index + 1] = value + (seam ? 4 : 0);
      data[index + 2] = Math.min(255, value + 9);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function proceduralSurfaceDetail(seed, repeat = 4, normal = false) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const random = seededRandom(seedFromText(`${seed}-${normal ? "normal" : "roughness"}-${repeat}`));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const cellX = x % 16;
      const cellY = y % 16;
      const seamX = cellX === 0;
      const seamY = cellY === 0;
      const bevelX = cellX === 1 || cellX === 15;
      const bevelY = cellY === 1 || cellY === 15;
      const rivet = (cellX === 3 || cellX === 13) && (cellY === 3 || cellY === 13);
      if (normal) {
        data[index] = seamX ? 96 : cellX === 1 ? 164 : cellX === 15 ? 112 : 128;
        data[index + 1] = seamY ? 96 : cellY === 1 ? 164 : cellY === 15 ? 112 : 128;
        data[index + 2] = rivet ? 226 : 255;
      } else {
        const value = rivet ? 92 : seamX || seamY ? 228 : bevelX || bevelY ? 142 : 166 + Math.floor(random() * 24);
        data[index] = data[index + 1] = data[index + 2] = value;
      }
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function radialGlowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const distance = Math.hypot((x + .5) / size - .5, (y + .5) / size - .5) * 2;
      const alpha = Math.max(0, 1 - distance);
      data[index] = data[index + 1] = data[index + 2] = 255;
      data[index + 3] = Math.floor(255 * alpha * alpha * alpha);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function pushBar(vertices, ax, az, bx, bz, width) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  const nx = -dz / length * width / 2;
  const nz = dx / length * width / 2;
  vertices.push(
    ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx - nx, 0, bz - nz,
    ax + nx, 0, az + nz, bx - nx, 0, bz - nz, bx + nx, 0, bz + nz
  );
}

function routeMarkingGeometry(width, depth, brokenBorder = false) {
  const vertices = [];
  const inset = Math.min(.7, Math.min(width, depth) * .12);
  const halfW = width / 2 - inset;
  const halfD = depth / 2 - inset;
  const line = Math.min(.18, Math.min(width, depth) * .05);
  if (brokenBorder) {
    const xCut = Math.min(3.2, halfW * .36);
    const zCut = Math.min(3.2, halfD * .36);
    for (const xSide of [-1, 1]) for (const zSide of [-1, 1]) {
      pushBar(vertices, xSide * halfW, zSide * halfD, xSide * (halfW - xCut), zSide * halfD, line);
      pushBar(vertices, xSide * halfW, zSide * halfD, xSide * halfW, zSide * (halfD - zCut), line);
    }
  } else {
    pushBar(vertices, -halfW, -halfD, halfW, -halfD, line);
    pushBar(vertices, halfW, -halfD, halfW, halfD, line);
    pushBar(vertices, halfW, halfD, -halfW, halfD, line);
    pushBar(vertices, -halfW, halfD, -halfW, -halfD, line);
  }

  const alongX = width >= depth;
  const span = Math.max(width, depth);
  const cross = Math.min(width, depth);
  const arrowSize = Math.min(1.5, cross * .24);
  for (const direction of [-1, 0, 1]) {
    const center = direction * Math.min(span * .22, 5);
    if (alongX) {
      pushBar(vertices, center - arrowSize, -arrowSize, center, 0, line * 1.25);
      pushBar(vertices, center - arrowSize, arrowSize, center, 0, line * 1.25);
    } else {
      pushBar(vertices, -arrowSize, center - arrowSize, 0, center, line * 1.25);
      pushBar(vertices, arrowSize, center - arrowSize, 0, center, line * 1.25);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function platformSilhouetteGeometry(width, height, depth) {
  const vertices = [];
  const halfW = width / 2;
  const halfD = depth / 2;
  const top = height / 2 + .01;
  const bottom = -height / 2;
  const xCut = Math.min(2.6, width * .16);
  const zCut = Math.min(2.6, depth * .16);
  const segment = (ax, ay, az, bx, by, bz) => vertices.push(ax, ay, az, bx, by, bz);
  for (const xSide of [-1, 1]) for (const zSide of [-1, 1]) {
    const x = xSide * halfW;
    const z = zSide * halfD;
    segment(x, top, z, xSide * (halfW - xCut), top, z);
    segment(x, top, z, x, top, zSide * (halfD - zCut));
    segment(x, top, z, x, Math.max(bottom, top - .55), z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function material(color, emissive = 0, opacity = 1, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? .62,
    metalness: options.metalness ?? .32,
    emissive,
    emissiveIntensity: emissive ? options.emissiveIntensity ?? .55 : 0,
    envMapIntensity: options.envMapIntensity ?? .92,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= .4,
    side: options.side ?? THREE.FrontSide,
    map: options.map ?? null,
    normalMap: options.normalMap ?? null,
    normalScale: options.normalScale ?? new THREE.Vector2(.42, .42),
    roughnessMap: options.roughnessMap ?? null
  });
}

function box(w, h, d, color, x, y, z, emissive = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, emissive));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function segmentCircle(a, b, c, radius) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(ab) / Math.max(.001, ab.lengthSq()), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(c) <= radius;
}

export class ArenaWorld {
  constructor(scene, seed = "BLAST-01") {
    this.scene = scene;
    this.seed = seed;
    this.theme = MAP_THEMES[seedFromText(seed) % MAP_THEMES.length];
    this.districtColors = DISTRICT_PALETTES[this.theme.id] || DISTRICT_PALETTES.foundry;
    this.previousBackground = scene.background;
    this.previousFog = scene.fog;
    scene.background = new THREE.Color(this.theme.haze).offsetHSL(0, .08, .035);
    scene.fog = new THREE.FogExp2(this.theme.haze, .0044);
    this.size = 112;
    this.height = 78;
    this.group = new THREE.Group();
    this.group.name = "Neon Parkour Arena";
    this.obstacles = [];
    this.destructibles = [];
    this.anchors = [];
    this.platforms = [];
    this.cameraOccluders = [];
    this.cameraRaycaster = new THREE.Raycaster();
    this.boostPads = [];
    this.movers = [];
    this.portals = [];
    this.sweepers = [];
    this.temporaryWalls = [];
    this.rotors = [];
    this.pulsers = [];
    this.textures = [
      proceduralPanelTexture(`${seed}-structure`, 4),
      proceduralPanelTexture(`${seed}-ground`, 28),
      radialGlowTexture(),
      proceduralSurfaceDetail(`${seed}-structure`, 4, true),
      proceduralSurfaceDetail(`${seed}-structure`, 4, false),
      proceduralSurfaceDetail(`${seed}-ground`, 28, true),
      proceduralSurfaceDetail(`${seed}-ground`, 28, false)
    ];
    [this.panelTexture, this.groundTexture, this.glowTexture, this.panelNormal, this.panelRoughness, this.groundNormal, this.groundRoughness] = this.textures;
    this.routeMaterials = this.districtColors.map((color) => new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(1.65),
      transparent: true,
      opacity: .42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    }));
    this.lineMaterials = this.districtColors.map((color) => new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: .32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    }));
    this.time = 0;
    scene.add(this.group);
    this.build();
  }

  build() {
    const random = seededRandom(seedFromText(this.seed));
    this.ground = box(this.size * 2, .5, this.size * 2, this.theme.ground, 0, -.28, 0);
    this.ground.name = "Arena floor";
    this.ground.material.map = this.groundTexture;
    this.ground.material.normalMap = this.groundNormal;
    this.ground.material.normalScale.set(.36, .36);
    this.ground.material.roughnessMap = this.groundRoughness;
    this.ground.material.roughness = .9;
    this.ground.material.metalness = .14;
    this.group.add(this.ground);
    this.addGroundTreatment();
    this.addDistrictLights();

    const grid = new THREE.GridHelper(this.size * 2, 44, this.theme.grid, 0x244b67);
    grid.position.y = .018;
    grid.material.opacity = .11;
    grid.material.transparent = true;
    grid.material.depthWrite = false;
    this.group.add(grid);

    for (const [x, z, w, d] of [
      [0, -this.size, this.size * 2, 1.2], [0, this.size, this.size * 2, 1.2],
      [-this.size, 0, 1.2, this.size * 2], [this.size, 0, 1.2, this.size * 2]
    ]) this.addBox(x, z, w, d, 44, 0x263d53);
    this.addBoundaryBands();

    // Four real combat elevations plus a 70-metre central grapple spire.
    this.addPlatform(0, 15, 0, 42, 42, 1.5, 0x203d55);
    this.addPlatform(42, 31, -22, 34, 26, 1.5, 0x263f58);
    this.addPlatform(-42, 47, 30, 32, 28, 1.5, 0x263f58);
    this.addPlatform(0, 66, 0, 28, 28, 1.7, 0x294b65);

    this.addPlatform(-52, 15, -48, 34, 26, 1.4, 0x203d55);
    this.addPlatform(53, 15, 49, 34, 26, 1.4, 0x203d55);
    this.addPlatform(54, 31, 33, 30, 22, 1.4, 0x203d55);
    this.addPlatform(-53, 47, -27, 30, 22, 1.4, 0x203d55);

    // Long aerial bridges turn the map into a navigable volume, not stacked islands.
    this.addPlatform(-26, 15, -24, 50, 5, 1, 0x35566d);
    this.addPlatform(28, 15, 24, 54, 5, 1, 0x35566d);
    this.addPlatform(31, 31, 4, 5, 48, 1, 0x35566d);
    this.addPlatform(-30, 47, 14, 5, 48, 1, 0x35566d);
    this.addPlatform(0, 66, 28, 5, 30, 1, 0x35566d);

    const towers = [
      [0, 0, 70], [-72, -66, 40], [72, 66, 54], [70, -62, 72], [-68, 66, 62],
      [42, -22, 45], [-42, 30, 59]
    ].map(([x, z, h]) => this.addBox(x, z, 7, 7, h, 0x1d344b, false, true));
    towers.forEach((tower, index) => this.addLandmark(tower, index));

    // Alternate ascent routes for players who miss a grapple.
    for (const pad of [
      [-18, 0, -18, 24], [18, 0, 18, 24], [-66, 0, 22, 29], [66, 0, -22, 29],
      [-52, 15, -48, 26], [53, 15, 49, 26], [42, 31, -22, 27], [-42, 47, 30, 28]
    ]) this.addBoostPad(...pad);

    this.addMovingPlatform(-80, 18, 0, 12, 10, "y", 11, .85, 0);
    this.addMovingPlatform(80, 25, 0, 12, 10, "y", 15, .7, Math.PI);
    this.addMovingPlatform(0, 34, -82, 11, 11, "x", 25, .62, Math.PI / 2);
    this.addMovingPlatform(0, 51, 82, 11, 11, "x", 25, .55, -Math.PI / 2);
    this.addPortalPair(new THREE.Vector3(-96, 0, 0), new THREE.Vector3(0, 66, -10));
    this.addPortalPair(new THREE.Vector3(96, 0, 0), new THREE.Vector3(0, 66, 10));
    this.addSweeper(-70, 0, 48, 20, 1.15);
    this.addSweeper(70, 0, -48, 24, -.9);

    for (let i = 0; i < 34; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 24 + random() * 74;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const w = 3 + random() * 5;
      const d = 3 + random() * 5;
      const h = 2.5 + random() * 5;
      this.addBox(x, z, w, d, h, i % 3 ? this.theme.danger : this.theme.accent, true);
    }
    this.addDistantSkyline();
    this.addAtmosphere();
  }

  districtIndexAt(x, z) {
    if (z < 0) return x < 0 ? 0 : 1;
    return x < 0 ? 3 : 2;
  }

  districtColorAt(x, z) {
    return this.districtColors[this.districtIndexAt(x, z)];
  }

  addDistrictLights() {
    const positions = [[-58, -58], [58, -58], [58, 58], [-58, 58]];
    const pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: this.glowTexture,
        vertexColors: true,
        transparent: true,
        opacity: .12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      positions.length
    );
    const marker = new THREE.Object3D();
    positions.forEach(([x, z], index) => {
      marker.position.set(x, .022, z);
      marker.rotation.set(-Math.PI / 2, 0, 0);
      marker.scale.set(46, 46, 1);
      marker.updateMatrix();
      pools.setMatrixAt(index, marker.matrix);
      pools.setColorAt(index, new THREE.Color(this.districtColors[index]));
    });
    pools.name = "District light pools";
    pools.instanceMatrix.needsUpdate = true;
    pools.instanceColor.needsUpdate = true;
    pools.computeBoundingSphere();
    this.group.add(pools);

    // Four restrained pools give each route quadrant its own readable lighting hierarchy.
    positions.forEach(([x, z], index) => {
      const light = new THREE.PointLight(this.districtColors[index], 19, 64, 2);
      light.name = `District ${index + 1} route light`;
      light.position.set(x, 23, z);
      light.castShadow = false;
      this.group.add(light);
    });
  }

  addGroundTreatment() {
    const p = uv().sub(.5).mul(224);
    const east = smoothstep(-3, 3, p.x);
    const south = smoothstep(-3, 3, p.y);
    const northColor = mix(color(this.districtColors[0]), color(this.districtColors[1]), east);
    const southColor = mix(color(this.districtColors[3]), color(this.districtColors[2]), east);
    const district = mix(northColor, southColor, south);
    const fineCell = abs(fract(p.add(112).div(4)).sub(.5));
    const majorCell = abs(fract(p.add(112).div(16)).sub(.5));
    const fineGrid = smoothstep(.465, .5, max(fineCell.x, fineCell.y));
    const majorGrid = smoothstep(.455, .5, max(majorCell.x, majorCell.y));
    const axial = smoothstep(.55, 1.1, min(abs(p.x), abs(p.y))).oneMinus();
    const diagonal = smoothstep(.8, 1.6, min(abs(p.x.sub(p.y)), abs(p.x.add(p.y)))).oneMinus()
      .mul(smoothstep(22, 38, length(p)));
    const districtCenter = vec2(
      p.x.lessThan(0).select(-62, 62),
      p.y.lessThan(0).select(-62, 62)
    );
    const orbit = smoothstep(.55, 1.25, abs(length(p.sub(districtCenter)).sub(23))).oneMinus();
    const pulse = sin(time.mul(2.2).sub(length(p).mul(.11))).mul(.32).add(.68);
    const route = max(axial, max(diagonal.mul(.55), orbit.mul(.72)));
    const routeLight = majorGrid.mul(.22).add(route.mul(.16));
    const routeColor = mix(district.mul(.68), vec3(1), routeLight);
    const alpha = fineGrid.mul(.03).add(majorGrid.mul(.085)).add(route.mul(.14).mul(pulse)).add(.025);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    material.colorNode = routeColor;
    material.opacityNode = alpha;
    const overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size * 2, this.size * 2),
      material
    );
    overlay.name = "District route floor";
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.y = .006;
    overlay.receiveShadow = true;
    this.group.add(overlay);
  }

  addBoundaryBands() {
    const levels = [15, 31, 47, 66];
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const bands = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: .52,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      levels.length * 4
    );
    const marker = new THREE.Object3D();
    let instance = 0;
    for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
      const y = levels[levelIndex];
      for (let side = 0; side < 4; side++) {
        const horizontal = side < 2;
        marker.position.set(
          horizontal ? 0 : side === 2 ? -this.size + .64 : this.size - .64,
          y,
          horizontal ? side === 0 ? -this.size + .64 : this.size - .64 : 0
        );
        marker.scale.set(horizontal ? this.size * 2 - 2 : .09, .09, horizontal ? .09 : this.size * 2 - 2);
        marker.updateMatrix();
        bands.setMatrixAt(instance, marker.matrix);
        bands.setColorAt(instance, new THREE.Color(this.districtColors[(side + levelIndex) % 4]));
        instance++;
      }
    }
    bands.name = "Vertical route altitude bands";
    bands.instanceMatrix.needsUpdate = true;
    bands.instanceColor.needsUpdate = true;
    bands.computeBoundingSphere();
    this.group.add(bands);
  }

  addDistantSkyline() {
    const random = seededRandom(seedFromText(`${this.seed}-skyline`));
    const count = 52;
    const specs = [];
    for (let index = 0; index < count; index++) {
      const angle = index / count * TAU + (random() - .5) * .065;
      const layer = index % 3;
      const district = this.districtIndexAt(Math.cos(angle), Math.sin(angle));
      specs.push({
        district,
        layer,
        angle,
        // Keep decorative skyline geometry well beyond the third-person camera.
        // Its deepest towers used to overlap the camera orbit at the arena edge,
        // where their dark faces looked like large moving black rectangles.
        radius: this.size + 44 + layer * 18 + random() * 10,
        width: 6 + random() * 10 + (district === 2 ? 5 : 0),
        depth: 6 + random() * 9,
        height: 25 + random() * (layer === 0 ? 58 : 42) + district * 3
      });
    }

    const families = [
      {
        name: "Cyan relay arcologies",
        base: new THREE.BoxGeometry(1, 1, 1),
        crown: new THREE.BoxGeometry(1, 1, 1),
        baseScale: (spec) => [spec.width * .58, spec.height, spec.depth * .5],
        crownScale: (spec) => [spec.width * 1.05, .72, spec.depth * .22]
      },
      {
        name: "Rose split-prism towers",
        base: new THREE.CylinderGeometry(.72, .92, 1, 4),
        crown: new THREE.BoxGeometry(1, 1, 1),
        baseScale: (spec) => [spec.width * .34, spec.height * .82, spec.depth * .5],
        crownScale: (spec) => [spec.width * .28, spec.height * .58, spec.depth * .46]
      },
      {
        name: "Amber foundry stacks",
        base: new THREE.BoxGeometry(1, 1, 1),
        crown: new THREE.CylinderGeometry(.19, .25, 1, 6),
        baseScale: (spec) => [spec.width, spec.height * .64, spec.depth * .78],
        crownScale: (spec) => [spec.width * .12, 7 + spec.height * .2, spec.depth * .12]
      },
      {
        name: "Violet crystal habitats",
        base: new THREE.CylinderGeometry(.66, .92, 1, 8),
        crown: new THREE.CylinderGeometry(1, 1, 1, 8),
        baseScale: (spec) => [spec.width * .56, spec.height * .72, spec.depth * .56],
        crownScale: (spec) => [spec.width * .72, 1.4 + spec.width * .08, spec.depth * .72]
      }
    ];
    const marker = new THREE.Object3D();
    families.forEach((family, district) => {
      const entries = specs.filter((spec) => spec.district === district);
      const base = new THREE.InstancedMesh(
        family.base,
        new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .82, metalness: .28, emissive: 0x02070c, emissiveIntensity: .14 }),
        entries.length
      );
      const crowns = new THREE.InstancedMesh(
        family.crown,
        new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .66, metalness: .42, emissive: 0x02070c, emissiveIntensity: .22 }),
        entries.length
      );
      entries.forEach((spec, index) => {
        const { angle, radius, height, layer, width } = spec;
        const value = [.42, .24, .14][layer];
        const tint = new THREE.Color(this.districtColors[district]).multiplyScalar(value).addScalar(.012 + (2 - layer) * .006);
        const tangentX = -Math.sin(angle);
        const tangentZ = Math.cos(angle);
        const splitOffset = district === 1 ? width * .24 : 0;
        marker.position.set(
          Math.cos(angle) * radius + tangentX * splitOffset,
          height / 2 - 4,
          Math.sin(angle) * radius + tangentZ * splitOffset
        );
        marker.rotation.set(0, Math.PI / 2 - angle, 0);
        marker.scale.set(...family.baseScale(spec));
        marker.updateMatrix();
        base.setMatrixAt(index, marker.matrix);
        base.setColorAt(index, tint);

        marker.position.set(
          Math.cos(angle) * radius - tangentX * splitOffset,
          district === 1 ? height * .29 - 4 : district === 3 ? height * .86 - 3.2 : height - (district === 2 ? 2 : 3),
          Math.sin(angle) * radius - tangentZ * splitOffset
        );
        marker.rotation.set(0, district === 1 ? Math.PI / 4 - angle : -angle, district === 0 ? (index % 2 ? .12 : -.12) : 0);
        marker.scale.set(...family.crownScale(spec));
        marker.updateMatrix();
        crowns.setMatrixAt(index, marker.matrix);
        crowns.setColorAt(index, tint.clone().multiplyScalar(1.35));
      });
      base.name = `${family.name} — layered bodies`;
      crowns.name = `${family.name} — authored crowns`;
      base.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
      base.instanceColor.needsUpdate = crowns.instanceColor.needsUpdate = true;
      base.computeBoundingSphere();
      crowns.computeBoundingSphere();
      this.group.add(base, crowns);
    });

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const lightStrips = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: .28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
      count
    );
    specs.forEach(({ angle, radius, width, depth, height, district, layer }, index) => {
      const color = new THREE.Color(this.districtColors[district]);
      marker.position.set(
        Math.cos(angle) * (radius - depth / 2 - .1),
        height * .52,
        Math.sin(angle) * (radius - depth / 2 - .1)
      );
      marker.rotation.set(0, Math.PI / 2 - angle, 0);
      marker.scale.set(Math.max(.1, width * .045), height * (.52 - layer * .08), .09);
      marker.updateMatrix();
      lightStrips.setMatrixAt(index, marker.matrix);
      lightStrips.setColorAt(index, color.multiplyScalar([1, .62, .38][layer]));
    });
    lightStrips.name = "Procedural horizon lights";
    lightStrips.instanceMatrix.needsUpdate = true;
    lightStrips.instanceColor.needsUpdate = true;
    lightStrips.computeBoundingSphere();
    this.group.add(lightStrips);
    this.skylineLights = lightStrips;
  }

  addAtmosphere() {
    const horizonMark = new THREE.Group();
    const horizonColor = this.districtColors[1];
    horizonMark.position.set(-58, 68, -this.size - 8);
    horizonMark.lookAt(0, 34, 0);
    const horizonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(7.5, 48),
      new THREE.MeshBasicMaterial({ color: horizonColor, transparent: true, opacity: .18, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    const horizonRing = new THREE.Mesh(
      new THREE.TorusGeometry(11, .22, 7, 64),
      new THREE.MeshBasicMaterial({ color: horizonColor, transparent: true, opacity: .17, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    const horizonHalo = this.glowSprite(horizonColor, 34, .18);
    horizonMark.add(horizonDisc, horizonRing, horizonHalo);
    this.group.add(horizonMark);
    this.rotors.push({ object: horizonRing, x: 0, y: 0, z: .035 });

    const random = seededRandom(seedFromText(`${this.seed}-motes`));
    const count = 220;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      const x = (random() * 2 - 1) * (this.size - 5);
      const z = (random() * 2 - 1) * (this.size - 5);
      const color = new THREE.Color(this.districtColorAt(x, z)).lerp(new THREE.Color(0xffffff), .45);
      positions.set([x, 4 + random() * (this.height + 10), z], index * 3);
      colors.set([color.r, color.g, color.b], index * 3);
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    moteGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const motes = new THREE.Points(
      moteGeometry,
      new THREE.PointsMaterial({
        size: .22,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: .2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    motes.name = "Atmospheric energy motes";
    this.group.add(motes);
    this.motes = motes;
  }

  glowSprite(color, size, opacity = .3) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color: new THREE.Color(color).multiplyScalar(1.8),
      map: this.glowTexture,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    }));
    sprite.scale.setScalar(size);
    return sprite;
  }

  addLandmark(tower, index) {
    const central = index === 0;
    const color = central ? this.districtColors[0] : this.districtColorAt(tower.x, tower.z);
    if (central) this.addCentralTowerArchitecture(tower);
    const root = new THREE.Group();
    root.name = central ? "Central prism crown" : `District landmark ${index}`;
    root.position.set(tower.x, tower.top + (central ? -.48 : .55), tower.z);

    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(central ? 2.5 : 3.5, central ? .1 : .08, 8, 48),
      material(0x06111b, color, .58, { roughness: .34, metalness: .6, emissiveIntensity: central ? .42 : .56 })
    );
    outer.rotation.x = Math.PI / 2;
    if (central) outer.position.x = -2.25;
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(central ? 1.65 : 2.4, .065, 6, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: central ? .22 : .28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    if (central) {
      inner.rotation.x = Math.PI / 2;
      inner.position.x = 2.65;
    }
    else inner.rotation.y = Math.PI / 2;
    const shape = central
      ? new THREE.IcosahedronGeometry(1.25, 0)
      : [
          () => new THREE.OctahedronGeometry(1.05, 0),
          () => new THREE.TorusKnotGeometry(.76, .17, 44, 6),
          () => new THREE.ConeGeometry(.95, 2.2, 4),
          () => new THREE.DodecahedronGeometry(.95, 0)
        ][index % 4]();
    const core = new THREE.Mesh(
      shape,
      material(0x07131f, color, .92, { roughness: .3, metalness: .55, emissiveIntensity: central ? .72 : .9 })
    );
    core.position.set(central ? 2.65 : 0, central ? .32 : 1.75, 0);
    if (central) core.scale.setScalar(.58);

    const crownBase = new THREE.Mesh(
      new THREE.CylinderGeometry(central ? 4.2 : 4, central ? 3.85 : 3.35, central ? .48 : .82, central ? 8 : 6),
      material(0x030910, color, 1, { roughness: .5, metalness: .72, emissiveIntensity: central ? .15 : .1 })
    );
    crownBase.name = central ? "Central reactor crown chassis" : "Route landmark chassis";
    crownBase.position.y = central ? .15 : .05;
    crownBase.castShadow = true;

    const wayfinderGeometry = central
      ? new THREE.BoxGeometry(.42, .72, .76)
      : new THREE.BoxGeometry(.38, 2.8, .72);
    const wayfinders = new THREE.InstancedMesh(
      wayfinderGeometry,
      material(0x040a12, color, 1, { roughness: .4, metalness: .68, emissiveIntensity: .28 }),
      central ? 4 : 4
    );
    const wayfinderMarker = new THREE.Object3D();
    const wayfinderCount = 4;
    const centralWayfinders = [[-3.5, -.7], [-3.5, .7], [3.5, -.7], [3.5, .7]];
    for (let prong = 0; prong < wayfinderCount; prong++) {
      const angle = prong / wayfinderCount * TAU + Math.PI / 4;
      const radius = central ? 3.72 : 3.45;
      if (central) wayfinderMarker.position.set(centralWayfinders[prong][0], .28, centralWayfinders[prong][1]);
      else wayfinderMarker.position.set(Math.cos(angle) * radius, 1.35, Math.sin(angle) * radius);
      wayfinderMarker.rotation.set(0, central ? 0 : -angle, central ? (prong % 2 ? .1 : -.1) : 0);
      wayfinderMarker.scale.set(central ? .86 : 1, central && prong % 2 ? .74 : 1, 1);
      wayfinderMarker.updateMatrix();
      wayfinders.setMatrixAt(prong, wayfinderMarker.matrix);
    }
    wayfinders.name = central ? "Central route crown blades" : "District wayfinder blades";
    wayfinders.instanceMatrix.needsUpdate = true;
    wayfinders.computeBoundingSphere();
    if (!central) {
      const district = this.districtIndexAt(tower.x, tower.z);
      const silhouetteGeometry = district === 0
        ? new THREE.CylinderGeometry(.2, .48, 1, 6)
        : district === 1
          ? new THREE.ConeGeometry(.48, 1, 4)
          : district === 2
            ? new THREE.BoxGeometry(1, 1, 1)
            : new THREE.OctahedronGeometry(.48, 0);
      const silhouette = new THREE.InstancedMesh(
        silhouetteGeometry,
        material(0x06101a, color, 1, { roughness: .56, metalness: .5, emissiveIntensity: .16 }),
        4
      );
      const marker = new THREE.Object3D();
      for (let prong = 0; prong < 4; prong++) {
        const angle = prong / 4 * TAU + Math.PI / 4;
        marker.position.set(Math.cos(angle) * 2.45, 1.2 + prong % 2 * .35, Math.sin(angle) * 2.45);
        marker.rotation.set(0, -angle, district === 1 ? Math.PI : 0);
        marker.scale.set(district === 2 ? .34 : 1, 1.8 + prong % 2 * .65, district === 2 ? .82 : 1);
        marker.updateMatrix();
        silhouette.setMatrixAt(prong, marker.matrix);
      }
      silhouette.name = ["Antenna crown", "Prism crown", "Machinery vane crown", "Crystal crown"][district];
      silhouette.instanceMatrix.needsUpdate = true;
      silhouette.computeBoundingSphere();
      root.add(silhouette);
    }
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(.08, central ? .24 : .28, central ? 1.5 : 9, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: central ? .085 : .07,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    beam.position.set(central ? 2.65 : 0, central ? .75 : 4.5, 0);
    const glow = this.glowSprite(color, central ? 3 : 6, central ? .075 : .11);
    glow.position.copy(core.position);
    root.add(crownBase, wayfinders, outer, inner, beam, glow, core);
    this.group.add(root);
    this.rotors.push(
      { object: outer, x: 0, y: central ? .22 : .38, z: central ? 0 : -.24 },
      { object: inner, x: central ? 0 : -.31, y: -.28, z: central ? 0 : .12 },
      { object: core, x: .18, y: central ? .7 : .48, z: .1 }
    );
    this.pulsers.push({ object: glow, base: central ? 3 : 6, amplitude: .055, speed: central ? 1.8 : 2.25, phase: index });
  }

  addCentralTowerArchitecture(tower) {
    tower.mesh.material.transparent = true;
    tower.mesh.material.opacity = 0;
    tower.mesh.material.depthWrite = false;
    tower.mesh.material.colorWrite = false;
    for (const child of tower.mesh.children) child.visible = false;

    const structure = new THREE.Group();
    structure.name = "Layered central reactor";
    structure.position.set(tower.x, 0, tower.z);
    const levels = [0, 15, 31, 47, 66, 70];
    for (let index = 0; index < levels.length - 1; index++) {
      const bottom = levels[index] + .18;
      const top = levels[index + 1] - .18;
      const color = this.districtColors[index % this.districtColors.length];
      const facadeMaterial = material(
        new THREE.Color(0x06111b).lerp(new THREE.Color(color), .075),
        color,
        1,
        {
          roughness: .72, metalness: .34, emissiveIntensity: .035, map: this.panelTexture,
          normalMap: this.panelNormal, roughnessMap: this.panelRoughness
        }
      );
      const facade = new THREE.Mesh(new THREE.CylinderGeometry(3.72, 3.55, top - bottom, 8), facadeMaterial);
      facade.position.y = (bottom + top) / 2;
      facade.castShadow = true;
      facade.receiveShadow = true;
      structure.add(facade);
      this.cameraOccluders.push(facade);
    }

    const bands = new THREE.InstancedMesh(
      new THREE.TorusGeometry(3.62, .095, 6, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: .26, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      5
    );
    const marker = new THREE.Object3D();
    [15, 31, 47, 66, 69.85].forEach((y, index) => {
      marker.position.set(0, y, 0);
      marker.rotation.set(Math.PI / 2, 0, 0);
      marker.scale.setScalar(1);
      marker.updateMatrix();
      bands.setMatrixAt(index, marker.matrix);
      bands.setColorAt(index, new THREE.Color(this.districtColors[index % 4]));
    });
    bands.name = "Central level collars";
    bands.instanceMatrix.needsUpdate = true;
    bands.instanceColor.needsUpdate = true;

    const fins = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      8
    );
    for (let index = 0; index < 8; index++) {
      const angle = index / 8 * TAU;
      marker.position.set(Math.cos(angle) * 3.61, 35, Math.sin(angle) * 3.61);
      marker.rotation.set(0, -angle, 0);
      marker.scale.set(.11, 68.5, .32);
      marker.updateMatrix();
      fins.setMatrixAt(index, marker.matrix);
      fins.setColorAt(index, new THREE.Color(this.districtColors[index % 4]));
    }
    fins.name = "Central district fins";
    fins.instanceMatrix.needsUpdate = true;
    fins.instanceColor.needsUpdate = true;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3.9, 3.72, 1.05, 8),
      material(0x050d16, this.districtColors[2], 1, { roughness: .62, metalness: .5, emissiveIntensity: .08 })
    );
    base.position.y = 15.45;
    structure.add(base, bands, fins);
    this.cameraOccluders.push(base);
    this.group.add(structure);
  }

  decoratePlatform(platform) {
    const district = this.districtIndexAt(platform.x, platform.z);
    const color = this.districtColors[district];
    platform.mesh.material.color.setHex(0x08131f).lerp(new THREE.Color(color), .065);
    platform.mesh.material.emissive.setHex(color);
    platform.mesh.material.emissiveIntensity = .025;
    platform.mesh.material.roughness = .68;
    platform.mesh.material.metalness = .24;

    const markings = new THREE.Mesh(routeMarkingGeometry(platform.w, platform.d, true), this.routeMaterials[district]);
    markings.name = "Traversal markings";
    markings.position.y = platform.h / 2 + .016;
    markings.renderOrder = 2;
    platform.mesh.add(markings);

    const edges = new THREE.LineSegments(platformSilhouetteGeometry(platform.w, platform.h, platform.d), this.lineMaterials[district]);
    edges.name = "Readable platform silhouette";
    edges.renderOrder = 2;
    platform.mesh.add(edges);
    if (platform.top >= 65 && Math.abs(platform.x) < 1 && Math.abs(platform.z) < 1) this.addHeroDeckComposition(platform, district, color);
    if (Math.min(platform.w, platform.d) >= 12) this.addDeckInterruptions(platform, district, color);
    if (Math.min(platform.w, platform.d) >= 18) this.addPlatformUnderstructure(platform, color);
    else if (Math.min(platform.w, platform.d) <= 8 && Math.max(platform.w, platform.d) >= 20) this.addTraversalConduits(platform, color);
  }

  addHeroDeckComposition(platform, district, color) {
    const top = platform.h / 2;
    const channelMaterial = material(0x01040a, color, 1, { roughness: .82, metalness: .28, emissiveIntensity: .035 });
    const channels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), channelMaterial, 8);
    const marker = new THREE.Object3D();
    const armLengthX = platform.w * .31;
    const armLengthZ = platform.d * .31;
    const arms = [
      [-platform.w * .325, 0, armLengthX, 3.25], [platform.w * .325, 0, armLengthX, 3.25],
      [0, -platform.d * .325, 3.25, armLengthZ], [0, platform.d * .325, 3.25, armLengthZ]
    ];
    const bays = [
      [-platform.w * .29, -platform.d * .29], [platform.w * .29, -platform.d * .29],
      [-platform.w * .29, platform.d * .29], [platform.w * .29, platform.d * .29]
    ];
    arms.forEach(([x, z, w, d], index) => {
      marker.position.set(x, top + .027, z);
      marker.rotation.set(0, 0, 0);
      marker.scale.set(w, .045, d);
      marker.updateMatrix();
      channels.setMatrixAt(index, marker.matrix);
    });
    bays.forEach(([x, z], offset) => {
      marker.position.set(x, top + .03, z);
      marker.rotation.set(0, Math.PI / 4, 0);
      marker.scale.set(4.6, .055, 4.6);
      marker.updateMatrix();
      channels.setMatrixAt(offset + 4, marker.matrix);
    });
    channels.name = "Upper-deck shadow channels and service bays";
    channels.instanceMatrix.needsUpdate = true;
    channels.computeBoundingSphere();

    const lanes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      4
    );
    arms.forEach(([x, z, w, d], index) => {
      marker.position.set(x, top + .064, z);
      marker.scale.set(w * .82, .055, Math.min(w, d) * .075);
      if (d > w) marker.scale.set(Math.min(w, d) * .075, .055, d * .82);
      marker.updateMatrix();
      lanes.setMatrixAt(index, marker.matrix);
    });
    lanes.name = "Contrasting upper-deck traversal lanes";
    lanes.instanceMatrix.needsUpdate = true;
    lanes.computeBoundingSphere();

    const serviceNodes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.1, 1.28, .12, 6),
      material(0x02070d, color, 1, { roughness: .34, metalness: .78, emissiveIntensity: .24 }),
      4
    );
    bays.forEach(([x, z], index) => {
      marker.position.set(x, top + .085, z);
      marker.rotation.set(0, index * Math.PI / 6, 0);
      marker.scale.setScalar(index % 2 ? .82 : 1);
      marker.updateMatrix();
      serviceNodes.setMatrixAt(index, marker.matrix);
    });
    serviceNodes.name = "Flush upper-deck route relays";
    serviceNodes.instanceMatrix.needsUpdate = true;
    serviceNodes.computeBoundingSphere();

    const frame = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material(0x02060c, color, 1, { roughness: .5, metalness: .74, emissiveIntensity: .12 }),
      12
    );
    let instance = 0;
    for (const side of [-1, 1]) for (const offset of [-.32, 0, .32]) {
      marker.position.set(platform.w * offset, top + .07, side * (platform.d / 2 - .42));
      marker.rotation.set(0, 0, 0);
      marker.scale.set(2.55, .14, .72);
      marker.updateMatrix();
      frame.setMatrixAt(instance++, marker.matrix);
      marker.position.set(side * (platform.w / 2 - .42), top + .07, platform.d * offset);
      marker.rotation.set(0, Math.PI / 2, 0);
      marker.updateMatrix();
      frame.setMatrixAt(instance++, marker.matrix);
    }
    frame.name = "Upper-deck perimeter framing";
    frame.instanceMatrix.needsUpdate = true;
    frame.computeBoundingSphere();
    platform.mesh.add(channels, lanes, serviceNodes, frame);
  }

  addDeckInterruptions(platform, district, color) {
    const geometry = district === 0
      ? new THREE.CylinderGeometry(.78, .78, .05, 12)
      : district === 1
        ? new THREE.BoxGeometry(1.55, .05, .62)
        : district === 2
          ? new THREE.CylinderGeometry(.78, .78, .05, 6)
          : new THREE.OctahedronGeometry(.76, 0);
    const panels = new THREE.InstancedMesh(
      geometry,
      material(0x02070d, color, 1, { roughness: .38, metalness: .72, emissiveIntensity: .18 }),
      8
    );
    const marker = new THREE.Object3D();
    const positions = [
      [-.36, -.35], [0, -.39], [.36, -.35],
      [-.4, 0], [.4, 0],
      [-.36, .35], [0, .39], [.36, .35]
    ];
    positions.forEach(([xUnit, zUnit], index) => {
      marker.position.set(xUnit * platform.w, platform.h / 2 + .035, zUnit * platform.d);
      marker.rotation.set(0, district === 1 ? (index % 2 ? -.48 : .48) : index * Math.PI / 4, 0);
      marker.scale.set(
        district === 3 ? 1.05 : .82 + (index % 3) * .14,
        district === 3 ? .075 : 1,
        district === 3 ? 1.05 : .82 + (index % 2) * .16
      );
      marker.updateMatrix();
      panels.setMatrixAt(index, marker.matrix);
    });
    panels.name = ["Turbine deck hatches", "Shield deck blades", "Power-cell deck plates", "Reactor crystal insets"][district];
    panels.instanceMatrix.needsUpdate = true;
    panels.computeBoundingSphere();
    platform.mesh.add(panels);
  }

  addPlatformUnderstructure(platform, color) {
    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(platform.w * .84, .48, platform.d * .84),
      material(0x050b12, color, 1, { roughness: .8, metalness: .28, emissiveIntensity: .055 })
    );
    recess.name = "Recessed platform belly";
    recess.position.y = -platform.h / 2 - .28;
    recess.castShadow = false;
    platform.mesh.add(recess);

    const ribCount = 12;
    const ribs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material(0x07101a, color, 1, { roughness: .7, metalness: .42, emissiveIntensity: .09 }),
      ribCount
    );
    const marker = new THREE.Object3D();
    let instance = 0;
    for (const side of [-1, 1]) {
      for (const offset of [-.32, 0, .32]) {
        marker.position.set(platform.w * offset, -platform.h / 2 - .72, side * (platform.d / 2 - .72));
        marker.scale.set(Math.max(2.2, platform.w * .17), .92, 1.15);
        marker.updateMatrix();
        ribs.setMatrixAt(instance++, marker.matrix);

        marker.position.set(side * (platform.w / 2 - .72), -platform.h / 2 - .72, platform.d * offset);
        marker.scale.set(1.15, .92, Math.max(2.2, platform.d * .17));
        marker.updateMatrix();
        ribs.setMatrixAt(instance++, marker.matrix);
      }
    }
    ribs.name = "Modular edge understructure";
    ribs.instanceMatrix.needsUpdate = true;
    ribs.computeBoundingSphere();
    platform.mesh.add(ribs);

    const district = this.districtIndexAt(platform.x, platform.z);
    const moduleGeometry = district === 0
      ? new THREE.CylinderGeometry(.5, .72, 1.45, 8)
      : district === 1
        ? new THREE.OctahedronGeometry(.82, 0)
        : district === 2
          ? new THREE.ConeGeometry(.72, 1.55, 4)
          : new THREE.DodecahedronGeometry(.72, 0);
    const modules = new THREE.InstancedMesh(
      moduleGeometry,
      material(0x07111a, color, 1, { roughness: .5, metalness: .58, emissiveIntensity: .13 }),
      8
    );
    const modulePositions = [
      [-.28, -.5], [.28, -.5], [-.28, .5], [.28, .5],
      [-.5, -.28], [-.5, .28], [.5, -.28], [.5, .28]
    ];
    modulePositions.forEach(([xUnit, zUnit], index) => {
      marker.position.set(xUnit * (platform.w - 1.35), -platform.h / 2 - 1.18, zUnit * (platform.d - 1.35));
      marker.rotation.set(index % 2 ? Math.PI / 2 : 0, index * Math.PI / 4, district === 0 ? Math.PI / 2 : 0);
      marker.scale.setScalar(index % 3 === 0 ? 1.18 : .9);
      marker.updateMatrix();
      modules.setMatrixAt(index, marker.matrix);
    });
    modules.name = ["Cyan turbine modules", "Rose prism modules", "Amber power vanes", "Violet reactor pods"][district];
    modules.instanceMatrix.needsUpdate = true;
    modules.computeBoundingSphere();
    platform.mesh.add(modules);

    const facadeGeometry = district === 0
      ? new THREE.CylinderGeometry(.38, .38, 1, 8)
      : district === 1
        ? new THREE.OctahedronGeometry(.52, 0)
        : district === 2
          ? new THREE.BoxGeometry(1, 1, 1)
          : new THREE.CylinderGeometry(.44, .64, 1, 5);
    const facadeModules = new THREE.InstancedMesh(
      facadeGeometry,
      material(0x030910, color, 1, { roughness: .48, metalness: .7, emissiveIntensity: .2 }),
      12
    );
    instance = 0;
    for (const side of [-1, 1]) for (const offset of [-.28, 0, .28]) {
      marker.position.set(platform.w * offset, -platform.h / 2 - .12, side * (platform.d / 2 + .08));
      marker.rotation.set(district === 0 ? Math.PI / 2 : 0, 0, district === 1 ? Math.PI / 4 : 0);
      marker.scale.set(district === 2 ? 1.8 : 1, district === 2 ? .58 : 1.22, district === 2 ? .18 : .62);
      marker.updateMatrix();
      facadeModules.setMatrixAt(instance++, marker.matrix);

      marker.position.set(side * (platform.w / 2 + .08), -platform.h / 2 - .12, platform.d * offset);
      marker.rotation.set(district === 0 ? 0 : Math.PI / 2, 0, district === 1 ? Math.PI / 4 : Math.PI / 2);
      marker.scale.set(district === 2 ? .18 : .62, district === 2 ? .58 : 1.22, district === 2 ? 1.8 : 1);
      marker.updateMatrix();
      facadeModules.setMatrixAt(instance++, marker.matrix);
    }
    facadeModules.name = ["Cyan cooling drums", "Rose shield relays", "Amber ventilation banks", "Violet reactor canisters"][district];
    facadeModules.instanceMatrix.needsUpdate = true;
    facadeModules.computeBoundingSphere();
    platform.mesh.add(facadeModules);

    const supportLength = platform.baseY <= 18 ? platform.baseY : Math.min(10, 4 + platform.baseY * .11);
    const supports = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(.34, .82, 1, 4),
      material(0x050a11, color, 1, { roughness: .74, metalness: .36, emissiveIntensity: .045 }),
      4
    );
    instance = 0;
    for (const xSide of [-1, 1]) for (const zSide of [-1, 1]) {
      marker.position.set(xSide * platform.w * .34, -platform.h / 2 - supportLength / 2, zSide * platform.d * .34);
      marker.rotation.set(0, Math.PI / 4, 0);
      marker.scale.set(1, supportLength, 1);
      marker.updateMatrix();
      supports.setMatrixAt(instance++, marker.matrix);
    }
    supports.name = platform.baseY <= 18 ? "Grounded platform pylons" : "Suspended platform braces";
    supports.instanceMatrix.needsUpdate = true;
    supports.computeBoundingSphere();
    platform.mesh.add(supports);
    this.cameraOccluders.push(ribs, modules, facadeModules, supports);

    if (platform.baseY > 18) return;
    const contact = new THREE.Group();
    contact.name = "Platform contact depth";
    contact.position.set(platform.x, .026, platform.z);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x010309, map: this.glowTexture, transparent: true, opacity: .44, depthWrite: false, toneMapped: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(platform.w * .78, platform.d * .78, 1);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, map: this.glowTexture, transparent: true, opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = .006;
    pool.scale.set(platform.w * .7, platform.d * .7, 1);
    const feet = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.05, 1.35, .16, 8),
      material(0x04080e, color, 1, { roughness: .78, metalness: .35, emissiveIntensity: .1 }),
      4
    );
    const footGlows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, map: this.glowTexture, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      4
    );
    instance = 0;
    for (const xSide of [-1, 1]) for (const zSide of [-1, 1]) {
      const x = xSide * platform.w * .34;
      const z = zSide * platform.d * .34;
      marker.position.set(x, .08, z);
      marker.rotation.set(0, Math.PI / 4, 0);
      marker.scale.setScalar(1);
      marker.updateMatrix();
      feet.setMatrixAt(instance, marker.matrix);
      marker.position.set(x, .015, z);
      marker.rotation.set(-Math.PI / 2, 0, 0);
      marker.scale.set(4.6, 4.6, 1);
      marker.updateMatrix();
      footGlows.setMatrixAt(instance, marker.matrix);
      instance++;
    }
    feet.name = "Pylon contact feet";
    footGlows.name = "Pylon contact pools";
    feet.instanceMatrix.needsUpdate = footGlows.instanceMatrix.needsUpdate = true;
    feet.computeBoundingSphere();
    footGlows.computeBoundingSphere();
    contact.add(shadow, pool, feet, footGlows);
    this.group.add(contact);
  }

  addTraversalConduits(platform, color) {
    const alongX = platform.w >= platform.d;
    const length = Math.max(platform.w, platform.d) - 1.4;
    const crossOffset = Math.min(platform.w, platform.d) * .26;
    const cables = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(.075, .075, 1, 6),
      material(0x061019, color, 1, { roughness: .44, metalness: .62, emissiveIntensity: .28 }),
      3
    );
    const marker = new THREE.Object3D();
    [-1, 0, 1].forEach((offset, index) => {
      marker.position.set(alongX ? 0 : offset * crossOffset, -platform.h / 2 - .34 - Math.abs(offset) * .11, alongX ? offset * crossOffset : 0);
      marker.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      marker.scale.set(1, length, 1);
      marker.updateMatrix();
      cables.setMatrixAt(index, marker.matrix);
    });
    cables.name = "Traversal-linked power conduits";
    cables.instanceMatrix.needsUpdate = true;
    cables.computeBoundingSphere();

    const brackets = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      material(0x050b12, color, 1, { roughness: .72, metalness: .38, emissiveIntensity: .055 }),
      5
    );
    [-.42, -.21, 0, .21, .42].forEach((offset, index) => {
      marker.position.set(alongX ? offset * length : 0, -platform.h / 2 - .38, alongX ? 0 : offset * length);
      marker.rotation.set(0, 0, 0);
      marker.scale.set(alongX ? .34 : Math.max(2.2, platform.w - .8), .64, alongX ? Math.max(2.2, platform.d - .8) : .34);
      marker.updateMatrix();
      brackets.setMatrixAt(index, marker.matrix);
    });
    brackets.name = "Route cable brackets";
    brackets.instanceMatrix.needsUpdate = true;
    brackets.computeBoundingSphere();
    platform.mesh.add(cables, brackets);
  }

  decorateBreakable(mesh, x, z) {
    const district = this.districtIndexAt(x, z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 32), this.lineMaterials[district]);
    edges.name = "Destructible silhouette";
    edges.renderOrder = 2;
    mesh.add(edges);

    const { width, height, depth } = mesh.geometry.parameters;
    const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.routeMaterials[district], 4);
    const marker = new THREE.Object3D();
    for (let index = 0; index < 4; index++) {
      const offset = (index - 1.5) / 4;
      if (district === 0) {
        marker.position.set(offset * width, 0, depth / 2 + .018);
        marker.rotation.set(0, 0, 0);
        marker.scale.set(.075, height * .68, .025);
      } else if (district === 1) {
        marker.position.set(offset * width, 0, depth / 2 + .018);
        marker.rotation.set(0, 0, index % 2 ? -.58 : .58);
        marker.scale.set(.095, Math.min(height * .78, width * .48), .025);
      } else if (district === 2) {
        marker.position.set(0, offset * height, depth / 2 + .018);
        marker.rotation.set(0, 0, 0);
        marker.scale.set(width * .68, .07, .025);
      } else {
        marker.position.set(0, 0, depth / 2 + .018 + index * .001);
        marker.rotation.set(0, 0, index % 2 ? Math.PI / 4 : -Math.PI / 4);
        marker.scale.set(.08, Math.min(width, height) * (.54 + index * .06), .025);
      }
      marker.updateMatrix();
      slats.setMatrixAt(index, marker.matrix);
    }
    slats.name = ["Capacitor cover ribs", "Shield-crate diagonals", "Vent cover louvers", "Reactor cover lattice"][district];
    slats.instanceMatrix.needsUpdate = true;
    slats.computeBoundingSphere();
    mesh.name = ["Cyan capacitor cover", "Rose shield cover", "Amber vent machinery", "Violet reactor cover"][district];
    mesh.add(slats);
  }

  addBox(x, z, w, d, h, color, destructible = false, anchor = false, baseY = 0) {
    const mesh = box(w, h, d, color, x, baseY + h / 2, z);
    mesh.material.map = this.panelTexture;
    mesh.material.normalMap = this.panelNormal;
    mesh.material.normalScale.set(.42, .42);
    mesh.material.roughnessMap = this.panelRoughness;
    mesh.material.roughness = destructible ? .48 : .66;
    mesh.material.metalness = destructible ? .38 : .31;
    if (destructible) {
      const source = new THREE.Color(color);
      mesh.material.color.lerp(new THREE.Color(this.theme.ground), .58);
      mesh.material.emissive.copy(source);
      mesh.material.emissiveIntensity = .075;
      this.decorateBreakable(mesh, x, z);
    } else {
      mesh.material.color.lerp(new THREE.Color(this.districtColorAt(x, z)), .12);
      if (anchor) this.decorateBreakable(mesh, x, z);
    }
    mesh.material.needsUpdate = true;
    this.group.add(mesh);
    const obstacle = { x, z, w, d, h, baseY, top: baseY + h, mesh, destructible };
    this.obstacles.push(obstacle);
    if (destructible) this.destructibles.push(obstacle);
    if (anchor) this.addAnchor(x, baseY + h + .55, z);
    return obstacle;
  }

  addPlatform(x, top, z, w, d, thickness, color) {
    const platform = this.addBox(x, z, w, d, thickness, color, false, false, top - thickness);
    this.platforms.push(platform);
    this.decoratePlatform(platform);
    return platform;
  }

  addAnchor(x, y, z) {
    const point = new THREE.Vector3(x, y, z);
    const color = this.districtColorAt(x, z);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(.55, 18, 12),
      material(0x102533, color, 1, { roughness: .24, metalness: .35, emissiveIntensity: 1.25 })
    );
    orb.position.copy(point);
    const cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(.92, 1),
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: .42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    const halo = this.glowSprite(color, 3.6, .23);
    orb.add(cage, halo);
    this.group.add(orb);
    this.anchors.push({ point, mesh: orb });
    this.rotors.push({ object: cage, x: .42, y: .68, z: .25 });
    this.pulsers.push({ object: halo, base: 3.6, amplitude: .12, speed: 3.1, phase: x * .03 + z * .02 });
  }

  addBoostPad(x, y, z, strength) {
    const color = this.districtColorAt(x, z);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, .22, 28),
      material(0x102030, color, .96, { roughness: .38, metalness: .55, emissiveIntensity: .65 })
    );
    mesh.position.set(x, y + .12, z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.12, .12, 7, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .38, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .13;
    const arrows = new THREE.Mesh(routeMarkingGeometry(3.7, 3.7), this.routeMaterials[this.districtIndexAt(x, z)]);
    arrows.position.y = .125;
    const liftColumn = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 2.15, 3.4, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: .055,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    liftColumn.position.y = 1.55;
    mesh.add(ring, arrows, liftColumn);
    this.group.add(mesh);
    this.boostPads.push({ position: new THREE.Vector3(x, y, z), radius: 2.5, strength, mesh });
    this.pulsers.push({ object: ring, base: 1, amplitude: .055, speed: 3.8, phase: x + z });
  }

  addMovingPlatform(x, top, z, w, d, axis, travel, speed, phase) {
    const obstacle = this.addPlatform(x, top, z, w, d, 1, this.theme.grid);
    const color = this.districtColorAt(x, z);
    obstacle.mesh.material.emissive.setHex(color);
    obstacle.mesh.material.emissiveIntensity = .32;
    const underglow = new THREE.Mesh(
      new THREE.BoxGeometry(w * .72, .055, d * .72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .34, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    underglow.position.y = -.52;
    obstacle.mesh.add(underglow);
    this.movers.push({ obstacle, baseX: x, baseTop: top, axis, travel, speed, phase });
  }

  addPortalPair(a, b) {
    const pairColor = this.districtColors[(this.portals.length / 2) % this.districtColors.length];
    const pair = [a, b].map((position) => {
      const root = new THREE.Group();
      root.position.copy(position);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.35, .25, 10, 36),
        material(0x0b1c29, pairColor, .95, { roughness: .28, metalness: .48, emissiveIntensity: .62 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = .22;
      const inner = new THREE.Mesh(
        new THREE.TorusGeometry(1.75, .065, 6, 36),
        new THREE.MeshBasicMaterial({ color: pairColor, transparent: true, opacity: .42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      );
      inner.rotation.x = Math.PI / 2;
      inner.position.y = .235;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(2.12, 40),
        new THREE.MeshBasicMaterial({ color: pairColor, transparent: true, opacity: .07, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = .19;
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(1.45, 2.05, 4.2, 28, 1, true),
        new THREE.MeshBasicMaterial({ color: pairColor, transparent: true, opacity: .045, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      );
      column.position.y = 2.05;
      const chassis = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        material(0x02070d, pairColor, 1, { roughness: .46, metalness: .78, emissiveIntensity: .13 }),
        8
      );
      const chassisMarker = new THREE.Object3D();
      for (let index = 0; index < 8; index++) {
        const angle = index / 8 * TAU;
        chassisMarker.position.set(Math.cos(angle) * 2.55, .2, Math.sin(angle) * 2.55);
        chassisMarker.rotation.set(0, -angle, 0);
        chassisMarker.scale.set(1.45, .38, .56);
        chassisMarker.updateMatrix();
        chassis.setMatrixAt(index, chassisMarker.matrix);
      }
      chassis.name = "Octagonal portal chassis";
      chassis.instanceMatrix.needsUpdate = true;
      chassis.computeBoundingSphere();

      const pylons = new THREE.InstancedMesh(
        new THREE.ConeGeometry(.42, 2.8, 4),
        material(0x030911, pairColor, 1, { roughness: .4, metalness: .7, emissiveIntensity: .28 }),
        4
      );
      [[-2.65, -2.65], [2.65, -2.65], [2.65, 2.65], [-2.65, 2.65]].forEach(([x, z], index) => {
        chassisMarker.position.set(x, 1.28, z);
        chassisMarker.rotation.set(Math.PI, index * Math.PI / 2 + Math.PI / 4, 0);
        chassisMarker.scale.set(index % 2 ? .82 : 1, 1, index % 2 ? 1 : .82);
        chassisMarker.updateMatrix();
        pylons.setMatrixAt(index, chassisMarker.matrix);
      });
      pylons.name = "Portal navigation pylons";
      pylons.instanceMatrix.needsUpdate = true;
      pylons.computeBoundingSphere();
      root.add(chassis, pylons, ring, inner, disc, column);
      this.group.add(root);
      const portal = { position: position.clone(), ring, inner, disc, column, pair: null };
      this.portals.push(portal);
      return portal;
    });
    pair[0].pair = pair[1];
    pair[1].pair = pair[0];
  }

  addSweeper(x, y, z, length, speed) {
    const group = new THREE.Group();
    group.position.set(x, y + 1, z);
    const arm = box(length, .36, .72, 0x28121c, 0, 0, 0, this.theme.danger);
    arm.material.emissiveIntensity = .9;
    const district = this.districtIndexAt(x, z);
    const markings = new THREE.Mesh(routeMarkingGeometry(length - .3, .64), this.routeMaterials[district]);
    markings.position.y = .19;
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(.8, .8, 1.1, 18),
      material(0x142437, this.theme.accent, 1, { roughness: .26, metalness: .68, emissiveIntensity: 1.2 })
    );
    const warningRing = new THREE.Mesh(
      new THREE.RingGeometry(length * .18, length * .22, 40),
      new THREE.MeshBasicMaterial({ color: this.theme.danger, transparent: true, opacity: .24, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    warningRing.rotation.x = -Math.PI / 2;
    warningRing.position.y = -1;
    group.add(warningRing, arm, markings, hub);
    this.group.add(group);
    this.sweepers.push({ group, position: new THREE.Vector3(x, y, z), length, speed });
    this.pulsers.push({ object: warningRing, base: 1, amplitude: .06, speed: 2.7, phase: x * .1 });
  }

  addTemporaryWall(position, direction, wallColor, lifetime = 10) {
    const alongX = Math.abs(direction.x) > Math.abs(direction.z);
    const baseY = this.surfaceHeightAt(position, position.y + 1);
    const obstacle = this.addBox(
      THREE.MathUtils.clamp(position.x, -this.size + 2, this.size - 2),
      THREE.MathUtils.clamp(position.z, -this.size + 2, this.size - 2),
      alongX ? 1.1 : 8,
      alongX ? 8 : 1.1,
      5.5,
      wallColor,
      false,
      false,
      baseY
    );
    obstacle.mesh.material.dispose();
    const wallUv = uv().mul(vec2(alongX ? 2.4 : 12, 8));
    const cell = abs(fract(wallUv).sub(.5));
    const grid = smoothstep(.42, .49, max(cell.x, cell.y));
    const scan = sin(time.mul(3.2).sub(uv().y.mul(34))).mul(.5).add(.5);
    const fade = uniform(1);
    const fieldMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    fieldMaterial.colorNode = mix(color(0x06111b), color(wallColor), grid.mul(.72).add(scan.mul(.18)));
    fieldMaterial.opacityNode = grid.mul(.48).add(.16).mul(fade);
    obstacle.mesh.material = fieldMaterial;
    this.temporaryWalls.push({ obstacle, life: lifetime, fade });
    return obstacle;
  }

  update(dt, players) {
    this.time += dt;
    for (const rotor of this.rotors) {
      rotor.object.rotation.x += dt * rotor.x;
      rotor.object.rotation.y += dt * rotor.y;
      rotor.object.rotation.z += dt * rotor.z;
    }
    for (const pulser of this.pulsers) {
      const scale = pulser.base * (1 + Math.sin(this.time * pulser.speed + pulser.phase) * pulser.amplitude);
      pulser.object.scale.setScalar(scale);
    }
    if (this.motes) this.motes.rotation.y += dt * .006;
    if (this.skylineLights) this.skylineLights.material.opacity = .2 + Math.sin(this.time * .42) * .035;
    for (let index = this.temporaryWalls.length - 1; index >= 0; index--) {
      const wall = this.temporaryWalls[index];
      wall.life -= dt;
      wall.fade.value = Math.min(1, wall.life * .5);
      if (wall.life > 0) continue;
      this.group.remove(wall.obstacle.mesh);
      this.obstacles.splice(this.obstacles.indexOf(wall.obstacle), 1);
      wall.obstacle.mesh.geometry.dispose();
      wall.obstacle.mesh.material.dispose();
      this.temporaryWalls.splice(index, 1);
    }
    for (const mover of this.movers) {
      const item = mover.obstacle;
      const oldX = item.x;
      const oldTop = item.top;
      const offset = Math.sin(this.time * mover.speed + mover.phase) * mover.travel;
      if (mover.axis === "x") item.x = mover.baseX + offset;
      else {
        item.top = mover.baseTop + offset;
        item.baseY = item.top - item.h;
      }
      const dx = item.x - oldX;
      const dy = item.top - oldTop;
      item.mesh.position.set(item.x, item.baseY + item.h / 2, item.z);
      for (const player of players) {
        if (!player.alive || !player.grounded || Math.abs(player.position.y - oldTop) > .4) continue;
        if (Math.abs(player.position.x - oldX) <= item.w / 2 && Math.abs(player.position.z - item.z) <= item.d / 2) {
          player.position.x += dx;
          player.position.y += dy;
        }
      }
    }

    for (const portal of this.portals) {
      portal.ring.rotation.z += dt * 1.8;
      portal.inner.rotation.z -= dt * 1.15;
      portal.ring.material.emissiveIntensity = .72 + Math.sin(this.time * 4) * .16;
      portal.disc.material.opacity = .085 + Math.sin(this.time * 3.4) * .025;
      portal.column.material.opacity = .055 + Math.sin(this.time * 2.6) * .018;
    }
    for (const player of players) {
      player.portalCooldown = Math.max(0, (player.portalCooldown || 0) - dt);
      player.sweeperCooldown = Math.max(0, (player.sweeperCooldown || 0) - dt);
      if (!player.alive || player.portalCooldown > 0) continue;
      const portal = this.portals.find((entry) =>
        Math.abs(player.position.y - entry.position.y) < 1.4 &&
        Math.hypot(player.position.x - entry.position.x, player.position.z - entry.position.z) < 2.15
      );
      if (!portal) continue;
      player.position.copy(portal.pair.position).setY(portal.pair.position.y + .35);
      player.velocity.y = Math.max(player.velocity.y, 5);
      player.portalCooldown = 1.2;
    }

    for (const sweeper of this.sweepers) {
      sweeper.group.rotation.y += dt * sweeper.speed;
      for (const player of players) {
        if (!player.alive || player.sweeperCooldown > 0 || Math.abs(player.position.y - sweeper.position.y) > 2.4) continue;
        const local = player.position.clone().sub(sweeper.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -sweeper.group.rotation.y);
        if (Math.abs(local.x) > sweeper.length / 2 || Math.abs(local.z) > 1) continue;
        const push = player.position.clone().sub(sweeper.position).setY(0);
        if (!push.lengthSq()) push.set(1, 0, 0);
        player.velocity.addScaledVector(push.normalize(), 18);
        player.velocity.y = Math.max(player.velocity.y, 8);
        player.sweeperCooldown = .8;
      }
    }
  }

  spawnPoints() {
    return [
      // Opening fighters occupy separate major platforms instead of stacking on the spire.
      new THREE.Vector3(10, 66, 0),
      new THREE.Vector3(-60, 15, -48),
      new THREE.Vector3(61, 15, 49),
      new THREE.Vector3(54, 31, 33),
      new THREE.Vector3(-53, 47, -27),
      new THREE.Vector3(50, 31, -22),
      new THREE.Vector3(-50, 47, 30),
      new THREE.Vector3(-14, 15, -14),
      new THREE.Vector3(88, 0, 88),
      new THREE.Vector3(-88, 0, 88),
      new THREE.Vector3(88, 0, -88),
      new THREE.Vector3(-88, 0, -88),
      new THREE.Vector3(88, 0, 0),
      new THREE.Vector3(-88, 0, 0),
      new THREE.Vector3(0, 0, 88),
      new THREE.Vector3(0, 0, -88)
    ];
  }

  surfaceHeightAt(position, ceiling = position.y + .5) {
    let height = 0;
    for (const item of this.obstacles) {
      const inside = Math.abs(position.x - item.x) <= item.w / 2 && Math.abs(position.z - item.z) <= item.d / 2;
      if (inside && item.top <= ceiling && item.top > height) height = item.top;
    }
    return height;
  }

  resolve(position, radius, previous = position) {
    const edge = this.size - radius - 1;
    position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
    position.z = THREE.MathUtils.clamp(position.z, -edge, edge);

    const floor = this.surfaceHeightAt(position, previous.y + .35);
    const grounded = position.y <= floor && previous.y >= floor - .35;
    let ceiling = false;
    let ledge = null;
    if (grounded) position.y = floor;

    for (const item of this.obstacles) {
      if (grounded && Math.abs(position.y - item.top) < .08) continue;
      const minX = item.x - item.w / 2 - radius;
      const maxX = item.x + item.w / 2 + radius;
      const minZ = item.z - item.d / 2 - radius;
      const maxZ = item.z + item.d / 2 + radius;
      const insideFootprint = position.x > minX && position.x < maxX && position.z > minZ && position.z < maxZ;
      if (insideFootprint && position.y > previous.y && previous.y + 2.25 <= item.baseY + .05 && position.y + 2.25 >= item.baseY) {
        position.y = item.baseY - 2.251;
        ceiling = true;
        continue;
      }
      const verticallyOverlaps = position.y < item.top - .08 && position.y + 2.25 > item.baseY + .08;
      if (!verticallyOverlaps || !insideFootprint) continue;
      const pushes = [
        [position.x - minX, "x", minX], [maxX - position.x, "x", maxX],
        [position.z - minZ, "z", minZ], [maxZ - position.z, "z", maxZ]
      ];
      pushes.sort((a, b) => a[0] - b[0]);
      position[pushes[0][1]] = pushes[0][2];
      const rise = item.top - position.y;
      if (rise > .15 && rise <= 3.25 && (!ledge || item.top < ledge.top)) {
        const inward = new THREE.Vector3(item.x - position.x, 0, item.z - position.z);
        if (inward.lengthSq()) ledge = { top: item.top, inward: inward.normalize() };
      }
    }
    return { grounded, ceiling, ledge, floor };
  }

  boostAt(position) {
    return this.boostPads.find((pad) =>
      Math.abs(position.y - pad.position.y) < .35 &&
      Math.hypot(position.x - pad.position.x, position.z - pad.position.z) < pad.radius
    );
  }

  projectileHit(position, radius = .2) {
    if (Math.abs(position.x) >= this.size || Math.abs(position.z) >= this.size || position.y <= 0 || position.y >= this.height + 18) return true;
    return this.obstacles.some((item) =>
      position.x + radius > item.x - item.w / 2 &&
      position.x - radius < item.x + item.w / 2 &&
      position.z + radius > item.z - item.d / 2 &&
      position.z - radius < item.z + item.d / 2 &&
      position.y + radius > item.baseY &&
      position.y - radius < item.top
    );
  }

  constrainCamera(origin, desired, clearance = .45) {
    const direction = desired.clone().sub(origin);
    const distance = direction.length();
    if (!distance) return desired.clone();
    const ray = new THREE.Ray(origin, direction.normalize());
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    let safeDistance = distance;
    for (const item of this.obstacles) {
      box.min.set(item.x - item.w / 2 - clearance, item.baseY - clearance, item.z - item.d / 2 - clearance);
      box.max.set(item.x + item.w / 2 + clearance, item.top + clearance, item.z + item.d / 2 + clearance);
      if (box.containsPoint(origin)) continue;
      if (ray.intersectBox(box, hit)) {
        const contactDistance = origin.distanceTo(hit);
        safeDistance = Math.min(safeDistance, contactDistance);
      }
    }
    this.cameraRaycaster.set(origin, direction);
    this.cameraRaycaster.near = .05;
    this.cameraRaycaster.far = safeDistance;
    const visualHit = this.cameraRaycaster.intersectObjects(this.cameraOccluders, false)[0];
    if (visualHit) safeDistance = Math.min(safeDistance, Math.max(.18, visualHit.distance - clearance));
    return origin.clone().addScaledVector(direction, safeDistance);
  }

  destroy(position, radius) {
    let removed = 0;
    for (const item of [...this.destructibles]) {
      const center = new THREE.Vector3(item.x, item.baseY + item.h / 2, item.z);
      if (center.distanceTo(position) > radius + Math.max(item.w, item.d, item.h) / 2) continue;
      this.group.remove(item.mesh);
      this.obstacles.splice(this.obstacles.indexOf(item), 1);
      this.destructibles.splice(this.destructibles.indexOf(item), 1);
      removed += 1;
    }
    return removed;
  }

  grapplePoint(origin, direction) {
    if (!direction.lengthSq()) return null;
    this.group.updateMatrixWorld(true);
    const surfaces = [
      this.ground,
      ...this.obstacles.map((item) => item.mesh),
      ...this.anchors.map((anchor) => anchor.mesh),
      ...this.boostPads.map((pad) => pad.mesh)
    ];
    const ray = new THREE.Raycaster(origin, direction.clone().normalize(), .05);
    return ray.intersectObjects(surfaces, false)[0]?.point.clone() ?? null;
  }

  ropeObstacle(origin, target) {
    const delta = target.clone().sub(origin);
    const length = delta.length();
    if (length < .1) return null;
    const ray = new THREE.Ray(origin, delta.multiplyScalar(1 / length));
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    let nearest = null;
    for (const item of this.obstacles) {
      box.min.set(item.x - item.w / 2, item.baseY, item.z - item.d / 2);
      box.max.set(item.x + item.w / 2, item.top, item.z + item.d / 2);
      if (box.containsPoint(origin) || !ray.intersectBox(box, hit)) continue;
      const distance = origin.distanceTo(hit);
      if (distance <= .04 || distance >= length - .04 || (nearest && distance >= nearest.distance)) continue;
      nearest = { item, hit: hit.clone(), distance };
    }
    return nearest;
  }

  ropeBlocked(origin, target) {
    return Boolean(this.ropeObstacle(origin, target));
  }

  effectBlocked(origin, target) {
    const delta = target.clone().sub(origin);
    const length = delta.length();
    if (length < .1) return false;
    const direction = delta.multiplyScalar(1 / length);
    const ray = new THREE.Ray(origin, direction);
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    const probe = origin.clone().addScaledVector(direction, .08);
    for (const item of this.obstacles) {
      box.min.set(item.x - item.w / 2, item.baseY, item.z - item.d / 2);
      box.max.set(item.x + item.w / 2, item.top, item.z + item.d / 2);
      const contact = ray.intersectBox(box, hit);
      if (!contact) continue;
      const distance = origin.distanceTo(contact);
      if (distance >= length - .05) continue;
      if (distance > .04 || box.containsPoint(probe)) return true;
    }
    return false;
  }

  ropeWrapPoint(origin, target) {
    const obstruction = this.ropeObstacle(origin, target);
    if (!obstruction) return null;
    const { item, hit } = obstruction;
    const clearance = .3;
    const xs = [item.x - item.w / 2 - clearance, item.x + item.w / 2 + clearance];
    const ys = [Math.max(.12, item.baseY - clearance), item.top + clearance];
    const zs = [item.z - item.d / 2 - clearance, item.z + item.d / 2 + clearance];
    const candidates = [];
    for (const x of xs) for (const y of ys) candidates.push(new THREE.Vector3(x, y, THREE.MathUtils.clamp(hit.z, zs[0], zs[1])));
    for (const x of xs) for (const z of zs) candidates.push(new THREE.Vector3(x, THREE.MathUtils.clamp(hit.y, ys[0], ys[1]), z));
    for (const y of ys) for (const z of zs) candidates.push(new THREE.Vector3(THREE.MathUtils.clamp(hit.x, xs[0], xs[1]), y, z));

    const blockedByItem = (a, b) => {
      const delta = b.clone().sub(a);
      const length = delta.length();
      if (length < .05) return false;
      const box = new THREE.Box3(
        new THREE.Vector3(item.x - item.w / 2, item.baseY, item.z - item.d / 2),
        new THREE.Vector3(item.x + item.w / 2, item.top, item.z + item.d / 2)
      );
      const contact = new THREE.Ray(a, delta.multiplyScalar(1 / length)).intersectBox(box, new THREE.Vector3());
      return Boolean(contact && a.distanceTo(contact) > .03 && a.distanceTo(contact) < length - .03);
    };
    return candidates
      .filter((point) => point.distanceTo(origin) > .2 && !blockedByItem(origin, point))
      .sort((a, b) => origin.distanceTo(a) + a.distanceTo(target) - origin.distanceTo(b) - b.distanceTo(target))[0] || null;
  }

  lineOfSight(a, b) {
    const start = a.clone();
    const end = b.clone();
    return !this.obstacles.some((item) => {
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y) + 2;
      if (item.top < minY || item.baseY > maxY) return false;
      return segmentCircle(
        start.clone().setY(0),
        end.clone().setY(0),
        new THREE.Vector3(item.x, 0, item.z),
        Math.hypot(item.w, item.d) / 2
      );
    });
  }

  dispose() {
    this.scene.background = this.previousBackground;
    this.scene.fog = this.previousFog;
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
    for (const texture of this.textures) texture.dispose();
  }
}
