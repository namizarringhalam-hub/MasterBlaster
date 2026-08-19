const ui = document.querySelector("#ui-root");
const status = ui.querySelector("[data-boot-status]");
const pendingMatch = sessionStorage.getItem("blaster-pending-match");
let enginePromise;

performance.mark?.("blaster-shell-visible");
globalThis.__blasterPerf = { shellAt: performance.now(), longTasks: 0, longTaskMs: 0 };
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      globalThis.__blasterPerf.longTasks++;
      globalThis.__blasterPerf.longTaskMs += entry.duration;
    }
  }).observe({ type: "longtask", buffered: true });
} catch {}

function loadEngine() {
  enginePromise ||= import("./main.js");
  return enginePromise;
}

async function openEngine(button) {
  const mode = button.dataset.bootMode;
  const screen = button.dataset.bootScreen;
  if (status) status.textContent = "ENGINE READYING · PLEASE HOLD";
  try {
    const { gameReady } = await loadEngine();
    const game = await gameReady;
    if (mode) game.renderSetup(mode);
    else if (screen === "settings") game.renderSettings();
    else if (screen === "credits") game.renderCredits();
  } catch {
    if (status) status.textContent = "ENGINE START FAILED · RELOAD TO RETRY";
  }
}

ui.addEventListener("click", (event) => {
  const button = event.target.closest("[data-boot-mode], [data-boot-screen]");
  if (button) openEngine(button);
});

const warmEngine = () => loadEngine().catch(() => {
  if (status) status.textContent = "ENGINE START FAILED · RELOAD TO RETRY";
});
if (pendingMatch) warmEngine();
else if ("requestIdleCallback" in window) requestIdleCallback(warmEngine, { timeout: 650 });
else setTimeout(warmEngine, 80);
