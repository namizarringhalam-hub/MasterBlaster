# Priority-only LCP diagnosis — 15 October 2026

The requested rollback is complete: commit 14935a1 keeps the heading-font/background priority change, removes embedded heading subsets and restores conditional preparation-strip spacing. The canonical game remained priority-only throughout this investigation. No extra diagnostic exclusion is a production change.

## Result

Forty-eight fresh, probe-free official PageSpeed Mobile audits across four exploratory phases narrowed the problem but did not establish a reliable sub-2-second configuration. Priority controls were generally 2.10–2.27 seconds. A separate live-homepage rollback validation returned 2.102 seconds, FCP 1.672 seconds, performance 98, TBT 0 and CLS 0.001 ([receipt](https://pagespeed.web.dev/analysis/https-masterblaster-se/z2ed79n2y1?form_factor=mobile)). This is a lab result; there is no CrUX field dataset.

A demonstrated contributor to these simulated results is **the cost associated with early resource requests in the mobile loading graph**, particularly the decorative background request. The exact remaining production cause of every slow paint is not established. There is also an intermittent approximately one-second frame gap after fonts complete in separate diagnostic captures, whose origin remains unresolved. It would be inaccurate to promise that deleting one font, effect or script fixes that gap.

## Controlled evidence

Each row below compares three exploratory matched rounds within its own deployed release. Medians must not be subtracted across phases as if all conditions were identical. Every fresh scored run is retained; these small samples are not statistical proof of reliability. Exact URLs, timestamps, metrics, configurations and source references are in [the results JSON](lcp-priority-diagnosis-results.json).

| Phase | Condition | LCP in each round (ms) | Median (ms) | Interpretation |
| --- | --- | --- | ---: | --- |
| 1 | Priority control | 2253,2101,2253 | 2253 | Reference |
| 1 | Remove entire boot module | 1952,2101,2101 | 2101 | Still two misses; dead controls, diagnostic only |
| 1 | Remove backdrop blur | 2254,2104,2252 | 2252 | Differences +1,+3,-1 ms; no benefit demonstrated |
| 1 | Pause decorative animation | 2629,2102,2101 | 2102 | Inconsistent; first run TBT 193 ms |
| 1 | Preload Inter 700 | 2102,1951,2253 | 2102 | FCP median 1841 versus control 1672 ms; tradeoff |
| 1 | Remove explicit analytics | 2062,2072,2035 | 2062 | Faster all three, none under 2 s; analytics loss |
| 2 | Priority control | 2253,2101,2254 | 2253 | Reference |
| 2 | Low image fetch priority | 2253,2101,2101 | 2101 | Two ties, one win; no repeatable target pass |
| 2 | Remove image preload, retain CSS image | 3002,2701,2252 | 2701 | Discovery delay worsens two runs |
| 2 | Async analytics | 2101,2253,2254 | 2253 | Mixed; no median benefit |
| 2 | Low boot-module priority | 2554,2401,2402 | 2402 | Worse every round |
| 3 | Priority control | 2101,2255,2254 | 2254 | Reference |
| 3 | Hide artwork and remove initial image request | 2104,1655,2102 | 2102 | Two misses; visual removal diagnostic only |
| 3 | Hide artwork but retain image preload | 2627,2027,2253 | 2253 | Loses to request removal all three rounds |
| 4 | Priority control | 2254,2269,2254 | 2254 | Reference |
| 4 | Remove external body-font faces/preload | 2205,1832,2194 | 2194 | Faster 49/437/60 ms, still two misses; changed body glyphs |

The strongest background comparison hides the same artwork in both pages. Retaining its initial request is slower by 523, 372 and 151 ms. This supports a request/scheduling/resource-processing contribution to Lighthouse's simulated metric, rather than a benefit from removing the visible blur. An unused preload may be scheduled differently from a CSS-used resource; these are not measured network-only savings or a guaranteed production gain.

The original image is 126,604 bytes; the two headline fonts total 41,800 bytes. Body Inter 400/700 Latin faces add 20,728/21,432 bytes. The boot module is only about 7.76 KB raw/3.19 KB gzip. The initial HTML is roughly 16.16 KiB transferred in the inspected report. This focuses attention on initial delivery rather than deferred engine chunk size.

## What the source and timing captures establish

- The initial HTML already contains the headline and menu. Hydration preserves the H1 node. No animated 3D arena exists behind the initial menu; the engine/Three imports happen after menu readiness and release preparation.
- LCP is the headline text. In the final remote priority probe it paints at 256 ms, with fonts complete at 223 ms; engine-ready is 3301.35 ms. Optimizing that later engine work cannot explain this particular initial paint.
- Body-font removal preserves the original Barlow font declarations and both headline downloads. Remote H1 rectangles match exactly: x 12, y 118, width 388, height 150.52; the same H1 node remains. The body typeface can differ and is not approved as a production visual change.
- In the separate body-fallback probe, the heading font downloads end at 99.8/101.6 ms and demanded-font readiness is observed at 228.7 ms, yet RAF jumps from 192.2 to 1208.8 ms and H1 paints at 1272 ms. The document reports visible/focused. A long-animation-frame entry starts 220.7 ms, lasts 992.7 ms, and reports blockingDuration 0. This does not identify a JavaScript, font, compositor, browser-environment or probe cause. Removing body-font downloads did not eliminate it.
- Geometry reads in the diagnostic probe can force layout. Probe captures establish ordering, not comparable performance scores. No probe ships on scored pages or final production.
- Lighthouse 13.5.0 publicly pins trace_engine 0.0.65. Its Lantern LCP model uses broader eligible pre-paint request graphs than FCP and averages optimistic/pessimistic estimates. Actual paint timings in the insight/probe are therefore not interchangeable with the simulated Slow 4G headline metric. Do not subtract the actual 250 ms render delay from simulated 2105 ms to claim a saving. [Lighthouse throttling method](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md); pinned algorithm URLs are recorded in the JSON. The original raw trace/network graph is needed to identify the exact simulated dependency responsible for a particular run.

## Next engineering step

1. Capture a cold mobile performance trace with original request priorities, font completion, paint events, main-thread and compositor activity. Inspect the unexplained pre-paint frame gap independently of Lantern's simulated graph. The current supported PSI UI exposes insights and timing tables, but no exported raw trace was obtained; a trace-level causal attribution remains unfinished.
2. Test a smaller responsive artwork resource while keeping the same composition. Size for portrait cover-cropping and device pixel ratio; do not blindly reduce width and blur the background. Compare visuals and fresh paired runs before deploying. The request-removal controls justify this focus but do not establish expected savings.
3. Test analytics loading after first presentation as a separate candidate while retaining the queued initial pageview. Existing journey logic attaches to the present script's load event, so dynamic injection needs an explicit queue flush. Async alone was already inconclusive. Delayed analytics may miss short visits and must be evaluated against attribution needs.

Do not remove blur/animation, change body typography, delete analytics or disable boot as a purported proven fix. No new candidate demonstrated reliable sub-2-second LCP; do not combine exploratory deltas or declare the target achieved.

## Validation and production cleanup

Rollback and every diagnostic generation phase passed isolation tests, normal build/hosting checks and independent review. Forty-eight scored audits were fresh; a report briefly lacking loaded metrics was re-read when complete rather than counted as failure or discarded. Measurements used emulated Moto G Power, Lighthouse 13.5.0, Headless Chromium 153.0.8010.36, Slow 4G, initial single-page sessions. Small repeated lab samples do not establish real-user percentiles.

Temporary generators/probes/tests and temporary cache/header branches are removed. All 26 diagnosis URLs retire through exact 301s to the canonical homepage, retaining queries; earlier experiment retirements remain. Build/hosting checks verify retirement, no generated diagnosis directory and priority-only canonical HTML. No gameplay/runtime source was changed by this investigation. Earlier full-gameplay smoke remained inconclusive in both baseline and combined releases; no new full-gameplay pass is claimed.

Cleanup e018146 was pushed and verified live at 13:48 CEST: all 26 original diagnosis paths return 301 to home with query preservation; canonical HTML returns 200/indexable with three original font preloads, two high heading preloads before the image, no embedded fonts/probe and original conditional spacing. Startup, resourcePreparation and playerText checks also pass. The task-owned local server is stopped.
