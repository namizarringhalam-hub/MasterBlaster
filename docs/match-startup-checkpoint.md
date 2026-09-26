# Match startup and replay

Request: retain loaded assets between games and prevent the countdown running during first-frame stalls.

Confirmed causes: every local launch/rematch reloaded the page; countdown audio began before the selected render pipeline's first frame. The renderer, decoded audio and module-level geometry/material texture caches were discarded on every launch.

Implementation: in-memory queued launches with duplicate/cancel guards; retain existing match teardown; gate simulation and countdown until the first WebGPU submission completes and the next browser frame renders. WebGL uses its synchronous render and the next browser frame. Stale completions cannot unlock replacement arenas. Legacy reload-ticket recovery remains compatible. Existing direct-start browser fixtures updated.

Validation so far: startup regression, pause and smoke tests pass. Native WebGPU browser fixture passed the first game plus ten replays: zero errors/early countdowns; every match retained its full 1800 seconds at readiness, renderer/audio/pipeline identity unchanged, 53 textures and 227 geometries throughout. Cold startup 22.427 s, first replay 9.699 s, subsequent replays 2.179–2.470 s in the in-app browser (development build, inherited graphics settings; not a universal hardware benchmark). A later small correction preserves audio pause if the tab lost focus during loading; covered by the startup regression. WebGL check, full suite/build and commit/push remain outstanding.

Final validation: all 28 Node checks and 19 Worker tests passed; production build and hosting budgets passed. Worker tooling emitted sandbox log/static-analysis warnings but executed all 19 tests successfully. GPU slow-frame, cancelled launch/completion, failure, WebGL synchronous fallback and audio-pause behavior have executable regression coverage.

WebGL live check remains **unverified**: the test tab stopped answering DOM/CDP reads after starting, for roughly two minutes. The dev server continued returning HTTP 200 and the tab's captured error/warning log was empty. No cause was established. Closed only that owned test tab; did not restart or kill shared browser processes, repeat the run or count it as a pass. Native browser run above completed all eleven samples.

Implementation and validation complete within that limitation. Publish only the request's source, tests and documentation to origin/main. The first visit still builds the arena and shaders behind the loader; later matches reuse the renderer, post-processing pipeline, decoded audio and module caches while reconstructing mutable match state.
