# Priority-only LCP diagnosis — 15 October 2026

User request: retain priority change, revert embedded heading fonts and reserved
loading-strip spacing, then identify the real barrier to reliable LCP below 2 s.
Historical experiment receipts remain in lcp-experiment-report.md/results.json.

## Current state

- Starting revision 71151eb. Preserve unrelated untracked %SystemDrive%/.
- Restore original normal/italic heading preloads ahead of decorative background,
  with high priority. Background retains no explicit high hint; body font remains.
- Remove embedded faces/build injection/dev subset helper. Restore original
  hidden-progress spacing selector. Retain historical results and retirement URLs.
- Next: validate/review/push priority-only rollback; verify live HTML. Collect
  LCP candidate, font/resource/paint/layout and startup evidence. Do not infer
  causality from source or mix actual trace timings with Lighthouse simulation.
- Separate reviewer checks rollback/diagnosis; startup agent audits call order.
  Browser tabs remain muted; no personal/creator information is used.
- Rollback build/hosting checks and independent source review pass. Commit/push
  this milestone before diagnostic work. For any candidate claimed to reach the
  target, require five fresh matched Mobile captures all below 2 s, then separate
  canonical validation. Keep failed/slow fresh runs; exclude only proven reuse.
- Rollback 14935a1 committed/pushed; live HTML verifies original three font
  preloads, two high heading hints, no embedded faces and conditional spacing.
  Live release 06626fefc7f1456d80a6092887ca8bdb9dc584b1e918fcc86c241eb1a4877854.
- Official PSI API returned 429 once; no retry. Visible UI audit 13:13 CEST:
  https://pagespeed.web.dev/analysis/https-masterblaster-se/z2ed79n2y1?form_factor=mobile
  LCP 2102 ms, FCP 1672, performance 98, TBT 0, CLS .001. Same Moto G Power /
  Lighthouse 13.5.0 / Chromium 153.0.8010.36 / Slow 4G configuration; no CrUX.
- This audit's actual H1 render-delay insight is 370 ms; boot execution mark
  331.50, menu-ready 408.84. Engine/preparation cannot cause this earlier paint.
  Do not subtract actual 370 from simulated 2102. Critical tree includes HTML
  138 ms / 16.16 KiB, Inter 700 ending 327 ms / 21.68 KiB and boot 328 ms.
  These observed timings justify testing discovery priority and compositor
  counterfactuals, not a production conclusion yet.
- Preparing isolated noindex priority, shell-only, no-blur, paused-decoration
  and extra body-font-preload copies. Probe only separate diagnostic copies;
  all scored pages remain probe-free. Shell-only is an exclusion test, never
  a game implementation or successful gameplay candidate.
- Harness now has six arms, including removal of explicit Umami only. Build,
  isolation/probe tests and independent review pass after charset placement,
  demanded-font readiness and no-store worker/header corrections. Plan three
  exploratory matched rounds per arm; then five fresh matched runs for any
  promising candidate before claiming repeated success. Shell removes the whole
  bootstrap, not just the engine, and is never a production candidate.
- Phase 1 complete: 18 fresh exploratory reports, exact receipts/metrics in
  lcp-priority-diagnosis-results.json. Medians (ms): priority 2253, shell 2101,
  no-blur 2252, still 2102 (range 2101–2629), body preload 2102, no analytics
  2062 (2035–2072). Blur differences were +1,+3,-1 ms in matched rounds: no
  demonstrated saving. Body preload FCP median 1841 versus priority 1672.
  No arm reliably clears 2 s; do not publish cosmetic/functional removals.
- Remote probe receipt 9mchsubhw8 shows actual demanded-fonts-ready 178 ms,
  H1 candidate 252, engine-ready 3375.30; separate probe-only observations,
  not scored comparisons. Local warm 390x844 probe retains H1 node 1 across
  engine hydration; fonts 128.2, paint 224, engine 1612.1. No cold-mobile claim.
- Phase 2 tests request scheduling with identical visuals/functionality:
  priority baseline, explicit low image hint, image CSS-discovery only,
  async analytics and low boot-module fetch hint. Three exploratory matched
  rounds planned, common new query per round. Keep data separate from phase 1.
- Phase 2 harness/build/hosting and independent isolation review pass. Original
  six transforms are byte-identical. Resource observer exposes bounded font/image
  completion measures only on diagnostic copies. Canonical remains priority-only.
- Phase 2 complete: 15 fresh reports saved. Priority median 2253 ms, image-low
  2101 (two ties/one win), CSS-only image discovery 2701 (worse two rounds),
  async analytics 2253 (mixed), boot-low 2402 (worse every round). No candidate
  reliably below 2 s; no extra priority/script/visual change justified.
- Pinned public Lighthouse 13.5.0 uses trace_engine 0.0.65. Its LCP simulation
  includes a broader pre-paint request graph than FCP, including eligible
  noncritical requests in the pessimistic estimate. This explains a mechanism
  for divergent simulated FCP/LCP, not proof of the exact responsible request.
  Sources/limits recorded in JSON; do not cite current DevTools main as identical.
- Final exploratory exclusion: three rounds of priority, no-art (image CSS off
  and no preload), unused-art (same CSS off, preload retained). H1/typography
  unchanged, both black-background arms diagnostic-only. Need verify resource
  completion relative to H1 paint before attributing network versus rendering.
  Twelve-arm tests/build and independent source review pass; prior ten arms
  byte-identical. Canonical stays priority-only.
- Phase 3 complete: nine fresh reports. Priority median 2254 ms, no-art 2102
  (range 1655–2104), unused-art 2253. With background hidden identically, removing
  its initial request is faster than retaining it by 523/372/151 ms. Request or
  resource-processing contribution supported; not a proven network-only number.
  No-art still fails target two of three times. Remote probe verifies no document
  image completion before H1 on no-art, versus image 227 ms before H1 1344 on
  unused-art. Later service-worker image downloads are separate.
- Final font exclusion: priority versus body-fallback, three fresh matched rounds.
  Remove only external Inter faces/body preload, retain exact original Barlow
  heading and metric-adjusted local fallback. Diagnostic-only body glyph change;
  verify headline geometry and request absence before interpretation. No intent
  to ship a different body typeface. Extra finite frame/visibility/LoAF probes
  help distinguish frame scheduling from a font or app delay; no source cause
  will be inferred from a probe-induced or uncorrelated gap.
