import * as THREE from "three/webgpu";
import { materialOpacity, uv } from "three/tsl";
import { Fighter } from "../src/player.js";
import { seededRandom } from "../src/gameData.js";

// QA only: an actual paid Blaster shot against the existing east arena wall.
// Never synthesize an impact or replace collision, damage, or effect generation.
export async function withWallImpactReview(game, { oblique = false, turn = false, gameplay = false, grazing = false, surfaceContact = false, previousContact = false, ringDissipation = "off", sparkAspect = false, previousSparks = false, ringLayer = "both", nestedRing = false, outerProfile = "off", impactBurst = "off" } = {}, capture) {
  if (grazing && gameplay) throw Error("Choose grazing or gameplay camera, not both");
  if (!["off", "current", "trial", "integrated"].includes(ringDissipation)) throw Error("Unknown ring dissipation review");
  if (!["both", "outer", "inner"].includes(ringLayer)) throw Error("Unknown ring layer review");
  if (!["off", "control", "soft"].includes(outerProfile)) throw Error("Unknown outer profile review");
  if (!["off", "previous", "control", "trial"].includes(impactBurst)) throw Error("Unknown impact burst review");
  if (["control", "trial"].includes(impactBurst) && (ringDissipation !== "integrated" || surfaceContact || previousContact || sparkAspect || previousSparks || ringLayer !== "both" || nestedRing || outerProfile !== "off"))
    throw Error("Impact burst review requires published contact, fade, sparks and both ring layers");
  if (sparkAspect && previousSparks) throw Error("Choose either reference or previous sparks, not both");
  const visuals = game.combatVisuals, pools = [visuals.flashes, visuals.tracers, visuals.rings, visuals.sparks, visuals.bloodDecals];
  if (!game.paused || game.players[0]?.weapon.id !== "blaster" || game.projectiles.length || game.hazards.length || game.decoys.length || game.effects.length ||
      pools.some(pool => pool.some(slot => slot.life > 0)) || visuals.combatLights.some(light => light.userData.life > 0 || light.intensity > 1e-10))
    throw Error("Wall impact review requires a paused, transient-free Blaster scene");
  const original = game.players[0], visible = original.group.visible, updateCamera = game.updateCamera;
  const ringSources = [visuals.ringOuter, visuals.ringInner], ringVisibility = ringSources.map(layer => layer.visible);
  const burstLayers = [], burstMaterials = [];
  let burstGeometry;
  const saved = { random: visuals.random, cursors: { ...visuals.cursors }, lightCursor: visuals.combatLightCursor,
    outerMaterial: visuals.ringOuter.material, impact: visuals.impact, updateRings: visuals.updateRings, updateSparks: visuals.updateSparks, effectTime: visuals.effectTime, music: game.combatMusicPulse, cameraPosition: game.camera.position.clone(),
    cameraQuaternion: game.camera.quaternion.clone(), fov: game.camera.fov,
    yaw: game.cameraYaw, pitch: game.cameraPitch, firstPerson: game.cameraFirstPerson, requested: game.cameraFirstPersonRequested,
    clearance: { ...game.cameraClearance }, scratch: Object.fromEntries(Object.entries(game.cameraScratch || {}).map(([key, v]) => [key, v.clone()])) };
  const wallX = game.world.size - .6, direction = new THREE.Vector3(1, 0, oblique ? 1 : 0).normalize();
  const position = new THREE.Vector3(wallX - 12, 6.8, oblique ? -12 : 0);
  const hero = new Fighter(game.scene, { id: original.id, name: original.name, color: original.color, accent: original.accent }, ["blaster"], position);
  let shot, impact = null, ringIndex = -1, profileMaterial;
  const sparkIndices = [];
  try {
    if (["control", "trial"].includes(impactBurst)) {
      if (impactBurst === "trial") burstGeometry = new THREE.PlaneGeometry(2, 2);
      for (const [index, source] of ringSources.entries()) {
        const proxy = source.clone(false); burstLayers.push(proxy);
        proxy.name = `wall-impact-burst-${index}`;
        if (burstGeometry) {
          const material = new THREE.MeshBasicNodeMaterial().copy(source.material); burstMaterials.push(material);
          const radius = uv().sub(.5).mul(2).length();
          const profile = index === 0 ? radius.smoothstep(.5, .78).mul(radius.smoothstep(.78, 1).oneMinus()) : radius.smoothstep(0, 1).oneMinus().pow(2);
          material.opacityNode = materialOpacity.mul(profile);
          proxy.geometry = burstGeometry; proxy.material = material;
        }
        source.parent.add(proxy); source.visible = false;
      }
    }
    if (outerProfile !== "off") {
      // QA only: the transient-free guard and single real impact isolate this
      // layer to one ring. Product-wide per-instance styling is NOT implemented.
      profileMaterial = new THREE.MeshBasicNodeMaterial().copy(saved.outerMaterial);
      profileMaterial.opacityNode = materialOpacity.mul(outerProfile === "control" ? 1 : uv().y.mul(Math.PI * 2).sin().abs());
      visuals.ringOuter.material = profileMaterial;
    }
    if (sparkAspect) {
      const matrix = new THREE.Matrix4(), aspect = new THREE.Vector3(2 ** (-1 / 3), 2 ** (2 / 3), 2 ** (-1 / 3));
      visuals.updateSparks = function(dt) {
        saved.updateSparks.call(this, dt);
        for (const index of sparkIndices) {
          if (this.sparks[index].life <= 0) continue;
          // Production first rebuilds the velocity-aligned matrix every frame:
          // a non-cumulative, equal-volume 2:1 shape, never a trajectory change.
          this.sparkLayer.getMatrixAt(index, matrix);
          this.sparkLayer.setMatrixAt(index, matrix.scale(aspect));
          this.sparkLayer.instanceMatrix.needsUpdate = true;
        }
      };
    }
    if (ringDissipation === "trial" || ringLayer !== "both" || nestedRing) {
      const color = new THREE.Color(), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
      const outerBasis = new THREE.Matrix4(), innerBasis = new THREE.Matrix4();
      visuals.updateRings = function(dt) {
        saved.updateRings.call(this, dt);
        const ring = this.rings[ringIndex];
        if (!ring || ring.life <= 0) return;
        if (ringDissipation === "trial") {
          const fade = 1 - THREE.MathUtils.smoothstep(1 - ring.life / ring.maxLife, .2, 1);
          for (const layer of [this.ringOuter, this.ringInner]) {
            layer.getColorAt(ringIndex, color); layer.setColorAt(ringIndex, color.multiplyScalar(fade));
            layer.instanceColor.needsUpdate = true;
          }
        }
        if (nestedRing) {
          this.ringOuter.getMatrixAt(ringIndex, outerBasis); this.ringInner.getMatrixAt(ringIndex, innerBasis);
          // Reuse the real outer XY basis; keep the inner Z and contact position.
          for (const n of [0, 1, 2, 4, 5, 6]) innerBasis.elements[n] = outerBasis.elements[n] * .7;
          this.ringInner.setMatrixAt(ringIndex, innerBasis); this.ringInner.instanceMatrix.needsUpdate = true;
        }
        if (ringLayer !== "both") {
          const masked = ringLayer === "outer" ? this.ringInner : this.ringOuter;
          masked.setMatrixAt(ringIndex, hidden); masked.instanceMatrix.needsUpdate = true;
        }
      };
    }
    if (burstLayers.length) {
      const matrix = new THREE.Matrix4(), color = new THREE.Color(), scale = new THREE.Vector3();
      const orientation = new THREE.Quaternion(), forward = new THREE.Vector3(0, 0, 1);
      visuals.updateRings = function(dt) {
        saved.updateRings.call(this, dt);
        const ring = this.rings[ringIndex];
        let radius = 0;
        if (ring?.life > 0 && impactBurst === "trial") {
          this.ringOuter.getMatrixAt(ringIndex, matrix);
          radius = Math.hypot(...matrix.elements.slice(0, 3)) * 1.052;
          orientation.setFromUnitVectors(forward, ring.normal);
        }
        for (const [index, proxy] of burstLayers.entries()) {
          const source = ringSources[index]; proxy.count = source.count;
          if (ringIndex < 0) continue;
          source.getMatrixAt(ringIndex, matrix); source.getColorAt(ringIndex, color);
          if (ring?.life > 0 && impactBurst === "trial") {
            const extent = index === 0 ? radius : Math.min(radius, ring.size * .28);
            matrix.compose(ring.position, orientation, scale.set(extent, extent, 1));
          }
          proxy.setMatrixAt(ringIndex, matrix); proxy.setColorAt(ringIndex, color);
          proxy.instanceMatrix.needsUpdate = true; proxy.instanceColor.needsUpdate = true;
        }
      };
    }
    original.group.visible = false; game.players[0] = hero; game.updateCamera = () => {};
    hero.aim.copy(direction); hero.group.position.copy(position); hero.group.rotation.y = Math.atan2(direction.x, direction.z);
    // A static firing stance: only the production projectile/effect simulation is stepped.
    const clock = Object.getOwnPropertyDescriptor(performance, "now");
    try {
      Object.defineProperty(performance, "now", { configurable: true, value: () => 1000 });
      hero.update(0, new THREE.Vector3(), direction, {}, game.world);
    } finally {
      if (clock) Object.defineProperty(performance, "now", clock); else delete performance.now;
    }
    hero.group.updateMatrixWorld(true);
    if (game.world.projectileHit(hero.forwardPoint(.08), .11)) throw Error("Wall review shot begins in an obstacle");
    visuals.random = seededRandom(0x67167);
    visuals.impact = function(point, weapon, owner, options) {
      if (impact || owner !== hero || weapon.id !== "blaster" || !shot || !game.world.projectileHit(shot.mesh.position, shot.radius))
        throw Error("Wall review requires exactly one genuine Blaster world collision");
      let emissionPoint = point, emissionOptions = options;
      if (surfaceContact) {
        // QA reference for this known east wall only, NOT production collision
        // geometry. Intersect the real final movement segment with its inner face.
        const t = (wallX - shot.previousPosition.x) / (shot.mesh.position.x - shot.previousPosition.x);
        if (!(t >= 0 && t <= 1)) throw Error("Contact trial requires the final segment to cross the wall face");
        const normal = new THREE.Vector3(-1, 0, 0);
        emissionPoint = shot.previousPosition.clone().lerp(shot.mesh.position, t).addScaledVector(normal, .012);
        emissionOptions = { ...options, normal };
      } else if (previousContact) {
        emissionPoint = shot.mesh.position; emissionOptions = { ...options, normal: null };
      }
      impact = { position: shot.mesh.position.toArray(), incomingPosition: point.toArray(), previous: shot.previousPosition.toArray(), velocity: shot.velocity.toArray(),
        firedDirection: shot.firedDirection.toArray(), ownerAim: owner.aim.toArray(), suppliedNormal: options?.normal?.toArray() ?? null,
        emissionPosition: emissionPoint.toArray(), emissionNormal: emissionOptions?.normal?.toArray() ?? null,
        radius: shot.radius, projectileAge: shot.age, wallX, geometricNormal: [-1, 0, 0] };
      const sparkStart = this.cursors.spark;
      const result = saved.impact.call(this, emissionPoint, weapon, owner, emissionOptions);
      for (let cursor = Math.max(sparkStart, this.cursors.spark - this.sparks.length); cursor < this.cursors.spark; cursor++)
        sparkIndices.push(cursor % this.sparks.length);
      // Historical control and reference trial must not apply product shape twice.
      if (previousSparks || sparkAspect) for (const index of sparkIndices) this.sparks[index].directional = false;
      ringIndex = (this.cursors.ring - 1) % this.rings.length;
      // Archived ring experiments keep the old torus path. The default renders
      // the actual integrated layers, with no reference multiplier or proxy.
      if (impactBurst !== "off" || surfaceContact || previousContact || sparkAspect || previousSparks ||
          ["current", "trial"].includes(ringDissipation) || ringLayer !== "both" || nestedRing || outerProfile !== "off")
        this.rings[ringIndex].surfaceBurst = false;
      // Archived control/trial remain pre-integration comparisons, never a
      // second multiplier on top of the integrated product fade.
      if (ringDissipation === "current" || ringDissipation === "trial") this.rings[ringIndex].dissipate = false;
      return result;
    };
    // Match spread/visual random choices across the post-shot-aim diagnostic.
    // Restore the global RNG synchronously, before any await/render can run.
    const random = Math.random;
    try { Math.random = seededRandom(0x67167); game.tryFire(hero, true, false); }
    finally { Math.random = random; }
    if (game.projectiles.length !== 1 || hero.ammo.blaster !== hero.weapon.ammo - 1) throw Error("Wall review requires one paid projectile");
    shot = game.projectiles[0];
    const initial = { position: shot.mesh.position.toArray(), velocity: shot.velocity.toArray(), ownerAim: hero.aim.toArray() };
    if (turn) hero.aim.set(0, 0, -1); // No second shot, trajectory or pose change.
    let flightFrames = 0;
    for (; flightFrames < 90 && !impact; flightFrames++) {
      game.updateProjectiles(1 / 60); game.updateEffects(1 / 60); visuals.update(1 / 60);
      if (!impact && !game.projectiles.length) throw Error("Projectile vanished without a wall impact");
    }
    if (!impact || game.projectiles.length || Math.abs(impact.position[0] - wallX) > .3)
      throw Error("Blaster did not reach the expected east wall within 90 steps");
    const contact = new THREE.Vector3().fromArray(grazing ? impact.emissionPosition : impact.position);
    if (gameplay) {
      game.cameraYaw = Math.atan2(direction.x, direction.z); game.cameraPitch = 0;
      game.cameraFirstPerson = false; game.cameraFirstPersonRequested = false;
      // Use the real camera including collision, shoulder offset, speed FOV and
      // rig visibility. Freeze only after its 240 settling updates.
      for (let i = 0; i < 240; i++) Object.getPrototypeOf(game).updateCamera.call(game, 1 / 60);
    } else {
      game.camera.position.copy(contact).add(grazing ? new THREE.Vector3(-.65, 1.1, 5.5) : new THREE.Vector3(-4.5, 2.3, 5.5)); game.camera.lookAt(contact);
      game.camera.fov = 62; game.camera.updateProjectionMatrix();
    }
    game.camera.updateMatrixWorld(true);
    const slotState = slot => ({ life: slot.life, maxLife: slot.maxLife, position: slot.position?.toArray(),
      normal: slot.normal?.toArray(), velocity: slot.velocity?.toArray(), size: slot.size, family: slot.family });
    const ringLayers = (layers = ringSources) => layers.map(layer => ({
      matrix: Array.from(layer.instanceMatrix.array.slice(ringIndex * 16, ringIndex * 16 + 16)),
      color: Array.from(layer.instanceColor.array.slice(ringIndex * 3, ringIndex * 3 + 3)) }));
    const state = frame => ({ frame, effectAge: (frame + 1) / 60, flightFrames, initial, impact, oblique, turn, gameplay, grazing, surfaceContact, previousContact, ringDissipation, sparkAspect, previousSparks, ringLayer, nestedRing, outerProfile, impactBurst,
      poseClockMs: 1000, cameraKind: gameplay ? "production-collision-aware-camera-settled-240" : grazing ? "fixed-surface-grazing" : "fixed-close-oblique",
      cameraState: { firstPerson: game.cameraFirstPerson, fov: game.camera.fov, clearance: { ...game.cameraClearance } },
      paidAmmo: hero.ammo.blaster, projectiles: game.projectiles.length,
      rings: visuals.rings.filter(s => s.life > 0).map(slotState), sparks: visuals.sparks.filter(s => s.life > 0).map(slotState),
      ringLayers: ringLayers(),
      displayRingLayers: ringLayers(burstLayers.length ? burstLayers : visuals.rings[ringIndex]?.surfaceBurst ? [visuals.surfaceFront, visuals.surfaceCore] : ringSources),
      sparkLayers: sparkIndices.filter(index => visuals.sparks[index].life > 0).map(index => ({ index,
        matrix: Array.from(visuals.sparkLayer.instanceMatrix.array.slice(index * 16, index * 16 + 16)),
        color: Array.from(visuals.sparkLayer.instanceColor.array.slice(index * 3, index * 3 + 3)) })),
      lights: visuals.combatLights.map(light => ({ position: light.position.toArray(), intensity: light.intensity, life: light.userData.life })),
      cameraMatrix: game.camera.matrixWorld.toArray(), projection: game.camera.projectionMatrix.toArray() });
    for (let frame = 0; frame <= 90; frame++) {
      if (frame) { game.updateEffects(1 / 60); visuals.update(1 / 60); }
      if ((ringDissipation === "off" ? [0, 1, 2, 4, 8, 16, 90] : [0, 1, 2, 4, 8, 16, 20, 22, 23, 24, 26, 90]).includes(frame)) await capture(state(frame));
    }
    // Production lights damp asymptotically; preserve their real decay instead
    // of demanding an exact floating-point zero or snapping them for the test.
    if (pools.some(pool => pool.some(slot => slot.life > 0)) || visuals.combatLights.some(light => light.userData.life > 0 || light.intensity > 1e-10))
      throw Error("Wall impact did not expire within 90 frames");
  } finally {
    for (const proxy of burstLayers) { proxy.removeFromParent(); proxy.dispose(); }
    for (const material of burstMaterials) material.dispose();
    burstGeometry?.dispose();
    ringSources.forEach((layer, index) => { layer.visible = ringVisibility[index]; });
    visuals.ringOuter.material = saved.outerMaterial; profileMaterial?.dispose();
    visuals.impact = saved.impact; visuals.updateRings = saved.updateRings; visuals.updateSparks = saved.updateSparks; visuals.random = saved.random;
    while (game.projectiles.some(projectile => projectile.owner === hero)) game.removeProjectile(game.projectiles.findIndex(projectile => projectile.owner === hero));
    for (const pool of pools) for (const slot of pool) slot.life = 0;
    for (const light of visuals.combatLights) { light.userData.life = 0; light.intensity = 0; }
    visuals.update(0); visuals.effectTime = saved.effectTime; Object.assign(visuals.cursors, saved.cursors); visuals.combatLightCursor = saved.lightCursor;
    game.combatMusicPulse = saved.music; hero.dispose(); game.players[0] = original; original.group.visible = visible;
    game.updateCamera = updateCamera; game.camera.position.copy(saved.cameraPosition); game.camera.quaternion.copy(saved.cameraQuaternion);
    game.camera.fov = saved.fov; game.camera.updateProjectionMatrix(); game.camera.updateMatrixWorld(true);
    game.cameraYaw = saved.yaw; game.cameraPitch = saved.pitch; game.cameraFirstPerson = saved.firstPerson; game.cameraFirstPersonRequested = saved.requested;
    Object.assign(game.cameraClearance, saved.clearance);
    for (const [key, value] of Object.entries(saved.scratch)) game.cameraScratch[key].copy(value);
  }
}
