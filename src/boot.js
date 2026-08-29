const ui = document.querySelector("#ui-root");
const status = ui.querySelector("[data-boot-status]");
const pendingMatch = sessionStorage.getItem("blaster-pending-match");
let enginePromise;

performance.mark?.("blaster-shell-visible");
globalThis.__blasterPerf = { shellAt: performance.now(), longTasks: 0, longTaskMs: 0 };
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}
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
  if (status) status.textContent = TEXT.boot.loading;
  try {
    const { gameReady } = await loadEngine();
    const game = await gameReady;
    if (mode) game.renderSetup(mode);
    else if (screen === "settings") game.renderSettings();
    else if (screen === "credits") game.renderCredits();
  } catch {
    if (status) status.textContent = TEXT.boot.failed;
  }
}

ui.addEventListener("click", (event) => {
  const button = event.target.closest("[data-boot-mode], [data-boot-screen]");
  if (button) openEngine(button);
});

const warmEngine = () => loadEngine().catch(() => {
  if (status) status.textContent = TEXT.boot.failed;
});
if (pendingMatch) warmEngine();
else if ("requestIdleCallback" in window) requestIdleCallback(warmEngine, { timeout: 650 });
else setTimeout(warmEngine, 80);
import TEXT from "./playerText.js";
