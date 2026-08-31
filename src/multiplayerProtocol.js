import TEXT from "./playerText.js";

export const MULTIPLAYER_PROTOCOL_VERSION = 1;
export const MAX_MATCH_PLAYERS = 16;
export const MATCH_DURATION_MS = 180_000;
export const MATCH_TARGET_SCORE = 10;
export const NETWORK_TICK_MS = 50;
export const MAX_CLIENT_MESSAGE_BYTES = 16_384;
export const MAX_SERVER_MESSAGE_BYTES = 256 * 1_024;

const ROOM_CODE_PATTERN = /[^A-Z0-9-]/g;
const NON_ASCII_PATTERN = /[^\x00-\x7f]/;
const MESSAGE_ENCODER = new TextEncoder();

export function normalizeRoomCode(value, fallback = "") {
  const normalized = String(value || "").toUpperCase().replace(ROOM_CODE_PATTERN, "").slice(0, 12);
  return normalized || fallback;
}

export function sanitizePlayerName(value) {
  return String(value || TEXT.defaults.displayName).replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18) || TEXT.defaults.displayName;
}

export function sanitizeLoadout(value, weapons, fallback = []) {
  const ids = Array.isArray(value) ? value : String(value || "").split(",");
  const unique = [];
  for (const id of ids) {
    const weaponId = String(id || "");
    if (!weapons[weaponId] || unique.includes(weaponId)) continue;
    unique.push(weaponId);
    if (unique.length === 5) break;
  }
  return unique.length === 5 ? unique : [...fallback].slice(0, 5);
}

export function finiteNumber(value, fallback = 0, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function clampMatchMinutes(value, fallback = MATCH_DURATION_MS / 60_000) {
  return Math.trunc(finiteNumber(value, fallback, 1, 30));
}

export function sanitizeVector(value, maximumLength = Infinity) {
  const vector = {
    x: finiteNumber(value?.x, 0, -500, 500),
    y: finiteNumber(value?.y, 0, -500, 500),
    z: finiteNumber(value?.z, 0, -500, 500)
  };
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length > maximumLength && length > 0) {
    const scale = maximumLength / length;
    vector.x *= scale;
    vector.y *= scale;
    vector.z *= scale;
  }
  return vector;
}

function parseMessage(value, maximumBytes) {
  if (typeof value !== "string" || value.length > maximumBytes) return null;
  if (NON_ASCII_PATTERN.test(value) && MESSAGE_ENCODER.encode(value).byteLength > maximumBytes) return null;
  try {
    const message = JSON.parse(value);
    return message && typeof message === "object" && typeof message.type === "string" ? message : null;
  } catch {
    return null;
  }
}

export function parseClientMessage(value) {
  return parseMessage(value, MAX_CLIENT_MESSAGE_BYTES);
}

export function parseServerMessage(value) {
  return parseMessage(value, MAX_SERVER_MESSAGE_BYTES);
}

export function socketUrl(origin, roomCode, parameters = {}) {
  const url = new URL(`/api/rooms/${encodeURIComponent(normalizeRoomCode(roomCode))}/connect`, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(parameters)) {
    if (Array.isArray(value)) url.searchParams.set(key, value.join(","));
    else if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function matchTimeRemaining(endsAt, now = Date.now()) {
  return Math.max(0, finiteNumber(endsAt, now) - now);
}

export function squaredDistance(left, right) {
  const x = (left?.x || 0) - (right?.x || 0);
  const y = (left?.y || 0) - (right?.y || 0);
  const z = (left?.z || 0) - (right?.z || 0);
  return x * x + y * y + z * z;
}
