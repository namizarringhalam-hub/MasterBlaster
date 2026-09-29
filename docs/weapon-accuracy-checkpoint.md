# Weapon accuracy checkpoint

- Request: shots follow the crosshair; no arbitrary spread, with only slight sustained recoil allowed.
- Changes: `src/main.js` removes random shot/pellet/burst/charge/beam spread, refreshes aim after movement/grappling, and stops non-penetrating beams at their hit. `src/player.js` converges the camera ray from the correct firing height and shoulder offset, with matching decoy geometry and a close-overlap fallback.
- Regression: `tests/weaponAccuracy.test.mjs` exercises actual firing dispatch, repeated shots, head hits at multiple ranges/angles and movement positions, tracer endpoints, and shared multiplayer origins. Registered in `scripts/test.mjs`; updated runner count in `tests/testRunner.test.mjs`.
- Verified: focused weapon accuracy test, production build/hosting and full `npm test` pass (32 checks, including 20 Worker tests). Worker checks also rerun outside the sandbox: 20/20 pass without the initial filesystem warnings. `git diff --check` passes.
- Review: shared server origin remains unchanged; ballistic gravity/bounces, flame cones, chain behavior and visual/physical recoil retain their existing weapon mechanics. No random aim variation added for recoil.
- Blockers: none. Final diff reviewed; ready to commit only request files and push `origin/main`.
