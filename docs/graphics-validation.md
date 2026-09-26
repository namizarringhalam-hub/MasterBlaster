# Graphics rollout validation

The 17-item rollout preserves gameplay collision and uses the existing Three.js renderer. Each feature was published separately. The detailed commit/checkpoint history and observed credit readings are in `graphics-rollout.md`.

## Quality and accessibility

| Rendering path | Effects |
| --- | --- |
| Native WebGPU High | Environment lighting/materials, SSR, wet surfaces, volumetric clouds/local fog, soft lit smoke, heat shimmer, contact shadows, MSAA + FXAA, adjustable camera/rigid-object motion blur |
| Native WebGPU Medium | Shared materials/environment and animation, reduced atmosphere, bloom and FXAA |
| WebGL High/Medium | Shared materials/environment and animation, bloom and FXAA; environment reflections replace SSR |
| Low | Direct rendering with reduced decorative detail and particle counts |

Reduced motion disables motion blur and heat distortion, freezes atmospheric/decorative motion, and reduces weapon/body animation and flashes. Motion blur has a saved 0–100 intensity control under Settings; 0 disables it. HUD text stays outside scene postprocessing.

FXAA supplements existing MSAA without temporal accumulation. Reflections and contact shadows use visible current-frame depth, so offscreen geometry relies on the existing environment/shadow maps. Motion vectors cover the camera and rigid opaque objects; transparent particle streaks retain their authored animation.

## Automated verification

The complete 27-script Node suite and 19 Worker tests passed after motion-blur integration. This includes all 47 weapon models, gameplay/multiplayer regressions, scene disposal, reduced motion, motion resets, settings persistence, and actual WGSL/GLSL generation. Production build and hosting checks passed. Existing Worker sandbox log/static-analysis warnings did not fail tests.

## Browser verification

The focused particle fixture verified native rendering, camera motion, rigid-object motion with a fixed camera, reduced motion, and tier transitions. GPU readback found 2,846 nonzero motion-vector pixels for the moving-object case. WebGL rendered without fallback/errors.

The lightweight `tests/rollout.browser.html` runs the production game controller and exposes frame/resource/error metrics. At the local review viewport, the two-fighter scene measured about 100 FPS on Medium and 52–62 FPS on High. These are local scene observations, not cross-device guarantees or a calibrated GPU benchmark.

Ten consecutive High-quality scene resets retained exactly 66 textures and 224 geometries on every cycle, with zero recorded errors and no direct-render fallback. This total includes the cached Medium and High graphs used in the tier-transition test.

Browser inspection occasionally timed out while the game continued rendering. A subsequent screenshot and live frame counters confirmed activity; no game-freeze cause was established from those timeouts.

A live 16-fighter combat simulation measured about 43 FPS on High in this local run, with no errors or safety fallback. A later Medium snapshot during heavier combat measured 22 FPS (620 geometries versus 531 in the earlier High snapshot). These are not matched scenes and do not establish a tier-to-tier speedup; crowded combat remains a performance limitation. The full WebGL2 BLOOM game rendered 1,950 frames at about 67 FPS in the two-fighter scene, with zero errors and no direct safety fallback; gameplay and explosion controls were also exercised.




A clean default High startup subsequently rendered 2,910 frames at approximately 59 FPS, with 53 textures, 224 geometries, zero errors and no fallback (no cached Medium graph in that run).

