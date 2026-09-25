# Arena graphics and performance checkpoint

Request: apply the Apnea graphics lessons to Master Blaster (2026-09-25).

- Scope: coherent lighting/materials, distance-limited decorative detail, smaller shadow budgets, subtle shared environmental animation and local atmosphere. Keep gameplay geometry and combat readability intact.
- Baseline: clean working tree; existing WebGPU/WebGL renderer, instancing, pooled effects and half-resolution post effects retained. Native WebGPU high arena review at 1669×1300: 628 draws / 330,062 triangles, 359,269,218 reported texture bytes, no errors or fallback. Initial frame timings show browser throttling and are not a valid FPS benchmark.
- Validation planned: focused rendering/geometry checks, full npm test and build, native WebGPU and forced WebGL browser review, same-view renderer counters and 16-fighter stress.
- Implemented: warm key/cool restrained rim and softer environment fill; baked concrete floor and matte cable insulation; distance-culling of small decorative batches with bounding-radius margins and 8m hysteresis; 2048/1024/512 shadow tiers; four shared perimeter mesh shafts (two medium, zero low); shared arena-time reactor sweeps, honoring pause/reduced motion. PBR shader emission is isolated from reflected light in bloom.
- Regression found/fixed: detail registration initially recalculated conservative baked-cover bounds. Registration now retains existing bounds; original regression passes. A development hot reload briefly loaded the helper call before its definition was saved; fresh final-code startup is clean.
- Validated: full `npm test` exit 0 (27 Node checks plus 19 Worker tests), `npm run build` exit 0. Worker runner emitted sandbox log/static-analysis warnings, but both files/all 19 tests passed. Additional WGSL/GLSL emission regression passes after adding animated PBR coverage.
- Native WebGPU high, same arena view at 1669×1300: 601 draws / 327,782 triangles / 157,942,626 texture bytes; no errors/fallback. Low grazing and medium gameplay-camera views also render without errors/fallback. Inspected lossless arena and low grazing captures: cover outlines, route markers, surfaces and silhouettes remain readable.
- Native high 16-fighter stress: active impact rings/sparks, 265 draws / 181,334 triangles in the sampled gameplay view, no errors/fallback. This moving combat scene is not used for before/after counter comparisons.
- Forced WebGL high: WEBGL2 BLOOM, 600 draws / 327,781 triangles, 137,887,076 texture bytes, no errors/direct fallback. Inspected the lossless arena capture. Startup inspection timed out briefly; the loaded page subsequently responded and passed.
- Browser timing stays around 1000ms/frame (cause not isolated); do not claim a measured FPS improvement. Same-view native counters show 4.3% fewer draws and 56.0% less reported texture memory, not a GPU timing guarantee.
- Code review: collision/camera occluders and combat geometry untouched; existing conservative spheres preserved; bounded hysteresis, shared GPU clock, low-tier shaft removal and arena disposal covered by regression checks. No new dependencies.
- Implementation and validation complete. Release target: normal commit to origin/main; commit identity is recorded in Git history.

## Underwater skylight follow-up (2026-09-25)

- Request: light from the sky into the battlefield, evoking Apnea's underwater atmosphere.
- Implemented in `src/world.js`: blue-green overhead water glow with soft surface contours; four long slanting cyan shafts (two medium, zero low); slow world-space caustic contours on the floor and structural decks. Caustics modulate existing surface color and keep PBR lighting/shadows; no extra textures, lights or render passes. Arena clock preserves pause and reduced-motion behavior. Low/medium tiers reduce caustic contrast.
- Validated: full `npm test` exit 0 (27 Node checks and 19 Worker tests); production build/hosting check exit 0; explicit WGSL/GLSL shader regression passes with floor, deck, shaft and sky graphs. Tests cover quality transitions, caustic material assignment, non-emissive floor, unchanged collision and disposal.
- Browser: inspected native WebGPU high arena and low grazing lossless captures, plus forced WebGL high arena. Zero renderer errors or fallback. Same-view counts remain 601 native / 600 WebGL draws; reported texture memory unchanged from the previous version. Longer shafts increase pixel coverage and shader work; these counters are not an FPS guarantee.
- A WebGL control timeout resolved after closing the completed native preview. No product renderer errors were reported.
- Medium WebGL moving-combat check: 16-fighter stress running, arena unpaused, active impact rings/sparks, zero errors or fallback. Implementation and validation complete; release target is a normal commit/push to origin/main.
