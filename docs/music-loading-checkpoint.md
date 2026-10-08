# Music during match loading — 2026-10-08

Request: music playback lags while loading a match.

Confirmed cause: the main-thread scheduler queues only 120 ms ahead. A simulated 2.5 s loading stall produces 13 overdue launch-menu notes, which the sample player clamps to one timestamp. Graphics preparation and synchronous teardown share that thread.

Implementation: `src/audio.js` prepares one eight-bar recorded menu loop with OfflineAudioContext, reusing existing instrument graphs and retaining the second cycle's note tails. `src/main.js` activates its native looping source through the shared loading overlay. It occupies one music voice, uses existing mix controls, and retires at countdown/combat or cancellation. Normal adaptive playback stays outside loading; overdue live steps are skipped instead of bursting. Tests cover loading, cancellation, timing and disposal.

Files: src/audio.js, src/main.js, tests/musicLoading.test.mjs, tests/musicLoading.browser.html, tests/matchStartup.test.mjs, tests/audioQuality.test.mjs, scripts/test.mjs, tests/testRunner.test.mjs, this checkpoint. Preserve unrelated untracked `%SystemDrive%/` directory.

Verified: all 39 Node checks and 20 Worker tests pass; production build and hosting check pass. Focused audio/loading/startup checks also pass after the final hidden-tab pause repair. Regressions cover native playback through a 45 s clock stall, overdue-step skipping, cancellation, cache reuse, pause/resume, audio disable/disposal and exactly 32 countdown steps. Independent review corrected timer creation and paused-loading resumption; foreground local, restart and server paths all use the shared loading hook. Home-menu graphics preparation is outside this request.

Muted browser evidence: a real Edge AudioWorklet recorded sound during a five-second synchronous stall. Baseline: 3,528 ms of continuous silence; native loading: maximum quiet interval 133 ms, within the score's normal note gaps, with 5.024 audible seconds across 5.309 recorded seconds. Preparation took 4.354 s (including the full audio bank); the cached loop is 16.271 s / 6,248,136 bytes. These are one-run measurements, not universal load-time claims. JSON: `.codex-spec-render/music-loading/browser-result.json`; logs: `.codex-music-loading-{tests,build,browser}.log`. The browser remained muted using --mute-audio. No full rendered match/GPU journey is claimed by this audio-specific fixture.

Implementation and validation complete. No known blockers or unfinished code work. Request-only fix `1831cf3` was pushed successfully to origin/main. Deployment remains masterblaster.se through Cloudflare Pages; live deployment has not been checked in this request.
