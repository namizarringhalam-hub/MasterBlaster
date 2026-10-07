# Smoothness improvements — 2026-10-07

Authorized: implement frame-time measurement, consistent simulation timing with render interpolation, reused aim queries, bounded particle-buffer uploads, and per-effect profiling. Validate, commit only request files, push origin/main. Keep all browser tabs muted. Preserve unrelated untracked `%SystemDrive%/`.

Starting point: main at 5a2531a. Existing performance test passed during read-only audit. No controlled comparison against Super Typo Kart; its code assets require a browser session. Existing warmup/pooling/workers/graphics presets remain in use.

Work allocation: root owns src/main.js, timing/interpolation modules, timing regressions, test-runner integration and publication. loop_audit owns world/player aim and raycast optimization. render_audit owns combat/explosion particle uploads and backend regressions. reference_source owns a muted local per-effect/active-combat profiling fixture and conditional render-graph work only when justified.

Confirmed issue: frame dt currently discards time above .033s, advancing only .66s per wall second at 20 FPS. Existing telemetry caps intervals at .25s and reports one-second average FPS; misses long-frame tails. Raycast and upload improvements require exact-output checks and matched measurement.

Implemented: uncapped frame/CPU tails, 60Hz simulation with 250ms bounded catch-up, render interpolation/restoration, shared aim surface and cached raycast topology, and pending-prefix particle uploads. Added production-path regressions and a muted fixed-scene per-effect ABBA/active 16-player browser fixture. No new dependencies or preset quality reductions.

Changed files: src/main.js, src/world.js, src/player.js, src/combatVisuals.js, src/explosionParticles.js; new src/frameTiming.js, src/simulationTiming.js, src/particleUploads.js; scripts/test.mjs; existing tests/graphics.test.mjs, tests/matchStartup.test.mjs, tests/performance.test.mjs, tests/testRunner.test.mjs, tests/blasterSurface.test.mjs, tests/smoke.mjs; new tests/simulationTiming.test.mjs, tests/aimPerformance.test.mjs, tests/particleUploads.test.mjs, tests/smoothness.browser.html; this checkpoint.

Verified: full npm test passes (38 script checks plus Vitest with 2 files/20 Worker tests), final production build/hosting and multiplayer protocol/Worker dry-run pass. Particle payload hashes stay identical; matched rocket burst upload 85,248 to 3,820 bytes (95.5% less). Aim microbenchmark improved, not a whole-game FPS result. Added FrameTiming bindings to pause/resource test harnesses and corrected a pre-existing audioQuality regex for renderMain's options argument (HEAD assertion was already false).

Reviewer findings resolved: retained Escape and short mouse/touch edges at 120Hz; catch-up shots gated before side effects to match server wall-time authority; interpolated fireball matrices rebuilt; gameplay long-task deltas exclude boot totals; hidden Escape cannot undo visibility pause. Full suite passes after updating obsolete expiry/upload expectations.

Additional request files: AGENTS.md records always-muted browser tabs; tests/pause.test.mjs, tests/resourcePreparation.test.mjs and tests/audioQuality.test.mjs adapt the validated test harnesses.

Browser results: initial high/WebGPU fixed window rejected fewer than 30 frames. User agreed to keep Edge foreground, but the repeat still captured only 3 frames in 3.0046 seconds: intervals 1000.2ms, render CPU mean 21.73ms/p95 23.5ms, update mean .60ms. This suggests throttling; cause unconfirmed. All 16 fighters and the frozen particle scene rendered without reported browser errors. Low/WebGL active16 preparation exceeded its 120-second watchdog; no browser errors explained it. These attempts are rejected diagnostics, not passing FPS or WebGL-combat checks. Per-effect rankings and live FPS improvement remain unverified; presets are unchanged. Fixture retains rejected samples and preparation phases. Independent final reviews found no remaining code blockers.

Evidence saved outside the repo: C:/Users/namir/.codex/visualizations/2026/10/07/01a1182f-f7f8-7461-bd4d-a6876f5b96ab/smoothness-browser.json and smoothness-browser.jpg. The muted diagnostic tab was closed and local helper cleanup requested.

Publication: implementation commit 1a0298e pushed to origin/main and remote HEAD verified. masterblaster.se now serves release 9c6ca99ac16864ea539eb208da6d90ed77a4b76375f2fa370456aef44c5c1b8e, engine /assets/main-D8WjyX_y.js. Direct HTTP inspection confirmed new droppedSimulationMs, p99Ms, simulationNetworkFireAt and grappleRaycaster code. Local build release differs from hosted build identity; do not claim byte-for-byte parity from those IDs. Request code is published; checkpoint publication follows separately.

Remaining limitation: per-effect rankings and live FPS improvement need an environment with reliable foreground frame cadence. No claimed runtime FPS gain and no pending product-code work. OS window occlusion cannot be detected by the fixture. All task browser tabs are closed; local Vite helper stopped. Unrelated untracked %SystemDrive%/ remains untouched.
