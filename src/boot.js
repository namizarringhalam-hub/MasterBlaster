import TEXT from "./playerText.js";
import { RESOURCE_VERSION, backgroundYield } from "./resourceVersion.js";
import { preparationProgress } from "./resourceProgress.js";

const ui = document.querySelector("#ui-root");
const status = ui.querySelector("[data-boot-status]");
let enginePromise, preparation, registration, updateAvailable = false;
performance.mark?.("blaster-shell-visible");
globalThis.__blasterPerf = { shellAt: performance.now(), longTasks: 0, longTaskMs: 0 };
try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      globalThis.__blasterPerf.longTasks++;
      globalThis.__blasterPerf.longTaskMs += entry.duration;
    }
  }).observe({ type: "longtask", buffered: true });
} catch {}

// All game preparation, including user-triggered imports, waits for the menu.
export const menuReady = (async () => {
  if (document.readyState !== "complete") await new Promise(resolve => window.addEventListener("load", resolve, { once: true }));
  await document.fonts?.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  performance.mark?.("blaster-menu-ready");
  await backgroundYield();
})();

function loadEngine() {
  enginePromise ||= menuReady.then(() => import("./main.js")).catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

ui.addEventListener("click", async event => {
  const button = event.target.closest("[data-boot-mode], [data-boot-screen]");
  if (!button) return;
  if (status) status.textContent = TEXT.boot.loading;
  const mode = button.dataset.bootMode, screen = button.dataset.bootScreen;
  try {
    const game = await (await loadEngine()).gameReady;
    if (mode) game.renderSetup(mode);
    else if (screen === "settings") game.renderSettings();
    else if (screen === "credits") game.renderCredits();
  } catch { if (status) status.textContent = TEXT.boot.failed; }
});

async function saveRelease() {
  if (RESOURCE_VERSION === "development") return false;
  if (!("serviceWorker" in navigator && window.isSecureContext)) return false;
  try { registration ||= await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }); }
  catch { return false; }
  await registration.update().catch(() => {});
  const installing = registration.installing || registration.waiting;
  if (installing && installing.state !== "activated") await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Resource worker update timed out")), 15000);
    installing.addEventListener("statechange", () => {
      if (installing.state === "activated") { clearTimeout(timeout); resolve(); }
      if (installing.state === "redundant") { clearTimeout(timeout); reject(new Error("Resource worker update failed")); }
    });
  });
  const ready = await navigator.serviceWorker.ready;
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let timeout;
    const finish = (error, persistent) => {
      clearTimeout(timeout); channel.port1.close();
      if (error) reject(error); else resolve(persistent);
    };
    const armTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => finish(new Error("Resource preparation timed out")), 60000);
    };
    channel.port1.onmessage = ({ data }) => {
      armTimeout();
      if (data.type === "progress") preparationProgress("downloading", data.complete, data.total);
      if (data.type === "complete") finish(null, data.persistent);
      if (data.type === "failed") finish(new Error("Resource preparation incomplete"));
    };
    armTimeout();
    ready.active.postMessage({ type: "PREPARE_RELEASE", version: RESOURCE_VERSION }, [channel.port2]);
  });
}

async function checkUpdate() {
  if (RESOURCE_VERSION === "development") return;
  try {
    const response = await fetch("/resources.json", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const { version } = await response.json();
      if (/^[a-f0-9]{64}$/.test(version) && version !== RESOURCE_VERSION) updateAvailable = true;
    }
  } catch { /* Offline launches keep the last complete release. */ }
}

function prepare() {
  preparation ||= (async () => {
    await menuReady;
    preparationProgress("checking");
    await checkUpdate();
    const persistent = await saveRelease();
    preparationProgress("engine");
    const game = await (await loadEngine()).gameReady;
    await game.prepareResources();
    preparationProgress(updateAvailable ? "update" : "ready", 1, 1,
      persistent ? TEXT.boot.preparation.offline : TEXT.boot.preparation.temporary);
  })().catch(error => {
    preparationProgress(updateAvailable ? "update" : "failed");
    console.warn("Background resource preparation incomplete", error);
    preparation = null;
  });
  return preparation;
}

document.querySelector("[data-resource-retry]")?.addEventListener("click", () => {
  if (updateAvailable) location.reload();
  else prepare();
});
window.addEventListener("online", async () => {
  await checkUpdate();
  if (updateAvailable) preparationProgress("update", 1, 1);
  else if (!preparation) prepare();
});
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && preparation) {
    await checkUpdate();
    if (updateAvailable) preparationProgress("update", 1, 1);
  }
});
prepare();
