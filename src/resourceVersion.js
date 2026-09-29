export const RESOURCE_VERSION = typeof __RESOURCE_VERSION__ === "string" ? __RESOURCE_VERSION__ : "development";

export const backgroundYield = () => new Promise(resolve => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(resolve, { timeout: 150 });
  else setTimeout(resolve, 0);
});
