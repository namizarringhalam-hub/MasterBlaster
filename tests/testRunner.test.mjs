import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";

const source = readFileSync(new URL("../scripts/test.mjs", import.meta.url), "utf8").replace(/^import .*\n/, "");
for (const outcome of [{ status: 0 }, { status: 1 }, { status: null, error: { code: "ETIMEDOUT" } }]) {
  let calls = 0, exitCode;
  try {
    runInNewContext(source, {
      spawnSync: (executable, args, options) => {
        calls++;
        assert.equal(executable, process.execPath);
        assert.ok(args.includes("--max-old-space-size=1024"));
        assert.equal(options.timeout, 120_000);
        assert.equal(options.windowsHide, true);
        return outcome;
      },
      console: { log() {}, error() {} },
      process: { execPath: process.execPath, exit(code) { exitCode = code; throw new Error("exit"); } }
    }, { timeout: 1000 });
  } catch (error) { if (error.message !== "exit") throw error; }
  if (outcome.status === 0) { assert.equal(calls, 20); assert.equal(exitCode, undefined); }
  else { assert.equal(calls, 1); assert.equal(exitCode, 1, "timeout/failure cannot report success or continue"); }
}
const timedOut = spawnSync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 200, windowsHide: true });
assert.equal(timedOut.error?.code, "ETIMEDOUT", "the platform actually terminates an unresponsive direct test child");
assert.notEqual(timedOut.status, 0);
console.log("Test runner heap/time bounds, early failure and real child timeout passed.");
