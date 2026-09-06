import { spawnSync } from "node:child_process";

// Each check has its own heap and wall-time ceiling. A failed or hung check
// stops the suite with its name; it cannot silently consume the host's memory.
const checks = [
  "testRunner.test", "threeLifecycle.test", "playerText.test", "smoke", "cornerPillars.test", "botBrain.test", "trainingControls.test", "graphics.test",
  "performance.test", "assetCache.test", "audioLifecycle.test", "audioAssets.test", "audioQuality.test", "musicScore.test",
  "weaponStress", "multiplayerProtocol.test", "combatAuthority.test", "multiplayerClient.test"
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
