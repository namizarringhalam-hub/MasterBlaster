# Graphics presets and live controls

The four presets use the reviewed Radeon 890M benchmark recipes. Selecting a preset replaces its graphics defaults. Subsequent effect, resolution or detail edits display **Custom** and persist across reloads. **Restore preset defaults** returns to the last selected preset. Reduced Motion remains an independent accessibility preference.

| Default | Low | Medium | High | Ultra |
|---|---:|---:|---:|---:|
| Render scale, each dimension | 50% | 65% | 75% | 100% |
| MSAA samples | 0 | 0 | 0 | 4 |
| FXAA | Off | On | On | On |
| Shadow map | Off | 1024 | 2048 | 4096 |
| AO | Off | Off | 16 samples | 32 samples |
| SSR | Off | Off | Half resolution / quality 0.5 | Half resolution / quality 0.5 |
| Bloom resolution | Off | 34% | 50% | 50% |
| Fog, contact shadows, soft particles, heat shimmer | Off | Off | On | On |
| Motion blur intensity | 0 | 0 | 35 | 35 |
| Combat density / lights | 0.25 / 1 | 0.75 / 2 | 1 / 4 | 1 / 4 |
| Detail distance / motes | 24 / 0 | 72 / 150 | 96 / 220 | 96 / 220 |
| World texture anisotropy | 4 | 8 | 16 | 16 |
| Secondary cosmetic motion / scorch marks | Off | On | On | On |

Low retains wet materials, water caustics, distance haze and immediate combat cues. Medium uses six cloud steps and two horizon layers; High/Ultra use twelve and four. Water-caustic strength is 0.35 / 0.7 / 1 / 1. Surface maps remain 256² with mipmaps; mecha-map anisotropy remains 4. Ultra inherits the former High feature set and increases only shadow resolution and AO samples. Full-resolution SSR (also quality 1) and bloom are manual overrides.

Render scale multiplies the device pixel ratio, capped at 1.65 before scaling. At the benchmark's DPR 1 and 3440×1440 output, internal sizes are 1720×720, 2236×936, 2580×1080 and 3440×1440. HUD text stays at display resolution.

## Controls and lifecycle

Main Settings and Pause → Graphics share all 19 effect switches plus resolution, MSAA, shadow size, AO samples, SSR/bloom resolution, combat density/lights, detail distance, mote count and anisotropy. Effects are available by GPU capability rather than preset name. Enabling an advanced effect on Low selects the necessary render path. WebGL supports bloom and FXAA; advanced effects require WebGPU. Fog/contact shadows require a shadow map. Reduced Motion disables its associated effects without erasing preferences.

Changes apply at frame boundaries. Post graphs are disposed and rebuilt when needed; shader compilation may briefly pause rendering. Shadow size, resolution and detail apply without replacing the match. MSAA is fixed at renderer construction: a visible pending-change message offers **Apply MSAA & reload**, explicitly warning that reloading ends the match. Starting a new match retains the renderer and loaded assets; applying a different MSAA setting still requires the explicit reload. No private renderer fields are modified.

Preset and Custom preferences are validated on load. Older saved settings adopt the new preset defaults while preserving explicitly disabled effects and saved motion-blur intensity. Previously unavailable effects are not silently enabled. Invalid option values fall back to that preset's defaults. Bloom resolution uses Three r185's `setResolutionScale()`; assigning `resolutionScale` did not change its render targets.

## Benchmark basis and limits

Measured on 2026-09-26: AZW SER9, Ryzen AI 9 HX 370, Radeon 890M (driver 32.0.21030.2001), 32 GiB RAM, Windows 11 Pro 10.0.26200, Balanced power, Chromium 154 hardware WebGPU, Three.js 0.185.1, 3440×1440 at 100 Hz. Source baseline: `935b0a9662d1a13b3bce66681c2a33a76b1c2ef2`.

The review accepted 97 combat samples, each at least 30 active seconds after warm-up, excluding loading/pipeline compilation: 80 fixed-30-Hz simulation samples for controlled setting comparisons and 17 normal-timing samples for preset validation. The seeded Neon Foundry scenario uses 15 bots plus an AI-steered player, normal gunfire, explosions, grapples and a repeated camera tour. Every final preset has two normal-timing runs.

| Reviewed preset | Average FPS | 1% low FPS | Range of run averages |
|---|---:|---:|---:|
| Low | 88.87 | 22.01 | 87.62–90.12 |
| Medium | 67.40 | 18.54 | 67.25–67.55 |
| High | 34.32 | 6.69 | 33.77–34.87 |
| Ultra | 6.65 | 2.94 | 6.55–6.75 |

These are the review's candidate measurements, not a new post-implementation benchmark. Average FPS pools frame intervals; 1% low is the reciprocal of the mean slowest 1% of intervals. Normal timing changes combat trajectories and slows simulation below 30 FPS due to the engine's dt cap, so it is not pooled with controlled ablations. The biggest controlled native-High gains were MSAA off (+83.4%), SSR off (+50.3%) and AO off (+15.4%). Gains are not additive. Shared depth/velocity and output-buffer combinations were measured separately.

Low missed the 100+ target; idle browser delivery was 99.88 FPS, and reducing Low to 25% resolution did not establish a useful gain. Medium and High meet their approximate average targets, with substantial hitches reflected in the lows. Ultra offers subtle refinements at a large performance cost. No preset guarantees an FPS level on other machines or scenes.

The complete local review, exact traces, visual comparisons and reproducible fixture remain in `.codex-spec-render/graphics-benchmark` (gitignored); production preset definitions are in `src/graphicsPresets.js`. Validation includes executable settings/render-graph tests, the existing full suite, production build/hosting budgets and the visible browser fixture `tests/rollout.browser.html`.

Implementation validation (2026-09-26): all 27 Node checks and 19 Worker tests passed. Subsequent bloom-independence refinements passed targeted graphics-settings, smoke and 16-fighter weapon-stress checks; final production build and hosting budgets passed. The stress check applies the actual Low 0.25 combat profile and preserves all 112 critical impact cues. Native WebGPU browser checks at 1280×720 verified preset dimensions, Low shadows off, AO enabled on Low, Medium bloom at 0.34, Ultra shadows4096/AO32, saved MSAA4 after reload, live full-resolution bloom/SSR, default restoration, and 53 textures/224 geometries after repeated full-graph rebuilds without errors or direct fallback. WebGL checks verified Medium bloom0.34, Low direct rendering and Requires WebGPU messages. These are integration checks, not new combat FPS measurements.

The extra WebGL Low → bloom-only check also rendered correctly (640×360, bloom 0.5, 38 textures/220 geometries, no rendering errors or direct fallback). Browser inspection temporarily timed out during that change and recovered without restarting the page; the cause was not traced. Control changes may pause rendering, as the settings panel explains.
