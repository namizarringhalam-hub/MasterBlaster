# Master Blaster graphics improvements — editable plan

Last condensed from the active graphics checkpoint: 2026-09-18.

This is an editable shortlist, not a release claim. Delete, reorder, or add
items freely; the detailed evidence remains in `docs/graphics-checkpoint.md`.

## Rules that apply to every item

- Keep gameplay, hit detection, movement, weapons, audio, and selected visual
  quality intact.
- Test Low, Medium, High, desktop, tablet/mobile viewport, native WebGPU, and
  WebGL fallback where relevant.
- Verify repeated resets, resource cleanup, 16-fighter stress, and continuous
  camera motion where relevant.
- Publish only a validated improvement with candid independent review. The
  remaining non-body graphics categories need 98/100; body parts need 80/100.

## Already completed or integrated

- [x] Body visual baseline: head, torso, arms/hands, legs/boots and related
  attachments meet the user-selected 80/100 threshold.
- [x] Quality tiers: Low/Medium/High have distinct DPR, shadows, anisotropy,
  ambience, lighting, and render-graph behavior without disabling combat VFX.
- [x] Effect pooling and sparse uploads: particles, debris, projectiles, and
  destruction effects avoid work when inactive while retaining authored caps.
- [x] Weapon-model caching: inactive weapon models are detached and reused;
  switching preserves combat state and cleanup is tested.
- [x] Decoy resource lifecycle: only a fully rendered recent decoy is retained;
  old decoys and their GPU resources are released safely.
- [x] Sky and arena presentation: native gradient sky, theme variants, and
  scene-owned cleanup are in place.
- [x] Cover/pillar readability pass: framed, recessed cover construction and
  improved symbols/UVs were added without changing collision or destructibility.
- [x] Renderer lifecycle fixes: shared Sprite disposal and Three raw-attribute
  cleanup regressions were fixed and tested across repeated resets.
- [x] Blaster visual passes: muzzle-follow, trail orientation, and restrained
  trail shading improvements have been validated and published incrementally.

## Current release candidate: structural-dust presentation

- [ ] Finish the white-base, authored-tint structural dust integration.
  - [x] Use a shared view-facing opacity graph and pre-create the 128-instance
    color stream so first collapse cannot select a stale shader path.
  - [x] Preserve existing collapse physics, matrices, instance RGB, lifetime,
    shrink behavior, bounds, and debris.
  - [ ] Complete the native/WebGL × Low/Medium/High × mobile × theme matrix.
  - [ ] Validate first collapse, 16 concurrent structural effects, repeated
    resets, and no resource/cache regression.
  - [ ] Review continuous orbit, fast turns, camera collision, and entering/
    exiting dust clouds for readability and motion stability.
  - [ ] Obtain independent final scores before publishing.

## Remaining visual craft work

- [ ] Elbows and arm joins: compare a bounded elbow-only silhouette refinement;
  keep the current joint geometry if it does not improve the score.
- [ ] Lower body and landing contact: improve the relationship between boots,
  legs, floor contact, and landing animation without changing movement physics.
- [ ] Structural-dust craft: address uniform haze and late-life contraction;
  reject dim-only, glassy, patchy, faceted, or less-readable alternatives.
- [ ] Cover readability: improve infill contrast/detail only if it helps under
  real combat lighting; do not globally brighten the arena.
- [ ] Projectile/VFX craft: review firing, reloads, grappling, recoil, melee,
  weapon switching, all weapon effects, impacts, and destruction for clarity
  in live combat.
- [ ] Camera presentation: prove stable continuous motion, fast turns, close
  collisions, and no visual artifacts rather than relying on still captures.
- [ ] Mobile UX/readability: confirm HUD, touch controls, contrast, and combat
  cues at phone and tablet viewports; device performance remains separately
  measured, not assumed from emulation.

## Performance and loading work still open

- [ ] Diagnose cold selected-tier rendering and first-use shader/model work;
  improve only verified costs, with no detached compile jobs or quality cuts.
- [ ] Attribute large weapon/projectile/grapple stalls before changing caches;
  distinguish model construction, garbage collection, scheduler delay, and GPU
  work instead of guessing.
- [ ] Measure repeatable 16-fighter pacing on all tiers after warmup, including
  real firing, destruction, grappling, and rapid weapon switches.
- [ ] Test background/foreground transitions, reconnects, network interruption,
  and full cleanup after long sessions.

## Final acceptance work

- [ ] Re-run the complete automated suite, production build, Worker dry run,
  and local multiplayer lifecycle tests for each candidate release.
- [ ] Run browser/live checks on desktop and mobile layouts, including WebGL
  fallback and the selected graphics tier.
- [ ] Obtain candid independent reviews from the visual, audio/performance, and
  adversarial performance reviewers; resolve every blocker.
- [ ] Reach the applicable score gate: 80+ for every body part and 98+ for each
  remaining graphics category and the overall independent review.

## Intentionally excluded

- No automatic downgrade of quality on mobile.
- No removal of weapons, effects, music, audio feedback, or gameplay features.
- No per-frame cache workaround, hidden fog/blur, or visual darkening presented
  as an optimization.
- No deployment of unvalidated work.
