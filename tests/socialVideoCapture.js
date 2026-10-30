// Opt-in development capture surface. No device capture or gameplay effects are synthesized.
import { marketingGraphicsEvidence, requireMarketingGraphics } from "./marketingGraphics.js";
export const SOCIAL_TOPICS = [
  ["browser", "THIS RUNS IN YOUR BROWSER"],
  ["free", "FREE BROWSER MAYHEM"],
  ["grapple", "GRAPPLE INTO THE FIGHT"],
  ["destruction", "BRING THE TOWERS DOWN"],
  ["weapons", "PICK FIVE. MAKE MAYHEM."],
  ["bots", "15 BOTS. ZERO CHILL."],
  ["quick", "ONE MORE QUICK MATCH"]
];
export function socialVideoMime(isSupported) {
  const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"].find(isSupported);
  if (!mime) throw Error("This browser exposes no supported H.264/VP9/VP8 recording format");
  return mime;
}
export function socialVideoBotCount(params) {
  return params.get("socialVideo") === "1" && params.get("videoBots") === "5" ? 5 : 15;
}

// Non-explosive duels prove combat with both fighters' actual shots and production health loss.
export function socialCombatValidation(scene, explosions, durationMs, localPlayerId) {
  if (scene?.scene !== "readable-duel") return { mode: "legacy-explosions", valid: explosions >= 1,
    error: explosions >= 1 ? null : "Capture has no production explosion event" };
  const reject = error => ({ mode: "readable-duel", valid: false, error });
  const playerView = scene.perspective === "production-player-camera";
  if (playerView ? scene.cameraSource !== "bound unmodified Game.updateCamera" || !localPlayerId
    : scene.perspective !== "outside-duel-showcase") return reject("Readable duel has no verified camera perspective");
  const actor = scene.featuredBotId, opponents = scene.opponentIds;
  if (!actor || !Array.isArray(opponents) || !opponents.some(id => id && id !== actor)) return reject("Readable duel has no named opposing fighters");
  const recorded = event => Number.isFinite(event.atMs) && event.atMs >= 0 && event.atMs <= durationMs;
  const visiblePair = (snapshots, first, second) => [first, second].every(id =>
    playerView && id === localPlayerId || snapshots?.some(p => p.id === id && p.alive === true && p.visible === true));
  const shots = (scene.events || []).filter(e => recorded(e) && e.kind === "production-shot"
    && Number.isFinite(e.ammoBefore) && Number.isFinite(e.ammoAfter) && e.ammoBefore > e.ammoAfter && e.ammoAfter >= 0
    && typeof e.weapon === "string" && e.weapon && e.attacker?.id === e.fighterId && e.target?.id === e.targetId
    && visiblePair([e.attacker, e.target], e.fighterId, e.targetId));
  for (const opponent of opponents.filter(id => id && id !== actor)) {
    const forward = shots.filter(e => e.fighterId === actor && e.targetId === opponent && e.weapon === scene.featuredWeapon);
    const reverse = shots.filter(e => e.fighterId === opponent && e.targetId === actor);
    if (!forward.length || !reverse.length) continue;
    const pairShots = [...forward, ...reverse];
    const damage = (scene.events || []).filter(e => recorded(e) && e.kind === "production-damage"
      && Number.isFinite(e.healthBefore) && Number.isFinite(e.healthAfter) && e.healthBefore > 0 && e.healthAfter < e.healthBefore
      && ((e.attackerId === actor && e.targetId === opponent) || (e.attackerId === opponent && e.targetId === actor))
      && visiblePair(e.fighters, e.attackerId, e.targetId)
      // Hitscan damage is logged inside tryFire, just before the consuming shot event.
      && pairShots.some(shot => shot.fighterId === e.attackerId && shot.targetId === e.targetId && shot.weapon === e.weapon
        && shot.atMs <= e.atMs + 50 && shot.atMs >= e.atMs - 2000));
    if (!damage.length) continue;
    const concurrent = forward.filter(e => e.grappleActive === true && e.ropeVisible === true && e.grounded === false
      && Array.isArray(e.anchor) && e.anchor.length === 3 && e.anchor.every(Number.isFinite)
      && Array.isArray(e.velocity) && e.velocity.length === 3 && e.velocity.every(Number.isFinite) && Math.hypot(...e.velocity) > 3);
    if (!playerView && !concurrent.length) return reject("Readable outside duel has no visible attached-grapple own-weapon shot toward its opponent");
    return { mode: "readable-duel", valid: true, error: null, featuredBotId: actor, opponentId: opponent,
      featuredShots: forward.length, opponentShots: reverse.length, actualDamageEvents: damage.length, concurrentVisibleShots: concurrent.length };
  }
  return reject("Readable duel lacks mutually targeted visible ammo-consuming shots and matching real health loss");
}

// Decode the recorded bytes after capture; reading the live WebGPU canvas stalls its frame loop.
export async function validateEncodedPicture(blob, recordedDurationMs) {
  const video = document.createElement("video"), canvas = document.createElement("canvas");
  video.muted = true; video.playsInline = true; video.preload = "auto";
  canvas.width = canvas.height = 120;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const url = URL.createObjectURL(blob), deadline = performance.now() + 8000;
  const wait = (event, action) => new Promise((resolve, reject) => {
    const done = error => {
      clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener("error", failed);
      error ? reject(error) : resolve();
    };
    const ready = () => done(), failed = () => done(Error(`Encoded video decode failed (${video.error?.code || "unknown"})`));
    const timer = setTimeout(() => done(Error("Encoded video picture validation timed out")), Math.max(1, deadline - performance.now()));
    video.addEventListener(event, ready); video.addEventListener("error", failed);
    try { action(); } catch (error) { done(error); }
  });
  try {
    await wait("loadeddata", () => { video.src = url; video.load(); });
    if (video.videoWidth !== 1080 || video.videoHeight !== 1920) throw Error("Encoded video dimensions differ from native portrait capture");
    const knownDuration = recordedDurationMs / 1000;
    const duration = Number.isFinite(video.duration) ? Math.min(video.duration, knownDuration) : knownDuration;
    if (!Number.isFinite(duration) || duration <= 0) throw Error("Encoded video has no usable duration");
    const samples = [];
    const times = [Math.min(.1, duration / 10), duration / 2, Math.max(duration / 2, duration - .1)];
    for (const [index, time] of times.entries()) {
      if (Math.abs(video.currentTime - time) > .001) await wait("seeked", () => { video.currentTime = time; });
      context.drawImage(video, 480, 850, 120, 120, 0, 0, 120, 120);
      const pixels = context.getImageData(0, 0, 120, 120).data;
      let peak = 0;
      for (let i = 0; i < pixels.length; i += 64) peak = Math.max(peak, pixels[i] + pixels[i + 1] + pixels[i + 2]);
      if (peak < 12) throw Error(`Encoded picture sample is black at ${time.toFixed(3)} seconds`);
      samples.push({ phase: ["first", "middle", "last"][index], atMs: Math.round(time * 1000), peak });
    }
    return samples;
  } finally {
    video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
  }
}

export function createSocialVideoCapture(game, { onRecord, getErrors, getCaptureEvidence = () => null, onRecordingStart = () => {} }) {
  const botCount = socialVideoBotCount(new URLSearchParams(location.search));
  const topics = SOCIAL_TOPICS.map(([id, title]) => [id, id === "bots" ? `${botCount} BOTS. ZERO CHILL.` : title]);
  const source = game.renderer.domElement;
  // Keep the WebGPU output as both preview and recording source; no full-frame CPU copy.
  const sourceHome = { parent: source.parentNode, next: source.nextSibling };
  source.setAttribute("data-social-preview", "");
  source.setAttribute("aria-label", "Live portrait video composition preview");
  const panel = document.createElement("section"); panel.id = "social-capture";
  panel.innerHTML = `<label>Daily hook <select id="social-topic">${topics.map(([id, title]) => `<option value="${id}">${title}</option>`).join("")}</select></label>
    <button id="social-record" disabled>Record 18 second clip (${botCount} bots)</button>
    <output id="social-status" role="status">Preparing initial game scene…</output>
    <p>Staged Training gameplay/controls using real game mechanics; ${botCount} bot opponents and showcase camera.</p>
    <a id="social-video-download" hidden>Download video</a> <a id="social-proof-download" hidden>Download proof JSON</a>`;
  const style = document.createElement("style");
  style.textContent = `body{background:#050c16!important}body>nav,#app{opacity:0;pointer-events:none}#social-capture{position:fixed;z-index:300;top:0;left:0;right:0;padding:12px 18px;background:#0a1828;color:#eafaff;font:14px Inter,sans-serif;display:flex;gap:14px;align-items:center;flex-wrap:wrap}#social-capture select,#social-capture button{font:inherit}#social-capture output{min-width:220px}#social-capture p{margin:0;font-size:11px;color:#a6bfcd}#social-capture a{color:#52e9ff}#social-capture [hidden]{display:none}#game-canvas[data-social-preview]{position:fixed;inset:auto;visibility:visible!important;top:112px;left:50%;transform:translateX(-50%);z-index:200;display:block;height:calc(100vh - 120px);width:auto;max-width:90vw;object-fit:contain;margin:0;box-shadow:0 0 0 1px #284151}`;
  document.head.append(style); document.body.append(panel, source);
  const topic = panel.querySelector("select"), button = panel.querySelector("button"), status = panel.querySelector("output");
  const videoLink = panel.querySelector("#social-video-download"), proofLink = panel.querySelector("#social-proof-download");
  let session = null, urls = [];
  // ponytail: use the existing frame-boundary resize transaction, never mutate GPU attachments mid-pass.
  const resize = game.resize;
  game.resize = function (immediate = false) {
    this.sceneDirty = true;
    this.camera.aspect = 1080 / 1920; this.camera.updateProjectionMatrix();
    this.pendingResize = { width: 1080, height: 1920, pixelRatio: 1 };
    if (immediate || !this.animationStarted) this.commitResize();
  };
  game.resize();
  const renderScene = game.renderScene;
  game.renderScene = function (...args) {
    const rendered = renderScene.apply(this, args);
    if (rendered) frame(true);
    return rendered;
  };

  function cleanup(s) {
    if (!s || s.cleaned) return;
    s.cleaned = true;
    clearTimeout(s.timer);
    for (const track of s.stream?.getTracks() || []) track.stop();
    try { game.sound.limiter?.disconnect(s.meter); } catch {}
    s.meter?.disconnect(); s.audio?.disconnect();
  }
  function fail(error) {
    const message = String(error?.message || error);
    status.textContent = `Capture failed: ${message}`;
    if (!session) return;
    session.error ||= message;
    if (session.recorder.state !== "inactive") session.recorder.stop();
  }
  const focusState = () => ({ focused: document.hasFocus(), visibility: document.visibilityState, hidden: document.hidden });
  button.onclick = async () => {
    if (button.disabled) return;
    if (document.hidden || !document.hasFocus()) { fail("Keep this tab visible and its browser window focused before capture"); return; }
    button.disabled = topic.disabled = true; videoLink.hidden = proofLink.hidden = true;
    for (const url of urls) URL.revokeObjectURL(url); urls = [];
    status.textContent = `Preparing a fresh ${botCount}-bot battle and native portrait renderer…`;
    try { await onRecord(); } catch (error) { fail(error); }
    finally { button.disabled = topic.disabled = false; }
  };
  async function record(staged) {
    if (session) throw Error("A recording is already running");
    const initialFocus = focusState();
    if (initialFocus.hidden || !initialFocus.focused) throw Error("Keep this tab visible and its browser window focused before capture");
    if (source.width !== 1080 || source.height !== 1920) throw Error("Game drawing buffer must be native 1080 × 1920");
    if (getErrors() || game.renderPipeline.direct) throw Error("Renderer errors or fallback prevent recording");
    requireMarketingGraphics(game);
    if (typeof MediaRecorder !== "function" || !source.captureStream) throw Error("Canvas recording is unavailable");
    await document.fonts.load('900 96px "Barlow Condensed"');
    await game.sound.context?.resume();
    if (game.sound.context?.state !== "running" || !game.sound.limiter) throw Error("Game audio did not unlock");
    if (document.hidden || !document.hasFocus()) throw Error("Capture lost foreground focus while preparing");
    const audio = game.sound.context.createMediaStreamDestination(), meter = game.sound.context.createAnalyser();
    meter.fftSize = 1024; game.sound.limiter.connect(meter); meter.connect(audio);
    const s = { audio, meter, stream: null, samples: new Float32Array(1024), chunks: [], frames: 0, audioPeak: 0, worldPeak: 0,
      botTravel: 0, positions: game.players.slice(1).map(p => p.position.clone()), shellStart: game.combatVisuals.explosions.layers[2].cursor,
      started: performance.now(), startedAt: new Date().toISOString(), error: null, renderFrameTimesMs: [], pictureSamples: [], initialFocus, focusLoss: null, ...staged };
    try {
      const stream = s.stream = source.captureStream(60);
      for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
      const fastCodec = "video/webm;codecs=vp8,opus";
      const mimeType = new URLSearchParams(location.search).get("videoCodec") === "vp8" && MediaRecorder.isTypeSupported(fastCodec)
        ? fastCodec : socialVideoMime(type => MediaRecorder.isTypeSupported(type));
      s.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 7000000, audioBitsPerSecond: 160000 });
      session = s;
      return await new Promise((resolve, reject) => {
        s.recorder.ondataavailable = event => { if (event.data.size) s.chunks.push(event.data); };
        s.recorder.onerror = event => fail(event.error || "MediaRecorder failed");
        s.recorder.onstop = async () => {
          try {
            const durationMs = performance.now() - s.started, mime = s.recorder.mimeType, endedAt = new Date().toISOString();
            const explosions = game.combatVisuals.explosions.layers[2].cursor - s.shellStart;
            const proof = { topic: topic.value, hook: topics.find(([id]) => id === topic.value)[1], startedAt: s.startedAt,
              endedAt, durationMs, width: 1080, height: 1920, mimeType: mime, capturePath: "direct-webgpu-canvas",
              renderFrameTimesMs: s.renderFrameTimesMs, actualRenderFrames: s.frames,
              focus: { initial: s.initialFocus, final: focusState(), loss: s.focusLoss },
              actualRenderFps: s.frames * 1000 / durationMs, botCount: game.players.filter(p => p.isBot).length, fighterCount: game.players.length, botTravel: s.botTravel,
              observedExplosions: explosions, audioPeak: s.audioPeak, worldPeak: s.worldPeak,
              pictureValidation: "not-run", pictureSamples: [], errorCount: getErrors(), directFallback: game.renderPipeline.direct,
              injectedExplosions: false, stagedSetup: "Staged gameplay/controls using production mechanics; bot opponents; showcase camera",
              sceneEvidence: structuredClone(getCaptureEvidence()), marketingGraphics: marketingGraphicsEvidence(game),
              sourceBuffer: { width: source.width, height: source.height }, error: s.error };
            proof.minimumRenderFps = 20; proof.preferredRenderFps = 24;
            proof.recordingStartedPerformanceMs = s.started;
            proof.qualityWarning = proof.actualRenderFps < 24 ? "Below preferred 24 actual FPS; review motion quality" : null;
            cleanup(s); session = null;
            if (!s.error && (durationMs < 17500 || proof.actualRenderFps < 20 || s.botTravel < .5 || s.audioPeak < .0001 || getErrors() || game.renderPipeline.direct))
              proof.error = "Capture failed duration, moving-frame, combat, picture or game-audio validation";
            proof.combatValidation = socialCombatValidation(proof.sceneEvidence, explosions, durationMs, game.players[0]?.id);
            if (!proof.combatValidation.valid) proof.error ||= proof.combatValidation.error;
            if (proof.sceneEvidence?.scene === "grapple-and-fire" && !proof.sceneEvidence.concurrentShotCount)
              proof.error = "No recorded visible airborne grapple and production shot occurred together";
            if (!proof.marketingGraphics.matches) proof.error = "Marketing graphics changed or became unavailable during recording";
            const blob = new Blob(s.chunks, { type: mime });
            if (!blob.size) proof.error ||= "Empty video";
            if (!proof.error) {
              try {
                proof.pictureSamples = await validateEncodedPicture(blob, durationMs);
                proof.worldPeak = Math.max(...proof.pictureSamples.map(sample => sample.peak));
                proof.pictureValidation = "encoded-first-middle-last; fullFFmpegdecode-review-required";
              } catch (error) {
                proof.pictureValidation = "encoded-picture-validation-failed; fullFFmpegdecode-review-required";
                proof.error = String(error?.message || error);
              }
            }
            const proofUrl = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" })); urls.push(proofUrl);
            const stem = `master-blaster-${topic.value}-${s.startedAt.replace(/[:.]/g, "-")}`;
            proofLink.href = proofUrl; proofLink.download = `${stem}.json`; proofLink.hidden = false;
            if (proof.error) { status.textContent = `Capture failed: ${proof.error}`; reject(Error(proof.error)); return; }
            const videoUrl = URL.createObjectURL(blob); urls.push(videoUrl);
            videoLink.href = videoUrl; videoLink.download = `${stem}.${mime.includes("mp4") ? "mp4" : "webm"}`; videoLink.hidden = false;
            const combatSummary = proof.combatValidation.mode === "readable-duel"
              ? `${proof.combatValidation.actualDamageEvents} verified production damage events` : `${explosions} spawned explosion events`;
            status.textContent = `Ready: ${(durationMs / 1000).toFixed(1)} s, ${proof.actualRenderFps.toFixed(1)} actual FPS, ${combatSummary}. Review both downloads.`;
            resolve(proof);
          } catch (error) {
            cleanup(s); if (session === s) session = null;
            status.textContent = `Capture failed: ${String(error?.message || error)}`;
            reject(error);
          }
        };
        s.started = performance.now(); s.startedAt = new Date().toISOString();
        s.recorder.start(250); onRecordingStart(s.started);
        s.timer = setTimeout(() => { if (s.recorder.state !== "inactive") s.recorder.stop(); }, 18000);
        status.textContent = `Recording ${botCount}-bot Training combat for 18 seconds. Keep this tab visible.`;
      });
    } catch (error) { cleanup(s); if (session === s) session = null; throw error; }
  }
  const blur = () => {
    if (!session || session.recorder.state !== "recording") return;
    session.focusLoss ||= { ...focusState(), atMs: performance.now() - session.started };
    fail("Browser window lost focus during capture");
  };
  addEventListener("blur", blur);
  function frame(rendered) {
    if (session && !document.hasFocus()) { blur(); return; }
    if (session && (document.hidden || getErrors() || game.renderPipeline.direct)) { fail("Visibility loss, renderer error or fallback interrupted capture"); return; }
    if (!rendered) return;
    if (!session || session.recorder.state !== "recording") return;
    const s = session; s.frames++;
    s.renderFrameTimesMs.push(performance.now() - s.started);
    s.meter.getFloatTimeDomainData(s.samples);
    for (const value of s.samples) s.audioPeak = Math.max(s.audioPeak, Math.abs(value));
    game.players.slice(1).forEach((player, index) => { s.botTravel += player.position.distanceTo(s.positions[index]); s.positions[index].copy(player.position); });
  }
  const visibility = () => { if (document.hidden && session) fail("Tab became hidden"); };
  document.addEventListener("visibilitychange", visibility);
  addEventListener("pagehide", () => {
    if (session) { fail("Page closed"); cleanup(session); }
    game.resize = resize; game.renderScene = renderScene;
    source.removeAttribute("data-social-preview");
    sourceHome.parent?.insertBefore(source, sourceHome.next?.parentNode === sourceHome.parent ? sourceHome.next : null);
    for (const url of urls) URL.revokeObjectURL(url);
  }, { once: true });
  return { record, preview() {
    button.disabled = false;
    status.textContent = `Ready. Each recording starts a fresh ${botCount}-bot Training battle.`;
  }, fail };
}
