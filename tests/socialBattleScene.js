// Opt-in filming controls: stage a readable duel, but keep production combat and camera mechanics.
import * as THREE from "three/webgpu";
import { WEAPONS } from "../src/gameData.js";

export function battleControls(seconds, opponent = false) {
  const phase = Math.max(0, seconds);
  return { fire: opponent ? phase % .72 < .16 : phase % .82 < .08,
    strafe: (opponent ? .17 : -.12) * Math.sin(phase * 1.8),
    grapple: opponent && phase >= .38 && phase < .96 };
}

export async function stageSocialBattle(game, { params, prepareFighterWeapons, productionCamera }) {
  const hero = game.players[0], actor = game.players[1], playerView = params.get("videoView") === "player";
  const take = params.get("videoTake") === "2" ? -1 : 1;
  const previous = { updateBot: game.updateBot, updateHuman: game.updateHuman, tryFire: game.tryFire,
    damagePlayer: game.damagePlayer, updateCamera: game.updateCamera };
  const participantFlags = game.players.map(p => [p, p.trainingStandStill, p.trainingDontAttack, p.trainingAnchor]);
  const obstacleAt = p => game.world.nearbyObstacles(p.x - 2, p.x + 2, p.z - 2, p.z + 2)
    .some(o => !o.removed && o.active !== false && o.top > p.y + .6 && o.baseY < p.y + 1.8
      && Math.abs(p.x - o.x) < o.w / 2 + 1.2 && Math.abs(p.z - o.z) < o.d / 2 + 1.2);
  const candidates = [[16, 9, 7, 18], [18, 12, 18, -2], [12, 18, -3, 18]];
  const starts = candidates.map(([ax, az, hx, hz]) => [new THREE.Vector3(take * ax, 15.01, az), new THREE.Vector3(take * hx, 15.01, hz)])
    .find(pair => pair.every(p => !obstacleAt(p) && game.world.surfaceHeightAt(p, 15.1) === 15)
      && !game.world.ropeBlocked(pair[0].clone().add(new THREE.Vector3(0, 1.3, 0)), pair[1].clone().add(new THREE.Vector3(0, 1.3, 0))));
  if (!starts) throw Error("No supported, unobstructed duel start found");
  actor.position.copy(starts[0]); hero.position.copy(starts[1]);
  const battleCenter = starts[0].clone().lerp(starts[1], .5).setY(0);
  const initialFocus = battleCenter.clone().setY(16.3);
  const showcaseOffset = [new THREE.Vector3(take * 24, 7, 4), new THREE.Vector3(take * 28, 9, 3), new THREE.Vector3(take * 26, 10, 7)]
    .find(offset => [hero, actor].every(p => !game.world.effectBlocked(initialFocus.clone().add(offset), p.position.clone().add(new THREE.Vector3(0, 1.3, 0)))));
  if (!playerView && !showcaseOffset) throw Error("Duel outside camera has no clear view of both fighters");
  for (const fighter of [hero, actor]) {
    fighter.velocity.set(0, 0, 0); fighter.grounded = true;
    fighter.trainingStandStill = false; fighter.trainingDontAttack = false; fighter.trainingAnchor = null;
    fighter.loadout = [fighter === actor ? "machine_gun" : "blaster", "rocket_launcher", "plasma_cannon", "grenade_launcher", "railgun"];
    fighter.slotIndex = 0; fighter.ammo = Object.fromEntries(fighter.loadout.map(id => [id, WEAPONS[id].ammo]));
    await prepareFighterWeapons(fighter);
  }
  // Keep inactive background opponents away from the staged pair, without hiding their graphics.
  const background = [];
  for (const z of [-18, -12, -6]) for (const x of [-24, -18, -12, -6, 6, 12, 18, 24]) {
    const position = new THREE.Vector3(x, 15.01, z);
    if (!obstacleAt(position) && game.world.surfaceHeightAt(position, 15.1) === 15
      && position.distanceTo(hero.position) > 8 && position.distanceTo(actor.position) > 8) background.push(position);
  }
  if (background.length < game.players.length - 2) throw Error("Not enough clear background starts for duel capture");
  for (const [index, bot] of game.players.slice(2).entries()) {
    bot.position.copy(background[index]); bot.velocity.set(0, 0, 0); bot.grounded = true;
    bot.trainingStandStill = true; bot.trainingDontAttack = true; bot.trainingAnchor = bot.position.clone();
  }
  const evidence = { scene: "readable-duel", composition: `oct30-duel-${take === 1 ? "east" : "west"}`,
    featuredBotId: actor.id, featuredWeapon: actor.weapon.id, opponentIds: [hero.id],
    perspective: playerView ? "production-player-camera" : "outside-duel-showcase",
    cameraSource: playerView ? "bound unmodified Game.updateCamera" : "staged midpoint camera",
    hudCaptured: false, disclosure: "Staged starts, loadouts and control timing; production fighter movement, grapple, shots, damage and camera; bot opponent",
    performanceStartMs: null, clockStartedAt: null, events: [], samples: [], concurrentShotCount: 0,
    wallStuckEvents: [], wallStuckDetection: "not-run; independent visual review required" };
  const elapsed = () => evidence.performanceStartMs === null ? 0 : (performance.now() - evidence.performanceStartMs) / 1000;
  const point = p => p.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  const projection = p => {
    const center = point(p), clip = center.clone().project(game.camera);
    return { id: p.id, alive: p.alive, health: p.health, position: p.position.toArray(), clip: clip.toArray(),
      visible: p.alive && clip.z > -1 && clip.z < 1 && Math.abs(clip.x) < .88 && Math.abs(clip.y) < .83
        && !game.world.effectBlocked(game.camera.position, center) };
  };
  const event = (kind, data = {}) => ({ kind, atMs: Math.round(elapsed() * 1000), ...data });
  game.tryFire = function (fighter, ...args) {
    const weapon = fighter.weapon, ammo = fighter.ammo[weapon.id];
    const result = previous.tryFire.call(this, fighter, ...args);
    if (evidence.performanceStartMs !== null && [hero, actor].includes(fighter) && fighter.ammo[weapon.id] < ammo) {
      const target = fighter === actor ? hero : actor, self = projection(fighter), enemy = projection(target);
      const shot = event("production-shot", { fighterId: fighter.id, targetId: target.id, weapon: weapon.id,
        ammoBefore: ammo, ammoAfter: fighter.ammo[weapon.id], attacker: self, target: enemy,
        aim: fighter.aim.toArray(), velocity: fighter.velocity.toArray(), grounded: fighter.grounded,
        grappleActive: Boolean(fighter.grapple), ropeVisible: Boolean(fighter.grapple?.line.visible), anchor: fighter.grapple?.anchor.toArray() || null });
      evidence.events.push(shot);
      if (fighter === actor && shot.grappleActive && shot.ropeVisible && !fighter.grounded && fighter.velocity.length() > 3 && self.visible && enemy.visible) evidence.concurrentShotCount++;
    }
    return result;
  };
  game.damagePlayer = function (target, damage, push, attacker, weapon, context = {}) {
    const health = target.health, alive = target.alive;
    const before = [hero, actor].map(projection);
    const result = previous.damagePlayer.call(this, target, damage, push, attacker, weapon, context);
    if (evidence.performanceStartMs !== null && [hero, actor].includes(target) && attacker && target.health !== health)
      evidence.events.push(event("production-damage", { attackerId: attacker.id, targetId: target.id, weapon: weapon?.id,
        healthBefore: health, healthAfter: target.health, aliveBefore: alive, aliveAfter: target.alive,
        hitPoint: context.point?.toArray() || null, shotId: context.shotId || null, fighters: before }));
    return result;
  };
  // A low real spire attachment gives a short combat swing rather than launching across the arena.
  const anchorAim = new THREE.Vector3(take * 2.5, 20, 0), move = new THREE.Vector3(), aim = new THREE.Vector3();
  let attached = false, released = false, lastSample = -1;
  function control(fighter, target, dt, opponent) {
    if (!fighter.alive) return;
    const seconds = elapsed(), controls = battleControls(seconds, opponent);
    aim.copy(point(target)).sub(point(fighter)).normalize();
    if (opponent && controls.grapple && !attached && evidence.performanceStartMs !== null) {
      fighter.aim.copy(anchorAim).sub(point(fighter)).normalize(); game.toggleGrapple(fighter);
      if (!fighter.grapple) throw Error("Duel grapple did not attach to a real world surface");
      attached = true; evidence.events.push(event("grapple-attached", { fighterId: fighter.id, anchor: fighter.grapple.anchor.toArray() }));
    }
    const separation = Math.hypot(target.position.x - fighter.position.x, target.position.z - fighter.position.z);
    move.copy(aim).setY(0).normalize().multiplyScalar(separation > 9 ? 1 : separation < 6 ? -1 : 0);
    // Fighter.update normalizes any nonzero movement to full running speed; pulse short strafes.
    if (seconds % 1.4 < .18) move.add(new THREE.Vector3(aim.z, 0, -aim.x).multiplyScalar(controls.strafe * 1.5));
    const fromCenter = fighter.position.clone().setY(0).sub(battleCenter);
    if (!fighter.grapple && fromCenter.length() > 9) move.copy(fromCenter).negate().normalize();
    fighter.update(dt, move, aim, { reducedMotion: game.settings.reducedMotion }, game.world);
    game.updateGrapple(fighter, dt);
    if (opponent && fighter.grapple && (!controls.grapple || obstacleAt(fighter.position))) {
      game.releaseGrapple(fighter, false); released = true; evidence.events.push(event("grapple-release", { fighterId: fighter.id }));
    }
    if (evidence.performanceStartMs !== null && target.alive && controls.fire) game.tryFire(fighter, true);
    if (fighter.ammo[fighter.weapon.id] <= 0) game.beginReload(fighter);
  }
  game.updateHuman = dt => control(hero, actor, dt, false);
  game.updateBot = function (bot, dt) {
    if (bot === actor) control(actor, hero, dt, true);
    else previous.updateBot.call(this, bot, dt);
  };
  game.updateCamera = function (dt = 1 / 60) {
    if (playerView) {
      aim.copy(point(actor)).sub(point(hero)).normalize();
      game.cameraYaw = Math.atan2(aim.x, aim.z); game.cameraPitch = Math.asin(aim.y);
      productionCamera(dt);
    } else {
      hero.rig.visible = actor.rig.visible = true;
      const middle = point(hero).lerp(point(actor), .5);
      const separation = point(hero).distanceTo(point(actor));
      const distanceScale = Math.max(1, separation / 16);
      game.camera.position.copy(middle).addScaledVector(showcaseOffset, distanceScale); game.camera.lookAt(middle);
      game.camera.fov = 62; game.camera.updateProjectionMatrix();
    }
    game.camera.updateMatrixWorld(true);
    const sample = Math.floor(elapsed() * 4);
    if (evidence.performanceStartMs !== null && sample !== lastSample) {
      lastSample = sample; evidence.samples.push(event("battle-frame", { fighters: [hero, actor].map(projection),
        camera: game.camera.position.toArray(), cameraQuaternion: game.camera.quaternion.toArray(),
        perspective: evidence.perspective, grappleAttached: Boolean(actor.grapple), grappleReleased: released }));
    }
  };
  return { evidence, restore() {
    Object.assign(game, previous);
    for (const [fighter, still, passive, anchor] of participantFlags) {
      fighter.trainingStandStill = still; fighter.trainingDontAttack = passive; fighter.trainingAnchor = anchor;
    }
  } };
}
