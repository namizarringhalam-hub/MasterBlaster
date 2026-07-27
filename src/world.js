import * as THREE from "three";
import { seededRandom, seedFromText } from "./gameData.js";

function material(color, emissive = 0, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: .72,
    metalness: .15,
    emissive,
    emissiveIntensity: emissive ? .55 : 0,
    transparent: opacity < 1,
    opacity
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
    this.size = 112;
    this.height = 78;
    this.group = new THREE.Group();
    this.obstacles = [];
    this.destructibles = [];
    this.anchors = [];
    this.platforms = [];
    this.boostPads = [];
    scene.add(this.group);
    this.build();
  }

  build() {
    const random = seededRandom(seedFromText(this.seed));
    this.ground = box(this.size * 2, .5, this.size * 2, 0x102234, 0, -.28, 0);
    this.group.add(this.ground);

    const grid = new THREE.GridHelper(this.size * 2, 44, 0x1fd7ff, 0x244b67);
    grid.position.y = .01;
    grid.material.opacity = .3;
    grid.material.transparent = true;
    this.group.add(grid);

    for (const [x, z, w, d] of [
      [0, -this.size, this.size * 2, 1.2], [0, this.size, this.size * 2, 1.2],
      [-this.size, 0, 1.2, this.size * 2], [this.size, 0, 1.2, this.size * 2]
    ]) this.addBox(x, z, w, d, this.height, 0x263d53);

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

    for (const [x, z, h] of [
      [0, 0, 70], [-72, -66, 40], [72, 66, 54], [70, -62, 72], [-68, 66, 62],
      [42, -22, 45], [-42, 30, 59]
    ]) this.addBox(x, z, 7, 7, h, 0x1d344b, false, true);

    // Alternate ascent routes for players who miss a grapple.
    for (const pad of [
      [-18, 0, -18, 24], [18, 0, 18, 24], [-66, 0, 22, 29], [66, 0, -22, 29],
      [-52, 15, -48, 26], [53, 15, 49, 26], [42, 31, -22, 27], [-42, 47, 30, 28]
    ]) this.addBoostPad(...pad);

    for (let i = 0; i < 34; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 24 + random() * 74;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const w = 3 + random() * 5;
      const d = 3 + random() * 5;
      const h = 2.5 + random() * 5;
      this.addBox(x, z, w, d, h, i % 3 ? 0xd54f5f : 0xeaa53b, true);
    }

    const haze = new THREE.Mesh(
      new THREE.CylinderGeometry(this.size + 5, this.size + 5, this.height + 24, 64, 1, true),
      material(0x173149, 0, .16)
    );
    haze.material.side = THREE.BackSide;
    haze.position.y = (this.height + 24) / 2;
    this.group.add(haze);
  }

  addBox(x, z, w, d, h, color, destructible = false, anchor = false, baseY = 0) {
    const mesh = box(w, h, d, color, x, baseY + h / 2, z);
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
    return platform;
  }

  addAnchor(x, y, z) {
    const point = new THREE.Vector3(x, y, z);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(.55, 14, 10),
      material(0x67f4ff, 0x67f4ff)
    );
    orb.position.copy(point);
    this.group.add(orb);
    this.anchors.push({ point, mesh: orb });
  }

  addBoostPad(x, y, z, strength) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 2.5, .22, 28),
      material(0x0e89b8, 0x2be4ff, .9)
    );
    mesh.position.set(x, y + .12, z);
    this.group.add(mesh);
    this.boostPads.push({ position: new THREE.Vector3(x, y, z), radius: 2.5, strength, mesh });
  }

  spawnPoints() {
    return [
      new THREE.Vector3(-88, 0, -88),
      new THREE.Vector3(88, 0, 88),
      new THREE.Vector3(-52, 15, -48),
      new THREE.Vector3(54, 31, 33),
      new THREE.Vector3(-88, 0, 88),
      new THREE.Vector3(88, 0, -88),
      new THREE.Vector3(-14, 15, -14),
      new THREE.Vector3(14, 15, -14),
      new THREE.Vector3(-14, 15, 14),
      new THREE.Vector3(14, 15, 14),
      new THREE.Vector3(-10, 66, -10),
      new THREE.Vector3(10, 66, -10),
      new THREE.Vector3(-10, 66, 10),
      new THREE.Vector3(10, 66, 10),
      new THREE.Vector3(53, 15, 49),
      new THREE.Vector3(-52, 47, 20)
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
    if (grounded) position.y = floor;

    for (const item of this.obstacles) {
      if (grounded && Math.abs(position.y - item.top) < .08) continue;
      const verticallyOverlaps = position.y < item.top - .08 && position.y + 2.25 > item.baseY + .08;
      if (!verticallyOverlaps) continue;
      const cx = THREE.MathUtils.clamp(position.x, item.x - item.w / 2, item.x + item.w / 2);
      const cz = THREE.MathUtils.clamp(position.z, item.z - item.d / 2, item.z + item.d / 2);
      const dx = position.x - cx;
      const dz = position.z - cz;
      const distance = Math.hypot(dx, dz);
      if (distance > 0 && distance < radius) {
        position.x += dx / distance * (radius - distance);
        position.z += dz / distance * (radius - distance);
      }
    }
    return { grounded, floor };
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
      if (ray.intersectBox(box, hit)) safeDistance = Math.min(safeDistance, origin.distanceTo(hit));
    }
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
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  }
}
