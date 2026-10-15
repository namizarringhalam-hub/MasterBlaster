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
