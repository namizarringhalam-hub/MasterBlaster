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
- Initially plan three runs per variant with official PSI Mobile, same reported
  device/network/CPU configuration, alternating variants between rounds.
  Preserve failed/rate-limited runs separately; use medians and ranges.
- After three rounds showed variance, extend every condition to five valid runs
  before starting rounds 4 and 5. No condition received selective extra runs.
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
- Local Edge diagnostic at 390x844: baseline H1 top 118/padding 50 while preparing,
  top 88/padding 20 when ready; combined stays top 118/padding 50. H1 width 366 and
  height 142.453125 unchanged. Combined has no horizontal overflow; portrait,
  landscape844x390 and desktop1440x900 typography inspected in screenshots.
  These are unthrottled desktop observations with shared cache, not mobile scores.
- Interactions are expected: embedded fonts remove the font preloads that the
  priority candidate adjusts, so isolated gains cannot be summed.
- Measurement release 80b60fc pushed. All five public pages verified HTTP 200,
  exact variant markers, noindex and identical release 33fc3886…; scored pages
  have no probe. Windows local source-byte release differs from Linux build;
  compare public variants to each other, not local release hashes.
- First official Mobile round complete: baseline 2852 ms, priority 2707, fonts 2702,
  spacing 2853, combined 2101. Single runs only; second round running in reverse
  initiation order. Raw metrics, exact report links/configuration in
  lcp-experiment-results.json. Five independent remote audits per batch.
- Combined local Quick Play setup opened; START caused the owned tab to stop
  responding before gameplay could be verified. Cause unconfirmed. Closed only
  that tab, recovered PSI controls, no gameplay pass claimed. Existing script
  startup/resource checks pass; repeat a bounded UI smoke test before finalizing.
- Five valid rounds complete (25 reports). Initial round 5 reused underlying
  round 4 captures; excluded all five and replaced with common lcp_sample=5 query.
  Raw results and excluded receipts persisted in lcp-experiment-results.json.
- Medians: baseline 2703 ms, priority 2252, fonts 2702, spacing 2853, combined 2101.
  Combined has fastest observed median, not sub-2 s; small overlapping samples
  cannot establish its extra 151 ms advantage over priority-only. Detailed report
  includes ranges, paired differences, FCP cost and implementation downsides.
- Final combined source prepared: original image priority removed, heading/brand
  subsets embedded at build, original-font fallback retained, spacing stabilized.
  Temporary generator/routes/probe/test removed from final build. Dev-only
  subset regeneration helper retained; no runtime dependency added.
- Build/hosting, matchStartup, resourcePreparation, playerText and font outline/
  metrics/shaping/reproducibility pass. Independent UI comparison: baseline and
  combined menus/settings/setup work; both one-bot matches stay on same loader
  45–60s. No variant-specific regression and no full gameplay pass established.
  Original 7 bots restored, High/75% unchanged, owned tabs closed.
- Independent final source review found no code blocker; arithmetic was checked
  against all 25 reports. Preserve the uncertainty, FCP cost and smoke-test limit.
- Combined implementation ff58c1b committed/pushed. Canonical HTML verified:
  two embedded heading faces, one body-font preload, stable spacing and no noindex.
- Removed experiment assets still returned cached noindex copies (Age 987 s,
  shared max-age 604800); a fresh query returned 404. Add explicit retirement
  redirects for all ten scored/diagnostic URLs. Full rebuild/hosting check passes;
  running hosting alone before rebuild correctly rejected stale release identity.
- Next: deploy retirement redirects, verify live behavior and complete three
  fresh canonical PSI captures (exclude any repeated underlying captures).
- Preserve unrelated untracked %SystemDrive%/ and all other work.
