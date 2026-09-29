import TEXT from "./playerText.js";

export function preparationProgress(stage, complete = 0, total = 0, detail = "") {
  const root = document.querySelector("#resource-progress");
  if (!root) return;
  root.hidden = stage === "ready";
  root.dataset.stage = stage;
  const label = root.querySelector("[data-resource-label]");
  const text = TEXT.boot.preparation[stage] || stage;
  if (label.textContent !== text) label.textContent = text;
  root.querySelector("[data-resource-detail]").textContent = detail || (total ? `${Math.floor(complete / total * 100)}%` : "");
  const progress = root.querySelector("progress");
  if (total) { progress.max = total; progress.value = complete; }
  else progress.removeAttribute("value");
  const retry = root.querySelector("[data-resource-retry]");
  retry.hidden = !["failed", "update"].includes(stage);
  retry.textContent = stage === "update" ? TEXT.boot.preparation.reload : TEXT.boot.preparation.retry;
}
