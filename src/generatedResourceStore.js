import { RESOURCE_VERSION } from "./resourceVersion.js";

// Browser storage is optional. Tabs never read another release's generated data.
let connection;
async function database() {
  if (typeof indexedDB === "undefined" || RESOURCE_VERSION === "development") return null;
  connection ||= new Promise(resolve => {
    const request = indexedDB.open("blaster-generated", 1);
    const timeout = setTimeout(() => resolve(null), 2000);
    request.onupgradeneeded = () => request.result.createObjectStore("resources");
    request.onerror = request.onblocked = () => { clearTimeout(timeout); resolve(null); };
    request.onsuccess = () => { clearTimeout(timeout); resolve(request.result); };
  }).catch(() => null);
  return connection;
}

export async function generatedResource(key, create, valid) {
  const id = `${RESOURCE_VERSION}:${JSON.stringify(key)}`;
  const db = await database();
  if (db) {
    const cached = await new Promise(resolve => {
      try {
        const request = db.transaction("resources").objectStore("resources").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    if (cached && valid(cached)) return cached;
  }
  const result = await create();
  if (db) await new Promise(resolve => {
    try {
      const transaction = db.transaction("resources", "readwrite");
      const store = transaction.objectStore("resources");
      store.put(result, id);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        const current = [];
        for (const key of keys.result) {
          if (!key.startsWith(`${RESOURCE_VERSION}:`)) store.delete(key);
          else if (key !== id) current.push(key);
        }
        // Bound random-seed outputs as well as obsolete generator versions.
        for (const key of current.slice(0, Math.max(0, current.length - 23))) store.delete(key);
      };
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    } catch { resolve(); }
  });
  return result;
}
