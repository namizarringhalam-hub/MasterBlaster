export { PLAYER_TEXT as default, PLAYER_TEXT } from "../PLAYER_TEXT.js";

export function formatText(template, values = {}) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => key in values ? String(values[key]) : match);
}
