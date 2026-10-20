# Forum-compatible image refresh — 20 October 2026

The existing forum posts specify image dimensions. Replacing their image URLs
with the approved ultrawide captures changes the aspect ratio and stretches
those embeds. Fresh captures at the original asset dimensions are required;
cropping, resampling, synthetic effects and screenshot composites are excluded.

Required captures:

- Action images: 1068 × 735 PNG, current High production renderer, 15 active bots.
- Home and Quick Play menus: native 2560 × 1440 JPEG, retaining the original
  1280 × 720 aliases' 16:9 aspect ratio, with current production UI and brand name.
  The parent approved this native higher-resolution viewport after the complete
  current setup could not fit a 1280 × 720 viewport at normal browser zoom.

Keep the approved `*-2026-10-20` source images unchanged. Save compatible exports
under new names such as `action-rockets-forum-2026-10-20.png` before replacing any
undated public aliases. The parent task owns alias changes and publication.

Use the documented browser viewport capability to render at the required
dimensions, then reset the temporary override. Keep the tab muted before game
content loads and throughout capture. Export action PNGs through the helper's
visible **Download lossless game canvas** link; save its `data-review` evidence.
The existing **Capture 15-bot action** control stages initial positions and
explosive loadouts, then runs real production AI movement and combat. Do not use
the injected explosion or impact review controls.

Accept action images only after visual review and proof confirming the expected
canvas dimensions, 16 fighters / 15 bots, an alive player, zero renderer errors,
no direct fallback, and no injected explosions. Describe the selected weapon as
equipped unless its firing is separately demonstrated. Disclose the staged
starting setup in the accompanying captions.

## Completed native captures

| File in `public/press/` | Dimensions | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `action-rockets-forum-2026-10-20.png` | 1068 × 735 | 1,205,196 | `6e5c049944268c73122df2dfb478f60d8ad345cf7a8662747b3a927fc8a0d812` |
| `action-grenades-forum-2026-10-20.png` | 1068 × 735 | 1,163,679 | `2c76ce106ab958917053100669bf6bb59f7c3f869c30cbbe71a78f2f1a28e975` |
| `home-menu-forum-2026-10-20.jpg` | 2560 × 1440 | 194,690 | `cedfb5ec2469522baca5e9ebe42ec438e7c05da2a7df5ea7faf364f1d5533c75` |
| `quick-play-forum-2026-10-20.jpg` | 2560 × 1440 | 184,435 | `47148fa16af2e0ba38468ec0b0c9616bb3936dbfcfd3ba54062e523b736fe474` |

The new agent-owned Edge tab (1966654639) was muted by the parent through the
native browser UI before game content loaded; its context menu explicitly
offered **Unmute tab**. Captures used the documented viewport capability, with
action metrics confirming a 1068 × 735 drawing buffer and device pixel ratio 1.
The frame-critical capture waited for the parent's file dialog to finish and
the muted capture tab to return to the foreground.

Both action images use the current High WebGPU temporal native-output renderer.
Their export evidence confirms 16 fighters / 15 bots, an alive player with zero
deaths, zero errors, no direct fallback, and no injected explosions. Rocket
capture froze after 7 simulation frames / 157 ms; grenade capture after 16 frames
/ 342 ms. Each was exported only after 32 actual production scene renders while
the real combat frame remained frozen. Before/after physics, particle and camera
snapshots are equal in each evidence file (`frozenStateUnchanged: true`). No pixels were cropped, rescaled,
retouched or composited. The rocket image uses the helper's showcase camera;
the grenade image uses the actual production gameplay camera.

Ignored raw evidence is saved under `.codex-spec-render/outreach-2026-10-20/`:
`action-rockets-forum-proof.json`, `action-grenades-forum-proof.json`, and
`forum-menu-proof.json`.

Menu images were captured directly from `https://masterblaster.se/` and
`https://masterblaster.se/quick-play` at native 2560 × 1440, normal 100% browser
zoom, device pixel ratio 1 and loaded fonts. This is a fresh native render with
the original aliases' 16:9 aspect ratio; no existing image was enlarged. The Quick
Play display name is `MasterBlaster`; the match summary is
`15 bots · veteran · 3 min`, and the native search filter is `Rocket Launcher`.
The capture fully contains the heading, Start button, match summary, all five
equipped slots, Rocket Launcher preview, complete filtered Rocket Launcher card
and footer. Visible-control bounds all fit inside the viewport; the last slot's
bottom is 996.375 px, filtered card's bottom 1314.578125 px, and footer's bottom
1340.578125 px, all within the 1440 px image height.

The first independent read-only review found no authenticity or aspect-ratio
blocker, but the parent's stricter review rejected unsettled temporal edges and
the partial Quick Play viewport. The action images above replace that first
attempt. These are supporting gallery captures:
the central pillar partly obscures distant fighters and the current temporal
renderer softens moving edges. There is no verified headshot, grapple moment,
or player-fired blast in these frames.

Final independent review accepted the settled rocket/grenade pair and the
complete 2560 × 1440 menu captures. All five Quick Play slots, full Rocket
Launcher preview, complete filtered card and footer are visible. Full-resolution
links remain useful for small labels on mobile forum embeds. This is practical
gallery acceptance, not a claim of AAA promotional perfection.

Suggested captions:

- Home menu: “Current Master Blaster home menu.”
- Quick Play: “Quick Play setup and five-weapon loadout, filtered to Rocket Launcher, with 15 Veteran bots selected.”
- Rocket action: “Rocket Launcher equipped during a 15-bot battle. Staged starting positions and loadouts; live AI combat; showcase camera.”
- Grenade action: “Grenade Launcher equipped during a 15-bot battle. Staged starting positions and loadouts; live AI combat; gameplay camera.”

## Renderer settling correction and current checkpoint

Source inspection found that the current production frame loop stops rendering
a paused scene unless `sceneDirty` or `sceneSettleFrames` requests a draw. The
development capture helper paused the simulation directly without requesting
that settling path; rAF counters continued increasing although the scene was
not redrawn. Repeated manual exports therefore retained the unsettled image.

Only `tests/graphics.browser.html` was changed: a real AI explosion now freezes
combat, holds its actual camera, resets render history, requests the production
pause-settling path, counts 32 actual scene-render calls, and exports after
confirming unchanged physics, particles and camera. It fails visibly on state
changes, renderer errors, fallback or timeout. No production game code,
materials, effects, health or weapon rules were changed. Module syntax and
diff checks pass, and both new action captures pass the 32-render/state-equality
runtime assertions. Production build/hosting validation remains with the parent
after final assets and aliases are selected.

The initial viewport override was reset and tab/server closed, then a fresh
agent-owned tab (1966654677) was explicitly muted before loading the corrected
helper. This tab and the owned Vite process on port 8799 (execution session
38922) were retained until final QA passed. A temporary native 67% browser-zoom trial
still clipped the menu; the parent restored 100% and approved fresh 2560 × 1440
native menu captures instead. Both complete menu files are saved; browser zoom
is 100% and the viewport override is reset. After final independent acceptance,
only the agent-created muted tab was closed and only the owned Vite process was
stopped. No aliases, approved dated images, or unrelated files were changed;
no commit or push was performed by this agent.

Next: parent updates only the appropriate undated aliases, validates their
deployed bytes and dimensions, then publishes through
the repository workflow.
