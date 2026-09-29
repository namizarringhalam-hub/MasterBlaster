// Owner-controlled gameplay rules, bundled into BOTH the client and multiplayer Worker.
// Edit here, then rebuild the client and redeploy the Worker. Never read these from
// browser preferences or accept overrides in multiplayer messages.
export const GAME_CONFIG = Object.freeze({
  headshotDamageMultiplier: 2, // Examples: 2 = double damage, 1.5, 1.2, 1 = no bonus.
});

if (!Number.isFinite(GAME_CONFIG.headshotDamageMultiplier) || GAME_CONFIG.headshotDamageMultiplier < 1) {
  throw new Error("headshotDamageMultiplier must be a finite number >= 1");
}
