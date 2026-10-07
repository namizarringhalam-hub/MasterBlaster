// Keep stable slots and full capacity. A later draw expansion uploads cleared
// holes too; pending prefixes survive skipped renders and multiple simulation steps.
export function queueParticlePrefix(attribute, instances) {
  if (!attribute || instances === 0) return;
  const count = instances * attribute.itemSize;
  const pending = attribute.updateRanges.find(range => range.start === 0);
  if (pending) pending.count = Math.max(pending.count, count);
  else attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}
