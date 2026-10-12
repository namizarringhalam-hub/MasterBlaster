# Lag and graphics implementation - 2026-10-12

## Scope and location

Implement every actionable recommendation from the lag/graphics review at baseline `8acfc38`, then validate and publish through origin/main to masterblaster.se. Master Blaster only. Canonical checkout: `traycer-masterblaster-keen-moose-90ba36edc9d4`; branch `traycer/masterblaster-keen-moose`. This changeset contains the validated implementation; publication follows the repository workflow below.

Preserve gameplay, all 47 weapons, audio, dark visual direction and saved quality intent. Fixed gameplay remains 60 Hz with the existing catch-up cap. High remains the first-run default. The review's alternatives are not cumulative: two cascades, cached cloud radiance and existing merged decoration resolve their respective items. Optional rain and a lower offline catch-up cap were not adopted.

## Implemented

- Persistent hazard/projectile/mortar/grapple/wall pools, shared projectile streams, reusable holograms, shared immutable weapon geometry and rigid mecha skinning.
- Once-per-render presentation, allocation reuse, coalesced hit feedback, full pointer deltas, server-time remote interpolation and life/roster resource cleanup.
- Compact MRT with shared depth/velocity, native-resolution temporal/spatial reconstruction, AgX/grade, Low bloom, Medium SSR, half-resolution depth-aware fog and in-engine speed/impact effects.
- Cached cloud radiance/shadows, composed floors, material detail, animated city, spatial queries, two shadow cascades with exact selected sizes and real near-mecha shadows.
- Authored emission anchors for all 47 weapons, correct hand endpoints, independent body/weapon motion, damage/death/respawn presentation and explicit skeleton/resource ownership.

## Correctness discoveries

Independent reviews and actual GPU runs corrected bind/rest transforms, heading interpolation, stale remote-life buffers, grapple cleanup, temporal/grade disposal, CSM map ownership/depth/callback order/cold initialization and camera-kick ordering.

Empty projectile layers must be hidden: pinned Three uploads their dynamic streams before rejecting count-zero draws. Production initializes empty layers hidden and updates visibility with active count. Tests cover empty -> 4096 active -> empty and warmup restoration without changing capacity or geometry. Shared unique CPU arrays fell from 54,722,560 to 28,295,168 bytes; these are not GPU-memory figures.

Cold graphics changes now synchronously gate rendering, serialize preparation, await discovery/submitted GPU work, defer disposal and reject stale results. Inactive temporal scenes settle for exactly 32 frames at dt=0, then hold. Hidden tabs render none.

Pinned Three 0.185.1 also needed prior per-mesh bind matrices and per-draw skeleton palette selection for correct attached-skin motion. The guarded patch covers source and both browser builds. Presentation leaves palette updates to the renderer. Install/dev/build/test hooks apply the patch.

## Completed verification

- Final production build and hosting checks pass. Existing menu-resource/chunk-size warnings remain.
- Native WebGPU: 21 gameplay/mechanics assertions; 16 fighters, five loadout families, stress, grapple, death/respawn/steal, pause/results/rematch; final populated High/Medium/Low and idle/moving mecha captures.
- Forced WebGL: startup and focused rematch pass with no errors or fallback. This closes the unverified rematch stage of an earlier combined run that exceeded its 300-second watchdog.
- Actual cold Low -> paused High: populated scene, exactly 32 settling renders and zero further renders over 500 ms.
- GPU shadow/fog/attachment fixtures: 140 receiver probes, live shadow resize, preservation of opaque packed surfaces and velocity.
- Skinning: 204 regression cases, independent 280 prior-world samples per backend (max error 4.44e-16 m), and 12 numerical GPU cases per backend including root/hinge/shared-material clone/stationary frames.
- Touch emulation at 390x844 and 844x390: actual swap/fire, contained controls, no horizontal overflow or readout-slot overlap. Portrait gap is 8 px. This is desktop Edge touch emulation, not physical-phone testing.
- Final independent review found no reproducible blocking source defect in its stated scope. No AAA/key-art parity is claimed; temporal softness, Low aliasing and modest material/skyline richness remain qualitative limits.

## Measurements and limits

Short matched-scenario local High windows measured native active-16 average 22.92 -> 40.83 FPS and frozen overview 40.39 -> 48.01; forced WebGL 23.68 -> 41.71 and 40.58 -> 49.12. Active battle states can diverge. These measurements predate only final skin-history correctness, inactive temporal settling and portrait spacing changes; they are not exact-final-build or universal FPS guarantees. Raw Three interleaved memory counters are not unique GPU bytes or leak proof.

## Final acceptance and publication

The complete `npm test` run passes: 64 isolated runner steps, including 63 standalone checks and Vitest's 2 files / 21 worker tests. Log: `.codex-spec-render/lag-graphics/test-final.log`. Production build/hosting and whitespace checks pass. Final source review found no blocking defect.

The final test audit corrected stale fixtures for the real presentation, copied-depth and pooled/skinned geometry contracts. Leg-floor checks now sample actual finite skinned leg vertices; trail reversal checks submitted instance matrices on success/error; teardown checks every output target/material. Particle goldens include authorized VFX transforms, flame/age buffers and actual presentation sync while retaining real backend sparse/range/expiry checks (>95% upload reduction).

The earlier apparent graphics-test leak was a failed object-to-null assertion expanding a Fighter scene graph after an invalid legacy low-quality fixture. The fixture now uses valid settings and bounded diagnostics; formerly side-effect-imported suites run in separate bounded processes. The complete run finishes successfully.

All browser processes and both owned validation servers (5173/5174) are stopped. Commit request files only, push HEAD:main without force, and verify masterblaster.se serves the built resource version. The final publication receipt belongs in the Traycer `master-blaster-lag-graphics-implementation` artifact, beside the independent review and portable validation results. Raw captures/logs stay ignored under `.codex-spec-render/lag-graphics`.
