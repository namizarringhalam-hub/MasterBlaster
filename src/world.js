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
    this.size = 31;
    this.group = new THREE.Group();
    this.obstacles = [];
    this.destructibles = [];
    this.anchors = [];
    scene.add(this.group);
    this.build();
  }

  build() {
    const random = seededRandom(seedFromText(this.seed));
    const floor = box(this.size * 2, .35, this.size * 2, 0x16283a, 0, -.2, 0);
    this.group.add(floor);

    const grid = new THREE.GridHelper(this.size * 2, 24, 0x1fd7ff, 0x244b67);
    grid.position.y = .01;
    grid.material.opacity = .34;
    grid.material.transparent = true;
    this.group.add(grid);

    const wallColor = 0x334a62;
    for (const [x, z, w, d] of [
      [0, -this.size, this.size * 2, .7], [0, this.size, this.size * 2, .7],
      [-this.size, 0, .7, this.size * 2], [this.size, 0, .7, this.size * 2]
    ]) this.addBox(x, z, w, d, 4.5, wallColor, false);

    this.addBox(0, 0, 8, 8, 2.2, 0x263e55, false);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + Math.PI / 4;
      const x = Math.cos(angle) * 18;
      const z = Math.sin(angle) * 18;
      this.addBox(x, z, 3.2, 3.2, 8, 0x29445e, false, true);
    }

    for (let i = 0; i < 15; i++) {
      const angle = random() * Math.PI * 2;
      const distance = 9 + random() * 17;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const wide = 1.8 + random() * 2.8;
      const deep = 1.8 + random() * 2.8;
      const height = 1.4 + random() * 2.4;
      this.addBox(x, z, wide, deep, height, i % 3 ? 0xd54f5f : 0xeaa53b, true);
    }

    for (const [x, z] of [[0, -24], [0, 24], [-24, 0], [24, 0]]) {
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, .2, 28),
        material(0x0e89b8, 0x2be4ff, .86)
      );
      pad.position.set(x, .12, z);
      this.group.add(pad);
    }

    const haze = new THREE.Mesh(
      new THREE.CylinderGeometry(this.size + 3, this.size + 3, 13, 48, 1, true),
      material(0x1a3750, 0, .18)
    );
    haze.material.side = THREE.BackSide;
    haze.position.y = 6;
    this.group.add(haze);
  }

  addBox(x, z, w, d, h, color, destructible = false, anchor = false) {
    const mesh = box(w, h, d, color, x, h / 2, z);
    this.group.add(mesh);
    const obstacle = { x, z, w, d, h, mesh, destructible };
    this.obstacles.push(obstacle);
    if (destructible) this.destructibles.push(obstacle);
    if (anchor) {
      const point = new THREE.Vector3(x, h + .45, z);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(.34, 12, 9),
        material(0x67f4ff, 0x67f4ff)
      );
      orb.position.copy(point);
      this.group.add(orb);
      this.anchors.push({ point, mesh: orb });
    }
  }

  spawnPoints() {
    return [
      new THREE.Vector3(-23, 0, -23),
      new THREE.Vector3(23, 0, 23),
      new THREE.Vector3(23, 0, -23),
      new THREE.Vector3(-23, 0, 23)
    ];
  }

  resolve(position, radius) {
    const edge = this.size - radius - .8;
    position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
    position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
    for (const item of this.obstacles) {
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
  }

  projectileHit(position, radius = .2) {
    if (Math.abs(position.x) >= this.size || Math.abs(position.z) >= this.size || position.y <= 0) return true;
    return this.obstacles.some((item) =>
      position.x + radius > item.x - item.w / 2 &&
      position.x - radius < item.x + item.w / 2 &&
      position.z + radius > item.z - item.d / 2 &&
      position.z - radius < item.z + item.d / 2 &&
      position.y - radius < item.h
    );
  }

  destroy(position, radius) {
    const removed = [];
    for (const item of [...this.destructibles]) {
      const distance = Math.hypot(position.x - item.x, position.z - item.z);
      if (distance > radius + Math.max(item.w, item.d) / 2) continue;
      this.group.remove(item.mesh);
      this.obstacles.splice(this.obstacles.indexOf(item), 1);
      this.destructibles.splice(this.destructibles.indexOf(item), 1);
      removed.push(item);
    }
    return removed.length;
  }

  grapplePoint(origin, direction) {
    let best = null;
    let bestScore = -Infinity;
    for (const anchor of this.anchors) {
      const offset = anchor.point.clone().sub(origin);
      const distance = offset.length();
      const alignment = offset.normalize().dot(direction);
      const score = alignment * 2 - distance / 60;
      if (alignment > .48 && distance < 48 && score > bestScore) {
        best = anchor.point.clone();
        bestScore = score;
      }
    }
    if (best) return best;
    const fallback = origin.clone().addScaledVector(direction, 14);
    fallback.x = THREE.MathUtils.clamp(fallback.x, -this.size + 1, this.size - 1);
    fallback.z = THREE.MathUtils.clamp(fallback.z, -this.size + 1, this.size - 1);
    fallback.y = 4.2;
    return fallback;
  }

  lineOfSight(a, b) {
    const start = a.clone().setY(0);
    const end = b.clone().setY(0);
    return !this.obstacles.some((item) => {
      const center = new THREE.Vector3(item.x, 0, item.z);
      return segmentCircle(start, end, center, Math.hypot(item.w, item.d) / 2);
    });
  }

  nearestCover(from, against) {
    let best;
    let score = Infinity;
    for (const item of this.obstacles) {
      const center = new THREE.Vector3(item.x, 0, item.z);
      const point = center.clone().add(center.clone().sub(against).setY(0).normalize().multiplyScalar(Math.max(item.w, item.d) / 2 + 1.6));
      const distance = point.distanceToSquared(from);
      if (distance < score) {
        score = distance;
        best = point;
      }
    }
    return best;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    });
  }
}
