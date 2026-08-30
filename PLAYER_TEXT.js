/*
 * MASTER BLASTER — EDITABLE PLAYER TEXT
 *
 * This is the single source of truth for text shown to players.
 * Edit the text inside quotation marks, save this file, and refresh your local
 * development page to see the change. Keep property names and punctuation such
 * as commas, braces, and {placeholders} intact. Then ask Codex only to deploy.
 */

export const PLAYER_TEXT = {
  site: {
    title: "Master Blaster",
    socialTitle: "Master Blaster — Neon Arena Shooter",
    description: "Grapple anything, shatter towers, and flatten your friends with 47 wildly different weapons in fast online arena combat.",
    socialImageAlt: "Master Blaster neon arena combat"
  },

  landing: {
    brandFirst: "MASTER",
    brandSecond: "BLASTER",
    kicker: "GRAPPLE. BLAST. BRING THE ARENA DOWN.",
    headlineLine1: "Swing wild.",
    headlineLine2: "Break everything.",
    lead: "Grapple anything. Shatter towers. Flatten your friends with 47 wildly different weapons. Every fight leaves the battlefield a little less intact.",
    highlightsAria: "Game highlights",
    highlights: "GRAPPLE ANY SURFACE · DESTRUCTIBLE TOWERS · UP TO 16 FIGHTERS · ZERO INSTALL",
    buttons: {
      quick: { label: "QUICK PLAY", description: "Eight-player chaos in seconds" },
      private: { label: "PRIVATE ROOM", description: "Bring friends. Break everything." },
      training: { label: "TRAINING", description: "Test 47 weapons on up to 15 bots" },
      settings: "Settings",
      credits: "Credits"
    },
    features: [
      { number: "01", title: "GRAPPLE ANYTHING", description: "Walls. Floors. Towers. If you can hit it, hook it." },
      { number: "02", title: "BREAK THE ARENA", description: "Blast towers apart and drop floors on your rivals." },
      { number: "03", title: "47 WEAPONS", description: "Rockets. Fireballs. Black holes. Chainsaws. Choose five." }
    ]
  },

  boot: {
    loading: "LOADING THE MAYHEM · PLEASE HOLD",
    failed: "ARENA LAUNCH FAILED · RELOAD TO RETRY"
  },

  loading: {
    kicker: "CLEAR THE DROP ZONE",
    title: "Rebuilding the mayhem",
    description: "Sweeping up the wreckage and dropping in a fresh arena.",
    defaultSeed: "BLAST-01",
    newSession: "NEW SESSION",
    sameSeed: "SAME SEED",
    freshArena: "FRESH ARENA"
  },

  setup: {
    back: "← Back",
    start: "START",
    modes: {
      quick: { tag: "QUICK", title: "Quick Play", description: "Join an online regional room, filled with AI combatants until more players arrive." },
      private: { tag: "PRIVATE", title: "Private Room", description: "Create or join an online room by sharing its short room code." },
      training: { tag: "TRAINING", title: "Training", description: "Choose up to fifteen bots and master movement, trajectories, recoil, and grappling." }
    },
    labels: {
      displayName: "Display name",
      roomCode: "Room code",
      mapSeed: "Map seed",
      botDifficulty: "Bot difficulty",
      botCount: "Number of bots",
      timeLimit: "Time limit (minutes)"
    },
    difficulties: { rookie: "rookie", normal: "normal", veteran: "veteran" },
    loadout: {
      title: "Choose five weapons",
      selected: "{count}/5 selected",
      help: "Weapon order becomes slots 1–5. Drag on desktop or use the arrow controls on any device. Swipe slots and weapon categories horizontally on touch screens.",
      savedSets: "Saved sets",
      savedSetsDescription: "One default applies automatically to every game",
      savedSetsAria: "Saved weapon sets",
      categorySummary: "{count} weapons · A–Z",
      magazineAndReload: "MAG {ammo} · {seconds}S RELOAD",
      magazine: "MAG {ammo}",
      noReload: "NO RELOAD",
      emptySlot: "Empty slot",
      noSavedWeapons: "No saved weapons",
      weaponSetAria: "{name} weapon set",
      nameSetAria: "Name for weapon set {number}",
      removeDefaultAria: "Remove {name} as default weapon set",
      makeDefaultAria: "Make {name} the default weapon set",
      defaultActive: "★ DEFAULT",
      defaultInactive: "☆ DEFAULT",
      load: "LOAD",
      saveCurrent: "SAVE CURRENT",
      clear: "CLEAR",
      loadAria: "Load {name} weapon set",
      saveAria: "Save current loadout to {name}",
      clearAria: "Clear {name} weapon set",
      moveLeftAria: "Move {weapon} left",
      moveRightAria: "Move {weapon} right",
      removeAria: "Remove {weapon}",
      full: "All five weapon slots are full.",
      removed: "{weapon} removed.",
      added: "{weapon} added to slot {slot}.",
      moved: "{weapon} moved to slot {slot}.",
      presetLoaded: "{name} loaded in slots 1 through 5.",
      replaceConfirm: "Replace {name} with the current five weapons?",
      presetSaved: "{name} saved{defaultSuffix}.",
      presetSavedDefaultSuffix: " and set as default",
      renamed: "Weapon set renamed to {name}.",
      defaultLoaded: "{name} is now the default and has been loaded.",
      defaultCleared: "Default weapon set cleared.",
      clearConfirm: "Clear {name}? This cannot be undone.",
      presetCleared: "{name} cleared."
    },
    onlineNote: "Guest session · Quick Play and Private Room use the live multiplayer fleet · Training remains offline"
  },

  privateLobby: {
    section: "PRIVATE LOBBY",
    title: "Squad assembly",
    description: "Share the room code and wait here until everyone has joined. The host controls when the fight begins.",
    roomCode: "ROOM CODE",
    copyCode: "COPY CODE",
    copied: "Room code copied.",
    roster: "PLAYERS IN LOBBY",
    hostBadge: "HOST",
    playerCount: "{count}/16 PLAYERS",
    matchRules: "{minutes} MIN · {bots} BOTS · {difficulty}",
    hostReady: "Everyone here? Launch the match when your squad is ready.",
    guestWaiting: "Waiting for {host} to start the match.",
    start: "START GAME",
    waiting: "WAITING FOR HOST",
    leave: "← LEAVE LOBBY",
    lastResult: "LAST MATCH · {winner} WON",
    lastDraw: "LAST MATCH · DRAW"
  },

  settings: {
    section: "LOCAL PREFERENCES",
    title: "Settings",
    labels: {
      graphics: "Graphics quality",
      blood: "Blood and impact effects",
      cameraShake: "Camera shake",
      masterVolume: "Master volume",
      musicVolume: "Music volume",
      effectsVolume: "Effects volume",
      ambienceVolume: "Ambience volume",
      dynamicRange: "Dynamic range",
      reducedMotion: "Reduce motion and flashes"
    },
    options: {
      graphics: { low: "low", medium: "medium", high: "high" },
      blood: { off: "off", reduced: "reduced", full: "full" },
      dynamicRange: { wide: "wide", standard: "standard", night: "night" }
    },
    save: "SAVE SETTINGS"
  },

  credits: {
    section: "MASTER BLASTER v0.1",
    title: "Built for the open web.",
    technology: "Three.js rendering, WebGPU enhancement with WebGL fallback, physical projectiles, deterministic arena generation, adaptive bots, and touch-friendly controls.",
    direction: "Game direction follows the Master Blaster browser-native specification, inspired by the immediate projectile combat and grappling movement of classic arena games."
  },

  errors: {
    graphicsSection: "GRAPHICS RECOVERY",
    graphicsTitle: "Renderer paused.",
    graphicsReset: "The graphics device was reset. Reload the page to restart the arena.",
    reload: "RELOAD",
    connectionSection: "CONNECTION LOST",
    connectionTitle: "The arena link dropped.",
    connectionDescription: "Return to the menu and start a new match.",
    returnToMenu: "RETURN TO MENU",
    onlineService: "ONLINE SERVICE: {message} Training remains available offline.",
    matchmakingUnavailable: "Matchmaking unavailable ({status})",
    invalidRoomCode: "Enter a valid room code.",
    roomTimeout: "The multiplayer room did not respond in time.",
    couldNotConnect: "Could not connect to the multiplayer service.",
    roomClosedBeforeJoining: "The multiplayer room closed before joining.",
    matchInProgress: "This private room is currently in a match.",
    matchStartTimeout: "The room did not confirm the match start. Try again.",
    sessionExpired: "The reconnect window expired.",
    reconnecting: "CONNECTION INTERRUPTED · RECONNECTING",
    invalidSessionState: "Invalid session state",
    deliveryFailed: "Delivery failed",
    methodNotAllowed: "Method not allowed",
    websocketRequired: "WebSocket upgrade required",
    unsupportedProtocol: "Unsupported multiplayer protocol",
    roomFull: "Room is full or complete",
    notFound: "Not found",
    rendererSection: "RENDERER ERROR",
    rendererTitle: "Graphics initialization failed.",
    rendererDescription: "Update your browser or enable hardware acceleration, then reload."
  },

  hud: {
    firstTo: "FIRST TO {score}",
    leaders: "TOP 3 · {count} FIGHTERS",
    enemy: "ENEMY",
    activeWeapon: "ACTIVE WEAPON",
    grappleReadyDesktop: "GRAPPLE READY · E / RIGHT CLICK",
    grappleReadyTouch: "GRAPPLE READY · TAP HOOK",
    grapplePulling: "GRAPPLE PULLING · RELEASE TO SLINGSHOT",
    clickToStart: "CLICK TO START · FIRST CLICK ONLY CAPTURES AIM",
    tapToStart: "TAP TO START",
    charge: "CHARGE {percent}%",
    reload: "RELOAD",
    ready: "READY",
    armed: "ARMED",
    reloading: "RELOADING",
    readyNoReload: "READY · NO RELOAD",
    measuringFramePace: "MEASURING FRAME PACE",
    performance: "{fps} FPS · {draws} DRAWS · {fighters} FIGHTERS · {mode} · {seconds}/60 SEC",
    pauseAria: "Pause",
    matchType: "Deathmatch",
    touchControlsAria: "Touch controls",
    swap: "SWAP",
    swapAria: "Swap weapon",
    hook: "HOOK",
    hookAria: "Grapple hook",
    jump: "JUMP",
    jumpAria: "Jump",
    fire: "FIRE",
    fireAria: "Fire weapon",
    impact: "impact",
    health: "Health",
    eliminatedBy: "ELIMINATED BY {name}",
    environment: "THE ARENA",
    respawningIn: "RESPAWNING IN {seconds}",
    controlRestored: "Control restored"
  },

  performanceProfiles: {
    webgpuMobileDirect: "WEBGPU MOBILE DIRECT",
    webglMobileDirect: "WEBGL2 MOBILE DIRECT",
    webglBloom: "WEBGL2 BLOOM",
    webgpu: "WEBGPU",
    webgl: "WEBGL2",
    mobileDirect: "MOBILE DIRECT",
    lowDirect: "LOW DIRECT",
    mediumBloom: "MEDIUM BLOOM",
    bloom: "BLOOM",
    sixteenPlayerBloom: "16P BLOOM",
    ultra: "ULTRA",
    directSafety: "DIRECT SAFETY",
    quality: { low: "LOW", medium: "MEDIUM", high: "HIGH" }
  },

  pause: {
    section: "SIMULATION PAUSED",
    title: "Take a breath.",
    resume: "RESUME",
    restart: "RESTART MATCH",
    mainMenu: "MAIN MENU"
  },

  results: {
    draw: "Draw match",
    winner: "{name} wins",
    section: "MATCH COMPLETE",
    rematch: "REMATCH · SAME SEED",
    menu: "RETURN TO MENU"
  },

  defaults: {
    displayName: "Rookie",
    presetName: "Set {number}",
    quickBotName: "Region Bot {number}",
    botName: "Atlas Bot {number}"
  },

  maps: {
    foundry: "Neon Foundry",
    solar: "Solar Rift",
    ion: "Ion Garden"
  },

  weaponGroups: {
    rapid: "Rapid Fire",
    explosive: "Explosive",
    energy: "Energy",
    precision: "Precision",
    close: "Close Quarters",
    unusual: "Unusual",
    melee: "Melee"
  },

  structuralCollapseName: "COLLAPSING PLATFORM",

  weapons: {
    blaster: { name: "Blaster", description: "Medium-speed visible bolt." },
    shotgun: { name: "Shotgun", description: "Fast close-range pellet burst." },
    machine_gun: { name: "Machine Gun", description: "Near-instant rapid physical rounds." },
    rocket_launcher: { name: "Rocket Launcher", description: "Fast, heavy terrain rocket." },
    grenade_launcher: { name: "Grenade Launcher", description: "Fast launcher-grade shell with an arcing, bouncing fuse." },
    mine: { name: "Mine", description: "Persistent proximity trap." },
    railgun: { name: "Railgun", description: "Almost-instant precision line shot." },
    plasma_cannon: { name: "Plasma Cannon", description: "Large high-velocity energy orb." },
    submachine_gun: { name: "Submachine Gun", description: "Mobile close-range bullet stream." },
    minigun: { name: "Minigun", description: "Spinning barrels deliver extreme fire with heavy sustained recoil." },
    plasma_repeater: { name: "Plasma Repeater", description: "Rapid near-instant energy streaks with a persistent visible trail." },
    needle_launcher: { name: "Needle Launcher", description: "Needles pierce through two fighters in one line." },
    burst_rifle: { name: "Burst Rifle", description: "Timed three-round precision burst." },
    flamethrower: { name: "Flamethrower", description: "Continuous 11.5-metre cone with distance and edge falloff." },
    cluster_grenade: { name: "Cluster Grenade", description: "Splits into six secondary bomblets." },
    sticky_launcher: { name: "Sticky Launcher", description: "Fires a fast charge that adheres to its first surface." },
    remote_explosive: { name: "Remote Explosive", description: "Launch up to four fast charges; fire again to detonate them before the 30-second safety fuse." },
    mortar: { name: "Mortar", description: "High-velocity arcing shell with a broad blast." },
    bouncing_bomb: { name: "Bouncing Bomb", description: "High-energy bomb ricochets before exploding." },
    napalm_launcher: { name: "Napalm Launcher", description: "Fast incendiary rocket ignites a persistent fire zone." },
    implosion_bomb: { name: "Implosion Bomb", description: "Collapses its blast inward and drags fighters together." },
    laser_beam: { name: "Laser Beam", description: "Instant straight beam with no travel cutoff." },
    charged_energy_rifle: { name: "Charged Energy Rifle", description: "Hold to charge, then release a piercing precision shot." },
    arc_lightning: { name: "Arc Lightning", description: "Lightning jumps between nearby opponents." },
    pulse_cannon: { name: "Pulse Cannon", description: "Fast wide impulse pulse for controlling space." },
    gravity_beam: { name: "Gravity Beam", description: "A maintained tractor tether pulls its target toward you." },
    disintegration_weapon: { name: "Disintegration Weapon", description: "Piercing beam erases cover in its path." },
    black_hole_generator: { name: "Black-Hole Generator", description: "Launches a fast singularity that pulls and damages nearby fighters." },
    freeze_gun: { name: "Freeze Gun", description: "Slows movement and grappling for 4.5 seconds after the last hit." },
    fireball: { name: "Fireball", description: "Thrown living flame rebounds from floors and walls until it strikes a fighter." },
    teleport_projectile: { name: "Teleport Projectile", description: "Teleports the shooter to the first impact point." },
    drill_missile: { name: "Drill Missile", description: "High-speed missile bores through cover before exploding." },
    boomerang_blade: { name: "Boomerang Blade", description: "Piercing blade returns to its owner." },
    ricochet_cannon: { name: "Ricochet Cannon", description: "Rounds rebound repeatedly from arena surfaces." },
    gravity_grenade: { name: "Gravity Grenade", description: "A wide implosive grenade with extreme pull." },
    tornado_generator: { name: "Tornado Generator", description: "Fires a fast vortex seed that throws fighters upward." },
    temporary_wall: { name: "Temporary Wall", description: "Builds a solid energy wall at the impact point." },
    decoy_launcher: { name: "Decoy Launcher", description: "Deploys a hologram that distracts enemy bots." },
    weapon_stealing_projectile: { name: "Weapon-Stealing Projectile", description: "Swaps this weapon with the target's active weapon on hit." },
    grapple_disrupting_pulse: { name: "Grapple-Disrupting Pulse", description: "A high-speed pulse forcibly releases grapples in its blast." },
    hammer: { name: "Hammer", description: "Slow overhead smash with enormous knockback." },
    energy_sword: { name: "Energy Sword", description: "Fast sweeping energy blade." },
    chainsaw: { name: "Chainsaw", description: "Spinning teeth deal maintained close contact damage." },
    spear: { name: "Spear", description: "Long narrow thrust with strong precision damage." },
    punch_glove: { name: "Punch Glove", description: "Spring-loaded punch with massive launch force." },
    shock_baton: { name: "Shock Baton", description: "Stuns and slows the struck fighter." },
    knife: { name: "Knife", description: "Very fast strike that executes enemies below 30 health." }
  }
};

export default PLAYER_TEXT;
