# Weekly performance eligibility check — 23 October 2026

Read-only source inspection completed around 08:58 CEST. No production change or
new performance measurement was made. The user's priority-only selection remains
in force: do not restore embedded heading fonts or permanent loading-strip space.

## Verified repository state

- Read AGENTS.md, the current sections of seo-checkpoint.md, the priority-only
  diagnosis report/checkpoint, and the 20 October package-refresh, existing-post
  refresh and fourth-wave execution checkpoints. No separate seo-current.md
  exists; the current state is in seo-checkpoint.md.
- After the root agent's coordinated fetch, local HEAD and origin/main both
  resolve to 0f715d6, 20 October's IndieDB refresh record. No incoming commits or
  local tracked source changes were found. Unrelated untracked %SystemDrive%/
  remains untouched.
- Compared the diagnosis cleanup revision 8db9d7c with current origin/main.
  Changes are outreach documentation, press media, four press-alias header rules
  and the development-only graphics capture fixture. There are no changes to
  landing HTML, runtime source, styles, fonts, artwork used by the menu, build
  configuration or resource-build implementation. The earlier priority-only
  rollback 14935a1 remains intact.
- Source still has the two original high-priority heading-font preloads before
  the decorative image preload, original body-font preload and swap font faces.
  Production CSS is inlined; the removed embedded-font build injection has not
  returned. Preparation-strip spacing still depends on the strip being visible.
  Engine import still follows window load, font readiness and two animation
  frames through menuReady.
- Press files are excluded from resource copies/offline entries by the existing
  resource builder. Their bytes still participate in release-version hashing;
  an outreach release identity change is not evidence of an LCP implementation
  change or measured performance gain.

## Measurement and causal limits

The latest separately verified homepage lab result remains **2.102 s LCP** from
15 October, with FCP 1.672 s, performance 98, TBT 0 and CLS 0.001. Its
[official receipt](https://pagespeed.web.dev/analysis/https-masterblaster-se/z2ed79n2y1?form_factor=mobile)
is historical, not a measurement of today's deployment. No CrUX field dataset
or reliable sub-two-second result is established.

The diagnosis report's 48 exploratory scored captures and separate probes remain
the relevant evidence. Early artwork requests contribute to simulated LCP;
an intermittent approximately one-second post-font frame gap is unresolved.
Probe timing and Lighthouse's simulated metric must remain separate. Runtime
engine changes or speculative font/blur removals are not supported explanations
for this earlier H1 paint.

## Exact next diagnostic

Obtain a cold mobile navigation trace on priority-only production, preserving its
original visuals, script behavior and request priorities. Record browser version,
viewport/device scale, network and CPU presets, and cache/service-worker state.
Retain the raw trace and request waterfall, not only a score or screenshot.

The capture needs H1/LCP candidate and final paint events, heading/body-font and
background request completion/priorities, frame intervals, main-thread and
compositor activity, loading-strip visibility, and existing shell/menu readiness
marks. Use these to distinguish actual scheduling/paint delay from Lantern's
simulated dependency graph. For attribution of a particular PSI simulation,
retain that report's original raw trace/network graph too; a separate local
trace cannot by itself prove which request caused its simulated LCP.

No raw trace was collected in this weekly audit. Existing records say the PSI
UI did not yield an exported raw trace; today's source inspection does not
establish a new supported export route. Do not restart paused helpers, use
unrelated phone/ADB sessions or bypass browser controls to obtain one.

After trace evidence, the report's responsive-artwork and delayed-analytics
candidates remain controlled experiments requiring visual/attribution review,
fresh paired measurements and separate canonical validation. Neither is an
approved or proven production fix. Keep all genuine fresh slow captures.

## Validation and scope

Git ref/log/diff checks and targeted source reads completed. Two preparatory
reads were imperfect: one requested the nonexistent seo-current.md and a broad
checkpoint read was truncated; the current SEO sections and targeted source
evidence were then read directly. Neither is a passing runtime test.

No browser game was loaded, profiler used, PageSpeed audit repeated, build/test
suite run, dependency installed, purchase made or credit/reset used. No source,
history, process or unrelated file was changed. This report is the only file
written by the performance worker; root handles independent review and the
related documentation commit/push.
