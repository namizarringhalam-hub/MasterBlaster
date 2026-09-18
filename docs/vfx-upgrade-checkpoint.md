# Effects upgrade — 2026-09-18

- Audit: effects were already instanced but explosions lacked distinct fire/smoke; projectile cores used solid-color unlit materials; bloom sampled scene brightness; debris was box geometry with abrupt expiry.
- Implemented: shared animated TSL emission, fixed fire/smoke pools with alpha/spin/lifetime, four capped projectile-following lights, emissive-only MRT bloom on native and fallback paths, irregular PBR shards with 1.2–2 second visual lifetime.
- Platform landing detection retains bounded invisible ballistic state after cosmetic fade; gameplay collision and network event logic are preserved.
- Files: effectMaterials.js, explosionParticles.js, combatVisuals.js, renderPipeline.js, world.js. No new dependencies.
- Validation: full regression suite (22 bounded checks), production build/hosting checks, PBR maps, structural pool baseline, 16-player weapon stress, and focused effects lifecycle checks pass. Actual Three WGSL and GLSL shader generation passes at high/medium quality, including selective emission and smoke alpha. No GPU pixel/browser visual verification performed.
- Request-only staged snapshot passes effects, structural pools, smoke and the full 22-check suite (including 15 worker tests). A fresh Windows checkout exposed CRLF-sensitive source assertions: fixed the touched test-runner import regex; full snapshot verification uses LF files matching Git blobs. Other existing CRLF-sensitive assertions remain unchanged.
- Sites build wrapper could not locate its bundled npm files; the normal project production build succeeds. Existing large bundle warning remains.
- Preserve existing dust edits: world.js and structuralPools.test.mjs snapshots are in system temp as master-blaster-vfx-world-before.js and master-blaster-vfx-pools-before.mjs. Other pre-existing graphics/dust edits remain unrelated.
- Review complete: bounded pools/lights, independent visual randomness, disposal and landing detection checked. Ready to commit only request changes and push origin/main; no implementation work remains.
