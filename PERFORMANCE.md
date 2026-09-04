# Output-preserving performance validation — 2026-09-05

Scope: caching, load-time work, and redundant frame work. No weapon, gameplay
rule, audio recording, texture, quality setting, or effect capacity was removed.
The multiplayer Worker and protocol are unchanged.

## Implemented

- A separate content-hashed Three.js chunk keeps 254.08 kB gzip reusable across
  gameplay-only builds. Boot stays deferred; total cold JavaScript transfer is
  essentially unchanged, not smaller. The application chunk is 100.92 kB gzip.
- Service-worker cache hits avoid both downloads and disk rewrites. Concurrent
  normal preloads and force-cache consumers share a request. Explicit repair
  modes bypass the cache, storage failures fail open, and HTML/error responses
  cannot poison immutable script/audio entries. HTML remains network-managed.
- Music prefetch and decode share downloaded bytes for all 23 original takes,
  releasing those bytes after decode. Existing adaptive score, round robins,
  sample rates, dynamic range, voice limits, and convolution remain intact.
- Worker-generated PCM becomes a native AudioBuffer only on first use, then is
  reused. A regression verifies bit-identical samples and one copy per sound.
- Spatial wall-occlusion queries run when an actual remote sound is mixed.
  Inactive fighter/loop updates need none; all 112 simulated projectiles still
  animate while only the nearest six request flight-loop spatial data.
- Fireball uploads contain the active instance prefix, retaining all seven
  layers and the full 4096 capacity. For 16 Fireballs, matrix/color uploads fall
  from 2,179,072 to 8,512 bytes/frame (99.61%); this is not a whole-game FPS claim.
- Collapsing structures update each final transform once instead of twice.
  Replaying the removed extra pass produces identical instance matrices.
- Unchanged weapon-selection accessibility attributes are not rewritten every
  frame; changing slots still updates selection immediately.

## Automated and live checks

- `npm test`: complete suite passes, including 13 Worker tests, all 47 weapon
  identities, audio lifecycle/mix, sixteen-fighter stress, server authority,
  multiplayer client recovery, cache fault cases, and output-equivalence tests.
- `npm run build`: passes, including generated hosting/MIME/cache-header checks.
  The advisory about the renderer chunk exceeding 500 kB remains visible.
- `npm run check:multiplayer`: protocol tests and Worker dry run pass.
- Local `npm run test:multiplayer-live`: quick recovery, resume, coalesced state,
  and persistent private-lobby lifecycle pass.
- High, 1280×720, 16 fighters: 66-second startup-inclusive sample, 59 current /
  56.7 average FPS, 31 textures, no console warnings/errors. Baseline average was
  55.1 FPS; these stochastic runs do not establish a percentage FPS improvement.
- Low, 1280×720, 16 fighters: 83.2 seconds, 60 current / 57.9 average FPS,
  15 textures, no console warnings/errors or document overflow.
- Medium at 820×1180 and 390×844: 16 fighters, authored bloom profile, no
  document overflow or overlapping principal HUD panels. Canvas CSS bounds and
  backing dimensions match the viewport at DPR 1. Immediate slot-two selection
  leaves exactly one selected/aria-pressed weapon with correct ammunition.

## Reproducible live cache interruption

After building, run `node tests/assetCacheLiveServer.mjs`. An optional
`CACHE_TEST_PORT=0` selects a fresh loopback origin. This test-only server serves
the actual generated hosting Worker, reports service-worker/native AudioContext
state in a visible overlay, and disables ordinary HTTP caching. It is not part
of the deployed artifact.

1. Open the reported URL and enter Training to unlock recorded audio.
2. Start a match, allowing the now-controlling service worker to warm boot assets
   that originally loaded before its installation. Type `stats` in the server.
3. Type `deny` to reset counters and return 503 for every `/assets/` and `/audio/`
   origin request. Use Pause → Restart Match and inspect `stats` again.

Observed: the clean origin loaded all 23 versioned WAVs, the boot/application/
renderer chunks, both worker scripts and CSS. After denial, the programmatic
restart reached a live sixteen-fighter match at 60 FPS with a running native
AudioContext, five weapons, advancing timer, and no console errors. Only `/`,
the menu image, favicon and service-worker update were requested at the origin;
asset/audio origin requests and denied requests were both zero.

## Limits and deferred work

Independent release reviews: Ramanujan **96/100 PASS**, Bohr **95/100 PASS**,
Ohm **96/100 PASS**. Ramanujan's initial 93/100 mixed-cache-mode blocker was
fixed and the live cache-interruption evidence completed before re-review.
No release blockers remain in the reviewed optimization scope.

Viewport checks are desktop-browser responsive tests, not measurements on
physical phones/tablets or a cellular network. Background browser screenshot
scaling initially produced misleading crops; visible captures and matching
DOM/canvas/DPR measurements resolved this capture artifact.

The independent critics could run source/tests and inspect saved screenshots,
but their browser registries were unavailable. Root executed their requested
live checks and supplied raw evidence. No claim of universal 60 FPS, lower cold
download size, or end-to-end load-time percentage improvement is made.

Persistent caching of the 26.65 MiB generated PCM bank, shared fighter geometry,
raycast topology caching, and extra structural indexing are deferred pending
their own memory/ownership/invalidation measurements. No risky cache or quality
tradeoff was added merely to increase the number of optimizations.
