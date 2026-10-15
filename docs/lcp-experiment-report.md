# Master Blaster LCP experiment report

15 October 2026. Five valid official PSI Mobile audits per condition, 25 total,
on the same deployed game release. The diagnostic trace is separate from scores.

## Independent and combined results

| Condition | Median LCP | Range | Difference from baseline median | Median performance |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 2.703 s | 2.701–2.852 s | — | 95 |
| Font/background priority only | 2.252 s | 2.101–2.707 s | −0.451 s (16.7%) | 97 |
| Embedded heading fonts only | 2.702 s | 2.701–2.854 s | −0.001 s (no meaningful difference) | 95 |
| Stable preparation spacing only | 2.853 s | 2.701–2.854 s | +0.150 s (slower) | 95 |
| All three combined | 2.101 s | 2.101–2.706 s | −0.602 s (22.3%) | 98 |

The combined version had the lowest observed median, but did not achieve an LCP
below two seconds in any valid run. Its range overlaps priority-only; the extra
151 ms median difference is not proof that adding font embedding and spacing
reliably improves priority-only. The individual changes' effects cannot be added.

Within corresponding rounds, priority-only beat baseline in all five runs
(145–603 ms faster). Combined beat baseline in four of five (751 ms faster to
3 ms slower), but beat priority-only in only two, tied one and lost two.
These pairs describe the observed batches; they do not establish statistical
significance. The font and spacing candidates did not show standalone LCP gains.

Median FCP was 1.678 s baseline, 1.676 s priority-only and 1.806 s combined.
Thus the combined version's first contentful paint was about 0.128 s later than
baseline, despite its lower median LCP. Valid-run CLS was 0–0.001.

## Implementation and downsides

- **Priority:** stop explicitly prioritizing the decorative background. With
  external heading fonts, prioritize their preloads before that image. The
  artwork may finish later on a slow first visit; browser priorities are hints.
- **Fonts:** embed only the exact current headline/brand glyphs of the original
  normal/italic Barlow faces. Retain full-font fallbacks for other/future glyphs.
  Outlines, metrics, hinting, kerning and shaping match. Two subsets total
  10,596 bytes; their inline CSS adds 15,066 raw bytes, about 10,835 Brotli bytes,
  to HTML. Embedded bytes are repeated with HTML rather than independently cached.
  Other UI text can still request the complete normal font. Future headline edits
  need regeneration to retain the same optimized coverage; fallback remains safe.
- **Spacing:** preserve the preparation strip's normal spacing after it hides.
  At 390×844, the heading stays at y118 instead of jumping to y88. This reserves
  30 extra pixels after readiness; short landscape layouts reserve 38 extra.
  It can reduce visible content on small screens. Error/retry spacing may still
  change intentionally. This is a geometry benefit, not a demonstrated LCP gain.
- **Combined interaction:** embedded fonts remove the very preloads adjusted by
  priority-only. In the combined build, that part of the priority change is
  background demotion; the two variants are not additive optimizations.

## Controls, checks and limits

- Measurement release: commit 80b60fc, public resource version
  33fc3886834c6967c553ef921482225e8fb83125f833ae311eab4abffef5b1c8.
  All five online pages returned their correct variant marker and same release;
  temporary pages were noindex/canonical-home and absent from the sitemap.
- Emulated Moto G Power, Lighthouse 13.5.0, Headless Chromium 153.0.8010.36, Slow 4G,
  initial single-page load. No CrUX/real-device or field performance claim.
- Five remote audits per batch; initiation order varied by round. Identical
  instrumentation-free built pages differ only by the selected candidate.
  After the initial three rounds showed variance, the run count was extended
  equally to five for every condition before rounds 4 and 5 began.
  Five reused fifth-round reports were excluded because their underlying capture
  minute/metrics repeated round 4. Replacements used the same lcp_sample=5 query
  across every condition and show new 12:26 captures. No valid result discarded.
- Local desktop diagnostics at mobile width are unthrottled/shared-cache evidence,
  not score comparisons. They confirm font geometry and spacing behavior.
- Build/hosting, matchStartup, resourcePreparation and playerText checks pass.
  Independent review corrected a specificity bug before any scored deployment.
  Glyph/metric/HarfBuzz shaping validation and byte-for-byte regeneration pass.
- Menus, Settings and setup worked in baseline and combined. Full gameplay smoke
  remains inconclusive: both one-bot High/75% launches stayed in the same loader
  for roughly 45–60 seconds, with responsive accessibility/screenshots and no
  captured console errors. No variant-specific regression established; no full
  gameplay pass claimed. Original bot count restored; graphics untouched.

## Production validation

The combined version is selected for canonical-homepage validation because it
had the fastest observed median. Temporary routes/probes are removed from the
final build. Production report receipts and results will be recorded here after
deployment; they are validation, not additional independent variant-effect runs.

All 25 raw measurements, report links and the five excluded receipts are in
[lcp-experiment-results.json](lcp-experiment-results.json). The measurement harness
is recoverable from commit 80b60fc; generated diagnostic artifacts remain ignored.
