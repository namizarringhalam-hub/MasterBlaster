const pending = [];
let currentUrl, delivery;

function flushJourneys() {
  if (!globalThis.umami?.track || delivery || !pending.length) return delivery;
  // Serialize analytics only; menu rendering and asset preparation never await it.
  delivery = (async () => {
    while (pending.length) {
      const view = pending.shift();
      try { await umami.track(props => ({ ...props, ...view })); }
      catch { /* Analytics must never interrupt a menu or match. */ }
    }
  })().finally(() => { delivery = null; });
  return delivery;
}

function recordJourney(url, referrer) {
  if (url === currentUrl) return;
  pending.push({ url, referrer });
  currentUrl = url;
  flushJourneys();
}

// Explicit pageviews avoid Umami's 300 ms route delay skipping fast loaders.
// Keep URL changes passive: no navigation, extra history entries or asset work.
export function setJourney(path) {
  if (!globalThis.location) return;
  const url = `${path}${location.search}${location.hash}`;
  if (location.pathname !== path) {
    try { history.replaceState(history.state, "", url); }
    catch { /* Tracking still works when browser URL updates are unavailable. */ }
  }
  recordJourney(url, currentUrl ?? globalThis.document?.referrer ?? "");
}

if (globalThis.document && globalThis.location) {
  document.querySelector('script[src="https://cloud.umami.is/script.js"]')?.addEventListener("load", flushJourneys, { once: true });
  recordJourney(`${location.pathname}${location.search}${location.hash}`, document.referrer);
}
