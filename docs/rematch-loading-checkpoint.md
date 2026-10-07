# Rematch loading visibility — 2026-10-08

Request: rematch after results appears hung for 5–10 seconds before loading is visible.

Confirmed cause: results and pause use native modal dialogs in the browser top layer. The fixed loading overlay was shown underneath them. Those dialogs survived teardown and arena preparation until renderHud replaced the UI.

Fix: setMatchLoading(true) switches journey to /loading, then closes/removes open UI dialogs using existing focus cleanup. Closing afterward preserves /loading. frame skips queued launches so the old arena does not delay the double-requestAnimationFrame loader paint. Shared loading handles rematch, pause restart and server-driven starts.

Request files: src/main.js (loading/frame hunks only), tests/matchStartup.test.mjs, tests/matchStartup.browser.html, tests/smoke.mjs, this checkpoint. Preserve simultaneous camera/explosion work and all unrelated files; selectively stage main.js.

Validation: executable controller tests pass for synchronous results/pause/nested-dialog dismissal, loader visibility flag, journey preservation, queued-frame exclusion, duplicate/cancelled launch handling, existing first-frame GPU/countdown gating and errors. The new results-dialog check fails against pre-fix HEAD as expected. Independent review found no blockers; startup, pause and resource preparation checks pass. Production build/hosting and browser-fixture syntax checks pass. Shared-checkout suite passed 34 checks before stopping in combatAuthority while unrelated explosion source/tests were changing.

Isolated validation complete: all 38 Node checks and 20 Worker tests pass (54.96 s); production build/hosting passes (2.83 s). Snapshot: C:/Users/namir/AppData/Local/Temp/master-blaster-rematch-validation-6bee5a1d-12d4-41e1-91a1-fd69a34ed042/snapshot, baseline 399818a8e3fe191271c370836c1bc79174f43a17 plus only rematch edits. Archive main.js line endings were normalized to LF for existing source-extraction tests. Logs/results.json live in the snapshot's parent directory. No working-copy explosion/armory changes are included; smoke and main require selective staging.

Browser limitation: initial inventory timed out; isolated blank IAB tab worked. Its documented capabilities do not expose audio muting, so no game content was loaded and no live GPU replay pass is claimed. Browser fixture now also checks top-layer dismissal and loader hit testing before arena preparation.

Next: review selective staged diff, commit/push origin/main and verify published source. Deployment remains masterblaster.se via Cloudflare Pages.
