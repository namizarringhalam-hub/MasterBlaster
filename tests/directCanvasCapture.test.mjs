import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { createSocialVideoCapture } from "./socialVideoCapture.js";
import { MARKETING_GRAPHICS, applyMarketingGraphics } from "./marketingGraphics.js";

// Exercise stream-init failures: both native capture and encoder setup must release audio.
const globals = ["document", "location", "addEventListener", "MediaRecorder", "performance"];
const saved = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
try {
  for (const failure of ["unfocused", "capture", "encoder", "recording", "complete", "decode-error", "seek-error", "black", "infinite"]) {
    const completes = ["complete", "decode-error", "seek-error", "black", "infinite"].includes(failure);
    let clock = 0;
    globalThis.performance = { now: () => clock };
    const stopped = [], disconnected = [], handlers = new Map(), attributes = new Map();
    const videoTrack = { stop() { stopped.push("video"); } }, audioTrack = { stop() { stopped.push("audio"); } };
    const tracks = [videoTrack], stream = { getTracks: () => tracks, addTrack: track => tracks.push(track) };
    const parent = { insertBefore(node) { assert.equal(node, source); source.parentNode = parent; } };
    const source = { width: 1080, height: 1920, parentNode: parent, nextSibling: null,
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
      captureStream(fps) {
        assert.equal(fps, 60);
        if (failure === "capture") throw Error("native capture failed");
        return stream;
      } };
    const controls = { select: { value: "browser" }, button: {}, output: {},
      "#social-video-download": {}, "#social-proof-download": {} };
    let sampleCount = 0, audioOpened = 0, pictureReads = 0, recorder, decodedUrl, videoPaused = false;
    const videoListeners = new Map(), sceneEvidence = { events: [{ kind: "recorded" }] };
    const emit = event => videoListeners.get(event)?.();
    const video = { muted: false, duration: failure === "infinite" ? Infinity : 18, videoWidth: 1080, videoHeight: 1920, readyState: 2, error: { code: 3 },
      addEventListener: (type, handler) => videoListeners.set(type, handler),
      removeEventListener: (type, handler) => { if (videoListeners.get(type) === handler) videoListeners.delete(type); },
      pause() { videoPaused = true; }, removeAttribute(key) { if (key === "src") this.src = ""; },
      load() {
        if (!this.src) return;
        decodedUrl = this.src;
        assert.deepEqual(stopped, ["video", "audio"], "tracks are stopped before asynchronous decode");
        assert.deepEqual(disconnected, ["limiter", "meter", "audio"], "audio graph is released before decode");
        queueMicrotask(() => {
          game.settings.graphics = "low"; sceneEvidence.events.push({ kind: "after-stop" });
          emit(failure === "decode-error" ? "error" : "loadeddata");
        });
      },
      get currentTime() { return this.time || 0; }, set currentTime(value) { this.time = value; queueMicrotask(() => emit(failure === "seek-error" ? "error" : "seeked")); } };

    const sampleContext = { drawImage() {}, getImageData() { pictureReads++; return { data: new Uint8ClampedArray(failure === "black" ? [0, 0, 0, 255] : [60, 60, 60, 255]) }; } };
    globalThis.document = { hidden: false, visibilityState: "visible", hasFocus: () => failure !== "unfocused",
      createElement(tag) {
        if (tag === "video") return video;
        if (tag === "canvas") { sampleCount++; return { width: 0, height: 0, getContext: () => sampleContext }; }
        if (tag === "section") return { querySelector: selector => controls[selector] };
        return {};
      },
      head: { append() {} }, body: { append(panel, canvas) { assert.equal(canvas, source); } },
      fonts: { load: async () => {} }, addEventListener() {} };
    globalThis.location = { search: "?socialVideo=1" };
    globalThis.addEventListener = (type, handler) => handlers.set(type, handler);
    globalThis.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(actualStream) {
        assert.equal(actualStream, stream);
        if (failure !== "recording" && !completes) throw Error("encoder setup failed");
        recorder = this; this.state = "inactive"; this.mimeType = "video/mp4";
      }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        if (completes) this.ondataavailable({ data: new Blob(["encoded fixture"], { type: "video/mp4" }) });
        this.onstop();
      }
    };
    const audio = { stream: { getAudioTracks: () => [audioTrack] }, disconnect: () => disconnected.push("audio") };
    const meter = { connect() {}, getFloatTimeDomainData(samples) { samples[0] = .2; }, disconnect: () => disconnected.push("meter") };
    const game = { settings: applyMarketingGraphics({}), renderer: { domElement: source, backend: { compatibilityMode: false } },
      renderPipeline: { quality: "ultra", options: { ...MARKETING_GRAPHICS.graphicsOptions }, effects: { ...MARKETING_GRAPHICS.graphicsEffects },
        reducedMotion: false, motionBlurStrength: 35, nativeWebGPU: true, direct: false,
        ...Object.fromEntries(["temporal", "aoPass", "reflectionPass", "bloomPass", "contactShadows", "localFog", "particleDepth", "heatDistortion", "motionBlur"].map(key => [key, {}])) },
      camera: { updateProjectionMatrix() {} }, resize() {}, commitResize() {}, renderScene() { return true; },
      players: [{ position: { clone() { return {}; } } }, ...(completes ? [{ isBot: true, position: {
        clone() { return { copy() {} }; }, distanceTo() { return .1; }
      } }] : [])], combatVisuals: { explosions: { layers: [{}, {}, { cursor: 0 }] } },
      sound: { context: { state: "running", resume: async () => { audioOpened++; }, createMediaStreamDestination: () => audio, createAnalyser: () => meter },
        limiter: { connect() {}, disconnect: () => disconnected.push("limiter") } } };
    const originalResize = game.resize, originalRender = game.renderScene;
    const capture = createSocialVideoCapture(game, { onRecord() {}, getErrors: () => 0, getCaptureEvidence: () => sceneEvidence });
    assert.equal(sampleCount, 0, "no readback canvas is created before encoded validation");
    if (completes) {
      const observed = capture.record({}).then(proof => ({ proof }), error => ({ error }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(pictureReads, 0, "no live WebGPU readback before recording");
      for (let frame = 0; frame < 600; frame++) { clock += 30; game.renderScene(); }
      assert.equal(pictureReads, 0, "600 captured frames perform zero synchronous GPU reads");
      game.combatVisuals.explosions.layers[2].cursor = 2;
      recorder.stop();
      const result = await observed;
      const proof = result.proof || JSON.parse(await resolveObjectURL(controls["#social-proof-download"].href).text());
      assert.equal(proof.marketingGraphics.settings.graphics, "ultra", "settings proof snapshots before async decoder activity");
      assert.equal(proof.sceneEvidence.events.length, 1, "scene evidence is cloned at stop");
      assert.equal(videoPaused, true);
      assert.equal(video.src, "");
      assert.equal(videoListeners.size, 0);
      assert.equal(resolveObjectURL(decodedUrl), undefined, "temporary decoder URL is revoked");
      if (["decode-error", "seek-error", "black"].includes(failure)) {
        assert.match(result.error.message, failure === "black" ? /Encoded picture sample is black/ : /Encoded video decode failed/);
        assert.match(proof.pictureValidation, /encoded-picture-validation-failed/);
      } else {
        assert.equal(result.error, undefined);
        assert.equal(pictureReads, 3);
        assert.deepEqual(proof.pictureSamples.map(sample => sample.phase), ["first", "middle", "last"]);
        assert.equal(proof.worldPeak, 180);
        assert.equal(proof.pictureValidation, "encoded-first-middle-last; fullFFmpegdecode-review-required");
      }
    } else if (failure === "recording") {
      const rejected = assert.rejects(capture.record({}), /Capture failed duration/);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(pictureReads, 0, "the live GPU canvas is not read before MediaRecorder starts");
      for (let frame = 0; frame < 30; frame++) game.renderScene();
      assert.equal(pictureReads, 0, "rendering does not perform synchronous picture readbacks");
      recorder.stop(); await rejected;
      assert.equal(pictureReads, 0, "a duration-rejected recording needs no encoded decoder");
      const proof = JSON.parse(await resolveObjectURL(controls["#social-proof-download"].href).text());
      assert.deepEqual(proof.pictureSamples, []);
      assert.equal(proof.pictureValidation, "not-run");
      assert.equal(proof.worldPeak, 0, "no live-canvas brightness is fabricated");
    } else await assert.rejects(capture.record({}), failure === "unfocused" ? /browser window focused/ : failure === "capture" ? /native capture failed/ : /encoder setup failed/);
    assert.deepEqual(disconnected, failure === "unfocused" ? [] : ["limiter", "meter", "audio"]);
    assert.equal(audioOpened, failure === "unfocused" ? 0 : 1, "unfocused preflight does not open audio");
    assert.deepEqual(stopped, ["unfocused", "capture"].includes(failure) ? [] : ["video", "audio"]);
    handlers.get("pagehide")();
    assert.equal(game.resize, originalResize);
    assert.equal(game.renderScene, originalRender);
    assert.equal(attributes.has("data-social-preview"), false);
    assert.equal(source.parentNode, parent);
  }
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log("Direct canvas capture, focus/failure cleanup, encoded picture sampling and preview restoration passed.");
