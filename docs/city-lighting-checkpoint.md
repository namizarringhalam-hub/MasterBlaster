# City lighting — item 1

- Authorized: implement item 1 of the reviewed 17-item graphics plan, validate and publish it, then measure credit use and revise the remaining estimate before proceeding.
- Start account balance: 1964.904683 credits. Account-wide measurement; concurrent tasks and delayed billing can affect attribution.
- Baseline: clean main. Existing generated RoomEnvironment, .42 environment intensity, warm directional key/cool rim. No new runtime lights or post passes planned.
- Changed: lighting.js replaces the generic room with a one-time HDR city capture: cool sky, warm lower hemisphere, cyan/magenta/warm window/sign reflections, soft ground-return panels. Existing PMREM roughness filtering and explicit HDR override remain.
- Scope: distant authored city radiance; live reflections of fighters/destruction remain item 3. Existing fixed sky hues guide the capture across map themes.
- Regression coverage: capture radiance/orientation, lower-hemisphere bounce, unique resource cleanup, offline/HDR/error paths.
- Full suite passed (27 Node checks and 19 Worker tests); Worker sandbox log/static-analysis warnings remain, exit 0. Final lighting tests/build/hosting pass after radiance tuning. No new dependencies.
- Review fixed a key-reflection card hidden behind the capture shell; regression now checks every card stays inside. Matched original/city arena and fighter captures showed the initial fill was too dim; final bake doubles authored radiance to retain shaded armor readability.
- Native high rendered without errors/fallback; final low fighter capture inspected and medium initialized without errors/fallback. Original arena sampled 624 draws/38 textures; initial city 619/38. Animated movers make draw differences unsuitable for speed claims; unchanged environment texture dimensions and no per-frame light/pass additions are the reliable structural result.
- Final medium WebGPU combat: 16 fighters, stress active, zero errors/fallback at frame 604. Final WebGL high: arena capture inspected, WEBGL2 BLOOM, zero errors/fallback, 618 draws/35 textures. Low/native fighter and WebGL arena preserve readable silhouettes/routes with colored environment fill.
- Review complete: offline generation, HDR override, roughness-filtered reflection, capture orientation and cleanup covered. Runtime lighting/geometry/collision and post-pass counts unchanged. No claim of measured FPS improvement.
- Implementation and validation complete. Publication target: normal commit/push to origin/main, then verify deployed build and report account credit delta. Browser control occasionally times out during compilation/tier changes; fresh state checks recover. Do not infer GPU performance from these control timings.
