const distanceSq = (a, b) => (a.position[0] - b.position[0]) ** 2 + (a.position[1] - b.position[1]) ** 2 + (a.position[2] - b.position[2]) ** 2;

export function chooseBotTargets(players = [], decoys = []) {
  const human = players[0];
  return players.slice(1).map((bot) => {
    let target = null;
    let closest = 30 ** 2;
    for (const decoy of decoys) {
      if (!decoy.alive || decoy.ownerId === bot.id) continue;
      const distance = distanceSq(bot, decoy);
      if (distance < closest) { closest = distance; target = decoy; }
    }
    if (!target && human?.alive && distanceSq(bot, human) < 28 ** 2) target = human;
    if (!target) {
      closest = Infinity;
      for (const candidate of [...players, ...decoys]) {
        if (candidate.id === bot.id || !candidate.alive || candidate.ownerId === bot.id) continue;
        const distance = distanceSq(bot, candidate);
        if (distance < closest) { closest = distance; target = candidate; }
      }
    }
    return [bot.id, target?.id || null];
  });
}

if (typeof self !== "undefined") self.onmessage = ({ data }) => self.postMessage(chooseBotTargets(data.players, data.decoys));
