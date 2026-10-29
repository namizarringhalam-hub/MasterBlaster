# Master Blaster marketing capture defaults

All future marketing videos, screenshots, thumbnails and gameplay images must
match the graphics settings in the user's current game tab. Inspect that tab
when available and refresh the saved snapshot when their preferences change.
When unavailable, use this verified snapshot; never guess a lower preset.

## Verified browser snapshot — 28 October 2026

Read directly from the existing muted Edge tab at
https://masterblaster.se/graphics-settings. Only settings groups were expanded
and scrolled; no setting, match, account or saved preference was changed.
The UI showed **Ultra · Maximum quality**, not Custom; footer showed WebGPU /
Temporal native output / ultra. Every lighting, world and motion effect switch
was visibly enabled, and Reduce motion and flashes was unchecked.

| Setting | Saved value |
| --- | --- |
| Graphics preset | Ultra |
| Render resolution | 100% |
| Shadow map | 4096 |
| Ambient occlusion samples | 32 |
| Reflection resolution and ray quality | 50% |
| Bloom resolution | 50% |
| Combat effect density | 100% |
| Combat lights | 4 |
| Detail distance | 96 |
| Atmospheric particles | 220 |
| Texture filtering | 16× |
| Motion blur intensity | 35% |
| Reduce motion and flashes | Off |
| Antialiasing | On; current WebGPU temporal reconstruction |
| Bloom, reflections, AO, contact shadows, fog and soft particles | All on |
| Wet surfaces, light ripples, clouds, horizon mist, particles, distance haze and impact marks | All on |
| Heat shimmer, motion blur, decorative motion, mecha motion and weapon animation | All on |

The machine-readable snapshot is `tests/marketingGraphics.js`. It retains the
current graphics schema version 3 and MSAA 0: temporal antialiasing is enabled
through its effect switch; obsolete MSAA is not reintroduced.

## Capture workflow

- Use `?marketingCapture=1` on the development graphics fixture for screenshots;
  social-video mode uses the same profile automatically. Other capture paths,
  including production menu screenshots, must apply and verify the same settings.
  Do not combine marketing mode with diagnostic graphics overrides such as
  `roomLighting` or `withoutSurfaceResources`, which can change artwork separately
  from saved settings. Use only capture framing/scene/weapon/codec controls.
- Preserve existing player names, loadouts, controls, audio and match settings;
  only the isolated capture session's graphics should adopt these defaults.
- Preserve the real graphics pipeline, exposure, materials, lighting and effects.
  Delivery framing may be landscape or portrait; TikTok remains 1080×1920.
- Verify the actual renderer, effects and options before capture and retain them
  in source evidence. Reject renderer fallback, unsupported required effects or
  a mismatch rather than silently downgrading quality. If capture is too slow,
  report it and improve the capture workflow without changing the chosen look.
- Use real current game graphics. Keep existing bot/staging disclosures and
  video action, freshness, grapple/fire and motion-quality requirements.
- Published material remains unchanged unless the user requests an update.

This is a capture preference. Production player defaults and the user's running
game session are not changed by saving it.

## Implementation validation

The snapshot check and graphics-settings checks passed. Independent code review
confirmed pre-renderer initialization, reset restoration, preservation of unrelated
preferences, and rejection of effective-pipeline mismatches. Screenshot evidence
and video proof retain the exact profile, digest and effective renderer state.
Daily 03:00 and weekly Friday 09:00 automation prompts and campaign Page18 were
updated and read back; schedules, status and target chat were preserved.

Live fixture verification passed on 29 October: current production-tab controls
still matched the snapshot; capture evidence confirmed native WebGPU temporal,
all required passes, exact options/effects and no renderer fallback or errors.
The user's match was restored paused and their preferences preserved.

The 29 October final edit now passes independent media review using selected
fresh Ultra direct-canvas source ranges. Direct WebGPU capture avoids a second
full-frame CPU copy. Picture validation samples the actual encoded Blob after
stop, keeping GPU pixel reads outside recording. Native Edge H264 decoding and
first/middle/last picture checks passed; full FFmpeg and visual review remain
mandatory. Verify the actual active tab/window as well as DOM focus. Capture
performance still depends on scene/load; no universal native30FPS claim or
quality reduction. See docs/tiktok-video-checkpoint.md for evidence and status.
