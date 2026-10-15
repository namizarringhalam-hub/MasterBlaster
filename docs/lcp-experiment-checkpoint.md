# LCP controlled experiments

Started 15 October 2026. User authorized independent tests of each candidate and
the combined result, including implementation downsides. Baseline: 9f4eb45.

## Plan and controls

- Build baseline, priority-only, heading-font-only, spacing-only and combined
  variants from the same production HTML/assets/release on masterblaster.se.
- Keep the normal homepage unchanged while testing. Temporary experiment pages
  have noindex and canonical homepage references; remove them after measurement.
- Use separate diagnostic copies with the same probe to record actual LCP
  candidates, font/resource timing and progress-strip geometry. Scored pages
  contain no probe. Browser tabs stay muted. Desktop observations are not mobile
  lab measurements; record actual cache/timing limitations.
- Measure each variant three times with official PSI Mobile, same reported
  device/network/CPU configuration, alternating variants between rounds.
  Preserve failed/rate-limited runs separately; use medians and ranges.
- Independently validate glyphs/metrics, menu screenshots at desktop/portrait/
  landscape, Quick Play startup, relevant checks and production build.
- Deploy only validated final changes, then measure the canonical homepage.
  Do not infer causal savings by comparing unrelated older reports.

## Candidates

1. Prioritize the existing heading-font preloads; stop explicitly prioritizing
   the decorative background. Same visual assets and typography.
2. Embed tiny exact-heading glyph subsets of the same normal/italic typefaces;
   retain complete fonts as fallback for other text or future glyphs.
3. Reserve loading-strip spacing so completing preparation does not change
   the headline's position. Document any persistent spacing/scroll tradeoff.

## Current state

- Source audits confirm initial HTML H1, inlined CSS, font swap/preloads and
  deferred engine import. No established bottleneck yet. Current live report
  15 Oct 09:12:05: LCP 2.9 s, performance 92, SEO 100; not the controlled baseline.
- Font subsets retain original outlines, advances, hints, vertical metrics,
  copyright/license and HarfBuzz shaping/kerning. Two embedded faces total
  10,596 bytes; inline CSS 15,066 bytes raw / 10,835 Brotli. Full Barlow remains
  available for other text/future glyphs; normal 900 may still be used by buttons.
- Build/hosting, experiment-isolation, match-startup and resource-preparation
  checks pass. Independent review corrected spacing selector specificity and
  diagnostic variant identity. Probe is excluded from scored copies.
- Local Edge diagnostic at 390x844: baseline H1 top118/padding50 while preparing,
  top88/padding20 when ready; combined stays top118/padding50. H1 width366 and
  height142.453125 unchanged. Combined has no horizontal overflow; portrait,
  landscape844x390 and desktop1440x900 typography inspected in screenshots.
  These are unthrottled desktop observations with shared cache, not mobile scores.
- Interactions are expected: embedded fonts remove the font preloads that the
  priority candidate adjusts, so isolated gains cannot be summed.
- Next: deploy temporary same-build pages, verify public variant/release identity,
  perform three alternating official PSI Mobile rounds and record exact reports.
- Preserve unrelated untracked %SystemDrive%/ and all other work.
