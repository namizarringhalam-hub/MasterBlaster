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
