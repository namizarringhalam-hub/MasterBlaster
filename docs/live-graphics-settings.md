# Live graphics settings

Main Settings and Pause → Graphics share 19 saved effect switches. The in-game drawer keeps the arena visible while adjustments apply at the next frame, without restarting the match. Quality, reduced motion and motion-blur intensity are also adjustable. Choices persist across reloads and quality changes; unavailable effects show their GPU, quality or accessibility requirement.

- Lighting/rendering: FXAA, bloom, reflections, ambient occlusion, contact shadows, volumetric fog/light shafts and soft particles.
- World/atmosphere: wet surfaces, light ripples, clouds/cloud shadows, horizon mist, particles, distance haze and scorch marks.
- Motion: heat shimmer, cinematic blur, decorative environment motion, mecha inertia and weapon animation.

FXAA is switchable independently; renderer multisampling remains enabled. Core combat animation and collision stay intact. Disabled post effects are omitted from rebuilt graphs; world effects use existing uniforms and draw counts. No new dependencies.

Validation: all 27 Node test scripts and 19 Worker tests passed, along with production build/hosting budgets. New regression checks cover settings migration/persistence, effect availability, disabled GPU owners, world restoration without collision changes, paused-modal wiring, and AO noise-texture disposal. In-app browser verified saved choices across quality changes, actual native rendering toggles, default restoration and return to the pause menu. Native GPU textures stayed at 53 and geometries at 224 across repeated default rebuilds, with no rendering errors or direct fallback. Fixed Three r185 GTAO's omitted noise texture disposal exposed by this check. Added an explicit 0.5 KiB compressed CSS budget allowance for the drawer.

Changed files: PLAYER_TEXT.js; src/{graphicsEffects,gameData,main,player,renderPipeline,world}.js; src/styles.css; tests/{graphicsSettings.test,graphics.test,hosting}.mjs; tests/rollout.browser.html; this document.

WebGL browser validation: native-only settings correctly show Requires WebGPU. Disabling bloom and FXAA reduced textures from 42 to 29 while retaining 224 geometries, with zero rendering errors and no direct fallback. Shader compilation can briefly stall rendering after post-effect switches. Late online arrivals inherit saved animation preferences (additional regression and multiplayer-client tests passed). Final production build passed with boot asset index-C_sGZ71K.js.

Completed: feature commit cde7569 pushed to origin/main. Production https://masterblaster.se/ verified serving index-C_sGZ71K.js on 2026-09-26. All request changes published; no remaining implementation steps or blockers.


