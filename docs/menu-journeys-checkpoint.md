# Menu journeys checkpoint

Request: record game screens as Umami journey pageviews without reloading or changing asset preparation.

Implementation: passive History API replaceState paths; retain query/hash/history state and Back behavior, suppress same-path updates. Explicit Umami pageviews capture every screen; auto-pageviews disabled. Queue early views until tracker loads, retain previous screen referrers; analytics failures cannot interrupt gameplay. Track menu modes, settings/credits, private/global lobbies, loading, actual first visible gameplay frame, pause/help/graphics/results/errors. Dialog close restores its parent path. Service worker shell fallback covers refreshed journey paths offline. Paths contain no player/room identifiers. Refresh retains the existing home/pending-match recovery behavior rather than attempting to recreate a match from a path.

Changed: index.html, src/boot.js, src/journeys.js, src/main.js, src/globalMultiplayer.js, public/sw.js; tests/journeys.test.mjs plus startup/pause/setup/cache regressions and test runner registration. tests/smoke.mjs corrects a pre-existing stale regex to require the existing no-cache navigation fetch; no change to revalidation behavior.

Evidence: official Umami SPA guide confirms automatic pageviews for replaceState. Inspecting https://cloud.umami.is/script.js exposed its 300 ms timer reading the latest URL, which can skip fast loaders. Explicit pageviews with data-auto-pageview="false" avoid that delay/duplication. https://docs.umami.is/docs/tracker-configuration

Validation complete: all 34 test-runner checks passed (first 20 via npm test; remaining checks resumed from performance after adding its journey stub), including 20 Vitest worker cases. Additional final journey/startup/pause assertions passed after edits. Final production build and hosting checks passed. Logs: .codex-menu-journeys-tests.log and .codex-menu-journeys-remaining-tests.log (ignored). Existing build warnings remain: large chunks and content-addressed background URL resolution at runtime.

Browser verified / -> /settings -> / -> /credits -> / -> /quick-play -> /loading -> /game -> /pause -> /controls -> /pause -> /game -> /pause -> /. Final rebuilt menu also verified. Live cloud.umami.is/script.js executed in an isolated sandbox with network sends mocked: exactly four ordered pageview payloads for /, /quick-play, /loading, /game; correct previous-screen referrers and no automatic duplicates. Initial views wait for tracker readiness; analytics delivery is serialized independently of menu/assets, and failures are contained. Live Umami dashboard ingestion was not inspected.

Self-review: paused-during-loading resumes /game after the first frame; failed/timed-out lobby launches restore the prior path; stale dialogs cannot replace current paths. No unresolved findings or implementation blockers. Browser discovery timed out once; reconnect succeeded; no cause was inferred.

Status: implementation and verification complete. Publish this checkpoint with the request changes to origin/main; no further code work remains.
