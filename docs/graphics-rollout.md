# Graphics rollout checkpoint — complete

All 17 reviewed milestones are implemented or validated and published separately to origin/main. User authorized publishing after each item and continuing until the list or credits ran out. No automatic next-day continuation was scheduled.

## Published milestones

| # | Item | Commit |
| --- | --- | --- |
| 1 | City lighting/environment | c546731 |
| 2 | Material overhaul | 2680b4b |
| 3 | Real-time reflections | 2cc51a7 |
| 4 | Wet surfaces/puddles | 0928b23 |
| 5 | City composition | 5529df3 |
| 6 | Volumetric clouds/atmosphere | 1732a90 |
| 7 | Local fog/light shafts | 0506e60 |
| 8 | Lit smoke/depth-soft particles | bcdcef6 |
| 9 | Heat distortion | f9c026f |
| 10 | Impact marks/material response | ba93eab |
| 11 | Mecha weight/secondary motion | 54a212b |
| 12 | Weapon animation | e71a0d3 |
| 13 | Environmental animation | e5e3994 |
| 14 | Contact shadows | 9b5c8e1 |
| 15 | Antialiasing/stability (MSAA + FXAA) | 06704c6 |
| 16 | Cinematic camera/rigid-object motion blur | c6c3b76 |
| 17 | Combined integration/performance/validation | Published with this checkpoint and validation report |

The latest production code is c6c3b76, live boot bundle index-ELQ_R5SE.js. Item 17 adds the report and production-controller QA fixture; it does not alter the production bundle. See [graphics-validation.md](graphics-validation.md) for quality coverage, test evidence and practical limitations.

## Verification and findings

- Full 27 Node checks plus 19 Worker tests passed after item 16. Actual WGSL/GLSL generation, all 47 weapon models, motion/reduced-motion/reset lifecycle, gameplay and multiplayer regressions passed. Production build/hosting checks passed.
- Native full game: two-fighter scene roughly 52–62 FPS High, 100 FPS Medium. Ten High resets held exactly 66 textures/224 geometries on every cycle (both quality graphs cached), zero errors/fallbacks.
- Active 16-fighter combat: approximately 43 FPS High; a later, heavier Medium scene reached 22 FPS. These are not matched benchmarks. Crowded-combat performance remains a known limitation, not a guaranteed 60 FPS result.
- Full WebGL gameplay: 3,720 frames, about 64–67 FPS, zero errors/fallbacks, explosion/gameplay controls exercised.
- Focused GPU motion test: stationary camera/moving opaque object produced 2,846 nonzero velocity pixels; reduced motion disabled blur and stopped the extra prepass once particles expired.
- Browser inspection sometimes timed out while screenshots and frame counters showed the game continuing. Do not infer a game freeze from that control timeout alone.
- Earlier approval-service authentication failure was resolved by retrying. GitHub read/push worked without changing user credentials.

## Observed credits

Account-wide snapshots include delayed billing and any other concurrent work; they are not isolated per-item invoices. Starting continuation balance was 1,738.055228. The earlier item-1 observed cost was 216.03 credits.

| Through item | Balance | Change since preceding listed milestone |
| --- | ---: | ---: |
| 2 | 1633.677827 | 104.38 from continuation start |
| 3 | 1499.894410 | 133.78 |
| 4 | 1460.004174 | 39.89 |
| 5 | 1403.031857 | 56.97 |
| 6 | 1314.968606 | 88.06 |
| 7 | 1063.725950 | 251.24 |
| 8 | 895.964819 | 167.76 |
| 9 | 845.684869 | 50.28 |
| 10 | 781.275969 | 64.41 |
| 11 | 718.234219 | 63.04 |
| 12 | 648.675969 | 69.56 |
| 13 | 623.993769 | 24.68 |
| 14 | 603.114419 | 20.88 |
| 15 | 566.423319 | 36.69 |
| 16 | 516.280769 | 50.14 |
| 17 | 384.399669 | 131.88 |

No rollout items remain. If future work targets consistent 60 FPS with 16 combatants, profile matched, deterministic combat scenes before changing quality or gameplay. The local Vite preview runs at http://127.0.0.1:5174; focused review pages are tests/particles.browser.html, tests/environment.browser.html and tests/rollout.browser.html. The older extensive graphics.browser.html remains available.
