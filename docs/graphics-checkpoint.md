# Graphics overhaul checkpoint

Updated: 2026-09-06, interim release preparation after passes 11–12. IN PROGRESS.

## Current handoff

- No stress/reset/cache/decoy loop, CPU test or build remains running. Ten warmed-decoy resets and all requested milestone reviews are complete; retained reviewers idle. Resume saved work, not the overhaul from scratch.
- Local server still responds http://127.0.0.1:5173 (previous Vite session77559). Browser binding browser, gameTab id3 restored to normal WebGPU /tests/graphics.browser.html, High/Foundry/arena, paused16fighters. Temporary viewport override RESET; reapply1440x900DPR1 for matched captures. Oldtab2 was closed; browser binding reused, not reinitialized.
- User explicitly requested "deploy and then continue" after the failing scores and no-release state were disclosed. Root is preparing this exact saved snapshot as a one-time interim release exception, not claiming independent approval. Future overhaul publication remains subject to the 98 gate unless separately authorized. No further product edits before this snapshot is saved/deployed.
- Fresh full suite (18 standalone scripts +15 Worker tests), production build, Worker dry run and local live multiplayer lifecycle passed on this snapshot. Live checks included 16-fighter respawn/reconnect, reserved capacity, rematches, collapse scoring and all four corner pillars. Release result will be recorded after verification. Main asset main-DL97ntj6.js; Three asset three-BcuhlKCy.js.
- Recovery heartbeat master-blaster-work-recovery remains ACTIVE every 15 minutes. It resumes unfinished checkpoints even after a normal progress handoff; requires the app/computer running. Pause only on completion, intentional user pause, or genuine user-input blocker. No current user-input blocker.
- Confirmed prior interruption: retained graphics reviewer hit an account usage-limit error. Later read-only usage no longer showed exhaustion; retry of the SAME reviewer succeeded without a model change or credit redemption. Do not attribute every earlier unexplained stop to that error.

## Authority, baseline and release gate

- Canonical: C:/Users/namir/Desktop/Games/Master Blaster; main; origin https://github.com/namizarringhalam-hub/MasterBlaster.git.
- Published HEAD: d7b2e4d219b146b765c8f0ba68781e31de3f6c35, client v99, https://masterblaster.se/.
- Worker unchanged: e79ad4a2-f74a-42bc-9c18-e1ea58af707c.
- Sites project: appgprj_6a6378a267348191a15d7e0faf662c64. Saved v99: appgprj_6a6378a267348191a15d7e0faf662c64~appgver_85faa8fef2608191a26cb5797305acdb.
- Preserve all 47 weapons, sound, gameplay, collision, server authority and unrelated user work. Do not silently lower selected quality.
- Every normalized category AND weighted overall must independently reach 98/100, no blockers. Weights: arena/materials/lighting/stability 25%; fighters/weapons/VFX/destruction 25%; readability/camera 15%; tiers 15%; pacing/lifecycle 10%; UI/mobile/accessibility 10%.
- All complete categories and overall remain WITHHELD. Static sample scores are not category approval. The latest explicit interim-deployment request is a one-time exception, with failing 89 overhead /86 cover scores preserved; then continue the complete 98 review gate. Exact tested commit, origin/main push and approved deployment workflow still apply.

## Independent reviews

Reuse retained agents, read-only critics; root owns edits/build/browser/Sites.

- graphics_quality_reviewer: arena sample 66 -> 71 -> 75 -> 81 -> 85 (exposed spines) -> 88 (service panels) -> 89 (sky gradient), all FAIL. Fighter sample 58 -> 67 -> 72 -> 78 -> 84, still FAIL. No new fighter score from lossless capture alone.
- menu_audio_perf_critic / Ramanujan: scoped effect-tail optimization 97/100 PASS at his 95 threshold, but below this project's 98 bar. Broad performance FAIL.
- menu_audio_perf_reviewer / Bohr: lazy weapon-cache subsystem 98/100 PASS across Low/Medium/High; NOT an overall performance score. Independently confirmed Three disposal backport and sky reset plateau, narrow lifecycle only.
- Ohm menu_visual_critic could not be activated due to agent-thread limit earlier. No Ohm review occurred; do not claim one or spawn replacements blindly.
- Pass11 visual: 89/100 FAIL overhead unchanged; native discrete offset captures show coherent pillar spines, no obvious z-fight/acne/broad floor moire. Thin 9cm altitude bands retain subpixel coverage variation. Close cover and boost pads newly exposed craft blockers.
- Pass12 visual: close-cover 76 -> 82 -> 84 -> 86/100 FAIL (separate scope, not replacement for overhead89). Mitered60tri ring resolves corner artifacts. STOP rim iteration; infill still soft/padded, needs sharper seam/finer metal grain. Reviewer first requests midrange/underpass/all-theme/all-tier readability evidence before more surface changes. Boost pads remain next arena blocker.
- Bohr decoy: 94 FAIL (partial frustum admission) -> 96 FAIL (late old-tier expiry) -> 98/100 PASS for final context-tag candidate. Ramanujan final corrected context-tag review: 98/100 PASS. Both read-only, exact actual scores, scoped only NOT overall FPS. Serial/cross-tier/overlap evidence and ten warmed-anchor resets now complete, no remaining scoped blocker.
- Additional static coverage: graphics reviewer confirmed bodies/rims/symbols/passages remain readable in SolarHigh, IonHigh and FoundryHigh/Medium/Low underpasses. WebGL arena/underpass smoke review found no missing geometry/black surfaces/broken materials; routes and symbols remain distinguishable. No global brightness change justified. Scores stay89overhead/86close-coverFAIL; no engaged-player/destruction/mobile/loading/FPS approval implied.

## Latest validation

- Full npm test: 18 standalone scripts plus 15 Worker Vitest cases PASS after final pass12 mitered-cover/context-tag candidate (22:29 local run).
- npm run build + hosting check PASS:
  - main-DL97ntj6.js: 365.29 KB / 106.07 KB gzip.
  - three-BcuhlKCy.js: 924.80 KB / 254.69 KB gzip.
  - index-BDTCJK4k.js: 18.08 KB / 8.00 KB gzip.
- git diff --check passes; only Windows LF/CRLF warnings.
- No Worker changes or new production deployment. Existing test labels containing “AAA” are legacy output, not a quality claim.
- Root-owned tracked changes: AGENTS.md, PLAYER_TEXT.js, package.json, package-lock.json; src/{combatVisuals,gameData,main,player,renderPipeline,world}.js; tests/{performance.test,smoke,weaponStress}.mjs.
- New files: docs/graphics-checkpoint.md; scripts/{test,patch-three}.mjs; src/surfaceTextures.js; tests/{graphics.test,testRunner.test,threeLifecycle.test}.mjs; tests/graphics.browser.html.
- Preserve any new unrelated changes; inspect Git before editing.

## Saved implementation

- Matched 256-square mipmapped albedo/normal/roughness maps; correct color spaces, repeat and anisotropy. Height-field reuse preserves every texture byte (fixed hashes). No imagegen assets added; current art is code-native.
- Inset structural geometry: 108 triangles/module, fixed collision envelope. Hollow route frames and calibrated slate decks with explicit shared environment map at intensity .24. Adds 44,400 structural triangles vs old geometry; stress remains below bar.
- Existing four 13 cm pillar spines moved from buried .42*width to half-width/depth. Exactly 6.5 cm visual clearance; same instances/draws, collision and destruction ownership.
- Pillar body ONLY uses UV scale .25: four large service panels instead of sixteen tiny cells/axis. Deck/ground UVs and all texture bytes/filtering stay unchanged. Tests prove unchanged geometry/normal/color bytes.
- Cached beveled fighter parts, material-batched mechanics, one capsule shadow proxy, recessed visor and dark muzzle housing. Emission preserves combat cues.
- Arm grip IK across all 47 weapons. Support hand blends back over .16 s after reload/grapple. Focused and independent tests resolved .643 m one-frame snap: reload max .1174 m, grapple max .1953 m at 60 Hz, measured RIG-RELATIVE to isolate existing body roll. Settled world grip gap effectively zero. Real action/motion still needs review; don't confuse attachment tests with animation polish.
- Low/Medium/High DPR caps 1/1.3/1.65, shadows 1024/2048/4096, anisotropy 4/8/16, ambient motes 80/150/220, combat lights 1/2/4. Critical combat pools unchanged across tiers; separate VFX RNG. No automatic mobile downgrade.
- Lazy render graphs: Low direct, WebGPU Medium bloom, High MRT/AO/bloom; WebGL bloom fallback. At most two cached graphs. Public frame-boundary resize/quality transactions. MSAA 4 already inherited by scene passes.
- Removed detached compileAsync race (2.5 s timeout left 10.9–16.4 s work running through reset). Selected graph compiles on normal first render; loader clears only after a rendered frame. First-use/tier switching still stalls and requires improvement.
- Effect layers start count zero and draw only through last live stable slot. Slots/order/capacity/matrices/colors/RNG/upload ranges unchanged. All 47 weapons x 3 volleys x 4 times x 3 tiers match pre-change byte hashes. Sparse expiry full -> one -> zero tested.
- Lazy weapon cache: at most five IDs per Fighter, inactive children DETACHED from owner.group (decoys clone only active model). Prunes IDs removed from loadout; handles duplicate-repair stealing. Restores grip/support/muzzle/glow/spinner/piston state, resets animation parts to fresh-build behavior, preserves health/ammo/reload. Initial/reconnect authoritative slot restoration refreshes visual without switchSlot combat resets. Fighter.dispose releases detached entries; exact-once eviction/replacement tests.
- Sky: native TSL horizon-to-zenith gradient, three cached theme expressions; one renderer-owned sphere/draw. Fog .0044, environment/lighting/collision unchanged. Restore previous backgroundNode on world.dispose; do NOT dispose cached sky nodes on pinned Three r185 because its internal background disposal leaves the cached mesh reference after destroying its resources. Current app reuses one Scene/renderer. Future multiple-Scene/renderer creation in one module lifetime would require scene-scoped cache ownership to avoid shared-node listener retention.
- Decoy: retain exactly one latest FULLY rendered removed clone, detached/outside gameplay arrays, dispose previous and on transient/match cleanup. One-shot callbacks count every child mesh under a single quality:direct context; partial/unrendered/mixed-context clone cannot occupy anchor. Late old-context expiry cannot replace current-context anchor. Bake the two frozen thruster instances into one ordinary mesh with identical transformed positions/normals/UVs and one draw (live Fighter only gains name). Tests cover .65/1.8 scales, owner isolation, independent flicker, partial/mixed admission, late expiry, replacement and exact-once cleanup. First genuine tier use remains cold; do not claim solved.
- Cover candidate: same <=2 batched bodies, now60tri/body with four planar mitered rim quads + central panel per face. Exact outer±.5 envelope, .012 recess/.445 tangent, infillUV.25. Nonindexed colors separate neutral-metal frame from tinted infill; frame UVs nondegenerate patch at existing texels25.6..30.72, geometric face normals. Existing four-symbol instances shaded/framed, slightly wider/recessed. Non-destructible anchor decorations unchanged. No global texture/filter/light changes. Current screenshot pass12-cover-mitered-native.png, scoped86 FAIL; topology defect resolved, infill/readability remain.

## Confirmed reliability fixes

1. Smoke test stall: stale assertion formatted a cyclic Three Mesh/Scene. Replaced with compact primitive assertions. Bounded serial runner uses 120 s / 1 GB per child, tested real termination. Never assert equality of cyclic objects when a boolean identity assertion suffices.
2. Host throttling: all tiers had exact 1000.5 ms cadence until user foregrounded preview, immediately restoring 60 Hz. Old 1 Hz samples invalid.
3. Sprite teardown: world disposal destroyed Three's shared Sprite quad seven times. Skip only engine-owned Sprite geometry; still dispose owned materials/other geometry. Pre-fix regression 7 !== 0, post-fix repeated resets no errors.
4. Three 0.185.1 raw-attribute leak: first shadow RenderObject disposal omitted normals/colors uploaded later. Exactly +36 attrs/+20,160 B/reset. Owner trace found 34 normals + 2 structural colors.
   - scripts/patch-three.mjs backports upstream #33939 / commit 4e369cb1ba5573a12141af76ca9b1febd2751a12: union geometry.attributes with first RenderObject attributes at disposal.
   - Guards exact 0.185.1/source, validates all targets before writes, idempotent. Patches installed source plus WebGPU and nodes bundles through postinstall/pretest/prebuild/predev. No dependency upgrade; lockfile only hasInstallScript change.
   - Real Three Geometries/Attributes/Info test failed two retained buffers before patch; ten cycles/both pass orders now release all raw/node/index attrs without duplicates.
5. Medium transition input timeout: immediate Test weapon cache click timed out once. Bounded DOM/log check showed selected Medium/no errors/fallback and test NOT started. Retried once after settling, successful. 7.22 s untraced frame around transition; timeout root cause not proven. Do not blind-retry or claim a renderer/cache crash.
6. Minor pending loader issue: clearMatch does not clear hideMatchLoadingAfterFrame; pre-first-frame menu transition can emit misleading metrics.
7. Pass12 preview command timeouts: immediate capture/click after a new view/tier occasionally timed out. Bounded DOM/log checks confirmed the preview recovered with noerrors and no duplicate loop running; retried only unstarted actions after settling. Selection and capture now separated across observations. No evidence of a crashed process; exact blocking cause remains unisolated. Independent review-wait timeout no longer depends on rAF.

## Live evidence

Directory: C:/Users/namir/AppData/Local/Temp/master-blaster-graphics-review.

- pass7-owned-reset-trace-3.json: exact leaked raw attributes before backport.
- pass7-ten-resets-high.json: ten High 1280x720 resets, all 1120 attrs/12,449,728 B; flat total after bounded warmup.
- pass8-combat-high-trimmed.json/png: fixed overview, active 16 fighters, High 1440x900 DPR1, 3600 frames median22.7/p9531.9/p9948/max919 ms.
- pass8-combat-high-full-control.json/png: previous full effect capacities, 3600 median33.9/p9548.2/p99100.4/max854.7. Actual combat nondeterministic: do NOT attribute causal percentages. Both fail 60 Hz.
- pass8-combat-high-cpu-phases.json: 3600 median23.4/p9534.3/p9953.3, 224 frames >33.3 ms, 41 >50. Render CPU124.2/171.8 ms aligned with +4 programs. Separate379.5 ms gap followed only19.2 CPU ms; outside-JS cause unconfirmed.
- pass8-combat-high-owned-cpu.json: +4 programs correspond to cloned Fighter Physical/Basic materials all decoy color ff75d8, including shadow proxy, matching spawnDecoy. Repeated material disposal drops program refs. Later passes11–12 close this scoped issue (below). Also five weapon builds cost24.3 ms in one frame, before rendering; pass9 caching addresses repeated selection.
- pass9-weapon-cache-cycles-{high,medium,low}.json: all12 samples/tier, 16→80 models then perfectly flat second cycle. Warm 16-fighter switching0–0.2 ms, bounded +3,366,200 total B (+3,151,416 attribute B). Programs fixed236/244/246. These are resource/selection tests, NOT broad FPS samples; one includes6.16 s untraced cold/reset outlier.
- pass9-cache-cleanup-ten-resets-high.json: all10 serials3..12, 1106 attrs/12,429,736 B,538 geometries,28 textures,15 RTs,1023 UBOs,0 errors/fallback. First reset after all80 cached models, later nine after initial16 only. Total flat196,408,057 B after first sample.
- pass10-gradient-ten-resets-high.json: Bohr independently confirmed all10 serials2..11,1108 attrs/12,455,872 B,539 geometries,28 textures,15 RTs,1025 UBOs,0 errors/fallback. Total196,460,939→196,461,765→196,462,122 then exact through11. Stable cost vs no-sky: +1 geometry,+2 attrs/+26,136 B,+2 UBOs. File omits program counts; don't claim a program plateau.
- pass11-{arena,grazing,underpass}-motion-{0..7}.png + matching JSON: actual native1440x900 High/DPR1 discrete camera offsets0..1.12m, fourframes/capture; no errors/fallback. Reviewer inspected18frames, overhead89unchanged. Not continuous-motion video.
- pass11-decoys-before-high.json: every separated spawn+4programs/+6pipelines. pass11-decoys-anchor-trace-high.json: first retained clone fixes common programs but fresh instanced thrusters still+2/+2; exact owner trace.
- pass11-decoys-baked-{high,medium,low}.json: baking two thrusters + first-anchor gave single-tier repeated+0/+0 and exactcleanup, but superseded by later cross-tier/partial-visibility findings.
- pass12-decoys-cross-tier-first-anchor.json FAIL: same-match newMedium/Low repeated+2programs/+4pipelines. pass12-decoys-cross-tier-latest-complete.json fixes serial High->Medium->Low->Medium->High: firsttransitionuse may+4pipelines, everysecond/third+0/+0. Not enough for overlapping-old-tier case.
- pass12-decoys-overlapping-context.json: finaltaggedsource, HighAvisible->hidden, MediumBvisible->currentanchor; Alateexpiry preservesB; two subsequentMediumspawns program235/pipeline374flat; cleanupreleasesexact580001B/54attrs/27geo/32UBO/2programs.0errors/fallback.
- pass12-decoys-ten-warmed-resets-high.json: eachreset preceded by complete warmedanchor. Serials2..11 all132programs,448attrs/8973500B,193geo,28textures,15RT,350UBO,anchorfalse,errors0/fallbackfalse. Total192300491first2 then192300932last8 (bounded441B). Fixedfightercamera, notfullarena/FPSproof; cover at108tri before later60tri artcorrection.
- Cover iterations: pass12-cover-{framing,crisp-frame,clean-metal,mitered}-native.png +JSON. Scores76/82/84/86respectively; notperformancecomparisons. Current miteredcandidate wins topology, stillunfinishedinfill.
- Additional mitered-cover images+JSON: pass12-solar-high-{grazing,underpass}, pass12-ion-high-underpass, pass12-foundry-{high,medium,low}-underpass, pass12-foundry-high-arena. Reviewer inspected first6: darker bodies/rims/symbols/gaps remain distinguishable, no blackboxes/acne/miterpatches/washout; keep86craftFAIL, no globalbrightening justified. Layoutdiffersbytheme; no activefightercontrast/destruction/mobile certification.
- pass12-webgl-high-{arena,underpass}.png/JSON: real forced renderer=webgl smokecheck, WEBGL2 BLOOM, no direct fallback/errors/log warnings. Native1440x900. Startup frame interval34992.3ms recorded; no traceFrames on this run, cause unisolated (not proof all users load this slowly, and NOT a passing startup/FPS result). Need bounded phased startup profiling, preserving selectedquality. RestorednormalWebGPUaftercapture.
- Prior pass4 combat camera followed hero and ended facing a wall for Medium/Low: not equivalent worst-case stress. Preserve but don't use as complete pacing approval.

## Capture quality and QA fixture

- Browser screenshot API returns JPEG/JFIF 4:2:0 even when files were saved with .png extension. Preserve old files/links but treat them as lossy. Native1440x900 dimensions match; soft HUD/text cannot be attributed to game from those files.
- QA Capture lossless canvas button calls canvas.toDataURL(image/png) immediately after the real render and exposes a DOM download link. Save href bytes via documented browser interaction. Genuine PNG of 3D canvas ONLY, not HTML HUD. No upsample/sharpen/editing.
- Native comparisons: pass9-arena-spines-native.png -> pass9-arena-service-panels-native.png -> pass10-arena-gradient-native.png.
- pass9-fighter-blaster-native.png/json: actual settled IK pose, High. No new craft score.
- Older frozen construction poses and pass6 rocket fire VFX are invalid motion evidence. Fixture now settles actual Fighter.update and clears transient effects for pose-only fire capture.
- QA controls: tier/theme/view/47 weapons/pose; actual Fire/impact; Collapse tower; fixed/follow camera stress; weapon cache; ten resets or ten warmed-decoy resets; separated/cross-tier/overlapping-tier decoys; eight camera offsets; lossless export.
- Optional traceBuffers query records buffer generation/owners (NOT FPS); fullEffects restores old capacities as control; traceFrames records CPU phases, weapon selections and pipeline ownership/top12 slow intervals.
- Do not edit source/fixture or run CPU-heavy commands during benchmark capture. Read DOM metrics selectively, save complete JSON; never dump buffer stacks or image base64.
- Review waits now use an independent setTimeout plus cancelAnimationFrame cleanup; stopped rAF, successful frame, and scene interruption are executed in graphics.test. Test-running guards prevent overlapping reset/cache/camera/decoy loops. Source edits still reload the fixture: never edit while a review is running.

## Next unfinished steps (priority order)

1. Finish additional-theme/all-tier cover readability checks; then sharpen the cover-only infill seam/grain without changing the now-correct mitered rim. Latest close-cover86FAIL; do not redo completed decoy subsystem work unless a new regression appears.
2. Bounded phased startup profiling: untraced WebGL startup interval35s and prior WebGPU first-use/tier stalls are unresolved. Do not revive detached compileAsync races, clamp away samples or reduce quality. No immediate cause inferred solely from intervals.
3. Boost pad mechanical surface/emitter separation and soft upper plume termination, preserving behavior. All-tier/mobile artwork still needs coverage; WebGL has only static smoke evidence.
4. Continuous camera motion stability remains unproven; pass11 contains eight discrete .16m offsets per view, four rendered frames apart, not video. MSAA4 already present; no blanket blur/fog/hiding cues.
5. Repeatable active 16-fighter pacing after cache, all tiers. Keep graphics/audio selections intact.
6. Warm all five models before every teardown on remaining tiers/backends; mobile/tablet/UI and background/foreground/network interruption. Viewport emulation is not physical-device performance proof.
7. Real weapon firing/reload/grapple/recoil/melee/switching and all47 VFX/destruction craft, motion/readability, independent mobile/accessibility/audio nonregression.
8. Resolve remaining blockers and complete every category/overall98 gate before exact-source publication.

This handoff is not completion and not a user pause.
