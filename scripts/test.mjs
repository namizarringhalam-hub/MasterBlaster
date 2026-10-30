import { spawnSync } from "node:child_process";

// Each check has its own heap and wall-time ceiling. A failed or hung check
// stops the suite with its name; it cannot silently consume the host's memory.
const checks = [
  "graphicsReadiness.test", "marketingGraphics.test", "directCanvasCapture.test", "socialBattleScene.test", "socialCombatValidation.test",
  "skinningHistory.test",
  "worldGraphics.test", "mecha.test", "graphicsSettings.test", "effectShaders.test", "motionBlur.test", "structuralPools.test", "presentationIntegration.test", "combatPools.test", "projectileBatchSharing.test", "renderPipelineModern.test", "inputBehavior.test", "remoteSnapshots.test", "testRunner.test", "threeLifecycle.test", "playerText.test", "journeys.test", "setupEditor.test", "settingsPreferences.test", "lighting.test", "smoke", "grappleTargets.test", "cornerPillars.test", "botBrain.test", "arenaPortals.test", "trainingControls.test",
  "wallImpactReview.test", "structuralDustReview.test", "projectileContact.test", "blasterRing.test", "blasterSpark.test", "blasterSurface.test", "graphics.test",
  "pause.test", "matchStartup.test", "simulationTiming.test", "hudUpdates.test", "aimPerformance.test", "particleUploads.test", "resourcePreparation.test", "arenaPreparation.test", "gameplayPreparation.test", "effectUpgrades.test", "pbrMaterials.test", "arenaPresentation.test", "gpuTextureTrace.test", "performance.test", "assetCache.test", "audioLifecycle.test", "audioAssets.test", "audioQuality.test", "musicLoading.test", "musicScore.test",
  "weaponStress", "weaponAccuracy.test", "weaponModels.test", "multiplayerProtocol.test", "combatAuthority.test", "headshots.test", "damageIndicator.test", "multiplayerClient.test", "globalMultiplayer.test"
].map(name => [`tests/${name}.mjs`]);
checks.push(["node_modules/vitest/vitest.mjs", "run"]);
for (const args of checks) {
  const started = Date.now();
  console.log(`\nSTART ${args.join(" ")} (120s timeout)`);
  const result = spawnSync(process.execPath, ["--max-old-space-size=1024", ...args], {
    stdio: "inherit", timeout: 120_000, windowsHide: true
  });
  if (result.error || result.status !== 0) {
    console.error(`FAIL ${args.join(" ")}: ${result.error?.code || result.signal || `exit ${result.status}`}`);
    process.exit(result.status || 1);
  }
  console.log(`PASS ${args.join(" ")} (${Date.now() - started}ms)`);
}
