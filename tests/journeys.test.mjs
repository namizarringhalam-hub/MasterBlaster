import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const previousLocation = globalThis.location, previousHistory = globalThis.history;
const previousDocument = globalThis.document, previousUmami = globalThis.umami;
const views = [], state = { retained: true };
const pageviews = [];
let trackerLoaded;
try {
  globalThis.location = new URL("https://game.test/?utm_source=test#invite");
  globalThis.history = {
    state, length: 1,
    replaceState(value, title, url) {
      assert.equal(value, state, "existing history state survives");
      globalThis.location = new URL(url, location);
      views.push(location.pathname);
    }
  };
  globalThis.document = { referrer: "https://referrer.test/", querySelector: () => ({ addEventListener(type, callback) { assert.equal(type, "load"); trackerLoaded = callback; } }) };
  delete globalThis.umami;
  const { setJourney } = await import("../src/journeys.js");
  for (const path of ["/quick-play", "/loading", "/game"]) setJourney(path);
  let acknowledgeFirst;
  globalThis.umami = { track: callback => {
    pageviews.push(callback({ website: "test", hostname: "game.test" }));
    return pageviews.length === 1 ? new Promise(resolve => { acknowledgeFirst = resolve; }) : Promise.resolve();
  } };
  const initialDelivery = trackerLoaded();
  assert.equal(pageviews.length, 1, "pageviews wait for the previous analytics send, independently of the game");
  acknowledgeFirst();
  await initialDelivery;
  assert.deepEqual(pageviews.map(view => view.url), ["/", "/quick-play", "/loading", "/game"].map(path => `${path}?utm_source=test#invite`), "a late tracker still receives every rapid transition, including loading");
  assert.deepEqual(pageviews.map(view => view.referrer), ["https://referrer.test/", "/?utm_source=test#invite", "/quick-play?utm_source=test#invite", "/loading?utm_source=test#invite"]);
  assert.ok(pageviews.every(view => view.website === "test" && view.hostname === "game.test"), "tracker session properties survive");
  views.length = 0; pageviews.length = 0;
  umami.track = callback => { pageviews.push(callback({ website: "test", hostname: "game.test" })); return Promise.resolve(); };
  for (const path of ["/", "/quick-play", "/quick-play", "/loading", "/loading", "/game", "/pause", "/controls", "/pause", "/game", "/results", "/loading", "/game", "/"]) setJourney(path);
  await trackerLoaded();
  assert.deepEqual(views, ["/", "/quick-play", "/loading", "/game", "/pause", "/controls", "/pause", "/game", "/results", "/loading", "/game", "/"]);
  assert.equal(pageviews.length, views.length, "each transition produces exactly one explicit pageview");
  assert.equal(history.length, 1, "analytics never adds Back-button entries");
  assert.equal(location.search, "?utm_source=test", "campaign attribution survives");
  assert.equal(location.hash, "#invite");
  history.replaceState = () => { throw Error("History API unavailable"); };
  assert.doesNotThrow(() => setJourney("/settings"), "tracking failure cannot break the game");
  await trackerLoaded();
  assert.equal(pageviews.at(-1).url, "/settings?utm_source=test#invite", "pageviews work even when URL updates fail");
  umami.track = () => { throw Error("Tracker failure"); };
  assert.doesNotThrow(() => setJourney("/credits"));
  await trackerLoaded();
  umami.track = () => Promise.reject(Error("Network unavailable"));
  assert.doesNotThrow(() => setJourney("/training"));
  await trackerLoaded();
  delete globalThis.location;
  assert.doesNotThrow(() => setJourney("/credits"), "non-browser checks do not need analytics");
} finally {
  if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
  if (previousHistory === undefined) delete globalThis.history; else globalThis.history = previousHistory;
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  if (previousUmami === undefined) delete globalThis.umami; else globalThis.umami = previousUmami;
}
assert.match(await readFile("index.html", "utf8"), /src="https:\/\/cloud.umami.is\/script.js"[^>]*data-auto-pageview="false"/, "automatic pageviews are disabled to prevent delayed duplicates");
console.log("Rapid/queued journey pageviews, deduplication, history/attribution preservation, replay and tracking-failure checks passed.");
