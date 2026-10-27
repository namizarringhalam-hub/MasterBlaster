// Opt-in development capture surface. No device capture or gameplay effects are synthesized.
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

export function createSocialVideoCapture(game, { onRecord, getErrors }) {
  const source = game.renderer.domElement;
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1920;
  canvas.id = "social-preview"; canvas.setAttribute("aria-label", "Live portrait video composition preview");
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const panel = document.createElement("section"); panel.id = "social-capture";
  panel.innerHTML = `<label>Daily hook <select id="social-topic">${SOCIAL_TOPICS.map(([id, title]) => `<option value="${id}">${title}</option>`).join("")}</select></label>
    <button id="social-record">Record 18 second clip</button>
    <output id="social-status" role="status">Ready. Each recording starts a fresh 15-bot battle.</output>
    <p>Real AI combat; staged starting positions/loadouts and showcase camera. No injected explosions or kills.</p>
    <a id="social-video-download" hidden>Download video</a> <a id="social-proof-download" hidden>Download proof JSON</a>`;
  const style = document.createElement("style");
  style.textContent = `body{background:#050c16!important}body>nav,#app{opacity:0;pointer-events:none}#social-capture{position:fixed;z-index:300;top:0;left:0;right:0;padding:12px 18px;background:#0a1828;color:#eafaff;font:14px Inter,sans-serif;display:flex;gap:14px;align-items:center;flex-wrap:wrap}#social-capture select,#social-capture button{font:inherit}#social-capture output{min-width:220px}#social-capture p{margin:0;font-size:11px;color:#a6bfcd}#social-capture a{color:#52e9ff}#social-capture [hidden]{display:none}#social-preview{position:fixed;top:112px;left:50%;transform:translateX(-50%);z-index:200;display:block;height:calc(100vh - 120px);width:auto;max-width:90vw;object-fit:contain;margin:0;box-shadow:0 0 0 1px #284151}`;
  document.head.append(style); document.body.append(panel, canvas);
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

  function draw() {
    ctx.drawImage(source, 0, 0, 1080, 1920);
    const top = ctx.createLinearGradient(0, 0, 0, 600);
    top.addColorStop(0, "rgba(3,10,20,.94)"); top.addColorStop(1, "rgba(3,10,20,0)");
    ctx.fillStyle = top; ctx.fillRect(0, 0, 1080, 600);
    const bottom = ctx.createLinearGradient(0, 1230, 0, 1570);
    bottom.addColorStop(0, "rgba(3,10,20,0)"); bottom.addColorStop(.45, "rgba(3,10,20,.88)"); bottom.addColorStop(1, "rgba(3,10,20,0)");
    ctx.fillStyle = bottom; ctx.fillRect(0, 1230, 1080, 340);
    ctx.fillStyle = "#52e9ff"; ctx.font = '900 48px "Barlow Condensed", sans-serif';
    ctx.fillText("MASTER BLASTER", 80, 180);
    ctx.fillStyle = "#c0d8e5"; ctx.font = '700 28px "Barlow Condensed", sans-serif'; ctx.fillText("15-BOT COMBAT", 80, 230);
    ctx.font = '900 96px "Barlow Condensed", sans-serif'; ctx.fillStyle = "#ffffff";
    let line = "", y = 340;
    for (const word of SOCIAL_TOPICS.find(([id]) => id === topic.value)[1].split(" ")) {
      if (ctx.measureText(`${line} ${word}`).width > 820 && line) { ctx.fillText(line, 80, y); line = word; y += 100; }
      else line += `${line ? " " : ""}${word}`;
    }
    ctx.fillText(line, 80, y);
    ctx.font = '900 62px "Barlow Condensed", sans-serif'; ctx.fillText("FREE. EASY TO PLAY.", 80, 1260);
    ctx.font = '700 40px "Barlow Condensed", sans-serif'; ctx.fillText("ACTION PACKED. NO INSTALL.", 80, 1320);
    ctx.fillStyle = "#52e9ff"; ctx.font = '900 48px "Barlow Condensed", sans-serif'; ctx.fillText("PLAY MASTERBLASTER.SE", 80, 1390);
  }
  function cleanup(s) {
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
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = topic.disabled = true; videoLink.hidden = proofLink.hidden = true;
    for (const url of urls) URL.revokeObjectURL(url); urls = [];
    status.textContent = "Preparing a fresh battle and native portrait renderer…";
    try { await onRecord(); } catch (error) { fail(error); }
    finally { button.disabled = topic.disabled = false; }
  };
  async function record(staged) {
    if (session) throw Error("A recording is already running");
    if (document.hidden) throw Error("Keep this tab visible throughout capture");
    if (source.width !== 1080 || source.height !== 1920) throw Error("Game drawing buffer must be native 1080 × 1920");
    if (getErrors() || game.renderPipeline.direct) throw Error("Renderer errors or fallback prevent recording");
    if (typeof MediaRecorder !== "function" || !canvas.captureStream) throw Error("Canvas recording is unavailable");
    await document.fonts.load('900 96px "Barlow Condensed"');
    await game.sound.context?.resume();
    if (game.sound.context?.state !== "running" || !game.sound.limiter) throw Error("Game audio did not unlock");
    const audio = game.sound.context.createMediaStreamDestination(), meter = game.sound.context.createAnalyser();
    meter.fftSize = 1024; game.sound.limiter.connect(meter); meter.connect(audio);
    const stream = canvas.captureStream(60);
    for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
    const s = { audio, meter, stream, samples: new Float32Array(1024), chunks: [], frames: 0, audioPeak: 0, worldPeak: 0,
      botTravel: 0, positions: game.players.slice(1).map(p => p.position.clone()), shellStart: game.combatVisuals.explosions.layers[2].cursor,
      started: performance.now(), startedAt: new Date().toISOString(), error: null, ...staged };
    try {
      const fastCodec = "video/webm;codecs=vp8,opus";
      const mimeType = new URLSearchParams(location.search).get("videoCodec") === "vp8" && MediaRecorder.isTypeSupported(fastCodec)
        ? fastCodec : socialVideoMime(type => MediaRecorder.isTypeSupported(type));
      s.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 7000000, audioBitsPerSecond: 160000 });
      session = s; draw();
      return await new Promise((resolve, reject) => {
        s.recorder.ondataavailable = event => { if (event.data.size) s.chunks.push(event.data); };
        s.recorder.onerror = event => fail(event.error || "MediaRecorder failed");
        s.recorder.onstop = () => {
          const durationMs = performance.now() - s.started, mime = s.recorder.mimeType;
          const explosions = game.combatVisuals.explosions.layers[2].cursor - s.shellStart;
          const proof = { topic: topic.value, hook: SOCIAL_TOPICS.find(([id]) => id === topic.value)[1], startedAt: s.startedAt,
            endedAt: new Date().toISOString(), durationMs, width: 1080, height: 1920, mimeType: mime, actualRenderFrames: s.frames,
            actualRenderFps: s.frames * 1000 / durationMs, botCount: game.players.filter(p => p.isBot).length, botTravel: s.botTravel,
            observedExplosions: explosions, audioPeak: s.audioPeak, worldPeak: s.worldPeak, errorCount: getErrors(), directFallback: game.renderPipeline.direct,
            injectedExplosions: false, stagedSetup: "Staged starting positions/loadouts; live production AI combat; showcase camera", error: s.error };
          proof.minimumRenderFps = 20; proof.preferredRenderFps = 24;
          proof.qualityWarning = proof.actualRenderFps < 24 ? "Below preferred 24 actual FPS; review motion quality" : null;
          cleanup(s); session = null;
          if (!s.error && (durationMs < 17500 || proof.actualRenderFps < 20 || s.botTravel < .5 || explosions < 1 || s.worldPeak < 12 || s.audioPeak < .0001 || getErrors() || game.renderPipeline.direct))
            proof.error = "Capture failed duration, moving-frame, combat, picture or game-audio validation";
          const proofUrl = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" })); urls.push(proofUrl);
          const stem = `master-blaster-${topic.value}-${s.startedAt.replace(/[:.]/g, "-")}`;
          proofLink.href = proofUrl; proofLink.download = `${stem}.json`; proofLink.hidden = false;
          if (proof.error) { status.textContent = `Capture failed: ${proof.error}`; reject(Error(proof.error)); return; }
          const blob = new Blob(s.chunks, { type: mime });
          if (!blob.size) { status.textContent = "Capture failed: empty video"; reject(Error("Empty video")); return; }
          const videoUrl = URL.createObjectURL(blob); urls.push(videoUrl);
          videoLink.href = videoUrl; videoLink.download = `${stem}.${mime.includes("mp4") ? "mp4" : "webm"}`; videoLink.hidden = false;
          status.textContent = `Ready: ${(durationMs / 1000).toFixed(1)} s, ${proof.actualRenderFps.toFixed(1)} actual FPS, ${explosions} real explosions. Review both downloads.`;
          resolve(proof);
        };
        s.recorder.start(250);
        s.timer = setTimeout(() => { if (s.recorder.state !== "inactive") s.recorder.stop(); }, 18000);
        status.textContent = "Recording live AI combat for 18 seconds. Keep this tab visible.";
      });
    } catch (error) { cleanup(s); if (session === s) session = null; throw error; }
  }
  function frame(rendered) {
    if (session && (document.hidden || getErrors() || game.renderPipeline.direct)) { fail("Visibility loss, renderer error or fallback interrupted capture"); return; }
    if (!rendered) return;
    draw();
    if (!session || session.recorder.state !== "recording") return;
    const s = session; s.frames++;
    s.meter.getFloatTimeDomainData(s.samples);
    for (const value of s.samples) s.audioPeak = Math.max(s.audioPeak, Math.abs(value));
    game.players.slice(1).forEach((player, index) => { s.botTravel += player.position.distanceTo(s.positions[index]); s.positions[index].copy(player.position); });
    if (s.frames % 15 === 0) {
      const pixels = ctx.getImageData(480, 850, 120, 120).data;
      for (let i = 0; i < pixels.length; i += 64) s.worldPeak = Math.max(s.worldPeak, pixels[i] + pixels[i + 1] + pixels[i + 2]);
    }
  }
  const visibility = () => { if (document.hidden && session) fail("Tab became hidden"); };
  document.addEventListener("visibilitychange", visibility);
  addEventListener("pagehide", () => { if (session) { fail("Page closed"); cleanup(session); } game.resize = resize; game.renderScene = renderScene; for (const url of urls) URL.revokeObjectURL(url); }, { once: true });
  return { record, preview: draw, fail };
}
