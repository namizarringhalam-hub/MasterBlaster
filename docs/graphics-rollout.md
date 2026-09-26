# Graphics rollout checkpoint

User authorized continuing the reviewed list until credits run out, publishing each validated item separately. Preserve unfinished work and resume from this file. No automatic next-day schedule was requested.

Session starting account balance: 1738.055228 credits. Account readings include other tasks/delayed billing; they are not isolated invoices.

1. City lighting/environment — published c546731; live build verified. Previous observed account delta 216.03 credits.
2. Material overhaul — published 2680b4b, live boot verified: baked multiscale grime, scratches and edge wear in existing albedo/normal/ORM; rubber grips/cables and glass eye lenses. Full 27 Node checks + 19 Worker tests, production build/hosting, WGSL/GLSL generation and native visual review passed. WebGL browser preview stalled without captured errors; native preview recovered after closing only the test tab. Compatibility pixel review remains to repeat; GLSL generation passed. Boot bundle index-DhE4DOIg.js.
3. Real-time reflections — published 2cc51a7, live boot verified: native WebGPU high half-resolution SSR from current beauty/depth/normal/material attachments; roughness blur, bounded reach and intensity, edge fade, existing IBL fallback. WebGL/medium/low retain environment reflections. No separate planar pass: the dry arena has no mirror/water plane. Full suite and build/hosting pass; actual SSR/blur WGSL generation added. Native on/off visual comparison and cover destruction passed. Boot index-CWzpAAp8.js.
4. Wet surfaces/puddles — published 0928b23, live boot verified: surface-local irregular pool masks, soaked albedo, dielectric clearcoat, rain/wind ripple normals using the existing reduced-motion clock; native SSR now follows coating normals/roughness. No additional textures, geometry or collision changes. Full suite passed; final local-space correction passed WGSL/GLSL checks and production build. Native high screenshot and medium tier checked. Boot index-BpPihYu4.js.
5. City composition — published 5529df3, live boot verified: grouped skyline heights/landmarks, larger clustered windows with derivative smoothing, restrained warm/cool rooms and district accents. Native skyline screenshot reviewed. Graphics regression, arena bounds/lifecycle, WGSL/GLSL and production build/hosting passed. Boot index-C7Pm4cSP.js.
6. Volumetric clouds/atmosphere — published 1732a90, live boot index-CIzn3A2k.js verified: actual density ray march through a 140–220m cloud layer, 12/6/0 steps by tier, light extinction/scattering, large advecting shapes, horizon fade and shared wind-driven ground shadows aligned with the existing key light. Native high skyline reviewed; medium rendered without errors. Full suite passed before final scale/light-direction tuning; WGSL/GLSL passed after scale tuning. QA reduced-scene-motion control added. Final reduced-motion/high/medium/low checks and production build passed.
7. Local fog/light shafts — validated for publication: 16-step view-ray integration capped at 64m, height/local density, current scene depth and key-light shadow occlusion; high-native only. Explicit VSM depth sampling and deferred initialization avoid invalid samplers/MSAA layouts. Removed manual disposal of Three-owned shadow targets during tier changes. Full suite, final graphics regression and build index-B3ccu7Er.js passed. Native on/off review, high/medium/high and low/high transitions passed with zero errors/fallbacks.
8. Lit smoke/explosion refinement — pending.
9. Heat distortion — pending.
10. Impact marks/material response — pending.
11. Mecha weight/secondary motion — pending.
12. Weapon animation — pending.
13. Environmental animation — pending.
14. Contact shadows — pending.
15. Temporal stability/antialiasing — pending.
16. Cinematic motion blur — pending.
17. Combined integration/performance/validation — pending.

Publication: normal commits to origin/main; verify the live boot bundle after each milestone. Browser review at /tests/graphics.browser.html; native/WebGL via ?renderer=webgl. Local server last running at 127.0.0.1:5174. Browser control may time out during shader compilation; inspect fresh state rather than treating a timeout as a passing check. Existing full-suite Worker log/static-analysis sandbox warnings do not fail the suite. No reliable GPU benchmark yet.

Material milestone account reading: 1661.238421 credits (observed session delta 76.82 so far; billing may lag). Next unfinished item: real-time reflections after confirming material deployment.

Reflection milestone account reading: 1542.767765 credits (90.91 since material milestone's 1633.677827 reading). Browser QA toolbar now scrolls within 36vh so controls cannot overlap offscreen and activate unrelated comparisons. Next: finish reset/fallback check, publish item 3, then wet surfaces.

Item 3 final validation: ten native scene resets completed, all 47 textures/19 render targets stable, zero errors/fallbacks. WebGL2 BLOOM confirmed >1100 frames, zero errors, no SSR allocated as intended. Full 27 Node checks + 19 Worker tests and build passed. Ready to publish reflections.

Reflection final account reading: 1499.894410 credits (133.78 since item 2 reading). Materials compatibility screenshot passed after browser reconnection. Next: publish wet surfaces after WebGL review, then city composition.

Item 4 final validation: WebGL2 BLOOM 838 frames with zero errors/fallbacks; native high visual review and medium tier passed. Final arena lifecycle/shader checks and build pass. Account reading 1460.004174 (39.89 observed since item 3; billing may lag). Publishing wet surfaces; next city composition.

Item 5 account reading 1403.031857 (56.97 since previous reading, includes final item 4 publication). Next: publish city composition, then volumetric clouds/atmosphere.

Item 6 final: full 27 Node + 19 Worker suite passed, final tuning passed WGSL/GLSL and arena tests, build/hosting index-CIzn3A2k.js. Browser native high/medium zero errors; 16-fighter stress advanced the atmospheric clock to 39.32, reduced-scene-motion held it at zero, low tier disables ray marching. Final skyline reviewed without horizon cutoff. Account 1314.968606 (88.06 observed since item 5). Next: publish clouds, then occluded local fog/light shafts.

Item 7 final account reading: 1063.725950 credits (251.24 observed since item 6, includes shadow/GPU debugging and delayed billing). Next: publish local fog, then item 8 lit smoke and depth-soft particles. Final test/build and native tier transitions passed.

Publication blocker: item 7 git add/commit/push was NOT executed. Automatic approval review failed with HTTP 401 authentication error, not an unsafe-action determination. Do not bypass review. Last published item remains 6 (1732a90); item 7 changes are validated and uncommitted. Restore approval authentication, then publish item 7 before continuing items 8–17. User asked for status; no cancellation.
