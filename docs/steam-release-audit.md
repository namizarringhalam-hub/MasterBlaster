# Master Blaster: Steam desktop release audit

Audit date: 2026-09-27. Source baseline: `c2b58690f08e12aa812ed3739ee08c1310d9954d`.

**Recommendation: validate a packaged Chromium desktop build first, starting with Windows.** It preserves the largest amount of proven gameplay code and offers the shortest route to testing browser–Steam cross-play. There is no existing engine desktop-export path in this repository. Consider a Godot or Unity rebuild only if a measured packaging limitation or a concrete product requirement justifies replacing the client.

This is an audit and proposed backlog, not authorization or implementation of a port. No gameplay, runtime source, dependency manifest, or production service was changed. Architecture findings come from repository code, not the website. External documentation is used only to evaluate prospective platforms. Paths and symbols below refer to the baseline above; line numbers are navigation aids.

## 1. Actual stack and architecture

| Area | Repository evidence | Finding |
| --- | --- | --- |
| Engine / rendering | `package.json`; `src/main.js:1`, `:155`; `src/renderPipeline.js:1` | Custom game built on Three.js **0.185.1**, importing `three/webgpu`, TSL node materials and Three addons. `WebGPURenderer` selects WebGPU or a WebGL 2 backend. This is not a Godot, Unity, Unreal, Phaser, or other editor-engine project. |
| Graphics pipeline | `src/renderPipeline.js:96`; `src/lighting.js:112`; `src/graphicsPresets.js`; `src/combatVisuals.js` | Authored bloom, AO, SSR, motion blur, fog, contact shadows, heat distortion and soft particles, subject to backend/quality options. WebGL has a different, reduced postprocessing path. Procedural environment lighting is the active default; HDR loading exists but `LIGHTING.hdrUrl` is empty. |
| Languages | `src/*.js`, `multiplayer/*.js`, `PLAYER_TEXT.js`, `index.html`, `src/*.css`; `scripts/fetch-music-samples.py` | JavaScript ES modules for game, backend and tests; HTML/CSS for UI; JSON/JSONC for configuration; Python with NumPy for an optional music asset preparation script. No tracked TypeScript/C#/GDScript game sources or native engine project files were found. Shader logic is chiefly authored in JavaScript/TSL. |
| Build | `package.json`; `package-lock.json`; `vite.config.js`; `scripts/prepare-sites.mjs` | npm + Vite **8.0.16**, with Rolldown chunking. Build produces a web client and generated static-hosting Worker adapter. Separate Wrangler configuration builds the multiplayer Worker. `server.mjs` is a loopback static HTTP server, not the multiplayer simulation server. |
| Dependency patches | `scripts/patch-three.mjs:5`, `:20`, `:59`; `tests/threeLifecycle.test.mjs` | Install/dev/build/test hooks verify or apply two pinned Three corrections: geometry attribute disposal and node-material observer caching. A wrapper must preserve this build step; upgrading Three requires revalidating these patches. |
| Application structure | `src/boot.js`; `src/main.js`; `src/player.js`; `src/world.js` | Deferred boot loads a large coordinating Game implementation. Fighter simulation and presentation coexist in `player.js`; arena collision, destruction and presentation coexist in `world.js`. There is useful modularity, but not a renderer-independent simulation library ready to drop into a new engine. |

### Physics and movement

There is **no separate physics-engine dependency** in the manifest/lockfile. Movement uses Three vectors and custom integration/collision. `Fighter.update` (`src/player.js:982`) applies grounded damping toward speed 9, airborne acceleration 7 and horizontal cap 16, jump velocity 7.5, and gravity 19. These are game units, not a claimed SI calibration. The arena resolver (`src/world.js:3118`) uses floor/surface queries, radius-expanded obstacle boxes, boundary clamping, ceiling handling and ledge detection, accelerated by a spatial obstacle index (`:648`). Moving platforms, boost pads, portals and collapsing structures add movement interactions.

`Game.frame` (`src/main.js:2174`) caps raw frame delta at 0.25 seconds and gameplay delta at 0.033 seconds. It is a variable-step loop, not an accumulator-based fixed physics tick. Projectiles have distance-based substeps (`src/gameData.js:218`, `src/main.js:2989`). Seeded arena generation does **not** imply deterministic whole-match simulation: bots, spread and other behaviors use `Math.random`, and frame scheduling affects integration. A native fixed-step controller or stock rigid body would change the reference behavior unless deliberately matched.

### Grappling

Grappling is a custom velocity controller, not a physics rope joint. `src/main.js:2527` attaches to a ray-selected world surface; `syncGrappleTarget` tracks moving attachments and releases invalid/destroyed surfaces. `updateGrapple` (`:2585`) computes up to eight obstacle wrap points and updates rope geometry. `src/world.js:3329` resolves target identity; `:3430` handles wrapping; `src/grappleRope.js` builds the presentation geometry.

`applyGrapplePhysics` (`src/player.js:1302`) shortens the rope at 18 or 36 units/sec, damps toward pull speed 31 or 46, preserves tangential motion, allows steering, adds launch lift and ledge assistance, and caps speed at 48. `boostGrappleRelease` (`:1353`) boosts retained momentum and adds vertical velocity. Ground-anchor braking, moving-platform carry and update order all belong to the reference feel, alongside these constants. Remote state currently sends position/velocity/aim, not the full rope attachment/wrap state (`src/multiplayer.js:259`); equivalent rope visuals across clients are a separate unknown.

### Weapons and combat

`src/gameData.js:80`–`:151` defines **47 weapons**, grouped by function, with five-slot loadouts. Data contains damage, ammo, cooldown, reload, spread, projectile speed, splash/terrain/structural effects and bot policies. Dispatch and simulation live in `src/main.js:2615` onward: physical projectiles, hitscan, beams, bursts, chain attacks, melee, flame, mines, remote explosives, hazards, walls, decoys and special movement/status effects. `src/weaponPresentation.js`, `src/combatVisuals.js` and `src/audio.js` provide presentation. This is data-driven dispatch plus bespoke behaviors, not 47 interchangeable prefabs.

Offline play applies local combat. Online play submits fire and hit proposals and consumes server combat outcomes (`src/main.js:3494`, `src/multiplayer.js:278`, `multiplayer/worker.js:776`, `:893`). A rebuild must preserve both local feel and the server's canonical damage/validation rules; copying weapon numbers alone is insufficient.

### Destruction

The arena has breakable cover and segmented structural towers with stable pillar/platform part IDs. `structuralTowerBlueprints` and `structuralPartBounds` (`src/gameData.js:289`, `:308`) are shared with server validation. `src/world.js:1991`–`:2487` manages part health/state, queued failures, falling structures, collisions, riders/crush interactions and reconciliation; `:2637` batches structural geometry. Debris and dust use bounded pools (`:1779` onward).

Online terrain proposals are checked against weapon/shot history; the Worker maintains structural health, collapse start times and terrain events (`multiplayer/worker.js:972`). Clients construct the corresponding visible collapse. This is authored part failure and collapse, not arbitrary mesh fracture or a general rigid-body destruction engine. Importing a tower as one static mesh loses its identity and behavior.

### Bots and rounds

`src/botBrain.js` contains target/spawn and range/weapon policy helpers. A module Web Worker (`src/botPlanner.worker.js`) performs target selection from snapshots; `src/main.js:2339` submits them about every 0.12 simulation seconds. Main-thread `updateBot` (`:2352`) handles strafing, distance control, line of sight, edge avoidance, difficulty, firing and probabilistic jumping/grappling, with a fallback when the planner Worker fails. No navmesh/pathfinding package was found.

Quick Play and Training run locally. In network rooms, the server owns bot membership and combat state, but **the oldest connected human client is the bot simulation host** (`multiplayer/worker.js:370`, `:692`, `:769`; `src/main.js:1402`, `:2240`). Server-managed bots should not be described as server-simulated AI.

Local match timers, scoring, results and restart are coordinated in `src/main.js:2198`, `:3807`; online countdown, respawn, score and end-of-round state are in `multiplayer/worker.js:1119`, `:1236`, `:1308`. Private/global rooms return to their lobby after a round; legacy quick network rooms emit `match_end`. The existing frontend's Quick Play mode is offline even though a `/api/quick` network matchmaking endpoint still exists.

## 2. Multiplayer and backend dependencies

| Responsibility | Actual owner / mechanism | Release implication |
| --- | --- | --- |
| Transport | HTTP room discovery/status and JSON messages over browser WebSocket (`src/multiplayer.js:81`, `src/multiplayerProtocol.js`). HTTPS origins become WSS. | No WebRTC, UDP, peer mesh or Steam networking transport in the inspected implementation. A native client can implement the same wire protocol. |
| Cadence/version | Protocol version 1, arena revision 2, 16-fighter maximum, 50 ms state-send interval (`src/multiplayerProtocol.js:3`). | Approximately 20 Hz outgoing state, not proof of a fixed 20 Hz server simulation. Desktop updates and browser updates need explicit compatible content/version policy. |
| Movement | Client integration; server sanitizes vectors, bounds/displacement, portal transitions and respawn state (`multiplayer/worker.js:712`). | Server does not replay inputs through the full movement/grapple/collision controller. Position plausibility checks do not prove wall/speed cheats impossible. |
| Combat | Server authorizes actors/loadouts/fire cadence/ammo, validates proposals and computes canonical damage/push (`multiplayer/worker.js:776`, `:841`; `src/combatAuthority.js:97`, `:152`, `:176`). | Stronger than trusting supplied damage; weaker than independently simulating all shots/contacts. No full lag-compensated rewind system was found. Test rejection/fairness under real latency. |
| Structures | Server structural health/timing and event history; client geometry/collapse presentation. | Cross-engine ports must agree on seed, revision, part IDs, bounds and collapse timing. |
| Client host | Selected human runs bots; private/global host controls lobby/start. | Losing, minimizing or suspending that client can affect bot behavior until transfer/recovery. Host migration is not migration of a complete dedicated simulation. |
| Persistence | Cloudflare Durable Objects: `MatchRoom`, `Matchmaker`, `GlobalLobby`, SQLite-backed class migrations, storage, alarms and WebSocket attachments (`wrangler.jsonc`; `multiplayer/worker.js:217`, `:414`; `multiplayer/globalLobby.js`). | Retaining this backend avoids an immediate server rewrite. Regional latency, concurrency, storage/write cost, limits and operational recovery need evidence. Observability is configured; live dashboards/costs were not inspected. |
| Identity | Browser-local UUID identity/favorites and resume tokens (`src/globalMultiplayer.js:9`; `src/multiplayer.js:12`; `multiplayer/globalLobby.js:21`, `:69`). | No Steam ticket verification, ownership linking, durable player account service, bans or entitlement system was found. A copied browser identity is not authenticated Steam identity. |
| Endpoint selection | `VITE_MULTIPLAYER_ORIGIN`, otherwise localhost:8787 or page origin (`src/multiplayer.js:28`). Worker routes cover `/api/*` on the two site hostnames. | A packaged local/custom origin needs an explicit backend origin. Test CORS, TLS, Origin handling and reconnect from the actual shell. HTTP wildcard CORS is present; that alone is not WebSocket authentication. |

The Node static server and generated `dist/server/index.js` do not replace the Durable Objects backend. No D1/KV/R2 bindings or third-party authentication/payment service appear in `wrangler.jsonc`. These observations cover checked-in configuration, not every service that might exist in the Cloudflare account.

## 3. Assets, dependencies and licence evidence

| Material | What exists | Reuse / evidence gap |
| --- | --- | --- |
| Arena, fighters and weapons | Procedural Three geometry/rigging in `src/world.js`, `src/mecha.js`, `src/player.js`, `src/weaponPresentation.js`. No tracked GLB/GLTF/FBX/Blend models found. | Direct code reuse in a wrapper. Rebuild needs generator ports or a deliberate mesh/rig export pipeline. Exported geometry alone omits animation, collisions, IDs, shaders and destruction. |
| Materials / effects | Generated albedo/normal/ORM textures (`src/surfaceTextures.js:1`), TSL graphs and runtime effects. Optional HDR loader with no active HDR asset. | Can bake selected texture/mesh outputs for a rebuild; material/effect behavior requires recreation. No existing general export process was found. |
| Recorded music | 33 tracked WAV files; sampled file header is mono, 32 kHz, 16-bit PCM. `src/musicScore.js` selects samples and implements adaptive composition; `scripts/fetch-music-samples.py` records source paths and conversion. | WAVs are reusable. Local `public/audio/music/LICENSE.md` records VSCO 2 CE / CC0-1.0 and modifications; [upstream repository](https://github.com/sgossner/VSCO-2-CE) also identifies CC0. Source fetching uses a moving `master` branch; retain exact source revision/hash records for reproducibility. |
| Effects / music runtime | `src/audioAssets.js`, `src/audioAssets.worker.js`, `src/audio.js`, `src/musicScore.js`: synthesized PCM, Web Audio mixing/spatialization and score scheduling. | Wrapper reuses these. Native rebuild can bake selected SFX or port synthesis; Web Audio graph, voice management and adaptive scheduling require replacement. |
| Images / branding | `public/menu-arena-v2.webp`, `public/og.png`, `public/favicon.svg`; reference PNGs under `tests/assets`. | Standard image formats, but no individual provenance/rights records found for these images. Do not assume a test reference image is approved for shipping. |
| Fonts | `index.html:33` requests Inter and Barlow Condensed through Google Fonts; CSS has system fallbacks. | External dependency remains on cold launch. No tracked font binaries/licence files found. If bundled for desktop, obtain exact fonts and licence records; otherwise verify acceptable offline fallback. |
| Direct packages | Lockfile: Three 0.185.1, Vite 8.0.16, Vitest 4.1.11, Cloudflare Vitest plugin 1.1.2: MIT metadata; Wrangler 4.125.0: MIT OR Apache-2.0 metadata. | Three/addons ship in web bundles. Vite is listed as a production dependency but serves a build role. Package placement is not an accurate shipped-binary inventory. |
| Transitive packages | `package-lock.json` also records MPL-2.0 (Lightning CSS), LGPL-bearing optional/dev Sharp/libvips packages and other licences. | Do not label the whole dependency tree MIT, or assume every build dependency is redistributed. Inventory the actual desktop payload, including any new Chromium/Node/native bridge components, and collect corresponding notices. |
| First-party ownership | No root LICENSE, consolidated THIRD_PARTY_NOTICES, contributor rights ledger or engine SDK licence records found among tracked files. `package.json` is private. | This is a records gap, not proof of infringement or a requirement to open-source the game. Verify commercial redistribution rights and branding clearance separately; this audit does not establish legal clearance. |

## 4. Verification and desktop readiness

**Executed locally on Windows with Node v22.21.0 / npm 10.9.4, using existing installed dependencies:**

| Check | Result and limits |
| --- | --- |
| `npm.cmd test` | Exit 0: 29 top-level checks passed, including Vitest's 2 files / 19 Worker tests. Some top-level checks import additional suites. Covers movement/grapple helpers, all weapon attack paths, bots, geometry, pooling, combat authority, reconnect logic, caches, audio and persistence/lobby behavior. |
| Worker tooling diagnostics | Despite passing tests, logged `EPERM` for an external Wrangler debug-log path and warnings about static export analysis/access to parent directories. Preserve these warnings as environment limitations; passing tests do not establish a warning-free Worker build/deployment. |
| `npm.cmd run build` | Exit 0; Vite and generated hosting checks passed. Three chunk approximately 962.93 kB minified / 266.53 kB gzip; main gameplay chunk 454.61 / 133.70 kB. Renderer chunk-size advisory remains. |
| Source / manifest / asset inspection | Tracked-file inventory, call paths, lockfile licence metadata and WAV header checked. No source or package changes made. No clean install, vulnerability scan or complete transitive licence-text review performed. |

Local raw logs: `.steam-audit-tests.log` and `.steam-audit-build.log` (ignored by Git). The test runner limits each child to 120 seconds / 1 GiB heap (`scripts/test.mjs`). Much of the suite uses Node assertions, source-pattern checks, constructed Three objects and stubs; it is not equivalent to interactive GPU rendering or a two-window playtest. Worker tests use the Cloudflare local test runtime, not production.

Existing additional facilities include `tests/multiplayerLive.mjs`, `tests/globalMultiplayerLive.mjs`, browser fixtures (`tests/graphics.browser.html`, `tests/matchStartup.browser.html`, `tests/trainingControls.browser.html`), `tests/assetCacheLiveServer.mjs`, and GPU tracing utilities. **These live/browser harnesses were not run in this audit.** No production endpoints were exercised. `check:multiplayer`/deployment commands were not run.

Instrumentation exists: shell/engine/arena performance marks and a long-task observer (`src/boot.js:6`, `src/main.js:293`, `:2185`); HUD FPS, average/minimum sample FPS, draw calls, geometries, textures and optional JS heap (`src/main.js:3774`). The HUD's 45 FPS / 620 draw-call heuristic is not a Steam release certification. `PERFORMANCE.md` contains earlier browser measurements and caveats; they were not reproduced here and cannot establish performance of this baseline or a desktop wrapper. Frame percentiles, input-to-display latency, GPU/VRAM usage, network bandwidth/latency and multi-hour soak behavior remain unmeasured for desktop.

Browser desktop controls, pointer lock, focus reset, first/third-person camera handling, Web Audio, workers, local/session storage and a service worker already exist. `public/sw.js` caches same-origin assets and shell fallback; this helps previously loaded browser sessions but is not proof of a clean-machine offline desktop launch. Root-relative `/assets`, `/audio`, `/sw.js` URLs make blindly loading `dist/index.html` via `file://` unsuitable.

No desktop packager, executable, installer, signing/notarization workflow, Steam App ID/depot configuration, Steam SDK bridge, controller/Gamepad input implementation, or Steam Deck verification was found. Windows/macOS/Linux GPU-driver behavior, overlay interaction, controller-only navigation, suspend/resume, high-DPI/multiple monitors and offline installation are **untested**. A browser fallback is not a guarantee of equivalent visuals or performance on all desktop GPUs.

## 5. Compare the three release paths

### Path 1 — Package the current game

**Proposed first candidate: Electron with a pinned Chromium runtime and bundled build output.** This is a recommendation to test, not a claim that an Electron build exists. Its controlled browser runtime is a useful fit for the existing WebGPU/WebGL/Web Audio/Worker code. Tauri remains an alternative if footprint becomes a measured concern, but it uses WebView2 on Windows and WebKit on macOS/Linux, adding runtime variation to this particular renderer ([Tauri documentation](https://v2.tauri.app/reference/webview-versions/)).

| Category | Scope |
| --- | --- |
| Reusable code | Nearly all current browser game, input, UI, audio, Three visuals, networking and existing backend. Preserve movement/combat update order and pinned Three patches. |
| Reusable data/assets | Weapon definitions, seeded arena data, text, graphics settings, WAV bank, images and procedural asset recipes, subject to rights verification. |
| New or replacement work | Desktop process/packaging; a stable local asset origin; writable per-user profile; explicit multiplayer endpoint; update/cache ownership; app exit/window/focus behavior; optional narrowly scoped Steam integration. Add platform/controller support only against agreed release requirements. |

Main risks and evidence needed:

- **Asset origin/offline/update behavior:** use a standard secure app protocol with the necessary fetch/worker/storage support, or a carefully scoped loopback server. Keep root URLs working; test both workers, audio MIME types, clean offline launch, settings persistence and update/rollback with old caches. Electron documents these protocol capabilities separately; enabling a protocol must not disable CSP ([protocol API](https://www.electronjs.org/docs/latest/api/protocol)). `server.mjs` has a smaller MIME table and different behavior than the tested hosting adapter, so it is not automatically a finished shipping asset server.
- **Security and maintenance:** renderer sandboxing, context isolation, no renderer Node integration, navigation restrictions and a minimal native bridge. Resolve these with a review of the actual shell plus hostile-navigation/IPC tests, not by adding a broad privileged API ([Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)).
- **GPU/Steam integration:** test WebGPU and forced WebGL on target hardware, cold shaders, focus/overlay, long sessions and executable lifecycle. Steam's supported graphics APIs do not prove correct overlay hooking through a particular Chromium GPU process ([Steam overlay documentation](https://partner.steamgames.com/doc/features/overlay)).
- **Footprint/performance:** measure install size, startup, memory and frame-time tails. No evidence here proves either a speedup or an unacceptable wrapper cost.

**Browser–Steam cross-play:** strongest reuse path. Keep the existing HTTP/WSS room protocol, compatible arena/weapon versions and Cloudflare authority. Steam distribution does not require replacing networking with Steam transport; Valve documents runtime Steamworks features as optional ([Steamworks SDK](https://partner.steamgames.com/doc/sdk)). Steam identity/friend invites would require an explicit mapping to the shared room/account model. They are not supplied by packaging.

**Smallest playable experiment:** a locally packaged Windows executable containing the existing arena and assets. Exercise grappling, Blaster and Rocket Launcher, one collapsing tower, one bot and a full round/restart. Connect one packaged client and one existing browser client to a local test Worker; repeat with the packaged client as bot host and then disconnect it. Verify identical damage/ammo/score/structural results, reconnect, focus recovery and cold offline local play. The existing roster can remain in the package; do not add weapons or change balance for this test. A non-Steam executable test validates packaging only; subsequent Steam-client/overlay testing requires separate release access and authorization.

### Path 2 — Desktop export from the existing engine

**Not applicable to this source tree.** Three.js is the rendering library used by custom JavaScript; Vite's output is web assets, not a native engine player. There is no engine project/export preset to select. The PWA manifest describes browser installation, not a Steam executable. Changing the label from wrapper to export does not create a third implementation route.

| Category | Scope |
| --- | --- |
| Reusable code | The same existing JS remains reusable only with a compatible web runtime. |
| Reusable data/assets | Same as path 1. |
| Replacement work | A desktop runtime/package is still needed, making this path 1; importing content into Godot/Unity becomes path 3. |

**Risk/evidence:** the main risk is planning around a nonexistent export. Resolve with a tracked native project, supported exporter configuration and executable produced from the canonical source. None was found. An untracked or external original engine project is an unknown; do not assume it exists.

**Browser–Steam cross-play:** no independent implication until there is a runtime. A wrapper inherits path 1's protocol reuse; a native port inherits path 3's compatibility work.

**Smallest experiment:** first a feasibility gate, not a playable claim: produce an executable using an actual existing exporter without porting code. Current inventory fails that gate. Therefore there is no distinct playable export experiment; use path 1's packaged round instead of spending a milestone searching for an export button.

### Path 3 — Rebuild in Godot or Unity

Both can target desktop, but the repository contains neither project. Godot supports GDScript/C#/C++ and native desktop exports; JavaScript is not an officially supported gameplay language. Unity produces a native Windows player from a Unity project. These are new client implementations, not automatic conversion ([Godot FAQ](https://docs.godotengine.org/en/stable/about/faq.html), [Unity Windows build documentation](https://docs.unity3d.com/6000.0/Documentation/Manual/WindowsStandaloneBinaries.html)).

| Category | Godot | Unity |
| --- | --- | --- |
| Reusable code without client translation | Existing JS backend can remain external; JS tests/reference harnesses remain executable specifications. | Same. |
| Algorithms to port, not paste | Movement, grapple, collision rules, bots, projectile/weapon dispatch, round logic and protocol client into GDScript or C#. | Same into C#; do not treat existing JS as Unity scripts. |
| Reusable data/assets | Weapon/arena/text definitions after extraction; WAVs/images; baked procedural geometry/textures if exported and verified. | Same; asset import does not reproduce TSL materials or procedural rig behavior. |
| Replacements | Scene/render integration, shaders, HUD, input bindings, animation, audio graph, worker scheduling, save storage and build/export setup. | Equivalent work using Unity scenes/prefabs, render pipeline/materials, UI/input/audio and player builds. |
| Physics strategy | Custom controller matching the reference, using engine queries only where equivalence is demonstrated. Stock body/joint settings are not a validated substitute. | Same caution for CharacterController/Rigidbody/joints and engine timestep/contact behavior. |
| Decision evidence | Prototype on intended GPUs; developer proficiency; shader/mesh authoring cost; chosen language/export constraints; maintained Steam integration. | Same, plus project/package selection and current Unity licence/commercial terms. No pricing or licence eligibility assumption is made here. |

**Largest technical risks:** movement/combat feel drift; collision and grappling under different tick rates; mismatched client/server structural geometry; RNG/hash overflow semantics; remote interpolation and projectile tolerance changes; reauthoring the procedural look/audio; maintaining browser and native clients together. Pure helpers and numeric data are valuable, but much of the apparent asset investment is executable Three code. A rebuild is not justified solely by assuming native engines will be faster.

**Browser–Steam cross-play:** preserve the existing browser client and implement its exact JSON/WSS contract in the new desktop client. Godot's low-level WebSocket peer can send text messages; its high-level multiplayer RPC protocol is not this game's protocol ([Godot WebSocket guide](https://docs.godotengine.org/en/stable/tutorials/networking/websocket.html)). Unity similarly needs a compatible WebSocket/HTTP client, not an automatic switch to an engine networking package. If a replacement browser build is later contemplated, browser socket restrictions still apply ([Unity web networking documentation](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-networking.html)). Browser clients cannot simply join a new UDP/Steam-native-only transport; retain WSS or explicitly build/test a gateway and shared authority.

Port seed/hash arithmetic with JS-compatible 32-bit overflow and stable part IDs, or ship verified generated arena data. Keep coordinate conventions, units, origins, shot timestamps, life/respawn sequencing and content versions explicit. Merely connecting two sockets does not prove compatible gameplay. Do not require a Steam account of existing browser players without a separate product decision.

**Smallest playable experiment / first rebuild milestone (mandatory):** one reference arena, grappling, **exactly two implemented weapons: Blaster and Rocket Launcher**, one destructible tower, one bot, two connected clients and a complete countdown → combat → death/respawn → result → restart loop. Blaster covers direct projectile contact/reload; Rocket Launcher covers splash, recoil and structural damage. Both have existing source definitions (`src/gameData.js:91`, `:95`). No extra weapons before the milestone passes.

Use one new desktop client and one unchanged browser client in an isolated local/test room, so cross-play is tested in the first milestone; also check a pair of new clients before expanding scope. Preserve a tower's canonical IDs/bounds/timings and required collision/spawn data even if the initial art is simplified. The current protocol expects five-slot loadouts: use fixed valid loadout metadata and restrict the experiment to the two implemented weapons, or introduce a test-only compatibility arrangement. Do not silently alter the live protocol or implement three extra weapons merely to fill the HUD.

Reproduce the bot host contract; disable random selection of unsupported weapons in the isolated experiment fixture. The same one bot must move, acquire a target, grapple/fire as applicable, die and respawn. Do not replace it with a stationary target and count that as complete. A disconnected native-only prototype does not validate the required milestone.

## 6. Staged backlog and decision gates

These are proposed follow-on tasks. None were implemented by this audit. Estimates should follow the first measured experiment; no reliable calendar or budget estimate can be inferred from repository size alone.

| Stage / priority | Work | Acceptance evidence / gate |
| --- | --- | --- |
| 0 — P0: freeze reference | Preserve baseline commit and build. Record fixed-seed keyboard/mouse scripts plus videos and numeric traces for run/stop, jump, airborne steering, grapple attach/reel/wrap/release/ledge/moving target, Blaster contact and Rocket splash/tower collapse. Include camera, recoil and audio timing. | Repeatable reference cases at 30/60/120 FPS, plus an explicit record of current behavior at slow frames. Characterize discrepancies; do not fix the reference while measuring it. |
| 1 — P0: package experiment | Build only the path 1 local executable and its asset origin/configuration. Keep browser build available. Run the two-client/one-bot/tower/round experiment above against a local backend. | Cold offline play works from installed assets; both clients agree on outcomes; settings survive restart; no stuck input/audio after focus changes; host loss/reconnect behavior recorded; both render backends exercised. |
| 2 — P0: assess measured limits | Compare packaged vs browser on named hardware/resolution/preset. Measure median/p95/p99 frame time, startup, memory/VRAM, rematch growth, shader stalls, bandwidth and input latency. Include 16 fighters and repeated destruction beyond the minimal experiment. | Agree minimum specs and budgets before interpreting results. Example proposed 60 FPS target: 16.7 ms frame budget on the chosen minimum PC, with an explicitly agreed tail-frame allowance. No universal 60 FPS claim from average FPS. Go/no-go for packaging; optimize only measured blockers. |
| 3 — P0: release foundations | Resolve shipped asset/code/font provenance; generate exact payload dependency/notices inventory. Define protocol/content compatibility between independently updated browser and Steam builds. Review hybrid authority, malformed/replayed messages, token abuse and bot-host dependence. | Rights records cover every shipped item; mismatched clients are rejected safely; staged rollout/rollback and stale-cache cases pass; multiplayer trust limits and acceptable release threat model are documented. Any backend hardening is separately reviewed implementation work. |
| 4 — conditional P0: native rebuild milestone | Only if packaging fails an important measured requirement, select **one** engine and implement path 3's constrained milestone. Start with reference movement/collision and WSS contract before visual polish. Preserve current JS game as comparison. | All required elements playable together, two clients finish and restart multiple rounds, and mixed browser/native outcomes agree. User playtest accepts movement/combat against side-by-side recordings. No weapon expansion before approval of this evidence. |
| 5 — P1: desktop product integration | On the chosen path, add tested fullscreen/window/focus/exit behavior, saves/profile migration, logs/crash diagnostics, input rebinding/controller navigation if in release scope, and optional Steam identity/invites/achievements. Define browser account interoperability first. | Clean install/update/uninstall; offline boot; long-session/restart soak; privacy/diagnostic handling; overlay + pointer lock + pause behavior on actual Steam client. Verify signing, depot layout and release access when authorized. |
| 6 — P1: release candidate | Local/staging regression matrix, latency/jitter/disconnect tests, rollback drill and supported Windows GPU matrix. Add Linux/Steam Deck/macOS only with actual test devices/runtime evidence. | Named supported configurations pass. Production deployment/Steam upload/release require a separate authorized task; audit completion is not release approval. |
| 7 — P2: expand only after core gate | If rebuilding, migrate existing remaining weapon behaviors in tested groups. Add richer presentation and optional platform features according to measured need. | Reuse reference tests per group. Do not enlarge the weapon roster as a substitute for movement, combat, cross-play or round-loop validation. |

Reference parity should cover outcomes and feel: acceleration/braking curves, jump apex/time, grapple travel and release velocity, collision/ledge results, projectile time-to-contact, damage/ammo/reload/score, collapse timing, respawn placement and input-to-camera response. Establish numeric tolerances from repeated baseline runs; do not invent broad tolerances that conceal a changed game. The scripted cases and user playtest complement each other.

If a rebuild becomes necessary and the team has no established engine preference, a small Godot experiment is a reasonable first candidate because the required client can be built without committing to a larger proprietary toolchain. Existing Unity expertise may outweigh that preference. Neither engine is selected as a replacement today; the packaged experiment supplies the evidence for deciding whether a replacement is needed at all.

## 7. Unknowns and audit checkpoint

- No packaged executable, real Steam launch/overlay, controller playtest, native rebuild, mixed browser/native session, live two-window browser test, WAN impairment test or GPU benchmark was executed here.
- No production service/account configuration, current uptime, regional latency, billing, capacity, ownership/Steam entitlement setup or deployed-code parity was verified.
- Asset authorship/brand rights and complete third-party redistribution compliance remain unresolved records work. No root ownership licence should be invented by an implementation agent.
- Repository content and inspected tests support the architecture findings. Historical README/performance claims are distinguished from checks executed for this audit.
- Audit implementation scope: this report only. Local validation logs are ignored artifacts; build output remains ignored. Tests/build passed with the warnings recorded above. No independent reviewer was used.
- Next unfinished product step: Stage 0 reference capture, followed by the local packaging experiment if authorized. There is no blocked implementation hidden behind this audit.
- Publication constraint: `README.md` states Cloudflare Pages deploys GitHub `main`. Keep this audit local and do not push to `origin/main`, because this request expressly forbids deployment; live auto-deploy settings were not inspected or changed.
