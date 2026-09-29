const publicResources = typeof __PUBLIC_RESOURCES__ === "object" ? __PUBLIC_RESOURCES__ : {};
export const resourceURL = path => publicResources[path] || path;
