/* Temporary, identical experiment instrumentation. No network or storage writes. */
(() => {
  const startedAt = performance.now();
  const duration = 10000;
  const observations = { lcp: [], paints: [], shifts: [], longTasks: [], fonts: [], states: [], unsupported: [] };
  const observers = [];
  let stopped = false;
  let queuedFrame = 0;
  let previousState = "";
  let firstInput = null;
  const nodeIds = new WeakMap();
  let nextNodeId = 0;
  const nodeId = element => { if (!element) return null; if (!nodeIds.has(element)) nodeIds.set(element, ++nextNodeId); return nodeIds.get(element); };
  const round = value => Math.round(value * 100) / 100;
  const identify = element => element ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 3).map(name => `.${name}`).join("")}` : null;
  const fontFaces = faces => [...faces].map(face => ({ family: face.family, style: face.style, weight: face.weight, status: face.status }));
  const timing = (label, end = performance.now()) => { if (end >= 0 && Number.isFinite(end)) performance.measure(`LCP diagnosis: ${label}`, { start: 0, end }); };
  const bounds = element => { const rect = element?.getBoundingClientRect(); return rect ? { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) } : null; };

  function observe(type, receive) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
      observations.unsupported.push(type);
      return;
    }
    const observer = new PerformanceObserver(list => receive(list.getEntries()));
    observer.observe({ type, buffered: true });
    observers.push({ observer, receive });
  }
  observe("largest-contentful-paint", entries => {
    for (const entry of entries) {
      observations.lcp.push({ at: round(entry.startTime), renderTime: round(entry.renderTime), loadTime: round(entry.loadTime), size: entry.size, nodeId: nodeId(entry.element), element: identify(entry.element), rectAtObservation: bounds(entry.element), url: entry.url });
      timing(`candidate ${observations.lcp.length} ${identify(entry.element) || "unknown node"}`, entry.startTime);
    }
  });
  observe("paint", entries => {
    for (const entry of entries) observations.paints.push({ name: entry.name, at: round(entry.startTime) });
  });
  observe("layout-shift", entries => {
    for (const entry of entries) observations.shifts.push({ at: round(entry.startTime), value: entry.value, hadRecentInput: entry.hadRecentInput, sources: (entry.sources || []).map(source => ({ element: identify(source.node), previous: source.previousRect.toJSON(), current: source.currentRect.toJSON() })) });
  });
  observe("longtask", entries => {
    for (const entry of entries) observations.longTasks.push({ at: round(entry.startTime), duration: round(entry.duration), name: entry.name });
  });

  function sampleState(reason) {
    if (stopped) return;
    const heading = document.querySelector(".hero-panel h1");
    const progress = document.querySelector("#resource-progress");
    const style = heading ? getComputedStyle(heading) : null;
    const rect = heading?.getBoundingClientRect();
    const emphasis = heading?.querySelector("em");
    const emphasisStyle = emphasis ? getComputedStyle(emphasis) : null;
    const state = {
      heading: identify(heading),
      headingNodeId: nodeId(heading),
      rect: rect ? { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) } : null,
      font: style ? { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, style: style.fontStyle, lineHeight: style.lineHeight, visibility: style.visibility, display: style.display } : null,
      emphasisFont: emphasisStyle ? { family: emphasisStyle.fontFamily, size: emphasisStyle.fontSize, weight: emphasisStyle.fontWeight, style: emphasisStyle.fontStyle, lineHeight: emphasisStyle.lineHeight } : null,
      fontsStatus: document.fonts.status,
      progress: progress ? { hidden: progress.hidden, rect: bounds(progress), stage: progress.dataset.stage || null, retryHidden: progress.querySelector("[data-resource-retry]")?.hidden ?? null } : null
    };
    const serialized = JSON.stringify(state);
    if (serialized !== previousState) {
      observations.states.push({ at: round(performance.now()), reason, ...state });
      timing(`state ${observations.states.length} ${reason}; progress ${state.progress?.stage || "unset"} ${state.progress?.hidden ? "hidden" : "shown"}`);
    }
    previousState = serialized;
  }
  // Batch geometry reads once per affected frame, identically in every variant.
  // These reads can force layout; treat the probe as diagnostic, not Lighthouse.
  function scheduleState(reason) {
    if (stopped || queuedFrame) return;
    queuedFrame = requestAnimationFrame(() => { queuedFrame = 0; sampleState(reason); });
  }
  const mutation = new MutationObserver(records => {
    if (records.some(record => record.type === "childList" || record.target.matches?.("#resource-progress, #resource-progress [data-resource-retry], .hero-panel, .hero-panel h1, .hero-panel h1 em, .menu-shell, html, body"))) scheduleState("dom-change");
  });
  mutation.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style", "data-stage"] });
  const fontsEvent = event => {
    observations.fonts.push({ at: round(performance.now()), event: event.type, faces: fontFaces(event.fontfaces || []) });
    timing(`fonts ${event.type} ${observations.fonts.length}`);
    scheduleState(event.type);
  };
  for (const type of ["loading", "loadingdone", "loadingerror"]) document.fonts.addEventListener(type, fontsEvent);
  const recordFontsReady = label => document.fonts.ready.then(() => {
    if (stopped) return;
    observations.fonts.push({ at: round(performance.now()), event: label, faces: fontFaces(document.fonts) });
    timing(label);
    scheduleState(label);
  });
  recordFontsReady("initial-fontset-ready (may be empty)");
  const domReady = () => {
    timing("DOM content loaded");
    requestAnimationFrame(() => {
      if (stopped) return;
      sampleState("dom-font-demand");
      recordFontsReady("demanded-fonts-ready");
    });
  };
  const loaded = () => { timing("window loaded"); scheduleState("window-load"); };
  const interacted = event => { firstInput ??= { at: round(performance.now()), type: event.type, trusted: event.isTrusted }; };
  document.addEventListener("DOMContentLoaded", domReady, { once: true });
  window.addEventListener("load", loaded, { once: true });
  for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) window.addEventListener(type, interacted, { capture: true, passive: true });
  scheduleState("probe-start");

  setTimeout(() => {
    sampleState("capture-end");
    stopped = true;
    cancelAnimationFrame(queuedFrame);
    mutation.disconnect();
    for (const { observer, receive } of observers) { receive(observer.takeRecords()); observer.disconnect(); }
    for (const type of ["loading", "loadingdone", "loadingerror"]) document.fonts.removeEventListener(type, fontsEvent);
    for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) window.removeEventListener(type, interacted, { capture: true });
    document.removeEventListener("DOMContentLoaded", domReady);
    window.removeEventListener("load", loaded);
    let cls = 0, sessionValue = 0, sessionStart = -Infinity, previousShift = -Infinity;
    for (const shift of observations.shifts.filter(shift => !shift.hadRecentInput).sort((a, b) => a.at - b.at)) {
      if (shift.at - previousShift >= 1000 || shift.at - sessionStart >= 5000) { sessionStart = shift.at; sessionValue = 0; }
      sessionValue += shift.value;
      previousShift = shift.at;
      cls = Math.max(cls, sessionValue);
    }
    const navigation = performance.getEntriesByType("navigation")[0];
    const result = {
      schema: 1, diagnosticOnly: true, completed: true,
      variant: document.documentElement.dataset.lcpVariant || null,
      release: document.querySelector('meta[name="blaster-release"]')?.content || null,
      url: location.pathname, capturedAt: new Date().toISOString(),
      startedAt: round(startedAt), endedAt: round(performance.now()), targetCaptureMs: duration,
      conditions: { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, visibility: document.visibilityState, readyState: document.readyState, firstInput, throttling: "Not controlled by this probe; record the external test configuration separately.", cache: "The probe neither clears nor disables browser cache or service workers. Raw transfer sizes are evidence, not proof of a cold cache." },
      navigation: navigation ? { type: navigation.type, responseStart: round(navigation.responseStart), responseEnd: round(navigation.responseEnd), domContentLoaded: round(navigation.domContentLoadedEventEnd), load: round(navigation.loadEventEnd), transferSize: navigation.transferSize } : null,
      lcpMs: observations.lcp.at(-1)?.at ?? null, cls,
      ...observations,
      resources: performance.getEntriesByType("resource").map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, start: round(entry.startTime), responseStart: round(entry.responseStart), end: round(entry.responseEnd), duration: round(entry.duration), transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize, protocol: entry.nextHopProtocol })),
      marks: performance.getEntriesByType("mark").map(entry => ({ name: entry.name, at: round(entry.startTime) })),
      measures: performance.getEntriesByType("measure").filter(entry => entry.name.startsWith("LCP diagnosis: ")).map(entry => ({ name: entry.name, start: round(entry.startTime), duration: round(entry.duration) }))
    };
    const output = document.createElement("script");
    output.type = "application/json";
    output.id = "lcp-probe-results";
    output.textContent = JSON.stringify(result);
    (document.body || document.documentElement).append(output);
  }, Math.max(0, duration - performance.now()));
})();
