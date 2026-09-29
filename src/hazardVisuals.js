import * as THREE from "three/webgpu";

function vortexRibbonGeometry(radius = 2.25, height = 3.8, turns = 3.4, segments = 76) {
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const angle = t * Math.PI * 2 * turns;
    const centreRadius = radius * (1 - t * .58) + Math.sin(t * Math.PI * 7) * .08;
    const halfWidth = .07 + (1 - t) * .05;
    for (const side of [-1, 1]) {
      const r = centreRadius + side * halfWidth;
      positions.push(Math.cos(angle) * r, t * height, Math.sin(angle) * r);
    }
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createHazardVisual(weapon) {
    const hazardRadius = weapon.hazard === "black_hole" ? 9 : weapon.hazard === "tornado" ? 7 : 6;
    const mesh = new THREE.Group();
    const ringOpacity = weapon.hazard === "tornado" ? .12 : weapon.hazard === "black_hole" ? .18 : .28;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(hazardRadius * .48, .22, 8, 34),
      new THREE.MeshBasicMaterial({ color: weapon.color, transparent: true, opacity: ringOpacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
    let instances = null;
    const fadeMaterials = [{ material: ring.material, baseOpacity: ringOpacity }];
    if (weapon.hazard === "napalm") {
      const count = 9;
      const flames = new THREE.InstancedMesh(
        new THREE.ConeGeometry(.42, 1.8, 7),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .46, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        count
      );
      const dummy = new THREE.Object3D();
      const bases = [];
      const phases = [];
      for (let index = 0; index < 9; index++) {
        const angle = index / 9 * Math.PI * 2;
        const base = new THREE.Vector3(Math.cos(angle) * hazardRadius * .42, .65 + index % 2 * .25, Math.sin(angle) * hazardRadius * .42);
        bases.push(base);
        phases.push(index * .73);
        dummy.position.copy(base);
        dummy.scale.set(.82 + index % 3 * .12, .78 + index % 2 * .24, .82 + index % 3 * .12);
        dummy.updateMatrix();
        flames.setMatrixAt(index, dummy.matrix);
        flames.setColorAt(index, new THREE.Color(index % 2 ? weapon.color : 0xffd061));
      }
      flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.add(flames);
      fadeMaterials.push({ material: flames.material, baseOpacity: .46 });
      instances = { kind: "flame", mesh: flames, dummy, bases, phases };
    } else if (weapon.hazard === "black_hole") {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 10), new THREE.MeshBasicMaterial({ color: 0x210337, transparent: true, opacity: .58, depthWrite: false, toneMapped: false }));
      const vertical = new THREE.Mesh(new THREE.TorusGeometry(2.1, .13, 7, 28), ring.material.clone());
      vertical.material.opacity = .24;
      vertical.rotation.y = Math.PI / 2;
      mesh.add(core, vertical);
      fadeMaterials.push({ material: core.material, baseOpacity: .58 }, { material: vertical.material, baseOpacity: .24 });
    } else {
      const vortexMaterial = ring.material.clone();
      vortexMaterial.opacity = .1;
      vortexMaterial.side = THREE.DoubleSide;
      vortexMaterial.blending = THREE.NormalBlending;
      const ribbon = new THREE.Mesh(vortexRibbonGeometry(), vortexMaterial);
      ribbon.position.y = .18;
      mesh.add(ribbon);
      fadeMaterials.push({ material: vortexMaterial, baseOpacity: .1 });
      instances = { kind: "ribbon", mesh: ribbon };
    }
    return { mesh, radius: hazardRadius, instances, fadeMaterials };
}
