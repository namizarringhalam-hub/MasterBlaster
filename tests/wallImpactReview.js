import * as THREE from "three/webgpu";
import { Fighter } from "../src/player.js";
import { seededRandom } from "../src/gameData.js";

// QA only: an actual paid Blaster shot against the existing east arena wall.
// Never synthesize an impact or replace collision, damage, or effect generation.
export async function withWallImpactReview(game, { oblique = false, turn = false, gameplay = false, surfaceContact = false } = {}, capture) {
  const visuals = game.combatVisuals, pools = [visuals.flashes, visuals.tracers, visuals.rings, visuals.sparks, visuals.bloodDecals];
  if (!game.paused || game.players[0]?.weapon.id !== "blaster" || game.projectiles.length || game.hazards.length || game.decoys.length || game.effects.length ||
      pools.some(pool => pool.some(slot => slot.life > 0)) || visuals.combatLights.some(light => light.userData.life > 0 || light.intensity > 1e-10))
    throw Error("Wall impact review requires a paused, transient-free Blaster scene");
  const original = game.players[0], visible = original.group.visible, updateCamera = game.updateCamera;
  const saved = { random: visuals.random, cursors: { ...visuals.cursors }, lightCursor: visuals.combatLightCursor,
    impact: visuals.impact, music: game.combatMusicPulse, cameraPosition: game.camera.position.clone(),
    cameraQuaternion: game.camera.quaternion.clone(), fov: game.camera.fov,
    yaw: game.cameraYaw, pitch: game.cameraPitch, firstPerson: game.cameraFirstPerson, requested: game.cameraFirstPersonRequested,
    clearance: { ...game.cameraClearance }, scratch: Object.fromEntries(Object.entries(game.cameraScratch || {}).map(([key, v]) => [key, v.clone()])) };
  const wallX = game.world.size - .6, direction = new THREE.Vector3(1, 0, oblique ? 1 : 0).normalize();
  const position = new THREE.Vector3(wallX - 12, 6.8, oblique ? -12 : 0);
  const hero = new Fighter(game.scene, { id: original.id, name: original.name, color: original.color, accent: original.accent }, ["blaster"], position);
  let shot, impact = null;
  try {
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
      if (impact || owner !== hero || weapon.id !== "blaster" || !shot || !game.world.projectileHit(point, shot.radius))
        throw Error("Wall review requires exactly one genuine Blaster world collision");
      let emissionPoint = point, emissionOptions = options;
      if (surfaceContact) {
        // QA reference for this known east wall only, NOT production collision
        // geometry. Intersect the real final movement segment with its inner face.
        const t = (wallX - shot.previousPosition.x) / (point.x - shot.previousPosition.x);
        if (!(t >= 0 && t <= 1)) throw Error("Contact trial requires the final segment to cross the wall face");
        const normal = new THREE.Vector3(-1, 0, 0);
        emissionPoint = shot.previousPosition.clone().lerp(point, t).addScaledVector(normal, .012);
        emissionOptions = { ...options, normal };
      }
      impact = { position: point.toArray(), previous: shot.previousPosition.toArray(), velocity: shot.velocity.toArray(),
        firedDirection: shot.firedDirection.toArray(), ownerAim: owner.aim.toArray(), suppliedNormal: options?.normal?.toArray() ?? null,
        emissionPosition: emissionPoint.toArray(), emissionNormal: emissionOptions?.normal?.toArray() ?? null,
        radius: shot.radius, projectileAge: shot.age, wallX, geometricNormal: [-1, 0, 0] };
      return saved.impact.call(this, emissionPoint, weapon, owner, emissionOptions);
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
    const contact = new THREE.Vector3().fromArray(impact.position);
    if (gameplay) {
      game.cameraYaw = Math.atan2(direction.x, direction.z); game.cameraPitch = 0;
      game.cameraFirstPerson = false; game.cameraFirstPersonRequested = false;
      // Use the real camera including collision, shoulder offset, speed FOV and
      // rig visibility. Freeze only after its 240 settling updates.
      for (let i = 0; i < 240; i++) Object.getPrototypeOf(game).updateCamera.call(game, 1 / 60);
    } else {
      game.camera.position.copy(contact).add(new THREE.Vector3(-4.5, 2.3, 5.5)); game.camera.lookAt(contact);
      game.camera.fov = 62; game.camera.updateProjectionMatrix();
    }
    game.camera.updateMatrixWorld(true);
    const slotState = slot => ({ life: slot.life, maxLife: slot.maxLife, position: slot.position?.toArray(),
      normal: slot.normal?.toArray(), velocity: slot.velocity?.toArray(), size: slot.size, family: slot.family });
    const state = frame => ({ frame, effectAge: (frame + 1) / 60, flightFrames, initial, impact, oblique, turn, gameplay, surfaceContact,
      poseClockMs: 1000, cameraKind: gameplay ? "production-collision-aware-camera-settled-240" : "fixed-close-oblique",
      cameraState: { firstPerson: game.cameraFirstPerson, fov: game.camera.fov, clearance: { ...game.cameraClearance } },
      paidAmmo: hero.ammo.blaster, projectiles: game.projectiles.length,
      rings: visuals.rings.filter(s => s.life > 0).map(slotState), sparks: visuals.sparks.filter(s => s.life > 0).map(slotState),
      lights: visuals.combatLights.map(light => ({ position: light.position.toArray(), intensity: light.intensity, life: light.userData.life })),
      cameraMatrix: game.camera.matrixWorld.toArray(), projection: game.camera.projectionMatrix.toArray() });
    for (let frame = 0; frame <= 90; frame++) {
      if (frame) { game.updateEffects(1 / 60); visuals.update(1 / 60); }
      if ([0, 1, 2, 4, 8, 16, 90].includes(frame)) await capture(state(frame));
    }
    // Production lights damp asymptotically; preserve their real decay instead
    // of demanding an exact floating-point zero or snapping them for the test.
    if (pools.some(pool => pool.some(slot => slot.life > 0)) || visuals.combatLights.some(light => light.userData.life > 0 || light.intensity > 1e-10))
      throw Error("Wall impact did not expire within 90 frames");
  } finally {
    visuals.impact = saved.impact; visuals.random = saved.random;
    while (game.projectiles.some(projectile => projectile.owner === hero)) game.removeProjectile(game.projectiles.findIndex(projectile => projectile.owner === hero));
    for (const pool of pools) for (const slot of pool) slot.life = 0;
    for (const light of visuals.combatLights) { light.userData.life = 0; light.intensity = 0; }
    visuals.update(0); Object.assign(visuals.cursors, saved.cursors); visuals.combatLightCursor = saved.lightCursor;
    game.combatMusicPulse = saved.music; hero.dispose(); game.players[0] = original; original.group.visible = visible;
    game.updateCamera = updateCamera; game.camera.position.copy(saved.cameraPosition); game.camera.quaternion.copy(saved.cameraQuaternion);
    game.camera.fov = saved.fov; game.camera.updateProjectionMatrix(); game.camera.updateMatrixWorld(true);
    game.cameraYaw = saved.yaw; game.cameraPitch = saved.pitch; game.cameraFirstPerson = saved.firstPerson; game.cameraFirstPersonRequested = saved.requested;
    Object.assign(game.cameraClearance, saved.clearance);
    for (const [key, value] of Object.entries(saved.scratch)) game.cameraScratch[key].copy(value);
  }
}
